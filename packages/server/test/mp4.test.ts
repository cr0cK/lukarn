import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findMoovOffset, readCreationTime, readVideoCodec } from '../src/drive/mp4.js';

/**
 * Lecture de l'en-tête d'un conteneur MP4 par fenêtres.
 *
 * Les tampons sont construits à la main : ce sont les formes rencontrées sur un
 * import réel de 40 vidéos — `moov` en tête ou après un `mdat` de plusieurs Mo,
 * tailles 64 bits, `mvhd` version 0 et 1, et l'ancien `moov` neutralisé en
 * `free` qui piège tout balayage par signature.
 */

const EPOCH_1904_OFFSET_S = 2_082_844_800;

function secondes1904(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000) + EPOCH_1904_OFFSET_S;
}

/** Boîte ordinaire : taille sur 32 bits, puis les quatre lettres du type. */
function boite(type: string, contenu: Buffer = Buffer.alloc(0)): Buffer {
  const entete = Buffer.alloc(8);
  entete.writeUInt32BE(8 + contenu.length, 0);
  entete.write(type, 4, 'latin1');
  return Buffer.concat([entete, contenu]);
}

/** Boîte à taille 64 bits : `size == 1`, la vraie taille suit le type. */
function boite64(type: string, contenu: Buffer): Buffer {
  const entete = Buffer.alloc(16);
  entete.writeUInt32BE(1, 0);
  entete.write(type, 4, 'latin1');
  entete.writeBigUInt64BE(BigInt(16 + contenu.length), 8);
  return Buffer.concat([entete, contenu]);
}

/** `mvhd` version 0 : dates sur 32 bits. Le reste du corps ne sert pas ici. */
function mvhd0(iso: string): Buffer {
  const corps = Buffer.alloc(100);
  corps.writeUInt8(0, 0);
  corps.writeUInt32BE(secondes1904(iso), 4);
  return boite('mvhd', corps);
}

/** `mvhd` version 1 : dates sur 64 bits, ce qu'écrivent les appareils récents. */
function mvhd1(iso: string): Buffer {
  const corps = Buffer.alloc(112);
  corps.writeUInt8(1, 0);
  corps.writeBigUInt64BE(BigInt(secondes1904(iso)), 4);
  return boite('mvhd', corps);
}

function ftyp(): Buffer {
  return boite('ftyp', Buffer.from('isommp42', 'latin1'));
}

/**
 * `hdlr` : version et drapeaux, `pre_defined`, puis le type de gestionnaire.
 * C'est lui qui dit si la piste porte l'image (`vide`) ou le son (`soun`).
 */
function hdlr(type: string): Buffer {
  const corps = Buffer.alloc(32);
  corps.write(type, 8, 'latin1');
  return boite('hdlr', corps);
}

/**
 * `stsd` : version et drapeaux, nombre d'entrées, puis la première entrée —
 * sa taille, et le code à quatre lettres du format.
 */
function stsd(format: string): Buffer {
  const corps = Buffer.alloc(24);
  corps.writeUInt32BE(1, 4);
  corps.writeUInt32BE(16, 8);
  corps.write(format, 12, 'latin1');
  return boite('stsd', corps);
}

/** Une piste complète, telle qu'un encodeur l'écrit : `trak/mdia/minf/stbl/stsd`. */
function trak(handler: string, format: string): Buffer {
  const stbl = boite('stbl', stsd(format));
  const minf = boite('minf', Buffer.concat([boite('dinf'), stbl]));
  const mdia = boite('mdia', Buffer.concat([boite('mdhd', Buffer.alloc(24)), hdlr(handler), minf]));
  return boite('trak', Buffer.concat([boite('tkhd', Buffer.alloc(84)), mdia]));
}

/**
 * Le parcours tel que la synchronisation le mène : une fenêtre, puis la
 * suivante à la frontière rendue. Renvoie la date lue et le nombre de fenêtres
 * ouvertes — c'est ce compte qui décide du coût de la sync.
 */
function lireEnTete(
  fichier: Buffer,
  tailleFenetre: number,
  maxFenetres = 4,
): { time: string | null; fenetres: number } {
  let start = 0;

  for (let fenetres = 1; fenetres <= maxFenetres; fenetres++) {
    const fenetre = fichier.subarray(start, Math.min(start + tailleFenetre, fichier.length));
    const { moovOffset, nextOffset } = findMoovOffset(fenetre, start, fichier.length);

    if (moovOffset !== null) {
      const time = readCreationTime(fenetre, moovOffset - start);
      if (time !== null || moovOffset === start) return { time, fenetres };
      start = moovOffset;
      continue;
    }

    if (nextOffset === null) return { time: null, fenetres };
    start = nextOffset;
  }

  return { time: null, fenetres: maxFenetres };
}

