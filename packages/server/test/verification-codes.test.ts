import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrate } from '../src/db.js';
import { VerificationCodeRepo } from '../src/verification-codes.js';

/**
 * The codes sent to an address, and the rules D39 set around them.
 *
 * Three of those rules are what this file exists for, because each of them is a
 * sentence that reads as an implementation detail until it is broken: one send a
 * minute is per **address** and not per row, the deadline belongs to the purpose,
 * and the purpose is part of the key rather than a flag.
 */

const SECRET = 's'.repeat(48);
const MINUTE_MS = 60 * 1000;

let db: Database.Database;
let codes: VerificationCodeRepo;

/** Backdates the last delivery to this address: a real wait would be a real minute. */
function antidate(target: string): void {
  db.prepare('UPDATE verification_codes SET sent_at = ? WHERE target = ?').run(
    '2020-01-01T00:00:00.000Z',
    target,
  );
}

/** An account to invite: `verification_codes.username` references `users`. */
function account(username: string): void {
  const date = '2026-01-01T00:00:00.000Z';
  db.prepare(
    `INSERT INTO users (username, password_hash, admin, all_albums, created_at, updated_at)
     VALUES (?, '$argon2id$empreinte', 0, 1, ?, ?)`,
  ).run(username, date, date);
}

before(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  codes = new VerificationCodeRepo(db, SECRET);
});

after(() => {
  db?.close();
});

describe('sending a code', () => {
  it('refuses a second delivery to one address inside the minute, whatever the purpose', () => {
    const first = codes.mint('spam@exemple.fr', 'identity');
    assert.ok('code' in first);

    // Not per row: the two purposes are two rows, and a per-row check would let an
    // identity code and a sign-in code reach the same inbox in the same minute,
    // which is the mail-bombing this rule exists to stop.
    const second = codes.mint('spam@exemple.fr', 'signin');
    assert.ok('failure' in second);
    assert.equal(second.failure, 'too_soon');
    assert.ok(second.retryAfterMs > 0 && second.retryAfterMs <= MINUTE_MS);

    // Another address is another inbox and waits for nobody.
    assert.ok('code' in codes.mint('autre@exemple.fr', 'signin'));
  });

  it('gives an invitation seven days and a sign-in fifteen minutes', () => {
    account('mamie');

    /** How long the code just minted for this purpose has to live. */
    const life = (purpose: 'signin' | 'invite'): number => {
      const row = codes.find('deadlines@exemple.fr', purpose);
      assert.ok(row, `no live ${purpose} code`);
      const span = new Date(row.expiresAt).getTime() - new Date(row.sentAt).getTime();
      antidate('deadlines@exemple.fr');
      return span;
    };

    assert.ok('code' in codes.mint('deadlines@exemple.fr', 'signin'));
    // The numbers are asserted because a screen shows the date: an invitation has
    // to survive somebody's weekend, while a sign-in code is read in the tab that
    // asked for it.
    assert.equal(life('signin'), 15 * MINUTE_MS);

    assert.ok('code' in codes.mint('deadlines@exemple.fr', 'invite', { username: 'mamie' }));
    assert.equal(life('invite'), 7 * 24 * 60 * MINUTE_MS);
  });

  it('never stores the digits themselves', () => {
    antidate('secret@exemple.fr');
    const asked = codes.mint('secret@exemple.fr', 'identity');
    assert.ok('code' in asked);

    const row = db
      .prepare('SELECT code_hash FROM verification_codes WHERE target = ?')
      .get('secret@exemple.fr') as { code_hash: string };
    // A database dump must not provide enough to verify an address or open a session.
    assert.ok(!row.code_hash.includes(asked.code));
  });
});

