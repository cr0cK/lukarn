import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

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

/**
 * Jeton du lien « se désabonner » porté par les emails de notification.
 *
 * Un HMAC du seul identifiant, sans état en base et **sans expiration** : le
 * lien se trouve dans un email qui peut être rouvert des mois plus tard, et un
 * jeton périmé renverrait l'utilisateur vers un formulaire de connexion alors
 * qu'il cherche justement à ne plus être dérangé. Ce qu'il ouvre est sans
 * gravité — couper ses propres notifications — et se rétablit depuis /admin.
 */
export function signUnsubscribeToken(username: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`unsubscribe:${username.toLowerCase()}`)
    .digest('base64url');
}

/** Comparaison en temps constant : un jeton ne se devine pas au chronomètre. */
export function verifyUnsubscribeToken(username: string, token: string, secret: string): boolean {
  return safeEqual(signUnsubscribeToken(username, secret), token);
}

/**
 * Empreinte du code de vérification d'une adresse email.
 *
 * Le code est court et vit quinze minutes, mais il n'a aucune raison d'être
 * lisible dans un dump de la base : un HMAC coûte moins qu'une requête SQL. Il
 * est lié à l'adresse, pour qu'un code valide pour l'une ne le soit pour aucune
 * autre.
 */
export function hashVerificationCode(email: string, code: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`verify:${email.toLowerCase()}:${code}`)
    .digest('base64url');
}

/**
 * Comparaison en temps constant tolérante aux longueurs différentes.
 * `timingSafeEqual` lève quand elles diffèrent — ce qui est déjà une réponse,
 * mais sous forme d'exception plutôt que de `false`.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