describe('findMoovOffset', () => {
  it('trouve un `moov` placé en tête', () => {
    const fichier = Buffer.concat([ftyp(), boite('moov', mvhd0('2026-07-29T14:30:12Z'))]);

    const scan = findMoovOffset(fichier, 0, fichier.length);

    assert.equal(scan.moovOffset, 16);
    assert.equal(scan.nextOffset, null);
  });

  it('rend la frontière suivante quand la fenêtre finit avant le `moov`', () => {
    // Le cas ordinaire d'un enregistrement de téléphone : le `moov` est derrière
    // un `mdat` de plusieurs Mo, hors de la première fenêtre.
    const mdat = boite('mdat', Buffer.alloc(4096));
    const fichier = Buffer.concat([ftyp(), mdat, boite('moov', mvhd0('2026-07-29T14:30:12Z'))]);
    const fenetre = fichier.subarray(0, 64);

    const scan = findMoovOffset(fenetre, 0, fichier.length);

    assert.equal(scan.moovOffset, null);
    assert.equal(scan.nextOffset, 16 + mdat.length, 'la frontière est la fin du `mdat`');
  });

  it('suit une taille écrite sur 64 bits', () => {
    // Au-delà de 4 Go, mais aussi par habitude de certains encodeurs : la vraie
    // taille est derrière le type, et l'en-tête fait 16 octets.
    const mdat = boite64('mdat', Buffer.alloc(64));
    const fichier = Buffer.concat([ftyp(), mdat, boite('moov', mvhd0('2026-08-05T09:00:00Z'))]);

    const scan = findMoovOffset(fichier, 0, fichier.length);

    assert.equal(scan.moovOffset, 16 + mdat.length);
  });

  it("n'annonce plus de frontière après une boîte qui court jusqu'à la fin", () => {
    // `size == 0` : la boîte prend tout le reste du fichier. Insister ferait
    // relire indéfiniment le même offset.
    const entete = Buffer.alloc(8);
    entete.writeUInt32BE(0, 0);
    entete.write('mdat', 4, 'latin1');
    const fichier = Buffer.concat([ftyp(), entete, Buffer.alloc(1024)]);

    const scan = findMoovOffset(fichier, 0, fichier.length);

    assert.deepEqual(scan, { moovOffset: null, nextOffset: null });
  });

  it('abandonne sur des octets qui ne sont pas des boîtes', () => {
    // Un conteneur qu'on ne sait pas ouvrir ne doit pas produire de date : la
    // suite du parcours retombera sur le nom du fichier.
    const bruit = Buffer.alloc(256);
    for (let i = 0; i < bruit.length; i++) bruit[i] = (i * 37 + 11) % 256;

    assert.deepEqual(findMoovOffset(bruit, 0, bruit.length), {
      moovOffset: null,
      nextOffset: null,
    });
  });
});

describe('readCreationTime', () => {
  it('lit un `mvhd` version 0', () => {
    const fichier = Buffer.concat([ftyp(), boite('moov', mvhd0('2026-07-29T14:30:12Z'))]);

    assert.equal(readCreationTime(fichier, 16), '2026-07-29T14:30:12.000Z');
  });

  it('lit un `mvhd` version 1, dont les dates sont sur 64 bits', () => {
    const fichier = Buffer.concat([ftyp(), boite('moov', mvhd1('2026-08-05T09:15:44Z'))]);

    assert.equal(readCreationTime(fichier, 16), '2026-08-05T09:15:44.000Z');
  });

  it('ignore un `mvhd` orphelin resté dans une boîte `free`', () => {
    // Treize fichiers de l'import portaient ce défaut : un ancien `moov`
    // neutralisé en `free`, dont le `mvhd` garde une date périmée. Un balayage
    // par signature aurait daté la vidéo de celle-là.
    const perime = Buffer.concat([mvhd0('2019-01-01T00:00:00Z'), boite('trak', Buffer.alloc(32))]);
    const fichier = Buffer.concat([
      ftyp(),
      boite('free', perime),
      boite('moov', mvhd0('2026-07-29T14:30:12Z')),
    ]);

    const scan = findMoovOffset(fichier, 0, fichier.length);
    assert.notEqual(scan.moovOffset, null);
    assert.equal(readCreationTime(fichier, scan.moovOffset!), '2026-07-29T14:30:12.000Z');
  });

  it('ne devine rien sur un `moov` coupé par la fenêtre', () => {
    const fichier = Buffer.concat([ftyp(), boite('moov', mvhd0('2026-07-29T14:30:12Z'))]);
    // La fenêtre s'arrête au milieu du `mvhd` : la date n'y est pas entière.
    const tronque = fichier.subarray(0, 30);

    assert.equal(readCreationTime(tronque, 16), null);
  });

  it('traite une horloge jamais renseignée comme une absence', () => {
    const corps = Buffer.alloc(100);
    const fichier = Buffer.concat([ftyp(), boite('moov', boite('mvhd', corps))]);

    assert.equal(readCreationTime(fichier, 16), null);
  });

  it('écarte une date que rien ne peut avoir enregistrée', () => {
    // Des muxeurs écrivent dans ce champ des secondes comptées depuis 1970, ce
    // qui donne une date des années 1950 : mieux vaut ne rien rendre.
    const corps = Buffer.alloc(100);
    corps.writeUInt32BE(Math.floor(Date.parse('2026-07-29T14:30:12Z') / 1000), 4);
    const fichier = Buffer.concat([ftyp(), boite('moov', boite('mvhd', corps))]);

    assert.equal(readCreationTime(fichier, 16), null);
  });
});

