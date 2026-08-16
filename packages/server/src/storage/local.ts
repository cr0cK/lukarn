import { createReadStream } from 'node:fs';
import { access, constants, readdir, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import type { Env } from '../env.js';
import { parseRange, type ByteRange } from '../media/range.js';
import {
  StorageNotConfiguredError,
  StorageNotConnectedError,
  StorageUnavailableError,
  type StorageEntry,
  type StorageKind,
  type StoragePage,
  type StorageProbe,
  type StorageProvider,
} from './provider.js';

/**
 * The setting a connection carries: which folder **under `STORAGE_LOCAL_ROOT`** it
 * reads. Empty means the root itself.
 */
const SUBPATH_KEY = 'path';

/**
 * Entries per page. The same figure as Drive's, and for the same reason: it bounds
 * how many `stat` calls one call makes, not how much `readdir` returns.
 */
const PAGE_SIZE = 1000;

/** How long the client is asked to wait after a failure the disk may recover from. */
const RETRY_AFTER_SECONDS = 5;

const NOT_CONFIGURED =
  'STORAGE_LOCAL_ROOT is not set, so no local folder can be read. Declare it on the ' +
  'container, alongside the volume it names.';

/**
 * MIME type from the extension, because a folder tells us nothing else.
 *
 * Only the prefix is load-bearing downstream — `sync/metadata.ts` splits `image/`
 * from `video/` and ignores everything else — so an unlisted extension is not
 * indexed at all. That is the intended behaviour: a `.txt` beside the photos is
 * not a photo, and guessing from the bytes would mean downloading every file to
 * find out, which is what indexing exists to avoid (D3).
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.bmp': 'image/bmp',
  '.dng': 'image/x-adobe-dng',
  '.cr2': 'image/x-canon-cr2',
  '.cr3': 'image/x-canon-cr3',
  '.nef': 'image/x-nikon-nef',
  '.arw': 'image/x-sony-arw',
  '.orf': 'image/x-olympus-orf',
  '.raf': 'image/x-fuji-raf',
  '.rw2': 'image/x-panasonic-rw2',
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.3gp': 'video/3gpp',
  '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.wmv': 'video/x-ms-wmv',
};

/** `null` for an extension this application has no reason to index. */
function mimeOf(name: string): string | null {
  return MIME_BY_EXTENSION[extname(name).toLowerCase()] ?? null;
}

/**
 * Is `target` the fence itself, or inside it?
 *
 * The separator matters: without it, `/photos-private` would count as inside
 * `/photos`, which is the classic prefix-comparison mistake.
 */
function contains(fence: string, target: string): boolean {
  return target === fence || target.startsWith(fence + sep);
}

/**
 * The folder this connection reads, relative to the root.
 *
 * An **absolute** path is refused rather than quietly reinterpreted as relative:
 * somebody typing `/photos` means the machine's `/photos`, and silently reading
 * `<root>/photos` instead would serve a different folder than the one asked for.
 * `..` is refused for the obvious reason, although the `realpath` fence below
 * would catch it anyway — refusing here is what lets /admin say why.
 */
function normalizeSubpath(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed === '.') return '';

  if (isAbsolute(trimmed)) {
    throw new StorageNotConfiguredError(
      `"${trimmed}" is an absolute path. A local storage reads a folder under ` +
        'STORAGE_LOCAL_ROOT, named relative to it.',
    );
  }
  if (trimmed.split(/[\\/]/).includes('..')) {
    throw new StorageNotConfiguredError(
      `"${trimmed}" leaves STORAGE_LOCAL_ROOT. A local storage reads a folder under it.`,
    );
  }

  return trimmed.replace(/[\\/]+$/, '');
}

/**
 * A reference as `resolve` may be given it: never absolute, so it cannot jump out
 * of the fence before `realpath` is even consulted. `..` is left alone — it
 * normalises away, and whatever survives is caught by the fence.
 */
function relativeRef(ref: string): string {
  return ref.replace(/^[\\/]+/, '');
}

