import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classify,
  parseExifTime,
  parseNameTime,
  resolveVideoTakenAt,
  toCoordinates,
  toNumber,
} from '../src/drive/metadata.js';

describe('classify', () => {
  it('reconnaît photos et vidéos', () => {
    assert.equal(classify('image/jpeg'), 'photo');
    assert.equal(classify('image/heic'), 'photo');
    assert.equal(classify('video/mp4'), 'video');
    assert.equal(classify('video/quicktime'), 'video');
  });

  it('écarte tout le reste', () => {
    assert.equal(classify('application/pdf'), null);
    assert.equal(classify('application/vnd.google-apps.folder'), null);
    assert.equal(classify(null), null);
    assert.equal(classify(undefined), null);
  });
});

describe('parseExifTime', () => {
  it('lit le format Drive', () => {
    // Interprété en UTC : l'heure affichée est celle de l'appareil.
    assert.equal(parseExifTime('2023:07:14 18:32:10'), '2023-07-14T18:32:10.000Z');
  });

  it('tolère le séparateur ISO', () => {
    assert.equal(parseExifTime('2023:07:14T18:32:10'), '2023-07-14T18:32:10.000Z');
  });

  it('rejette un EXIF vide', () => {
    assert.equal(parseExifTime('0000:00:00 00:00:00'), null);
  });

  it('rejette une date inexistante', () => {
    // Sans contrôle, Date.UTC glisserait au 3 mars.
    assert.equal(parseExifTime('2023:02:31 12:00:00'), null);
  });

  it('rejette les valeurs absentes ou illisibles', () => {
    assert.equal(parseExifTime(null), null);
    assert.equal(parseExifTime(undefined), null);
    assert.equal(parseExifTime(''), null);
    assert.equal(parseExifTime('pas une date'), null);
  });
});

describe('parseNameTime', () => {
  it('lit les noms que produisent les téléphones', () => {
    // Les millièmes qu'un Pixel ajoute après les secondes ne gênent pas.
    assert.equal(parseNameTime('PXL_20260729_143012123.mp4'), '2026-07-29T14:30:12.000Z');
    assert.equal(parseNameTime('VID_20260729_143012.mp4'), '2026-07-29T14:30:12.000Z');
    assert.equal(parseNameTime('IMG_20260805_091544.MOV'), '2026-08-05T09:15:44.000Z');
    assert.equal(parseNameTime('20260805-091544.mp4'), '2026-08-05T09:15:44.000Z');
  });

  it("ne trouve rien dans un nom qui n'est pas horodaté", () => {
    assert.equal(parseNameTime('anniversaire.mp4'), null);
    assert.equal(parseNameTime('20260805.mp4'), null);
    assert.equal(parseNameTime(null), null);
    assert.equal(parseNameTime(''), null);
  });

  it('rejette une date qui ne peut pas exister', () => {
    assert.equal(parseNameTime('VID_20260231_143012.mp4'), null);
    assert.equal(parseNameTime('VID_20260729_251012.mp4'), null);
    assert.equal(parseNameTime('VID_20260729_146012.mp4'), null);
  });

  it('ne découpe pas un long nombre en date', () => {
    // Un identifiant d'export, pas un horodatage : le chiffre qui précède
    // suffit à le dire.
    assert.equal(parseNameTime('9920260729_143012.mp4'), null);
  });
});

