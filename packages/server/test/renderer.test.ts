import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import { DriveUnavailableError, type DriveService } from '../src/drive/service.js';
import { MediaCache } from '../src/media/cache.js';
import { MediaRenderer } from '../src/media/renderer.js';

/**
 * WebP derivative production. Both scenarios covered here require rendering to
 * recover by itself: a cache file disappearing underneath it, and an image the
 * bundled libvips cannot decode.
 */

const root = mkdtempSync(join(tmpdir(), 'lukarn-renderer-'));
after(() => rmSync(root, { recursive: true, force: true }));

const silencieux = { warn: () => {} };

let jpeg: Buffer;
before(async () => {
  jpeg = await sharp({
    create: { width: 32, height: 24, channels: 3, background: { r: 200, g: 30, b: 60 } },
  })
    .jpeg()
    .toBuffer();
});

describe('rendering from cache', () => {
  it('regenerates a derivative whose file disappeared from disk', async () => {
    const cache = new MediaCache(join(root, 'disparu'), 1024 * 1024);
    await cache.load();

    let telechargements = 0;
    const drive = {
      fetchFile: () => {
        telechargements++;
        return Promise.resolve(new Response(jpeg));
      },
    } as unknown as DriveService;

    const renderer = new MediaRenderer(drive, cache, silencieux);
    const premier = await renderer.render('photo', { kind: 'thumb', size: 320 }, 'empreinte');
    assert.equal(telechargements, 1);

    // "Clear cache" from /admin, or manual cleanup on the volume: the in-memory
    // inventory then points to a file that no longer exists.
    rmSync(premier.path);

    const second = await renderer.render('photo', { kind: 'thumb', size: 320 }, 'empreinte');

    assert.equal(telechargements, 2, 'the missing derivative must be rebuilt');
    assert.ok(existsSync(second.path), 'the returned path must be readable');
  });
});

describe('preparing multiple variants', () => {
  it('downloads the original only once for all three sizes', async () => {
    const cache = new MediaCache(join(root, 'prepare'), 1024 * 1024);
    await cache.load();

    let telechargements = 0;
    const drive = {
      fetchFile: () => {
        telechargements++;
        return Promise.resolve(new Response(jpeg));
      },
    } as unknown as DriveService;

    const renderer = new MediaRenderer(drive, cache, silencieux);
    const produits = await renderer.prepare(
      'photo',
      [
        { kind: 'thumb', size: 320 },
        { kind: 'thumb', size: 640 },
        { kind: 'thumb', size: 1280 },
      ],
      'empreinte',
    );

    // This is the entire point of this path: downloading takes ~2 s while
    // rendering takes ~50 ms. Three successive `render()` calls would fetch the
    // same file three times, tripling prewarming's Drive traffic.
    assert.equal(telechargements, 1, 'one download for all three sizes');
    assert.equal(produits, 3);

    for (const size of [320, 640, 1280] as const) {
      assert.ok(renderer.isCached('photo', { kind: 'thumb', size }, 'empreinte'));
    }
  });

  it('neither rebuilds nor redownloads what is already cached', async () => {
    const cache = new MediaCache(join(root, 'prepare-cache'), 1024 * 1024);
    await cache.load();

    let telechargements = 0;
    const drive = {
      fetchFile: () => {
        telechargements++;
        return Promise.resolve(new Response(jpeg));
      },
    } as unknown as DriveService;

    const renderer = new MediaRenderer(drive, cache, silencieux);
    const variants = [
      { kind: 'thumb', size: 320 },
      { kind: 'thumb', size: 640 },
    ] as const;

    await renderer.prepare('photo', [...variants], null);
    const seconde = await renderer.prepare('photo', [...variants], null);

    // A prewarming pass revisits the same albums hour after hour: without this
    // short circuit, it would redownload the entire library on every pass.
    assert.equal(seconde, 0);
    assert.equal(telechargements, 1);
  });

  it('requests the Drive preview at the largest required size', async () => {
    const cache = new MediaCache(join(root, 'prepare-repli'), 1024 * 1024);
    await cache.load();

    const urls: string[] = [];
    const drive = {
      fetchFile: () => Promise.resolve(new Response(Buffer.from('ni JPEG ni HEIC lisible'))),
      guard: <T>(operation: () => Promise<T>) => operation(),
      api: () => ({
        files: {
          get: () => Promise.resolve({ data: { thumbnailLink: 'https://lh3.exemple/Q=s220' } }),
        },
      }),
      fetchAuthorized: (url: string) => {
        urls.push(url);
        return Promise.resolve(new Response(jpeg));
      },
    } as unknown as DriveService;

    const renderer = new MediaRenderer(drive, cache, silencieux);
    const produits = await renderer.prepare(
      'heic',
      [
        { kind: 'thumb', size: 320 },
        { kind: 'thumb', size: 1280 },
      ],
      null,
    );

    // The preview is the source for subsequent sizes, and `withoutEnlargement`
    // prevents scaling up: requesting 320 would store a 320 px thumbnail under
    // the 1280 key.
    assert.deepEqual(urls, ['https://lh3.exemple/Q=s1280']);
    assert.equal(produits, 2);
  });
});

