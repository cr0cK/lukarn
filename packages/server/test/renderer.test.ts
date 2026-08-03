import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import type { DriveService } from '../src/drive/service.js';
import { MediaCache } from '../src/media/cache.js';
import { MediaRenderer } from '../src/media/renderer.js';

/**
 * Production des dérivés WebP. Les deux scénarios couverts ici sont ceux où le
 * rendu doit se rattraper tout seul : un fichier de cache disparu sous ses
 * pieds, et une image que la libvips embarquée ne sait pas décoder.
 */

const root = mkdtempSync(join(tmpdir(), 'gdv-renderer-'));
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
