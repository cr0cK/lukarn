import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { setPriority } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { DriveService } from '../drive/service.js';
import type { MediaRepo } from '../repo.js';
import type { MediaCache } from './cache.js';

/**
 * Prépare une version lisible des vidéos dont aucun navigateur courant ne décode
 * le codec — les `hvc1` d'un téléphone récent, qui représentaient 25 fichiers sur
 * 38 de l'album qui a motivé ce module.
 *
 * D6 avait écarté le transcodage sur trois objections, qui tiennent toujours et
 * ont chacune leur réponse ici : le processeur d'un petit serveur, d'où **une
 * seule tâche à la fois, reniçée, sur un seul fil** ; le stockage, d'où un
 * magasin distinct et borné ; la file de travaux, qui n'est qu'une boucle de
 * plus à côté du préchauffage, dont ce module reprend la forme et les gardes.
 * Les chiffres qui ont fait pencher la balance sont dans D260809b.
 *
 * L'original n'est jamais remplacé : un navigateur qui sait lire l'HEVC continue
 * de le recevoir en pleine qualité, et c'est le client qui choisit sa source.
 */

/**
 * Codecs qu'on transcode, et rien d'autre.
 *
 * La règle porte sur le codec, jamais sur un nombre de fichiers ou sur un poids :
 * transcoder un `avc1` que tout le monde lit déjà dépenserait des minutes de
 * processeur pour dégrader l'image. `hvc1` et `hev1` désignent le même HEVC, à la
 * façon de ranger les paramètres près.
 */
const CODECS_ILLISIBLES = new Set(['hvc1', 'hev1']);

/**
 * Part du magasin au-delà de laquelle le passage s'arrête.
 *
 * Pas 100 % : à la limite, chaque nouvelle vidéo évincerait la plus ancienne, et
 * le passage suivant referait en dix minutes de processeur ce que celui-ci vient
 * de jeter. Mieux vaut s'arrêter et laisser l'administrateur relever le budget.
 */
const BUDGET_RATIO = 0.9;

/**
 * Vidéos par passage. Le ménage est horaire, et un 1080p tourne autour du temps
 * réel : trois films de cinq minutes remplissent déjà un passage. Au-delà, il
 * empiéterait sur le suivant sans rien apporter.
 */
const MAX_PER_RUN = 20;

/** Vidéos lues d'un coup dans l'index. Bornée : `listItems` est synchrone. */
const PAGE_SIZE = 200;

/** Niveau de gentillesse du processus ffmpeg — le maximum de `setPriority`. */
const NICE = 15;

const FFMPEG = 'ffmpeg';

/** Débit du son produit, en kbit/s. Doit rester d'accord avec `-b:a` ci-dessous. */
const AUDIO_KBPS = 128;

/**
 * Part du débit de la source laissée aux octets qui ne sont pas de l'image.
 *
 * Les 5 % retenus paient l'en-tête MP4 et l'index que `+faststart` remonte en
 * tête : viser le débit de la source à l'octet près produirait un fichier
 * légèrement plus gros qu'elle, ce que ce plafond existe précisément pour
 * empêcher.
 */
const MARGE_CONTENEUR = 0.95;

/**
 * Ce que `-maxrate` dépasse réellement, dans le pire cas.
 *
 * `-maxrate` n'est pas un plafond sur la moyenne : c'est une contrainte VBV sur
 * la fenêtre de `-bufsize`, et x264 la déborde quand la source est trop dure
 * pour le débit accordé. Mesuré sur ffmpeg 7.1 en `veryfast` : **+9 à +10 %** sur
 * une source réaliste, **+14 %** sur du bruit pur, qui est le pire cas
 * théorique. Les 15 % retenus bornent les deux.
 *
 * Sans cette division, la marge de conteneur seule ne suffit pas et le dérivé
 * repasse au-dessus de sa source — c'est-à-dire que le plafond échoue
 * exactement dans le cas pour lequel il existe (D260809g).
 */
const DEBORDEMENT_VBV = 1.15;

/**
 * Plafond en deçà duquel on préfère ne pas en poser.
 *
 * Une source très courte ou à la durée mal déclarée donne un débit calculé
 * absurde, et un 1080p bridé à 200 kbit/s serait illisible autrement — or c'est
 * la lisibilité qu'on cherche, le poids n'est qu'un effet secondaire (D260809g).
 * Mieux vaut alors un dérivé un peu lourd qu'un dérivé inregardable.
 */
const PLAFOND_MINIMAL_KBPS = 500;

/**
 * Débit maximal à laisser à l'image pour qu'un dérivé reste plus léger que sa
 * source, en kbit/s — ou `null` s'il n'y a pas de plafond raisonnable à poser.
 *
 * `octets * 8 / durationMs` donne directement des kbit/s : les deux facteurs
 * 1000 — millisecondes vers secondes, bits vers kilobits — s'annulent.
 */
