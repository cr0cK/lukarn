import type { AppSettings } from '@gdv/shared';
import type { FastifyBaseLogger } from 'fastify';
import { bootstrapFromYaml } from './bootstrap.js';
import { CommentRepo } from './comments.js';
import { CommenterRepo } from './commenters.js';
import { ConfigRepo, type StoredAlbum } from './config-repo.js';
import { type Db, openDb } from './db.js';
import { DriveService } from './drive/service.js';
import { Syncer } from './drive/sync.js';
import type { Env } from './env.js';
import { Mailer } from './mail.js';
import { MediaCache } from './media/cache.js';
import { MediaRenderer } from './media/renderer.js';
import { MediaRepo, SyncStateRepo } from './repo.js';
import { SessionStore } from './sessions.js';
import { LoginThrottle } from './throttle.js';

const GIB = 1024 ** 3;

/** Prévenu à chaque changement de réglage, pour l'appliquer sans redémarrage. */
export type SettingsListener = (settings: AppSettings) => void;

/**
 * Objet unique traversant toute l'application : configuration, base, services
 * Drive et pipeline média. Les routes ne construisent rien, elles piochent ici.
 */
export class AppContext {
  readonly db: Db;
  readonly config: ConfigRepo;
  readonly media: MediaRepo;
  readonly comments: CommentRepo;
  /** Identités de commentateur — les personnes, par opposition aux clés d'accès. */
  readonly commenters: CommenterRepo;
  readonly syncState: SyncStateRepo;
  readonly sessions: SessionStore;
  /** Inerte tant que SMTP n'est pas configuré — voir `Mailer.fromEnv`. */
  readonly mailer: Mailer;
  /**
   * Porté par le contexte et non par les routes d'authentification : sa purge
   * est branchée sur le ménage horaire de `main.ts`, qui n'a pas accès aux
   * fermetures d'une fabrique de routes.
   */
  readonly throttle = new LoginThrottle();
  readonly drive: DriveService;
  readonly cache: MediaCache;
  readonly renderer: MediaRenderer;
  readonly syncer: Syncer;

  private readonly settingsListeners: SettingsListener[] = [];

  constructor(
    readonly env: Env,
    readonly log: FastifyBaseLogger,
  ) {
    this.db = openDb(env.dataDir);
    this.config = new ConfigRepo(this.db);
    this.media = new MediaRepo(this.db);
    this.comments = new CommentRepo(this.db);
    this.commenters = new CommenterRepo(this.db, env.sessionSecret);
    this.syncState = new SyncStateRepo(this.db);
    this.sessions = new SessionStore(this.db);

    bootstrapFromYaml(this.config, env, {
      info: (msg) => log.info(msg),
      warn: (msg) => log.warn(msg),
    });

    const logger = {
      info: (msg: string) => log.info(msg),
      warn: (msg: string) => log.warn(msg),
      error: (msg: string) => log.error(msg),
      debug: (msg: string) => log.debug(msg),
    };

    this.mailer = Mailer.fromEnv(env, logger);
    this.drive = new DriveService(env, this.db, logger);
    this.cache = new MediaCache(env.cacheDir, this.settings.cacheMaxSizeGB * GIB, logger);
    this.renderer = new MediaRenderer(this.drive, this.cache, logger);
    this.syncer = new Syncer(this.drive, this.media, this.syncState, logger);

    // Filet de sécurité : une base restaurée d'une sauvegarde peut porter des
    // médias d'albums disparus depuis. La condition est indispensable — sans
    // album déclaré, `pruneAlbums` viderait l'index entier, ce qui est le bon
    // comportement après suppression du dernier album mais serait catastrophique
    // sur une base dont la configuration n'a pas encore été amorcée.
    const albumIds = this.albums.map((album) => album.id);
    if (albumIds.length > 0) this.media.pruneAlbums(albumIds);
  }

  get albums(): StoredAlbum[] {
    return this.config.albums();
  }

  albumsFor(username: string): StoredAlbum[] {
    return this.config.albumsFor(username);
  }

  canSee(username: string, albumId: string): boolean {
    return this.config.canSee(username, albumId);
  }

  findAlbum(albumId: string): StoredAlbum | undefined {
    return this.config.album(albumId);
  }

  get settings(): AppSettings {
    return this.config.settings();
  }

  /**
   * Enregistre un consommateur de réglages. `main.ts` s'en sert pour
   * reprogrammer le minuteur de synchronisation sans redémarrer.
   */
  onSettingsChanged(listener: SettingsListener): void {
    this.settingsListeners.push(listener);
  }

  /**
   * Écrit les réglages et les applique immédiatement. Le rechargement de
   * config d'avant ne le faisait pas : `cache.maxSizeGB` et
   * `sync.intervalMinutes` n'étaient lus qu'au démarrage, si bien que les
   * modifier depuis l'application n'aurait rien changé jusqu'au redémarrage.
   */
  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const settings = this.config.updateSettings(patch);
    this.cache.setMaxBytes(settings.cacheMaxSizeGB * GIB);
    for (const listener of this.settingsListeners) listener(settings);
    return settings;
  }

  close(): void {
    this.db.close();
  }
}
