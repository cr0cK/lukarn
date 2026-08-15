/**
 * What a storage backend must do for the indexer and the media proxy.
 *
 * Exactly three operations reach a storage: listing a container's metadata during
 * synchronisation, reading bytes with an optional `Range`, and fetching a preview the
 * backend already holds. Everything else — the index, the disk cache, the renderer,
 * the justified grid — never learns where a file lives, which is what makes this
 * interface small enough to implement against a folder, a bucket or a WebDAV server.
 */

/** Backends this application knows how to speak to. */
export type StorageKind = 'drive' | 'local' | 's3' | 'webdav';

/**
 * Pre-parsed metadata, when the backend supplies it.
 *
 * Drive is the only one that does: `files.list` returns `imageMediaMetadata` and
 * `videoMediaMetadata` in the same response as the listing, which is what lets an
 * album of several thousand photos be indexed without downloading a byte (D3). A
 * backend that serves plain files returns `null` and the indexer reads the bytes
 * itself.
 *
 * Values arrive normalised — numbers or `null`, an ISO instant, a position that is
 * either complete or absent — so that no consumer has to know which backend produced
 * them.
 */
export interface ProviderMediaMetadata {
  /** Sensor dimensions, before `rotated` is applied. */
  width: number | null;
  height: number | null;
  /**
   * Odd EXIF orientation (5–8): the dimensions above are reversed. The grid computes
   * its rows from them, so the swap has to happen before a thumbnail is ever loaded.
   */
  rotated: boolean;
  /** Capture instant in ISO form, `null` when the file carries none. */
  takenAt: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lens: string | null;
  isoSpeed: number | null;
  exposureTime: number | null;
  aperture: number | null;
  focalLength: number | null;
  /** Both or neither: half a position locates nothing. */
  lat: number | null;
  lng: number | null;
  /** Video duration in milliseconds. */
  durationMs: number | null;
}

/** One entry of a container listing, folders included. */
export interface StorageEntry {
  /** Backend-native reference: a Drive file id, or a path relative to the container. */
  ref: string;
  name: string;
  folder: boolean;
  mimeType: string | null;
  size: number | null;
  modifiedTime: string;
  /** Whatever the backend guarantees changes with the bytes: md5, ETag, or `size:mtime`. */
  version: string | null;
  /** Pre-parsed metadata when the backend supplies it, null when the indexer must read it. */
  media: ProviderMediaMetadata | null;
  hasPreview: boolean;
}

/** One page of a listing. `cursor` is opaque to the caller. */
export interface StoragePage {
  entries: StorageEntry[];
  /** `null` once the container has no further page. */
  cursor: string | null;
}

/** What /admin displays about a connection, and why it does not work when it does not. */
export interface StorageProbe {
  ok: boolean;
  /** An address, a bucket, a URL — whatever names this connection to a person. */
  account: string | null;
  /** The reason it is unusable, `null` when it is usable. */
  error: string | null;
}

/** The three operations that actually reach a storage, plus what /admin needs. */
export interface StorageProvider {
  readonly kind: StorageKind;
  /** Whether the connection is usable and what it points at, for /admin. */
  probe(): Promise<StorageProbe>;
  /** One page of a container's direct children, folders included. */
  list(container: string, cursor: string | null): Promise<StoragePage>;
  /** Bytes, with the browser's `Range` relayed verbatim when the backend allows it. */
  fetch(ref: string, range?: string, signal?: AbortSignal): Promise<Response>;
  /** A preview the backend already holds, or `null` when it holds none. */
  preview(ref: string, edge: number): Promise<Response | null>;
  /**
   * Runs an operation, translating backend failures into the taxonomy below.
   *
   * Callers wrap rather than the provider wrapping itself: an authorisation may be
   * withdrawn between the moment a call is prepared and the moment it fails, and only
   * the caller knows which unit of work has to be abandoned as a result.
   */
  guard<T>(operation: () => Promise<T>): Promise<T>;
}

/**
 * No usable credentials for this storage. `/admin` offers to connect it.
 */
export class StorageNotConnectedError extends Error {
  constructor(message = 'This storage is not connected. Go to /admin to authorise access.') {
    super(message);
    this.name = 'StorageNotConnectedError';
  }
}

/**
 * `TOKEN_KEY` cannot decrypt the stored secret. A subclass of
 * `StorageNotConnectedError` to inherit its handling — the instance truly cannot read
 * the storage — while stating the one fact that matters: the secret exists, but the
 * key is wrong. Deleting it would lose valid authorisation because of a mistyped
 * environment variable.
 */
export class StorageKeyMismatchError extends StorageNotConnectedError {
  constructor(
    message = 'The stored secret does not decrypt with TOKEN_KEY. Restore the original ' +
      'key, or reconnect this storage from /admin.',
  ) {
    super(message);
    this.name = 'StorageKeyMismatchError';
  }
}

/** The environment lacks what this kind of storage needs before it can be connected. */
export class StorageNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageNotConfiguredError';
  }
}

/** The backend now refuses credentials it used to accept. Reconnection is required. */
export class StorageRevokedError extends Error {
  constructor(
    message = 'The authorisation was revoked or has expired. Reconnect this storage from /admin.',
  ) {
    super(message);
    this.name = 'StorageRevokedError';
  }
}

/**
 * The storage did not respond in time, or continued rate-limiting beyond our retries.
 *
 * **Transient, which is why the distinction matters**: a file in an unreadable format
 * will fail the same way in an hour; this will not. The client must be able to retry,
 * hence the 503 and `Retry-After` header produced by the route — a 500 would falsely
 * say "broken" and make it give up.
 */
export class StorageUnavailableError extends Error {
  constructor(
    label: string,
    readonly retryAfterSeconds: number,
    cause: string,
  ) {
    super(`The storage could not serve ${label} (${cause}). Try again in a moment.`);
    this.name = 'StorageUnavailableError';
  }
}
