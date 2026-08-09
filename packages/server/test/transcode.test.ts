import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { openDb } from '../src/db.js';
import { MediaCache } from '../src/media/cache.js';
import {
  ffmpegArgs,
  plafondDebit,
  playableKey,
  TranscodePass,
  type TranscodePassDeps,
  type Transcoder,
  VideoTranscoder,
} from '../src/media/transcode.js';
import { MediaRepo, type MediaUpsert } from '../src/repo.js';

/**
 * Préparation des vidéos illisibles.
 *
 * **ffmpeg n'est jamais appelé ici** : la CI n'a pas à en dépendre, et un test
 * qui encode dure plus longtemps que tous les autres réunis. Le lanceur est une
 * couture prévue pour ça. Ce qui est vérifié, c'est la discipline du passage —
 * ne prendre que ce qui est illisible, une vidéo à la fois, s'arrêter quand on
 * le lui demande — et la ligne de commande, qui est pure.
 */

const dir = mkdtempSync(join(tmpdir(), 'gdv-transcode-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const db = openDb(dir);
after(() => db.close());

const media = new MediaRepo(db);
const silencieux = { info: () => {}, warn: () => {}, debug: () => {} };

function video(albumId: string, id: string, jour: number, codec: string | null): MediaUpsert {
  return {
    albumId,
    id,
    name: `${id}.mp4`,
    mimeType: 'video/mp4',
    kind: 'video',
    size: 150_000_000,
    width: 1920,
    height: 1080,
    takenAt: `2026-07-${String(jour).padStart(2, '0')}T12:00:00.000Z`,
    takenAtFromExif: true,
    modifiedTime: '2026-07-01T12:00:00.000Z',
    durationMs: 60_000,
    cameraMake: null,
    cameraModel: null,
    lens: null,
    isoSpeed: null,
    exposureTime: null,
    aperture: null,
    focalLength: null,
    lat: null,
    lng: null,
    md5: `empreinte-${id}`,
    hasThumbnail: true,
    videoCodec: codec,
  };
}

function photo(albumId: string, id: string, jour: number): MediaUpsert {
  return {
    ...video(albumId, id, jour, null),
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    kind: 'photo',
    durationMs: null,
  };
}

interface FauxTranscodeur extends Transcoder {
  /** Identifiants réellement transcodés, dans l'ordre. */
  faits: string[];
  /** Durées reçues, dans le même ordre : le plafond de débit en dépend. */
  durees: (number | null)[];
  /** Nombre de transcodages en cours à cet instant : jamais plus d'un. */
  simultanes: number;
  maxSimultanes: number;
}

function fauxTranscodeur(
  options: { echoue?: Set<string>; store?: MediaCache } = {},
): FauxTranscodeur {
  const faux: FauxTranscodeur = {
    faits: [],
    durees: [],
    simultanes: 0,
    maxSimultanes: 0,
    async transcode(fileId, md5, durationMs) {
      faux.durees.push(durationMs);
      faux.simultanes++;
      faux.maxSimultanes = Math.max(faux.maxSimultanes, faux.simultanes);
      // Un tour de boucle d'événements : deux passages concurrents se
      // chevaucheraient ici, ce que le compteur ci-dessus constaterait.
      await Promise.resolve();
      faux.simultanes--;
      if (options.echoue?.has(fileId)) throw new Error('ffmpeg a rendu 1');
      faux.faits.push(fileId);
      await options.store?.put(playableKey(fileId, md5), Buffer.alloc(16, 7));
    },
  };
  return faux;
}

function deps(
  albumId: string,
  transcoder: Transcoder,
  overrides: Partial<TranscodePassDeps> = {},
): TranscodePassDeps {
  return {
    albums: () => [{ id: albumId }],
    media,
    store: new MediaCache(join(dir, `magasin-${albumId}`), 10_000_000, silencieux),
    transcoder,
    enabled: () => true,
    log: silencieux,
    ...overrides,
  };
}

describe('ligne de commande ffmpeg', () => {
  const args = ffmpegArgs({ source: '/tmp/a.mov', cible: '/tmp/b.mp4' });

  it('place le `moov` en tête du fichier produit', () => {
    // Sans `+faststart`, le navigateur ne peut ni démarrer avant la fin du
    // téléchargement ni chercher dans le film : la vidéo « marche » en local et
    // devient inutilisable dès qu'elle transite par le réseau.
    assert.ok(args.includes('+faststart'));
    assert.equal(args[args.indexOf('+faststart') - 1], '-movflags');
  });

  it('encode en H.264 8 bits, au débit constant visé', () => {
    assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
    assert.equal(args[args.indexOf('-crf') + 1], '23');
    // Un HEVC de téléphone est souvent en 10 bits, que le profil H.264 des
    // navigateurs ne couvre pas : sans conversion, on produirait un fichier tout
    // aussi illisible que l'original.
    assert.equal(args[args.indexOf('-pix_fmt') + 1], 'yuv420p');
  });

  it('n’occupe qu’un seul fil', () => {
    // C'est la contrepartie assumée de la lenteur : le serveur doit rester servi
    // pendant les minutes que dure un encodage.
    assert.equal(args[args.indexOf('-threads') + 1], '1');
  });

  it('dit le conteneur au lieu de le laisser deviner', () => {
    // La sortie s'appelle `*.sortie.tmp` le temps de l'encodage, et ffmpeg
    // déduit son muxeur de l'extension : sans `-f mp4`, il s'arrête sur
    // « Error opening output files: Invalid argument » et le magasin reste vide
    // sans que rien d'autre ne le signale.
    assert.equal(args[args.indexOf('-f') + 1], 'mp4');
    assert.ok(
      args.indexOf('-f') > args.indexOf('-i'),
      'après l’entrée : c’est le format de sortie',
    );
  });

  it('accepte une vidéo muette', () => {
    // `0:a?` et non `0:a` : sans le point d'interrogation, ffmpeg échoue sur une
    // vidéo sans piste son, qui est le cas de toute vidéo prise en mode silence.
    assert.ok(args.includes('0:a?'));
    assert.equal(args.at(-1), '/tmp/b.mp4');
  });

  it('ne borne pas le débit quand aucun plafond n’est connu', () => {
    // CRF seul, comme avant : c'est le cas d'une vidéo dont l'index n'a pas la
    // durée, et il vaut mieux un dérivé lourd qu'un dérivé bridé au hasard.
    assert.equal(args.includes('-maxrate'), false);
    assert.equal(args.includes('-bufsize'), false);
  });

  it('borne le débit sans lâcher le CRF quand un plafond est connu', () => {
    const bornes = ffmpegArgs({ source: '/tmp/a.mov', cible: '/tmp/b.mp4', plafondKbps: 4000 });

    // Les deux ensemble : x264 vise la qualité et n'écrête que si elle coûte
    // plus que le plafond. Le CRF seul est un débit variable sans borne haute,
    // c'est-à-dire exactement ce qui produisait un dérivé plus lourd que sa
    // source (D260809g).
    assert.equal(bornes[bornes.indexOf('-crf') + 1], '23');
    assert.equal(bornes[bornes.indexOf('-maxrate') + 1], '4000k');
    // Deux secondes de débit : plus court, on écrête des scènes chargées sans
    // nécessité ; plus long, le fichier dépasse sur sa durée totale.
    assert.equal(bornes[bornes.indexOf('-bufsize') + 1], '8000k');
  });
});

describe('plafond de débit', () => {
  it('tient sous la source une fois le débordement de x264 payé', () => {
    // 50 Mo pour 20 s, le cas mesuré en production qui produisait 66,8 Mo :
    // 20 000 kbit/s de source, moins 5 % de conteneur, divisés par les 15 % que
    // `-maxrate` déborde, moins les 128 du son.
    const plafond = plafondDebit(50_000_000, 20_000);
    assert.equal(plafond, 16_393);

    // C'est la promesse entière du plafond, et elle doit se vérifier sur le pire
    // cas et non sur le nominal : le dérivé pèse moins que sa source **même**
    // quand x264 déborde de 15 % et que le son prend ses 128 kbit/s. Une marge
    // qui ne compterait que le conteneur laisserait passer 52,3 Mo pour 50, ce
    // qui est exactement le défaut qu'on corrige.
    const pireCas = ((plafond! + 128) * 1.15 * 20_000) / 8;
    assert.ok(pireCas < 50_000_000, `${pireCas} octets doit rester sous la source`);
  });

  it('renonce plutôt que de rendre une vidéo inregardable', () => {
    // Une source déjà très légère donnerait un plafond sous lequel un 1080p
    // n'est plus regardable — or c'est la lisibilité qu'on cherche, le poids
    // n'est qu'un effet secondaire (D260809g).
    assert.equal(plafondDebit(500_000, 20_000), null);
  });

  it('renonce quand la durée manque ou est absurde', () => {
    // Diviser par une durée nulle donnerait `Infinity`, et une durée absente
    // est le cas d'une vidéo que l'index n'a pas encore sondée.
    assert.equal(plafondDebit(50_000_000, null), null);
    assert.equal(plafondDebit(50_000_000, 0), null);
    assert.equal(plafondDebit(0, 20_000), null);
  });
});

describe('passage de transcodage', () => {
  it('ne prend que les codecs illisibles, du plus récent au plus ancien', async () => {
    media.upsertMany(
      [
        photo('tri', 'image', 4),
        video('tri', 'lisible', 3, 'avc1'),
        video('tri', 'recente', 2, 'hvc1'),
        video('tri', 'ancienne', 1, 'hev1'),
      ],
      '2026-07-04T12:00:00.000Z',
    );
    const faux = fauxTranscodeur();

    const resultat = await new TranscodePass(deps('tri', faux)).run();

    // L'`avc1` que tout le monde lit déjà ne doit jamais être transcodé : ce
    // serait des minutes de processeur dépensées à dégrader l'image.
    assert.deepEqual(faux.faits, ['recente', 'ancienne']);
    assert.equal(resultat.transcoded, 2);
    // La durée est transmise au producteur : sans elle il ne peut pas borner le
    // débit, et le dérivé redeviendrait parfois plus lourd que sa source.
    assert.deepEqual(faux.durees, [60_000, 60_000]);
  });

  it('saute une vidéo déjà au magasin', async () => {
    media.upsertMany(
      [video('deja', 'faite', 2, 'hvc1'), video('deja', 'afaire', 1, 'hvc1')],
      '2026-07-02T12:00:00.000Z',
    );
    const store = new MediaCache(join(dir, 'magasin-deja'), 10_000_000, silencieux);
    await store.put(playableKey('faite', 'empreinte-faite'), Buffer.alloc(16, 1));
    const faux = fauxTranscodeur();

    const resultat = await new TranscodePass(deps('deja', faux, { store })).run();

    assert.deepEqual(faux.faits, ['afaire']);
    assert.equal(resultat.skipped, 1);
  });

  it('refait la vidéo dont le contenu a changé', async () => {
    // La clé porte l'empreinte du contenu : Drive garde l'identifiant d'un
    // fichier remplacé par une nouvelle version, et sans elle on relirait
    // éternellement l'ancien film à travers le nouveau.
    media.upsertMany([video('version', 'clip', 1, 'hvc1')], '2026-07-01T12:00:00.000Z');
    const store = new MediaCache(join(dir, 'magasin-version'), 10_000_000, silencieux);
    await store.put(playableKey('clip', 'empreinte-dhier'), Buffer.alloc(16, 1));
    const faux = fauxTranscodeur();

    await new TranscodePass(deps('version', faux, { store })).run();

    assert.deepEqual(faux.faits, ['clip']);
  });

  it('n’en transcode qu’une à la fois, même sur deux passages', async () => {
    media.upsertMany(
      [video('double', 'd1', 2, 'hvc1'), video('double', 'd2', 1, 'hvc1')],
      '2026-07-02T12:00:00.000Z',
    );
    const faux = fauxTranscodeur();
    const passage = new TranscodePass(deps('double', faux));

    // Deux passages concurrents, c'est deux ffmpeg : exactement ce qu'« une
    // seule tâche à la fois » cherche à éviter sur un petit serveur.
    await Promise.all([passage.run(), passage.run()]);

    assert.equal(faux.maxSimultanes, 1);
    assert.deepEqual(faux.faits, ['d1', 'd2']);
  });

  it('ne fait rien quand le réglage est décoché', async () => {
    media.upsertMany([video('coupe', 'c1', 1, 'hvc1')], '2026-07-01T12:00:00.000Z');
    const faux = fauxTranscodeur();

    const resultat = await new TranscodePass(deps('coupe', faux, { enabled: () => false })).run();

    assert.deepEqual(faux.faits, []);
    assert.equal(resultat.transcoded, 0);
  });

  it('s’arrête en cours de route si le réglage est décoché', async () => {
    media.upsertMany(
      [
        video('bascule', 'b1', 3, 'hvc1'),
        video('bascule', 'b2', 2, 'hvc1'),
        video('bascule', 'b3', 1, 'hvc1'),
      ],
      '2026-07-03T12:00:00.000Z',
    );
    const faux = fauxTranscodeur();

    // Décocher pendant un passage doit l'arrêter, pas seulement empêcher le
    // suivant : on décoche précisément parce qu'on constate que ça pénalise le
    // serveur.
    let restant = 2;
    const resultat = await new TranscodePass(
      deps('bascule', faux, { enabled: () => restant-- > 0 }),
    ).run();

    assert.deepEqual(faux.faits, ['b1']);
    assert.equal(resultat.stopped, 'arret');
  });

  it('s’arrête quand le magasin atteint son budget', async () => {
    media.upsertMany([video('budget', 'p1', 1, 'hvc1')], '2026-07-01T12:00:00.000Z');
    const faux = fauxTranscodeur();

    // À la limite, chaque nouvelle vidéo évincerait la plus ancienne : le
    // passage suivant referait en dix minutes de processeur ce que celui-ci
    // vient de jeter.
    const plein = {
      stats: () => ({ entryCount: 0, bytes: 9_500_000, maxBytes: 10_000_000 }),
      has: () => false,
    } as unknown as MediaCache;

    const resultat = await new TranscodePass(deps('budget', faux, { store: plein })).run();

    assert.deepEqual(faux.faits, []);
    assert.equal(resultat.stopped, 'budget');
  });

  it('poursuit après une vidéo que ffmpeg refuse', async () => {
    media.upsertMany(
      [
        video('casse', 'bonne1', 3, 'hvc1'),
        video('casse', 'cassee', 2, 'hvc1'),
        video('casse', 'bonne2', 1, 'hvc1'),
      ],
      '2026-07-03T12:00:00.000Z',
    );
    const faux = fauxTranscodeur({ echoue: new Set(['cassee']) });

    const resultat = await new TranscodePass(deps('casse', faux)).run();

    assert.deepEqual(faux.faits, ['bonne1', 'bonne2']);
    assert.equal(resultat.failed, 1);
  });
});

describe('production d’un dérivé', () => {
  /** Drive bouchonné : le corps de la réponse est le « fichier » téléchargé. */
  function drive(contenu: string): { fetchFile: unknown; guard: unknown } {
    return {
      fetchFile: () => Promise.resolve(new Response(contenu)),
      guard: <T>(operation: () => Promise<T>) => operation(),
    };
  }

  it('range la sortie dans le magasin et efface ses temporaires', async () => {
    const root = join(dir, 'production');
    const store = new MediaCache(root, 10_000_000, silencieux);
    await store.load();

    const transcodeur = new VideoTranscoder({
      drive: drive('des octets de film') as never,
      store,
      root,
      // Le lanceur écrit la cible à la place de ffmpeg : c'est exactement ce que
      // fait le vrai, en dix minutes de plus.
      run: (args) => {
        writeFileSync(args.at(-1)!, Buffer.alloc(512, 3));
        return Promise.resolve();
      },
    });

    await transcodeur.transcode('clip', 'empreinte', 60_000, AbortSignal.timeout(5_000));

    const range = store.hit(playableKey('clip', 'empreinte'));
    assert.ok(range, 'la version lisible doit être au magasin');
    assert.equal(store.stats().bytes, 512);
    assert.deepEqual(
      readdirSync(root).filter((nom) => nom.endsWith('.tmp')),
      [],
    );
  });

  it('efface ses temporaires même quand ffmpeg échoue', async () => {
    const root = join(dir, 'echec');
    const store = new MediaCache(root, 10_000_000, silencieux);
    await store.load();

    const transcodeur = new VideoTranscoder({
      drive: drive('des octets de film') as never,
      store,
      root,
      run: () => Promise.reject(new Error('ffmpeg a rendu 1')),
    });

    await assert.rejects(() =>
      transcodeur.transcode('casse', null, 60_000, AbortSignal.timeout(5_000)),
    );

    // Un original de 150 Mo laissé derrière chaque tentative ratée remplirait
    // le disque sans que l'inventaire du magasin en sache rien.
    assert.deepEqual(
      readdirSync(root).filter((nom) => nom.endsWith('.tmp')),
      [],
    );
    assert.equal(store.hit(playableKey('casse', null)), null);
  });

  it('efface au démarrage un temporaire laissé par un arrêt brutal', async () => {
    const root = join(dir, 'orphelin');
    const orphelin = join(root, '1234-1.source.tmp');
    const premier = new MediaCache(root, 10_000_000, silencieux);
    await premier.load();
    writeFileSync(orphelin, Buffer.alloc(4096, 9));

    // C'est l'inventaire du magasin qui fait ce ménage — le transcodage écrit
    // ses temporaires sous sa racine exactement pour ça.
    const second = new MediaCache(root, 10_000_000, silencieux);
    await second.load();

    assert.equal(existsSync(orphelin), false);
    assert.equal(second.stats().bytes, 0);
  });
});
