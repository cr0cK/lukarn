import { expect, test } from '@playwright/test';
import { ALBUMS } from '../fixtures/instance.js';
import { openDayAlbum } from '../fixtures/session.js';
import {
  firstPhotoId,
  issueSelectionShare,
  issueShare,
  photoIds,
  restoreShare,
  revokeShare,
} from '../fixtures/share.js';

/**
 * What a share link opens, driven by a browser that has never held a session
 * (D260825).
 *
 * **No page in this file signs in**, and that is the claim: the recipient of a link
 * is a stranger to this instance. The link itself is issued on a request context
 * (`fixtures/share.ts`), because making one requires an administrator by
 * construction — but the administrator's cookie never reaches the page.
 */

test('a shared album opens under the instance, and offers no way further in', async ({
  page,
  request,
}) => {
  const address = await issueShare(request, { label: 'Whole album' });

  await page.goto(address);

  // What was shared, under the instance's own name and mark: a page carrying
  // nothing but photographs has no sender and has the shape of a message worth
  // deleting (D260825d).
  await expect(page.getByRole('heading', { name: ALBUMS.day.title })).toBeVisible();
  await expect(page.getByText('Lukarn e2e')).toBeVisible();
  await expect(page.locator('main img').first()).toBeVisible();

  // And nothing saying that other content exists. The sign-in control above all: it
  // would tell everybody ever sent a link that there are passwords here to try.
  await expect(page.getByRole('link', { name: /sign in/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /sign in/i })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main sections' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Account' })).toHaveCount(0);
});

