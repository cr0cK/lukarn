import { expect, test } from '@playwright/test';
import { ALBUMS } from '../fixtures/instance.js';
import { signIn } from '../fixtures/session.js';

test.describe('Search, on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('the field opens where the button is, with the keyboard on it', async ({ page }) => {
    // The bar has no field to send focus to any more: that is the defect this
    // replaced — a control at the bottom whose effect appeared at the top, above
    // a keyboard that then covered the results.
    await expect(page.locator('header').first().getByRole('combobox')).toBeHidden();

    await page
      .getByRole('navigation', { name: 'Main sections' })
      .getByRole('button', {
        name: 'Search',
      })
      .click();

    const sheet = page.getByRole('dialog', { name: 'Search' });
    await expect(sheet).toBeVisible();

    const viewport = page.viewportSize()!;
    const box = (await sheet.boundingBox())!;
    expect(Math.round(box.y + box.height)).toBe(viewport.height);

    // Focused on arrival, which is what raises the keyboard: a sheet that opened
    // for one field and then asked for a tap on it would have been two gestures.
    const field = sheet.getByRole('combobox', { name: 'Search' });
    await expect(field).toBeFocused();
  });

  test('a result opens what it names, and takes the sheet with it', async ({ page }) => {
    await page
      .getByRole('navigation', { name: 'Main sections' })
      .getByRole('button', {
        name: 'Search',
      })
      .click();

    const sheet = page.getByRole('dialog', { name: 'Search' });
    await sheet.getByRole('combobox', { name: 'Search' }).fill('Holidays');

    const results = sheet.getByRole('listbox', { name: 'Search results' });
    const album = results.getByRole('group', { name: 'Albums' }).getByRole('option').first();
    await expect(album).toContainText(ALBUMS.day.title);

    await album.click();

    await expect(page).toHaveURL(new RegExp(`/album/${ALBUMS.day.id}$`));
    await expect(sheet).toBeHidden();
  });
});
