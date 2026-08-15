import { expect, test } from '@playwright/test';
import { ALBUMS } from '../fixtures/instance.js';
import { signIn } from '../fixtures/session.js';

/**
 * The reader's own settings, at `/settings`.
 *
 * Three claims. The language **left the account menu**, which is what made room
 * for the theme and for whatever follows it; each setting is a row showing its
 * value, opening onto the control — the shape administration already uses on a
 * phone, so a settings screen is read the same way wherever it is; and the theme
 * repaints the application, is remembered, and stops at the photo stage.
 *
 * The suite runs dark (`playwright.config.ts`), so the tests that are about the
 * other theme say so with `emulateMedia`.
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

  test('choosing the light theme repaints the application, and it stays chosen', async ({
    page,
  }) => {
    await page.goto('/settings');

    const row = page.getByRole('button', { name: /^Theme/ });
    // The device asks for dark here (`playwright.config.ts`) and nobody has
    // chosen, so that is what the row shows.
    await expect(row).toContainText('Dark');
    await row.click();
    await page.getByRole('combobox', { name: 'Theme' }).selectOption('light');

    // The class is the whole mechanism: `styles.css` binds `--color-ink-*` to
    // the ramp it names, and four hundred class names in the application follow
    // without one of them knowing a theme exists.
    await expect(page.locator('html')).toHaveClass('theme-light');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(245, 245, 247)');

    // And it survives the visit — which is the one claim `public/theme.js`
    // carries. If it had not run before the first paint, this would still pass
    // and the reader would have watched the page flash black on the way.
    await page.reload();
    await expect(page.locator('html')).toHaveClass('theme-light');
  });

  test('the device decides until somebody does, and then it stops deciding', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/settings');

    // Nothing stored, so the device answers.
    await expect(page.getByRole('button', { name: /^Theme/ })).toContainText('Light');

    // And the row says so rather than showing a value nobody chose as though
    // they had. The hint sits with the control, so opening the row is what
    // reveals it — on a phone the closed row is the value alone.
    await page.getByRole('button', { name: /^Theme/ }).click();
    await expect(page.getByText('Following your device until you choose here.')).toBeVisible();

    await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');

    // A phone that turns itself dark at night must not undo the decision every
    // evening: once made, the choice outranks the device, which still says light.
    await page.reload();
    await expect(page.locator('html')).toHaveClass('theme-dark');

    // And the hint goes with it: opened again, the row no longer claims to be
    // following anything.
    await page.getByRole('button', { name: /^Theme/ }).click();
    await expect(page.getByRole('combobox', { name: 'Theme' })).toBeVisible();
    await expect(page.getByText('Following your device until you choose here.')).toBeHidden();
  });

  test('the photo stage stays dark under a light application', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(`/album/${ALBUMS.day.id}`);

    await page.getByRole('button', { name: 'IMG_0000.jpg' }).click();
    const viewer = page.getByRole('dialog', { name: 'IMG_0000.jpg' });
    await expect(viewer).toBeVisible();

    // A photograph is judged against what surrounds it, so the ground it sits on
    // is the one surface that does not follow the reader (D260815d).
    await expect(viewer.locator('.theme-dark').first()).toHaveCSS(
      'background-color',
      'rgb(8, 8, 10)',
    );

    // Everything else in the viewer is chrome and turns with the application.
    // The sheet is the case that had to be got right: it renders through a
    // portal, outside the stage entirely, and a reader on a phone would
    // otherwise meet a dark panel where a desktop shows a light one. A tap is
    // what brings it back — the viewer opens bare on a touch screen.
    await viewer.locator('img').last().click();
    await expect(page.getByRole('dialog', { name: 'Information and comments' })).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    );
  });
});
