import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
// The server's **sources**, by relative path, for the reason `fixtures/prepare.ts`
// gives: importing `@lukarn/server` would start a second instance. Types come from
// the server's own re-export rather than from `@lukarn/shared`, which does not
// resolve from this package — only `@lukarn/server` depends on it.
import type { StorageKind } from '../../server/src/storage/provider.js';
import { EMPTY_PAYLOAD_SHA256, signRequest } from '../../server/src/storage/sigv4.js';

/**
 * The storages that run in containers, and everything needed to fill them.
 *
 * One module, because two suites read it: the provider contract in
 * `contract.test.ts`, and the browser matrix that `fixtures/prepare.ts` connects. A
 * port or a password retyped in both would eventually differ in one, and the failure
 * would read as a broken backend rather than a broken fixture — the reason
 * `fixtures/instance.ts` exists for the instance itself.
 *
 * Nothing here reaches the network beyond loopback: `compose.yml` binds every port to
 * `127.0.0.1`, and the three images are pinned.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** The compose project holding the three servers. */
export const COMPOSE = `${HERE}compose.yml`;

/**
 * Set by CI, unset everywhere else.
 *
 * Without it, a machine with no Docker daemon **skips** the container suites, for the
 * reason [D260814g](../../../specs/08-decisions/D260814g-a-release-is-gated-by-a-browser.md)
 * keeps the browsers out of `pnpm verify`: a gate that needs a daemon is a gate people
 * work around, and a contributor without Docker still has to be able to run the rest.
 *
 * With it, a missing daemon is a **failure**. That asymmetry is the whole point — the
 * cost of an optional suite is the day it silently stops running, and CI is the one
 * place where "it was skipped" and "it passed" must not look alike.
 */
export const REQUIRED = process.env.LUKARN_REQUIRE_STORAGES === '1';

/** The folder each album reads, inside every backend. */
export const FOLDER = 'corsica';

/**
 * One photograph the fixture writes into every backend.
 *
 * The capture dates are months away from the moment the suite runs, and spread over two
 * months, which is what lets a grid assertion tell an EXIF date from a file date.
 */
export interface SeedFile {
  name: string;
  bytes: Buffer;
  mimeType: string;
}

/**
 * A storage running in a container, as both suites need it: the connection to create,
 * and the way to put files into it.
 */
export interface ContainerBackend {
  /** Connection identifier, and what the album's `connectionId` points at. */
  id: string;
  kind: StorageKind;
  /** What /admin shows, and what a Playwright locator matches on. */
  label: string;
  /**
   * The album this storage serves in the browser suite — one each, rather than one
   * album re-pointed between backends: an album carries its indexed media, and moving
   * it would make each case depend on which ran before it.
   */
  album: { id: string; title: string };
  settings: Record<string, unknown>;
  /**
   * What `probe()` must name back, and what /admin shows once **Test** is pressed.
   *
   * Asserted rather than assumed: a connection pointing somewhere other than where its
   * administrator believes is the failure that button exists to reveal, and it is
   * invisible until something asks.
   */
  probeNames: string;
  /** The secret as `StorageConnectionRepo` stores it: one string, encrypted. */
  secret: string;
  /** A secret this backend refuses, for the claim that a refusal is reported as one. */
  refusedSecret: string;
  /** Creates `FOLDER` and writes these files into it. Safe to call twice. */
  seed(files: SeedFile[]): Promise<void>;
}

/* ------------------------------------------------------------------------- S3 */

const S3_ENDPOINT = 'http://127.0.0.1:19000';
const S3_BUCKET = 'photos';
const S3_KEY = { accessKeyId: 'lukarn', secretAccessKey: 'lukarn-secret-key' };

/**
 * A signed request, using **the repository's own signer**.
 *
 * `storage/sigv4.ts` rather than `@aws-sdk/client-s3` or the `mc` command line, and not
 * only to avoid the dependency D260816e already rejected: seeding through the signer is
 * what proves it signs a request carrying a body, which no other test covers — every
 * call the S3 backend makes has an empty payload.
 */
async function s3(method: string, path: string, body?: Buffer): Promise<Response> {
  const url = new URL(`${S3_ENDPOINT}${path}`);
  const payloadHash = body ? createHash('sha256').update(body).digest('hex') : EMPTY_PAYLOAD_SHA256;

  const signed = signRequest(
    { method, url, headers: { 'x-amz-content-sha256': payloadHash }, payloadHash },
    S3_KEY,
    { region: 'us-east-1', service: 's3', signedAt: new Date() },
  );

  const response = await fetch(url, {
    method,
    headers: signed.headers,
    body: body ? new Uint8Array(body) : undefined,
  });

  // `BucketAlreadyOwnedByYou` is the expected answer on a second run, and the only
  // refusal this seeding tolerates: everything else means the bucket is not what the
  // tests below are about to assert against.
  if (!response.ok && response.status !== 409) {
    throw new Error(`MinIO refused ${method} ${path}: ${response.status} ${await response.text()}`);
  }
  return response;
}

