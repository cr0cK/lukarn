import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { openDb } from '../src/db.js';
import { MediaRepo, type MediaUpsert } from '../src/repo.js';

/**
 * Versionnement des dérivés.
 *
 * Drive conserve l'identifiant d'un fichier dont on remplace le contenu par une
 * nouvelle version (« Gérer les versions »). Comme les rendus sont servis en
 * `Cache-Control: immutable`, le navigateur ne revalide jamais : c'est l'URL
 * elle-même qui doit changer, sans quoi une photo corrigée resterait affichée
 * dans son ancienne version indéfiniment.
 */

const dir = mkdtempSync(join(tmpdir(), 'gdv-version-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const db = openDb(dir);
const repo = new MediaRepo(db);
after(() => db.close());

function media(id: string, md5: string | null): MediaUpsert {
  return {
    albumId: 'album',
    id,
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    kind: 'photo',
    size: 1000,
    width: 4000,
    height: 3000,
    takenAt: '2026-01-01T10:00:00.000Z',
    takenAtFromExif: true,
    modifiedTime: '2026-01-01T10:00:00.000Z',
    durationMs: null,
    cameraMake: null,
    cameraModel: null,
    lens: null,
    isoSpeed: null,
    exposureTime: null,
    aperture: null,
    focalLength: null,
    lat: null,
    lng: null,
    md5,
  };
}

describe('version exposée aux clients', () => {
  it("dérive la version de l'empreinte du contenu", () => {
    repo.upsertMany([media('photo-a', '0123456789abcdef0123456789abcdef')], 'v1');

    const item = repo.listItems('album', 10, null).items.find((i) => i.id === 'photo-a');
    assert.equal(item?.version, '01234567');
  });

  it('change de version quand le contenu du même fichier est remplacé', () => {
    repo.upsertMany([media('photo-b', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')], 'v1');
    const avant = repo.listItems('album', 10, null).items.find((i) => i.id === 'photo-b')?.version;

    // Même identifiant Drive, contenu différent : c'est exactement le cas que
    // l'identifiant seul ne permet pas de distinguer.
    repo.upsertMany([media('photo-b', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')], 'v2');
    const apres = repo.listItems('album', 10, null).items.find((i) => i.id === 'photo-b')?.version;

    assert.notEqual(avant, apres);
    assert.equal(apres, 'bbbbbbbb');
  });

  it('tolère un fichier sans empreinte', () => {
    repo.upsertMany([media('photo-c', null)], 'v1');

    const item = repo.listItems('album', 10, null).items.find((i) => i.id === 'photo-c');
    // Pas de version dans l'URL : on retrouve le comportement d'avant, sans erreur.
    assert.equal(item?.version, null);

    const meta = repo.getFileMeta('photo-c');
    assert.equal(meta?.md5, null);
  });

  it("expose la version de la couverture pour la vignette d'album", () => {
    const stats = repo.stats('album');
    assert.ok(stats.coverId);
    // La couverture est une URL comme une autre : elle doit pouvoir être
    // invalidée de la même façon.
    const cover = repo.getFileMeta(stats.coverId!);
    assert.equal(stats.coverVersion, cover?.md5 ? cover.md5.slice(0, 8) : null);
  });

  it('rend md5 disponible pour la clé de cache serveur', () => {
    const meta = repo.getFileMeta('photo-a');
    assert.equal(meta?.md5, '0123456789abcdef0123456789abcdef');
  });
});
