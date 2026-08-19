import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { CommenterRepo } from '../src/commenters.js';
import { ConfigRepo } from '../src/config-repo.js';
import { NO_PASSWORD_HASH } from '../src/crypto.js';
import { migrate } from '../src/db.js';
import { PairingStore } from '../src/pairings.js';
import { SessionStore } from '../src/sessions.js';
import { VerificationCodeRepo } from '../src/verification-codes.js';

/**
 * An account bound to a person, and the four rules that keep the binding honest.
 *
 * Each of them reads as an implementation detail until it is broken: a password on a
 * bound account is an administrator signing as somebody else, an unbind without one
 * is an account nobody can enter, a pending invitation counted as an administrator is
 * an instance administrable by nobody, and a conversion that leaves an approved
 * pairing behind hands a television the identity it was converted to.
 */

const SECRET = 's'.repeat(48);
/** Any argon2 string will do here: nothing in this file verifies a password. */
const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA';

let db: Database.Database;
let config: ConfigRepo;
let codes: VerificationCodeRepo;
let commenters: CommenterRepo;
let sessions: SessionStore;
let pairings: PairingStore;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  config = new ConfigRepo(db);
  codes = new VerificationCodeRepo(db, SECRET);
  commenters = new CommenterRepo(db);
  sessions = new SessionStore(db);
  pairings = new PairingStore(db, SECRET);
});

afterEach(() => {
  db.close();
});

/** An account created by address: the reserved hash, and an invitation pending. */
function invite(username: string, email: string, admin = false): void {
  const result = config.createInvitedUser({ username, admin, albums: ['*'], email }, codes);
  assert.ok('user' in result, `invitation refused for ${username}`);
}

/** The same, taken up: the account is that person from here on. */
function bind(username: string, email: string, displayName = 'Mamie'): void {
  invite(username, email);
  config.consumeInvitation({ username, email, displayName }, codes);
}

/** An approved pairing waiting to be claimed, as a television leaves one. */
function approvedPairing(username: string): string {
  const started = pairings.start();
  assert.ok(started, 'pairing request refused');
  assert.equal(pairings.approve(started.userCode, username), 'ok');
  return started.deviceCode;
}

describe('creating an account by address', () => {
  it('writes the reserved hash and the invitation together', () => {
    const result = config.createInvitedUser(
      { username: 'mamie', admin: false, albums: ['*'], email: 'mamie@exemple.fr' },
      codes,
    );

    assert.ok('user' in result);
    assert.equal(result.user.passwordHash, NO_PASSWORD_HASH);
    // The binding is written when the code is consumed, never here: a verified
    // address proves control of an inbox, not that anybody accepted this account.
    assert.equal(result.user.commenterId, null);
    assert.match(result.code, /^\d{6}$/);

    const invitation = codes.pendingInvite('mamie');
    assert.equal(invitation?.target, 'mamie@exemple.fr');
  });

  it('leaves neither behind when the invitation cannot be sent', () => {
    // One send a minute is per address, whatever the purpose: this address has just
    // been written to, so the invitation is refused after the account row is inserted.
    assert.ok('code' in codes.mint('mamie@exemple.fr', 'identity'));

    const result = config.createInvitedUser(
      { username: 'mamie', admin: false, albums: ['*'], email: 'mamie@exemple.fr' },
      codes,
    );

    assert.ok('failure' in result);
    assert.equal(result.failure, 'too_soon');
    // A sentinel account nobody invited and nobody can enter is exactly what the
    // single transaction exists to prevent.
    assert.equal(config.user('mamie'), undefined);
    assert.equal(codes.pendingInvite('mamie'), null);
  });

  it('creates no identity until somebody takes it up', () => {
    invite('mamie', 'mamie@exemple.fr');
    assert.equal(commenters.byEmail('mamie@exemple.fr'), null);
  });

  it('writes no binding even to an address somebody has already verified', () => {
    commenters.declare('alice@exemple.fr', 'Alice');
    const identity = commenters.markVerified('alice@exemple.fr');
    assert.ok(identity);

    invite('alice', 'alice@exemple.fr');

    // `verified_at` proves that somebody controls an inbox, never that they accepted
    // this account. Adopting it here would hand every session already open on the
    // account that person's name, without a code ever being entered — an
    // administrator converting an account they hold and signing as anyone who has
    // ever commented.
    assert.equal(config.user('alice')?.commenterId, null);
    assert.equal(config.userForEmail('alice@exemple.fr'), undefined);
    assert.equal(commenters.byId(identity.id)?.displayName, 'Alice');
  });
});

