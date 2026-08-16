import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import argon2 from 'argon2';
// The server's **sources**, imported by path rather than through
// `@lukarn/server`: that package's entry point is `dist/main.js`, so importing
// the package would start a second instance instead of handing over a repository.
//
// `src/` and not `dist/`, even though the server under test runs the build:
// `pnpm typecheck` must work on a clone where only `shared` has been built, and
// pointing at `dist/` would have made a full build the price of typechecking.
// Only the artefact under test has to be the built one; what fills its database
// before it starts does not.
import { bootstrapFromYaml } from '../../server/src/bootstrap.js';
import { ConfigRepo } from '../../server/src/config-repo.js';
import { openDb } from '../../server/src/db.js';
import { loadEnv } from '../../server/src/env.js';
import { StorageConnectionRepo } from '../../server/src/storage/connections.js';
import {
  ADMIN,
  ALBUMS,
  CACHE_DIR,
  CONFIG_PATH,
  DATA_DIR,
  LOCAL_ALBUM,
  LOCAL_CONNECTION,
  ROOT,
  SEED_COUNT,
  STORAGE_ROOT,
  STORAGE_SUBPATH,
  TMP,
  instanceEnv,
} from './instance.js';

/**
 * Builds a throwaway instance from nothing, using the server's own code.
 *
 * The alternative — a committed SQLite file and a tarball of renders — is
 * faster and worse: it stops proving that a fresh installation works, it goes
 * stale on the next migration without anything saying so, and the day it breaks
 * the failure looks like a broken feature. Going through `bootstrapFromYaml`,
 * `ConfigRepo` and `seed-demo` means the fixture exercises the installation path
 * a real operator follows.
 *
 * **The order matters.** `MediaCache.load()` inventories the disk at startup, so
 * every render has to be on disk before the server boots — which is why seeding
 * happens here rather than from a test, and why this runs inside the `webServer`
 * command instead of Playwright's `globalSetup`: the web server is started
 * first, and a global setup would arrive too late to fill the cache.
 */
export async function prepareInstance(): Promise<void> {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });

  writeFileSync(CONFIG_PATH, await albumsYaml(), 'utf8');
  await writePhotos();

  const env = loadEnv(instanceEnv(), ROOT);
  const db = openDb(env.dataDir);
  const config = new ConfigRepo(db);
  bootstrapFromYaml(config, env, { info: () => {}, warn: () => {} });
  // `config/albums.yaml` carries no field for either, and both start background
  // passes that reach for a Drive account this instance does not have. Off, the
  // instance does nothing but answer requests.
  config.updateSettings({ prewarmCache: false, transcodeVideos: false });
  db.close();

  seedMedia();

  // **After seeding, never before.** `seed-demo` fills every album it finds, so an
  // album created earlier would arrive with forty demo items in it — and the one
  // spec that proves synchronisation works would be asserting against them.
  const after = openDb(env.dataDir);
  connectLocalFolder(after, new ConfigRepo(after), env.tokenKey);
  after.close();
}

/**
 * The one storage this suite can genuinely read, and an album pointed at it.
 *
 * Neither can come from `config/albums.yaml`: it has no field naming a connection,
 * so this goes through `StorageConnectionRepo` and `ConfigRepo` — the same path
 * `/admin` takes. The album stays **empty** until a spec resynchronises it, which
 * is the point: this is the suite's only end-to-end proof that indexing works,
 * and seeding it here would prove nothing.
 */
function connectLocalFolder(db: ReturnType<typeof openDb>, config: ConfigRepo, tokenKey: string) {
  new StorageConnectionRepo(db, tokenKey).create({
    id: LOCAL_CONNECTION.id,
    kind: 'local',
    label: LOCAL_CONNECTION.label,
    // The subpath, never the root: what the environment allows and what an
    // administrator chose inside it are two different decisions (D260816d).
    settings: { path: STORAGE_SUBPATH },
  });

  config.createAlbum({
    id: LOCAL_ALBUM.id,
    title: LOCAL_ALBUM.title,
    connectionId: LOCAL_CONNECTION.id,
    folderId: '',
    recursive: true,
    groupBy: 'month',
    sortOrder: 'desc',
  });
}

