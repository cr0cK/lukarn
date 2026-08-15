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
 * Preparing unplayable videos.
 *
 * **ffmpeg is never called here**: CI need not depend on it, and an encoding
 * test takes longer than all the others combined. The runner is a seam designed
 * for this. What is verified is the discipline of the run — taking only what
 * is unplayable, one video at a time, and stopping when asked — plus the pure
 * command line construction.
 */

const dir = mkdtempSync(join(tmpdir(), 'lukarn-transcode-'));
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
  /** Identifiers actually transcoded, in order. */
  faits: string[];
  /** Received durations in the same order, because the bitrate cap depends on them. */
  durees: (number | null)[];
  /** Number of transcodes currently running: never more than one. */
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
      // One event-loop turn: two concurrent runs would overlap here, which the
      // counter above would detect.
      await Promise.resolve();
      faux.simultanes--;
      if (options.echoue?.has(fileId)) throw new Error('ffmpeg exited with 1');
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

describe('ffmpeg command line', () => {
  const args = ffmpegArgs({ source: '/tmp/a.mov', cible: '/tmp/b.mp4' });

  it('places `moov` at the start of the output file', () => {
    // Without `+faststart`, the browser can neither start before the download
    // finishes nor seek through the film: the video "works" locally but becomes
    // unusable as soon as it travels over the network.
    assert.ok(args.includes('+faststart'));
    assert.equal(args[args.indexOf('+faststart') - 1], '-movflags');
  });

  it('encodes as 8-bit H.264 at the target constant rate', () => {
    assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
    assert.equal(args[args.indexOf('-crf') + 1], '23');
    // Phone HEVC is often 10-bit, which the browser H.264 profile does not
    // support: without conversion, the output would be just as unplayable as
    // the original.
    assert.equal(args[args.indexOf('-pix_fmt') + 1], 'yuv420p');
  });

  it('uses only one thread', () => {
    // This is the accepted cost of slowness: the server must remain responsive
    // during the minutes an encoding takes.
    assert.equal(args[args.indexOf('-threads') + 1], '1');
  });

  it('specifies the container instead of leaving it to inference', () => {
    // The output is named `*.sortie.tmp` while encoding, and ffmpeg infers its
    // muxer from the extension: without `-f mp4`, it stops with "Error opening
    // output files: Invalid argument" and the store remains empty without any
    // other indication.
    assert.equal(args[args.indexOf('-f') + 1], 'mp4');
    assert.ok(
      args.indexOf('-f') > args.indexOf('-i'),
      'after the input: this is the output format',
    );
  });

  it('accepts a silent video', () => {
    // `0:a?` rather than `0:a`: without the question mark, ffmpeg fails on a
    // video without an audio track, as with every video recorded in silent mode.
    assert.ok(args.includes('0:a?'));
    assert.equal(args.at(-1), '/tmp/b.mp4');
  });

  it('does not cap the bitrate when no limit is known', () => {
    // CRF alone, as before: this covers a video whose duration is absent from
    // the index, and a large derivative is better than one capped arbitrarily.
    assert.equal(args.includes('-maxrate'), false);
    assert.equal(args.includes('-bufsize'), false);
  });

  it('caps the bitrate without dropping CRF when a limit is known', () => {
    const bornes = ffmpegArgs({ source: '/tmp/a.mov', cible: '/tmp/b.mp4', plafondKbps: 4000 });

    // Together, x264 targets quality and clips only when it exceeds the cap.
    // CRF alone has a variable bitrate with no upper limit, which is exactly
    // what produced a derivative larger than its source (D260809g).
    assert.equal(bornes[bornes.indexOf('-crf') + 1], '23');
    assert.equal(bornes[bornes.indexOf('-maxrate') + 1], '4000k');
    // Two seconds of bitrate: shorter needlessly clips complex scenes, while
    // longer lets the file exceed the limit over its full duration.
    assert.equal(bornes[bornes.indexOf('-bufsize') + 1], '8000k');
  });
});

