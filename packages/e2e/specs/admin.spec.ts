import { expect, test } from '@playwright/test';
import { signIn } from '../fixtures/session.js';

/** Every section, and the group each belongs to on a phone. */
const SECTIONS = [
  { group: 'Library', name: 'Albums' },
  { group: 'People', name: 'Accounts' },
  { group: 'People', name: 'Comments' },
  { group: 'This instance', name: 'Identity' },
  { group: 'This instance', name: 'Server' },
  { group: 'This instance', name: 'Visits' },
];

test.describe('Administration, on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto('/admin');
  });

  test('/admin is a list of sections rather than a row of tabs', async ({ page }) => {
    const sections = page.getByRole('navigation', { name: 'Administration sections' });
    await expect(sections).toBeVisible();

    for (const group of ['Library', 'People', 'This instance']) {
      await expect(sections.getByRole('heading', { name: group })).toBeVisible();
    }

    for (const section of SECTIONS) {
      const row = sections.getByRole('link', { name: section.name, exact: true });
      await expect(row).toBeVisible();
      // Six rows scrolling sideways two at a time is what this replaced, so the
      // rows have to be rows: full width, and tall enough to aim at.
      const box = (await row.boundingBox())!;
      expect(box.height, `"${section.name}" is ${box.height} px tall`).toBeGreaterThanOrEqual(48);
    }
  });

  test('a section is the level below, and the arrow returns to the list', async ({ page }) => {
    await page.getByRole('link', { name: 'Server', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/server$/);
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // A phone came from the list of sections, so that is where Back goes — the
    // reason `/admin` is a page rather than a redirect.
    await page.locator('header').first().getByRole('link', { name: 'Back to the albums' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('navigation', { name: 'Administration sections' })).toBeVisible();
  });

  test('a setting is a row showing its value, opening onto its field', async ({ page }) => {
    await page.goto('/admin/server');

    const row = page.getByRole('button', { name: /^Sync interval \(minutes\)/ });
    await expect(row).toBeVisible();
    // Closed, the row **is** the value: this is what makes seven settings seven
    // readable lines instead of a form to scroll.
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await expect(row).toContainText('0');

    await row.click();

    await expect(row).toHaveAttribute('aria-expanded', 'true');
    const field = page.getByRole('textbox', { name: 'Sync interval (minutes)' });
    await expect(field).toBeVisible();
    await expect(field).toHaveValue('0');
  });
});
