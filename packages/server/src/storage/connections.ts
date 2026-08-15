import { decryptSecret, encryptSecret } from '../crypto.js';
import type { Db } from '../db.js';
import { StorageKeyMismatchError, type StorageKind } from './provider.js';

/**
 * Repository of storage connections — where the albums live, administered from the
 * application itself.
 *
 * Modelled on `ConfigRepo`, and for the same reason: `get()` is called on every media
 * request to resolve which backend serves a file, so the rows live in memory and the
 * snapshot is rebuilt on the first read following a write. `PRAGMA data_version`
 * catches a write from another process — `pnpm create-admin` and its neighbours share
 * the database.
 *
 * This is the sole writer of `storage_connections`; a direct `UPDATE` from the same
 * process would serve stale state.
 */

/**
 * The connection an album reads when nothing else is said.
 *
 * Migration 17 creates this row whether or not a Drive was ever connected, and
 * `albums.connection_id` defaults to it: an album has always pointed at a storage,
 * and introducing several must not create the state where one points at none.
 */
export const DEFAULT_CONNECTION_ID = 'drive';

/** A connection as stored. The secret half stays encrypted until `secret()` asks. */
export interface StorageConnection {
  id: string;
  kind: StorageKind;
  label: string;
  /** JSON settings, nothing secret: an endpoint, a bucket, a prefix. */
  settings: Record<string, unknown>;
  /**
   * The encrypted secret, or `null` when this connection has none yet. Exposed rather
   * than hidden because `guard()` compares it: a token refused while a reconnection
   * was in flight must not mark the new one revoked.
   */
  ciphertext: string | null;
  /** What names this connection to a person: an address, a bucket, a URL. */
  account: string | null;
  /** When the secret was obtained. `null` for a connection nothing was granted to. */
  grantedAt: string | null;
  /** Non-`null` once the backend stopped accepting the secret. */
  revokedAt: string | null;
  createdAt: string;
  position: number;
}

export interface CreateConnectionInput {
  id: string;
  kind: StorageKind;
  label: string;
  settings?: Record<string, unknown>;
  /** Encrypted on the way in. `null` for a connection authorised later, like Drive. */
  secret?: string | null;
  account?: string | null;
}

export interface UpdateConnectionInput {
  label?: string;
  settings?: Record<string, unknown>;
  /** `null` clears the stored secret; omitted leaves it untouched. */
  secret?: string | null;
  account?: string | null;
}

interface ConnectionRow {
  id: string;
  kind: StorageKind;
  label: string;
  settings: string;
  ciphertext: string | null;
  account: string | null;
  granted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  position: number;
}

function toConnection(row: ConnectionRow): StorageConnection {
  let settings: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.settings);
    if (parsed && typeof parsed === 'object') settings = parsed as Record<string, unknown>;
  } catch {
    // Manually edited database: an unreadable value behaves as no settings at all,
    // which the provider reports as misconfigured rather than crashing at startup.
  }

  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    settings,
    ciphertext: row.ciphertext,
    account: row.account,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    position: row.position,
  };
}

export class StorageConnectionRepo {
  private snapshot: Map<string, StorageConnection> | null = null;
  /** Last observed value of `PRAGMA data_version`. See `ConfigRepo.read`. */
  private dataVersion = -1;
  /** Bumped whenever the stored rows may have changed. See `revision()`. */
  private generation = 0;

  constructor(
    private readonly db: Db,
    private readonly tokenKey: string,
  ) {}

  /* -------------------------------------------------------------------- reading */

  /** Every connection, in the order they were added. */
  list(): StorageConnection[] {
    return [...this.read().values()];
  }

  get(id: string): StorageConnection | undefined {
    return this.read().get(id);
  }

  /**
   * A number that changes whenever the rows may have. `StorageRegistry` caches one
   * live provider per connection and drops them all when this moves — comparing the
   * rows themselves would run on every thumbnail, which is exactly the path the cache
   * exists to keep short.
   */
  revision(): number {
    this.read();
    return this.generation;
  }

  /**
   * The decrypted secret, or `null` when this connection has none.
   *
   * Throws `StorageKeyMismatchError` rather than returning `null` when decryption
   * fails: a mistyped `TOKEN_KEY` and "never connected" are opposite states, and
   * confusing them is how a still-valid authorisation gets thrown away (D14).
   */
  secret(id: string): string | null {
    const connection = this.get(id);
    if (!connection?.ciphertext) return null;

    try {
      return decryptSecret(connection.ciphertext, this.tokenKey);
    } catch {
      throw new StorageKeyMismatchError(
        `The secret stored for "${id}" does not decrypt with TOKEN_KEY. Restore the ` +
          'original key, or reconnect this storage from /admin.',
      );
    }
  }

