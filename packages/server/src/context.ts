import { join } from 'node:path';
import type { AppSettings } from '@lukarn/shared';
import type { FastifyBaseLogger } from 'fastify';
import { bootstrapFromYaml } from './bootstrap.js';
import { BrandingStore } from './branding/store.js';
import { CommentRepo } from './comments.js';
import { CommenterRepo } from './commenters.js';
import { ConfigRepo, type StoredAlbum } from './config-repo.js';
import { type Db, openDb } from './db.js';
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
import { DriveService } from './storage/drive.js';
import { Syncer } from './sync/sync.js';
import { SubscriptionRepo } from './subscriptions.js';
import { VisitLog } from './telemetry.js';
import { LoginThrottle } from './throttle.js';
import { UpdateChecker } from './updates.js';

const GIB = 1024 ** 3;

/** Notified on every setting change so it can be applied without restarting. */
export type SettingsListener = (settings: AppSettings) => void;

/**
 * Single object spanning the application: configuration, database, storage services
 * and media pipeline. Routes construct nothing and draw their dependencies from here.
 */
export class AppContext {
  readonly db: Db;
  readonly config: ConfigRepo;
  readonly media: MediaRepo;
  readonly comments: CommentRepo;
  /** Commenter identities — people, as opposed to access keys. */
  readonly commenters: CommenterRepo;
  /** New-item subscriptions created when an album is opened. */
  readonly subscriptions: SubscriptionRepo;
  /** New-photo announcements triggered by hourly housekeeping in `main.ts`. */
  readonly notifier: AlbumNotifier;
  /** Annotated days and places inferred from EXIF data. */
  readonly days: AlbumDayRepo;
  /**
   * Entity search across library text. Stateless: indexes live in the database
   * and are maintained by the triggers from migration 11.
   */
  readonly search: SearchRepo;
  /** Background aggregation of positions into days followed by geocoding. */
  readonly places: PlacesPass;
  readonly prewarmer: CachePrewarmer;
  /**
   * Prepares videos the browser cannot decode. Inert until `ffmpeg` has been found
   * on the machine — see `checkFfmpeg`.
   */
  readonly transcoder: TranscodePass;
  readonly syncState: SyncStateRepo;
  readonly sessions: SessionStore;
  /**
   * Visit counters aggregated on write: who opens which album, and when.
   * Their purge runs with hourly housekeeping in `main.ts` (D260809h).
   */
  readonly visits: VisitLog;
  /** Pending pairing requests — a keyboardless screen, five minutes. */
  readonly pairings: PairingStore;
  /** Inert until SMTP is configured — see `Mailer.fromEnv`. */
  readonly mailer: Mailer;
  /**
   * Held by the context rather than authentication routes: its purge runs with
   * hourly housekeeping in `main.ts`, which cannot access a route factory's closures.
   */
  readonly throttle = new LoginThrottle();
  /**
   * Where the albums live. Typed as the Drive implementation rather than the interface
   * because /admin still drives an OAuth consent that belongs to this backend alone;
   * everything downstream — indexing, rendering, transcoding — sees only a
   * `StorageProvider`.
   */
  readonly storage: DriveService;
  /**
   * The instance's logo, and the icons derived from it. Under `DATA_DIR` rather than
   * `CACHE_DIR`: an uploaded logo is not recomputable from anything (D260813b).
   */
  readonly branding: BrandingStore;
  readonly cache: MediaCache;
  /**
   * Store of playable video versions, with its own budget.
   *
   * Another `MediaCache` rather than a directory in the image cache: inventory,
   * LRU, eviction and startup cleanup of `.tmp` files are exactly what is needed,
   * while sharing one LRU would let browsing the grid evict hours of transcoding
   * work (D260809b).
   */
  readonly videoStore: MediaCache;
  readonly renderer: MediaRenderer;
  readonly syncer: Syncer;
  /**
   * Whether a newer release exists. Held here so its cache spans the process rather
   * than a request: it is asked from two screens, and the answer changes a few times
   * a year (D260815).
   */
  readonly updates: UpdateChecker;

  private readonly settingsListeners: SettingsListener[] = [];
  /** False until `checkFfmpeg` finds the binary. */
  private ffmpeg = false;

