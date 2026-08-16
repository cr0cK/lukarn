import { expect, test } from '@playwright/test';
import { LOCAL_ALBUM, LOCAL_CONNECTION } from '../fixtures/instance.js';
import { signIn } from '../fixtures/session.js';

/**
 * An album filled by a **real** synchronisation.
 *
 * Every other spec runs against `seed-demo`, which writes rows straight into the
 * index: nothing between a storage and a grid is exercised. This one is the suite's
 * only end-to-end pass through the whole chain — a folder on disk, `list()`, the EXIF
 * block read out of the first bytes, the identifier derived from the path, the
 * renderer, the cache, and the tiles that come back.
 *
 * It exists because that chain has never had a test. Drive was deliberately absent
 * from the suite — no test may hold Google credentials — and a local folder is the
 * first backend that needs none.
 *
 * The fixture writes three photographs and leaves the album empty; the instance
 * indexes them while it starts, which is the path a real installation takes. Three,
 * therefore, is an assertion about synchronisation and not about the fixture: a
 * fourth file appearing would mean something else wrote into this album, and a
 * second would mean the traversal stopped early.
 */

/**
 * Fills the album from the folder, and leaves it filled.
 *
 * Nothing synchronises this album on its own — the fixture creates it empty and the
 * instance has automatic syncing switched off — so every claim about its contents has
 * to ask for the pass first. Written to be safe to call twice, because the tests below
 * share one server and Playwright makes no promise about which of them runs first.
 */
async function synced(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/admin/albums');

  const button = page.getByRole('button', { name: `Resync album ${LOCAL_ALBUM.title}` });
  if (await button.isEnabled()) await button.click();

  // Disabled while the pass runs, enabled again when it returns.
  await expect(button).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator('main')).toContainText(`3 items · ${LOCAL_CONNECTION.label}`, {
    timeout: 60_000,
  });
}

test.describe('An album read from a folder on disk', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('Test answers with the folder the connection resolved to', async ({ page }) => {
    // Storage sits inside the Server section rather than having one of its own.
    await page.goto('/admin/server');

    // The innermost element carrying both this connection's name and a Test button —
    // `hasText` alone matches every ancestor up to `<body>`, and every one of those
    // also holds the Test buttons of the other connections.
    const row = page
      .locator('div')
      .filter({ hasText: `${LOCAL_CONNECTION.label} Local folder` })
      .filter({ has: page.getByRole('button', { name: 'Test', exact: true }) })
      .last();
    await expect(row).toContainText('Connected');

    await row.getByRole('button', { name: 'Test', exact: true }).click();

    // The **resolved** directory, and only a probe can say it: a subpath that is not
    // where its administrator believes is exactly what this button exists to reveal,
    // and the row cannot show it before anyone has asked.
    await expect(page.locator('body')).toContainText('It answers', { timeout: 30_000 });
    await expect(page.locator('body')).toContainText('corsica');
  });

  test('syncing fills it with exactly what the folder holds', async ({ page }) => {
    await page.goto('/admin/albums');
    await expect(page.locator('main')).toContainText('never synced');

    await synced(page);
  });

  test('a resync of an unchanged folder changes nothing', async ({ page }) => {
    await synced(page);

    const button = page.getByRole('button', { name: `Resync album ${LOCAL_ALBUM.title}` });
    await button.click();
    await expect(button).toBeEnabled({ timeout: 60_000 });

    // Still three. A second pass must neither duplicate the photographs — which is
    // what a derived identifier that was not stable would do — nor delete them, which
    // is what `deleteStale` would do if the second pass computed different ones.
    await expect(page.locator('main')).toContainText(`3 items · ${LOCAL_CONNECTION.label}`);
  });

  test('the grid dates the photographs from their EXIF, not from the files', async ({ page }) => {
    await synced(page);
    await page.goto(`/album/${LOCAL_ALBUM.id}`);

    await expect(page.locator('main img')).toHaveCount(3, { timeout: 30_000 });

    // March and April 2026 are the capture dates written into the EXIF blocks, and
    // they are months away from the moment the fixture wrote the files. Seeing them
    // here is the whole of what reading EXIF from the bytes buys: without it every
    // photograph would be dated the day the suite ran.
    await expect(page.locator('main')).toContainText('April 2026');
    await expect(page.locator('main')).toContainText('March 2026');
  });

  test('a photograph opens full screen from a storage that holds no preview', async ({ page }) => {
    await synced(page);
    await page.goto(`/album/${LOCAL_ALBUM.id}`);
    await expect(page.locator('main img').first()).toBeVisible({ timeout: 30_000 });

    await page.locator('main img').first().click();

    // A folder answers `null` to `preview()`, so this render can only have come from
    // decoding the original. On Drive the same screen may be served from a stored
    // preview, which is precisely why it is worth asserting here and not there.
    const viewer = page.getByRole('dialog');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('img').first()).toBeVisible({ timeout: 30_000 });
  });
});