describe('checking a code', () => {
  it('refuses a wrong code and accepts the right one', () => {
    const asked = codes.mint('papi@exemple.fr', 'identity');
    assert.ok('code' in asked);

    assert.deepEqual(codes.check('papi@exemple.fr', 'identity', '000000'), {
      failure: 'mismatch',
    });

    const ok = codes.check('papi@exemple.fr', 'identity', asked.code);
    assert.ok('row' in ok);
    assert.equal(ok.row.target, 'papi@exemple.fr');
  });

  it('exhausts a code after five attempts, invitation included', () => {
    account('brute');
    const asked = codes.mint('brute@exemple.fr', 'invite', { username: 'brute' });
    assert.ok('code' in asked);

    for (let attempt = 0; attempt < 5; attempt++) {
      assert.deepEqual(codes.check('brute@exemple.fr', 'invite', '000000'), {
        failure: 'mismatch',
      });
    }

    // Even the right code no longer works. Six digits fall to a million tries, and
    // the seven-day life of an invitation is exactly why the ceiling must apply to
    // it as to everything else.
    assert.deepEqual(codes.check('brute@exemple.fr', 'invite', asked.code), {
      failure: 'too_many_attempts',
    });
  });

  it('counts an abandoned attempt', () => {
    antidate('abandon@exemple.fr');
    assert.ok('code' in codes.mint('abandon@exemple.fr', 'identity'));

    codes.check('abandon@exemple.fr', 'identity', '000000');
    const row = codes.find('abandon@exemple.fr', 'identity');
    // Counted before the comparison, on purpose: stopping halfway must buy no free
    // tries.
    assert.equal(row?.attempts, 1);
  });

  it('refuses an expired code without confusing it with an unknown one', () => {
    antidate('perime@exemple.fr');
    const asked = codes.mint('perime@exemple.fr', 'identity');
    assert.ok('code' in asked);
    db.prepare('UPDATE verification_codes SET expires_at = ? WHERE target = ?').run(
      '2020-01-01T00:00:00.000Z',
      'perime@exemple.fr',
    );

    assert.deepEqual(codes.check('perime@exemple.fr', 'identity', asked.code), {
      failure: 'expired',
    });
    // A reader must not offer to remint what the purge is about to delete.
    assert.equal(codes.find('perime@exemple.fr', 'identity'), null);
  });

  it('does not find a code minted for another purpose', () => {
    antidate('croise@exemple.fr');
    const asked = codes.mint('croise@exemple.fr', 'signin');
    assert.ok('code' in asked);

    // The purpose is part of the key rather than a flag, so the identity flow does
    // not merely refuse a sign-in code: it never sees it. A code obtained for one
    // thing therefore cannot be spent on the other.
    assert.deepEqual(codes.check('croise@exemple.fr', 'identity', asked.code), {
      failure: 'unknown',
    });
    assert.ok('row' in codes.check('croise@exemple.fr', 'signin', asked.code));
  });

  it('finds nothing once the code is spent', () => {
    antidate('use@exemple.fr');
    const asked = codes.mint('use@exemple.fr', 'identity');
    assert.ok('code' in asked);
    assert.ok('row' in codes.check('use@exemple.fr', 'identity', asked.code));

    codes.consume('use@exemple.fr', 'identity');

    // Replaying it must revalidate nothing: access may have been revoked in the
    // meantime.
    assert.deepEqual(codes.check('use@exemple.fr', 'identity', asked.code), {
      failure: 'unknown',
    });
  });
});

describe('inviting an account', () => {
  it('leaves one live invitation when the same account is invited elsewhere', () => {
    account('tata');
    assert.ok('code' in codes.mint('tata@exemple.fr', 'invite', { username: 'tata' }));
    antidate('tata@exemple.fr');

    // Correcting a typo in an address. Both constraints would refuse a plain
    // insert, and an upsert can name only one of them.
    assert.ok('code' in codes.mint('tata@exemple.net', 'invite', { username: 'tata' }));

    assert.equal(codes.find('tata@exemple.fr', 'invite'), null);
    assert.equal(codes.pendingInvite('tata')?.target, 'tata@exemple.net');
    assert.equal(liveInvites('tata'), 1);
  });

  it('leaves one live invitation when one address is invited to another account', () => {
    account('tonton');
    account('cousine');
    assert.ok('code' in codes.mint('partage@exemple.fr', 'invite', { username: 'tonton' }));
    antidate('partage@exemple.fr');

    // The address was the wrong one for `tonton`: the account it named loses its
    // invitation, which is what the account list is there to show.
    assert.ok('code' in codes.mint('partage@exemple.fr', 'invite', { username: 'cousine' }));

    assert.equal(codes.pendingInvite('tonton'), null);
    assert.equal(codes.pendingInvite('cousine')?.target, 'partage@exemple.fr');
    assert.equal(liveInvites('cousine'), 1);
  });

  it('refuses to name an account on any other purpose', () => {
    account('interdit');
    assert.throws(
      () => codes.mint('interdit@exemple.fr', 'signin', { username: 'interdit' }),
      /cannot name an account/,
    );
    assert.throws(() => codes.mint('interdit@exemple.fr', 'invite'), /must name the account/);
  });
});

describe('housekeeping', () => {
  it('removes what has expired and nothing else', () => {
    const live = new Database(':memory:');
    live.pragma('foreign_keys = ON');
    migrate(live);
    const repo = new VerificationCodeRepo(live, SECRET);

    assert.ok('code' in repo.mint('purge@exemple.fr', 'identity'));
    live
      .prepare('UPDATE verification_codes SET sent_at = ? WHERE target = ?')
      .run('2020-01-01T00:00:00.000Z', 'purge@exemple.fr');
    assert.ok('code' in repo.mint('reste@exemple.fr', 'identity'));
    live
      .prepare('UPDATE verification_codes SET expires_at = ? WHERE target = ?')
      .run('2020-01-01T00:00:00.000Z', 'purge@exemple.fr');

    // The four columns this table replaced were overwritten in place and
    // accumulated nothing; a table does.
    assert.equal(repo.purgeExpired(), 1);
    assert.ok(repo.find('reste@exemple.fr', 'identity'));

    live.close();
  });
});

/** Invitations still alive for this account, read past the repository. */
function liveInvites(username: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM verification_codes
          WHERE purpose = 'invite' AND username = ? AND expires_at > ?`,
      )
      .get(username, new Date().toISOString()) as { n: number }
  ).n;
}