describe('bitrate cap', () => {
  it('stays below the source after allowing for x264 overshoot', () => {
    // 50 MB for 20 s, the production case measured at 66.8 MB: 20,000 kbit/s
    // from the source, minus 5% container overhead, divided by the 15%
    // `-maxrate` overshoot, minus 128 for audio.
    const plafond = plafondDebit(50_000_000, 20_000);
    assert.equal(plafond, 16_393);

    // This is the cap's entire promise, and it must hold in the worst case, not
    // only nominally: the derivative is smaller than its source **even** when
    // x264 overshoots by 15% and audio takes 128 kbit/s. A margin accounting
    // only for the container would allow 52.3 MB for a 50 MB source, exactly
    // the defect being corrected.
    const pireCas = ((plafond! + 128) * 1.15 * 20_000) / 8;
    assert.ok(pireCas < 50_000_000, `${pireCas} bytes must remain below the source`);
  });

  it('gives up rather than making a video unwatchable', () => {
    // An already lightweight source would produce a cap below which 1080p is no
    // longer watchable — playability is the goal and size is only a side effect
    // (D260809g).
    assert.equal(plafondDebit(500_000, 20_000), null);
  });

  it('gives up when duration is missing or nonsensical', () => {
    // Dividing by zero duration would produce `Infinity`, while a missing
    // duration means the index has not probed the video yet.
    assert.equal(plafondDebit(50_000_000, null), null);
    assert.equal(plafondDebit(50_000_000, 0), null);
    assert.equal(plafondDebit(0, 20_000), null);
  });
});

