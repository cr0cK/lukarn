import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { openDb } from '../src/db.js';
import { MediaCache } from '../src/media/cache.js';
import { CachePrewarmer, type PrewarmDeps } from '../src/media/prewarm.js';
import type { MediaRenderer, RenderOrigin, Variant } from '../src/media/renderer.js';
import { MediaRepo, type MediaUpsert } from '../src/repo.js';

/**
 * Cache prewarming. This verifies not merely that it renders images but that it
 * remains **unobtrusive**: prewarming that saturates the connection, fills the
 * cache at the expense of thumbnails or ignores its switch would be worse than
 * the wait it removes.
 */

const dir = mkdtempSync(join(tmpdir(), 'nonni-prewarm-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const db = openDb(dir);
after(() => db.close());

const media = new MediaRepo(db);
const silencieux = { info: () => {}, warn: () => {}, debug: () => {} };

function photo(albumId: string, id: string, jour: number): MediaUpsert {
  return {
    albumId,
    id,
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    kind: 'photo',
    size: 8_000_000,
    width: 6000,
    height: 4000,
    takenAt: `2026-07-${String(jour).padStart(2, '0')}T12:00:00.000Z`,
    takenAtFromExif: true,
    modifiedTime: '2026-07-01T12:00:00.000Z',
    durationMs: null,
    cameraMake: null,
    cameraModel: null,
    lens: null,
    isoSpeed: null,
    exposureTime: null,
    aperture: null,
    focalLength: null,
    lat: null,
    lng: null,
    md5: `empreinte-${id}`,
    hasThumbnail: true,
    videoCodec: null,
  };
}

/** Video, with or without the preview Drive produces from its first second. */
function video(albumId: string, id: string, jour: number, hasThumbnail: boolean): MediaUpsert {
  return {
    ...photo(albumId, id, jour),
    name: `${id}.mp4`,
    mimeType: 'video/mp4',
    kind: 'video',
    durationMs: 12_000,
    hasThumbnail,
  };
}

/** Prewarmer whose waits are recorded rather than incurred. */
class PrechauffeurInstantane extends CachePrewarmer {
  readonly attentes: number[] = [];

  protected override wait(ms: number): Promise<void> {
    this.attentes.push(ms);
    return Promise.resolve();
  }
}

interface FauxRenderer {
  rendus: string[];
  /** Variants requested on each call, in order. */
  demandes: Variant[][];
  /** Source requested for each file: original or Drive preview. */
  origines: Map<string, RenderOrigin>;
  enCache: Set<string>;
  renderer: MediaRenderer;
}

function fauxRenderer(options: { echoue?: Set<string> } = {}): FauxRenderer {
  const rendus: string[] = [];
  const demandes: Variant[][] = [];
  const origines = new Map<string, RenderOrigin>();
  const enCache = new Set<string>();
  const renderer = {
    // `prepare` owns the cache short circuit because the variant key lives
    // there; prewarming need not know it.
    prepare: (
      fileId: string,
      variants: Variant[],
      _md5: string | null,
      origin: RenderOrigin = 'original',
    ) => {
      if (options.echoue?.has(fileId)) return Promise.reject(new Error('unreadable'));
      demandes.push(variants);
      origines.set(fileId, origin);
      if (enCache.has(fileId)) return Promise.resolve(0);
      rendus.push(fileId);
      enCache.add(fileId);
      return Promise.resolve(variants.length);
    },
  } as unknown as MediaRenderer;
  return { rendus, demandes, origines, enCache, renderer };
}

function deps(
  albumId: string,
  renderer: MediaRenderer,
  overrides: Partial<PrewarmDeps> = {},
): PrewarmDeps {
  return {
    albums: () => [{ id: albumId }],
    media,
    cache: new MediaCache(join(dir, `cache-${albumId}`), 10_000_000, silencieux),
    renderer,
    enabled: () => true,
    log: silencieux,
    ...overrides,
  };
}

describe('cache prewarming', () => {
  it('renders the most recent photos first', async () => {
    media.upsertMany(
      [photo('recent', 'vieille', 1), photo('recent', 'moyenne', 15), photo('recent', 'neuve', 28)],
      '2026-07-28T12:00:00.000Z',
    );
    const { rendus, renderer } = fauxRenderer();

    const resultat = await new PrechauffeurInstantane(deps('recent', renderer)).run();

    // Order is not cosmetic: the cache uses LRU eviction and people open recent
    // photos. Starting with old ones would fill it with unwatched content.
    assert.deepEqual(rendus, ['neuve', 'moyenne', 'vieille']);
    assert.equal(resultat.rendered, 3);
  });

  it('pauses between photos', async () => {
    media.upsertMany([photo('pause', 'a', 1), photo('pause', 'b', 2)], '2026-07-02T12:00:00.000Z');
    const { renderer } = fauxRenderer();

    const prechauffeur = new PrechauffeurInstantane(deps('pause', renderer));
    await prechauffeur.run();

    // One photo at a time with idle time: the rendering limiter has four slots,
    // and prewarming must never occupy more than one or it would overtake a user.
    assert.deepEqual(prechauffeur.attentes, [1000, 1000]);
  });

  it('skips what is already cached', async () => {
    media.upsertMany([photo('deja', 'x', 1), photo('deja', 'y', 2)], '2026-07-02T12:00:00.000Z');
    const { rendus, enCache, renderer } = fauxRenderer();
    enCache.add('y');

    const resultat = await new PrechauffeurInstantane(deps('deja', renderer)).run();

    assert.deepEqual(rendus, ['x']);
    assert.equal(resultat.skipped, 1);
  });

  it('does not pause for an already cached photo either', async () => {
    media.upsertMany([photo('sanspause', 's1', 1)], '2026-07-01T12:00:00.000Z');
    const { enCache, renderer } = fauxRenderer();
    enCache.add('s1');

    const prechauffeur = new PrechauffeurInstantane(deps('sanspause', renderer));
    await prechauffeur.run();

    // One second per ready photo is an entire pass — fifteen minutes for a
    // thousand photos — spent idle when nothing waits. Pauses protect real work.
    assert.deepEqual(prechauffeur.attentes, []);
  });

  it('prepares only thumbnails, never full-page rendering', async () => {
    media.upsertMany([photo('tailles', 't1', 1)], '2026-07-01T12:00:00.000Z');
    const { demandes, renderer } = fauxRenderer();

    await new PrechauffeurInstantane(deps('tailles', renderer)).run();

    // The grid causes the wait and requests only these three sizes. Fullscreen
    // weighs about ten thumbnails and neighbour preloading already covers it;
    // preparing it would displace viewed content from the cache.
    assert.deepEqual(demandes, [
      [
        { kind: 'thumb', size: 320 },
        { kind: 'thumb', size: 640 },
        { kind: 'thumb', size: 1280 },
      ],
    ]);
  });

  it('prepares a video with a Drive preview and skips one without it', async () => {
    media.upsertMany(
      [
        photo('videos', 'image', 3),
        video('videos', 'clip-avec', 2, true),
        video('videos', 'clip-sans', 1, false),
      ],
      '2026-07-03T12:00:00.000Z',
    );
    const { rendus, origines, renderer } = fauxRenderer();

    const resultat = await new PrechauffeurInstantane(deps('videos', renderer)).run();

    // The route rejects the video without a preview with 415: preparing it would
    // spend one Drive call per pass on an impossible derivative.
    assert.deepEqual(rendus, ['image', 'clip-avec']);
    // A video with one starts from the preview, never the original: tens of KB
    // rather than a 48 MB MP4 that would be fetched and discarded.
    assert.equal(origines.get('clip-avec'), 'poster');
    assert.equal(origines.get('image'), 'original');
    assert.equal(resultat.rendered, 2);
  });

  it('stops when the cache reaches its share', async () => {
    media.upsertMany(
      [photo('budget', 'p1', 1), photo('budget', 'p2', 2), photo('budget', 'p3', 3)],
      '2026-07-03T12:00:00.000Z',
    );
    const { rendus, renderer } = fauxRenderer();

    // Cache already beyond its share: eviction is global LRU, so continuing
    // would evict 15 KB grid thumbnails for 1 MB full-page renders nobody asked for.
    const plein = {
      stats: () => ({ entryCount: 0, bytes: 8_000_000, maxBytes: 10_000_000 }),
    } as unknown as MediaCache;

    const resultat = await new PrechauffeurInstantane(
      deps('budget', renderer, { cache: plein }),
    ).run();

    assert.deepEqual(rendus, []);
    assert.equal(resultat.stopped, 'budget');
  });

  it('does nothing when the setting is disabled', async () => {
    media.upsertMany([photo('coupe', 'z', 1)], '2026-07-01T12:00:00.000Z');
    const { rendus, renderer } = fauxRenderer();

    const resultat = await new PrechauffeurInstantane(
      deps('coupe', renderer, { enabled: () => false }),
    ).run();

    assert.deepEqual(rendus, []);
    assert.equal(resultat.rendered, 0);
  });

  it('stops midway if the setting is disabled', async () => {
    media.upsertMany(
      [photo('bascule', 'b1', 1), photo('bascule', 'b2', 2), photo('bascule', 'b3', 3)],
      '2026-07-03T12:00:00.000Z',
    );
    const { rendus, renderer } = fauxRenderer();

    let actif = true;
    const resultat = await new PrechauffeurInstantane(
      // Disabling during a pass must stop it, not merely prevent the next one:
      // it is disabled precisely because it is causing disruption.
      deps('bascule', renderer, {
        enabled: () => {
          const valeur = actif;
          actif = false;
          return valeur;
        },
      }),
    ).run();

    assert.equal(rendus.length, 0);
    assert.equal(resultat.stopped, 'stopped');
  });

  it('continues after an unreadable photo', async () => {
    media.upsertMany(
      [photo('casse', 'bonne1', 3), photo('casse', 'cassee', 2), photo('casse', 'bonne2', 1)],
      '2026-07-03T12:00:00.000Z',
    );
    const { rendus, renderer } = fauxRenderer({ echoue: new Set(['cassee']) });

    const resultat = await new PrechauffeurInstantane(deps('casse', renderer)).run();

    // An unreadable file or Drive refusal must not stop the pass: subsequent
    // photos are unrelated.
    assert.deepEqual(rendus, ['bonne1', 'bonne2']);
    assert.equal(resultat.failed, 1);
  });

  it('rejects two concurrent passes', async () => {
    media.upsertMany([photo('double', 'd1', 1)], '2026-07-01T12:00:00.000Z');
    const { rendus, renderer } = fauxRenderer();
    const prechauffeur = new PrechauffeurInstantane(deps('double', renderer));

    // Two passes would double limiter occupancy and Drive traffic, precisely
    // what the design avoids.
    const [premier, second] = await Promise.all([prechauffeur.run(), prechauffeur.run()]);

    assert.equal(premier.rendered + second.rendered, 1);
    assert.deepEqual(rendus, ['d1']);
  });
});