describe('video preview', () => {
  it('starts from the Drive preview without ever touching the original', async () => {
    const cache = new MediaCache(join(root, 'poster'), 1024 * 1024);
    await cache.load();

    const urls: string[] = [];
    const drive = {
      fetchFile: () => {
        throw new Error('a video original must never be downloaded');
      },
      guard: <T>(operation: () => Promise<T>) => operation(),
      api: () => ({
        files: {
          get: () => Promise.resolve({ data: { thumbnailLink: 'https://lh3.exemple/Vid=s220' } }),
        },
      }),
      fetchAuthorized: (url: string) => {
        urls.push(url);
        return Promise.resolve(new Response(jpeg));
      },
    } as unknown as DriveService;

    const renderer = new MediaRenderer(drive, cache, silencieux);
    const produits = await renderer.prepare(
      'clip',
      [
        { kind: 'thumb', size: 320 },
        { kind: 'thumb', size: 640 },
        { kind: 'thumb', size: 1280 },
      ],
      'empreinte',
      'poster',
    );

    // Fetching a 48 MB MP4 only for `MAX_DECODE_BYTES` to reject it on every
    // thumbnail is precisely what the short circuit avoids: no video byte is
    // transferred, and D6 (no transcoding) remains intact.
    assert.deepEqual(urls, ['https://lh3.exemple/Vid=s1280'], 'one preview at the largest size');
    assert.equal(produits, 3);

    for (const size of [320, 640, 1280] as const) {
      assert.ok(renderer.isCached('clip', { kind: 'thumb', size }, 'empreinte'));
    }
  });

  it('serves an isolated render from the preview without another fallback', async () => {
    const cache = new MediaCache(join(root, 'poster-unique'), 1024 * 1024);
    await cache.load();

    let apercus = 0;
    const drive = {
      fetchFile: () => {
        throw new Error('a video original must never be downloaded');
      },
      guard: <T>(operation: () => Promise<T>) => operation(),
      api: () => ({
        files: {
          get: () => Promise.resolve({ data: { thumbnailLink: 'https://lh3.exemple/Vid=s220' } }),
        },
      }),
      fetchAuthorized: () => {
        apercus++;
        return Promise.resolve(new Response(jpeg));
      },
    } as unknown as DriveService;

    const renderer = new MediaRenderer(drive, cache, silencieux);
    const rendu = await renderer.render('clip', { kind: 'thumb', size: 320 }, null, 'poster');

    assert.ok(existsSync(rendu.path));
    // The Drive preview **is** the source: the photo path fallback has nothing
    // else to try, and requesting it again would only repeat the same call.
    assert.equal(apercus, 1);
  });
});