describe('consuming an invitation', () => {
  it('binds the account, verifies the identity and spends the code', () => {
    invite('mamie', 'mamie@exemple.fr');

    const user = config.consumeInvitation(
      { username: 'mamie', email: 'mamie@exemple.fr', displayName: 'Mamie' },
      codes,
    );

    const identity = commenters.byEmail('mamie@exemple.fr');
    assert.equal(user.commenterId, identity?.id);
    assert.equal(identity?.displayName, 'Mamie');
    assert.notEqual(identity?.verifiedAt, null);
    assert.equal(codes.find('mamie@exemple.fr', 'invite'), null);
  });

  it('keeps the name an already verified identity chose for itself', () => {
    commenters.declare('alice@exemple.fr', 'Alice');
    commenters.markVerified('alice@exemple.fr');
    invite('alice', 'alice@exemple.fr');

    config.consumeInvitation(
      { username: 'alice', email: 'alice@exemple.fr', displayName: 'Someone else' },
      codes,
    );

    // A name supplied here must never rename an existing identity: it is the rule
    // `pending_display_name` exists for, read from the other side.
    assert.equal(commenters.byEmail('alice@exemple.fr')?.displayName, 'Alice');
  });

  it('takes the unknown path for a row nobody has verified', () => {
    // Anybody behind a shared key can pre-seed an address with a name of their
    // choosing, so such a row is not adopted as it stands.
    commenters.declare('mamie@exemple.fr', 'Pre-seeded');
    invite('mamie', 'mamie@exemple.fr');

    assert.throws(
      () => config.consumeInvitation({ username: 'mamie', email: 'mamie@exemple.fr' }, codes),
      /no name supplied/,
    );

    config.consumeInvitation(
      { username: 'mamie', email: 'mamie@exemple.fr', displayName: 'Mamie' },
      codes,
    );
    const identity = commenters.byEmail('mamie@exemple.fr');
    assert.equal(identity?.displayName, 'Mamie');
    assert.notEqual(identity?.verifiedAt, null);
  });

  it('resolves the address to its account afterwards', () => {
    bind('mamie', 'mamie@exemple.fr');
    assert.equal(config.userForEmail('MAMIE@exemple.fr')?.username, 'mamie');
    assert.equal(config.userForEmail('inconnue@exemple.fr'), undefined);
  });

  it('gives the identity the language its invitation was written in', () => {
    const result = config.createInvitedUser(
      { username: 'mamie', admin: false, albums: ['*'], email: 'mamie@exemple.fr', locale: 'fr' },
      codes,
    );
    assert.ok('user' in result);

    config.consumeInvitation(
      { username: 'mamie', email: 'mamie@exemple.fr', displayName: 'Mamie', locale: 'fr' },
      codes,
    );

    // The window this exists for is the one before the first request: `plugins/auth.ts`
    // records `Accept-Language` from then on, and the emails composed in between would
    // otherwise go out in the instance default.
    assert.equal(commenters.byEmail('mamie@exemple.fr')?.locale, 'fr');
  });

  it('leaves an identity that already reads a language alone', () => {
    commenters.declare('alice@exemple.fr', 'Alice');
    const identity = commenters.markVerified('alice@exemple.fr')!;
    commenters.setLocale(identity.id, 'fr');
    invite('alice', 'alice@exemple.fr');

    config.consumeInvitation(
      { username: 'alice', email: 'alice@exemple.fr', displayName: 'Alice', locale: 'en' },
      codes,
    );

    // That value came from this person's own browser, which D260812d makes
    // authoritative: a language somebody else picked for them must not displace it.
    assert.equal(commenters.byEmail('alice@exemple.fr')?.locale, 'fr');
  });
});

