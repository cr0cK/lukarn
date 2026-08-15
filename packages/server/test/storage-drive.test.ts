import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, describe, it } from 'node:test';
import type { drive_v3 } from '@googleapis/drive';
import { openDb } from '../src/db.js';
import { loadEnv } from '../src/env.js';
import { DEFAULT_CONNECTION_ID, StorageConnectionRepo } from '../src/storage/connections.js';
import { DriveService } from '../src/storage/drive.js';

/**
 * Drive seen through the storage interface: what `files.list` becomes, and where
 * a preview is fetched from.
 *
 * This is the translation layer the rest of the application now depends on —
 * everything downstream reads a `StorageEntry` and never a `Schema$File`. A
 * mapping error here surfaces as a portrait photo breaking the grid layout or a
 * cache serving a replaced file forever, both far from their cause.
 */

const root = mkdtempSync(join(tmpdir(), 'lukarn-drive-'));
after(() => rmSync(root, { recursive: true, force: true }));

const TOKEN_KEY = 'k'.repeat(48);

const env = loadEnv({
  NODE_ENV: 'test',
  SESSION_SECRET: 's'.repeat(48),
  TOKEN_KEY,
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  CONFIG_PATH: join(root, 'albums.yaml'),
  DATA_DIR: join(root, 'data'),
  CACHE_DIR: join(root, 'cache'),
  WEB_DIR: join(root, 'web'),
} as NodeJS.ProcessEnv);

const silent = { info: () => {}, warn: () => {} };

const db = openDb(join(root, 'data'));
after(() => db.close());

const connections = new StorageConnectionRepo(db, TOKEN_KEY);
connections.update(DEFAULT_CONNECTION_ID, {
  secret: 'refresh-token-factice',
  account: 'photos@exemple.fr',
});

/**
 * Drive with its two metadata calls stubbed. The access token is stubbed too:
 * the point of this fixture is the mapping, not a round trip to Google.
 */
class DriveStub extends DriveService {
  listed: drive_v3.Schema$File[] = [];
  nextPageToken: string | null = null;
  thumbnailLink: string | null = null;
  /** Page tokens received, so pagination can be observed from outside. */
  readonly pages: (string | undefined)[] = [];

  protected override accessToken(): Promise<string> {
    return Promise.resolve('jeton');
  }

  protected override api(): drive_v3.Drive {
    return {
      files: {
        list: (params: { pageToken?: string }) => {
          this.pages.push(params.pageToken);
          return Promise.resolve({
            data: { files: this.listed, nextPageToken: this.nextPageToken },
          });
        },
        get: () => Promise.resolve({ data: { thumbnailLink: this.thumbnailLink } }),
      },
    } as unknown as drive_v3.Drive;
  }
}

function service(): DriveStub {
  return new DriveStub(env, connections, DEFAULT_CONNECTION_ID, silent);
}

describe('listing translated into storage entries', () => {
  it('carries the fingerprint, the preview flag and the folder flag', async () => {
    const drive = service();
    drive.listed = [
      {
        id: 'photo-1',
        name: 'plage.jpg',
        mimeType: 'image/jpeg',
        size: '2048',
        modifiedTime: '2026-01-01T10:00:00.000Z',
        md5Checksum: 'empreinte',
        hasThumbnail: true,
      },
      { id: 'dossier-1', name: 'juillet', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'clip-1', name: 'clip.mp4', mimeType: 'video/mp4', hasThumbnail: false },
    ];

    const page = await drive.list('racine', null);

    // A folder has no `modifiedTime` in this listing and is kept regardless: the
    // traversal needs its reference, and nothing else about it.
    assert.deepEqual(
      page.entries.map((entry) => entry.ref),
      ['photo-1', 'dossier-1'],
    );
    const [photo, dossier] = page.entries;
    assert.equal(photo?.folder, false);
    // `md5Checksum` is what invalidates every derivative of a replaced file.
    assert.equal(photo?.version, 'empreinte');
    assert.equal(photo?.size, 2048);
    assert.equal(photo?.hasPreview, true);
    assert.equal(dossier?.folder, true);
  });

  it('normalises what Drive already knows about the picture', async () => {
    const drive = service();
    drive.listed = [
      {
        id: 'portrait',
        name: 'portrait.jpg',
        mimeType: 'image/jpeg',
        modifiedTime: '2026-01-01T10:00:00.000Z',
        imageMediaMetadata: {
          width: 4000,
          height: 3000,
          rotation: 1,
          time: '2026:07:14 09:30:00',
          cameraMake: ' Canon ',
          isoSpeed: 400,
          location: { latitude: 48.8566, longitude: 2.3522 },
        },
      },
    ];

    const media = (await drive.list('racine', null)).entries[0]?.media;

    // The dimensions stay as the sensor reported them; `rotated` is what says the
    // grid has to swap them, and doing it in one place keeps every backend honest.
    assert.equal(media?.width, 4000);
    assert.equal(media?.height, 3000);
    assert.equal(media?.rotated, true);
    assert.equal(media?.takenAt, '2026-07-14T09:30:00.000Z');
    assert.equal(media?.cameraMake, 'Canon');
    assert.equal(media?.isoSpeed, 400);
    assert.deepEqual([media?.lat, media?.lng], [48.8566, 2.3522]);
  });

  it('reports no metadata rather than an empty one', async () => {
    const drive = service();
    drive.listed = [
      {
        id: 'capture',
        name: 'capture.png',
        mimeType: 'image/png',
        modifiedTime: '2026-01-01T10:00:00.000Z',
      },
    ];

    // The distinction is the whole point of the field: `null` is what tells the
    // indexer it must read the bytes itself, which is how every other backend works.
    assert.equal((await drive.list('racine', null)).entries[0]?.media, null);
  });

  it('relays the page token as an opaque cursor', async () => {
    const drive = service();
    drive.nextPageToken = 'page-2';

    const premiere = await drive.list('racine', null);
    assert.equal(premiere.cursor, 'page-2');

    drive.nextPageToken = null;
    const seconde = await drive.list('racine', premiere.cursor);
    assert.equal(seconde.cursor, null);
    assert.deepEqual(drive.pages, [undefined, 'page-2']);
  });
});

describe('the preview Drive holds', () => {
  const vraiFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = vraiFetch;
  });

  it('asks for the requested size and carries the token', async () => {
    const drive = service();
    drive.thumbnailLink = 'https://lh3.exemple/AbC=s220';

    const appels: { url: string; authorization: string | null }[] = [];
    globalThis.fetch = (url: unknown, init?: { headers?: Record<string, string> }) => {
      appels.push({ url: String(url), authorization: init?.headers?.Authorization ?? null });
      return Promise.resolve(new Response('des octets'));
    };

    const response = await drive.preview('AbC', 640);

    assert.equal(response?.status, 200);
    // The link ends with `=s220`: without the substitution the fallback would
    // store a postage stamp under the key of a full-screen render. And a private
    // file's `thumbnailLink` answers 401/403 without the header — the fallback
    // meant for HEIC would fail exactly when it is needed.
    assert.deepEqual(appels, [
      { url: 'https://lh3.exemple/AbC=s640', authorization: 'Bearer jeton' },
    ]);
  });

  it('answers null when Drive holds none', async () => {
    const drive = service();
    drive.thumbnailLink = null;

    globalThis.fetch = () => {
      throw new Error('nothing to fetch without a link');
    };

    // A video Drive could not read, or a file uploaded moments ago. `null` is an
    // answer, not a failure: the renderer decides what to do with it.
    assert.equal(await drive.preview('sans-apercu', 320), null);
  });
});
