/**
 * An S3-compatible bucket as a `StorageProvider`.
 *
 * "S3-compatible" rather than "Amazon S3": MinIO, Garage, Ceph, Backblaze and Scaleway
 * all speak the same three calls, and nothing here is specific to Amazon beyond the
 * signature. The requests are signed by hand (`storage/sigv4.ts`) and the listings read
 * by the shared element reader (`storage/xml.ts`), so this backend adds no dependency
 * at all (D260816e).
 */
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
import { EMPTY_PAYLOAD_SHA256, signRequest, uriEncode, type SigningCredentials } from './sigv4.js';
import { childText, findAll, parseXml } from './xml.js';

/** The service name the signature is scoped to. Every S3 implementation uses it. */
const SERVICE = 's3';

/** The most keys one `ListObjectsV2` may return, and what this asks for. */
const PAGE_SIZE = 1000;

/** How long the client is asked to wait before retrying a transient failure. */
const RETRY_AFTER_SECONDS = 5;

/**
 * Content-download timeout in milliseconds, for the same reason as in `storage/drive.ts`:
 * without one, `fetch` inherits undici's five-minute default while holding a render
 * limiter slot, and two stalled downloads freeze every render for that long.
 */
const DOWNLOAD_TIMEOUT_MS = 120_000;

const NOT_CONNECTED = 'This bucket has no key pair. Add its access key and secret key from /admin.';

/**
 * The `<Code>` values that mean "these credentials are not accepted", as opposed to the
 * other things a bucket answers 403 to.
 *
 * The distinction decides whether the whole connection is marked revoked: a clock too
 * far out of step also returns 403, and treating it as a withdrawn authorisation would
 * send an administrator looking for a key that was never wrong.
 */
const CREDENTIAL_CODES = new Set([
  'AccessDenied',
  'AccountProblem',
  'AllAccessDisabled',
  'ExpiredToken',
  'InvalidAccessKeyId',
  'InvalidToken',
  'SignatureDoesNotMatch',
]);

/**
 * Extension to MIME type, because a listing carries neither.
 *
 * `ListObjectsV2` returns a key, a size and an ETag — never a content type, which is
 * stored per object and would cost one `HEAD` each. The extension is what is left, and
 * it is what the browser would use anyway.
 *
 * **The table is the filter.** Anything absent gets `null`, which `classify` turns into
 * "not media" and the indexer skips. RAW is deliberately absent: no backend but Drive
 * holds a preview for one, sharp cannot decode most of them, and an album of tiles that
 * can never load is a worse answer than an album that says a bucket held nothing it
 * could show.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
  '3gp': 'video/3gpp',
  avi: 'video/x-msvideo',
  m4v: 'video/x-m4v',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

/** Everything a connection must state before a bucket can be read. */
export interface S3Settings {
  /** Scheme and host of the service, without a path: `https://s3.eu-west-3.amazonaws.com`. */
  endpoint: string;
  region: string;
  bucket: string;
  /** A key prefix every reference is relative to, empty or ending in `/`. */
  prefix: string;
  /**
   * `https://host/bucket/key` instead of `https://bucket.host/key`.
   *
   * MinIO and every bucket whose name is not a legal DNS label need it, and a
   * self-signed certificate cannot cover the wildcard the other form requires.
   */
  pathStyle: boolean;
}

/** What names this connection to a person: the bucket, and where it lives. */
function accountOf(settings: S3Settings): string {
  return `${settings.bucket} (${new URL(settings.endpoint).host})`;
}

