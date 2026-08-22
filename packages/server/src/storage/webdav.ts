import type { StorageConnection, StorageConnectionRepo } from './connections.js';
import {
  StorageNotConfiguredError,
  StorageNotConnectedError,
  StorageRevokedError,
  StorageUnavailableError,
  type StorageEntry,
  type StorageKind,
  type StoragePage,
  type StorageProbe,
  type StorageProvider,
} from './provider.js';
import { child, childText, findAll, parseXml, type XmlElement } from './xml.js';

/**
 * The five properties a listing needs, and no more.
 *
 * `allprop` is the alternative and is deliberately not used: Nextcloud answers it with
 * some thirty properties per entry — share state, comment counts, tags — which on a
 * folder of ten thousand photos is several megabytes of XML nobody reads. The default
 * `DAV:` namespace rather than a `d:` prefix keeps the request readable; a server that
 * cares about the prefix is not a server that speaks RFC 4918.
 */
const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:">
  <prop>
    <getcontenttype/>
    <getcontentlength/>
    <getlastmodified/>
    <getetag/>
    <resourcetype/>
  </prop>
</propfind>`;

/**
 * Content-download timeout in milliseconds, for the same reason as in `drive.ts`:
 * without one, `fetch` inherits undici's five-minute default while holding a
 * render-limiter slot, and two stalled downloads freeze every render for that long.
 */
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** A listing is metadata: it either arrives quickly or the server is not answering. */
const LISTING_TIMEOUT_MS = 30_000;

/** How long the client is asked to wait before retrying after a transient failure. */
const RETRY_AFTER_SECONDS = 5;

/** Beyond this, a `Retry-After` is a server asking to be left alone for the day. */
const RETRY_AFTER_MAX_SECONDS = 300;

/** What a folder carries in place of a date nobody asked it for. */
const UNDATED = new Date(0).toISOString();

const NOT_CONNECTED =
  'This WebDAV connection has no username and app password. Set them from /admin.';

const REFUSED = 'The WebDAV server refused the username and app password. Update them from /admin.';

/**
 * MIME types by extension, for the servers that do not state one.
 *
 * Nextcloud always answers `getcontenttype`; an Apache `mod_dav` answers it from
 * `mime.types`, which on most distributions still has no entry for HEIC or for the
 * newer video containers. Without this fallback those files arrive with a null type,
 * `classify()` ignores them, and the album silently lacks every photo taken by a
 * recent iPhone — a failure with no error anywhere to explain it.
 */
const TYPES_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  dng: 'image/x-adobe-dng',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
};

/** The username and app password, as they are stored inside the one encrypted string. */
interface WebdavCredentials {
  username: string;
  password: string;
}

/**
 * A WebDAV server — Nextcloud, ownCloud, an Apache `mod_dav`, a Synology — behind the
 * storage interface.
 *
 * The three operations map onto two HTTP methods: a `PROPFIND` with `Depth: 1` for
 * `list()`, a ranged `GET` for `fetch()`, and nothing at all for `preview()`. What
 * makes the implementation longer than that sentence is the href: a `<d:response>`
 * names its resource with a percent-encoded URL that may be absolute or root-relative,
 * and that Nextcloud prefixes with `remote.php/dav/files/<user>`. Turning it back into
 * a path this application can store and ask for again is the whole of `hrefToRef`
 * (D260816f).
 */
/**
 * A live WebDAV provider, or a refusal naming which of the two states it is in.
 *
 * The factory refuses rather than the constructor, for the same reason `s3.ts` does:
 * `StorageRegistry.isConnected` asks whether a connection is usable by trying to build
 * one and watching for a throw. A service that constructs unconditionally answers "yes"
 * for a connection with no password stored and for one the server has already rejected,
 * and prewarming, transcoding and the startup sync all gate on that answer — they would
 * traverse the album file by file, re-presenting a password already refused (D61).
 */
export function webdavFromConnection(
  connection: StorageConnection,
  connections: StorageConnectionRepo,
  log: { info: (msg: string) => void; warn: (msg: string) => void },
): WebdavService {
  if (!connection.ciphertext) {
    throw new StorageNotConnectedError(
      `The WebDAV connection "${connection.label}" has no password stored. Enter one from /admin.`,
    );
  }
  if (connection.revokedAt !== null) {
    throw new StorageRevokedError(
      `The server refused the stored app password for "${connection.label}". ` +
        'Enter a new one from /admin.',
    );
  }

  return new WebdavService(connections, connection.id, log);
}

export class WebdavService implements StorageProvider {
  readonly kind: StorageKind = 'webdav';
  /**
   * A WebDAV resource is named by where it is, and nothing else: renaming a file gives
   * it a new reference, and two connections may hold the same one. The index therefore
   * hashes it with the connection and keeps the location in `media.source_path`.
   */
  readonly refKind = 'path' as const;

  constructor(
    private readonly connections: StorageConnectionRepo,
    /** Which row of `storage_connections` this instance reads. */
    readonly connectionId: string,
    private readonly log: { info: (msg: string) => void; warn: (msg: string) => void },
  ) {}

  /**
   * Does this server answer, and does it accept these credentials?
   *
   * A `PROPFIND` with `Depth: 0` on the configured root proves all three things /admin
   * needs at once — the host resolves, the password is accepted, and the URL is a
   * WebDAV collection rather than a web page that happens to exist. Each failure is
   * reported in its own words, because "it did not work" sends an administrator to
   * check the password when the host name is what is wrong.
   */
  async probe(): Promise<StorageProbe> {
    let base: URL;
    let account: string | null = null;
    let credentials: WebdavCredentials;

    try {
      base = this.base();
      credentials = this.credentials();
      account = `${credentials.username}@${base.host}`;
    } catch (error) {
      return { ok: false, account, error: (error as Error).message };
    }

    let response: Response;
    try {
      response = await this.request(
        'PROPFIND',
        base,
        { Depth: '0' },
        LISTING_TIMEOUT_MS,
        undefined,
        credentials,
      );
    } catch (error) {
      return { ok: false, account, error: unreachable(error, base) };
    }

    await response.body?.cancel();
    if (response.status === 207) return { ok: true, account, error: null };
    return { ok: false, account, error: refusalOf(response.status, base) };
  }

  /**
   * One collection's direct children, folders included.
   *
   * `cursor` is always `null` on the way out, and the parameter exists only because the
   * interface has one: RFC 4918 has no continuation token, so a `Depth: 1` request
   * answers with the entire collection or with nothing. The bound on a runaway tree is
   * therefore `MAX_FOLDERS` in `sync/sync.ts` rather than anything negotiated here
   * (D260816f).
   */
  async list(container: string, _cursor: string | null): Promise<StoragePage> {
    const base = this.base();
    const url = this.collectionUrl(base, container);
    const roots = pathSegments(base.pathname);

    const response = await this.send('PROPFIND', url, { Depth: '1' }, LISTING_TIMEOUT_MS);
    if (response.status !== 207) throw await this.failure(response, container || '/');

    const document = parseXml(await response.text());
    const own = safeSegments(container).join('/');

    const entries: StorageEntry[] = [];
    for (const element of findAll(document, 'response')) {
      const entry = toEntry(element, url, roots, own);
      if (entry) entries.push(entry);
    }
    return { entries, cursor: null };
  }

  /**
   * Bytes, with the browser's `Range` relayed verbatim.
   *
   * A **416 is returned rather than thrown**: it is the server's answer to a range the
   * file cannot satisfy, and the browser knows what to do with it. Turning it into an
   * exception would produce a 503 that says "try again", for a request that will fail
   * identically forever.
   */
  async fetch(ref: string, range?: string, signal?: AbortSignal): Promise<Response> {
    const url = this.resourceUrl(this.base(), ref);
    const headers: Record<string, string> = range ? { Range: range } : {};

    // **No timeout on a `Range` request.** This relays video to the browser, which
    // consumes it at its own pace: a total timeout would interrupt playback rather than
    // catch a failure. Every other caller reads a whole file and wants the bound.
    const response = await this.send(
      'GET',
      url,
      headers,
      range ? null : DOWNLOAD_TIMEOUT_MS,
      signal,
    );

    if (response.ok || response.status === 206 || response.status === 416) return response;
    throw await this.failure(response, ref);
  }

  /**
   * Always `null`: WebDAV has no thumbnail property.
   *
   * Nextcloud does hold previews and serves them from `/index.php/core/preview`, which
   * is not WebDAV and exists on no other server — implementing it here would make one
   * product's private route part of a protocol backend. Video posters come from ffmpeg
   * instead (D92), and a HEIC or RAW file sharp cannot decode has no preview, which
   * is a documented limit rather than a defect.
   */
  async preview(): Promise<Response | null> {
    return null;
  }

  /**
   * Runs an operation, recording that the server has stopped accepting the credentials.
   *
   * The translation from status to error happens where the response is read; what only
   * this method can do is date `revoked_at`, and only for the secret whose refusal was
   * actually observed — an app password replaced while a request was in flight must not
   * be marked revoked by that request's failure.
   */
  async guard<T>(operation: () => Promise<T>): Promise<T> {
    const used = this.connections.get(this.connectionId)?.ciphertext ?? null;

    try {
      return await operation();
    } catch (error) {
      if (error instanceof StorageRevokedError) this.markRevoked(used);
      throw error;
    }
  }

  /* ------------------------------------------------------------------- internal */

  private markRevoked(used: string | null): void {
    const row = this.connections.get(this.connectionId);
    if (!row?.ciphertext || row.revokedAt !== null) return;

    if (!this.connections.markRevoked(this.connectionId, used)) {
      this.log.warn(
        'The WebDAV server rejected credentials that are no longer the stored ones: ' +
          'they were replaced during the request, so the connection is left intact.',
      );
      return;
    }

    this.log.warn(`The WebDAV server rejected the credentials of "${this.connectionId}" (401).`);
  }

  /**
   * The collection every reference is relative to, always ending in a slash.
   *
   * Rebuilt from decoded segments rather than used as typed, so that the root an
   * administrator writes as plain text and the path already inside the URL are encoded
   * the same way. A query string, a fragment and any `user:password@` the URL carries
   * are dropped: none of them belong in a collection path, and the last would put a
   * password into every log line naming this URL.
   */
  private base(): URL {
    const settings = this.connections.get(this.connectionId)?.settings ?? {};
    const declared = typeof settings.url === 'string' ? settings.url.trim() : '';
    if (declared.length === 0) {
      throw new StorageNotConfiguredError(
        'This WebDAV connection has no base URL. Set it from /admin — for Nextcloud it ' +
          'ends in /remote.php/dav/files/<username>.',
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(declared);
    } catch {
      throw new StorageNotConfiguredError(
        `"${declared}" is not a URL. It must start with https://.`,
      );
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new StorageNotConfiguredError(
        `"${declared}" is not an http(s) URL. A WebDAV endpoint is reached over HTTP.`,
      );
    }

    const root = typeof settings.root === 'string' ? settings.root : '';
    const segments = [...pathSegments(parsed.pathname), ...safeSegments(root)];
    const path = segments.map(encodeURIComponent).join('/');
    return new URL(`${parsed.origin}/${path}${path.length > 0 ? '/' : ''}`);
  }

  /**
   * The URL of a collection, **with its trailing slash**. Many servers answer a
   * collection requested without one with a 301, and a redirect loses the `PROPFIND`
   * body — the listing then comes back as an unexplained 400.
   */
  private collectionUrl(base: URL, ref: string): URL {
    const path = safeSegments(ref).map(encodeURIComponent).join('/');
    return new URL(path.length > 0 ? `${base.href}${path}/` : base.href);
  }

  /** The URL of a file. Percent-encoding happens here and nowhere else. */
  private resourceUrl(base: URL, ref: string): URL {
    const path = safeSegments(ref).map(encodeURIComponent).join('/');
    if (path.length === 0) {
      throw new StorageNotConfiguredError('A WebDAV file reference cannot be empty.');
    }
    return new URL(`${base.href}${path}`);
  }

  /**
   * The username and app password, decrypted.
   *
   * Stored as JSON in the one encrypted string a connection has, because
   * `StorageConnectionRepo` encrypts a string and deliberately knows nothing about what
   * a kind puts in it. A `StorageKeyMismatchError` from the repository passes straight
   * through: a mistyped `TOKEN_KEY` and "never connected" are opposite states (D14).
   */
  private credentials(): WebdavCredentials {
    const secret = this.connections.secret(this.connectionId);
    if (!secret) throw new StorageNotConnectedError(NOT_CONNECTED);

    let parsed: unknown;
    try {
      parsed = JSON.parse(secret);
    } catch {
      throw new StorageNotConnectedError(NOT_CONNECTED);
    }

    const candidate = parsed as Partial<WebdavCredentials> | null;
    if (typeof candidate?.username !== 'string' || typeof candidate.password !== 'string') {
      throw new StorageNotConnectedError(NOT_CONNECTED);
    }
    return { username: candidate.username, password: candidate.password };
  }

  /**
   * One request, with network failures already translated.
   *
   * `send` is what every operation calls; `request` underneath it reports a refused
   * connection as it happened, which is what `probe()` needs to name the real problem
   * instead of "try again in a moment".
   */
  private async send(
    method: string,
    url: URL,
    headers: Record<string, string>,
    timeoutMs: number | null,
    signal?: AbortSignal,
  ): Promise<Response> {
    // **Outside the try, deliberately.** `credentials()` reports two permanent states —
    // no secret stored, and a `TOKEN_KEY` that cannot decrypt the one that is — and
    // rewriting either into `StorageUnavailableError` would answer 503 with a
    // `Retry-After` forever for something no amount of retrying fixes. The route and
    // /admin tell "will recover on its own" from "needs reconfiguration" by exactly
    // that distinction (D14). Only the network call below is transient.
    const credentials = this.credentials();

    try {
      return await this.request(method, url, headers, timeoutMs, signal, credentials);
    } catch (error) {
      throw new StorageUnavailableError(
        url.pathname,
        RETRY_AFTER_SECONDS,
        networkCause(error) ?? 'network failure',
      );
    }
  }

  private async request(
    method: string,
    url: URL,
    headers: Record<string, string>,
    timeoutMs: number | null,
    signal: AbortSignal | undefined,
    credentials: { username: string; password: string },
  ): Promise<Response> {
    const { username, password } = credentials;
    const authorization = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');

    // Both signals matter and neither subsumes the other: the caller aborts when the
    // browser walks away, the timeout when the server stops answering.
    const signals: AbortSignal[] = [];
    if (signal) signals.push(signal);
    if (timeoutMs !== null) signals.push(AbortSignal.timeout(timeoutMs));

    const listing = method === 'PROPFIND';

    return fetch(url, {
      method,
      headers: {
        ...headers,
        Authorization: `Basic ${authorization}`,
        ...(listing ? { 'Content-Type': 'application/xml; charset=utf-8' } : {}),
      },
      body: listing ? PROPFIND_BODY : undefined,
      signal: signals.length > 0 ? AbortSignal.any(signals) : undefined,
    });
  }

  /**
   * The refusal, as the taxonomy expresses it. Reads the body, so the response is spent
   * afterwards — every caller throws what this returns.
   */
  private async failure(response: Response, label: string): Promise<Error> {
    if (response.status === 401) {
      await response.body?.cancel();
      return new StorageRevokedError(REFUSED);
    }

    // A 429 and a 5xx say the same thing — not now — and the client must be told to
    // retry rather than shown a 500 that makes it give up.
    if (response.status === 429 || response.status >= 500) {
      const after = retryAfterSeconds(response.headers.get('retry-after'));
      await response.body?.cancel();
      return new StorageUnavailableError(label, after, `WebDAV ${response.status}`);
    }

    const body = await response.text().catch(() => '');
    return new Error(
      `The WebDAV server answered ${response.status} for ${label}: ${body.slice(0, 200)}`,
    );
  }
}

