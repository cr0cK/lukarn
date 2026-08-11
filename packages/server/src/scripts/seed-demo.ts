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
 * Jeu de données de démonstration, pour développer et vérifier l'interface
 * sans compte Google Drive.
 *
 *   pnpm --filter @nonni/server seed-demo [nombre]
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

/**
 * Deux lieux distants d'une vingtaine de kilomètres, donc au-delà du rayon
 * d'agglomération : une journée qui porte les deux produit deux grappes, ce qui
 * est le cas intéressant à regarder. Les libellés sont posés directement dans
 * `geo_places`, pour que la démo montre des noms de lieu sans appeler Nominatim.
 */
const DEMO_PLACES = [
  { lat: 41.3878, lng: 9.1597, label: 'Bonifacio, Corse-du-Sud' },
  { lat: 41.5911, lng: 9.2795, label: 'Porto-Vecchio, Corse-du-Sud' },
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

  // Mire fine : à la taille d'écran ces traits se confondent, au zoom ils se
  // séparent. C'est ce qui permet de vérifier que la variante haute résolution
  // apporte réellement du détail, au lieu d'agrandir des pixels existants.
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
            fill="rgba(255,255,255,0.75)">rendu ${outWidth}×${outHeight} px</text>
    </svg>`;

  return sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
}

/** Position d'une photo de démonstration : deux sur trois n'en ont pas. */
function position(index: number): { lat: number | null; lng: number | null } {
  if (index % 3 !== 0) return { lat: null, lng: null };
  const place = DEMO_PLACES[(index / 3) % DEMO_PLACES.length]!;
  // Une dispersion de quelques centaines de mètres autour du lieu : de quoi
  // faire travailler l'agglomération sans franchir son rayon.
  const jitter = ((index % 7) - 3) * 0.004;
  return { lat: place.lat + jitter, lng: place.lng + jitter };
}

/**
 * Nomme les cellules produites par le passage des lieux, en les rattachant au
 * lieu de démonstration le plus proche. Sans ça, la démo n'aurait de libellés
 * qu'après un appel réseau à Nominatim, plafonné à une requête par seconde.
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
    throw new Error('Nombre de médias invalide');
  }

  const env = loadEnv(process.env, envFile ? dirname(envFile) : process.cwd());
  const db = openDb(env.dataDir);
  const config = new ConfigRepo(db);
  const media = new MediaRepo(db);
  const syncState = new SyncStateRepo(db);
  const cache = new MediaCache(env.cacheDir, config.settings().cacheMaxSizeGB * 1024 ** 3);
  await cache.load();

  // Les albums viennent de la base, seule source de vérité depuis que la
  // configuration s'administre depuis l'application.
  const albums = config.albums();
  if (albums.length === 0) {
    throw new Error(
      'Aucun album en base : crée-en un depuis /admin (ou amorce une installation ' +
        'avec config/albums.yaml) avant de lancer la démo.',
    );
  }

  const seenAt = new Date().toISOString();
  let created = 0;

  for (const [albumIndex, album] of albums.entries()) {
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
        // Une photo sur trois est géolocalisée, alternativement sur l'un des
        // deux lieux : les journées qui en portent deux montrent l'ordre
        // chronologique des grappes dans leur en-tête.
        ...position(index),
        md5: null,
        // Les vidéos de démonstration ont un aperçu, comme celles d'un vrai
        // Drive : sans lui, la grille montrerait une tuile sobre et le chemin
        // du poster ne serait pas vérifiable hors compte Google.
        hasThumbnail: true,
        videoCodec: null,
      });

      // Pré-remplit toutes les variantes que l'interface peut demander.
      // Les clés doivent suivre exactement `variantKey()` du renderer,
      // sinon le serveur ne trouvera rien et ira interroger Drive.
      const variantes: [string, number][] = [
        [`${id}:t320`, 320],
        [`${id}:t640`, 640],
        [`${id}:t1280`, 1280],
      ];
      // Ni `full` ni `hd` sur une vidéo : la route les refuse en 415, l'aperçu
      // d'une vidéo n'étant qu'une vignette.
      if (!isVideo) {
        variantes.push([`${id}:full`, 2560], [`${id}:hd`, 4096]);
      }

      for (const [key, edge] of variantes) {
        await cache.put(key, await renderPlaceholder(index, shape.width, shape.height, edge));
      }

      created++;
      if (created % 50 === 0) process.stdout.write(`  ${created} médias générés\r`);
    }

    media.upsertMany(items, seenAt);
    syncState.set(album.id, { lastSyncAt: seenAt, status: 'ok', error: null });
    console.log(`Album "${album.id}" : ${items.length} médias de démonstration`);
  }

  // Les journées, comme le serveur les calculerait — mais sans géocodeur : les
  // libellés sont posés juste après, pour ne pas dépendre du réseau.
  const days = new AlbumDayRepo(db);
  await new PlacesPass({
    albums: () => albums,
    media,
    days,
    geocoder: null,
    log: { info: () => {}, debug: () => {} },
  }).run();
  const named = labelDemoCells(db);

  // Deux notes, sur les deux journées les plus récentes du premier album : de
  // quoi voir la hauteur d'en-tête varier, et le crayon d'édition.
  const firstAlbum = albums[0]!;
  const recent = (
    db
      .prepare(
        `SELECT DISTINCT substr(taken_at, 1, 10) AS day FROM media
          WHERE album_id = ? ORDER BY day DESC LIMIT 2`,
      )
      .all(firstAlbum.id) as { day: string }[]
  ).map((row) => row.day);

  const notes = ['Bonifacio, puis la plage jusqu’au coucher du soleil.', 'Retour par la montagne.'];
  recent.forEach((day, index) =>
    days.upsertNote(firstAlbum.id, day, { description: notes[index]! }),
  );

  // Trois photos décrites, sur les plus récentes du premier album : sans elles,
  // le bandeau de légende de la visionneuse ne se voit pas hors compte Drive.
  // La troisième est longue exprès — c'est le cas qui montre le clampage et le
  // dépliement au clic.
  const legendes = [
    'Léa saute du ponton, troisième essai — le seul où elle ne se pince pas le nez.',
    'La lumière de 19 h sur les falaises, dix minutes avant qu’elle tombe.',
    'Le petit port au réveil, avant que les bateaux de promenade ne sortent. ' +
      'On y était seuls, avec le patron du café qui rentrait ses chaises de la veille ' +
      'et deux pêcheurs qui remontaient des filets vides en discutant du vent. ' +
      'C’est la photo que tout le monde a redemandée en rentrant.',
  ];
  const decrites = (
    db
      .prepare(
        `SELECT id FROM media WHERE album_id = ? AND kind = 'photo'
          ORDER BY taken_at DESC, id DESC LIMIT ?`,
      )
      .all(firstAlbum.id, legendes.length) as { id: string }[]
  ).map((row) => row.id);

  decrites.forEach((mediaId, index) =>
    media.setDescription(firstAlbum.id, mediaId, { description: legendes[index]! }),
  );

  db.close();
  console.log(
    `\n${created} médias créés, ${named} lieux nommés, ${recent.length} journées annotées ` +
      `et ${decrites.length} photos décrites sur "${firstAlbum.id}". ` +
      `Cache : ${cache.stats().entryCount} entrées.`,
  );
  console.log(
    'Regarde un album réglé sur « par jour » : les lieux et les notes ne s’affichent que là.',
  );
  // Le serveur inventorie le cache au démarrage : sans redémarrage, il ne verra
  // pas les fichiers écrits ici et tentera d'aller les chercher sur Drive.
  console.log("Redémarre le serveur pour qu'il prenne en compte le cache généré.");
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