  /* -------------------------------------------------------------------- writing */

  create(input: CreateConnectionInput): StorageConnection {
    const now = new Date().toISOString();
    const next = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM storage_connections')
      .get() as { next: number };

    this.db
      .prepare(
        `INSERT INTO storage_connections
           (id, kind, label, settings, ciphertext, account, granted_at, revoked_at, created_at, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        input.id,
        input.kind,
        input.label,
        JSON.stringify(input.settings ?? {}),
        input.secret ? encryptSecret(input.secret, this.tokenKey) : null,
        input.account ?? null,
        input.secret ? now : null,
        now,
        next.next,
      );

    this.invalidate();
    return this.get(input.id)!;
  }

  update(id: string, patch: UpdateConnectionInput): StorageConnection {
    const stored = this.get(id);
    if (!stored) throw new Error(`Unknown storage connection: "${id}"`);

    this.db.transaction(() => {
      if (patch.label !== undefined) {
        this.db
          .prepare('UPDATE storage_connections SET label = ? WHERE id = ?')
          .run(patch.label, id);
      }
      if (patch.settings !== undefined) {
        this.db
          .prepare('UPDATE storage_connections SET settings = ? WHERE id = ?')
          .run(JSON.stringify(patch.settings), id);
      }
      if (patch.account !== undefined) {
        this.db
          .prepare('UPDATE storage_connections SET account = ? WHERE id = ?')
          .run(patch.account, id);
      }
      if (patch.secret !== undefined) {
        // A new secret clears the previous revocation: this is the reconnection the
        // refusal asked for, and leaving `revoked_at` set would keep /admin asking.
        this.db
          .prepare(
            `UPDATE storage_connections
                SET ciphertext = ?, granted_at = ?, revoked_at = NULL
              WHERE id = ?`,
          )
          .run(
            patch.secret === null ? null : encryptSecret(patch.secret, this.tokenKey),
            patch.secret === null ? null : new Date().toISOString(),
            id,
          );
      }
    })();

    this.invalidate();
    return this.get(id)!;
  }

  /**
   * Records that the backend now refuses this secret.
   *
   * `used` is the encrypted secret whose refusal was observed, and the write happens
   * only while it is still the stored one: every reconnection produces different
   * encrypted text, which is enough to detect that one landed during the request.
   * Returns whether the revocation was recorded, so the caller can say why not.
   */
  markRevoked(id: string, used: string | null): boolean {
    const stored = this.get(id);
    if (!stored || stored.revokedAt !== null) return false;
    if (used === null || stored.ciphertext !== used) return false;

    this.db
      .prepare('UPDATE storage_connections SET revoked_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
    this.invalidate();
    return true;
  }

  /**
   * Forgets the secret without forgetting the connection: /admin keeps a row to
   * reconnect, and the albums pointing at it keep pointing somewhere.
   */
  clearSecret(id: string): void {
    this.db
      .prepare(
        `UPDATE storage_connections
            SET ciphertext = NULL, account = NULL, granted_at = NULL, revoked_at = NULL
          WHERE id = ?`,
      )
      .run(id);
    this.invalidate();
  }

  delete(id: string): boolean {
    const changes = this.db.prepare('DELETE FROM storage_connections WHERE id = ?').run(id).changes;
    this.invalidate();
    return changes > 0;
  }

  /* ------------------------------------------------------------------- internal */

  private invalidate(): void {
    this.snapshot = null;
    this.generation++;
  }

  private read(): Map<string, StorageConnection> {
    const version = this.db.pragma('data_version', { simple: true }) as number;
    if (version !== this.dataVersion) {
      this.dataVersion = version;
      this.snapshot = null;
      this.generation++;
    }
    return (this.snapshot ??= this.build());
  }

  private build(): Map<string, StorageConnection> {
    const rows = this.db
      .prepare(
        `SELECT id, kind, label, settings, ciphertext, account, granted_at, revoked_at,
                created_at, position
           FROM storage_connections ORDER BY position, id`,
      )
      .all() as ConnectionRow[];

    return new Map(rows.map((row) => [row.id, toConnection(row)]));
  }
}