  constructor(
    readonly env: Env,
    readonly log: FastifyBaseLogger,
  ) {
    this.db = openDb(env.dataDir);
    this.config = new ConfigRepo(this.db, env.appName);
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
    this.storage = new DriveService(env, this.db, logger);
    this.branding = new BrandingStore(join(env.dataDir, 'branding'), logger);
    this.cache = new MediaCache(env.cacheDir, this.settings.cacheMaxSizeGB * GIB, logger);
    this.videoStore = new MediaCache(
      join(env.cacheDir, 'video'),
      this.settings.videoCacheMaxSizeGB * GIB,
      logger,
    );
    this.renderer = new MediaRenderer(this.storage, this.cache, logger);
    this.syncer = new Syncer(this.storage, this.media, this.syncState, logger);
    this.updates = new UpdateChecker({
      currentVersion: env.appVersion,
      url: env.updateCheckUrl,
      log: logger,
    });
    this.notifier = new AlbumNotifier({
      // A function rather than the list, so an album created from /admin joins the
      // watch cycle without a restart.
      albums: () => this.albums,
      media: this.media,
      syncState: this.syncState,
      subscriptions: this.subscriptions,
      mailer: () => this.mailer,
      instanceName: () => this.settings.instanceName,
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
      // Re-evaluated for every photo: clearing the setting in /admin must stop the
      // current pass, not just the next one — that is what is expected of a switch
      // after noticing that it saturates the connection.
      //
      // The Drive connection belongs in the same predicate rather than another
      // dependency: without it, the pass would traverse the whole album, failing
      // photo by photo **with its one-second pause** — fifteen minutes of futile
      // looping per hour for an album of a thousand photos.
      enabled: () => this.settings.prewarmCache && this.storage.connected,
      log: logger,
    });

    this.transcoder = new TranscodePass({
      albums: () => this.albums,
      media: this.media,
      store: this.videoStore,
      transcoder: new VideoTranscoder({
        storage: this.storage,
        store: this.videoStore,
        root: join(env.cacheDir, 'video'),
        run: spawnFfmpeg,
      }),
      // Three conditions in the same predicate, re-evaluated for every video, for
      // the same reason as prewarming: without Drive, the pass would traverse the
      // album failing file by file; without ffmpeg, it would fail after downloading
      // each original — one hundred and fifty megabytes fetched for nothing, per
      // video and per hour.
      enabled: () => this.settings.transcodeVideos && this.storage.connected && this.ffmpeg,
      log: logger,
    });

    // Safety net: a database restored from backup may contain media from albums that
    // have since disappeared. The condition is essential — with no declared album,
    // `pruneAlbums` would empty the whole index, which is correct after deleting the
    // last album but catastrophic for a database whose configuration has not yet
    // been bootstrapped.
    const albumIds = this.albums.map((album) => album.id);
    if (albumIds.length > 0) this.media.pruneAlbums(albumIds);
  }

  /**
   * Finds `ffmpeg` and enables — or does not enable — video preparation.
   *
   * Called once at startup from `buildApp`: the constructor cannot await a process,
   * and probing the binary on every pass would cost one `spawn` per hour for an
   * answer that does not change. The warning is explicit because the symptom is not:
   * without ffmpeg, HEVC videos remain displayed as unplayable, exactly as before,
   * with no indication that a package is missing.
   */
  async checkFfmpeg(): Promise<void> {
    this.ffmpeg = await ffmpegAvailable();
    if (this.ffmpeg || !this.settings.transcodeVideos) return;
    this.log.warn(
      'ffmpeg is missing: videos the browser cannot decode will not be ' +
        'prepared, they will only stay downloadable.',
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
   * Indexes albums, then prepares thumbnails for what has just arrived.
   *
   * The two belong together, and this is the only time new items are known: an
   * indexed but never rendered photo incurs the full cost when the grid first opens —
   * two to four simultaneous renders for several dozen thumbnails requested at once.
   * Every synchronisation passes through here, including those launched from /admin.
   *
   * Prewarming retains its other triggers — startup and hourly housekeeping —
   * because automatic synchronisation may be disabled (D45); it rejects a second
   * concurrent pass itself.
   *
   * Places follow the same logic for the same reason: a newly arrived geolocated
   * photo gives its day a name, and waiting for hourly housekeeping would display
   * for an hour a day without a place the instance already knows how to name (D91).
   */
  async syncThenPrewarm(albums: StoredAlbum[]): Promise<void> {
    await this.syncer.syncAll(albums);

    // Detached and before prewarming: cluster aggregation is immediate, but the
    // geocoding that follows can take a few minutes. Waiting for it would delay
    // thumbnails by the same amount — the very thing that makes the grid fast. The
    // pass rejects a concurrent call itself, so repeated synchronisation does not
    // call Nominatim twice.
    void this.places.run().catch((error: unknown) => {
      this.log.error({ err: error }, 'Places pass failed');
    });

    await this.prewarmer.run();

    // After prewarming, never before: thumbnails keep someone waiting in front of
    // the grid, while transcoding prepares a video nobody is watching yet. Going
    // first would delay by several minutes work measured in seconds.
    await this.transcoder.run();
  }

  get settings(): AppSettings {
    return this.config.settings();
  }

  /**
   * Registers a settings consumer. `main.ts` uses it to reschedule the
   * synchronisation timer without restarting.
   */
  onSettingsChanged(listener: SettingsListener): void {
    this.settingsListeners.push(listener);
  }

  /**
   * Writes settings and applies them immediately. The previous configuration reload
   * did not: `cache.maxSizeGB` and `sync.intervalMinutes` were read only at startup,
   * so changing them from the application would have done nothing until restart.
   */
  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const settings = this.config.updateSettings(patch);
    this.cache.setMaxBytes(settings.cacheMaxSizeGB * GIB);
    this.videoStore.setMaxBytes(settings.videoCacheMaxSizeGB * GIB);
    // The built-in mark's dot carries the primary colour, so every generated icon
    // becomes stale the moment it changes. Detached: four small files are rebuilt on
    // the next request, and a disk error there must not fail the write that succeeded.
    void this.branding.clearGenerated().catch((error: unknown) => {
      this.log.warn({ err: error }, 'Could not discard the generated icons');
    });
    for (const listener of this.settingsListeners) listener(settings);
    return settings;
  }

  close(): void {
    this.db.close();
  }
}
