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
import { Geocoder } from './geocoder.js';
import { Mailer } from './mail.js';
import { MediaCache } from './media/cache.js';
import { MediaRenderer } from './media/renderer.js';
import { AlbumNotifier } from './notifier.js';
import { AlbumDayRepo, PlacesPass } from './places.js';
import { CachePrewarmer } from './media/prewarm.js';
import { MediaRepo, SyncStateRepo } from './repo.js';
import { SessionStore } from './sessions.js';
import { SubscriptionRepo } from './subscriptions.js';
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
  /** Abonnements aux nouveautés, pris à l'ouverture d'un album. */
  readonly subscriptions: SubscriptionRepo;
  /** Annonce des nouvelles photos, déclenchée par le ménage horaire de `main.ts`. */
  readonly notifier: AlbumNotifier;
  /** Journées annotées, et lieux déduits de l'EXIF. */
  readonly days: AlbumDayRepo;
  /** Agrégation des positions en journées puis géocodage, en tâche de fond. */
  readonly places: PlacesPass;
  readonly prewarmer: CachePrewarmer;
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
    this.subscriptions = new SubscriptionRepo(this.db);
    this.syncState = new SyncStateRepo(this.db);
    this.sessions = new SessionStore(this.db);
    this.days = new AlbumDayRepo(this.db);

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
    this.notifier = new AlbumNotifier({
      // Une fonction et non la liste : un album créé depuis /admin doit entrer
      // dans le tour de garde sans redémarrage.
      albums: () => this.albums,
      media: this.media,
      syncState: this.syncState,
      subscriptions: this.subscriptions,
      mailer: () => this.mailer,
      env,
      log: logger,
    });

    this.places = new PlacesPass({
      albums: () => this.albums,
      media: this.media,
      days: this.days,
      geocoder: env.geocoding ? new Geocoder(this.db, env.geocoding, logger) : null,
      log: logger,
    });

    this.prewarmer = new CachePrewarmer({
      albums: () => this.albums,
      media: this.media,
      cache: this.cache,
      renderer: this.renderer,
      // Relu à chaque photo : décocher le réglage dans /admin doit arrêter le
      // passage en cours, pas seulement le suivant — c'est ce qu'on attend
      // d'un interrupteur quand on vient de constater que ça sature la ligne.
      //
      // La connexion Drive entre dans le même prédicat plutôt que dans une
      // dépendance de plus : sans elle, le passage parcourait l'album entier en
      // échouant photo par photo **avec sa pause d'une seconde**, soit un quart
      // d'heure de boucle stérile par heure sur un album de mille photos.
      enabled: () => this.settings.prewarmCache && this.drive.connected,
      log: logger,
    });

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

  /**
   * Indexe les albums, puis prépare les vignettes de ce qui vient d'arriver.
   *
   * Les deux vont ensemble, et c'est le seul moment où on sait qu'il y a du
   * neuf : une photo indexée mais jamais rendue coûte le prix fort à la
   * première ouverture de la grille — deux à quatre rendus simultanés pour
   * plusieurs dizaines de vignettes demandées d'un coup. Toute synchronisation passe par
   * ici, y compris celles lancées depuis /admin.
   *
   * Le préchauffage garde ses autres déclencheurs — démarrage et ménage horaire
   * — parce que la synchronisation automatique peut être désactivée (D45) ; il
   * refuse de lui-même un second passage concurrent.
   *
   * Les lieux suivent la même logique et pour la même raison : une photo
   * géolocalisée qui vient d'arriver donne son nom à sa journée, et attendre le
   * ménage horaire ferait afficher pendant une heure une journée sans lieu que
   * l'instance sait déjà nommer (D91).
   */
  async syncThenPrewarm(albums: StoredAlbum[]): Promise<void> {
    await this.syncer.syncAll(albums);

    // Détaché, et avant le préchauffage : l'agrégation des grappes est
    // instantanée, mais le géocodage qui la suit dure jusqu'à quelques minutes.
    // L'attendre repousserait d'autant les vignettes, c'est-à-dire ce qui rend
    // la grille rapide. Le passage refuse de lui-même un second appel
    // concurrent, une resynchronisation répétée n'appelle donc pas Nominatim
    // deux fois.
    void this.places.run().catch((error: unknown) => {
      this.log.error({ err: error }, 'Passage des lieux en échec');
    });

    await this.prewarmer.run();
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
