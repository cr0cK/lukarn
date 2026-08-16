import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, beforeEach, describe, it } from 'node:test';
import { openDb, type Db } from '../src/db.js';
import { StorageConnectionRepo } from '../src/storage/connections.js';
import { StorageRevokedError } from '../src/storage/provider.js';
import { s3FromConnection, type S3Service } from '../src/storage/s3.js';
import { signRequest } from '../src/storage/sigv4.js';

/**
 * The S3 backend, against a bucket that runs on localhost for the length of one test.
 *
 * No network, deliberately: `pnpm test` runs on a laptop in a train and in CI, and a
 * suite that reaches a real bucket is one that fails for reasons having nothing to do
 * with the code. What the stub gives instead is the thing a real bucket would give and
 * a mock would not — **it verifies the signature**, recomputing it from the request as
 * received. A `Range` added after signing, or left out of `SignedHeaders`, is refused
 * here exactly as MinIO would refuse it.
 */

const root = mkdtempSync(join(tmpdir(), 'lukarn-s3-'));
after(() => rmSync(root, { recursive: true, force: true }));

const TOKEN_KEY = 'k'.repeat(48);
const ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
const SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

const silent = { warn: () => {} };

let db: Db;
let connections: StorageConnectionRepo;
let bucket: Server;

/** Every request the stub received, in order, for the assertions that need them. */
let received: { url: URL; headers: IncomingMessage['headers'] }[] = [];

