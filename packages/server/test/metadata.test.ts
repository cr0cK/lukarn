import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classify, parseExifTime, toCoordinate, toNumber } from '../src/drive/metadata.js';

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

describe('toNumber / toCoordinate', () => {
  it('convertit les nombres et les chaînes numériques', () => {
    assert.equal(toNumber(42), 42);
    assert.equal(toNumber('1024'), 1024);
    assert.equal(toNumber(''), null);
    assert.equal(toNumber(null), null);
    assert.equal(toNumber('abc'), null);
  });

  it('traite 0 comme une absence de position', () => {
    assert.equal(toCoordinate(0), null);
    assert.equal(toCoordinate(48.8566), 48.8566);
    assert.equal(toCoordinate(-0.5), -0.5);
  });
});
