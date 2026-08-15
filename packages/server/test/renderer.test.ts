import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import { MediaCache } from '../src/media/cache.js';
import { MediaRenderer } from '../src/media/renderer.js';
import { StorageUnavailableError, type StorageProvider } from '../src/storage/provider.js';

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

/**
 * Fixture storage. Only three operations exist, so a fake is a couple of
 * functions — `guard` runs the operation, translating a backend failure being the
 * provider's business rather than what is under test here.
 */
function stockage(parts: Partial<StorageProvider>): StorageProvider {
  return {
    guard: <T>(operation: () => Promise<T>) => operation(),
    ...parts,
  } as unknown as StorageProvider;
}

describe('rendering from cache', () => {
  it('regenerates a derivative whose file disappeared from disk', async () => {
    const cache = new MediaCache(join(root, 'disparu'), 1024 * 1024);
    await cache.load();

    let telechargements = 0;
    const storage = stockage({
      fetch: () => {
        telechargements++;
        return Promise.resolve(new Response(jpeg));
      },
    });

    const renderer = new MediaRenderer(cache, silencieux);
    const premier = await renderer.render(
      storage,
      'photo',
      { kind: 'thumb', size: 320 },
      'empreinte',
    );
    assert.equal(telechargements, 1);

    // "Clear cache" from /admin, or manual cleanup on the volume: the in-memory
    // inventory then points to a file that no longer exists.
    rmSync(premier.path);

    const second = await renderer.render(
      storage,
      'photo',
      { kind: 'thumb', size: 320 },
      'empreinte',
    );

    assert.equal(telechargements, 2, 'the missing derivative must be rebuilt');
    assert.ok(existsSync(second.path), 'the returned path must be readable');
  });
});

