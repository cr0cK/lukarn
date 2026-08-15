import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { openDb } from '../src/db.js';
import type { StorageEntry, StorageProvider } from '../src/storage/provider.js';
import { Syncer } from '../src/sync/sync.js';
import { MediaRepo, SyncStateRepo } from '../src/repo.js';

/**
 * Synchronisation deduplication. Two calls for the same album share the same
 * work — unless they target different folders, in which case sharing would
 * index the folder the owner has just left.
 */

const dir = mkdtempSync(join(tmpdir(), 'lukarn-sync-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const db = openDb(dir);
after(() => db.close());

const media = new MediaRepo(db);
const syncState = new SyncStateRepo(db);
const silencieux = { info: () => {}, warn: () => {}, error: () => {} };

function fichier(ref: string): StorageEntry {
  return {
    ref,
    name: `${ref}.jpg`,
    folder: false,
    mimeType: 'image/jpeg',
    size: 1024,
    modifiedTime: '2026-01-01T10:00:00.000Z',
    version: null,
    media: null,
    hasPreview: true,
  };
}

/**
 * Fixture storage: a container, its listing and an optional barrier.
 *
 * Faking a provider rather than `files.list` is the point of the interface: the
 * whole fixture is one function returning entries, where reproducing Drive's
 * behaviour required parsing a `q` clause with a regular expression.
 */
function fauxStockage(
  contenu: Record<string, string[]>,
  barrieres: Record<string, Promise<void>> = {},
): StorageProvider {
  return {
    guard: <T>(operation: () => Promise<T>) => operation(),
    list: async (container: string) => {
      await barrieres[container];
      return { entries: (contenu[container] ?? []).map(fichier), cursor: null };
    },
  } as unknown as StorageProvider;
}

function contenuIndexe(albumId: string): string[] {
  return media
    .listItems(albumId, 100, null)
    .items.map((item) => item.id)
    .sort();
}

describe('synchronisation deduplication', () => {
  it('shares work between two identical requests', async () => {
    const syncer = new Syncer(fauxStockage({ 'dossier-a': ['a1'] }), media, syncState, silencieux);
    const album = { id: 'stable', folderId: 'dossier-a', recursive: true };

    const premiere = syncer.sync(album);
    const seconde = syncer.sync(album);

    assert.equal(premiere, seconde, 'a manual resynchronisation must not duplicate the work');
    await premiere;
  });

  it('restarts the work when the album folder changes in the meantime', async () => {
    let ouvrir = (): void => {};
    const barriere = new Promise<void>((resolve) => {
      ouvrir = resolve;
    });

    const syncer = new Syncer(
      fauxStockage({ 'dossier-a': ['a1', 'a2'], 'dossier-b': ['b1'] }, { 'dossier-a': barriere }),
      media,
      syncState,
      silencieux,
    );

    const premiere = syncer.sync({ id: 'demenage', folderId: 'dossier-a', recursive: true });
    // The owner corrects the folder while the first run is in progress.
    const seconde = syncer.sync({ id: 'demenage', folderId: 'dossier-b', recursive: true });

    assert.notEqual(premiere, seconde, 'the new folder synchronisation cannot be the old one');

    // The first synchronisation takes a measurable time to return, like a real
    // traversal, so the two runs carry distinct timestamps.
    await new Promise((resolve) => setTimeout(resolve, 10));
    ouvrir();
    await premiere;
    await seconde;

    // Without distinguishing configurations, the caller would receive the old
    // synchronisation promise and the album would be filled from the abandoned folder.
    assert.deepEqual(contenuIndexe('demenage'), ['b1']);
  });

  it('also distinguishes a change in traversal depth', async () => {
    const syncer = new Syncer(fauxStockage({ 'dossier-c': ['c1'] }), media, syncState, silencieux);

    const recursive = syncer.sync({ id: 'profondeur', folderId: 'dossier-c', recursive: true });
    const plat = syncer.sync({ id: 'profondeur', folderId: 'dossier-c', recursive: false });

    assert.notEqual(recursive, plat);
    await recursive;
    await plat;
  });

  it('stops writing once the album is reconfigured underneath it', async () => {
    let ouvrirD = (): void => {};
    let ouvrirE = (): void => {};
    const barriereD = new Promise<void>((resolve) => {
      ouvrirD = resolve;
    });
    const barriereE = new Promise<void>((resolve) => {
      ouvrirE = resolve;
    });

    const syncer = new Syncer(
      fauxStockage(
        { 'dossier-d': ['d1'], 'dossier-e': ['e1'] },
        { 'dossier-d': barriereD, 'dossier-e': barriereE },
      ),
      media,
      syncState,
      silencieux,
    );

    const premiere = syncer.sync({ id: 'perime', folderId: 'dossier-d', recursive: true });
    const seconde = syncer.sync({ id: 'perime', folderId: 'dossier-e', recursive: true });

    // This is what the PATCH route does when the folder changes: it clears the
    // index immediately so the album stops showing old content. The stale run
    // must not undo that purge.
    media.clearAlbum('perime');

    ouvrirD();
    const resultat = await premiere;
    assert.equal(resultat.superseded, true, 'the stale run must report itself as superseded');
    assert.deepEqual(
      contenuIndexe('perime'),
      [],
      'a stale run that reinserts data exposes photos the owner has just removed',
    );

    ouvrirE();
    await seconde;
    assert.deepEqual(contenuIndexe('perime'), ['e1']);
  });
});
