import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { openDb, type Db } from '../src/db.js';
import { StorageConnectionRepo } from '../src/storage/connections.js';
import { StorageRevokedError, StorageUnavailableError } from '../src/storage/provider.js';
import { WebdavService } from '../src/storage/webdav.js';

/**
 * The WebDAV backend, against a stub that answers what real servers answer.
 *
 * No test here reaches the network: `pnpm test` runs on a laptop in a tunnel and in
 * CI, and a suite that needs a Nextcloud is a suite nobody runs. What the stub does
 * reproduce is the part that actually differs between servers — the **href**. Nextcloud
 * answers with a root-relative path under `remote.php/dav/files/<user>`, an Apache
 * `mod_dav` may answer with an absolute URL, and both percent-encode a name. One code
 * path has to read all of it and hand back something `fetch()` can ask for again.
 */

const root = mkdtempSync(join(tmpdir(), 'lukarn-webdav-'));
after(() => rmSync(root, { recursive: true, force: true }));

const TOKEN_KEY = 'k'.repeat(48);
const SILENT = { info: () => {}, warn: () => {} };

/** What the stub was asked, so a test can prove what left the process. */
interface Seen {
  method: string;
  /** The raw request target, still percent-encoded, exactly as it went over the wire. */
  url: string;
  headers: NodeJS.Dict<string | string[]>;
  body: string;
}

let server: Server;
let origin: string;
let seen: Seen[] = [];
let answer: (request: IncomingMessage, response: ServerResponse) => void;

