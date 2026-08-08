import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chooseVideoSource } from '../src/lib/videoSource';

/**
 * Choix de la source d'une vidéo.
 *
 * La règle est invisible tant qu'elle est fausse : la vidéo se lit, ou ne se lit
 * pas, sans que rien ne dise laquelle des deux sources était en cause. D'où ces
 * cas, écrits d'après les réponses réelles de `canPlayType`.
 */

/** Chrome : décode l'H.264, pas l'HEVC — et répond `maybe` au type nu (D98). */
const chrome = (type: string): string => {
  if (/hvc1|hev1/.test(type)) return '';
  if (/avc1/.test(type)) return 'probably';
  return 'maybe';
};

/** Safari, un iPhone : décode les deux. */
const safari = (): string => 'probably';

describe('choix de la source vidéo', () => {
  it('prend la version préparée quand le navigateur ne décode pas le codec', () => {
    assert.equal(chooseVideoSource('hvc1', chrome), 'transcoded');
    assert.equal(chooseVideoSource('hev1', chrome), 'transcoded');
  });

  it('garde l’original quand le navigateur sait le lire', () => {
    assert.equal(chooseVideoSource('avc1', chrome), 'original');
    // Un appareil qui décode l'HEVC ne doit jamais recevoir le transcodage :
    // il perdrait en qualité pour rien, et attendrait une préparation dont il
    // n'a pas besoin.
    assert.equal(chooseVideoSource('hvc1', safari), 'original');
  });

  it('garde l’original quand le codec est inconnu', () => {
    // `null` : en-tête jamais lu, ou ligne indexée avant que la colonne existe.
    // Chaîne vide : en-tête lu, aucune piste image reconnue. Dans les deux cas,
    // le doute ne justifie pas de demander une version qui n'a pas été préparée.
    assert.equal(chooseVideoSource(null, chrome), 'original');
    assert.equal(chooseVideoSource('', chrome), 'original');
  });

  it('interroge le navigateur sur le codec, jamais sur le type nu', () => {
    // C'est tout l'apport de D260809b sur D98 : à `video/mp4` seul, tous les
    // navigateurs répondent `maybe`, ce qui n'apprend rien du contenu.
    const demandes: string[] = [];
    chooseVideoSource('hvc1', (type) => {
      demandes.push(type);
      return '';
    });

    assert.deepEqual(demandes, ['video/mp4; codecs="hvc1"']);
  });
});
