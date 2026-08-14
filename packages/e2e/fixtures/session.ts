import { expect, type Page } from '@playwright/test';
import { ADMIN, ALBUMS } from './instance.js';

/**
 * Signs in and waits for the album list.
 *
 * Every spec starts from a fresh context, so every spec signs in. That is a
 * deliberate cost: a shared `storageState` would make the sign-in screen — the
 * one page an unauthenticated visitor ever reaches — untested everywhere except
 * in the one spec that asserts it.
 *
 * `exact` on both fields: the password field sits beside a "Show the password"
 * button, whose accessible name contains "password" and would otherwise match.
 */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username', { exact: true }).fill(ADMIN.username);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  // Exact, because "Sign in with a phone" sits right below it.
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page.getByRole('heading', { name: ALBUMS.day.title })).toBeVisible();
}

/** Signs in, then opens the album grouped by day — where notes and places show. */
export async function openDayAlbum(page: Page): Promise<void> {
  await signIn(page);
  await page.getByRole('heading', { name: ALBUMS.day.title }).click();

  await expect(page).toHaveURL(new RegExp(`/album/${ALBUMS.day.id}$`));
  // The grid draws from measurements the index already holds, so the first tile
  // exists before any image arrives: wait for the image, not for the layout.
  await expect(page.locator('main img').first()).toBeVisible();
  // And wait for the **album** as well as its items: they are two requests, and
  // the one that resolves the reading order sends the page back to the top when
  // it lands. A test that scrolled before it arrived would be scrolled back.
  await expect(page.locator('header').first()).toContainText('items');
}