function setting(connection: StorageConnection, key: string): string | null {
  const value = connection.settings[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Settings as this backend needs them, or a refusal naming what is missing.
 *
 * Validated at construction rather than at the first listing: a connection nothing can
 * be built from reports "not connected" in /admin, where an album that silently stays
 * empty explains nothing.
 */
export function s3SettingsFrom(connection: StorageConnection): S3Settings {
  const endpoint = setting(connection, 'endpoint');
  const bucket = setting(connection, 'bucket');
  if (!endpoint || !bucket) {
    throw new StorageNotConfiguredError(
      `The storage "${connection.id}" needs an endpoint and a bucket. Add them from /admin.`,
    );
  }

  let origin: string;
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('scheme');
    // The origin alone: a path under it would have to be threaded through every key
    // join, and no S3 implementation this targets is served from one.
    origin = parsed.origin;
  } catch {
    throw new StorageNotConfiguredError(
      `The endpoint of "${connection.id}" is not an http(s) address: ${endpoint}`,
    );
  }

  const prefix = setting(connection, 'prefix') ?? '';

  return {
    endpoint: origin,
    // Amazon requires a real one; MinIO ignores it but still signs with it, so the two
    // ends have to agree on *something* rather than on nothing.
    region: setting(connection, 'region') ?? 'us-east-1',
    bucket,
    prefix: prefix.length === 0 ? '' : `${prefix.replace(/^\/+|\/+$/g, '')}/`,
    pathStyle: setting(connection, 'pathStyle') === 'true',
  };
}

/**
 * The provider for a connection, or a refusal explaining why there is none.
 *
 * Built here rather than in `storage/registry.ts` so that everything this backend knows
 * about a connection row stays in one file. A missing key pair or a recorded revocation
 * refuses immediately, which is what makes `StorageRegistry.isConnected` answer "no"
 * and keeps the sync from failing object by object (D61).
 */
export function s3FromConnection(
  connection: StorageConnection,
  connections: StorageConnectionRepo,
  log: { warn: (msg: string) => void },
): S3Service {
  const settings = s3SettingsFrom(connection);
  if (!connection.ciphertext) throw new StorageNotConnectedError(NOT_CONNECTED);
  if (connection.revokedAt !== null) {
    throw new StorageRevokedError(
      `The bucket "${settings.bucket}" refused the stored key pair. Enter a new one from /admin.`,
    );
  }

  return new S3Service(settings, connections, connection.id, log);
}

export class S3Service implements StorageProvider {
  readonly kind: StorageKind = 's3';
  /**
   * An object key **is** its location: renaming a file gives it another one, and two
   * buckets may hold the same key. The index therefore hashes it with the connection
   * and keeps the key in `media.source_path`.
   */
  readonly refKind = 'path' as const;

  constructor(
    readonly settings: S3Settings,
    private readonly connections: StorageConnectionRepo,
    /** Which row of `storage_connections` holds this bucket's key pair. */
    readonly connectionId: string,
    private readonly log: { warn: (msg: string) => void },
  ) {}

  /**
   * Does the bucket answer, and if not, in what way?
   *
   * A listing bounded to one key: the cheapest call that reaches all three failures an
   * administrator confuses — a key pair the bucket refuses, a host that is not there,
   * and a bucket name that is not either. Each of them reads differently below, which
   * is the whole point of the button in /admin.
   */
  async probe(): Promise<StorageProbe> {
    const account = accountOf(this.settings);
    try {
      const response = await this.send(
        'GET',
        this.url('', { 'list-type': '2', 'max-keys': '1' }),
        `the bucket "${this.settings.bucket}"`,
      );
      await response.body?.cancel();
      return { ok: true, account, error: null };
    } catch (error) {
      return { ok: false, account, error: (error as Error).message };
    }
  }

  /**
   * One page of a container's direct children.
   *
   * `delimiter=/` is what turns a flat key space into folders: the keys sharing a
   * segment collapse into `<CommonPrefixes>`, which is the only reason a recursive
   * album does not read every object in the bucket to find its subfolders.
   */
  async list(container: string, cursor: string | null): Promise<StoragePage> {
    const prefix = this.prefixOf(container);
    const query: Record<string, string> = {
      'list-type': '2',
      delimiter: '/',
      'max-keys': String(PAGE_SIZE),
    };
    if (prefix.length > 0) query.prefix = prefix;
    if (cursor) query['continuation-token'] = cursor;

    const response = await this.send(
      'GET',
      this.url('', query),
      `the listing of "${prefix || '/'}"`,
    );
    const roots = parseXml(await response.text());

    const entries: StorageEntry[] = [];

    for (const group of findAll(roots, 'CommonPrefixes')) {
      const key = childText(group, 'Prefix');
      if (!key || key === prefix) continue;
      entries.push({
        ref: this.refOf(key),
        name: lastSegment(key),
        folder: true,
        mimeType: null,
        size: null,
        modifiedTime: UNDATED,
        version: null,
        media: null,
        hasPreview: false,
      });
    }

    for (const contents of findAll(roots, 'Contents')) {
      const key = childText(contents, 'Key');
      // A key ending in `/` is the zero-byte object some clients write to make a folder
      // visible. It is the container itself, not something in it.
      if (!key || key.endsWith('/')) continue;

      entries.push({
        ref: this.refOf(key),
        name: lastSegment(key),
        folder: false,
        mimeType: mimeOf(key),
        size: toSize(childText(contents, 'Size')),
        modifiedTime: toInstant(childText(contents, 'LastModified')),
        version: toVersion(childText(contents, 'ETag')),
        // A bucket stores bytes and nothing else: no parsed EXIF data, and no preview
        // to fall back on. Both nulls are read by the indexer and the renderer as
        // "work it out from the file".
        media: null,
        hasPreview: false,
      });
    }

    const truncated = childText(roots[0] ?? EMPTY_ELEMENT, 'IsTruncated') === 'true';
    const next = childText(roots[0] ?? EMPTY_ELEMENT, 'NextContinuationToken');

    // The token decides, not the flag: a server that truncates without one would
    // otherwise be asked for the same first page forever.
    return { entries, cursor: truncated ? next : null };
  }

  /**
   * Object bytes, with the browser's `Range` signed rather than merely forwarded.
   *
   * **The range is part of the signature.** An S3 backend verifies every signed header,
   * so a range left out of `SignedHeaders` — or signed as a different value — is
   * refused outright, and the failure surfaces as a video that will not seek on exactly
   * the large files seeking exists for.
   */
  async fetch(ref: string, range?: string, signal?: AbortSignal): Promise<Response> {
    return this.send('GET', this.url(this.keyOf(ref)), `"${ref}"`, { range, signal });
  }

  /**
   * A bucket holds no preview: it stores the bytes it was given and nothing beside
   * them. The renderer reads this `null` and produces its own.
   */
  async preview(): Promise<Response | null> {
    return null;
  }

  /**
   * Runs an operation, recording a key pair the bucket has stopped accepting.
   *
   * The translation from status to error happens in `send`, where the response body is
   * still readable; what is left here is the one decision that outlives the request —
   * whether this connection should stop being asked at all.
   */
  async guard<T>(operation: () => Promise<T>): Promise<T> {
    // The key pair in place when the call starts. A request may still be in flight when
    // a new one is entered in /admin: without this snapshot, its failure would mark the
    // replacement revoked and ask for the correction just made.
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
    if (!this.connections.markRevoked(this.connectionId, used)) {
      this.log.warn(
        `The bucket "${this.settings.bucket}" rejected a key pair that is no longer the ` +
          'stored one: it was replaced during the request, so the new one is left intact.',
      );
      return;
    }

    this.log.warn(
      `The bucket "${this.settings.bucket}" rejected the stored key pair. Enter a new ` +
        'one from /admin.',
    );
  }

  /** The bucket key for a reference the index holds, under the connection's prefix. */
  private keyOf(ref: string): string {
    return `${this.settings.prefix}${ref.replace(/^\/+/, '')}`;
  }

  /** The reference the index keeps for a key: what is left once the prefix is removed. */
  private refOf(key: string): string {
    return key.startsWith(this.settings.prefix) ? key.slice(this.settings.prefix.length) : key;
  }

  /** The `prefix` parameter listing this container's children, always closed by `/`. */
  private prefixOf(container: string): string {
    const key = this.keyOf(container);
    if (key.length === 0) return '';
    return key.endsWith('/') ? key : `${key}/`;
  }

  /**
   * The URL of a key, in whichever addressing style the connection declared.
   *
   * The query is assembled by hand rather than by `URLSearchParams`, which encodes a
   * space as `+` where the signature requires `%20`: the two would disagree on any
   * prefix containing one, and only on those — the kind of failure that survives every
   * test written against a tidy bucket.
   */
  private url(key: string, query?: Record<string, string>): URL {
    const path = key.length === 0 ? '' : `/${encodeKey(key)}`;
    const base = this.settings.pathStyle
      ? `${this.settings.endpoint}/${this.settings.bucket}${path}`
      : withSubdomain(this.settings.endpoint, this.settings.bucket) +
        (path.length > 0 ? path : '/');

    const search = query
      ? Object.entries(query)
          .map(([name, value]) => `${uriEncode(name)}=${uriEncode(value)}`)
          .join('&')
      : '';

    return new URL(search.length > 0 ? `${base}?${search}` : base);
  }

  /** The decrypted key pair, or a refusal saying which of the two states applies. */
  private credentials(): SigningCredentials {
    // Raises `StorageKeyMismatchError` when TOKEN_KEY no longer decrypts it, which is a
    // different thing from never having been given a key pair — and the reason the row
    // is kept rather than cleared (D14).
    const secret = this.connections.secret(this.connectionId);
    if (!secret) throw new StorageNotConnectedError(NOT_CONNECTED);

    let parsed: unknown;
    try {
      parsed = JSON.parse(secret);
    } catch {
      parsed = null;
    }

    const pair = parsed as { accessKeyId?: unknown; secretAccessKey?: unknown } | null;
    if (typeof pair?.accessKeyId !== 'string' || typeof pair.secretAccessKey !== 'string') {
      throw new StorageNotConnectedError(
        `The key pair stored for "${this.connectionId}" is not readable. Enter it again from /admin.`,
      );
    }

    return { accessKeyId: pair.accessKeyId, secretAccessKey: pair.secretAccessKey };
  }

  /**
   * One signed request, with the failures translated on the way back.
   *
   * `protected` for the same reason as `DriveService.accessToken`: it is this class's
   * only contact with the network, and the tests point it at a local stub rather than
   * at a bucket.
   */
  protected async send(
    method: string,
    url: URL,
    label: string,
    options: { range?: string; signal?: AbortSignal } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { 'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256 };
    if (options.range) headers.range = options.range;

    const signed = signRequest({ method, url, headers }, this.credentials(), {
      region: this.settings.region,
      service: SERVICE,
      signedAt: new Date(),
    });

    const response = await this.transmit(method, url, signed.headers, label, options);
    if (response.ok || response.status === 206 || response.status === 416) return response;

    const body = await response.text().catch(() => '');
    throw this.translate(response, body, label);
  }

  /** The `fetch` itself, with the timeout that must not apply while relaying video. */
  private async transmit(
    method: string,
    url: URL,
    headers: Record<string, string>,
    label: string,
    options: { range?: string; signal?: AbortSignal },
  ): Promise<Response> {
    // **No total timeout on a `Range` request.** It relays video to a browser that
    // consumes it at its own pace, and a deadline would cut playback rather than a
    // failure. Callers reading a fixed window supply their own signal.
    const timeout = options.range ? null : AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    const signals = [options.signal, timeout].filter(
      (signal) => signal !== null && signal !== undefined,
    );

    try {
      return await fetch(url, {
        method,
        headers,
        signal: signals.length > 0 ? AbortSignal.any(signals) : undefined,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new StorageUnavailableError(label, RETRY_AFTER_SECONDS, 'timed out');
      }
      if (error instanceof Error && error.name === 'AbortError') throw error;

      // Everything undici cannot even send: a name that does not resolve, a refused
      // connection, a certificate nothing trusts. Naming the host is the difference
      // between "it does not work" and a typo an administrator can see.
      throw new StorageUnavailableError(
        label,
        RETRY_AFTER_SECONDS,
        `${url.host} could not be reached: ${causeOf(error)}`,
      );
    }
  }

  /** A refusal, as one of the shared error kinds, saying what the bucket actually said. */
  private translate(response: Response, body: string, label: string): Error {
    const code = childText(parseXml(body)[0] ?? EMPTY_ELEMENT, 'Code');
    const named = code ? ` (${code})` : '';

    if (response.status === 429 || response.status >= 500) {
      const announced = Number(response.headers.get('retry-after'));
      const wait =
        Number.isFinite(announced) && announced > 0 ? Math.min(announced, 60) : RETRY_AFTER_SECONDS;
      return new StorageUnavailableError(label, wait, `S3 answered ${response.status}${named}`);
    }

    if (response.status === 401 || response.status === 403) {
      // A 403 whose code is not about credentials is a different problem wearing the
      // same status — a clock too far out, most often — and marking the connection
      // revoked would hide it behind a key pair that was never wrong.
      if (code && !CREDENTIAL_CODES.has(code)) {
        return new Error(
          `The bucket "${this.settings.bucket}" refused ${label}${named}. ` +
            'This is not the key pair: check the container clock and the region.',
        );
      }
      return new StorageRevokedError(
        `The bucket "${this.settings.bucket}" refused the key pair${named}. ` +
          'Check the access key and secret key in /admin.',
      );
    }

    if (response.status === 404) {
      return new Error(
        code === 'NoSuchBucket'
          ? `No bucket named "${this.settings.bucket}" at ${this.settings.endpoint}.`
          : `${label} is not in the bucket "${this.settings.bucket}"${named}.`,
      );
    }

    return new Error(
      `The bucket "${this.settings.bucket}" answered ${response.status} for ${label}: ` +
        `${body.slice(0, 200)}`,
    );
  }
}

/* ---------------------------------------------------------------------- helpers */

/** What a folder carries in place of a date no listing supplies for it. */
const UNDATED = new Date(0).toISOString();

/** Stands in for a document that parsed to nothing, so readers need no null branch. */
const EMPTY_ELEMENT = { name: '', text: '', children: [] };

/** Each segment percent-encoded, the separators left alone. */
function encodeKey(key: string): string {
  return key.split('/').map(uriEncode).join('/');
}

/** `https://host` and `bucket` into `https://bucket.host`. */
function withSubdomain(endpoint: string, bucket: string): string {
  const url = new URL(endpoint);
  return `${url.protocol}//${bucket}.${url.host}`;
}

/** The name a person reads, from a key or a common prefix. */
function lastSegment(key: string): string {
  const trimmed = key.endsWith('/') ? key.slice(0, -1) : key;
  const slash = trimmed.lastIndexOf('/');
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

function mimeOf(key: string): string | null {
  const dot = key.lastIndexOf('.');
  if (dot === -1) return null;
  return MIME_BY_EXTENSION[key.slice(dot + 1).toLowerCase()] ?? null;
}

function toSize(value: string | null): number | null {
  const size = Number(value);
  return value !== null && Number.isFinite(size) ? size : null;
}

/**
 * `LastModified` as an instant.
 *
 * A listing that omits it is a proxy that mangled the response rather than a real
 * state; dating the object 1970 keeps it indexed, where dropping it would hide a photo
 * for a reason nobody could see. Its EXIF capture date replaces this as soon as the
 * file is read anyway.
 */
function toInstant(value: string | null): string {
  if (!value) return UNDATED;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? UNDATED : date.toISOString();
}

/**
 * The ETag, unquoted.
 *
 * It ends up inside the HTTP `ETag` this application serves — `"<id>-<version>-<variant>"`
 * — and the quotes S3 wraps it in would close that header two segments early.
 */
function toVersion(value: string | null): string | null {
  if (!value) return null;
  const bare = value.replace(/^W\//, '').replace(/^"|"$/g, '');
  return bare.length > 0 ? bare : null;
}

/** The most specific thing a failed `fetch` knows: undici hides the reason in `cause`. */
function causeOf(error: unknown): string {
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) return cause.message;
  return error instanceof Error ? error.message : String(error);
}
