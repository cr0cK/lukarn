import { expect, test } from '@playwright/test';
import { signIn } from '../fixtures/session.js';

/**
 * The reader's own settings, at `/settings`.
 *
 * Two claims. The language **left the account menu**, which is what made room
 * for the theme and for whatever follows it; and each setting is a row showing
 * its value, opening onto the control — the shape administration already uses on
 * a phone, so a settings screen is read the same way wherever it is.
 */
test.describe('Settings, on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('the account menu offers Settings, and no longer a language', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Main sections' }).getByLabel('Account').click();

    await expect(page.getByRole('menuitem', { name: 'Français' })).toBeHidden();
    await expect(page.getByRole('menuitem', { name: 'English' })).toBeHidden();

    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.locator('header').first()).toContainText('Settings');
  });

  test('a setting is a row showing its value, opening onto its list', async ({ page }) => {
    await page.goto('/settings');

    const row = page.getByRole('button', { name: /^Language/ });
    // Closed, the row **is** the value: the same promise administration makes,
    // and the reason the screen reads as a list rather than as a form.
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await expect(row).toContainText('English');

    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('combobox', { name: 'Language' })).toHaveValue('en');
  });

  test('choosing a language changes the interface and what the page says it is', async ({
    page,
  }) => {
    await page.goto('/settings');

    await page.getByRole('button', { name: /^Language/ }).click();
    await page.getByRole('combobox', { name: 'Language' }).selectOption('fr');

    await expect(page.locator('header').first()).toContainText('Réglages');
    // Not decoration: `lang` decides hyphenation and how the page is read aloud,
    // and `index.html` ships with `lang="en"`.
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

    // And it survives the visit, which is the whole point of remembering it.
    await page.reload();
    await expect(page.locator('header').first()).toContainText('Réglages');
  });

  test('the light theme is listed and refused, rather than absent', async ({ page }) => {
    await page.goto('/settings');

    const row = page.getByRole('button', { name: /^Theme/ });
    await expect(row).toContainText('Dark');
    await row.click();

    // Listed so that nobody asks for a setting they cannot see coming, refused
    // because `styles.css` has one palette and it is the dark one.
    const light = page.getByRole('combobox', { name: 'Theme' }).locator('option[value="light"]');
    await expect(light).toHaveText('Light (soon)');
    await expect(light).toBeDisabled();
  });
});
