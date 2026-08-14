import { expect, test } from '@playwright/test';
import { ALBUMS } from '../fixtures/instance.js';
import { safeAreaRules } from '../fixtures/safe-area.js';
import { signIn } from '../fixtures/session.js';

/** The tabs, in the order a thumb finds them. */
const TABS = ['Albums', 'Search', 'Recent activity', 'Account'];

/**
 * What both iOS and Material call the smallest thing a fingertip can aim at, and
 * what the mobile rework claims to have moved every control up to.
 */
const FINGERTIP_PX = 48;

test.describe('The album list, on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('signing in opens the albums this account can see', async ({ page }) => {
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: ALBUMS.day.title })).toBeVisible();
    await expect(page.getByRole('heading', { name: ALBUMS.month.title })).toBeVisible();
  });

  test('four tabs carry everything that moves between pages', async ({ page }) => {
    const tabs = page.getByRole('navigation', { name: 'Main sections' });
    await expect(tabs).toBeVisible();

    // Four and no more: the bar is a fixed grid of quarters, and a fifth control
    // would be the moment the tabs stopped being aimable without looking.
    await expect(tabs.locator('a, button')).toHaveCount(TABS.length);
    for (const name of TABS) {
      await expect(tabs.getByRole(name === 'Albums' ? 'link' : 'button', { name })).toBeVisible();
    }

    // The tab bar says where you are, which is the whole reason it is not a menu.
    await expect(tabs.getByRole('link', { name: 'Albums' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('every tab is a fingertip-sized target', async ({ page }) => {
    const tabs = page.getByRole('navigation', { name: 'Main sections' });

    for (const name of TABS) {
      const control = tabs.getByRole(name === 'Albums' ? 'link' : 'button', { name });
      const box = await control.boundingBox();
      expect(box, `"${name}" has no box`).not.toBeNull();
      expect(box!.height, `"${name}" is ${box!.height} px tall`).toBeGreaterThanOrEqual(
        FINGERTIP_PX,
      );
      expect(box!.width, `"${name}" is ${box!.width} px wide`).toBeGreaterThanOrEqual(FINGERTIP_PX);
    }
  });

  test('both bars are positioned through the safe-area insets', async ({ page }) => {
    // No engine under Playwright has a notch, so an inset resolves to `0px` and a
    // computed style cannot tell a correct rule from a deleted one. The rule
    // itself is where the claim is falsifiable.
    const belowTheTabs = await safeAreaRules(
      page.getByRole('navigation', { name: 'Main sections' }),
    );
    expect(belowTheTabs.join('\n')).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom\)/);

    const aboveTheBar = await safeAreaRules(page.locator('header').first());
    expect(aboveTheBar.join('\n')).toMatch(/padding-top:\s*env\(safe-area-inset-top\)/);
  });
});
