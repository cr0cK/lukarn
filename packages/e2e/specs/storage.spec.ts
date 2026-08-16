import { expect, test, type Page } from '@playwright/test';
import { LOCAL_ALBUM, LOCAL_CONNECTION, STORAGE_SUBPATH } from '../fixtures/instance.js';
import { PHOTO_COUNT, PHOTO_MONTHS } from '../fixtures/photos.js';
import { signIn } from '../fixtures/session.js';
import { CONTAINER_BACKENDS, dockerAvailable } from '../storages/backends.js';

/**
 * An album filled by a **real** synchronisation, on every storage that can be reached.
 *
 * Every other spec runs against `seed-demo`, which writes rows straight into the
 * index: nothing between a storage and a grid is exercised. This one is the suite's
 * only end-to-end pass through the whole chain — a listing, the EXIF block read out of
 * the first bytes, the identifier derived from the path, the renderer, the cache, and
 * the tiles that come back.
 *
 * It runs as a **table**, and that is the point of it. `storages/contract.test.ts`
 * already holds each backend to the interface; what this adds is that the rest of the
 * application cannot tell them apart — the same album, the same three photographs, the
 * same headings, from a folder, a bucket and two WebDAV servers. A claim that holds for
 * one and not the others is a claim `StorageProvider` does not really make.
 *
 * The folder is always there. The other three exist only when a Docker daemon answers,
 * because `storages/compose.yml` is what runs them; without one, this file is what it
 * was before they existed. CI sets `LUKARN_REQUIRE_STORAGES=1`, where a missing daemon
 * fails the run instead of quietly shortening it (D260816k).
 */

/** One row of the table: a connection, the album it serves, and what a probe says of it. */
const BACKENDS = [
  { label: LOCAL_CONNECTION.label, album: LOCAL_ALBUM, probeNames: STORAGE_SUBPATH },
  // Read when the file is loaded, not inside a test: Playwright decides the list of
  // cases before the run, and `prepare.ts` connects exactly these when this same call
  // answers true for it.
  ...(dockerAvailable() ? CONTAINER_BACKENDS : []),
];

/**
 * Fills an album from its storage, and leaves it filled.
 *
 * Nothing synchronises these albums on their own — the fixture creates them empty and
 * the instance has automatic syncing switched off — so every claim about their contents
 * has to ask for the pass first. Written to be safe to call twice, because the tests
 * below share one server and Playwright makes no promise about which runs first.
 */
async function synced(page: Page, album: { title: string }, label: string): Promise<void> {
  await page.goto('/admin/albums');

  const button = page.getByRole('button', { name: `Resync album ${album.title}` });
  if (await button.isEnabled()) await button.click();

  // Disabled while the pass runs, enabled again when it returns.
  await expect(button).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator('main')).toContainText(`${PHOTO_COUNT} items · ${label}`, {
    timeout: 60_000,
  });
}

for (const { label, album, probeNames } of BACKENDS) {
  test.describe(`An album read from ${label}`, () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page);
    });

    test('Test answers with what the connection resolved to', async ({ page }) => {
      await page.goto('/admin/storage');

      // The innermost element carrying both this connection's name and a Test button —
      // `hasText` alone matches every ancestor up to `<body>`, and every one of those
      // also holds the Test buttons of the other connections.
      const row = page
        .locator('div')
        .filter({ hasText: label })
        .filter({ has: page.getByRole('button', { name: 'Test', exact: true }) })
        .last();
      await expect(row).toContainText('Connected');

      await row.getByRole('button', { name: 'Test', exact: true }).click();

      // The **resolved** location, and only a probe can say it: a connection that is
      // not where its administrator believes is exactly what this button exists to
      // reveal, and the row cannot show it before anyone has asked.
      await expect(page.locator('body')).toContainText('It answers', { timeout: 30_000 });
      await expect(page.locator('body')).toContainText(probeNames);
    });

    test('syncing fills it with exactly what the storage holds', async ({ page }) => {
      await synced(page, album, label);
    });

    test('a resync of an unchanged storage changes nothing', async ({ page }) => {
      await synced(page, album, label);

      const button = page.getByRole('button', { name: `Resync album ${album.title}` });
      await button.click();
      await expect(button).toBeEnabled({ timeout: 60_000 });

      // Still three. A second pass must neither duplicate the photographs — which is
      // what a derived identifier that was not stable would do — nor delete them, which
      // is what `deleteStale` would do if the second pass computed different ones.
      await expect(page.locator('main')).toContainText(`${PHOTO_COUNT} items · ${label}`);
    });

    test('the grid dates the photographs from their EXIF, not from the files', async ({ page }) => {
      await synced(page, album, label);
      await page.goto(`/album/${album.id}`);

      await expect(page.locator('main img')).toHaveCount(PHOTO_COUNT, { timeout: 30_000 });

      // Months away from the moment the fixture wrote the files, and the whole of what
      // reading EXIF from the bytes buys: without it every photograph would be dated
      // the day the suite ran — or, in a bucket, the second it was uploaded.
      for (const month of PHOTO_MONTHS) {
        await expect(page.locator('main')).toContainText(month);
      }
    });

    test('a photograph opens full screen from a storage that holds no preview', async ({
      page,
    }) => {
      await synced(page, album, label);
      await page.goto(`/album/${album.id}`);
      await expect(page.locator('main img').first()).toBeVisible({ timeout: 30_000 });

      await page.locator('main img').first().click();

      // None of these backends answers anything but `null` to `preview()`, so this
      // render can only have come from decoding the original. On Drive the same screen
      // may be served from a stored preview, which is precisely why it is worth
      // asserting here and not there.
      const viewer = page.getByRole('dialog');
      await expect(viewer).toBeVisible();
      await expect(viewer.locator('img').first()).toBeVisible({ timeout: 30_000 });
    });
  });
}
