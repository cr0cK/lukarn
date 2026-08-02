import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Chiffrement du refresh token Google au repos. Le VPS n'est pas un HSM, mais
 * un dump de la base SQLite ne doit pas suffire à donner accès au Drive : il
 * faut aussi TOKEN_KEY, qui vit dans l'environnement du process.
 *
 * Format : base64( salt(16) | iv(12) | tag(16) | ciphertext ).
 * Le sel est tiré à chaque chiffrement, donc deux chiffrements du même token
 * produisent des sorties différentes.
 */

const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function deriveKey(secret: string, salt: Buffer): Buffer {
  // Coût scrypt par défaut de Node (N=16384) : ~50 ms ici, imperceptible
  // puisqu'on ne déchiffre qu'au démarrage et à chaque refresh de token.
  return scryptSync(secret, salt, KEY_BYTES);
}

export function encryptSecret(plaintext: string, secret: string): string {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([salt, iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decryptSecret(encoded: string, secret: string): string {
  const raw = Buffer.from(encoded, 'base64');
  if (raw.length <= SALT_BYTES + IV_BYTES + TAG_BYTES) {
    throw new Error('Données chiffrées tronquées');
  }

  const salt = raw.subarray(0, SALT_BYTES);
  const iv = raw.subarray(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const tag = raw.subarray(SALT_BYTES + IV_BYTES, SALT_BYTES + IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(SALT_BYTES + IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
  decipher.setAuthTag(tag);
  // `final()` lève si le tag ne colle pas : TOKEN_KEY a changé, ou la base a
  // été altérée. Dans les deux cas il faut refaire le consentement OAuth.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