export function plafondDebit(octets: number, durationMs: number | null): number | null {
  if (durationMs === null || durationMs <= 0 || octets <= 0) return null;
  const source = (octets * 8) / durationMs;
  const plafond = Math.floor((source * MARGE_CONTENEUR) / DEBORDEMENT_VBV) - AUDIO_KBPS;
  return plafond >= PLAFOND_MINIMAL_KBPS ? plafond : null;
}

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  debug: (msg: string) => void;
}

/**
 * Clé du dérivé dans le magasin.
 *
 * L'empreinte du contenu en fait partie, pour la même raison que dans le cache
 * d'images : Drive garde l'identifiant d'un fichier dont on remplace le contenu,
 * et sans elle la nouvelle version se lirait éternellement à travers l'ancienne
 * vidéo transcodée.
 */
export function playableKey(fileId: string, md5: string | null): string {
  return md5 ? `${fileId}:${md5}` : fileId;
}

/** Ce codec doit-il être transcodé pour être lisible ? */
export function needsTranscoding(codec: string | null): boolean {
  return codec !== null && CODECS_ILLISIBLES.has(codec);
}

/**
 * Ligne de commande du transcodage. Pure, et testée : c'est la seule partie de
 * ce module qu'on peut vérifier sans lancer ffmpeg, et chacun de ces arguments
 * répond à un défaut constaté.
 *
 * - `-map 0:v:0 -map 0:a?` — la première piste image et le son **s'il existe** ;
 *   sans le `?`, une vidéo muette fait échouer ffmpeg.
 * - `libx264` en `veryfast`, CRF 23 — le compromis qui tient le temps réel sur
 *   un cœur en 1080p. Le fichier produit est mesuré à 1,5 fois plus léger que
 *   l'HEVC d'origine ; le gain de place est un effet secondaire, pas le but
 *   (D260809b).
 * - `-maxrate`/`-bufsize` quand `plafondKbps` est connu — CRF seul est un débit
 *   *variable* sans borne haute, et sur une source déjà bien encodée il produit
 *   parfois plus lourd qu'elle : mesuré en production, 3 dérivés sur 20 étaient
 *   plus gros que leur original, jusqu'à 50,1 Mo devenus 66,8 Mo. Le plafond ne
 *   mord que là où le CRF partait trop haut ; les vidéos qui sortaient déjà bien
 *   en dessous de leur source sont encodées comme avant (D260809g).
 * - `-pix_fmt yuv420p` — un HEVC de téléphone est souvent en 10 bits, que le
 *   profil H.264 des navigateurs ne couvre pas : sans cette conversion, on
 *   produirait un fichier tout aussi illisible.
 * - `-threads 1` — le serveur doit rester servi pendant ce temps. C'est la
 *   contrepartie de la lenteur assumée.
 * - `-movflags +faststart` — sans `moov` en tête, le navigateur ne peut ni
 *   démarrer avant la fin du téléchargement, ni chercher dans le film.
 * - `-f mp4` — le conteneur est **dit**, jamais deviné. ffmpeg le déduit
 *   normalement de l'extension du fichier de sortie, or celle-ci est `.tmp` le
 *   temps de l'encodage : sans cet argument il s'arrête sur
 *   « Error opening output files: Invalid argument », et le magasin reste vide
 *   sans que rien d'autre ne le signale.
 */
export function ffmpegArgs(fichiers: {
  source: string;
  cible: string;
  /** Débit image maximal en kbit/s. Absent : CRF seul, sans borne haute. */
  plafondKbps?: number | null;
}): string[] {
  const plafond = fichiers.plafondKbps
    ? [
        '-maxrate',
        `${fichiers.plafondKbps}k`,
        // Deux secondes de débit : la fenêtre sur laquelle x264 doit tenir le
        // plafond. Plus courte, elle écrête les scènes chargées sans nécessité ;
        // plus longue, elle laisse le fichier dépasser sur sa durée totale, ce
        // qui est exactement ce qu'on veut empêcher.
        '-bufsize',
        `${fichiers.plafondKbps * 2}k`,
      ]
    : [];

  return [
    // Sans `-nostdin`, ffmpeg lit l'entrée standard du serveur et la consomme.
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    '-i',
    fichiers.source,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    ...plafond,
    '-pix_fmt',
    'yuv420p',
    '-threads',
    '1',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    fichiers.cible,
  ];
}

/**
 * Lance ffmpeg. C'est la couture du module : la suite de tests fournit la
 * sienne, et n'appelle donc jamais le binaire — la CI n'a pas à en dépendre, et
 * un test qui encode une vidéo dure plus longtemps que tous les autres réunis.
 */
export type FfmpegRunner = (args: string[], signal: AbortSignal) => Promise<void>;

