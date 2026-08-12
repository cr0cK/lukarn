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
 * Prepares a playable version of videos whose codec no current browser decodes — the
 * `hvc1` files from a recent phone, which made up 25 of 38 files in the album that
 * prompted this module.
 *
 * D6 rejected transcoding over three still-valid concerns, each addressed here: a
 * small server's CPU, hence **one reniced, single-threaded task at a time**; storage,
 * hence a separate bounded store; and the job queue, which is one more loop beside
 * prewarming whose shape and guards this module reuses. The measurements that changed
 * the decision are in D260809b.
 *
 * The original is never replaced: a browser that plays HEVC still receives it at full
 * quality, and the client chooses its source.
 */

/**
 * Codecs to transcode, and nothing else.
 *
 * The rule concerns the codec, never file count or size: transcoding an `avc1` that
 * everyone already plays would spend CPU minutes degrading the image. `hvc1` and
 * `hev1` identify the same HEVC with differently stored parameters.
 */
const CODECS_ILLISIBLES = new Set(['hvc1', 'hev1']);

/**
 * Store usage at which a pass stops.
 *
 * Not 100%: at the limit, each new video would evict the oldest, and the next pass
 * would spend ten CPU minutes recreating what this one discarded. Stop and let the
 * administrator raise the budget instead.
 */
const BUDGET_RATIO = 0.9;

/**
 * Videos per pass. Housekeeping is hourly and 1080p runs near real time: three
 * five-minute films already fill a pass. More would overlap the next without benefit.
 */
const MAX_PER_RUN = 20;

/** Videos read from the index at once. Bounded because `listItems` is synchronous. */
const PAGE_SIZE = 200;

/** ffmpeg process niceness — the maximum supported by `setPriority`. */
const NICE = 15;

const FFMPEG = 'ffmpeg';

/** Output audio bitrate in kbit/s. Must match `-b:a` below. */
const AUDIO_KBPS = 128;

/**
 * Share of source bitrate reserved for non-video bytes.
 *
 * The retained 5% covers the MP4 header and index moved to the front by `+faststart`:
 * targeting source bitrate exactly would produce a slightly larger file, precisely
 * what this cap prevents.
 */
const MARGE_CONTENEUR = 0.95;

/**
 * How far `-maxrate` actually overshoots in the worst case.
 *
 * `-maxrate` is not a cap on the average: it is a VBV constraint over the `-bufsize`
 * window, and x264 exceeds it when the source is too demanding. With ffmpeg 7.1 on
 * `veryfast`: **+9 to +10%** for realistic footage and **+14%** for pure noise, the
 * theoretical worst case. The retained 15% bounds both.
 *
 * Without this division, container margin alone is insufficient and the derivative
 * exceeds its source — the cap fails exactly where it exists to help (D260809g).
 */
const DEBORDEMENT_VBV = 1.15;

/**
 * Cap below which no cap is preferable.
 *
 * A very short source or incorrect duration produces an absurd calculated bitrate,
 * and 1080p capped at 200 kbit/s would be unwatchable — playability is the goal and
 * size only a side effect (D260809g). A slightly heavy derivative is preferable.
 */
const PLAFOND_MINIMAL_KBPS = 500;

/**
 * Maximum video bitrate that keeps a derivative lighter than its source, in kbit/s —
 * or `null` when no reasonable cap exists.
 *
 * `bytes * 8 / durationMs` directly produces kbit/s: the two factors of 1000 —
 * milliseconds to seconds and bits to kilobits — cancel out.
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
 * Derivative key in the store.
 *
 * The content fingerprint is included for the same reason as in the image cache:
 * Drive retains a file ID when content is replaced, and without it the new version
 * would forever play through the old transcoded video.
 */
export function playableKey(fileId: string, md5: string | null): string {
  return md5 ? `${fileId}:${md5}` : fileId;
}

/** Must this codec be transcoded to become playable? */
export function needsTranscoding(codec: string | null): boolean {
  return codec !== null && CODECS_ILLISIBLES.has(codec);
}

