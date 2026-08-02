import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classify, parseExifTime, toCoordinates, toNumber } from '../src/drive/metadata.js';

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