describe('preparing multiple variants', () => {
  it('downloads the original only once for all three sizes', async () => {
    const cache = new MediaCache(join(root, 'prepare'), 1024 * 1024);
    await cache.load();

    let telechargements = 0;
    const storage = stockage({
      fetch: () => {
        telechargements++;
        return Promise.resolve(new Response(jpeg));
      },
    });

    const renderer = new MediaRenderer(cache, silencieux);
    const produits = await renderer.prepare(
      storage,
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
    // same file three times, tripling prewarming's traffic.
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
    const storage = stockage({
      fetch: () => {
        telechargements++;
        return Promise.resolve(new Response(jpeg));
      },
    });

    const renderer = new MediaRenderer(cache, silencieux);
    const variants = [
      { kind: 'thumb', size: 320 },
      { kind: 'thumb', size: 640 },
    ] as const;

    await renderer.prepare(storage, 'photo', [...variants], null);
    const seconde = await renderer.prepare(storage, 'photo', [...variants], null);

    // A prewarming pass revisits the same albums hour after hour: without this
    // short circuit, it would redownload the entire library on every pass.
    assert.equal(seconde, 0);
    assert.equal(telechargements, 1);
  });

  it('asks for the backend preview at the largest required size', async () => {
    const cache = new MediaCache(join(root, 'prepare-repli'), 1024 * 1024);
    await cache.load();

    const bords: number[] = [];
    const storage = stockage({
      fetch: () => Promise.resolve(new Response(Buffer.from('ni JPEG ni HEIC lisible'))),
      preview: (_ref: string, edge: number) => {
        bords.push(edge);
        return Promise.resolve(new Response(jpeg));
      },
    });

    const renderer = new MediaRenderer(cache, silencieux);
    const produits = await renderer.prepare(
      storage,
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
    assert.deepEqual(bords, [1280]);
    assert.equal(produits, 2);
  });
});

describe('video preview', () => {
  it('starts from the backend preview without ever touching the original', async () => {
    const cache = new MediaCache(join(root, 'poster'), 1024 * 1024);
    await cache.load();

    const bords: number[] = [];
    const storage = stockage({
      fetch: () => {
        throw new Error('a video original must never be downloaded');
      },
      preview: (_ref: string, edge: number) => {
        bords.push(edge);
        return Promise.resolve(new Response(jpeg));
      },
    });

    const renderer = new MediaRenderer(cache, silencieux);
    const produits = await renderer.prepare(
      storage,
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
    assert.deepEqual(bords, [1280], 'one preview at the largest size');
    assert.equal(produits, 3);

    for (const size of [320, 640, 1280] as const) {
      assert.ok(renderer.isCached('clip', { kind: 'thumb', size }, 'empreinte'));
    }
  });

  it('serves an isolated render from the preview without another fallback', async () => {
    const cache = new MediaCache(join(root, 'poster-unique'), 1024 * 1024);
    await cache.load();

    let apercus = 0;
    const storage = stockage({
      fetch: () => {
        throw new Error('a video original must never be downloaded');
      },
      preview: () => {
        apercus++;
        return Promise.resolve(new Response(jpeg));
      },
    });

    const renderer = new MediaRenderer(cache, silencieux);
    const rendu = await renderer.render(
      storage,
      'clip',
      { kind: 'thumb', size: 320 },
      null,
      'poster',
    );

    assert.ok(existsSync(rendu.path));
    // The backend preview **is** the source: the photo path fallback has nothing
    // else to try, and requesting it again would only repeat the same call.
    assert.equal(apercus, 1);
  });
});

describe('fallback to the backend preview', () => {
  it('goes through the provider rather than fetching a URL itself', async () => {
    const cache = new MediaCache(join(root, 'repli'), 1024 * 1024);
    await cache.load();

    let apercus = 0;
    const storage = stockage({
      // Content sharp cannot decode: the HEIC/RAW case.
      fetch: () => Promise.resolve(new Response(Buffer.from('ceci n’est pas une image'))),
      preview: () => {
        apercus++;
        return Promise.resolve(new Response(jpeg));
      },
    });

    // Whatever authentication a preview needs belongs to the backend holding it —
    // a Drive `thumbnailLink` returns 401/403 without an `Authorization` header.
    // The renderer knowing no URL is what keeps that guarantee in one place: an
    // anonymous call from here must be impossible.
    const vraiFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error('the renderer must not reach the network itself');
    };

    try {
      const renderer = new MediaRenderer(cache, silencieux);
      const rendu = await renderer.render(storage, 'heic', { kind: 'thumb', size: 320 }, null);

      assert.ok(existsSync(rendu.path));
      assert.equal(apercus, 1);
    } finally {
      globalThis.fetch = vraiFetch;
    }
  });

  it('says so when the backend holds no preview', async () => {
    const cache = new MediaCache(join(root, 'sans-apercu'), 1024 * 1024);
    await cache.load();

    // A local folder or a bucket holds no preview: `null` is its answer, and the
    // renderer has nothing left to serve. Naming the file is the whole point —
    // the alternative is a HEIC missing from the grid for no stated reason.
    const storage = stockage({
      fetch: () => Promise.resolve(new Response(Buffer.from('ni JPEG ni HEIC lisible'))),
      preview: () => Promise.resolve(null),
    });

    const renderer = new MediaRenderer(cache, silencieux);
    await assert.rejects(
      () => renderer.render(storage, 'brut', { kind: 'thumb', size: 320 }, null),
      /no preview for brut/,
    );
  });
});

describe('oversized original', () => {
  it('gives up based on the announced size and uses the backend preview', async () => {
    const cache = new MediaCache(join(root, 'enorme'), 1024 * 1024);
    await cache.load();

    let repliDemande = 0;
    const storage = stockage({
      // The body is a perfectly decodable image: only the size header should
      // trigger giving up. Without this check, sharp would decode it and the
      // fallback would never run — distinguishing this from an unsupported format.
      fetch: () =>
        Promise.resolve(
          new Response(jpeg, { headers: { 'content-length': String(500 * 1024 * 1024) } }),
        ),
      preview: () => {
        repliDemande++;
        return Promise.resolve(new Response(jpeg));
      },
    });

    const renderer = new MediaRenderer(cache, silencieux);
    const rendu = await renderer.render(storage, 'panorama', { kind: 'full' }, null);

    // The photo is still served — as the backend preview, not a failure: refusing
    // would show a broken grid cell for a valid file.
    assert.equal(repliDemande, 1, 'an oversized original must not be decoded locally');
    assert.ok(existsSync(rendu.path));
  });
});

describe('transient storage failure', () => {
  it('reports unavailability when the fallback also fails', async () => {
    const cache = new MediaCache(join(root, 'transitoire'), 1024 * 1024);
    await cache.load();

    // The original download times out and the preview also fails: this is the
    // only case where failure reaches the route, and it must remain
    // recognisably transient so the route returns 503 rather than 500 — a 500
    // would make the browser give up.
    const storage = stockage({
      fetch: () => Promise.reject(new StorageUnavailableError('original', 5, 'timed out')),
      preview: () => Promise.reject(new StorageUnavailableError('preview', 5, 'Drive 429')),
    });

    const renderer = new MediaRenderer(cache, silencieux);

    await assert.rejects(
      () => renderer.render(storage, 'lent', { kind: 'thumb', size: 320 }, null),
      StorageUnavailableError,
    );
  });

  it('keeps nothing cached after a failure', async () => {
    // The invariant that makes retry possible: a failure must never be cached,
    // otherwise the thumbnail would remain broken until eviction.
    const cache = new MediaCache(join(root, 'sans-trace'), 1024 * 1024);
    await cache.load();

    const storage = stockage({
      fetch: () => Promise.reject(new StorageUnavailableError('original', 5, 'timed out')),
      preview: () => Promise.reject(new Error('no preview')),
    });

    const renderer = new MediaRenderer(cache, silencieux);
    await assert.rejects(() =>
      renderer.render(storage, 'lent', { kind: 'thumb', size: 320 }, null),
    );

    assert.equal(cache.stats().entryCount, 0);
  });
});