/**
 * Transcoding command line. Pure and tested: this is the only part verifiable without
 * running ffmpeg, and every argument addresses an observed failure.
 *
 * - `-map 0:v:0 -map 0:a?` — the first video track and audio **if present**;
 *   without `?`, a silent video makes ffmpeg fail.
 * - `libx264` on `veryfast`, CRF 23 — the tradeoff that sustains real time on one
 *   core at 1080p. Output measured 1.5 times lighter than the HEVC original; space
 *   saving is a side effect, not the goal
 *   (D260809b).
 * - `-maxrate`/`-bufsize` when `plafondKbps` is known — CRF alone is *variable*
 *   bitrate without an upper bound and may exceed a well-encoded source: in production,
 *   3 of 20 derivatives were larger, up to 50.1 MB becoming 66.8 MB. The cap affects
 *   only excessive CRF output; videos already well below source size remain unchanged
 *   (D260809g).
 * - `-pix_fmt yuv420p` — phone HEVC is often 10-bit, outside browser H.264 profiles;
 *   without conversion the output would remain unplayable.
 * - `-threads 1` — the server must remain responsive, at the accepted cost of speed.
 * - `-movflags +faststart` — without `moov` first, the browser can neither start before
 *   download completes nor seek.
 * - `-f mp4` — the container is **stated**, never guessed. ffmpeg normally infers it
 *   from the output extension, which is `.tmp` during encoding; without this argument
 *   it stops with "Error opening output files: Invalid argument", leaving the store
 *   empty with no other indication.
 */