describe('fallback to the Drive thumbnail', () => {
  it('requests the thumbnail with the OAuth token rather than anonymously', async () => {
    const cache = new MediaCache(join(root, 'repli'), 1024 * 1024);
    await cache.load();

    const urlsAuthentifiees: string[] = [];
    const drive = {
      // Content sharp cannot decode: the HEIC/RAW case.
      fetchFile: () => Promise.resolve(new Response(Buffer.from('ceci n’est pas une image'))),
      guard: <T>(operation: () => Promise<T>) => operation(),
      api: () => ({
        files: {
          get: () => Promise.resolve({ data: { thumbnailLink: 'https://lh3.exemple/AbC=s220' } }),
        },
      }),
      fetchAuthorized: (url: string) => {
        urlsAuthentifiees.push(url);
        return Promise.resolve(new Response(jpeg));
      },
    } as unknown as DriveService;

    // A private file's `thumbnailLink` returns 401/403 without an Authorization
    // header: an anonymous call must fail clearly.
    const vraiFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error('anonymous call forbidden');
    };

    try {
      const renderer = new MediaRenderer(drive, cache, silencieux);
      const rendu = await renderer.render('heic', { kind: 'thumb', size: 320 }, null);

      assert.ok(existsSync(rendu.path));
      assert.deepEqual(urlsAuthentifiees, ['https://lh3.exemple/AbC=s320']);
    } finally {
      globalThis.fetch = vraiFetch;
    }
  });
});

describe('oversized original', () => {
  it('gives up based on the announced size and uses the Drive preview', async () => {
    const cache = new MediaCache(join(root, 'enorme'), 1024 * 1024);
    await cache.load();

    let repliDemande = 0;
    const drive = {
      // The body is a perfectly decodable image: only the size header should
      // trigger giving up. Without this check, sharp would decode it and the
      // fallback would never run — distinguishing this from an unsupported format.
      fetchFile: () =>
        Promise.resolve(
          new Response(jpeg, { headers: { 'content-length': String(500 * 1024 * 1024) } }),
        ),
      guard: <T>(operation: () => Promise<T>) => operation(),
      api: () => ({
        files: {
          get: () => Promise.resolve({ data: { thumbnailLink: 'https://lh3.exemple/XyZ=s220' } }),
        },
      }),
      fetchAuthorized: () => {
        repliDemande++;
        return Promise.resolve(new Response(jpeg));
      },
    } as unknown as DriveService;

    const renderer = new MediaRenderer(drive, cache, silencieux);
    const rendu = await renderer.render('panorama', { kind: 'full' }, null);

    // The photo is still served — as the Drive preview, not a failure: refusing
    // would show a broken grid cell for a valid file.
    assert.equal(repliDemande, 1, 'an oversized original must not be decoded locally');
    assert.ok(existsSync(rendu.path));
  });
});

describe('transient Drive failure', () => {
  it('reports unavailability when the fallback also fails', async () => {
    const cache = new MediaCache(join(root, 'transitoire'), 1024 * 1024);
    await cache.load();

    // The original download times out and the Drive preview also fails: this is
    // the only case where failure reaches the route, and it must remain
    // recognisably transient so the route returns 503 rather than 500 — a 500
    // would make the browser give up.
    const drive = {
      fetchFile: () => Promise.reject(new DriveUnavailableError('original', 5, 'timed out')),
      guard: <T>(operation: () => Promise<T>) => operation(),
      api: () => ({
        files: {
          get: () => Promise.resolve({ data: { thumbnailLink: 'https://lh3.exemple/AbC=s220' } }),
        },
      }),
      fetchAuthorized: () => Promise.reject(new DriveUnavailableError('preview', 5, 'Drive 429')),
    } as unknown as DriveService;

    const renderer = new MediaRenderer(drive, cache, silencieux);

    await assert.rejects(
      () => renderer.render('lent', { kind: 'thumb', size: 320 }, null),
      DriveUnavailableError,
    );
  });

  it('keeps nothing cached after a failure', async () => {
    // The invariant that makes retry possible: a failure must never be cached,
    // otherwise the thumbnail would remain broken until eviction.
    const cache = new MediaCache(join(root, 'sans-trace'), 1024 * 1024);
    await cache.load();

    const drive = {
      fetchFile: () => Promise.reject(new DriveUnavailableError('original', 5, 'timed out')),
      guard: <T>(operation: () => Promise<T>) => operation(),
      api: () => ({ files: { get: () => Promise.resolve({ data: {} }) } }),
      fetchAuthorized: () => Promise.reject(new Error('no preview')),
    } as unknown as DriveService;

    const renderer = new MediaRenderer(drive, cache, silencieux);
    await assert.rejects(() => renderer.render('lent', { kind: 'thumb', size: 320 }, null));

    assert.equal(cache.stats().entryCount, 0);
  });
});
