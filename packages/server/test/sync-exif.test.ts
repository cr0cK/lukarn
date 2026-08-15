import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { openDb } from '../src/db.js';
import { MediaRepo, SyncStateRepo } from '../src/repo.js';
import type { StorageEntry, StorageProvider } from '../src/storage/provider.js';
import { Syncer, type ProviderSource } from '../src/sync/sync.js';

/**
 * Indexing a photograph whose backend supplies no metadata.
 *
 * The property that has to survive is D3: an album of several thousand photographs is
 * indexed without downloading it. Drive gets that free — it returns EXIF in the listing
 * — and a folder or a bucket gets it from one ranged window per **new** file, which is
 * what these cases pin down. A resync that reread every photograph would turn a
 * one-second pass into a three-hundred-megabyte one, every hour.
 */

const dir = mkdtempSync(join(tmpdir(), 'lukarn-sync-exif-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const db = openDb(dir);
after(() => db.close());

const media = new MediaRepo(db);
const syncState = new SyncStateRepo(db);
const silencieux = { info: () => {}, warn: () => {}, error: () => {} };

/** A JPEG whose `APP1` carries a date, a make and an orientation that swaps the axes. */
function photoJpeg(): Buffer {
  // IFD0: Make, Orientation, ExifIFDPointer. Exif sub-IFD: DateTimeOriginal.
  const header = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]);

  const field = (tag: number, type: number, count: number, value: number): Buffer => {
    const buffer = Buffer.alloc(12);
    buffer.writeUInt16BE(tag, 0);
    buffer.writeUInt16BE(type, 2);
    buffer.writeUInt32BE(count, 4);
    if (type === 3) buffer.writeUInt16BE(value, 8);
    else buffer.writeUInt32BE(value, 8);
    return buffer;
  };

  const ifd0At = 8;
  const exifAt = ifd0At + 2 + 3 * 12 + 4;
  const trailingAt = exifAt + 2 + 1 * 12 + 4;

  const make = Buffer.from('Pixel\0', 'latin1');
  const date = Buffer.from('2026:07:14 09:21:03\0', 'latin1');

  const ifd0 = Buffer.concat([
    Buffer.from([0x00, 0x03]),
    field(0x010f, 2, make.length, trailingAt),
    field(0x0112, 3, 1, 6),
    field(0x8769, 4, 1, exifAt),
    Buffer.alloc(4),
  ]);
  const exif = Buffer.concat([
    Buffer.from([0x00, 0x01]),
    field(0x9003, 2, date.length, trailingAt + make.length),
    Buffer.alloc(4),
  ]);

  const block = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), header, ifd0, exif, make, date]);

  const length = Buffer.alloc(2);
  length.writeUInt16BE(block.length + 2, 0);

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe1]),
    length,
    block,
    Buffer.from([0xff, 0xda, 0x00, 0x02]),
  ]);
}

interface Compteur {
  source: ProviderSource;
  /** Ranged reads the sync actually performed. */
  lectures: number;
}

function fauxStockage(version: string | null, bytes: Buffer): Compteur {
  const compteur: Compteur = { source: { get: () => provider }, lectures: 0 };

  const entry: StorageEntry = {
    ref: '2026/plage.jpg',
    name: 'plage.jpg',
    folder: false,
    mimeType: 'image/jpeg',
    size: bytes.length,
    modifiedTime: '2026-02-01T08:00:00.000Z',
    version,
    // What every backend but Drive reports: bytes, and nothing said about them.
    media: null,
    hasPreview: false,
  };

  const provider = {
    refKind: 'path',
    guard: <T>(operation: () => Promise<T>) => operation(),
    list: () => Promise.resolve({ entries: [entry], cursor: null }),
    fetch: () => {
      compteur.lectures++;
      return Promise.resolve(new Response(bytes));
    },
  } as unknown as StorageProvider;

  return compteur;
}