describe('converting a shared key', () => {
  it('closes its sessions, forgets its screens and retires its password', () => {
    config.createUser({
      username: 'famille',
      passwordHash: PASSWORD_HASH,
      admin: false,
      albums: ['*'],
    });
    const session = sessions.create('famille');
    const deviceCode = approvedPairing('famille');
    assert.ok('code' in codes.mint('famille@exemple.fr', 'invite', { username: 'famille' }));

    const user = config.consumeInvitation(
      { username: 'famille', email: 'famille@exemple.fr', displayName: 'Mamie' },
      codes,
    );

    assert.notEqual(user.commenterId, null);
    // Everyone who knew the shared key would otherwise still walk in under it.
    assert.equal(user.passwordHash, NO_PASSWORD_HASH);
    // The other devices of the household would otherwise keep a session that has
    // just started signing under one person's name.
    assert.equal(sessions.get(session.id), null);
    // An approved pairing survives a session close, and `claim()` would turn it into
    // a fresh session as the person this account has just become.
    assert.equal(pairings.claim(deviceCode).status, 'unknown');
  });
});

describe('a password on a bound account', () => {
  it('is refused by the repository, so no route and no script can set one', () => {
    bind('mamie', 'mamie@exemple.fr');

    // `pnpm reset-password` reaches `updateUser` directly, which is why the rule
    // lives here: guarding the admin route alone would leave a shell command that
    // quietly recreates the impersonation.
    assert.throws(
      () => config.updateUser('mamie', { passwordHash: PASSWORD_HASH }),
      /bound to a person/,
    );
    assert.equal(config.user('mamie')?.passwordHash, NO_PASSWORD_HASH);
  });

  it('is given by unbinding, which clears the binding and closes what was open', () => {
    bind('mamie', 'mamie@exemple.fr');
    const session = sessions.create('mamie');
    const deviceCode = approvedPairing('mamie');

    const user = config.unbindUser('mamie', PASSWORD_HASH);

    assert.equal(user.commenterId, null);
    assert.equal(user.passwordHash, PASSWORD_HASH);
    assert.equal(sessions.get(session.id), null);
    assert.equal(pairings.claim(deviceCode).status, 'unknown');
    // The person is still a person, and their comments keep the name they signed.
    assert.notEqual(commenters.byEmail('mamie@exemple.fr'), null);
  });

  it('cannot be left out of an unbind', () => {
    bind('mamie', 'mamie@exemple.fr');
    // Otherwise the account has no identity and a hash nobody can enter, the
    // administrator included.
    assert.throws(() => config.unbindUser('mamie', NO_PASSWORD_HASH), /requires a password/);
    assert.notEqual(config.user('mamie')?.commenterId, null);
  });

  it('changes nothing for an unbound account', () => {
    config.createUser({ username: 'salon', passwordHash: 'ancien', admin: false, albums: ['*'] });
    assert.equal(
      config.updateUser('salon', { passwordHash: PASSWORD_HASH }).passwordHash,
      PASSWORD_HASH,
    );
  });
});

describe('the last administrator', () => {
  it('is counted only while it can actually sign in', () => {
    config.createUser({
      username: 'alexis',
      passwordHash: PASSWORD_HASH,
      admin: true,
      albums: ['*'],
    });
    invite('mamie', 'mamie@exemple.fr', true);

    // An administrator whose invitation is still pending has an unusable password and
    // no binding: counting it would let the only working one demote itself.
    assert.equal(config.adminCount(), 1);
    assert.equal(config.isUsable('alexis'), true);
    assert.equal(config.isUsable('mamie'), false);

    config.consumeInvitation(
      { username: 'mamie', email: 'mamie@exemple.fr', displayName: 'Mamie' },
      codes,
    );

    // A binding is a way in, so the second administrator now counts.
    assert.equal(config.adminCount(), 2);
    assert.equal(config.isUsable('mamie'), true);
  });
});

describe('deleting an account', () => {
  it('takes its pending invitation with it', () => {
    invite('mamie', 'mamie@exemple.fr');
    config.deleteUser('mamie');

    // Recreating the username would otherwise let the original recipient bind an
    // account that may now be an administrator.
    assert.equal(codes.pendingInvite('mamie'), null);
    assert.equal(codes.find('mamie@exemple.fr', 'invite'), null);
  });

  it('leaves the person behind, bound to nothing', () => {
    bind('mamie', 'mamie@exemple.fr');
    config.deleteUser('mamie');

    // Deleting the account is what closes the door; the identity keeps signing the
    // comments it wrote.
    assert.notEqual(commenters.byEmail('mamie@exemple.fr'), null);
    assert.equal(config.userForEmail('mamie@exemple.fr'), undefined);
  });
});
