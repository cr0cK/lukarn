import { join } from 'node:path';
import type { AppSettings } from '@nonni/shared';
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
import { PairingStore } from './pairings.js';
import { AlbumDayRepo, PlacesPass } from './places.js';
import { CachePrewarmer } from './media/prewarm.js';
import { ffmpegAvailable, spawnFfmpeg, TranscodePass, VideoTranscoder } from './media/transcode.js';
import { MediaRepo, SyncStateRepo } from './repo.js';
import { SearchRepo } from './search.js';
import { SessionStore } from './sessions.js';
import { SubscriptionRepo } from './subscriptions.js';
import { VisitLog } from './telemetry.js';
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
  /**
   * Recherche d'entités dans les textes de la bibliothèque. Sans état : les
   * index sont dans la base, tenus par les déclencheurs de la migration 11.
   */
  readonly search: SearchRepo;
  /** Agrégation des positions en journées puis géocodage, en tâche de fond. */
  readonly places: PlacesPass;
  readonly prewarmer: CachePrewarmer;
  /**
   * Préparation des vidéos que le navigateur ne décode pas. Inerte tant que
   * `ffmpeg` n'a pas été trouvé sur la machine — voir `checkFfmpeg`.
   */
  readonly transcoder: TranscodePass;
  readonly syncState: SyncStateRepo;
  readonly sessions: SessionStore;
  /**
   * Compteurs de visite, agrégés à l'écriture : qui ouvre quel album, et quand.
   * Sa purge est branchée sur le ménage horaire de `main.ts` (D260809h).
   */
  readonly visits: VisitLog;
  /** Demandes d'appairage en attente — un écran sans clavier, cinq minutes. */
  readonly pairings: PairingStore;
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
  /**
   * Magasin des versions lisibles des vidéos, avec son propre budget.
   *
   * Une `MediaCache` de plus et non un répertoire du cache d'images : inventaire,
   * LRU, éviction et ménage des `.tmp` au démarrage sont exactement ce qu'il
   * faut, et un LRU commun aux deux laisserait une navigation dans la grille
   * évincer des heures de transcodage (D260809b).
   */
  readonly videoStore: MediaCache;
  readonly renderer: MediaRenderer;
  readonly syncer: Syncer;

  private readonly settingsListeners: SettingsListener[] = [];
  /** Faux tant que `checkFfmpeg` n'a pas trouvé le binaire. */
  private ffmpeg = false;

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
    this.visits = new VisitLog(this.db);
    this.pairings = new PairingStore(this.db, env.sessionSecret);
    this.days = new AlbumDayRepo(this.db);
    this.search = new SearchRepo(this.db);

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
    this.videoStore = new MediaCache(
      join(env.cacheDir, 'video'),
      this.settings.videoCacheMaxSizeGB * GIB,
      logger,
    );
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

    this.transcoder = new TranscodePass({
      albums: () => this.albums,
      media: this.media,
      store: this.videoStore,
      transcoder: new VideoTranscoder({
        drive: this.drive,
        store: this.videoStore,
        root: join(env.cacheDir, 'video'),
        run: spawnFfmpeg,
      }),
      // Trois conditions dans le même prédicat, relu à chaque vidéo, pour la
      // raison du préchauffage : sans Drive, le passage parcourrait l'album en
      // échouant fichier par fichier ; sans ffmpeg, il le parcourrait en
      // échouant après avoir téléchargé chaque original — cent cinquante
      // méga-octets tirés pour rien, par vidéo et par heure.
      enabled: () => this.settings.transcodeVideos && this.drive.connected && this.ffmpeg,
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

  /**
   * Cherche `ffmpeg` et arme — ou non — la préparation des vidéos.
   *
   * Appelé une fois au démarrage, depuis `buildApp` : le constructeur ne peut
   * pas attendre un processus, et sonder le binaire à chaque passage coûterait
   * un `spawn` par heure pour une réponse qui ne change pas. L'avertissement
   * est explicite parce que le symptôme, lui, ne l'est pas : sans ffmpeg, les
   * vidéos HEVC restent affichées comme illisibles, exactement comme avant, et
   * rien ne dirait qu'il manque un paquet.
   */
  async checkFfmpeg(): Promise<void> {
    this.ffmpeg = await ffmpegAvailable();
    if (this.ffmpeg || !this.settings.transcodeVideos) return;
    this.log.warn(
      'ffmpeg est introuvable : les vidéos que le navigateur ne décode pas ne seront pas ' +
        'préparées, elles resteront seulement téléchargeables.',
    );
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

    // Après le préchauffage, jamais avant : les vignettes font attendre quelqu'un
    // devant sa grille, un transcodage prépare une vidéo que personne ne regarde
    // encore. Passer devant retarderait de plusieurs minutes ce qui se compte en
    // secondes.
    await this.transcoder.run();
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
    this.videoStore.setMaxBytes(settings.videoCacheMaxSizeGB * GIB);
    for (const listener of this.settingsListeners) listener(settings);
    return settings;
  }

  close(): void {
    this.db.close();
  }
}
