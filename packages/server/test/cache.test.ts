import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { MediaCache } from '../src/media/cache.js';
import { LoginThrottle } from '../src/throttle.js';

const root = mkdtempSync(join(tmpdir(), 'gdv-cache-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** Laisse l'éviction asynchrone se terminer avant d'observer le cache. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

describe('cache disque', () => {
  it('rend une entrée écrite et rate sur une clé inconnue', async () => {
    const cache = new MediaCache(join(root, 'basic'), 1024 * 1024);
    await cache.load();

    assert.equal(cache.hit('a:t320'), null);
    const path = await cache.put('a:t320', Buffer.alloc(64, 1));

    assert.ok(existsSync(path));
    assert.equal(cache.hit('a:t320'), path);
    assert.equal(cache.stats().entryCount, 1);
    assert.equal(cache.stats().bytes, 64);
  });

  it('retrouve ses entrées après un redémarrage', async () => {
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

  it('évince les entrées les moins récemment utilisées', async () => {
    // Limite volontairement basse : 4 entrées de 100 o suffisent à la dépasser.
    const cache = new MediaCache(join(root, 'lru'), 300);
    await cache.load();

    await cache.put('vieux', Buffer.alloc(100, 1));
    await cache.put('moyen', Buffer.alloc(100, 2));
    await cache.put('recent', Buffer.alloc(100, 3));

    // Remet « vieux » en tête de la file d'usage : c'est « moyen » qui doit
    // partir en premier, pas lui.
    cache.hit('vieux');

    await cache.put('nouveau', Buffer.alloc(100, 4));
    await settle();

    assert.ok(cache.stats().bytes <= 300, 'la limite doit être respectée');
    assert.ok(cache.hit('nouveau'), 'la dernière écriture doit survivre');
    assert.equal(cache.hit('moyen'), null, 'la moins récemment utilisée doit partir');
  });

  it('remplace une entrée sans compter sa taille deux fois', async () => {
    const cache = new MediaCache(join(root, 'replace'), 1024 * 1024);
    await cache.load();

    await cache.put('k', Buffer.alloc(100, 1));
    await cache.put('k', Buffer.alloc(250, 2));

    assert.equal(cache.stats().entryCount, 1);
    assert.equal(cache.stats().bytes, 250);
  });

  it('se vide entièrement', async () => {
    const cache = new MediaCache(join(root, 'clear'), 1024 * 1024);
    await cache.load();
    await cache.put('k', Buffer.alloc(100, 1));

    await cache.clear();

    assert.equal(cache.stats().entryCount, 0);
    assert.equal(cache.stats().bytes, 0);
    assert.equal(cache.hit('k'), null);
  });
});

describe('throttle de connexion', () => {
  const now = 1_700_000_000_000;

  it('laisse passer les premières erreurs de frappe', () => {
    const throttle = new LoginThrottle();
    // Cinq échecs restent sans pénalité : une erreur de frappe ne doit pas
    // faire attendre.
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.equal(throttle.blockedFor('ip:user', now), 0);
      throttle.fail('ip:user', now);
    }
    assert.equal(throttle.blockedFor('ip:user', now), 0);

    // Le sixième déclenche le délai.
    throttle.fail('ip:user', now);
    assert.ok(throttle.blockedFor('ip:user', now) > 0);
  });

  it('double le délai à chaque échec supplémentaire', () => {
    const throttle = new LoginThrottle();
    for (let attempt = 0; attempt < 6; attempt++) throttle.fail('ip:user', now);
    const first = throttle.blockedFor('ip:user', now);

    throttle.fail('ip:user', now);
    const second = throttle.blockedFor('ip:user', now);

    assert.equal(second, first * 2);
  });

  it('remet le compteur à zéro après une connexion réussie', () => {
    const throttle = new LoginThrottle();
    for (let attempt = 0; attempt < 8; attempt++) throttle.fail('ip:user', now);
    assert.ok(throttle.blockedFor('ip:user', now) > 0);

    throttle.succeed('ip:user');
    assert.equal(throttle.blockedFor('ip:user', now), 0);
  });

  it('oublie une série ancienne', () => {
    const throttle = new LoginThrottle();
    for (let attempt = 0; attempt < 8; attempt++) throttle.fail('ip:user', now);

    const plusTwoHours = now + 2 * 60 * 60 * 1000;
    assert.equal(throttle.blockedFor('ip:user', plusTwoHours), 0);
  });

  it('isole les clés entre elles', () => {
    const throttle = new LoginThrottle();
    for (let attempt = 0; attempt < 8; attempt++) throttle.fail('ip1:user', now);
    assert.equal(throttle.blockedFor('ip2:user', now), 0);
  });
});
