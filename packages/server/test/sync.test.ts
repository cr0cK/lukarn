import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import type { drive_v3 } from '@googleapis/drive';
import { openDb } from '../src/db.js';
import type { DriveService } from '../src/drive/service.js';
import { Syncer } from '../src/drive/sync.js';
import { MediaRepo, SyncStateRepo } from '../src/repo.js';

/**
 * Déduplication des synchronisations. Deux appels sur le même album partagent
 * le même travail — sauf s'ils ne visent pas le même dossier Drive, auquel cas
 * partager reviendrait à indexer le dossier que le propriétaire vient de
 * quitter.
 */

const dir = mkdtempSync(join(tmpdir(), 'gdv-sync-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const db = openDb(dir);
after(() => db.close());

const media = new MediaRepo(db);
const syncState = new SyncStateRepo(db);
const silencieux = { info: () => {}, warn: () => {}, error: () => {} };

function fichier(id: string): drive_v3.Schema$File {
  return {
    id,
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    modifiedTime: '2026-01-01T10:00:00.000Z',
  };
}

/** Drive de complaisance : un dossier, sa liste, et une barrière optionnelle. */
function fauxDrive(
  contenu: Record<string, string[]>,
  barrieres: Record<string, Promise<void>> = {},
): DriveService {
  return {
    guard: <T>(operation: () => Promise<T>) => operation(),
    api: () => ({
      files: {
        list: async ({ q }: { q?: string }) => {
          const dossier = /'([^']+)' in parents/.exec(q ?? '')?.[1] ?? '';
          await barrieres[dossier];
          return { data: { files: (contenu[dossier] ?? []).map(fichier) } };
        },
      },
    }),
  } as unknown as DriveService;
}

function contenuIndexe(albumId: string): string[] {
  return media
    .listItems(albumId, 100, null)
    .items.map((item) => item.id)
    .sort();
}

describe('déduplication des synchronisations', () => {
  it('partage le travail entre deux demandes identiques', async () => {
    const syncer = new Syncer(fauxDrive({ 'dossier-a': ['a1'] }), media, syncState, silencieux);
    const album = { id: 'stable', folderId: 'dossier-a', recursive: true };

    const premiere = syncer.sync(album);
    const seconde = syncer.sync(album);

    assert.equal(premiere, seconde, 'une resync manuelle ne doit pas doubler le travail');
    await premiere;
  });

  it("relance le travail quand le dossier de l'album a changé entre-temps", async () => {
    let ouvrir = (): void => {};
    const barriere = new Promise<void>((resolve) => {
      ouvrir = resolve;
    });

    const syncer = new Syncer(
      fauxDrive({ 'dossier-a': ['a1', 'a2'], 'dossier-b': ['b1'] }, { 'dossier-a': barriere }),
      media,
      syncState,
      silencieux,
    );

    const premiere = syncer.sync({ id: 'demenage', folderId: 'dossier-a', recursive: true });
    // Le propriétaire corrige le dossier pendant que la première tourne.
    const seconde = syncer.sync({ id: 'demenage', folderId: 'dossier-b', recursive: true });

    assert.notEqual(
      premiere,
      seconde,
      "la sync du nouveau dossier ne peut pas être celle de l'ancien",
    );

    // La première sync met un temps mesurable à revenir, comme un vrai parcours
    // Drive : les deux passages portent ainsi des estampilles distinctes.
    await new Promise((resolve) => setTimeout(resolve, 10));
    ouvrir();
    await premiere;
    await seconde;

    // Sans distinction de configuration, l'appelant recevait la promesse de
    // l'ancienne sync et l'album se retrouvait rempli du dossier abandonné.
    assert.deepEqual(contenuIndexe('demenage'), ['b1']);
  });

  it('distingue aussi un changement de profondeur', async () => {
    const syncer = new Syncer(fauxDrive({ 'dossier-c': ['c1'] }), media, syncState, silencieux);

    const recursive = syncer.sync({ id: 'profondeur', folderId: 'dossier-c', recursive: true });
    const plat = syncer.sync({ id: 'profondeur', folderId: 'dossier-c', recursive: false });

    assert.notEqual(recursive, plat);
    await recursive;
    await plat;
  });

  it("n'écrit plus rien une fois l'album reconfiguré sous ses pieds", async () => {
    let ouvrirD = (): void => {};
    let ouvrirE = (): void => {};
    const barriereD = new Promise<void>((resolve) => {
      ouvrirD = resolve;
    });
    const barriereE = new Promise<void>((resolve) => {
      ouvrirE = resolve;
    });

    const syncer = new Syncer(
      fauxDrive(
        { 'dossier-d': ['d1'], 'dossier-e': ['e1'] },
        { 'dossier-d': barriereD, 'dossier-e': barriereE },
      ),
      media,
      syncState,
      silencieux,
    );

    const premiere = syncer.sync({ id: 'perime', folderId: 'dossier-d', recursive: true });
    const seconde = syncer.sync({ id: 'perime', folderId: 'dossier-e', recursive: true });

    // Ce que fait la route PATCH quand le dossier change : purger l'index sans
    // attendre, pour que l'album cesse tout de suite de montrer l'ancien
    // contenu. C'est cette purge que le passage périmé ne doit pas défaire.
    media.clearAlbum('perime');

    ouvrirD();
    const resultat = await premiere;
    assert.equal(resultat.superseded, true, 'le passage périmé doit se déclarer abandonné');
    assert.deepEqual(
      contenuIndexe('perime'),
      [],
      'un passage périmé qui réinsère rend visibles les photos que le propriétaire vient de retirer',
    );

    ouvrirE();
    await seconde;
    assert.deepEqual(contenuIndexe('perime'), ['e1']);
  });
});