describe('resolveVideoTakenAt', () => {
  const modifiedTime = '2026-08-08T07:51:00.000Z';

  it('préfère le nom quand le conteneur le corrobore', () => {
    // Le nom porte le début de l'enregistrement dans l'heure de l'appareil,
    // exactement comme l'EXIF d'une photo. Ici le conteneur est en UTC, deux
    // heures plus tôt : deux écritures du même instant.
    const resolu = resolveVideoTakenAt({
      name: 'PXL_20260729_143012123.mp4',
      containerTime: '2026-07-29T12:30:38.000Z',
      durationMs: 26_000,
      modifiedTime,
    });

    assert.deepEqual(resolu, { takenAt: '2026-07-29T14:30:12.000Z', fromFile: true });
  });

  it("remonte du conteneur au début de l'enregistrement", () => {
    // Sans nom exploitable : l'en-tête est écrit à l'arrêt de l'enregistrement,
    // la prise de vue commence une durée plus tôt.
    const resolu = resolveVideoTakenAt({
      name: 'vacances.mp4',
      containerTime: '2026-07-29T12:30:38.000Z',
      durationMs: 38_000,
      modifiedTime,
    });

    assert.deepEqual(resolu, { takenAt: '2026-07-29T12:30:00.000Z', fromFile: true });
  });

  it("écarte un nom horodaté qui n'a rien à voir avec le fichier", () => {
    // Plus de 26 h d'écart : le nom vient d'ailleurs — fichier renommé, numéro
    // qui ressemble à une date. Le conteneur, lui, est dans le fichier.
    const resolu = resolveVideoTakenAt({
      name: 'VID_20240101_120000.mp4',
      containerTime: '2026-07-29T12:30:38.000Z',
      durationMs: 38_000,
      modifiedTime,
    });

    assert.deepEqual(resolu, { takenAt: '2026-07-29T12:30:00.000Z', fromFile: true });
  });

  it("retient le nom seul quand le conteneur ne s'ouvre pas", () => {
    const resolu = resolveVideoTakenAt({
      name: 'VID_20260729_143012.avi',
      containerTime: null,
      durationMs: null,
      modifiedTime,
    });

    assert.deepEqual(resolu, { takenAt: '2026-07-29T14:30:12.000Z', fromFile: true });
  });

  it('retombe sur la date de modification, et le dit', () => {
    // Le seul cas qui ne prétend pas dater le tournage : `fromFile` est faux, et
    // l'interface écrit « Modifié le » plutôt que « Prise de vue ».
    const resolu = resolveVideoTakenAt({
      name: 'anniversaire.mp4',
      containerTime: null,
      durationMs: null,
      modifiedTime,
    });

    assert.deepEqual(resolu, { takenAt: modifiedTime, fromFile: false });
  });

  it('se passe de la durée quand Drive ne la connaît pas', () => {
    const resolu = resolveVideoTakenAt({
      name: null,
      containerTime: '2026-07-29T12:30:38.000Z',
      durationMs: null,
      modifiedTime,
    });

    assert.deepEqual(resolu, { takenAt: '2026-07-29T12:30:38.000Z', fromFile: true });
  });
});

describe('toNumber', () => {
  it('convertit les nombres et les chaînes numériques', () => {
    assert.equal(toNumber(42), 42);
    assert.equal(toNumber('1024'), 1024);
    assert.equal(toNumber(''), null);
    assert.equal(toNumber(null), null);
    assert.equal(toNumber('abc'), null);
  });
});

describe('toCoordinates', () => {
  it('rend une position renseignée', () => {
    assert.deepEqual(toCoordinates(48.8566, 2.3522), { lat: 48.8566, lng: 2.3522 });
  });

  it('écarte le couple (0, 0) que Drive renvoie sans position', () => {
    assert.deepEqual(toCoordinates(0, 0), { lat: null, lng: null });
  });

  it("garde la latitude d'une photo prise sur l'équateur", () => {
    // Le zéro n'est pas une absence : cette photo a bien une position.
    assert.deepEqual(toCoordinates(0, 32.5825), { lat: 0, lng: 32.5825 });
  });

  it('garde la longitude d’une photo prise sur le méridien de Greenwich', () => {
    assert.deepEqual(toCoordinates(51.4779, 0), { lat: 51.4779, lng: 0 });
  });

  it('refuse une demi-position', () => {
    // Une latitude sans longitude ne situe rien : mieux vaut ne rien afficher.
    assert.deepEqual(toCoordinates(48.8566, null), { lat: null, lng: null });
    assert.deepEqual(toCoordinates(undefined, 2.3522), { lat: null, lng: null });
  });
});
