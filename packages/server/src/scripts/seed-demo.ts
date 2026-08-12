import { dirname } from 'node:path';
import sharp from 'sharp';
import { ConfigRepo } from '../config-repo.js';
import { openDb } from '../db.js';
import { loadDotEnv } from '../dotenv.js';
import { loadEnv } from '../env.js';
import { MediaCache } from '../media/cache.js';
import { AlbumDayRepo, PlacesPass } from '../places.js';
import { MediaRepo, SyncStateRepo, type MediaUpsert } from '../repo.js';

/**
 * Demonstration dataset for developing and checking the interface without a Google
 * Drive account.
 *
 *   pnpm --filter @nonni/server seed-demo [count]
 *
 * Inserts media into the index **and** pre-fills the cache with locally generated
 * images: the rendering pipeline finds everything cached and never contacts Drive.
 *
 * Do not run on a real instance — the next synchronisation would delete these entries,
 * but they would pollute albums meanwhile.
 */

const SHAPES = [
  { width: 4032, height: 3024 }, // 4:3 landscape
  { width: 3024, height: 4032 }, // 4:3 portrait
  { width: 5472, height: 3078 }, // 16:9
  { width: 2048, height: 2048 }, // square
  { width: 6000, height: 2000 }, // panoramic
];

const CAMERAS = [
  { make: 'Canon', model: 'Canon EOS R6', lens: 'RF24-70mm F2.8 L IS USM' },
  { make: 'Apple', model: 'iPhone 15 Pro', lens: 'iPhone 15 Pro back camera' },
  { make: 'FUJIFILM', model: 'X-T5', lens: 'XF33mmF1.4 R LM WR' },
  { make: 'SONY', model: 'ILCE-7M4', lens: 'FE 35mm F1.8' },
];

/**
 * Two places around twenty kilometres apart, beyond the clustering radius: a day
 * carrying both produces two clusters, the interesting case to inspect. Labels are
 * written directly to `geo_places` so the demo shows names without calling Nominatim.
 */
const DEMO_PLACES = [
  { lat: 41.3878, lng: 9.1597, label: 'Bonifacio, Corse-du-Sud' },
  { lat: 41.5911, lng: 9.2795, label: 'Porto-Vecchio, Corse-du-Sud' },
];