interface Reply {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

/**
 * Recomputes the signature of a request as it arrived.
 *
 * This is what makes the stub worth more than a mock: the headers it signs are the ones
 * named in the client's own `SignedHeaders`, so a header the client sent but did not
 * sign is simply absent from the recomputation and the two signatures diverge.
 */
function signatureMatches(request: IncomingMessage, url: URL): boolean {
  const authorization = request.headers.authorization;
  const stamp = request.headers['x-amz-date'];
  if (typeof authorization !== 'string' || typeof stamp !== 'string') return false;

  const names = /SignedHeaders=([^,]+)/.exec(authorization)?.[1]?.split(';') ?? [];
  const headers: Record<string, string> = {};
  for (const name of names) {
    if (name === 'host' || name === 'x-amz-date') continue;
    const value = request.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }

  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
  const expected = signRequest(
    { method: request.method ?? 'GET', url, headers },
    { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
    { region: 'eu-west-3', service: 's3', signedAt: new Date(iso) },
  );

  return expected.headers.authorization === authorization;
}

/** Starts a bucket answering `route`, and returns its origin. */
async function serve(route: (url: URL, request: IncomingMessage) => Reply): Promise<string> {
  bucket = createServer((request: IncomingMessage, response: ServerResponse) => {
    // Rebuilt from the `Host` header, port included: the signature covers it, and a
    // URL reassembled without the port would fail to reproduce any of them.
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
    received.push({ url, headers: request.headers });

    if (!signatureMatches(request, url)) {
      response.writeHead(403, { 'content-type': 'application/xml' });
      response.end('<Error><Code>SignatureDoesNotMatch</Code></Error>');
      return;
    }

    const reply = route(url, request);
    response.writeHead(reply.status ?? 200, {
      'content-type': 'application/xml',
      ...reply.headers,
    });
    response.end(reply.body ?? '');
  });

  await new Promise<void>((resolve) => bucket.listen(0, '127.0.0.1', resolve));
  const address = bucket.address();
  return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
}

/** A connection reading `photos/` of the bucket at `endpoint`, and its live provider. */
function connect(endpoint: string, secret?: string): S3Service {
  connections.create({
    id: 'archives',
    kind: 's3',
    label: 'Archives',
    settings: {
      endpoint,
      region: 'eu-west-3',
      bucket: 'famille',
      prefix: 'photos',
      pathStyle: 'true',
    },
    secret:
      secret ?? JSON.stringify({ accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY }),
  });

  return s3FromConnection(connections.get('archives')!, connections, silent);
}

beforeEach(() => {
  db?.close();
  rmSync(join(root, 'data'), { recursive: true, force: true });
  db = openDb(join(root, 'data'));
  connections = new StorageConnectionRepo(db, TOKEN_KEY);
  received = [];
});

afterEach(async () => {
  if (bucket) await new Promise<void>((resolve) => bucket.close(() => resolve()));
});

after(() => db?.close());

describe('listing a bucket', () => {
  it('walks a folder across a continuation token without losing a key', async () => {
    const page = (keys: string[], token: string | null): string =>
      `<?xml version="1.0" encoding="UTF-8"?>
       <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
         <Name>famille</Name>
         <Prefix>photos/2026/</Prefix>
         <IsTruncated>${token ? 'true' : 'false'}</IsTruncated>
         ${token ? `<NextContinuationToken>${token}</NextContinuationToken>` : ''}
         ${keys
           .map(
             (key) => `<Contents>
                <Key>photos/2026/${key}</Key>
                <LastModified>2026-07-14T09:21:00.000Z</LastModified>
                <ETag>&quot;9a0364b9e99bb480dd25e1f0284c8555&quot;</ETag>
                <Size>4823014</Size>
              </Contents>`,
           )
           .join('')}
       </ListBucketResult>`;

    const endpoint = await serve((url) =>
      url.searchParams.get('continuation-token') === '1ueGcx'
        ? { body: page(['soiree.mp4'], null) }
        : { body: page(['plage.jpg'], '1ueGcx') },
    );
    const storage = connect(endpoint);

    const first = await storage.list('2026', null);
    assert.equal(first.cursor, '1ueGcx');
    assert.deepEqual(
      first.entries.map((entry) => entry.ref),
      ['2026/plage.jpg'],
    );

    const second = await storage.list('2026', first.cursor);
    assert.equal(second.cursor, null);
    assert.deepEqual(
      second.entries.map((entry) => entry.ref),
      ['2026/soiree.mp4'],
    );

    // The connection's own prefix is added on the way out and removed on the way back:
    // what the index stores is relative to the connection, so moving a bucket under a
    // different prefix does not orphan every photo in it.
    assert.equal(received[0]?.url.searchParams.get('prefix'), 'photos/2026/');
    assert.equal(received[0]?.url.searchParams.get('delimiter'), '/');
    assert.equal(received[0]?.url.pathname, '/famille');
    assert.equal(received[1]?.url.searchParams.get('continuation-token'), '1ueGcx');
  });

  it('reads the folders out of CommonPrefixes, and skips the folder markers', async () => {
    const endpoint = await serve(() => ({
      body: `<ListBucketResult>
          <Prefix>photos/</Prefix>
          <IsTruncated>false</IsTruncated>
          <CommonPrefixes><Prefix>photos/2025/</Prefix></CommonPrefixes>
          <CommonPrefixes><Prefix>photos/2026/</Prefix></CommonPrefixes>
          <Contents>
            <Key>photos/</Key><Size>0</Size>
            <LastModified>2026-01-01T00:00:00.000Z</LastModified>
          </Contents>
          <Contents>
            <Key>photos/plage.jpg</Key><Size>512</Size>
            <ETag>W/&quot;e2fc714c&quot;</ETag>
            <LastModified>2026-07-14T09:21:00.000Z</LastModified>
          </Contents>
          <Contents>
            <Key>photos/notes.txt</Key><Size>12</Size>
            <LastModified>2026-07-14T09:21:00.000Z</LastModified>
          </Contents>
        </ListBucketResult>`,
    }));

    const { entries } = await connect(endpoint).list('', null);

    assert.deepEqual(
      entries.map((entry) => ({ ref: entry.ref, name: entry.name, folder: entry.folder })),
      [
        { ref: '2025/', name: '2025', folder: true },
        { ref: '2026/', name: '2026', folder: true },
        // `photos/` is the zero-byte object a client writes to make a folder visible:
        // it is the container itself, and indexing it would put an unreadable tile in
        // the grid.
        { ref: 'plage.jpg', name: 'plage.jpg', folder: false },
        { ref: 'notes.txt', name: 'notes.txt', folder: false },
      ],
    );

    const photo = entries[2]!;
    assert.equal(photo.mimeType, 'image/jpeg');
    assert.equal(photo.size, 512);
    // Unquoted: this ends up inside the `ETag` header the application serves, whose own
    // quotes would close two segments early.
    assert.equal(photo.version, 'e2fc714c');
    assert.equal(photo.media, null);
    assert.equal(photo.hasPreview, false);

    // Nothing in the application can decode it, so it is not media — a listing carries
    // no content type, and the extension is the whole of what is known.
    assert.equal(entries[3]?.mimeType, null);
  });
});

describe('reading bytes', () => {
  it('signs the Range, which is what a seek in a large video depends on', async () => {
    const endpoint = await serve((_url, request) => ({
      status: request.headers.range ? 206 : 200,
      body: 'partial',
      headers: {
        'content-type': 'video/mp4',
        'content-range': 'bytes 1048576-2097151/8388608',
      },
    }));

    const response = await connect(endpoint).fetch('2026/soiree.mp4', 'bytes=1048576-2097151');

    // 206, not 403: the stub refuses anything whose signature it cannot reproduce from
    // the request as received, so reaching this line **is** the assertion that the
    // range was part of what was signed.
    assert.equal(response.status, 206);
    assert.equal(await response.text(), 'partial');

    const sent = received[0]!;
    assert.equal(sent.url.pathname, '/famille/photos/2026/soiree.mp4');
    assert.equal(sent.headers.range, 'bytes=1048576-2097151');
    assert.match(String(sent.headers.authorization), /SignedHeaders=[^,]*;range;/);
  });

  it('holds no preview: a bucket stores the bytes it was given and nothing beside them', async () => {
    const endpoint = await serve(() => ({ body: '<ListBucketResult/>' }));
    assert.equal(await connect(endpoint).preview(), null);
  });
});

describe('what the Test button says', () => {
  it('names a key pair the bucket refuses, and marks the connection revoked', async () => {
    const endpoint = await serve(() => ({ body: '<ListBucketResult/>' }));
    // A secret that decrypts but is not the one the bucket knows: the stub's own
    // verification is what turns it into the 403 a real bucket would send.
    const storage = connect(
      endpoint,
      JSON.stringify({ accessKeyId: ACCESS_KEY_ID, secretAccessKey: 'not-the-right-one' }),
    );

    const probe = await storage.probe();
    assert.equal(probe.ok, false);
    assert.equal(probe.account, `famille (127.0.0.1:${new URL(endpoint).port})`);
    assert.match(probe.error ?? '', /refused the key pair \(SignatureDoesNotMatch\)/);
    assert.match(probe.error ?? '', /access key and secret key in \/admin/);

    // A probe reports; it does not revoke. Only an operation wrapped in `guard` does,
    // which is what keeps a test run from disabling a connection an administrator is
    // in the middle of correcting.
    assert.equal(connections.get('archives')?.revokedAt, null);

    await assert.rejects(
      () => storage.guard(() => storage.list('2026', null)),
      StorageRevokedError,
    );
    assert.notEqual(connections.get('archives')?.revokedAt, null);
  });

  it('names a host that is not there, rather than an empty album', async () => {
    // A port nobody is listening on: opened to learn a free one, then closed.
    const endpoint = await serve(() => ({ body: '' }));
    await new Promise<void>((resolve) => bucket.close(() => resolve()));

    const probe = await connect(endpoint).probe();
    assert.equal(probe.ok, false);
    assert.match(probe.error ?? '', /could not be reached/);
    assert.match(probe.error ?? '', new RegExp(new URL(endpoint).port));
  });

  it('names a bucket that does not exist', async () => {
    const endpoint = await serve(() => ({
      status: 404,
      body: '<Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist</Message></Error>',
    }));

    const probe = await connect(endpoint).probe();
    assert.equal(probe.ok, false);
    assert.equal(probe.error, `No bucket named "famille" at ${endpoint}.`);
  });

  it('answers plainly when the bucket does answer', async () => {
    const endpoint = await serve(() => ({
      body: '<ListBucketResult><Name>famille</Name></ListBucketResult>',
    }));

    const probe = await connect(endpoint).probe();
    assert.deepEqual(probe, {
      ok: true,
      account: `famille (127.0.0.1:${new URL(endpoint).port})`,
      error: null,
    });
    assert.equal(received[0]?.url.searchParams.get('max-keys'), '1');
  });
});
