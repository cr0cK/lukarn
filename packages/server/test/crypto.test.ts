import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decryptSecret, encryptSecret } from '../src/crypto.js';

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
