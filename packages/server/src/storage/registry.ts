import type { StorageKind } from '@lukarn/shared';
import type { Env } from '../env.js';
import type { StorageConnection, StorageConnectionRepo } from './connections.js';
import { DriveService } from './drive.js';
import { LocalFolderService } from './local.js';
import { StorageNotConfiguredError, type StorageProvider } from './provider.js';
import { s3FromConnection } from './s3.js';
import { webdavFromConnection } from './webdav.js';

/**
 * Kinds this release can actually build, in the order /admin offers them.
 *
 * Declared beside the `switch` that builds them so the two cannot drift: a kind
 * offered in a form and refused by the factory is a promise the application breaks
 * after the administrator has typed a bucket name.
 */
export const SUPPORTED_KINDS: StorageKind[] = ['drive', 'local', 's3', 'webdav'];

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

/**
 * Builds a live provider from a stored connection.
 *
 * One `switch`, and the only place in the application that turns a kind into an
 * implementation. A kind this release cannot build is refused here rather than
 * failing later inside a sync: the message names the kind, which is the one thing an
 * administrator who typed it needs to read back.
 */
export function createProvider(
  connection: StorageConnection,
  env: Env,
  connections: StorageConnectionRepo,
  log: Logger,
): StorageProvider {
  switch (connection.kind) {
    case 'drive':
      return new DriveService(env, connections, connection.id, log);
    case 'local':
      return new LocalFolderService(env, connection.settings, log);
    case 's3':
      return s3FromConnection(connection, connections, log);
    case 'webdav':
      return webdavFromConnection(connection, connections, log);
    default:
      throw new StorageNotConfiguredError(
        `Storage of kind "${connection.kind}" is declared but this version cannot read it.`,
      );
  }
}

/**
 * The instance's storages, one live provider per connection.
 *
 * Providers are **cached per connection** because they are not stateless: a
 * `DriveService` holds an authorised client whose access token it renews, and
 * rebuilding one per request would exchange a refresh token for every thumbnail. The
 * cache is dropped on any write, which is what makes a reconnection or a changed
 * endpoint take effect without a restart.
 */
export class StorageRegistry {
  private readonly live = new Map<string, StorageProvider>();
  /** Last observed connection revision, so a write from anywhere clears the cache. */
  private observed = -1;

  constructor(
    private readonly connections: StorageConnectionRepo,
    private readonly env: Env,
    private readonly log: Logger,
  ) {}

  /**
   * The provider for this connection.
   *
   * Throws `StorageNotConfiguredError` when the id names nothing: an album pointing at
   * a deleted connection is a state the delete route refuses to create, so reaching
   * here means the database was edited by hand — and saying so beats an empty album.
   */
  get(connectionId: string): StorageProvider {
    this.sweep();

    const cached = this.live.get(connectionId);
    if (cached) return cached;

    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new StorageNotConfiguredError(
        `No storage connection named "${connectionId}". Check /admin — an album points ` +
          'at a connection that no longer exists.',
      );
    }

    const provider = createProvider(connection, this.env, this.connections, this.log);
    this.live.set(connectionId, provider);
    return provider;
  }

  /** Every connection, in display order, paired with what serves it. */
  all(): { connection: StorageConnection; provider: StorageProvider | null }[] {
    return this.connections.list().map((connection) => {
      try {
        return { connection, provider: this.get(connection.id) };
      } catch {
        // A kind this version cannot build still has a row, and /admin has to list it:
        // hiding the connection would leave its albums unexplained.
        return { connection, provider: null };
      }
    });
  }

  /**
   * Is at least one storage usable?
   *
   * What prewarming, transcoding and the startup sync ask before traversing an album:
   * with nothing connected, each would fail file by file while keeping its pacing —
   * fifteen wasted minutes an hour for an album of a thousand photos (D61).
   */
  anyConnected(): boolean {
    return this.connections.list().some((connection) => this.isConnected(connection.id));
  }

  /**
   * Is this storage usable? Never throws: it answers a question asked to decide
   * whether to start work, and a misconfigured connection answers "no".
   */
  isConnected(connectionId: string): boolean {
    try {
      const provider = this.get(connectionId);
      return provider instanceof DriveService ? provider.connected : true;
    } catch {
      return false;
    }
  }

  /**
   * The Drive implementation behind a connection, or `null` when it is another kind —
   * or when nothing can be built from it at all.
   *
   * Consent, its service-account alternative and disconnection have no meaning outside
   * Drive, and the interface deliberately does not pretend otherwise: the routes that
   * offer those buttons ask for the concrete type here. It never throws for the same
   * reason as `isConnected`: /admin has to render the row either way.
   */
  drive(connectionId: string): DriveService | null {
    try {
      const provider = this.get(connectionId);
      return provider instanceof DriveService ? provider : null;
    } catch {
      return null;
    }
  }

  /** Drops every cached provider. Called after any write to a connection. */
  invalidate(): void {
    this.live.clear();
  }

  /**
   * Clears the cache when the stored connections have changed underneath it.
   *
   * A revision counter rather than a listener: `StorageConnectionRepo` already watches
   * `PRAGMA data_version` for writes from another process, and a provider built from a
   * row that has since been edited would keep using an endpoint nobody configured.
   */
  private sweep(): void {
    const revision = this.connections.revision();
    if (revision !== this.observed) {
      this.observed = revision;
      this.live.clear();
    }
  }
}