/**
 * One `<response>` of a multistatus, or `null` for anything the index cannot address.
 *
 * `own` is the container's own reference: a `Depth: 1` request answers with the
 * collection **and** its children, and keeping the collection would make `sync/sync.ts`
 * queue it again for ever.
 */
function toEntry(
  element: XmlElement,
  container: URL,
  roots: string[],
  own: string,
): StorageEntry | null {
  const href = childText(element, 'href');
  if (!href) return null;

  const ref = hrefToRef(href, container, roots);
  if (ref === null || ref === own) return null;

  // A collection is told apart by what `resourcetype` **contains**: every entry carries
  // the element, and a file's is simply empty.
  const folder = findAll([element], 'resourcetype').some(
    (type) => child(type, 'collection') !== null,
  );

  const modified = property(element, 'getlastmodified');
  const at = modified ? new Date(modified) : null;
  const time = at && !Number.isNaN(at.getTime()) ? at.toISOString() : null;
  // Same rule as Drive: a file whose date is unreadable has nothing to order it by, and
  // a folder never needed one — dropping a folder would hide everything below it.
  if (!folder && time === null) return null;

  const name = ref.slice(ref.lastIndexOf('/') + 1);
  // `Number(null)` is 0, and a folder states no length: without this the index would
  // record every folder as an empty file.
  const length = property(element, 'getcontentlength');
  const size = length === null ? null : Number(length);

  return {
    ref,
    name,
    folder,
    mimeType: property(element, 'getcontenttype')?.split(';')[0]?.trim() || guessType(name),
    size: size !== null && Number.isFinite(size) && size >= 0 ? size : null,
    modifiedTime: time ?? UNDATED,
    version: etag(property(element, 'getetag')),
    // No WebDAV property carries EXIF data, so the indexer reads it from the bytes.
    media: null,
    hasPreview: false,
  };
}

