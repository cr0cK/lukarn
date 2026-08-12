import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Encryption of the Google refresh token at rest. The VPS is not an HSM, but a
 * dump of the SQLite database must not be enough to access Drive: TOKEN_KEY,
 * which lives in the process environment, is also required.
 *
 * Format: base64( salt(16) | iv(12) | tag(16) | ciphertext ).
 * The salt is generated for every encryption, so encrypting the same token twice
 * produces different output.
 */

const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function deriveKey(secret: string, salt: Buffer): Buffer {
  // Node's default scrypt cost (N=16384): ~50 ms here, imperceptible because
  // decryption only happens at startup and on each token refresh.
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
    throw new Error('Encrypted data truncated');
  }

  const salt = raw.subarray(0, SALT_BYTES);
  const iv = raw.subarray(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const tag = raw.subarray(SALT_BYTES + IV_BYTES, SALT_BYTES + IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(SALT_BYTES + IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
  decipher.setAuthTag(tag);
  // `final()` throws if the tag does not match: TOKEN_KEY has changed or the database
  // has been altered. Either way, OAuth consent must be completed again.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Token in the "unsubscribe" link carried by notification emails.
 *
 * An HMAC of the identifier alone, with no database state and **no expiry**: the
 * link is in an email that may be reopened months later, and an expired token would
 * send users to a sign-in form when they specifically want to stop being disturbed.
 * Its effect is harmless — disabling their own notifications — and reversible
 * from /admin.
 */
export function signUnsubscribeToken(username: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`unsubscribe:${username.toLowerCase()}`)
    .digest('base64url');
}

/** Constant-time comparison so a token cannot be guessed with a stopwatch. */
export function verifyUnsubscribeToken(username: string, token: string, secret: string): boolean {
  return safeEqual(signUnsubscribeToken(username, secret), token);
}

/**
 * Token in the "unsubscribe" link carried by new-photo announcements.
 *
 * It covers both the address **and** the album: without the album in the signed
 * message, a token received for "Christmas 2019" would work for "Holidays", and a
 * link copied from one email to another would disable an unintended subscription.
 * The prefix distinguishes it from the global token in D37: the two must not be
 * interchangeable because they disable different things.
 */
export function signAlbumUnsubscribeToken(email: string, albumId: string, secret: string): string {
  // `ALBUM_ID_PATTERN` forbids ":" in an album ID, and zod forbids it in an address,
  // so the signed message can be split unambiguously; a separator allowed on both
  // sides would let two pairs produce the same token.
  return createHmac('sha256', secret)
    .update(`unsubscribe-album:${email.toLowerCase()}:${albumId}`)
    .digest('base64url');
}

export function verifyAlbumUnsubscribeToken(
  email: string,
  albumId: string,
  token: string,
  secret: string,
): boolean {
  return safeEqual(signAlbumUnsubscribeToken(email, albumId, secret), token);
}

/**
 * Fingerprint of an email address verification code.
 *
 * The code is short and lives for fifteen minutes, but it need not be readable in
 * a database dump: an HMAC costs less than a SQL query. It is bound to the address
 * so a code valid for one is valid for no other.
 */
export function hashVerificationCode(email: string, code: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`verify:${email.toLowerCase()}:${code}`)
    .digest('base64url');
}

/**
 * Fingerprint of a pairing request's `deviceCode`.
 *
 * It is the exchange's only secret — the code displayed on screen claims nothing.
 * It lives for five minutes, which does not justify leaving it readable in a dump:
 * the HMAC costs less than the SQL query that looks it up. The prefix distinguishes
 * it from other fingerprints made with the same secret, which unlock different things.
 */
export function hashDeviceCode(deviceCode: string, secret: string): string {
  return createHmac('sha256', secret).update(`device:${deviceCode}`).digest('base64url');
}

/**
 * Constant-time comparison that tolerates different lengths. `timingSafeEqual`
 * throws when they differ — which is already an answer, but in the form of an
 * exception rather than `false`.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
