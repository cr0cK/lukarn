import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decryptSecret, encryptSecret } from '../src/crypto.js';

const KEY = 'a'.repeat(64);

describe('chiffrement du refresh token', () => {
  it('fait un aller-retour fidèle', () => {
    const secret = '1//0gLONG-REFRESH-TOKEN_avec-des-symboles.et_des-tirets';
    assert.equal(decryptSecret(encryptSecret(secret, KEY), KEY), secret);
  });

  it('produit un chiffré différent à chaque appel', () => {
    // Sel et IV tirés à chaque chiffrement : deux sorties identiques
    // révéleraient que le token n'a pas changé.
    const a = encryptSecret('token', KEY);
    const b = encryptSecret('token', KEY);
    assert.notEqual(a, b);
    assert.equal(decryptSecret(a, KEY), decryptSecret(b, KEY));
  });

  it('échoue avec une autre clé', () => {
    const encoded = encryptSecret('token', KEY);
    assert.throws(() => decryptSecret(encoded, 'b'.repeat(64)));
  });

  it('détecte une altération du chiffré', () => {
    const encoded = encryptSecret('token', KEY);
    const raw = Buffer.from(encoded, 'base64');
    raw[raw.length - 1] ^= 0xff;
    assert.throws(() => decryptSecret(raw.toString('base64'), KEY));
  });

  it('rejette une entrée tronquée', () => {
    assert.throws(() => decryptSecret('AAAA', KEY), /tronqu/);
  });
});
