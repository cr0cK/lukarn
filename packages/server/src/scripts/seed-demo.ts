import { dirname } from 'node:path';
import sharp from 'sharp';
import { loadConfig } from '../config.js';
import { openDb } from '../db.js';
import { loadDotEnv } from '../dotenv.js';
import { loadEnv } from '../env.js';
import { MediaCache } from '../media/cache.js';
import { MediaRepo, SyncStateRepo, type MediaUpsert } from '../repo.js';

/**
 * Jeu de données de démonstration, pour développer et vérifier l'interface
 * sans compte Google Drive.
 *
 *   pnpm --filter @gdv/server seed-demo [nombre]
 *
 * Insère des médias dans l'index **et** pré-remplit le cache avec des images
 * générées localement : le pipeline de rendu trouve tout en cache et ne
 * cherche jamais à joindre Drive.
 *
 * À ne pas lancer sur une instance réelle — la prochaine synchronisation
 * supprimerait ces entrées, mais elles pollueraient les albums entre-temps.
 */

const SHAPES = [
  { width: 4032, height: 3024 }, // 4:3 paysage
  { width: 3024, height: 4032 }, // 4:3 portrait
  { width: 5472, height: 3078 }, // 16:9
  { width: 2048, height: 2048 }, // carré
  { width: 6000, height: 2000 }, // panoramique
];

const CAMERAS = [
  { make: 'Canon', model: 'Canon EOS R6', lens: 'RF24-70mm F2.8 L IS USM' },
  { make: 'Apple', model: 'iPhone 15 Pro', lens: 'iPhone 15 Pro back camera' },
  { make: 'FUJIFILM', model: 'X-T5', lens: 'XF33mmF1.4 R LM WR' },
  { make: 'SONY', model: 'ILCE-7M4', lens: 'FE 35mm F1.8' },
];

/** Teinte dérivée de l'index : la grille reste lisible et reproductible. */
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

  const svg = `
    <svg width="${outWidth}" height="${outHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="rgb(${color.r},${color.g},${color.b})" />
          <stop offset="100%" stop-color="rgb(${Math.round(color.r * 0.35)},${Math.round(
            color.g * 0.35,
          )},${Math.round(color.b * 0.55)})" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)" />
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
            font-family="sans-serif" font-size="${fontSize}" font-weight="700"
            fill="rgba(255,255,255,0.82)">${label}</text>
    </svg>`;

  return sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
}

async function main(): Promise<void> {
  const envFile = loadDotEnv();

  const count = Number(process.argv[2] ?? 240);
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error('Nombre de médias invalide');
  }

  const env = loadEnv(process.env, envFile ? dirname(envFile) : process.cwd());
  const config = loadConfig(env.configPath);
  const db = openDb(env.dataDir);
  const media = new MediaRepo(db);
  const syncState = new SyncStateRepo(db);
  const cache = new MediaCache(env.cacheDir, config.cache.maxSizeGB * 1024 ** 3);
  await cache.load();

  const seenAt = new Date().toISOString();
  let created = 0;

  for (const [albumIndex, album] of config.albums.entries()) {
    const items: MediaUpsert[] = [];
    // Chaque album couvre une période distincte, pour que le regroupement par
    // mois de la grille soit visible.
    const baseMonth = albumIndex * 5;

    for (let index = 0; index < count; index++) {
      const shape = SHAPES[index % SHAPES.length]!;
      const camera = CAMERAS[index % CAMERAS.length]!;
      const id = `demo-${album.id}-${String(index).padStart(4, '0')}`;

      // Réparti sur environ six mois, du plus récent au plus ancien.
      const daysAgo = baseMonth * 30 + Math.floor((index / count) * 180);
      const takenAt = new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString();

      // Une vidéo tous les 25 médias, pour vérifier le rendu des tuiles vidéo.
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
        lat: index % 3 === 0 ? 48.8566 + (index % 10) * 0.01 : null,
        lng: index % 3 === 0 ? 2.3522 + (index % 10) * 0.01 : null,
        md5: null,
      });

      if (!isVideo) {
        // Pré-remplit toutes les variantes que l'interface peut demander.
        for (const [key, edge] of [
          [`${id}:t320`, 320],
          [`${id}:t640`, 640],
          [`${id}:t1280`, 1280],
          [`${id}:full`, 2560],
        ] as const) {
          await cache.put(key, await renderPlaceholder(index, shape.width, shape.height, edge));
        }
      }

      created++;
      if (created % 50 === 0) process.stdout.write(`  ${created} médias générés\r`);
    }

    media.upsertMany(items, seenAt);
    syncState.set(album.id, { lastSyncAt: seenAt, status: 'ok', error: null });
    console.log(`Album "${album.id}" : ${items.length} médias de démonstration`);
  }

  db.close();
  console.log(`\n${created} médias créés. Cache : ${cache.stats().entryCount} entrées.`);
  // Le serveur inventorie le cache au démarrage : sans redémarrage, il ne verra
  // pas les fichiers écrits ici et tentera d'aller les chercher sur Drive.
  console.log("Redémarre le serveur pour qu'il prenne en compte le cache généré.");
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