describe('a photograph whose backend supplies no metadata', () => {
  it('reads its date, camera and orientation from one window', async () => {
    const stockage = fauxStockage('v1', photoJpeg());
    const syncer = new Syncer(stockage.source, media, syncState, silencieux);
    await syncer.sync({ id: 'plage', connectionId: 'nas', folderId: '', recursive: false });

    const item = media.listItems('plage', 10, null).items[0]!;
    // The device's clock, not the file's modification date — which is what the album
    // would otherwise be ordered by, putting a holiday in the month it was copied.
    assert.equal(item.takenAt, '2026-07-14T09:21:03.000Z');
    assert.equal(item.takenAtFromExif, true);
    assert.equal(stockage.lectures, 1, 'one ranged window, not the whole file');
  });

  it('does not read it again while the backend reports the same version', async () => {
    const stockage = fauxStockage('v1', photoJpeg());
    const syncer = new Syncer(stockage.source, media, syncState, silencieux);
    const album = { id: 'repete', connectionId: 'nas', folderId: '', recursive: false };

    await syncer.sync(album);
    await syncer.sync(album);
    await syncer.sync(album);

    // Unchanged bytes hold unchanged EXIF. Without this, hourly resyncs of a library of
    // five thousand photographs would fetch three hundred megabytes to learn nothing.
    assert.equal(stockage.lectures, 1);
    assert.equal(
      media.listItems('repete', 10, null).items[0]!.takenAt,
      '2026-07-14T09:21:03.000Z',
      'the shortcut must keep the date it skipped rereading',
    );
  });

  it('reads it again when the content changed', async () => {
    const premier = fauxStockage('v1', photoJpeg());
    const album = { id: 'modifie', connectionId: 'nas', folderId: '', recursive: false };
    await new Syncer(premier.source, media, syncState, silencieux).sync(album);

    const second = fauxStockage('v2', photoJpeg());
    await new Syncer(second.source, media, syncState, silencieux).sync(album);

    // A photograph replaced in place — a re-export, a rotation applied on the phone —
    // keeps its path and changes its version. Trusting the index here would show the
    // old date forever.
    assert.equal(second.lectures, 1);
  });

  it('falls back to the modification date when there is no EXIF at all', async () => {
    const stockage = fauxStockage('v1', Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]));
    const syncer = new Syncer(stockage.source, media, syncState, silencieux);
    await syncer.sync({ id: 'capture', connectionId: 'nas', folderId: '', recursive: false });

    // A screenshot. Ordinary, not an error: the file's own date is the only
    // chronological reference left, and the column says the date is not from the file.
    const item = media.listItems('capture', 10, null).items[0]!;
    assert.equal(item.takenAt, '2026-02-01T08:00:00.000Z');
    assert.equal(item.takenAtFromExif, false);
  });

  it('never reads a byte when the backend already knows', async () => {
    const stockage = fauxStockage('v1', photoJpeg());
    const provider = stockage.source.get('nas') as StorageProvider & {
      list: () => Promise<{ entries: StorageEntry[]; cursor: null }>;
    };
    const original = provider.list;
    provider.list = async () => {
      const page = await original();
      return {
        ...page,
        entries: page.entries.map((entry) => ({
          ...entry,
          media: {
            width: 4032,
            height: 3024,
            rotated: false,
            takenAt: '2026-05-05T12:00:00.000Z',
            cameraMake: 'Drive',
            cameraModel: null,
            lens: null,
            isoSpeed: null,
            exposureTime: null,
            aperture: null,
            focalLength: null,
            lat: null,
            lng: null,
            durationMs: null,
          },
        })),
      };
    };

    const syncer = new Syncer(stockage.source, media, syncState, silencieux);
    await syncer.sync({ id: 'drive-like', connectionId: 'nas', folderId: '', recursive: false });

    // D3 unchanged for Drive: a backend that answers in the listing is never asked for
    // bytes, and adding a second backend must not have cost it that.
    assert.equal(stockage.lectures, 0);
    assert.equal(
      media.listItems('drive-like', 10, null).items[0]!.takenAt,
      '2026-05-05T12:00:00.000Z',
    );
  });
});
