import { existsSync } from 'node:fs';
import { loadConfig } from './config.js';
import type { ConfigRepo } from './config-repo.js';
import type { Env } from './env.js';

export interface BootstrapLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

/**
 * Bootstraps a new installation from `config/albums.yaml`.
 *
 * The database is authoritative: this file is read **only** while no account
 * exists. As soon as one does, the YAML is ignored permanently — otherwise a
 * change made in the application would be overwritten on the next restart by
 * a file that has remained unchanged.
 *
 * This is also the upgrade path for a running instance: on the first start after
 * the migration, its accounts, albums, permissions and settings are carried over
 * unchanged from the file it already used. Nothing is re-indexed, and neither the
 * media index nor the OAuth token is touched.
 */
export function bootstrapFromYaml(config: ConfigRepo, env: Env, log: BootstrapLogger): void {
  if (config.userCount() > 0) return;

  if (!existsSync(env.configPath)) {
    log.warn(
      `No account in the database and no ${env.configPath} file: ` +
        'create the first administrator with "pnpm create-admin <username>", ' +
        'then sign in at /admin.',
    );
    return;
  }

  // A present but invalid file prevents startup, as before: accepting it would
  // produce an unusable instance with no accounts, while the typo is visible to
  // the installer.
  const yaml = loadConfig(env.configPath);

  config.seed({
    albums: yaml.albums.map((album) => ({
      id: album.id,
      title: album.title,
      description: album.description ?? null,
      folderId: album.folderId,
      recursive: album.recursive,
      groupBy: album.groupBy,
      sortOrder: album.sortOrder,
    })),
    users: yaml.users.map((user) => ({
      username: user.username,
      passwordHash: user.passwordHash,
      admin: user.admin,
      albums: user.albums,
    })),
    settings: {
      syncIntervalMinutes: yaml.sync.intervalMinutes,
      syncOnStartup: yaml.sync.onStartup,
      cacheMaxSizeGB: yaml.cache.maxSizeGB,
    },
  });

  log.info(
    `Configuration bootstrapped from ${env.configPath}: ` +
      `${yaml.users.length} account(s), ${yaml.albums.length} album(s). ` +
      'The file will not be read again: administration now happens from /admin.',
  );
}
