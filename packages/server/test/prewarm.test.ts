import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { openDb } from '../src/db.js';
import { MediaCache } from '../src/media/cache.js';
import { CachePrewarmer, type PrewarmDeps } from '../src/media/prewarm.js';
import type { MediaRenderer, Variant } from '../src/media/renderer.js';
import { MediaRepo, type MediaUpsert } from '../src/repo.js';

/**
 * Préchauffage du cache. Ce qui est vérifié ici n'est pas qu'il rend des
 * images — c'est qu'il reste **discret** : un préchauffage qui sature la
 * liaison, remplit le cache au détriment des vignettes ou ignore son
 * interrupteur serait pire que l'attente qu'il supprime.
 */

const dir = mkdtempSync(join(tmpdir(), 'gdv-prewarm-'));
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
  };
}

/** Préchauffeur dont l'attente est enregistrée au lieu d'être subie. */
class PrechauffeurInstantane extends CachePrewarmer {
  readonly attentes: number[] = [];

  protected override wait(ms: number): Promise<void> {
    this.attentes.push(ms);
    return Promise.resolve();
  }
}

interface FauxRenderer {
  rendus: string[];
  enCache: Set<string>;
  renderer: MediaRenderer;
}

function fauxRenderer(options: { echoue?: Set<string> } = {}): FauxRenderer {
  const rendus: string[] = [];
  const enCache = new Set<string>();
  const renderer = {
    isCached: (fileId: string) => enCache.has(fileId),
    render: (fileId: string, _variant: Variant) => {
      if (options.echoue?.has(fileId)) return Promise.reject(new Error('illisible'));
      rendus.push(fileId);
      enCache.add(fileId);
      return Promise.resolve({ path: `/faux/${fileId}`, contentType: 'image/webp' });
    },
  } as unknown as MediaRenderer;
  return { rendus, enCache, renderer };
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

describe('préchauffage du cache', () => {
  it('rend les photos les plus récentes en premier', async () => {
    media.upsertMany(
      [photo('recent', 'vieille', 1), photo('recent', 'moyenne', 15), photo('recent', 'neuve', 28)],
      '2026-07-28T12:00:00.000Z',
    );
    const { rendus, renderer } = fauxRenderer();

    const resultat = await new PrechauffeurInstantane(deps('recent', renderer)).run();

    // L'ordre n'est pas cosmétique : le cache est purgé en LRU, et ce sont les
    // photos récentes qu'on ouvre. Commencer par les vieilles reviendrait à
    // remplir le cache de ce que personne ne regarde plus.
    assert.deepEqual(rendus, ['neuve', 'moyenne', 'vieille']);
    assert.equal(resultat.rendered, 3);
  });

  it('marque une pause entre deux photos', async () => {
    media.upsertMany([photo('pause', 'a', 1), photo('pause', 'b', 2)], '2026-07-02T12:00:00.000Z');
    const { renderer } = fauxRenderer();

    const prechauffeur = new PrechauffeurInstantane(deps('pause', renderer));
    await prechauffeur.run();

    // Une photo à la fois, avec un temps mort : le limiteur de rendu a quatre
    // places, et le préchauffage ne doit jamais en occuper plus d'une — sans
    // quoi il passerait devant quelqu'un qui navigue.
    assert.deepEqual(prechauffeur.attentes, [1000, 1000]);
  });

  it('saute ce qui est déjà en cache sans le marquer comme consulté', async () => {
    media.upsertMany([photo('deja', 'x', 1), photo('deja', 'y', 2)], '2026-07-02T12:00:00.000Z');
    const { rendus, enCache, renderer } = fauxRenderer();
    enCache.add('y');

    const resultat = await new PrechauffeurInstantane(deps('deja', renderer)).run();

    assert.deepEqual(rendus, ['x']);
    assert.equal(resultat.skipped, 1);
  });

  it('s’arrête quand le cache atteint sa part', async () => {
    media.upsertMany(
      [photo('budget', 'p1', 1), photo('budget', 'p2', 2), photo('budget', 'p3', 3)],
      '2026-07-03T12:00:00.000Z',
    );
    const { rendus, renderer } = fauxRenderer();

    // Cache déjà rempli au-delà de la part autorisée : l'éviction est LRU
    // globale, et continuer évincerait les vignettes de la grille — 15 Ko
    // chacune, contre 1 Mo par rendu pleine page — pour des photos que
    // personne n'a demandées.
    const plein = {
      stats: () => ({ entryCount: 0, bytes: 8_000_000, maxBytes: 10_000_000 }),
    } as unknown as MediaCache;

    const resultat = await new PrechauffeurInstantane(
      deps('budget', renderer, { cache: plein }),
    ).run();

    assert.deepEqual(rendus, []);
    assert.equal(resultat.stopped, 'budget');
  });

  it('ne fait rien quand le réglage est décoché', async () => {
    media.upsertMany([photo('coupe', 'z', 1)], '2026-07-01T12:00:00.000Z');
    const { rendus, renderer } = fauxRenderer();

    const resultat = await new PrechauffeurInstantane(
      deps('coupe', renderer, { enabled: () => false }),
    ).run();

    assert.deepEqual(rendus, []);
    assert.equal(resultat.rendered, 0);
  });

  it('s’arrête en cours de route si le réglage est décoché', async () => {
    media.upsertMany(
      [photo('bascule', 'b1', 1), photo('bascule', 'b2', 2), photo('bascule', 'b3', 3)],
      '2026-07-03T12:00:00.000Z',
    );
    const { rendus, renderer } = fauxRenderer();

    let actif = true;
    const resultat = await new PrechauffeurInstantane(
      // Décocher pendant un passage doit l'arrêter, pas seulement empêcher le
      // suivant : on décoche précisément parce qu'on constate que ça gêne.
      deps('bascule', renderer, {
        enabled: () => {
          const valeur = actif;
          actif = false;
          return valeur;
        },
      }),
    ).run();

    assert.equal(rendus.length, 0);
    assert.equal(resultat.stopped, 'arret');
  });

  it('poursuit après une photo illisible', async () => {
    media.upsertMany(
      [photo('casse', 'bonne1', 3), photo('casse', 'cassee', 2), photo('casse', 'bonne2', 1)],
      '2026-07-03T12:00:00.000Z',
    );
    const { rendus, renderer } = fauxRenderer({ echoue: new Set(['cassee']) });

    const resultat = await new PrechauffeurInstantane(deps('casse', renderer)).run();

    // Un fichier illisible ou un refus de Drive ne doit pas interrompre le
    // passage : les photos suivantes n'y sont pour rien.
    assert.deepEqual(rendus, ['bonne1', 'bonne2']);
    assert.equal(resultat.failed, 1);
  });

  it('refuse deux passages concurrents', async () => {
    media.upsertMany([photo('double', 'd1', 1)], '2026-07-01T12:00:00.000Z');
    const { rendus, renderer } = fauxRenderer();
    const prechauffeur = new PrechauffeurInstantane(deps('double', renderer));

    // Deux passages doubleraient l'occupation du limiteur et le débit vers
    // Drive, ce que toute la conception cherche à éviter.
    const [premier, second] = await Promise.all([prechauffeur.run(), prechauffeur.run()]);

    assert.equal(premier.rendered + second.rendered, 1);
    assert.deepEqual(rendus, ['d1']);
  });
});