test('a link session reaches its own page and no other', async ({ page, request }) => {
  const address = await issueShare(request);
  await page.goto(address);
  // Wait for the page, not just the document: the session is minted by the request
  // the page makes, so navigating away on `load` would leave without a cookie and
  // prove nothing about what a link's session sees.
  await expect(page.getByRole('heading', { name: ALBUMS.day.title })).toBeVisible();

  // The server refuses the rest in any case; what is at stake here is that the
  // recipient is never *shown* it (D260825d). Not the album list, not the sign-in
  // screen, and not a blank page: one sentence saying where the photographs are.
  await page.goto('/');
  await expect(page.getByText('Open the link you were sent')).toBeVisible();
  await expect(page.getByRole('heading', { name: ALBUMS.day.title })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Account' })).toHaveCount(0);

  const albums = await page.request.get('/api/albums');
  // Never 403: the only 403s are `/api/admin/*` and the standing
  // `identity_required` (D12, D50).
  expect(albums.status()).toBe(404);
});

test('a shared photograph names its album nowhere', async ({ page, request }) => {
  const mediaId = await firstPhotoId(request);
  const address = await issueShare(request, { mediaId, label: 'One photograph' });

  await page.goto(address);
  await expect(page.locator('main img').first()).toBeVisible();

  // Not on the page, not in the address they were sent, and not in what their own
  // requests return: an album name says who was there, when, and that there are
  // more of them (D260825e).
  await expect(page.getByText(ALBUMS.day.title)).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toContain(ALBUMS.day.id);
  expect(address).not.toContain(ALBUMS.day.id);

  const opened = await page.request.get(`/api${address}`);
  expect(await opened.text()).not.toContain(ALBUMS.day.id);

  // The rendered HTML is deliberately not asserted whole: `seed-demo` names its
  // files `demo-<album>-NNNN`, so the **fixture's** media identifiers carry the slug
  // where a real backend's never would — a Drive identifier is opaque, and every
  // other backend hashes the connection with the path (`sync/metadata.ts`).
});

test('a photograph opens into the viewer, and back closes it', async ({ page, request }) => {
  const address = await issueShare(request);
  await page.goto(address);

  await page.locator('main img').first().click();
  const viewer = page.getByRole('dialog');
  await expect(viewer).toBeVisible();
  await expect(page).toHaveURL(/photo=/);

  // The viewer is a view of its own here as it is in an album: the URL carries the
  // open photograph, so Back closes it rather than leaving the page.
  await page.goBack();
  await expect(viewer).toBeHidden();
  await expect(page.getByRole('heading', { name: ALBUMS.day.title })).toBeVisible();
});

test('a link taken back says so, rather than that the address is wrong', async ({
  page,
  request,
}) => {
  const address = await issueShare(request, { label: 'To be revoked' });
  await revokeShare(request, address);

  await page.goto(address);

  // "Page not found" is also what a mistyped address answers, and the reader was
  // sent this one a month ago by somebody they know (D260825b). The sentence sits
  // on the same page, and offers no password field to guess at.
  await expect(page.getByText('This link was taken back.')).toBeVisible();
  await expect(page.getByRole('link', { name: /sign in/i })).toHaveCount(0);
});

test('an address nothing ever issued says exactly that', async ({ page }) => {
  await page.goto(`/s/${'z'.repeat(43)}`);

  await expect(page.getByText('This link does not lead anywhere.')).toBeVisible();
});

test('a revoked link restored can be reopened under the same address', async ({
  page,
  request,
}) => {
  const address = await issueShare(request, { label: 'To be restored' });
  await revokeShare(request, address);

  // When revoked, answers 410 and says taken back
  await page.goto(address);
  await expect(page.getByText('This link was taken back.')).toBeVisible();

  // Restore the link
  await restoreShare(request, address);

  // Reload/reopen: now answers 200 and displays album content again
  await page.goto(address);
  await expect(page.getByRole('heading', { name: ALBUMS.day.title })).toBeVisible();
  await expect(page.locator('main img').first()).toBeVisible();
});

test('a multi-photo selection share opens under the instance, renders only selected photos, and hides album provenance', async ({
  page,
  request,
}) => {
  const ids = await photoIds(request, 3);
  expect(ids).toHaveLength(3);

  const items = ids.map((mediaId) => ({ albumId: ALBUMS.day.id, mediaId }));
  const address = await issueSelectionShare(request, items, { label: 'Weekend Trip' });

  await page.goto(address);

  // Instance branding and share label are visible
  await expect(page.getByRole('heading', { name: 'Weekend Trip' })).toBeVisible();
  await expect(page.getByText('Lukarn e2e')).toBeVisible();

  // Exactly the 3 shared photographs are rendered
  const photos = page.locator('main img');
  await expect(photos).toHaveCount(3);
  await expect(photos.first()).toBeVisible();

  // Album provenance is never leaked (D260825e)
  await expect(page.getByText(ALBUMS.day.title)).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toContain(ALBUMS.day.id);
  expect(address).not.toContain(ALBUMS.day.id);

  // Click first photo to open Lightbox
  await photos.first().click();
  const viewer = page.getByRole('dialog');
  await expect(viewer).toBeVisible();
  // On mobile the viewer opens bare; a tap brings the chrome back
  if (await viewer.getByRole('button', { name: /chrome/i }).isVisible()) {
    await viewer.locator('img').last().click();
  }

  // Viewer displays share label and selection total, never origin album
  await expect(viewer.getByText('Weekend Trip')).toBeVisible();
  await expect(viewer.getByText(ALBUMS.day.title)).toHaveCount(0);

  // Back closes viewer and returns to the grid
  await page.goBack();
  await expect(viewer).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Weekend Trip' })).toBeVisible();
});

test('a multi-photo selection share without a label displays the fallback title', async ({
  page,
  request,
}) => {
  const ids = await photoIds(request, 2);
  expect(ids).toHaveLength(2);

  const items = ids.map((mediaId) => ({ albumId: ALBUMS.day.id, mediaId }));
  const address = await issueSelectionShare(request, items);

  await page.goto(address);

  // Fallback title is used in page heading
  await expect(page.getByRole('heading', { name: 'Shared photographs' })).toBeVisible();
  await expect(page.locator('main img')).toHaveCount(2);

  // Click first photo to open Lightbox
  await page.locator('main img').first().click();
  const viewer = page.getByRole('dialog');
  await expect(viewer).toBeVisible();
  if (await viewer.getByRole('button', { name: /chrome/i }).isVisible()) {
    await viewer.locator('img').last().click();
  }

  // Lightbox header displays fallback title as well
  await expect(viewer.getByText('Shared photographs')).toBeVisible();
});

test('selecting photos in AlbumPage opens ShareModal and generates a multi-photo link', async ({
  page,
  browser,
}) => {
  // Sign in as admin and open the day album
  await openDayAlbum(page);

  // Activate selection mode from TopBar (handles mobile View menu or desktop button)
  const viewButton = page.getByRole('button', { name: 'View' });
  if (await viewButton.isVisible()) {
    await viewButton.click();
    await page.getByRole('menuitem', { name: /Select/i }).click();
  } else {
    await page.getByRole('button', { name: /Select/i }).click();
  }

  // Click 3 photo thumbnails
  const thumbnails = page.locator('main button[role="checkbox"]');
  await expect(thumbnails.first()).toBeVisible();
  await thumbnails.nth(0).click();
  await thumbnails.nth(1).click();
  await thumbnails.nth(2).click();

  // Floating bottom action bar appears with count and share action
  const floatingBar = page.getByRole('complementary', { name: 'Photo selection' });
  await expect(floatingBar).toBeVisible();
  await expect(floatingBar.getByText('3 photos selected')).toBeVisible();

  // Click share selection
  await floatingBar.getByRole('button', { name: 'Share selection' }).click();

  // ShareModal is visible with pre-filled selection details
  const shareModal = page.getByRole('dialog');
  await expect(shareModal).toBeVisible();
  await expect(shareModal.getByRole('heading', { name: 'Share selection' })).toBeVisible();
  await expect(shareModal.getByText('3 photos selected')).toBeVisible();

  // Provide a label and issue the link
  await shareModal.locator('input#share-modal-label').fill('Family highlights');
  await shareModal.getByRole('button', { name: 'Issue the link' }).click();

  // Created share input contains the URL
  const linkInput = shareModal.locator('input#share-link-url');
  await expect(linkInput).toBeVisible();
  const shareUrl = await linkInput.inputValue();
  expect(shareUrl).toContain('/s/');

  // Open the link in a fresh unauthenticated browser context
  const strangerContext = await browser.newContext();
  const strangerPage = await strangerContext.newPage();
  try {
    await strangerPage.goto(shareUrl);
    await expect(strangerPage.getByRole('heading', { name: 'Family highlights' })).toBeVisible();
    await expect(strangerPage.locator('main img')).toHaveCount(3);
    await expect(strangerPage.getByText(ALBUMS.day.title)).toHaveCount(0);
  } finally {
    await strangerContext.close();
  }
});
