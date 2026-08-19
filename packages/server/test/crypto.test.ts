import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import argon2 from 'argon2';
import { decryptSecret, encryptSecret, hasNoPassword, NO_PASSWORD_HASH } from '../src/crypto.js';

const KEY = 'a'.repeat(64);

describe('refresh token encryption', () => {
  it('round-trips faithfully', () => {
    const secret = '1//0gLONG-REFRESH-TOKEN_avec-des-symboles.et_des-tirets';
    assert.equal(decryptSecret(encryptSecret(secret, KEY), KEY), secret);
  });

  it('produces different ciphertext on every call', () => {
    // A salt and IV are generated for every encryption: two identical outputs
    // would reveal that the token has not changed.
    const a = encryptSecret('token', KEY);
    const b = encryptSecret('token', KEY);
    assert.notEqual(a, b);
    assert.equal(decryptSecret(a, KEY), decryptSecret(b, KEY));
  });

  it('fails with a different key', () => {
    const encoded = encryptSecret('token', KEY);
    assert.throws(() => decryptSecret(encoded, 'b'.repeat(64)));
  });

  it('detects tampered ciphertext', () => {
    const encoded = encryptSecret('token', KEY);
    const raw = Buffer.from(encoded, 'base64');
    raw[raw.length - 1] ^= 0xff;
    assert.throws(() => decryptSecret(raw.toString('base64'), KEY));
  });

  it('rejects truncated input', () => {
    assert.throws(() => decryptSecret('AAAA', KEY), /truncated/);
  });
});

describe('the hash that means "no password"', () => {
  it('recognises itself and nothing else', () => {
    assert.equal(hasNoPassword(NO_PASSWORD_HASH), true);
    assert.equal(hasNoPassword('$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA'), false);
    assert.equal(hasNoPassword(''), false);
  });

  it('is a valid argon2 hash, so the sign-in path never branches on it', async () => {
    // `/auth/login` compares hashes without knowing this one exists: an account with
    // no password costs one argon2 verification like any wrong password, and is not
    // the one that answers faster.
    assert.equal(await argon2.verify(NO_PASSWORD_HASH, 'whatever-somebody-types'), false);
  });

  it('is not the hash of anything anybody could type', async () => {
    // A sentinel that is argon2("NO_PASSWORD") is a password that opens every account
    // holding it. This one comes from CSPRNG bytes whose preimage was destroyed.
    for (const candidate of ['NO_PASSWORD', 'no_password', 'lukarn', '']) {
      assert.equal(await argon2.verify(NO_PASSWORD_HASH, candidate), false);
    }
  });
});
