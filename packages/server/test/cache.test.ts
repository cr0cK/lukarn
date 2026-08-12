import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { MediaCache } from '../src/media/cache.js';

const root = mkdtempSync(join(tmpdir(), 'lukarn-cache-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** Lets asynchronous eviction finish before inspecting the cache. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

describe('disk cache', () => {
  it('returns a written entry and misses an unknown key', async () => {
    const cache = new MediaCache(join(root, 'basic'), 1024 * 1024);
    await cache.load();

    assert.equal(cache.hit('a:t320'), null);
    const path = await cache.put('a:t320', Buffer.alloc(64, 1));

    assert.ok(existsSync(path));
    assert.equal(cache.hit('a:t320'), path);
    assert.equal(cache.stats().entryCount, 1);
    assert.equal(cache.stats().bytes, 64);
  });

  it('finds its entries after a restart', async () => {
    const dir = join(root, 'reload');
    const first = new MediaCache(dir, 1024 * 1024);
    await first.load();
    await first.put('photo:t640', Buffer.alloc(128, 2));

    const second = new MediaCache(dir, 1024 * 1024);
    await second.load();

    assert.equal(second.stats().entryCount, 1);
    assert.equal(second.stats().bytes, 128);
    assert.ok(second.hit('photo:t640'));
  });

  it('evicts the least recently used entries', async () => {
    // Deliberately low limit: four 100-byte entries are enough to exceed it.
    const cache = new MediaCache(join(root, 'lru'), 300);
    await cache.load();

    await cache.put('vieux', Buffer.alloc(100, 1));
    await cache.put('moyen', Buffer.alloc(100, 2));
    await cache.put('recent', Buffer.alloc(100, 3));

    // Moves "vieux" to the front of the usage queue: "moyen" must leave first,
    // not it.
    cache.hit('vieux');

    await cache.put('nouveau', Buffer.alloc(100, 4));
    await settle();

    assert.ok(cache.stats().bytes <= 300, 'the limit must be respected');
    assert.ok(cache.hit('nouveau'), 'the latest write must survive');
    assert.equal(cache.hit('moyen'), null, 'the least recently used entry must leave');
  });

  it('replaces an entry without counting its size twice', async () => {
    const cache = new MediaCache(join(root, 'replace'), 1024 * 1024);
    await cache.load();

    await cache.put('k', Buffer.alloc(100, 1));
    await cache.put('k', Buffer.alloc(250, 2));

    assert.equal(cache.stats().entryCount, 1);
    assert.equal(cache.stats().bytes, 250);
  });

  it('clears completely', async () => {
    const cache = new MediaCache(join(root, 'clear'), 1024 * 1024);
    await cache.load();
    await cache.put('k', Buffer.alloc(100, 1));

    await cache.clear();

    assert.equal(cache.stats().entryCount, 0);
    assert.equal(cache.stats().bytes, 0);
    assert.equal(cache.hit('k'), null);
  });

  it('stores an existing file without loading it into memory', async () => {
    const dir = join(root, 'putfile');
    const cache = new MediaCache(dir, 1024 * 1024);
    await cache.load();

    const source = join(dir, 'sortie.tmp');
    writeFileSync(source, Buffer.alloc(4096, 7));

    const path = await cache.putFile('clip:empreinte', source);

    assert.ok(existsSync(path));
    // Moved, not copied: a derived video is tens of MB, and leaving it behind
    // would double the space used.
    assert.equal(existsSync(source), false);
    assert.equal(cache.hit('clip:empreinte'), path);
    assert.equal(cache.stats().bytes, 4096);
  });

  it('also evicts entries stored by rename', async () => {
    const dir = join(root, 'putfile-lru');
    const cache = new MediaCache(dir, 300);
    await cache.load();

    for (const nom of ['vieux', 'moyen', 'recent', 'nouveau']) {
      const source = join(dir, `${nom}.tmp`);
      writeFileSync(source, Buffer.alloc(100, 1));
      await cache.putFile(nom, source);
    }
    await settle();

    // Size is counted on entry: otherwise the store would grow without bound
    // and the video budget would be meaningless.
    assert.ok(cache.stats().bytes <= 300, 'the limit must be respected');
    assert.equal(cache.hit('vieux'), null, 'the least recently used entry must leave');
    assert.ok(cache.hit('nouveau'), 'the latest write must survive');
  });

  it('neither inventories nor clears files it does not own', async () => {
    // The video store lives under `CACHE_DIR/video`: a cache that counted those
    // bytes in its budget would evict them, and "clear cache" from /admin would
    // discard hours of transcoding alongside the thumbnails.
    const dir = join(root, 'voisin');
    const cache = new MediaCache(dir, 1024 * 1024);
    await cache.load();
    await cache.put('vignette', Buffer.alloc(100, 1));

    const voisin = join(dir, 'video');
    mkdirSync(join(voisin, 'ab'), { recursive: true });
    const etranger = join(voisin, 'ab', 'film.bin');
    writeFileSync(etranger, Buffer.alloc(9000, 2));

    const relu = new MediaCache(dir, 1024 * 1024);
    await relu.load();
    assert.equal(relu.stats().bytes, 100, 'only its own shelf is inventoried');

    await relu.clear();
    assert.ok(existsSync(etranger), 'the neighbouring store must survive clearing');
  });

  it('spares an entry requested while eviction is running', async () => {
    const cache = new MediaCache(join(root, 'lru-course'), 300);
    await cache.load();

    await cache.put('a', Buffer.alloc(100, 1));
    await cache.put('b', Buffer.alloc(100, 2));
    await cache.put('c', Buffer.alloc(100, 3));

    // The fourth write exceeds the limit and starts eviction, which has already
    // fixed its order — "a" then "b" — when the next line runs.
    await cache.put('d', Buffer.alloc(100, 4));

    // A request claims "b" at this exact moment. It is about to read the file:
    // deleting it now would return ENOENT.
    const reclame = cache.hit('b');
    assert.ok(reclame, 'the setup assumes "b" is still present');

    await settle();

    assert.ok(cache.stats().bytes <= 300, 'the limit must remain respected');
    assert.ok(cache.hit('b'), 'an entry requested during eviction must survive');
    assert.ok(existsSync(reclame), 'its file must exist when it is about to be read');
  });

  it('continues cleaning when a deletion fails', async () => {
    const avertissements: string[] = [];
    const cache = new MediaCache(join(root, 'rm-ko'), 300, {
      warn: (msg) => avertissements.push(msg),
    });
    await cache.load();

    // A directory in place of the file: `rm` rejects it, as it would for a
    // remounted read-only volume or an I/O error.
    const bloque = await cache.put('bloque', Buffer.alloc(100, 1));
    rmSync(bloque);
    mkdirSync(join(bloque, 'occupe'), { recursive: true });

    await cache.put('b', Buffer.alloc(100, 2));
    await cache.put('c', Buffer.alloc(100, 3));
    await cache.put('d', Buffer.alloc(100, 4));

    await settle();

    // Without handling the failure, eviction stopped at "bloque": nothing was
    // freed and the unhandled rejection could terminate the process.
    assert.equal(cache.hit('b'), null, 'subsequent entries must still be removed');
    assert.ok(avertissements.length > 0, 'the failure must be logged');
    // The stubborn entry remains inventoried: its file is still there.
    assert.ok(cache.hit('bloque'), 'the inventory must keep describing the disk');
  });
});
