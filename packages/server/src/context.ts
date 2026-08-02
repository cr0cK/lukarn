import type { FastifyBaseLogger } from 'fastify';
import {
  type AppConfig,
  type ConfigAlbum,
  canSeeAlbum,
  loadConfig,
  visibleAlbums,
} from './config.js';
import { type Db, openDb } from './db.js';
import { DriveService } from './drive/service.js';
import { Syncer } from './drive/sync.js';
import type { Env } from './env.js';
import { MediaCache } from './media/cache.js';
import { MediaRenderer } from './media/renderer.js';
import { MediaRepo, SyncStateRepo } from './repo.js';
import { SessionStore } from './sessions.js';

const GIB = 1024 ** 3;

/**
 * Objet unique traversant toute l'application : configuration, base, services
 * Drive et pipeline média. Les routes ne construisent rien, elles piochent ici.
 */
export class AppContext {
  readonly db: Db;
  readonly media: MediaRepo;
  readonly syncState: SyncStateRepo;
  readonly sessions: SessionStore;
  readonly drive: DriveService;
  readonly cache: MediaCache;
  readonly renderer: MediaRenderer;
  readonly syncer: Syncer;

  private currentConfig: AppConfig;

  constructor(
    readonly env: Env,
    config: AppConfig,
    readonly log: FastifyBaseLogger,
  ) {
    this.currentConfig = config;
    this.db = openDb(env.dataDir);
    this.media = new MediaRepo(this.db);
    this.syncState = new SyncStateRepo(this.db);
    this.sessions = new SessionStore(this.db);

    const logger = {
      info: (msg: string) => log.info(msg),
      warn: (msg: string) => log.warn(msg),
      error: (msg: string) => log.error(msg),
      debug: (msg: string) => log.debug(msg),
    };

    this.drive = new DriveService(env, this.db, logger);
    this.cache = new MediaCache(env.cacheDir, config.cache.maxSizeGB * GIB);
    this.renderer = new MediaRenderer(this.drive, this.cache, logger);
    this.syncer = new Syncer(this.drive, this.media, this.syncState, logger);

    // Un album retiré de la config ne doit plus rien laisser derrière lui.
    this.media.pruneAlbums(config.albums.map((album) => album.id));
  }

  get config(): AppConfig {
    return this.currentConfig;
  }

  get albums(): ConfigAlbum[] {
    return this.currentConfig.albums;
  }

  albumsFor(username: string): ConfigAlbum[] {
    return visibleAlbums(this.currentConfig, username);
  }

  canSee(username: string, albumId: string): boolean {
    return canSeeAlbum(this.currentConfig, username, albumId);
  }

  findAlbum(albumId: string): ConfigAlbum | undefined {
    return this.currentConfig.albums.find((album) => album.id === albumId);
  }

  /**
   * Relit `albums.yaml` sans redémarrer. Si le fichier est invalide, la config
   * en place est conservée et l'erreur remonte à l'appelant : mieux vaut une
   * app qui tourne sur l'ancienne config qu'une app cassée.
   */
  reloadConfig(): AppConfig {
    const next = loadConfig(this.env.configPath);
    this.currentConfig = next;
    this.media.pruneAlbums(next.albums.map((album) => album.id));

    // Un utilisateur supprimé, renommé, ou dont le mot de passe change ne doit
    // pas continuer à naviguer avec sa session ouverte.
    const known = new Set(next.users.map((user) => user.username.toLowerCase()));
    const sessions = this.db.prepare('SELECT DISTINCT username FROM sessions').all() as {
      username: string;
    }[];
    for (const { username } of sessions) {
      if (!known.has(username.toLowerCase())) this.sessions.destroyForUser(username);
    }

    this.log.info('Configuration rechargée');
    return next;
  }

  close(): void {
    this.db.close();
  }
}