describe('readVideoCodec', () => {
  it('lit le codec de la piste image, placée après la piste son', () => {
    // L'ordre courant sur un enregistrement de téléphone. Prendre le premier
    // `stsd` venu rendrait `mp4a` — un codec audio — et ferait transcoder toutes
    // les vidéos, y compris celles que le navigateur lit déjà.
    const fichier = Buffer.concat([
      ftyp(),
      boite(
        'moov',
        Buffer.concat([mvhd0('2026-07-29T14:30:12Z'), trak('soun', 'mp4a'), trak('vide', 'hvc1')]),
      ),
    ]);

    assert.equal(readVideoCodec(fichier, 16), 'hvc1');
  });

  it('reconnaît les deux écritures de l’HEVC et celle de l’H.264', () => {
    // `hvc1` et `hev1` désignent le même codec, à la façon de ranger les
    // paramètres près : les deux sont illisibles là où l'un l'est.
    for (const format of ['hvc1', 'hev1', 'avc1']) {
      const fichier = Buffer.concat([
        ftyp(),
        boite('moov', Buffer.concat([mvhd0('2026-07-29T14:30:12Z'), trak('vide', format)])),
      ]);

      assert.equal(readVideoCodec(fichier, 16), format);
    }
  });

  it('ne devine rien quand le `stsd` déborde de la fenêtre', () => {
    const fichier = Buffer.concat([
      ftyp(),
      boite('moov', Buffer.concat([mvhd0('2026-07-29T14:30:12Z'), trak('vide', 'hvc1')])),
    ]);
    // La fenêtre s'arrête dix octets avant la fin : le `stsd` n'y est pas
    // entier, et il vaut mieux ne rien rendre que lire des octets absents.
    const tronque = fichier.subarray(0, fichier.length - 10);

    assert.equal(readVideoCodec(tronque, 16), null);
  });

  it('rend `null` sur un `moov` sans piste image', () => {
    // Un enregistrement sonore mal classé, ou un conteneur dont la piste image
    // se décrit autrement : la colonne retient « examiné, rien trouvé ».
    const fichier = Buffer.concat([
      ftyp(),
      boite('moov', Buffer.concat([mvhd0('2026-07-29T14:30:12Z'), trak('soun', 'mp4a')])),
    ]);

    assert.equal(readVideoCodec(fichier, 16), null);
  });

  it('ne lit pas un `trak` resté dans une boîte `free`', () => {
    // Le piège de `readCreationTime`, à l'identique : un ancien `moov` neutralisé
    // porte encore ses pistes, et son codec peut ne plus être celui du fichier.
    const perime = boite('free', trak('vide', 'avc1'));
    const fichier = Buffer.concat([
      ftyp(),
      perime,
      boite('moov', Buffer.concat([mvhd0('2026-07-29T14:30:12Z'), trak('vide', 'hvc1')])),
    ]);

    const scan = findMoovOffset(fichier, 0, fichier.length);
    assert.equal(readVideoCodec(fichier, scan.moovOffset!), 'hvc1');
  });
});

describe('parcours par fenêtres', () => {
  it('atteint un `moov` lointain en deux fenêtres', () => {
    const fichier = Buffer.concat([
      ftyp(),
      boite('mdat', Buffer.alloc(200_000)),
      boite('moov', mvhd0('2026-07-29T14:30:12Z')),
    ]);

    assert.deepEqual(lireEnTete(fichier, 64 * 1024), {
      time: '2026-07-29T14:30:12.000Z',
      fenetres: 2,
    });
  });

  it('rouvre une fenêtre sur un `moov` que la précédente ne contenait pas entier', () => {
    // Le `moov` commence vingt octets avant la fin de la fenêtre : son en-tête
    // y est, son `mvhd` non. La date ne doit pas être devinée sur ce qui reste.
    const fichier = Buffer.concat([
      ftyp(),
      boite('mdat', Buffer.alloc(1000)),
      boite('moov', mvhd0('2026-08-05T09:15:44Z')),
    ]);

    assert.deepEqual(lireEnTete(fichier, 1044), {
      time: '2026-08-05T09:15:44.000Z',
      fenetres: 2,
    });
  });

  it('rend `null` sur un fichier sans `moov`', () => {
    const fichier = Buffer.concat([ftyp(), boite('mdat', Buffer.alloc(512)), boite('free')]);

    assert.equal(lireEnTete(fichier, 64).time, null);
  });
});
