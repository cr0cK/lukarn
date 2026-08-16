/**
 * AWS Signature Version 4, computed here rather than by an SDK.
 *
 * `@aws-sdk/client-s3` weighs some 15 MB across dozens of transitive packages for the
 * three request shapes this application sends — a listing, a ranged read, and a probe —
 * and its streaming body does not map onto the `Response` the media proxy relays
 * verbatim. Same reasoning as D5, same conclusion (D260816e).
 *
 * The module is **pure**: it takes a request description and credentials and returns
 * headers. Nothing here opens a socket, which is what makes the published AWS test
 * vectors runnable against it without a network.
 */
import { createHash, createHmac } from 'node:crypto';

const ALGORITHM = 'AWS4-HMAC-SHA256';

/**
 * SHA-256 of nothing, the payload hash of every request this application signs.
 *
 * Computed rather than written out: a mistyped constant would produce a signature that
 * is wrong only for the last line of the canonical request, which is the hardest of all
 * the failures here to read back from a `SignatureDoesNotMatch`.
 */
export const EMPTY_PAYLOAD_SHA256 = createHash('sha256').update('').digest('hex');

/** The key pair an S3-compatible backend authenticates with. */
export interface SigningCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

/** What the signature is scoped to: a day, a region, a service. */
export interface SigningScope {
  region: string;
  service: string;
  /**
   * The instant the request is signed. Supplied rather than read from the clock so a
   * test can reproduce a published vector, and so one listing page and its successor
   * cannot straddle midnight with two different credential scopes.
   */
  signedAt: Date;
}

/** A request as the signer needs to see it, before its `Authorization` exists. */
export interface SignableRequest {
  method: string;
  /** Full URL, query included. `host` is taken from it, port and all. */
  url: URL;
  /**
   * Headers to send **and** to sign. Every one of them ends up in `SignedHeaders`,
   * which is the point for `Range`: a byte range the server verifies is a byte range
   * an intermediary cannot rewrite.
   */
  headers?: Record<string, string>;
  /** Hex SHA-256 of the body. Defaults to the empty-body digest. */
  payloadHash?: string;
}

/**
 * The headers to send, plus the two intermediate strings.
 *
 * The intermediates are exposed because they are what the AWS test vectors compare:
 * a signature mismatch says only "wrong", while a canonical request laid beside the
 * published one says *which line* is wrong — and getting the canonical request wrong
 * is the likeliest mistake in a hand-written signer.
 */
export interface SignedRequest {
  headers: Record<string, string>;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

/**
 * Percent-encoding as SigV4 defines it: RFC 3986 unreserved characters survive, and
 * everything else becomes `%XX` in upper case.
 *
 * `encodeURIComponent` is nearly this and leaves `!*'()` alone, which is the whole
 * difference and the reason the four are patched afterwards.
 */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Decoding that never throws.
 *
 * A stray `%` in an object key — legal in a bucket, and not rare in names exported by
 * another tool — makes `decodeURIComponent` raise. Signing the text as it arrived is a
 * better answer than failing to list the folder holding it.
 */
function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** `20150830T123600Z`, the only date format the signature accepts. */
function amzTimestamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

/**
 * The path, each segment re-encoded.
 *
 * Deliberately **not** normalised — no `.` or `..` collapsing, no collapsing of double
 * slashes. S3 is the one service whose canonical URI is the literal path, because an
 * object key may itself contain `..` or an empty segment, and a signer that tidied it
 * would sign a different object from the one being fetched.
 */
function canonicalPath(pathname: string): string {
  if (pathname.length === 0) return '/';
  return pathname
    .split('/')
    .map((segment) => uriEncode(decodeSafe(segment)))
    .join('/');
}

/** Parameters sorted by encoded name, then by encoded value. */
function canonicalQuery(search: string): string {
  if (search.length <= 1) return '';

  const pairs = search
    .slice(1)
    .split('&')
    .filter((pair) => pair.length > 0)
    .map((pair) => {
      const equals = pair.indexOf('=');
      const name = equals === -1 ? pair : pair.slice(0, equals);
      const value = equals === -1 ? '' : pair.slice(equals + 1);
      return [uriEncode(decodeSafe(name)), uriEncode(decodeSafe(value))] as const;
    });

  pairs.sort(([nameA, valueA], [nameB, valueB]) =>
    nameA === nameB ? compare(valueA, valueB) : compare(nameA, nameB),
  );

  return pairs.map(([name, value]) => `${name}=${value}`).join('&');
}

/**
 * Byte-order comparison, not locale order.
 *
 * `localeCompare` sorts `Param1` and `param2` the way a reader would, and the signature
 * is computed over the way a byte does. The two disagree on exactly the mixed-case
 * parameter names an S3 listing sends.
 */
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * A header value as the signature sees it: trimmed, with internal whitespace runs
 * collapsed to one space.
 *
 * The specification exempts spaces inside a quoted value. Nothing signed here carries
 * one — a `Range`, a content hash and a date — so the exemption is left unimplemented
 * rather than written and never exercised.
 */
function collapse(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/**
 * The signing key: four chained HMACs, none of which is the secret itself.
 *
 * This is what scopes a signature to one day, one region and one service — a captured
 * request cannot be replayed against another bucket tomorrow.
 */
function signingKey(secret: string, day: string, region: string, service: string): Buffer {
  const dated = hmac(`AWS4${secret}`, day);
  const regional = hmac(dated, region);
  const scoped = hmac(regional, service);
  return hmac(scoped, 'aws4_request');
}

/**
 * Signs a request and returns everything needed to send it.
 *
 * `host` and `x-amz-date` are added and signed here: the first because a signature that
 * did not cover it could be replayed against another endpoint, the second because it is
 * what bounds the replay window to fifteen minutes. Header names are lower-cased on the
 * way in, so a caller passing `Range` and one passing `range` sign the same request.
 */
export function signRequest(
  request: SignableRequest,
  credentials: SigningCredentials,
  scope: SigningScope,
): SignedRequest {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    headers[name.toLowerCase()] = value;
  }

  const timestamp = amzTimestamp(scope.signedAt);
  headers.host = request.url.host;
  headers['x-amz-date'] = timestamp;

  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');

  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalPath(request.url.pathname),
    canonicalQuery(request.url.search),
    `${names.map((name) => `${name}:${collapse(headers[name]!)}`).join('\n')}\n`,
    signedHeaders,
    request.payloadHash ?? EMPTY_PAYLOAD_SHA256,
  ].join('\n');

  const day = timestamp.slice(0, 8);
  const credentialScope = `${day}/${scope.region}/${scope.service}/aws4_request`;
  const stringToSign = [ALGORITHM, timestamp, credentialScope, sha256Hex(canonicalRequest)].join(
    '\n',
  );

  const signature = hmac(
    signingKey(credentials.secretAccessKey, day, scope.region, scope.service),
    stringToSign,
  ).toString('hex');

  headers.authorization =
    `${ALGORITHM} Credential=${credentials.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { headers, canonicalRequest, stringToSign, signature };
}
