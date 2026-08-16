import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { openDb, type Db } from '../../server/src/db.js';
import { StorageConnectionRepo } from '../../server/src/storage/connections.js';
import { StorageRevokedError, type StorageProvider } from '../../server/src/storage/provider.js';
import { createProvider } from '../../server/src/storage/registry.js';
import { photographs, PHOTO_COUNT } from '../fixtures/photos.js';
import {
  CONTAINER_BACKENDS,
  FOLDER,
  REQUIRED,
  startStorages,
  stopStorages,
  type ContainerBackend,
  type SeedFile,
} from './backends.js';

/**
 * What every storage backend owes, asserted against the servers people actually run.
 *
 * `packages/server/test/s3.test.ts` and `webdav.test.ts` cover the same operations
 * against a local stub, and they stay: they are fast, need no daemon, and the S3 one
 * recomputes the signature, which reads a request more strictly than most buckets do.
 * They share one blind spot, and it is the expensive one — **a stub agrees with
 * whoever wrote it**. Every shape it answers with is a shape its author already
 * believed in, so the listing that a real MinIO returns, the href a real Apache writes
 * and the 403 a real bucket sends for a mis-signed range were never seen by anything
 * before this file (D260816k).
 *
 * It is one table run three times rather than three suites, because there is one
 * interface: a claim that holds for a bucket and not for a WebDAV server is a claim
 * `StorageProvider` does not really make, and the matrix is what says so out loud.
 *
 * Not part of `pnpm test`, which must keep running with no daemon and no network — the
 * glob is `test/*.test.ts` and this file is elsewhere. `pnpm test:storages` runs it.
 */

const TOKEN_KEY = 'k'.repeat(48);
const silent = { info: () => {}, warn: () => {} };

/**
 * The containers are started **before the cases are declared**, not in a `before`
 * hook, and that is not a style preference: `skip` is evaluated when a test is
 * defined, so a hook deciding it would always run too late and the whole table would
 * skip on a machine where Docker answers perfectly well. It cost a green run of
 * twenty-four skipped cases to find out.
 */
const seeded: SeedFile[] = await photographs();
const up = await startStorages(seeded);

const root = mkdtempSync(join(tmpdir(), 'lukarn-storages-'));
const db: Db = openDb(root);
const connections = new StorageConnectionRepo(db, TOKEN_KEY);

after(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
  stopStorages();
});

/**
 * A live provider for this backend, built the way the application builds one.
 *
 * Through `createProvider` rather than by calling `s3FromConnection` directly: the
 * factory is the only place a stored row becomes an implementation, and a kind that
 * works but is unreachable from `SUPPORTED_KINDS` is a kind /admin cannot offer.
 */
function providerFor(backend: ContainerBackend, secret = backend.secret): StorageProvider {
  const id = secret === backend.secret ? backend.id : `${backend.id}-refused`;
  if (!connections.get(id)) {
    connections.create({
      id,
      kind: backend.kind,
      label: backend.label,
      settings: backend.settings,
      secret,
    });
  }

  // `env` is only read by the Drive and local implementations, neither of which runs
  // here; the cast keeps this file from having to build a whole `Env` for nothing.
  return createProvider(connections.get(id)!, {} as never, connections, silent);
}