/** Where a page of a listing resumes. Anything unreadable restarts from the top. */
function toOffset(cursor: string | null): number {
  const parsed = Number(cursor);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * The byte interval a `Range` names in a file of `size` bytes, or `null` when it
 * names none — which is the 416 the caller owes the client.
 *
 * A suffix range (`bytes=-500`) asks for the **last** 500 bytes and is clamped to
 * the file rather than refused: a player asking for more tail than exists is asking
 * for the whole file. Video playback opens with one of these, so it is not an edge
 * case.
 */
function toSlice(range: ByteRange, size: number): { start: number; end: number } | null {
  if (size === 0) return null;

  if (range.start === null) {
    const length = Math.min(range.end!, size);
    return { start: size - length, end: size - 1 };
  }

  if (range.start >= size) return null;
  return { start: range.start, end: Math.min(range.end ?? size - 1, size - 1) };
}

/**
 * A Node stream as a `Response` body.
 *
 * `Readable.toWeb` produces the same `ReadableStream` the platform `Response`
 * expects, but the two are typed in different declaration files, so the cast is
 * unavoidable — `routes/media.ts` performs the mirror image of it on the way out.
 */
type ResponseBody = ConstructorParameters<typeof Response>[0];

function toBody(stream: Readable): ResponseBody {
  return Readable.toWeb(stream) as unknown as ResponseBody;
}

/**
 * A folder on the machine as a `StorageProvider`.
 *
 * It holds nothing Drive holds: no pre-parsed EXIF data, so `media` is `null` and
 * the indexer reads the bytes; no stored preview, so `preview()` is `null` and the
 * renderer falls back to decoding, or to ffmpeg for a video. Both nulls are the
 * shapes `StorageProvider` was designed around (D260815f).
 *
 * **The whole of its security is one fence.** Every path it resolves goes through
 * `realpath` and is then checked to still sit under the root the environment
 * declared; a symlink pointing out of the tree is refused rather than served
 * (D260816d).
 */
export class LocalFolderService implements StorageProvider {
  readonly kind: StorageKind = 'local';
  /**
   * A file here is named by where it sits, and nothing survives its being renamed:
   * the index hashes the path with the connection and keeps the path itself in
   * `media.source_path`.
   */
  readonly refKind = 'path' as const;

  /** `null` when the environment declares no root, which makes the kind unusable. */
  private readonly root: string | null;
  private readonly subpath: unknown;

  constructor(
    env: Env,
    settings: Record<string, unknown>,
    private readonly log: { warn: (msg: string) => void },
  ) {
    this.root = env.storageLocalRoot;
    this.subpath = settings[SUBPATH_KEY];
  }

  /**
   * Does the declared folder exist, and can this process read it?
   *
   * `account` is the resolved directory rather than the configured one: a root
   * reached through a symlink, or a subpath that is not where its administrator
   * believes, is exactly what this screen exists to reveal.
   */
  async probe(): Promise<StorageProbe> {
    try {
      const base = await this.base();
      const info = await stat(base);
      if (!info.isDirectory()) {
        return { ok: false, account: base, error: `"${base}" is not a directory.` };
      }
      // Reading a directory takes both: `R_OK` to list it, `X_OK` to reach anything
      // inside. A folder missing the second lists fine and serves nothing.
      await access(base, constants.R_OK | constants.X_OK);
      return { ok: true, account: base, error: null };
    } catch (error) {
      return { ok: false, account: this.root, error: (error as Error).message };
    }
  }

  /**
   * One page of a folder's direct children, sorted by name as Drive sorts them.
   *
   * The cursor is an offset into that sorted list. A file created or deleted
   * between two pages therefore shifts the ones after it — the same exposure any
   * paginated listing has, and the next sync corrects it.
   */
  async list(container: string, cursor: string | null): Promise<StoragePage> {
    const base = await this.base();
    const directory = await this.within(base, container);

    const names = (await readdir(directory, { withFileTypes: true }))
      .map((entry) => entry.name)
      .sort();

    const offset = toOffset(cursor);
    const entries: StorageEntry[] = [];
    for (const name of names.slice(offset, offset + PAGE_SIZE)) {
      const entry = await this.toEntry(base, directory, name);
      if (entry) entries.push(entry);
    }

    const next = offset + PAGE_SIZE;
    return { entries, cursor: next < names.length ? String(next) : null };
  }

  /**
   * Bytes, honouring `Range` the way the browser expects them.
   *
   * The response is built rather than relayed — there is no upstream server here —
   * so this method owes what an HTTP server would have said: 206 with a
   * `Content-Range`, 416 with `bytes * /size` when the interval names nothing, 200
   * otherwise. `routes/media.ts` reads those three exactly as it reads Drive's.
   */
  async fetch(ref: string, range?: string, signal?: AbortSignal): Promise<Response> {
    const base = await this.base();
    const path = await this.within(base, ref);

    const info = await stat(path);
    if (!info.isFile()) {
      throw new StorageNotConnectedError(`"${ref}" is not a file on this storage.`);
    }

    const type = mimeOf(path) ?? 'application/octet-stream';
    const wanted = parseRange(range);

    // An unreadable header is not an error: RFC 9110 asks for the whole file, and
    // `parseRange` already answers `null` for everything it will not relay.
    if (!wanted) {
      return new Response(toBody(createReadStream(path, { signal })), {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(info.size),
          'Accept-Ranges': 'bytes',
        },
      });
    }

    const slice = toSlice(wanted, info.size);
    if (!slice) {
      // The body is empty and the size is the whole message: it tells a player that
      // seeked past the end where the file actually stops.
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${info.size}`, 'Accept-Ranges': 'bytes' },
      });
    }

    // `end` is inclusive for `createReadStream`, as it is in a `Content-Range`.
    const stream = createReadStream(path, { start: slice.start, end: slice.end, signal });
    return new Response(toBody(stream), {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(slice.end - slice.start + 1),
        'Content-Range': `bytes ${slice.start}-${slice.end}/${info.size}`,
        'Accept-Ranges': 'bytes',
      },
    });
  }

  /**
   * Always `null`: a folder holds no previews.
   *
   * The parameters are omitted rather than ignored, which is the honest signature —
   * nothing about the answer depends on which file or which size is asked for. The
   * renderer treats it as it treats a Drive file with no thumbnail: it decodes the
   * original, and for a video it asks ffmpeg (D260816).
   */
  async preview(): Promise<Response | null> {
    return null;
  }

  /**
   * Translates the disk's refusals into the shared taxonomy.
   *
   * `ENOENT` is deliberately **not** translated: a file the index knows and the
   * folder no longer holds is neither a credentials problem nor a transient one,
   * and the errno message already names the path. Drive answers the same way for a
   * 404.
   */
  async guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      const path = (error as NodeJS.ErrnoException | null)?.path ?? 'this storage';

      // The process cannot read what it was pointed at. For a folder this is the
      // equivalent of a withdrawn authorisation: the mount is read-only to another
      // user, or the volume was remounted with different ownership.
      if (code === 'EACCES' || code === 'EPERM') {
        throw new StorageNotConnectedError(
          `The container has no permission to read "${path}". Check the ownership of ` +
            'STORAGE_LOCAL_ROOT and of the volume mounted there.',
        );
      }

      // Transient by nature — a file-descriptor ceiling reached by a cold grid, a
      // busy mount — so the client is told to retry rather than that it is broken.
      if (code === 'EMFILE' || code === 'ENFILE' || code === 'EAGAIN' || code === 'EBUSY') {
        throw new StorageUnavailableError(path, RETRY_AFTER_SECONDS, code);
      }

      throw error;
    }
  }

  /**
   * The fence: the real directory this connection is allowed to read, and nothing
   * above it.
   *
   * Recomputed per call rather than cached because it is the security boundary: a
   * root replaced by a symlink after startup must be caught the next time it is
   * used, not remembered from the time it was valid. One `realpath` on a local
   * filesystem is nothing beside reading the file that follows.
   */
  private async base(): Promise<string> {
    if (!this.root) throw new StorageNotConfiguredError(NOT_CONFIGURED);
    const subpath = normalizeSubpath(this.subpath);

    let root: string;
    try {
      root = await realpath(this.root);
    } catch (error) {
      throw new StorageNotConfiguredError(
        `STORAGE_LOCAL_ROOT points at "${this.root}", which cannot be read ` +
          `(${(error as Error).message}).`,
      );
    }

    if (!subpath) return root;

    let base: string;
    try {
      base = await realpath(resolve(root, subpath));
    } catch (error) {
      throw new StorageNotConfiguredError(
        `This storage reads "${subpath}" under STORAGE_LOCAL_ROOT, which cannot be read ` +
          `(${(error as Error).message}).`,
      );
    }

    if (!contains(root, base)) {
      throw new StorageNotConfiguredError(
        `"${subpath}" resolves to "${base}", outside STORAGE_LOCAL_ROOT. A link leading ` +
          'out of the declared root is refused rather than followed.',
      );
    }
    return base;
  }

  /**
   * A reference resolved inside the fence, or a refusal.
   *
   * `resolve` alone is not enough and that is the entire point of this method: it
   * normalises `..` away but knows nothing about links, so a symlink named
   * `holidays` pointing at `/etc` passes it untouched. `realpath` is what turns the
   * request into the file it would actually open, and only then is the fence
   * meaningful.
   */
  private async within(base: string, ref: string): Promise<string> {
    const real = await realpath(resolve(base, relativeRef(ref)));
    if (!contains(base, real)) {
      throw new StorageNotConnectedError(
        `"${ref}" leads outside this storage's folder. It is refused rather than served.`,
      );
    }
    return real;
  }

  /**
   * One listed name as the indexer sees it, or `null` for something it must not
   * index: a link out of the fence, a socket or a device, or a file that vanished
   * between the listing and the `stat`.
   *
   * The reference is the **logical** path under the fence rather than the resolved
   * one, so a folder reached through a link inside the tree keeps the name its
   * album was configured with. Resolving it again goes through the same fence.
   */
  private async toEntry(
    base: string,
    directory: string,
    name: string,
  ): Promise<StorageEntry | null> {
    const path = join(directory, name);

    let real: string;
    try {
      // `stat` follows links, so the fence has to be checked before it is trusted —
      // and `readdir` cannot answer this: a `Dirent` for a symlink says "symlink",
      // never what it points at.
      real = await realpath(path);
    } catch {
      return null;
    }

    if (!contains(base, real)) {
      this.log.warn(
        `Local storage: "${relative(base, path)}" links outside its folder and is ignored.`,
      );
      return null;
    }

    let info;
    try {
      info = await stat(real);
    } catch {
      return null;
    }

    const folder = info.isDirectory();
    if (!folder && !info.isFile()) return null;

    return {
      ref: relative(base, path),
      name,
      folder,
      mimeType: folder ? null : mimeOf(name),
      size: folder ? null : info.size,
      modifiedTime: info.mtime.toISOString(),
      // Size and modification time together: the pair the filesystem guarantees
      // moves when the bytes do, and the cheapest thing to read while listing. A
      // checksum would mean reading every file on every sync.
      version: folder ? null : `${info.size}:${Math.trunc(info.mtimeMs)}`,
      media: null,
      hasPreview: false,
    };
  }
}