export function ffmpegArgs(fichiers: {
  source: string;
  cible: string;
  /** Maximum video bitrate in kbit/s. Absent: CRF alone, without an upper bound. */
  plafondKbps?: number | null;
}): string[] {
  const plafond = fichiers.plafondKbps
    ? [
        '-maxrate',
        `${fichiers.plafondKbps}k`,
        // Two seconds of bitrate: the window over which x264 must meet the cap. Shorter
        // needlessly clips complex scenes; longer lets total file size exceed the goal.
        '-bufsize',
        `${fichiers.plafondKbps * 2}k`,
      ]
    : [];

  return [
    // Without `-nostdin`, ffmpeg reads and consumes the server's standard input.
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
 * Runs ffmpeg. This is the module seam: tests provide their own and never call the
 * binary — CI need not depend on it, and encoding one video outlasts all other tests.
 */
export type FfmpegRunner = (args: string[], signal: AbortSignal) => Promise<void>;

/** Is `ffmpeg` installed? Checked once at startup. */
export function ffmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(FFMPEG, ['-version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

/**
 * Real runner. The process is reniced as soon as it exists, allowing a thumbnail
 * requested during transcoding to be served without waiting.
 */
export const spawnFfmpeg: FfmpegRunner = (args, signal) =>
  new Promise((resolve, reject) => {
    // `signal` kills the process at server shutdown; otherwise a ten-minute encode
    // would outlive its container.
    const child = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'], signal });

    try {
      if (child.pid) setPriority(child.pid, NICE);
    } catch {
      // Renicing may be refused by kernel policy or a restricted container; transcoding
      // remains useful and merely consumes a little more.
    }

    // Keep only the last line: ffmpeg with `-loglevel error` is terse, but a corrupt
    // file can produce thousands and the message ends up in a log.
    let derniere = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      const lignes = chunk.toString('utf8').trim().split('\n');
      derniere = lignes.at(-1) ?? derniere;
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code}${derniere ? `: ${derniere}` : ''}`));
    });
  });

/** Exactly what the pass expects from its producer. */
export interface Transcoder {
  /**
   * `durationMs` comes from the index: it is the only value the producer cannot read
   * without another `ffprobe`, while source size is measured after download. Both
   * bound bitrate (D260809g); `null` abandons the cap.
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
  /** Store of playable versions — a `MediaCache` mounted on `root`. */
  store: MediaCache;
  /**
   * Store root. Temporary files are written here so final `rename` stays on the same
   * file system and startup inventory removes `.tmp` files left by abrupt shutdown.
   */
  root: string;
  run: FfmpegRunner;
}

/**
 * Produces a playable video version: original downloaded to disk, ffmpeg, then storage.
 *
 * The original passes through a file rather than memory, unlike `MediaRenderer`, which
 * refuses above 80 MB. A 150 MB video must work and need not be held in memory to write.
 */
export class VideoTranscoder implements Transcoder {
  /** Distinguishes temporary files in one process. Never reset. */
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
      // Size is measured from the received file rather than the index: this is what
      // ffmpeg encodes, and Drive may report a missing or stale size that would cap
      // the wrong bitrate.
      const { size } = await stat(source);
      const plafondKbps = plafondDebit(size, durationMs);
      await this.deps.run(ffmpegArgs({ source, cible, plafondKbps }), signal);
      await this.deps.store.putFile(playableKey(fileId, md5), cible);
    } finally {
      // Even on failure, especially on failure: a 150 MB original left after every
      // attempt would fill the disk without appearing in store inventory.
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
  /** Read again on every pass so albums created since startup are included. */
  albums: () => { id: string }[];
  media: MediaRepo;
  store: MediaCache;
  transcoder: Transcoder;
  /** Read for every video so disabling the setting stops the current pass. */
  enabled: () => boolean;
  log: Logger;
}

export interface TranscodeResult {
  transcoded: number;
  /** Unplayable videos whose version was already in the store. */
  skipped: number;
  failed: number;
  stopped: 'finished' | 'budget' | 'ceiling' | 'stopped';
}

/**
 * One pass over every album, newest to oldest, one video at a time.
 *
 * Deliberately follows `CachePrewarmer`, reusing its guards: reject concurrent passes,
 * cap each pass, reread settings per item and stop at shutdown. Two things differ:
 * the store has its own budget, and there is no pause between videos — transcoding
 * takes minutes, so the work itself provides pacing.
 */
export class TranscodePass {
  private running = false;
  private stopping = false;
  /** Renewed on every pass: aborting kills the current ffmpeg. */
  private controller = new AbortController();

  constructor(private readonly deps: TranscodePassDeps) {}

  /** Requests that the current pass stop. Called during server shutdown. */
  stop(): void {
    this.stopping = true;
    this.controller.abort();
  }

  /** Records the stop reason **in** the result and returns it. */
  private stoppedWith(
    result: TranscodeResult,
    raison: TranscodeResult['stopped'],
  ): TranscodeResult {
    result.stopped = raison;
    return result;
  }

  async run(): Promise<TranscodeResult> {
    const result: TranscodeResult = { transcoded: 0, skipped: 0, failed: 0, stopped: 'finished' };

    // Two concurrent passes mean two ffmpeg processes, exactly what "one task at a
    // time" prevents.
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
            // The reason is written into `result`, not a copy returned to the caller:
            // `finally` logs this same object, and a copy would report "completed" for
            // a capped pass — the only trace that videos remain.
            if (this.stopping || !this.deps.enabled()) return this.stoppedWith(result, 'stopped');
            if (result.transcoded >= MAX_PER_RUN) return this.stoppedWith(result, 'ceiling');

            const { bytes, maxBytes } = this.deps.store.stats();
            if (bytes >= maxBytes * BUDGET_RATIO) return this.stoppedWith(result, 'budget');

            if (item.kind !== 'video' || !needsTranscoding(item.videoCodec)) continue;

            const md5 = this.deps.media.getFileMeta(item.id)?.md5 ?? null;
            // `has`, not `hit`: checking the store must not delay eviction order,
            // otherwise the pass would protect content nobody viewed.
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
              // A file ffmpeg refuses must not stop the pass: later videos are unrelated,
              // and the next pass retries it. Abort is included; the loop stops next turn.
              //
              // `warn`, not `debug`: instances run at `info`, and the summary gives only
              // a count. Without this line, a video ffmpeg refuses fails hourly with no
              // explanation, while binary output is the only source of the reason.
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