const MINIO: ContainerBackend = {
  id: 'bucket',
  kind: 's3',
  label: 'Photos in a bucket',
  album: { id: 'corsica-bucket', title: 'Corsica in a bucket' },
  probeNames: S3_BUCKET,
  settings: {
    endpoint: S3_ENDPOINT,
    region: 'us-east-1',
    bucket: S3_BUCKET,
    prefix: '',
    // MinIO cannot be addressed as `bucket.host`: the name is not a DNS label anybody
    // resolves, and this is the setting every self-hosted bucket needs.
    pathStyle: 'true',
  },
  secret: JSON.stringify(S3_KEY),
  refusedSecret: JSON.stringify({ ...S3_KEY, secretAccessKey: 'not-the-secret-key' }),

  async seed(files) {
    await s3('PUT', `/${S3_BUCKET}`);
    for (const file of files) {
      await s3('PUT', `/${S3_BUCKET}/${FOLDER}/${file.name}`, file.bytes);
    }
  },
};

/* --------------------------------------------------------------------- WebDAV */

const DAV_USER = 'lukarn';
const DAV_PASSWORD = 'lukarn-app-password';

/**
 * A WebDAV backend, described once for the two servers that differ only in address.
 *
 * Two of them, deliberately: a listing read correctly from one server proves the
 * listing, not the protocol. Apache `mod_dav` and rclone disagree about what an href
 * looks like, which is the one thing `storage/webdav.ts` has to get right for a server
 * it has never seen (D260816f).
 */
function webdav(id: string, server: string, origin: string): ContainerBackend {
  const label = `Photos on ${server}`;
  const authorization = `Basic ${Buffer.from(`${DAV_USER}:${DAV_PASSWORD}`).toString('base64')}`;

  async function send(method: string, path: string, body?: Buffer): Promise<Response> {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: body ? { authorization, 'content-type': 'image/jpeg' } : { authorization },
      body: body ? new Uint8Array(body) : undefined,
    });

    // 405 is what a server answers to `MKCOL` on a collection that already exists,
    // which is the second run of this fixture and not a failure.
    if (!response.ok && response.status !== 405) {
      throw new Error(`${label} refused ${method} ${path}: ${response.status}`);
    }
    return response;
  }

  return {
    id,
    kind: 'webdav',
    label,
    album: { id: `corsica-${id}`, title: `Corsica on ${server}` },
    // `<user>@<host>` is what `WebdavService.probe` names an account, and the host
    // carries the port, which is what tells the two servers apart in /admin.
    probeNames: `${DAV_USER}@${new URL(origin).host}`,
    settings: { url: origin, root: '' },
    secret: JSON.stringify({ username: DAV_USER, password: DAV_PASSWORD }),
    refusedSecret: JSON.stringify({ username: DAV_USER, password: 'not-the-app-password' }),

    async seed(files) {
      await send('MKCOL', `/${FOLDER}`);
      for (const file of files) {
        await send('PUT', `/${FOLDER}/${file.name}`, file.bytes);
      }
    },
  };
}

/** Every storage `compose.yml` runs, in the order the suites report them. */
export const CONTAINER_BACKENDS: ContainerBackend[] = [
  MINIO,
  webdav('dav-apache', 'Apache', 'http://127.0.0.1:19001'),
  webdav('dav-rclone', 'rclone', 'http://127.0.0.1:19002'),
];

/* ------------------------------------------------------------- The containers */

function docker(args: string[], quiet = false): number {
  const run = spawnSync('docker', args, { stdio: quiet ? 'ignore' : 'inherit' });
  // ENOENT rather than a non-zero exit: no daemon, and no `status` to read either.
  return run.error ? 127 : (run.status ?? 1);
}

/** Is there a Docker daemon that answers? */
export function dockerAvailable(): boolean {
  return docker(['compose', 'version'], true) === 0;
}

/**
 * Starts the three servers, empty, and returns whether there are any.
 *
 * **`down` before `up`**, so each run starts from nothing. The containers keep their
 * state in their own writable layer, and an object left behind by an earlier run would
 * make "the album holds exactly three photographs" depend on what ran yesterday — the
 * assertion this whole file exists to support.
 */
export async function startStorages(seed: SeedFile[]): Promise<boolean> {
  if (!dockerAvailable()) {
    if (REQUIRED) {
      throw new Error(
        'LUKARN_REQUIRE_STORAGES=1 but no Docker daemon answers. The storage suites ' +
          'cannot run, and a skip here would be indistinguishable from a pass.',
      );
    }
    return false;
  }

  docker(['compose', '-f', COMPOSE, 'down', '--remove-orphans'], true);
  if (docker(['compose', '-f', COMPOSE, 'up', '-d', '--wait']) !== 0) {
    throw new Error(`The storages in ${COMPOSE} did not all become healthy.`);
  }

  for (const backend of CONTAINER_BACKENDS) await backend.seed(seed);
  return true;
}

/** Stops them, keeping nothing. */
export function stopStorages(): void {
  if (dockerAvailable()) docker(['compose', '-f', COMPOSE, 'down', '--remove-orphans'], true);
}
