import { expect, test } from '@playwright/test';
import { ALBUMS } from '../fixtures/instance.js';
import { openDayAlbum, signIn } from '../fixtures/session.js';

/**
 * The other half of the promise: **nothing changed above 768 px.**
 *
 * The mobile rework moved every control that moves between pages down to a tab
 * bar. This file is what says the desktop still has none of it — its bar carries
 * all of it, its panel is a column, and its keyboard still drives the viewer.
 */
test.describe('Above the breakpoint', () => {
  test('the top bar carries everything, and there is no tab bar', async ({ page }) => {
    await signIn(page);

    const bar = page.locator('header').first();
    await expect(bar.getByRole('combobox', { name: 'Search' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Recent activity' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Account' })).toBeVisible();

    // Rendered, and hidden by the breakpoint alone: the assertion is what a
    // visitor sees, not what React mounted.
    await expect(page.getByRole('navigation', { name: 'Main sections' })).toBeHidden();
  });

  test('administration opens on a section, beside its sidebar', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin');

    // `/admin` is a screen of its own only on a phone: here the sidebar already
    // lists the sections beside every one of them.
    await expect(page).toHaveURL(/\/admin\/albums$/);
    await expect(page.getByRole('navigation', { name: 'Administration sections' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Albums', exact: true })).toBeVisible();
  });

  test('settings are a labelled form, not a list of rows', async ({ page }) => {
    await signIn(page);
    await page.goto('/settings');

    // The row with its value on the right belongs to the phone. Here every
    // setting carries its label above the control, like every other form.
    await expect(page.getByRole('button', { name: /^Language/ })).toBeHidden();
    await expect(page.getByLabel('Language')).toHaveValue('en');
    await expect(page.getByLabel('Theme')).toHaveValue('dark');
  });

  test('the viewer opens with its chrome, and the keyboard drives it', async ({ page }) => {
    await openDayAlbum(page);
    await page.getByRole('button', { name: 'IMG_0000.jpg' }).click();

    const viewer = page.getByRole('dialog', { name: 'IMG_0000.jpg' });
    await expect(viewer).toBeVisible();

    // With a cursor there is nothing hidden to reveal: hover already names every
    // control, and the arrows are how a mouse moves through an album.
    await expect(viewer.getByRole('banner')).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Close (Esc)' })).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Next (→)' })).toBeVisible();
    await expect(viewer).toContainText(ALBUMS.day.title);

    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('dialog', { name: 'IMG_0001.jpg' })).toBeVisible();

    // The panel is a column in the flow — the photo shrinks beside it — not a
    // sheet arriving from the edge.
    await page.keyboard.press('i');
    const panel = page.getByRole('complementary', { name: 'Information and comments' });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Camera');

    // Measured against the viewer's own frame rather than the viewport: a
    // desktop scrollbar sits outside one and inside the other, and the claim is
    // about the panel's place in the viewer.
    const stage = page.getByRole('dialog', { name: 'IMG_0001.jpg' });
    const frame = (await stage.boundingBox())!;
    const box = (await panel.boundingBox())!;
    expect(Math.round(box.y)).toBe(Math.round(frame.y));
    expect(Math.round(box.x + box.width)).toBe(Math.round(frame.x + frame.width));
    expect(box.width).toBeLessThan(frame.width / 2);

    // And the photo column keeps its arrow: as an overlay, the panel covered
    // "Next" and had to be closed for every photo.
    await expect(stage.getByRole('button', { name: 'Next (→)' })).toBeVisible();

    // `Escape` unwinds one layer at a time: the panel, then the viewer.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'IMG_0001.jpg' })).toBeHidden();
  });
});
