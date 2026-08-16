import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { loadEnv } from '../src/env.js';
import { LocalFolderService } from '../src/storage/local.js';

/**
 * A folder on the disk seen through the storage interface.
 *
 * Two invariants carry this file. The first is that the bytes come back the way an
 * HTTP server would have sent them — `routes/media.ts` relays this `Response`
 * verbatim, so a wrong `Content-Range` is a video that will not seek. The second is
 * the fence: a symlink leading out of the declared root must be refused rather than
 * served, and that is the one defect here that would be a vulnerability rather than
 * a bug.
 */

const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'lukarn-local-')));
after(() => rmSync(workspace, { recursive: true, force: true }));

/** Outside the fence, and reachable only through the link planted below. */
const outside = join(workspace, 'outside');
const root = join(workspace, 'root');
const holidays = join(root, 'holidays');

mkdirSync(outside, { recursive: true });
mkdirSync(holidays, { recursive: true });

writeFileSync(join(outside, 'secret.jpg'), 'private');
writeFileSync(join(holidays, 'beach.jpg'), '0123456789');
writeFileSync(join(holidays, 'dive.mp4'), 'video-bytes');
writeFileSync(join(holidays, 'notes.txt'), 'not a photo');
writeFileSync(join(holidays, 'empty.jpg'), '');
symlinkSync(join(outside, 'secret.jpg'), join(holidays, 'escape.jpg'));
symlinkSync(outside, join(root, 'elsewhere'));

const silent = { warn: () => {} };

function env(localRoot: string | undefined): ReturnType<typeof loadEnv> {
  return loadEnv({
    NODE_ENV: 'test',
    SESSION_SECRET: 's'.repeat(48),
    TOKEN_KEY: 'k'.repeat(48),
    STORAGE_LOCAL_ROOT: localRoot,
    CONFIG_PATH: join(workspace, 'albums.yaml'),
    DATA_DIR: join(workspace, 'data'),
    CACHE_DIR: join(workspace, 'cache'),
    WEB_DIR: join(workspace, 'web'),
  } as NodeJS.ProcessEnv);
}

function service(settings: Record<string, unknown> = {}, localRoot = root): LocalFolderService {
  return new LocalFolderService(env(localRoot), settings, silent);
}

/** The listed entry for `name`, or `undefined`. */
async function entryNamed(
  provider: LocalFolderService,
  container: string,
  name: string,
): Promise<Awaited<ReturnType<LocalFolderService['list']>>['entries'][number] | undefined> {
  const page = await provider.list(container, null);
  return page.entries.find((entry) => entry.name === name);
}

