import { expect, test, type Page } from '@playwright/test';
import { pinchApart } from '../fixtures/gestures.js';
import { ALBUMS } from '../fixtures/instance.js';
import { openDayAlbum } from '../fixtures/session.js';

/**
 * The album's first photo. `comments.spec.ts` deliberately works on the second:
 * the specs share one instance, and a thread posted there would show up here.
 */
const PHOTO = 'IMG_0000.jpg';

/** The open viewer: a dialog named after the file it is showing. */
function viewer(page: Page) {
  return page.getByRole('dialog', { name: PHOTO });
}

async function openFirstPhoto(page: Page): Promise<void> {
  await page.getByRole('button', { name: PHOTO }).click();
  await expect(viewer(page)).toBeVisible();
  // The photo has to have decoded before any of this means anything: zoom is
  // derived from its dimensions, and a pinch on a blank frame does nothing.
  await expect
    .poll(() =>
      viewer(page)
        .locator('img')
        .last()
        .evaluate((i: HTMLImageElement) => i.naturalWidth),
    )
    .toBeGreaterThan(0);
}

test.describe('The viewer, on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await openDayAlbum(page);
    await openFirstPhoto(page);
  });

  test('it opens on the photo, with nothing over it', async ({ page }) => {
    const open = viewer(page);

    await expect(open.getByRole('banner')).toBeHidden();
    await expect(open.getByRole('button', { name: 'Close (Esc)' })).toBeHidden();
    await expect(open.getByRole('button', { name: 'Previous (←)' })).toBeHidden();
    await expect(open.getByRole('button', { name: 'Next (→)' })).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'Information and comments' })).toBeHidden();

    // One affordance survives, in the corner the actions used to be: without it
    // there would be no way back that a finger could find.
    await expect(open.getByRole('button', { name: 'Show the chrome (h)' })).toBeVisible();
  });

  test('a tap brings the chrome back, and the photo says where it comes from', async ({ page }) => {
    const open = viewer(page);
    await open.locator('img').last().click();

    const header = open.getByRole('banner');
    await expect(header).toBeVisible();
    await expect(header.getByRole('button', { name: 'Close (Esc)' })).toBeVisible();
    // Album and day locate the photo; what somebody wrote about it joins them
    // there rather than waiting under a row of buttons at the far end.
    await expect(header).toContainText(ALBUMS.day.title);
    await expect(header.getByRole('button', { name: 'Expand the caption' })).toBeVisible();
  });

  test('one sheet carries the actions at rest, and the panel when pulled up', async ({ page }) => {
    const open = viewer(page);
    await open.locator('img').last().click();

    const sheet = page.getByRole('dialog', { name: 'Information and comments' });
    await expect(sheet).toBeVisible();

    // At rest it is the toolbar, and the same row **is** the panel's tab strip.
    const sections = sheet.getByRole('tablist', { name: 'Panel sections' });
    await expect(sections.getByRole('tab', { name: 'Info' })).toBeVisible();
    await expect(sections.getByRole('tab', { name: /Comments/ })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Download' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Photo actions' })).toBeVisible();

    const resting = (await sheet.boundingBox())!;

    await sections.getByRole('tab', { name: 'Info' }).click();
    await expect(sections.getByRole('tab', { name: 'Info' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The technical data is what "pulled up" reveals, and the sheet is taller for it.
    await expect(sheet.getByRole('tabpanel')).toContainText('Camera');
    expect((await sheet.boundingBox())!.height).toBeGreaterThan(resting.height);

    await sections.getByRole('tab', { name: /Comments/ }).click();
    await expect(sheet.getByRole('tabpanel')).toContainText('No comments');
  });

  test('a pinch asks the server for the 4096 px render', async ({ page }) => {
    // Asserted on the request, not on a transform: the claim is that the gesture
    // fetches pixels that were never on screen, where the browser's own page zoom
    // only magnified the ones already rendered.
    const hd = page.waitForRequest((request) =>
      /\/api\/media\/[^/]+\/hd(\?|$)/.test(request.url()),
    );

    await pinchApart(viewer(page).locator('img').last());

    await expect(hd).resolves.toBeTruthy();
  });
});