/**
 * Real photographs on disk, each with real EXIF data.
 *
 * Written with sharp rather than committed, for the reason `albumsYaml` gives about
 * the password hash and `prepareInstance` gives about the database: a binary in the
 * repository states nothing about what it contains, and goes stale silently. These
 * carry a capture date and a camera, so the spec can assert that the grid shows the
 * date the photograph was **taken** rather than the date it was written here —
 * which is the whole of what reading EXIF from the bytes buys.
 */
async function writePhotos(): Promise<void> {
  const folder = join(STORAGE_ROOT, STORAGE_SUBPATH);
  mkdirSync(folder, { recursive: true });

  const { default: sharp } = await import('sharp');

  for (const [index, taken] of PHOTO_DATES.entries()) {
    // `IFD2` is sharp's name for the Exif sub-IFD, and `DateTimeOriginal` lives
    // nowhere else. Naming it anything sharp does not recognise — `ExifIFD`, say —
    // writes a valid JPEG with no capture date in it and reports no error, which is
    // exactly the failure that makes a fixture worth reading twice.
    const exif = {
      IFD0: { Make: 'Lukarn', Model: 'E2E' },
      IFD2: { DateTimeOriginal: taken },
    };
    const bytes = await sharp({
      create: {
        width: 240,
        height: 160,
        channels: 3,
        background: { r: 40 + index * 30, g: 90, b: 160 },
      },
    })
      .withExif(exif)
      .jpeg()
      .toBuffer();

    writeFileSync(join(folder, `photo-${index + 1}.jpg`), bytes);
  }
}

/**
 * Capture dates, spread across two months so the grid has more than one heading.
 *
 * EXIF's own format, without a time zone: this is the device's clock, and the
 * application stores and displays it as UTC.
 */
const PHOTO_DATES = ['2026:03:11 09:15:00', '2026:03:11 14:02:00', '2026:04:02 18:30:00'];

/**
 * The bootstrap file, with a hash produced now rather than committed.
 *
 * A committed argon2 hash is a password in the repository: harmless for a
 * fixture, and exactly the shape of thing that gets copied into an installation
 * where it is not harmless.
 */
async function albumsYaml(): Promise<string> {
  const passwordHash = await argon2.hash(ADMIN.password, { type: argon2.argon2id });

  return `# Written by packages/e2e/fixtures/prepare.ts. Not the repository's own config.
users:
  - username: ${ADMIN.username}
    passwordHash: '${passwordHash}'
    admin: true
    albums: ['*']

albums:
  - id: ${ALBUMS.day.id}
    title: '${ALBUMS.day.title}'
    description: 'Corsica, July and August'
    folderId: 'e2e-no-such-drive-folder'
    recursive: true
    groupBy: day
    sortOrder: desc

  - id: ${ALBUMS.month.id}
    title: '${ALBUMS.month.title}'
    folderId: 'e2e-no-such-drive-folder-either'
    recursive: true
    groupBy: month
    sortOrder: desc

sync:
  # Nothing to synchronise: the folders above do not exist, and no Drive account
  # is connected. A sync on startup would only log a failure.
  intervalMinutes: 0
  onStartup: false

cache:
  maxSizeGB: 2
`;
}

/**
 * Fills the index and the disk cache, through the command a contributor runs.
 *
 * `seed-demo` is left exactly as it is — a CLI reading its environment — because
 * turning it into a library for the sake of this fixture would give it a second
 * caller to keep working, for no gain: spawning it costs a process and proves
 * the documented path still works.
 */
function seedMedia(): void {
  const seeding = spawnSync(
    'pnpm',
    ['--filter', '@lukarn/server', 'seed-demo', String(SEED_COUNT)],
    { cwd: ROOT, env: instanceEnv(), stdio: 'inherit' },
  );

  if (seeding.status !== 0) {
    throw new Error(`seed-demo failed (exit ${seeding.status ?? 'signal ' + seeding.signal})`);
  }
}