/**
 * The first non-empty value of a property anywhere under a `<response>`.
 *
 * A server answers with one `<propstat>` per status: the properties it found under a
 * 200, the ones it does not have under a 404. Reading by name across both, rather than
 * by path into the first, is what lets the same code read a Nextcloud and a `mod_dav`.
 */
function property(element: XmlElement, name: string): string | null {
  for (const found of findAll([element], name)) {
    const text = found.text.trim();
    if (text.length > 0) return text;
  }
  return null;
}

/**
 * An ETag reduced to what can travel in a header.
 *
 * `routes/media.ts` builds `"<mediaId>-<version>-<variant>"`, so a version still
 * carrying the quotes a WebDAV server puts around its ETag would produce a malformed
 * `ETag` response header — and browsers answer a malformed validator by never
 * revalidating. The weak prefix goes for the same reason it exists: it says the bytes
 * may differ, which is exactly what this value is asked to promise.
 */
function etag(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/^W\//i, '').replace(/"/g, '').trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** The MIME type a name implies, for a server that stated none. */
function guessType(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return null;
  return TYPES_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * The href of a `<response>`, as a path relative to the connection's root.
 *
 * `null` when it names something outside that root — a server that answered about a
 * resource nobody asked for. See D260816f for why the comparison happens on decoded
 * segments and ignores the host.
 */
function hrefToRef(href: string, container: URL, roots: string[]): string | null {
  let resolved: URL;
  try {
    resolved = new URL(href, container);
  } catch {
    return null;
  }

  const segments = pathSegments(resolved.pathname);
  if (segments.length < roots.length) return null;
  for (let index = 0; index < roots.length; index++) {
    if (segments[index] !== roots[index]) return null;
  }
  return segments.slice(roots.length).join('/');
}

/**
 * Path segments, decoded.
 *
 * A name whose percent-encoding is malformed — a literal `%` a server failed to escape
 * — is kept exactly as it arrived rather than dropped, for the same reason `xml.ts`
 * keeps an unknown entity: a broken name is still findable, a missing one is not.
 */
function pathSegments(pathname: string): string[] {
  return pathname
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

/**
 * Segments of a path chosen by an administrator, refusing the two that leave the root.
 *
 * Neither `encodeURIComponent` nor the URL parser touches a dot, so a root or an album
 * folder written as `photos/../../etc` would resolve above the collection this
 * connection is fenced to. Refusing is the only safe answer: silently rewriting it
 * would serve a directory nobody named.
 */
function safeSegments(path: string): string[] {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new StorageNotConfiguredError(
        `A WebDAV path cannot contain "${segment}": "${path}" would leave the configured root.`,
      );
    }
  }
  return segments;
}

/** `Retry-After` in seconds, bounded: a server may name a delay nobody will wait. */
function retryAfterSeconds(header: string | null): number {
  const announced = Number(header);
  if (!Number.isFinite(announced) || announced <= 0) return RETRY_AFTER_SECONDS;
  return Math.min(Math.round(announced), RETRY_AFTER_MAX_SECONDS);
}

/**
 * Why a request never reached the server, in the words the system used.
 *
 * undici wraps the real cause, and that cause is the useful half: `ENOTFOUND` sends an
 * administrator to the host name, `ECONNREFUSED` to the port, and a certificate error
 * to the certificate — three different afternoons.
 */
function networkCause(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (error.name === 'TimeoutError') return 'timed out';
  if (error.name === 'AbortError') return 'aborted';
  const code = systemCode(error.cause);
  if (code) return code;

  // undici's own message is "fetch failed", which names nothing. What it wrapped —
  // "bad port", a TLS refusal — is the half worth showing an administrator.
  const cause = error.cause;
  if (cause instanceof Error && cause.message.length > 0) return cause.message;
  return error.message.length > 0 ? error.message : null;
}

/**
 * The `errno` code, however deep undici buried it.
 *
 * A host resolving to several addresses fails as an `AggregateError` holding one error
 * per address, and its own `code` is not always set — which is how `ECONNREFUSED`
 * becomes the useless "fetch failed" if only the outer error is read. The depth bound
 * is there because `cause` chains are not guaranteed to be acyclic.
 */
function systemCode(cause: unknown, depth = 0): string | null {
  if (!cause || typeof cause !== 'object' || depth > 4) return null;

  const code = (cause as { code?: unknown }).code;
  if (typeof code === 'string') return code;

  const inner = (cause as { errors?: unknown }).errors;
  if (Array.isArray(inner)) {
    for (const candidate of inner) {
      const found = systemCode(candidate, depth + 1);
      if (found) return found;
    }
  }
  return systemCode((cause as { cause?: unknown }).cause, depth + 1);
}

/** What /admin shows when the server was never reached at all. */
function unreachable(error: unknown, base: URL): string {
  const cause = networkCause(error);
  return (
    `${base.host} could not be reached${cause ? ` (${cause})` : ''}. Check the base URL, ` +
    'and that this instance is allowed to open a connection to it.'
  );
}

/**
 * What /admin shows when the server answered something other than a multistatus.
 *
 * The three answers worth telling apart are a refused password, a URL that exists but
 * is not a collection, and a host that speaks HTTP but not WebDAV. An administrator
 * given "it did not work" checks the password first, which is right one time in three.
 */
function refusalOf(status: number, base: URL): string {
  if (status === 401) return REFUSED;
  if (status === 403) {
    return `${base.host} accepted the credentials but refuses ${base.pathname}. The account may not have access to that folder.`;
  }
  if (status === 404) {
    return `There is nothing at ${base.pathname} on ${base.host}. Check the base URL and the root folder.`;
  }
  if (status === 405 || status === 501) {
    return `${base.host} answered ${status} to a PROPFIND: this URL is not a WebDAV endpoint. For Nextcloud it ends in /remote.php/dav/files/<username>.`;
  }
  if (status === 200) {
    return `${base.pathname} answered as an ordinary web page rather than a WebDAV collection. Check the base URL.`;
  }
  return `${base.host} answered ${status} to a PROPFIND.`;
}
