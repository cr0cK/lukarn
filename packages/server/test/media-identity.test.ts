import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { openDb } from '../src/db.js';
import { MediaRepo, SyncStateRepo } from '../src/repo.js';
import type { StorageEntry, StorageProvider, StorageRefKind } from '../src/storage/provider.js';
import { mediaId } from '../src/sync/metadata.js';
import { Syncer, type ProviderSource } from '../src/sync/sync.js';

/**
 * What the index stores as a file's identifier, and what it keeps to fetch it again.
 *
 * The two were the same string while Drive was the only backend. They cannot be for a
 * folder, a bucket or a WebDAV server: a path is not unique across connections and does
 * not survive a rename, and the identifier is what a comment thread, an album cover and
 * the disk cache are keyed on.
 */

const dir = mkdtempSync(join(tmpdir(), 'lukarn-identity-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const db = openDb(dir);
after(() => db.close());

const media = new MediaRepo(db);
const syncState = new SyncStateRepo(db);
const silencieux = { info: () => {}, warn: () => {}, error: () => {} };

function fichier(ref: string): StorageEntry {
  return {
    ref,
    name: ref.split('/').at(-1)!,
    folder: false,
    mimeType: 'image/jpeg',
    size: 1024,
    modifiedTime: '2026-01-01T10:00:00.000Z',
    version: 'v1',
    media: null,
    hasPreview: false,
  };
}

function fauxStockage(refKind: StorageRefKind, refs: string[]): ProviderSource {
  const provider = {
    refKind,
    guard: <T>(operation: () => Promise<T>) => operation(),
    list: () => Promise.resolve({ entries: refs.map(fichier), cursor: null }),
  } as unknown as StorageProvider;

  return { get: () => provider };
}

describe('a backend that names files by path', () => {
  it('hashes the path with the connection and keeps the path to fetch it', async () => {
    const syncer = new Syncer(
      fauxStockage('path', ['2026/plage.jpg']),
      media,
      syncState,
      silencieux,
    );
    await syncer.sync({
      id: 'dossier',
      connectionId: 'photos-nas',
      folderId: '',
      recursive: false,
    });

    const attendu = mediaId('photos-nas', '2026/plage.jpg');
    const item = media.listItems('dossier', 10, null).items[0]!;
    assert.equal(item.id, attendu);

    // Without the path the file could never be fetched again: the identifier is a
    // hash, and no storage can resolve one.
    const meta = media.getFileMeta(attendu);
    assert.equal(meta?.sourcePath, '2026/plage.jpg');
  });

  it('gives the same path on two connections two identifiers', async () => {
    for (const connectionId of ['nas-salon', 'nas-cave']) {
      const syncer = new Syncer(
        fauxStockage('path', ['2026/plage.jpg']),
        media,
        syncState,
        silencieux,
      );
      await syncer.sync({
        id: `album-${connectionId}`,
        connectionId,
        folderId: '',
        recursive: false,
      });
    }

    // Two people's backups, both holding `2026/plage.jpg`. Sharing an identifier
    // would put one album's comments on the other album's photograph.
    assert.notEqual(
      media.listItems('album-nas-salon', 10, null).items[0]!.id,
      media.listItems('album-nas-cave', 10, null).items[0]!.id,
    );
  });
});

describe('a backend whose references are identities', () => {
  it('stores the reference as-is and no path', async () => {
    const syncer = new Syncer(
      fauxStockage('identity', ['1AbC-dEf_GhI']),
      media,
      syncState,
      silencieux,
    );
    await syncer.sync({ id: 'drive', connectionId: 'drive', folderId: 'r', recursive: false });

    // A Drive file id outlives its name and its folder. Hashing it would break every
    // comment on every existing instance for nothing.
    const item = media.listItems('drive', 10, null).items[0]!;
    assert.equal(item.id, '1AbC-dEf_GhI');
    assert.equal(media.getFileMeta('1AbC-dEf_GhI')?.sourcePath, null);
  });
});