describe('transcoding pass', () => {
  it('takes only unplayable codecs from newest to oldest', async () => {
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

    // The `avc1` that everyone can already play must never be transcoded: that
    // would spend minutes of CPU time degrading the image.
    assert.deepEqual(faux.faits, ['recente', 'ancienne']);
    assert.equal(resultat.transcoded, 2);
    // Duration is passed to the producer: without it, the bitrate cannot be
    // capped and the derivative would sometimes become larger than its source.
    assert.deepEqual(faux.durees, [60_000, 60_000]);
  });

  it('skips a video already in the store', async () => {
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

  it('rebuilds a video whose content has changed', async () => {
    // The key carries the content fingerprint: Drive retains the identifier of
    // a file replaced with a new version, and without it the old film would be
    // read forever through the new one.
    media.upsertMany([video('version', 'clip', 1, 'hvc1')], '2026-07-01T12:00:00.000Z');
    const store = new MediaCache(join(dir, 'magasin-version'), 10_000_000, silencieux);
    await store.put(playableKey('clip', 'empreinte-dhier'), Buffer.alloc(16, 1));
    const faux = fauxTranscodeur();

    await new TranscodePass(deps('version', faux, { store })).run();

    assert.deepEqual(faux.faits, ['clip']);
  });

  it('transcodes only one at a time even across two runs', async () => {
    media.upsertMany(
      [video('double', 'd1', 2, 'hvc1'), video('double', 'd2', 1, 'hvc1')],
      '2026-07-02T12:00:00.000Z',
    );
    const faux = fauxTranscodeur();
    const passage = new TranscodePass(deps('double', faux));

    // Two concurrent runs mean two ffmpeg processes, exactly what "one task at
    // a time" is meant to prevent on a small server.
    await Promise.all([passage.run(), passage.run()]);

    assert.equal(faux.maxSimultanes, 1);
    assert.deepEqual(faux.faits, ['d1', 'd2']);
  });

  it('does nothing when the setting is disabled', async () => {
    media.upsertMany([video('coupe', 'c1', 1, 'hvc1')], '2026-07-01T12:00:00.000Z');
    const faux = fauxTranscodeur();

    const resultat = await new TranscodePass(deps('coupe', faux, { enabled: () => false })).run();

    assert.deepEqual(faux.faits, []);
    assert.equal(resultat.transcoded, 0);
  });

  it('stops midway if the setting is disabled', async () => {
    media.upsertMany(
      [
        video('bascule', 'b1', 3, 'hvc1'),
        video('bascule', 'b2', 2, 'hvc1'),
        video('bascule', 'b3', 1, 'hvc1'),
      ],
      '2026-07-03T12:00:00.000Z',
    );
    const faux = fauxTranscodeur();

    // Disabling during a run must stop it, not merely prevent the next one: the
    // setting is disabled precisely because the server is being affected.
    let restant = 2;
    const resultat = await new TranscodePass(
      deps('bascule', faux, { enabled: () => restant-- > 0 }),
    ).run();

    assert.deepEqual(faux.faits, ['b1']);
    assert.equal(resultat.stopped, 'stopped');
  });

  it('stops when the store reaches its budget', async () => {
    media.upsertMany([video('budget', 'p1', 1, 'hvc1')], '2026-07-01T12:00:00.000Z');
    const faux = fauxTranscodeur();

    // At the limit, every new video would evict the oldest: the next run would
    // spend ten minutes of CPU recreating what this one just discarded.
    const plein = {
      stats: () => ({ entryCount: 0, bytes: 9_500_000, maxBytes: 10_000_000 }),
      has: () => false,
    } as unknown as MediaCache;

    const resultat = await new TranscodePass(deps('budget', faux, { store: plein })).run();

    assert.deepEqual(faux.faits, []);
    assert.equal(resultat.stopped, 'budget');
  });

  it('continues after a video ffmpeg rejects', async () => {
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

describe('derivative production', () => {
  /** Stubbed storage: the response body is the downloaded "file". */
  function stockage(contenu: string): { fetch: unknown; guard: unknown } {
    return {
      fetch: () => Promise.resolve(new Response(contenu)),
      guard: <T>(operation: () => Promise<T>) => operation(),
    };
  }

  it('stores the output and removes its temporary files', async () => {
    const root = join(dir, 'production');
    const store = new MediaCache(root, 10_000_000, silencieux);
    await store.load();

    const transcodeur = new VideoTranscoder({
      storage: stockage('des octets de film') as never,
      store,
      root,
      // The runner writes the target in place of ffmpeg, exactly what the real
      // one does with an additional ten minutes.
      run: (args) => {
        writeFileSync(args.at(-1)!, Buffer.alloc(512, 3));
        return Promise.resolve();
      },
    });

    await transcodeur.transcode('clip', 'empreinte', 60_000, AbortSignal.timeout(5_000));

    const range = store.hit(playableKey('clip', 'empreinte'));
    assert.ok(range, 'the playable version must be in the store');
    assert.equal(store.stats().bytes, 512);
    assert.deepEqual(
      readdirSync(root).filter((nom) => nom.endsWith('.tmp')),
      [],
    );
  });

  it('removes its temporary files even when ffmpeg fails', async () => {
    const root = join(dir, 'echec');
    const store = new MediaCache(root, 10_000_000, silencieux);
    await store.load();

    const transcodeur = new VideoTranscoder({
      storage: stockage('des octets de film') as never,
      store,
      root,
      run: () => Promise.reject(new Error('ffmpeg exited with 1')),
    });

    await assert.rejects(() =>
      transcodeur.transcode('casse', null, 60_000, AbortSignal.timeout(5_000)),
    );

    // A 150 MB original left behind after every failed attempt would fill the
    // disk without the store inventory knowing anything about it.
    assert.deepEqual(
      readdirSync(root).filter((nom) => nom.endsWith('.tmp')),
      [],
    );
    assert.equal(store.hit(playableKey('casse', null)), null);
  });

  it('removes on start-up a temporary file left by an abrupt stop', async () => {
    const root = join(dir, 'orphelin');
    const orphelin = join(root, '1234-1.source.tmp');
    const premier = new MediaCache(root, 10_000_000, silencieux);
    await premier.load();
    writeFileSync(orphelin, Buffer.alloc(4096, 9));

    // The store inventory performs this clean-up — transcoding writes temporary
    // files under its root specifically for this reason.
    const second = new MediaCache(root, 10_000_000, silencieux);
    await second.load();

    assert.equal(existsSync(orphelin), false);
    assert.equal(second.stats().bytes, 0);
  });
});