/** `ffmpeg` est-il sur cette machine ? Interrogé une fois, au démarrage. */
export function ffmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(FFMPEG, ['-version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

/**
 * Lanceur réel. Le processus est reniçé dès qu'il existe : c'est ce qui permet
 * à une vignette demandée pendant un transcodage d'être servie sans attendre.
 */
export const spawnFfmpeg: FfmpegRunner = (args, signal) =>
  new Promise((resolve, reject) => {
    // `signal` tue le processus à l'extinction du serveur — sinon un encodage de
    // dix minutes survivrait au conteneur qui l'a lancé.
    const child = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'], signal });

    try {
      if (child.pid) setPriority(child.pid, NICE);
    } catch {
      // Renicer peut être refusé (politique du noyau, conteneur restreint) :
      // le transcodage reste utile, il pèsera simplement un peu plus.
    }

    // Seule la dernière ligne est gardée : ffmpeg en `-loglevel error` est
    // laconique, mais un fichier corrompu peut en produire des milliers, et le
    // message finit dans un journal.
    let derniere = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      const lignes = chunk.toString('utf8').trim().split('\n');
      derniere = lignes.at(-1) ?? derniere;
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg a rendu ${code}${derniere ? ` : ${derniere}` : ''}`));
    });
  });

/** Ce que le passage attend de son producteur, et rien de plus. */
export interface Transcoder {
  /**
   * `durationMs` vient de l'index : c'est la seule chose que le producteur ne
   * peut pas lire lui-même sans un `ffprobe` de plus, alors que le poids de la
   * source, lui, se mesure sur le fichier une fois téléchargé. Les deux servent
   * à borner le débit (D260809g) ; `null` renonce au plafond.
   */
  transcode(
    fileId: string,
    md5: string | null,
    durationMs: number | null,
    signal: AbortSignal,
  ): Promise<void>;
}

export interface VideoTranscoderDeps {
  drive: DriveService;
  /** Magasin des versions lisibles — une `MediaCache` montée sur `root`. */
  store: MediaCache;
  /**
   * Racine du magasin. Les temporaires y sont écrits pour deux raisons : le
   * `rename` final reste sur le même système de fichiers, et l'inventaire du
   * démarrage efface les `.tmp` laissés par un arrêt brutal.
   */
  root: string;
  run: FfmpegRunner;
}

/**
 * Produit la version lisible d'une vidéo : original téléchargé sur disque,
 * ffmpeg, puis rangement dans le magasin.
 *
 * L'original transite par un fichier et non par la mémoire : c'est ce qui
 * distingue ce chemin de `MediaRenderer`, qui refuse au-delà de 80 Mo. Une vidéo
 * de 150 Mo doit passer, et rien n'oblige à la tenir en mémoire pour l'écrire.
 */
export class VideoTranscoder implements Transcoder {
  /** Distingue deux temporaires du même processus. Jamais remis à zéro. */
  private serial = 0;

  constructor(private readonly deps: VideoTranscoderDeps) {}

  async transcode(
    fileId: string,
    md5: string | null,
    durationMs: number | null,
    signal: AbortSignal,
  ): Promise<void> {
    await mkdir(this.deps.root, { recursive: true });

    const prefixe = join(this.deps.root, `${process.pid}-${++this.serial}`);
    const source = `${prefixe}.source.tmp`;
    const cible = `${prefixe}.sortie.tmp`;

    try {
      await this.download(fileId, source, signal);
      // Le poids est mesuré sur le fichier reçu, pas lu dans l'index : c'est ce
      // que ffmpeg va réellement encoder, et Drive déclare parfois une taille
      // absente ou périmée — un plafond calculé dessus borderait le mauvais
      // débit.
      const { size } = await stat(source);
      const plafondKbps = plafondDebit(size, durationMs);
      await this.deps.run(ffmpegArgs({ source, cible, plafondKbps }), signal);
      await this.deps.store.putFile(playableKey(fileId, md5), cible);
    } finally {
      // Même en cas d'échec, et surtout en cas d'échec : un original de 150 Mo
      // laissé derrière chaque tentative ratée remplirait le disque sans que
      // l'inventaire du magasin en sache rien.
      await rm(source, { force: true });
      await rm(cible, { force: true });
    }
  }

  private async download(fileId: string, path: string, signal: AbortSignal): Promise<void> {
    const response = await this.deps.drive.guard(() =>
      this.deps.drive.fetchFile(fileId, undefined, signal),
    );
    if (!response.ok || !response.body) {
      throw new Error(`Drive answered ${response.status} for ${fileId}`);
    }
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(path),
    );
  }
}

export interface TranscodePassDeps {
  /** Relu à chaque passage : un album créé depuis le démarrage compte aussi. */
  albums: () => { id: string }[];
  media: MediaRepo;
  store: MediaCache;
  transcoder: Transcoder;
  /** Lu à chaque vidéo : décocher le réglage doit arrêter le passage en cours. */
  enabled: () => boolean;
  log: Logger;
}

export interface TranscodeResult {
  transcoded: number;
  /** Vidéos illisibles dont la version était déjà au magasin. */
  skipped: number;
  failed: number;
  stopped: 'termine' | 'budget' | 'plafond' | 'arret';
}

/**
 * Un passage sur tous les albums, du plus récent au plus ancien, une vidéo à la
 * fois.
 *
 * Copie assumée de la forme de `CachePrewarmer`, dont il reprend les gardes —
 * refus d'un second passage concurrent, plafond par passage, réglage relu à
 * chaque élément, arrêt à l'extinction. Ce qui change tient en deux points : le
 * budget est celui d'un magasin qui n'est qu'à lui, et il n'y a pas de pause
 * entre deux vidéos — le transcodage dure des minutes, la temporisation est déjà
 * dans le travail lui-même.
 */
export class TranscodePass {
  private running = false;
  private stopping = false;
  /** Renouvelé à chaque passage : abandonner tue le ffmpeg en cours. */
  private controller = new AbortController();

  constructor(private readonly deps: TranscodePassDeps) {}

  /** Demande l'arrêt du passage en cours. Appelé à l'extinction du serveur. */
  stop(): void {
    this.stopping = true;
    this.controller.abort();
  }

  /** Note la raison de l'arrêt **dans** le résultat, et le rend. */
  private stoppedWith(
    result: TranscodeResult,
    raison: TranscodeResult['stopped'],
  ): TranscodeResult {
    result.stopped = raison;
    return result;
  }

  async run(): Promise<TranscodeResult> {
    const result: TranscodeResult = { transcoded: 0, skipped: 0, failed: 0, stopped: 'termine' };

    // Deux passages concurrents, c'est deux ffmpeg : exactement ce que « une
    // seule tâche à la fois » cherche à éviter.
    if (this.running || !this.deps.enabled()) return result;
    this.running = true;
    this.stopping = false;
    this.controller = new AbortController();

    try {
      for (const album of this.deps.albums()) {
        let cursor: string | null = null;

        do {
          const page = this.deps.media.listItems(album.id, PAGE_SIZE, cursor, 'desc');
          cursor = page.nextCursor;

          for (const item of page.items) {
            // La raison est écrite dans `result`, pas dans une copie rendue à
            // l'appelant : c'est ce même objet que le `finally` journalise, et
            // une copie ferait dire « terminé » à un passage arrêté sur son
            // plafond — la seule trace qu'il reste des vidéos à faire.
            if (this.stopping || !this.deps.enabled()) return this.stoppedWith(result, 'arret');
            if (result.transcoded >= MAX_PER_RUN) return this.stoppedWith(result, 'plafond');

            const { bytes, maxBytes } = this.deps.store.stats();
            if (bytes >= maxBytes * BUDGET_RATIO) return this.stoppedWith(result, 'budget');

            if (item.kind !== 'video' || !needsTranscoding(item.videoCodec)) continue;

            const md5 = this.deps.media.getFileMeta(item.id)?.md5 ?? null;
            // `has` et non `hit` : consulter le magasin ne doit pas retarder
            // l'entrée dans l'ordre d'éviction, sans quoi le passage protégerait
            // ce que personne n'a jamais regardé.
            if (this.deps.store.has(playableKey(item.id, md5))) {
              result.skipped++;
              continue;
            }

            try {
              await this.deps.transcoder.transcode(
                item.id,
                md5,
                item.durationMs,
                this.controller.signal,
              );
              result.transcoded++;
            } catch (error) {
              // Un fichier que ffmpeg refuse ne doit pas arrêter le passage :
              // les vidéos suivantes n'y sont pour rien, et le prochain tour
              // réessaiera celle-ci. Un abandon en fait partie — le passage
              // s'arrêtera de lui-même au tour de boucle suivant.
              //
              // `warn` et non `debug` : une instance tourne en `info`, et le
              // résumé de fin ne donne qu'un compteur. Sans cette ligne, une
              // vidéo que ffmpeg refuse échoue à chaque passage horaire sans
              // qu'on puisse jamais savoir pourquoi — et le retour du binaire
              // est précisément la seule chose qui le dise.
              result.failed++;
              this.deps.log.warn(`Transcoding ${item.id} failed: ${(error as Error).message}`);
            }
          }
        } while (cursor !== null);
      }

      return result;
    } finally {
      this.running = false;
      if (result.transcoded > 0 || result.failed > 0) {
        this.deps.log.info(
          `Transcode: ${result.transcoded} videos prepared, ${result.skipped} already ready, ` +
            `${result.failed} failed (${result.stopped})`,
        );
      }
    }
  }
}