for (const backend of CONTAINER_BACKENDS) {
  describe(`${backend.kind} — ${backend.label}`, () => {
    const skip = () => (up ? false : 'no Docker daemon: the storages are not running');

    it('answers a probe, naming what it points at', { skip: skip() }, async () => {
      const probe = await providerFor(backend).probe();

      assert.equal(probe.error, null);
      assert.equal(probe.ok, true);
      // /admin shows this string and nothing else about the connection: empty, the row
      // says "connected" without saying to what.
      assert.ok(probe.account && probe.account.length > 0, 'the probe named no account');
    });

    it('lists the folder, and nothing but the folder', { skip: skip() }, async () => {
      const page = await providerFor(backend).list(FOLDER, null);
      const files = page.entries.filter((entry) => !entry.folder);

      assert.equal(files.length, PHOTO_COUNT);
      assert.deepEqual(
        files.map((entry) => entry.name).sort(),
        seeded.map((file) => file.name).sort(),
      );

      for (const entry of files) {
        assert.equal(entry.mimeType, 'image/jpeg', `${entry.name} was not read as a photograph`);
        // The indexer skips a file whose version is unchanged, so a backend that
        // reports none would re-read every photograph on every pass, for ever.
        assert.ok(entry.version, `${entry.name} carries no version`);
        assert.ok((entry.size ?? 0) > 0, `${entry.name} carries no size`);
        // Only Drive answers otherwise, and the indexer reads the bytes when it does
        // not: a backend claiming metadata it does not have would skip that read.
        assert.equal(entry.media, null);
        assert.equal(entry.hasPreview, false);
      }
    });

    it('shows the folder as a folder from the root', { skip: skip() }, async () => {
      const page = await providerFor(backend).list('', null);
      const folders = page.entries.filter((entry) => entry.folder);

      // The reference, not the name: it is what an album stores as its `folderId`, and
      // what `list()` is handed back on the next pass.
      assert.ok(
        folders.some((entry) => entry.ref.replace(/\/$/, '') === FOLDER),
        `the root listed no folder named ${FOLDER}: ${JSON.stringify(page.entries)}`,
      );
    });

    it('hands back the bytes it was given, unaltered', { skip: skip() }, async () => {
      const expected = seeded[0]!;
      const response = await providerFor(backend).fetch(`${FOLDER}/${expected.name}`);

      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      // Byte-identical, rather than merely the right length: everything downstream —
      // the EXIF window, sharp, the `/original` route — reads these bytes as the file.
      assert.deepEqual(bytes, expected.bytes);
    });

    it('answers a Range with a 206 covering exactly that window', { skip: skip() }, async () => {
      const expected = seeded[0]!;
      const response = await providerFor(backend).fetch(`${FOLDER}/${expected.name}`, 'bytes=0-99');

      // **The claim video seeking rests on.** A backend that ignores `Range` answers
      // 200 with the whole file and the browser plays from the start every time; on S3
      // a range left out of the signature is refused outright, which no stub could
      // have decided for itself.
      assert.equal(response.status, 206);
      assert.equal(response.headers.get('content-range'), `bytes 0-99/${expected.bytes.length}`);

      const bytes = Buffer.from(await response.arrayBuffer());
      assert.deepEqual(bytes, expected.bytes.subarray(0, 100));
    });

    it('refuses a reference it holds nothing for', { skip: skip() }, async () => {
      // Rather than an empty 200: the indexer would store a photograph of zero bytes,
      // and the renderer would cache the failure to decode it.
      await assert.rejects(() => providerFor(backend).fetch(`${FOLDER}/absent.jpg`));
    });

    it('holds no preview, and names files by their path', { skip: skip() }, () => {
      const provider = providerFor(backend);

      // Both are read by code that behaves differently for a Drive: the renderer cuts
      // its own poster when `preview()` is null, and the indexer hashes the reference
      // with the connection when references are locations (D260816c).
      assert.equal(provider.refKind, 'path');
      return provider.preview(`${FOLDER}/${seeded[0]!.name}`, 512).then((preview) => {
        assert.equal(preview, null);
      });
    });

    it('reports a refused credential as a revocation', { skip: skip() }, async () => {
      const provider = providerFor(backend, backend.refusedSecret);

      // Through `guard`, because that is what the application calls: it is what dates
      // `revoked_at` and stops the sync from re-presenting a credential already
      // refused, file by file, for the whole of an album (D61).
      await assert.rejects(
        () => provider.guard(() => provider.list(FOLDER, null)),
        StorageRevokedError,
      );

      assert.notEqual(
        connections.get(`${backend.id}-refused`)?.revokedAt,
        null,
        'the connection was not marked revoked',
      );
    });
  });
}

// A run that skipped everything reports itself: "0 failures" and "nothing ran" are the
// same output otherwise, and this suite exists precisely for the days nobody looks.
after(() => {
  if (!up && !REQUIRED) {
    console.log('\n  storages: skipped — no Docker daemon. `docker compose` starts them.\n');
  }
});
