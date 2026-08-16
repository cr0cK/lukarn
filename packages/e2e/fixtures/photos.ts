import type { SeedFile } from '../storages/backends.js';

/**
 * The three photographs every backend is filled with.
 *
 * One definition, because the point of the storage matrix is that the same claims hold
 * whatever serves them: a folder, a bucket and two WebDAV servers all answer with these
 * bytes, so a grid that differs between them differs because of the backend.
 *
 * Written with sharp rather than committed, for the reason `prepare.ts` gives about the
 * password hash and the database: a binary in the repository states nothing about what
 * it contains, and goes stale silently.
 */

/**
 * Capture dates, spread across two months so the grid has more than one heading.
 *
 * EXIF's own format, without a time zone: this is the device's clock, and the
 * application stores and displays it as UTC.
 */
export const PHOTO_DATES = ['2026:03:11 09:15:00', '2026:03:11 14:02:00', '2026:04:02 18:30:00'];

/** The months those dates fall in, as the grid writes them. */
export const PHOTO_MONTHS = ['March 2026', 'April 2026'];

/** How many there are, and therefore what a filled album must contain. */
export const PHOTO_COUNT = PHOTO_DATES.length;

/**
 * The photographs, rendered once and reused by every caller.
 *
 * Cached because three sharp renders are cheap but four callers are not: the fixture
 * writes them to disk, and each container backend uploads the same bytes.
 */
let rendered: Promise<SeedFile[]> | null = null;

export function photographs(): Promise<SeedFile[]> {
  rendered ??= render();
  return rendered;
}

async function render(): Promise<SeedFile[]> {
  const { default: sharp } = await import('sharp');

  return Promise.all(
    PHOTO_DATES.map(async (taken, index) => ({
      name: `photo-${index + 1}.jpg`,
      mimeType: 'image/jpeg',
      // `IFD2` is sharp's name for the Exif sub-IFD, and `DateTimeOriginal` lives
      // nowhere else. Naming it anything sharp does not recognise — `ExifIFD`, say —
      // writes a valid JPEG with no capture date in it and reports no error, which is
      // exactly the failure that makes a fixture worth reading twice.
      bytes: await sharp({
        create: {
          width: 240,
          height: 160,
          channels: 3,
          background: { r: 40 + index * 30, g: 90, b: 160 },
        },
      })
        .withExif({ IFD0: { Make: 'Lukarn', Model: 'E2E' }, IFD2: { DateTimeOriginal: taken } })
        .jpeg()
        .toBuffer(),
    })),
  );
}
