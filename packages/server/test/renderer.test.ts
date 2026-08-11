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
 * Production des dérivés WebP. Les deux scénarios couverts ici sont ceux où le
 * rendu doit se rattraper tout seul : un fichier de cache disparu sous ses
 * pieds, et une image que la libvips embarquée ne sait pas décoder.
 */

const root = mkdtempSync(join(tmpdir(), 'nonni-renderer-'));
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

describe('rendu depuis le cache', () => {
  it('régénère un dérivé dont le fichier a disparu du disque', async () => {
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

    // « Vider le cache » depuis /admin, ou un ménage manuel sur le volume :
    // l'inventaire mémoire désigne alors un fichier qui n'existe plus.
    rmSync(premier.path);

    const second = await renderer.render('photo', { kind: 'thumb', size: 320 }, 'empreinte');

    assert.equal(telechargements, 2, 'le dérivé manquant doit être refabriqué');
    assert.ok(existsSync(second.path), 'le chemin rendu doit être lisible');
  });
});

describe('préparation de plusieurs variantes', () => {
  it('ne télécharge l’original qu’une fois pour les trois tailles', async () => {
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

    // C'est tout l'intérêt de ce chemin : le téléchargement pèse ~2 s là où le
    // rendu pèse ~50 ms. Trois `render()` successifs tireraient trois fois le
    // même fichier, soit trois fois le trafic Drive du préchauffage.
    assert.equal(telechargements, 1, 'un seul téléchargement pour les trois tailles');
    assert.equal(produits, 3);

    for (const size of [320, 640, 1280] as const) {
      assert.ok(renderer.isCached('photo', { kind: 'thumb', size }, 'empreinte'));
    }
  });

  it('ne refait ni ne retélécharge ce qui est déjà en cache', async () => {
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

    // Un passage de préchauffage repasse sur les mêmes albums heure après
    // heure : sans ce court-circuit, il retéléchargerait toute la
    // bibliothèque à chaque tour.
    assert.equal(seconde, 0);
    assert.equal(telechargements, 1);
  });

  it('demande l’aperçu Drive à la plus grande taille voulue', async () => {
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

    // L'aperçu sert de source aux tailles suivantes, et `withoutEnlargement`
    // interdit de remonter : le demander en 320 livrerait une vignette de
    // 320 px sous la clé du 1280.
    assert.deepEqual(urls, ['https://lh3.exemple/Q=s1280']);
    assert.equal(produits, 2);
  });
});

describe('aperçu d’une vidéo', () => {
  it('part de l’aperçu Drive sans jamais toucher à l’original', async () => {
    const cache = new MediaCache(join(root, 'poster'), 1024 * 1024);
    await cache.load();

    const urls: string[] = [];
    const drive = {
      fetchFile: () => {
        throw new Error('un original de vidéo ne doit jamais être téléchargé');
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

    // Tirer un MP4 de 48 Mo pour le voir refuser par `MAX_DECODE_BYTES` à
    // chaque vignette est précisément ce que le court-circuit évite : aucun
    // octet de vidéo ne transite, et D6 (pas de transcodage) reste intact.
    assert.deepEqual(urls, ['https://lh3.exemple/Vid=s1280'], 'un seul aperçu, à la plus grande');
    assert.equal(produits, 3);

    for (const size of [320, 640, 1280] as const) {
      assert.ok(renderer.isCached('clip', { kind: 'thumb', size }, 'empreinte'));
    }
  });

  it('sert un rendu isolé depuis l’aperçu, sans repli à retenter', async () => {
    const cache = new MediaCache(join(root, 'poster-unique'), 1024 * 1024);
    await cache.load();

    let apercus = 0;
    const drive = {
      fetchFile: () => {
        throw new Error('un original de vidéo ne doit jamais être téléchargé');
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
    // L'aperçu Drive **est** la source : le repli du chemin photo n'a rien de
    // plus à tenter, et le redemander ne ferait que rejouer le même appel.
    assert.equal(apercus, 1);
  });
});

describe('repli sur la vignette Drive', () => {
  it('demande la vignette avec le jeton OAuth et non en anonyme', async () => {
    const cache = new MediaCache(join(root, 'repli'), 1024 * 1024);
    await cache.load();

    const urlsAuthentifiees: string[] = [];
    const drive = {
      // Contenu que sharp ne décode pas : c'est le cas HEIC/RAW.
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

    // Le `thumbnailLink` d'un fichier privé répond 401/403 sans en-tête
    // Authorization : un appel anonyme doit être un échec franc.
    const vraiFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error('appel anonyme interdit');
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

describe('original trop lourd', () => {
  it('renonce sur la taille annoncée et passe par l’aperçu Drive', async () => {
    const cache = new MediaCache(join(root, 'enorme'), 1024 * 1024);
    await cache.load();

    let repliDemande = 0;
    const drive = {
      // Le corps est une image parfaitement décodable : seul l'en-tête de
      // taille doit provoquer le renoncement. Sans ce contrôle, sharp la
      // décoderait et le repli ne servirait jamais — c'est ce qui distingue ce
      // test d'un simple « format non supporté ».
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

    // La photo reste servie — c'est l'aperçu de Drive, pas un échec : refuser
    // afficherait une case cassée dans la grille pour un fichier valide.
    assert.equal(repliDemande, 1, 'un original hors limite ne doit pas être décodé sur place');
    assert.ok(existsSync(rendu.path));
  });
});

describe('échec transitoire de Drive', () => {
  it('remonte une indisponibilité quand le repli échoue à son tour', async () => {
    const cache = new MediaCache(join(root, 'transitoire'), 1024 * 1024);
    await cache.load();

    // Le téléchargement de l'original dépasse le délai, et l'aperçu Drive
    // n'aboutit pas non plus : c'est le seul cas où l'échec atteint la route, et
    // il doit y rester reconnaissable comme transitoire pour qu'elle réponde
    // 503 plutôt que 500 — un 500 ferait renoncer le navigateur.
    const drive = {
      fetchFile: () => Promise.reject(new DriveUnavailableError('original', 5, 'délai dépassé')),
      guard: <T>(operation: () => Promise<T>) => operation(),
      api: () => ({
        files: {
          get: () => Promise.resolve({ data: { thumbnailLink: 'https://lh3.exemple/AbC=s220' } }),
        },
      }),
      fetchAuthorized: () => Promise.reject(new DriveUnavailableError('aperçu', 5, 'Drive 429')),
    } as unknown as DriveService;

    const renderer = new MediaRenderer(drive, cache, silencieux);

    await assert.rejects(
      () => renderer.render('lent', { kind: 'thumb', size: 320 }, null),
      DriveUnavailableError,
    );
  });

  it('ne garde rien en cache après un échec', async () => {
    // L'invariant qui rend le réessai possible : un échec ne doit jamais être
    // mémorisé, sans quoi la vignette resterait cassée jusqu'à l'éviction.
    const cache = new MediaCache(join(root, 'sans-trace'), 1024 * 1024);
    await cache.load();

    const drive = {
      fetchFile: () => Promise.reject(new DriveUnavailableError('original', 5, 'délai dépassé')),
      guard: <T>(operation: () => Promise<T>) => operation(),
      api: () => ({ files: { get: () => Promise.resolve({ data: {} }) } }),
      fetchAuthorized: () => Promise.reject(new Error('pas d’aperçu')),
    } as unknown as DriveService;

    const renderer = new MediaRenderer(drive, cache, silencieux);
    await assert.rejects(() => renderer.render('lent', { kind: 'thumb', size: 320 }, null));

    assert.equal(cache.stats().entryCount, 0);
  });
});
