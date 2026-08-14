import { expect, test } from '@playwright/test';
import { dragDown } from '../fixtures/gestures.js';
import { ALBUMS } from '../fixtures/instance.js';
import { openDayAlbum } from '../fixtures/session.js';

test.describe('An album, on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await openDayAlbum(page);
  });

  test('the grid draws thumbnails the server actually rendered', async ({ page }) => {
    const tile = page.locator('main img').first();

    await expect(tile).toHaveAttribute('src', /\/api\/media\/[^/]+\/thumb\?s=(320|640|1280)/);
    // Decoded pixels, not a broken image: the cache was filled before the server
    // inventoried it, so this also proves the fixture's ordering held.
    await expect
      .poll(() => tile.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
  });

  test('the top bar keeps only what describes this page', async ({ page }) => {
    const bar = page.locator('header').first();

    await expect(bar.getByRole('link', { name: 'Back to the albums' })).toBeVisible();
    await expect(bar.getByRole('heading', { name: ALBUMS.day.title })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'View' })).toBeVisible();

    // Everything reachable from every page moved down to the tabs. Finding any of
    // it up here would mean the bar had started carrying two jobs again.
    await expect(bar.getByRole('button', { name: 'Recent activity' })).toBeHidden();
    await expect(bar.getByRole('button', { name: 'Account' })).toBeHidden();
    await expect(bar.getByRole('combobox', { name: 'Search' })).toBeHidden();
  });

  test('the bar retracts on the way down and returns on the first movement up', async ({
    page,
  }) => {
    const bar = page.locator('header').first();
    await expect.poll(async () => (await bar.boundingBox())?.y).toBe(0);

    // Scroll the page rather than send wheel events: the hook listens for
    // `scroll`, which is what a finger produces and what every engine fires.
    await page.evaluate(() => window.scrollTo({ top: 900 }));
    await expect
      .poll(async () => (await bar.boundingBox())?.y ?? 0, {
        message: 'the bar stayed put on the way down',
      })
      .toBeLessThan(0);

    // Not back to the top — the first upward movement is enough, which is the
    // whole point of the rule.
    await page.evaluate(() => window.scrollBy({ top: -120 }));
    await expect
      .poll(async () => (await bar.boundingBox())?.y ?? -1, {
        message: 'the bar did not come back',
      })
      .toBe(0);
  });

  test('the tab bar does not travel with the page', async ({ page }) => {
    const tabs = page.getByRole('navigation', { name: 'Main sections' });
    const before = (await tabs.boundingBox())!;

    await page.evaluate(() => window.scrollTo({ top: 900 }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    // The bar retracts and the tabs do not: what the page gives back is the top,
    // never the edge the thumb is resting on.
    const after = (await tabs.boundingBox())!;
    expect(after).toEqual(before);
    expect(Math.round(after.y + after.height)).toBe(
      await page.evaluate(() => document.documentElement.clientHeight),
    );
  });

  test('a sheet arrives from the bottom edge, and a tap on its grip puts it away', async ({
    page,
  }) => {
    const viewport = page.viewportSize()!;
    await page
      .getByRole('navigation', { name: 'Main sections' })
      .getByRole('button', {
        name: 'Account',
      })
      .click();

    const sheet = page.getByRole('dialog', { name: 'Account' });
    await expect(sheet).toBeVisible();

    const box = (await sheet.boundingBox())!;
    // Attached to the edge the hand is on, and not the whole screen: the strip of
    // page left above it is what says the sheet can be pushed back down.
    expect(Math.round(box.y + box.height)).toBe(viewport.height);
    expect(box.y).toBeGreaterThan(0);

    // A one-stop sheet has nowhere to collapse to, so its grip says "Close".
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
  });

  test('the same drag that opens a sheet puts it away', async ({ page }) => {
    await page
      .getByRole('navigation', { name: 'Main sections' })
      .getByRole('button', {
        name: 'Account',
      })
      .click();

    const sheet = page.getByRole('dialog', { name: 'Account' });
    await expect(sheet).toBeVisible();

    await dragDown(page, sheet.getByRole('button', { name: 'Close' }), 260);
    await expect(sheet).toBeHidden();
  });
});