/** Hue derived from the index so the grid remains readable and reproducible. */
function colorFor(index: number): { r: number; g: number; b: number } {
  const hue = (index * 47) % 360;
  const c = 0.55;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  const m = 0.18;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

async function renderPlaceholder(
  index: number,
  width: number,
  height: number,
  edge: number,
): Promise<Buffer> {
  const scale = Math.min(1, edge / Math.max(width, height));
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const color = colorFor(index);

  const label = `#${index + 1}`;
  const fontSize = Math.round(Math.min(outWidth, outHeight) * 0.22);

  // Fine test pattern: at screen size these lines merge, while zoom separates them.
  // This verifies that the high-resolution variant adds detail rather than enlarging
  // existing pixels.
  const step = Math.max(4, Math.round(Math.max(outWidth, outHeight) / 160));
  const gridStroke = Math.max(0.5, step / 24);

  const svg = `
    <svg width="${outWidth}" height="${outHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="rgb(${color.r},${color.g},${color.b})" />
          <stop offset="100%" stop-color="rgb(${Math.round(color.r * 0.35)},${Math.round(
            color.g * 0.35,
          )},${Math.round(color.b * 0.55)})" />
        </linearGradient>
        <pattern id="mire" width="${step}" height="${step}" patternUnits="userSpaceOnUse">
          <path d="M ${step} 0 L 0 0 0 ${step}" fill="none"
                stroke="rgba(255,255,255,0.28)" stroke-width="${gridStroke}" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)" />
      <rect width="100%" height="100%" fill="url(#mire)" />
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
            font-family="sans-serif" font-size="${fontSize}" font-weight="700"
            fill="rgba(255,255,255,0.82)">${label}</text>
      <text x="50%" y="${outHeight * 0.62}" text-anchor="middle" dominant-baseline="central"
            font-family="monospace" font-size="${Math.max(6, Math.round(fontSize * 0.07))}"
            fill="rgba(255,255,255,0.75)">render ${outWidth}×${outHeight} px</text>
    </svg>`;

  return sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
}

/** Position of a demo photo: two out of three have none. */
function position(index: number): { lat: number | null; lng: number | null } {
  if (index % 3 !== 0) return { lat: null, lng: null };
  const place = DEMO_PLACES[(index / 3) % DEMO_PLACES.length]!;
  // A spread of a few hundred metres around the place exercises clustering without
  // crossing its radius.
  const jitter = ((index % 7) - 3) * 0.004;
  return { lat: place.lat + jitter, lng: place.lng + jitter };
}

/**
 * Names cells produced by the places pass by associating them with the nearest demo
 * place. Otherwise the demo would gain labels only after network calls to Nominatim,
 * capped at one per second.
 */
function labelDemoCells(db: ReturnType<typeof openDb>): number {
  const cells = (
    db.prepare('SELECT DISTINCT cells FROM album_days WHERE cells IS NOT NULL').all() as {
      cells: string;
    }[]
  ).flatMap((row) => JSON.parse(row.cells) as string[]);

  const statement = db.prepare(
    `INSERT INTO geo_places (cell, label, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT (cell) DO UPDATE SET label = excluded.label`,
  );
  const now = new Date().toISOString();

  for (const cell of new Set(cells)) {
    const [lat, lng] = cell.split(',').map(Number);
    const nearest = DEMO_PLACES.reduce((best, place) =>
      Math.hypot(place.lat - lat!, place.lng - lng!) < Math.hypot(best.lat - lat!, best.lng - lng!)
        ? place
        : best,
    );
    statement.run(cell, nearest.label, now);
  }

  return new Set(cells).size;
}

async function main(): Promise<void> {
  const envFile = loadDotEnv();

  const count = Number(process.argv[2] ?? 240);
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error('Invalid media count');
  }

  const env = loadEnv(process.env, envFile ? dirname(envFile) : process.cwd());
  const db = openDb(env.dataDir);
  const config = new ConfigRepo(db);
  const media = new MediaRepo(db);
  const syncState = new SyncStateRepo(db);
  const cache = new MediaCache(env.cacheDir, config.settings().cacheMaxSizeGB * 1024 ** 3);
  await cache.load();

  // Albums come from the database, the sole source of truth since configuration moved
  // into the application.
  const albums = config.albums();
  if (albums.length === 0) {
    throw new Error(
      'No album in the database: create one from /admin (or bootstrap an install ' +
        'with config/albums.yaml) before running the demo.',
    );
  }

  const seenAt = new Date().toISOString();
  let created = 0;

  for (const [albumIndex, album] of albums.entries()) {
    const items: MediaUpsert[] = [];
    // Each album covers a distinct period so monthly grid grouping is visible.
    const baseMonth = albumIndex * 5;

    for (let index = 0; index < count; index++) {
      const shape = SHAPES[index % SHAPES.length]!;
      const camera = CAMERAS[index % CAMERAS.length]!;
      const id = `demo-${album.id}-${String(index).padStart(4, '0')}`;

      // Spread over around six months, newest to oldest.
      const daysAgo = baseMonth * 30 + Math.floor((index / count) * 180);
      const takenAt = new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString();

      // One video per 25 media items to check video-tile rendering.
      const isVideo = index % 25 === 24;

      items.push({
        albumId: album.id,
        id,
        name: isVideo ? `VID_${index}.mp4` : `IMG_${String(index).padStart(4, '0')}.jpg`,
        mimeType: isVideo ? 'video/mp4' : 'image/jpeg',
        kind: isVideo ? 'video' : 'photo',
        size: isVideo ? 48_000_000 : 4_200_000 + index * 1000,
        width: shape.width,
        height: shape.height,
        takenAt,
        takenAtFromExif: !isVideo,
        modifiedTime: takenAt,
        durationMs: isVideo ? 12_000 + index * 137 : null,
        cameraMake: isVideo ? null : camera.make,
        cameraModel: isVideo ? null : camera.model,
        lens: isVideo ? null : camera.lens,
        isoSpeed: isVideo ? null : [100, 200, 400, 800, 1600][index % 5]!,
        exposureTime: isVideo ? null : [1 / 60, 1 / 125, 1 / 250, 1 / 500][index % 4]!,
        aperture: isVideo ? null : [1.8, 2.8, 4, 5.6][index % 4]!,
        focalLength: isVideo ? null : [24, 35, 50, 85][index % 4]!,
        // One photo in three is geolocated, alternating between the two places: days
        // carrying both show chronological cluster order in their heading.
        ...position(index),
        md5: null,
        // Demo videos have a preview like those in a real Drive; without it the grid
        // would show a plain tile and the poster path could not be checked offline.
        hasThumbnail: true,
        videoCodec: null,
      });

      // Pre-fills every variant the interface may request. Keys must exactly follow
      // renderer `variantKey()`, otherwise the server misses them and queries Drive.
      const variantes: [string, number][] = [
        [`${id}:t320`, 320],
        [`${id}:t640`, 640],
        [`${id}:t1280`, 1280],
      ];
      // Neither `full` nor `hd` for video: the route rejects them with 415 because a
      // video preview is only a thumbnail.
      if (!isVideo) {
        variantes.push([`${id}:full`, 2560], [`${id}:hd`, 4096]);
      }

      for (const [key, edge] of variantes) {
        await cache.put(key, await renderPlaceholder(index, shape.width, shape.height, edge));
      }

      created++;
      if (created % 50 === 0) process.stdout.write(`  ${created} media generated\r`);
    }

    media.upsertMany(items, seenAt);
    syncState.set(album.id, { lastSyncAt: seenAt, status: 'ok', error: null });
    console.log(`Album "${album.id}": ${items.length} demo media`);
  }

  // Days as the server would calculate them, but without a geocoder: labels are written
  // immediately afterwards to avoid a network dependency.
  const days = new AlbumDayRepo(db);
  await new PlacesPass({
    albums: () => albums,
    media,
    days,
    geocoder: null,
    log: { info: () => {}, debug: () => {} },
  }).run();
  const named = labelDemoCells(db);

  // Two notes on the first album's two latest days expose varying heading height and
  // the editing pencil.
  const firstAlbum = albums[0]!;
  const recent = (
    db
      .prepare(
        `SELECT DISTINCT substr(taken_at, 1, 10) AS day FROM media
          WHERE album_id = ? ORDER BY day DESC LIMIT 2`,
      )
      .all(firstAlbum.id) as { day: string }[]
  ).map((row) => row.day);

  const notes = ['Bonifacio, then the beach until sunset.', 'Back over the mountains.'];
  recent.forEach((day, index) =>
    days.upsertNote(firstAlbum.id, day, { description: notes[index]! }),
  );

  // Three described photos among the first album's latest make the viewer caption
  // visible without Drive. The third is deliberately long to show clamping and
  // click-to-expand behaviour.
  const captions = [
    'Léa jumping off the pier, third try — the only one where she doesn’t hold her nose.',
    'The seven o’clock light on the cliffs, ten minutes before it goes.',
    'The little harbour at waking hour, before the tour boats head out. ' +
      'We had it to ourselves, with the café owner bringing in the chairs from the night ' +
      'before and two fishermen hauling up empty nets, talking about the wind. ' +
      'This is the photo everybody asked for again once we were home.',
  ];
  const described = (
    db
      .prepare(
        `SELECT id FROM media WHERE album_id = ? AND kind = 'photo'
          ORDER BY taken_at DESC, id DESC LIMIT ?`,
      )
      .all(firstAlbum.id, captions.length) as { id: string }[]
  ).map((row) => row.id);

  described.forEach((mediaId, index) =>
    media.setDescription(firstAlbum.id, mediaId, { description: captions[index]! }),
  );

  db.close();
  console.log(
    `\n${created} media created, ${named} places named, ${recent.length} days annotated ` +
      `and ${described.length} photos described on "${firstAlbum.id}". ` +
      `Cache: ${cache.stats().entryCount} entries.`,
  );
  console.log('Look at an album set to "by day": places and notes only show up there.');
  // The server inventories the cache at startup; without a restart it will not see
  // files written here and will try to fetch them from Drive.
  console.log('Restart the server so it picks up the generated cache.');
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