describe('local folder storage', () => {
  it('declares itself as a backend that names files by location', () => {
    const provider = service();
    assert.equal(provider.kind, 'local');
    assert.equal(provider.refKind, 'path');
  });

  it('reports what the declared root points at', async () => {
    const probe = await service().probe();
    assert.equal(probe.ok, true);
    assert.equal(probe.account, root);
    assert.equal(probe.error, null);
  });

  it('is unusable without STORAGE_LOCAL_ROOT, and says so', async () => {
    const probe = await service({}, '').probe();
    assert.equal(probe.ok, false);
    assert.match(probe.error ?? '', /STORAGE_LOCAL_ROOT/);
  });

  it('reads a subfolder of the root, never a path outside it', async () => {
    const inside = await service({ path: 'holidays' }).probe();
    assert.equal(inside.ok, true);
    assert.equal(inside.account, holidays);

    for (const path of ['/etc', '../outside', 'elsewhere']) {
      const probe = await service({ path }).probe();
      assert.equal(probe.ok, false, `"${path}" must be refused`);
    }
  });

  it('lists folders and files, with a MIME type read from the extension', async () => {
    const provider = service();

    const folder = await entryNamed(provider, '', 'holidays');
    assert.equal(folder?.folder, true);
    assert.equal(folder?.mimeType, null);
    assert.equal(folder?.ref, 'holidays');

    const photo = await entryNamed(provider, 'holidays', 'beach.jpg');
    assert.equal(photo?.folder, false);
    assert.equal(photo?.mimeType, 'image/jpeg');
    assert.equal(photo?.size, 10);
    assert.equal(photo?.ref, join('holidays', 'beach.jpg'));

    const video = await entryNamed(provider, 'holidays', 'dive.mp4');
    assert.equal(video?.mimeType, 'video/mp4');

    // Indexed with no type at all rather than guessed: `sync/metadata.ts` drops
    // anything that is neither `image/` nor `video/`.
    const other = await entryNamed(provider, 'holidays', 'notes.txt');
    assert.equal(other?.mimeType, null);
  });

  it('holds neither pre-parsed metadata nor a preview', async () => {
    const provider = service();
    const photo = await entryNamed(provider, 'holidays', 'beach.jpg');
    assert.equal(photo?.media, null);
    assert.equal(photo?.hasPreview, false);
    assert.equal(await provider.preview(), null);
  });

  it('changes a version when the content changes', async () => {
    const provider = service({ path: 'holidays' });
    const before = await entryNamed(provider, '', 'beach.jpg');

    writeFileSync(join(holidays, 'beach.jpg'), '0123456789abcdef');
    const after = await entryNamed(provider, '', 'beach.jpg');

    assert.ok(before?.version);
    assert.notEqual(before.version, after?.version);

    // Restored, so the byte assertions below do not depend on this test's order.
    writeFileSync(join(holidays, 'beach.jpg'), '0123456789');
  });

  it('paginates without losing or repeating an entry', async () => {
    const provider = service();
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<LocalFolderService['list']>> = await provider.list(
        'holidays',
        cursor,
      );
      seen.push(...page.entries.map((entry) => entry.name));
      cursor = page.cursor;
    } while (cursor);

    assert.deepEqual(seen, [...new Set(seen)]);
    assert.ok(seen.includes('beach.jpg'));
  });

  it('serves the whole file when nothing is asked for', async () => {
    const response = await service().fetch(join('holidays', 'beach.jpg'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-length'), '10');
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(await response.text(), '0123456789');
  });

  it('answers a byte range with 206 and the interval it served', async () => {
    const response = await service().fetch(join('holidays', 'beach.jpg'), 'bytes=2-5');
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(response.headers.get('content-length'), '4');
    assert.equal(await response.text(), '2345');
  });

  it('answers an open-ended range to the end of the file', async () => {
    const response = await service().fetch(join('holidays', 'beach.jpg'), 'bytes=7-');
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 7-9/10');
    assert.equal(await response.text(), '789');
  });

  it('answers a suffix range with the end of the file', async () => {
    // What a player sends when it opens a video: this is not an edge case.
    const response = await service().fetch(join('holidays', 'beach.jpg'), 'bytes=-4');
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 6-9/10');
    assert.equal(await response.text(), '6789');
  });

  it('clamps a suffix range longer than the file rather than refusing it', async () => {
    const response = await service().fetch(join('holidays', 'beach.jpg'), 'bytes=-500');
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 0-9/10');
    assert.equal(await response.text(), '0123456789');
  });

  it('answers 416 with the real size when the range names nothing', async () => {
    const provider = service();

    const beyond = await provider.fetch(join('holidays', 'beach.jpg'), 'bytes=99-200');
    assert.equal(beyond.status, 416);
    assert.equal(beyond.headers.get('content-range'), 'bytes */10');

    // An empty file satisfies no range at all, suffix ranges included.
    const empty = await provider.fetch(join('holidays', 'empty.jpg'), 'bytes=-4');
    assert.equal(empty.status, 416);
    assert.equal(empty.headers.get('content-range'), 'bytes */0');
  });

  it('serves the whole file when the range header is unreadable', async () => {
    const response = await service().fetch(join('holidays', 'beach.jpg'), 'pages=1-2');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '0123456789');
  });

  it('refuses a symlink leading out of the root', async () => {
    const provider = service();

    // The listing drops it: an escaping link must never enter the index, where a
    // later request would resolve it from a path that looks legitimate.
    const listed = await entryNamed(provider, 'holidays', 'escape.jpg');
    assert.equal(listed, undefined);

    await assert.rejects(
      () => provider.fetch(join('holidays', 'escape.jpg')),
      /outside this storage/,
    );
  });

  it('refuses a reference climbing out of the root', async () => {
    const provider = service({ path: 'holidays' });
    await assert.rejects(() => provider.fetch(join('..', 'elsewhere', 'secret.jpg')));
    // An absolute reference is read relative to the fence, never from the disk root.
    await assert.rejects(() => provider.fetch('/etc/hostname'));
  });

  it('translates a missing root into a configuration error, through guard', async () => {
    const provider = service({}, join(workspace, 'nowhere'));
    await assert.rejects(() => provider.guard(() => provider.list('', null)), /STORAGE_LOCAL_ROOT/);
  });
});