before(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      seen.push({
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      answer(request, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

let db: Db;
let connections: StorageConnectionRepo;

beforeEach(() => {
  db?.close();
  rmSync(join(root, 'data'), { recursive: true, force: true });
  db = openDb(join(root, 'data'));
  connections = new StorageConnectionRepo(db, TOKEN_KEY);
  seen = [];
  answer = (_request, response) => response.writeHead(500).end();
});

after(() => db?.close());

/** A connection pointing at the stub, with the credentials the stub expects. */
function connect(settings: Record<string, string>): WebdavService {
  connections.create({
    id: 'cloud',
    kind: 'webdav',
    label: 'Nextcloud',
    settings,
    secret: JSON.stringify({ username: 'alexis', password: 'app-password' }),
  });
  return new WebdavService(connections, 'cloud', SILENT);
}

/** The same, rooted at `remote.php/dav/files/alexis` with `Photos` as its root. */
function nextcloud(): WebdavService {
  return connect({ url: `${origin}/remote.php/dav/files/alexis`, root: 'Photos' });
}

function multistatus(body: string): (_r: IncomingMessage, response: ServerResponse) => void {
  return (_request, response) => {
    response.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
    response.end(body);
  };
}

/**
 * A Nextcloud reply: `d:` prefix, root-relative hrefs, and a second `<propstat>` under
 * a 404 for the properties a collection does not have.
 */
const NEXTCLOUD_LISTING = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/files/alexis/Photos/</d:href>
    <d:propstat>
      <d:prop>
        <d:getlastmodified>Tue, 14 Jul 2026 09:21:00 GMT</d:getlastmodified>
        <d:resourcetype><d:collection/></d:resourcetype>
        <d:getetag>&quot;66c1f0e5b9a4c&quot;</d:getetag>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
    <d:propstat>
      <d:prop><d:getcontenttype/><d:getcontentlength/></d:prop>
      <d:status>HTTP/1.1 404 Not Found</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/alexis/Photos/2026%20Bretagne/</d:href>
    <d:propstat>
      <d:prop>
        <d:getlastmodified>Wed, 15 Jul 2026 11:02:00 GMT</d:getlastmodified>
        <d:resourcetype><d:collection/></d:resourcetype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/alexis/Photos/caf%C3%A9%20%2B%20plage%20%231.jpg</d:href>
    <d:propstat>
      <d:prop>
        <d:getlastmodified>Tue, 14 Jul 2026 09:21:00 GMT</d:getlastmodified>
        <d:getcontenttype>image/jpeg</d:getcontenttype>
        <d:getcontentlength>4823014</d:getcontentlength>
        <d:getetag>&quot;e2fc714c4727ee9395f324cd2e7f331f&quot;</d:getetag>
        <d:resourcetype/>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/alexis/Photos/notes.txt</d:href>
    <d:propstat>
      <d:prop>
        <d:getlastmodified>Tue, 14 Jul 2026 09:21:00 GMT</d:getlastmodified>
        <d:getcontenttype>text/plain</d:getcontenttype>
        <d:getcontentlength>12</d:getcontentlength>
        <d:resourcetype/>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

describe('listing a collection', () => {
  it('reads a Nextcloud multistatus and leaves out the collection itself', async () => {
    answer = multistatus(NEXTCLOUD_LISTING);
    const page = await nextcloud().list('', null);

    // The collection answers about itself as well as its children. Keeping its own
    // entry would make `sync/sync.ts` queue it again for ever.
    assert.deepEqual(
      page.entries.map((entry) => entry.ref),
      ['2026 Bretagne', 'café + plage #1.jpg', 'notes.txt'],
    );
    assert.deepEqual(
      page.entries.map((entry) => entry.folder),
      [true, false, false],
    );

    // `PROPFIND` has no continuation token: `Depth: 1` answers with the whole
    // collection, so there is never a second page to ask for.
    assert.equal(page.cursor, null);

    const photo = page.entries[1]!;
    assert.equal(photo.name, 'café + plage #1.jpg');
    assert.equal(photo.mimeType, 'image/jpeg');
    assert.equal(photo.size, 4823014);
    assert.equal(photo.modifiedTime, '2026-07-14T09:21:00.000Z');
    // The quotes an ETag arrives in cannot travel: `routes/media.ts` puts this value
    // inside a quoted `ETag` header of its own.
    assert.equal(photo.version, 'e2fc714c4727ee9395f324cd2e7f331f');
    // Nothing in a `PROPFIND` reply carries EXIF data or a thumbnail.
    assert.equal(photo.media, null);
    assert.equal(photo.hasPreview, false);

    // A folder states no length, and `Number(null)` would have recorded it as empty.
    assert.equal(page.entries[0]!.size, null);
  });

  it('asks for the collection with a trailing slash and the five properties', async () => {
    answer = multistatus(NEXTCLOUD_LISTING);
    await nextcloud().list('2026 Bretagne', null);

    const request = seen[0]!;
    assert.equal(request.method, 'PROPFIND');
    // Without the trailing slash many servers answer 301, and a redirect loses the
    // request body — the listing then fails as an unexplained 400.
    assert.equal(request.url, '/remote.php/dav/files/alexis/Photos/2026%20Bretagne/');
    assert.equal(request.headers.depth, '1');
    for (const property of [
      'getcontenttype',
      'getcontentlength',
      'getlastmodified',
      'getetag',
      'resourcetype',
    ]) {
      assert.ok(request.body.includes(property), `the request asks for ${property}`);
    }
    // Basic, and nothing else: WebDAV has no token flow to fall back on.
    assert.equal(
      request.headers.authorization,
      `Basic ${Buffer.from('alexis:app-password').toString('base64')}`,
    );
  });

  it('reads an Apache mod_dav reply, whose hrefs are absolute URLs', async () => {
    // A different prefix, a different href shape, and the properties nested one level
    // deeper under `lp1:`. The same code path has to read both.
    answer = multistatus(`<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:ns0="DAV:">
  <D:response xmlns:lp1="DAV:" xmlns:lp2="http://apache.org/dav/props/">
    <D:href>http://127.0.0.1:8080/dav/</D:href>
    <D:propstat>
      <D:prop>
        <lp1:resourcetype><D:collection/></lp1:resourcetype>
        <lp1:getlastmodified>Mon, 13 Jul 2026 22:00:00 GMT</lp1:getlastmodified>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response xmlns:lp1="DAV:" xmlns:lp2="http://apache.org/dav/props/">
    <D:href>http://127.0.0.1:8080/dav/M%C3%A9diterran%C3%A9e.HEIC</D:href>
    <D:propstat>
      <D:prop>
        <lp1:resourcetype/>
        <lp1:getcontentlength>2048</lp1:getcontentlength>
        <lp1:getlastmodified>Mon, 13 Jul 2026 22:00:00 GMT</lp1:getlastmodified>
        <lp1:getetag>W/"1a2b-63f0"</lp1:getetag>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
    <D:propstat>
      <D:prop><lp1:getcontenttype/></D:prop>
      <D:status>HTTP/1.1 404 Not Found</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);

    const page = await connect({ url: `${origin}/dav` }).list('', null);

    // The href announces a host this instance never dialled — an Apache behind a proxy
    // reports the address it was configured with. Trusting the path and ignoring the
    // host is what keeps that listing readable (D260816d).
    assert.deepEqual(
      page.entries.map((entry) => entry.ref),
      ['Méditerranée.HEIC'],
    );
    // mod_dav's mime.types has no HEIC entry on most distributions, so the type comes
    // from the extension. Without it `classify()` ignores the file and the album is
    // silently missing every photo from a recent iPhone.
    assert.equal(page.entries[0]!.mimeType, 'image/heic');
    // A weak validator still changes with the bytes, which is all `version` promises.
    assert.equal(page.entries[0]!.version, '1a2b-63f0');
  });

  it('refuses a path that would climb out of the configured root', async () => {
    await assert.rejects(() => nextcloud().list('../../etc', null), /would leave the configured/);
    // Nothing was asked of the server: the refusal happens before the URL is built.
    assert.equal(seen.length, 0);
  });
});

describe('reading bytes', () => {
  it('asks for the name the listing gave back, re-encoded', async () => {
    answer = multistatus(NEXTCLOUD_LISTING);
    const webdav = nextcloud();
    const photo = (await webdav.list('', null)).entries[1]!;

    answer = (_request, response) => response.writeHead(200).end('bytes');
    const response = await webdav.fetch(photo.ref);

    assert.equal(await response.text(), 'bytes');
    // The round trip is the point: a space, a `+` and a `#` all survive being decoded
    // out of the href and encoded back into a request target.
    assert.equal(
      seen[1]!.url,
      '/remote.php/dav/files/alexis/Photos/caf%C3%A9%20%2B%20plage%20%231.jpg',
    );
  });

  it('relays Range and hands back the 206', async () => {
    answer = (request, response) => {
      assert.equal(request.headers.range, 'bytes=100-199');
      response.writeHead(206, { 'Content-Range': 'bytes 100-199/4823014' });
      response.end('x'.repeat(100));
    };

    const response = await nextcloud().fetch('plage.jpg', 'bytes=100-199');

    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 100-199/4823014');
  });

  it('relays a 416 rather than turning it into a retry', async () => {
    answer = (_request, response) => response.writeHead(416).end();

    const response = await nextcloud().fetch('plage.jpg', 'bytes=99999999-');

    // The browser knows what a 416 means. A 503 would say "try again in a moment" for
    // a request that will fail identically for ever.
    assert.equal(response.status, 416);
  });

  it('holds no preview of its own', async () => {
    assert.equal(await nextcloud().preview(), null);
  });
});

describe('when the server refuses', () => {
  it('reads a 401 as revoked, and dates it once', async () => {
    answer = (_request, response) => response.writeHead(401).end();
    const webdav = nextcloud();

    await assert.rejects(() => webdav.guard(() => webdav.list('', null)), StorageRevokedError);

    // The row is kept: /admin has to say *which* connection lost its credentials, and
    // an empty table would read as a fresh installation.
    const stored = connections.get('cloud');
    assert.ok(stored?.revokedAt);
    assert.ok(stored.ciphertext);
  });

  it('reads a 503 as transient, with the delay the server asked for', async () => {
    answer = (_request, response) => response.writeHead(503, { 'Retry-After': '30' }).end();
    const webdav = nextcloud();

    await assert.rejects(
      () => webdav.guard(() => webdav.list('', null)),
      (error: unknown) =>
        error instanceof StorageUnavailableError && error.retryAfterSeconds === 30,
    );

    // A server that is busy has not withdrawn anything: marking this revoked would ask
    // for credentials that are still valid.
    assert.equal(connections.get('cloud')?.revokedAt, null);
  });
});

describe('what /admin is told', () => {
  it('names the account when the server answers a multistatus', async () => {
    answer = multistatus('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>');

    const probe = await nextcloud().probe();

    assert.equal(probe.ok, true);
    assert.equal(probe.error, null);
    assert.equal(probe.account, `alexis@127.0.0.1:${(server.address() as AddressInfo).port}`);
    assert.equal(seen[0]!.headers.depth, '0');
  });

  it('says the password was refused, without quoting it', async () => {
    answer = (_request, response) => response.writeHead(401).end();

    const probe = await nextcloud().probe();

    assert.equal(probe.ok, false);
    assert.match(probe.error!, /refused the username and app password/);
    // The one thing this sentence must never contain.
    assert.doesNotMatch(probe.error!, /app-password/);
  });

  it('says the URL is not a WebDAV endpoint when PROPFIND is not a method there', async () => {
    answer = (_request, response) => response.writeHead(405).end();

    const probe = await nextcloud().probe();

    assert.match(probe.error!, /not a WebDAV endpoint/);
    assert.match(probe.error!, /remote\.php/);
  });

  it('separates an empty root from a wrong one', async () => {
    answer = (_request, response) => response.writeHead(404).end();

    const probe = await nextcloud().probe();

    assert.match(probe.error!, /There is nothing at/);
    assert.match(probe.error!, /Photos/);
  });

  it('names the host when nothing answered at all', async () => {
    // A port that was listening a moment ago and is not any more, so the connection is
    // refused before there is any HTTP status to interpret.
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const probe = await connect({ url: `http://127.0.0.1:${port}/dav` }).probe();

    assert.equal(probe.ok, false);
    assert.match(probe.error!, new RegExp(`127\\.0\\.0\\.1:${port} could not be reached`));
    // The system's own word for it: ECONNREFUSED sends an administrator to the port,
    // ENOTFOUND to the host name, a certificate error to the certificate.
    assert.match(probe.error!, /ECONNREFUSED/);
  });

  it('says what is missing rather than trying, when nothing is configured', async () => {
    connections.create({ id: 'bare', kind: 'webdav', label: 'Bare' });

    const probe = await new WebdavService(connections, 'bare', SILENT).probe();

    assert.equal(probe.ok, false);
    assert.match(probe.error!, /no base URL/);
  });

  it('says the credentials are missing rather than sending an empty header', async () => {
    connections.create({
      id: 'no-secret',
      kind: 'webdav',
      label: 'No secret',
      settings: { url: `${origin}/dav` },
    });

    const probe = await new WebdavService(connections, 'no-secret', SILENT).probe();

    assert.match(probe.error!, /no username and app password/);
    assert.equal(seen.length, 0);
  });
});
