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

/**
 * Where the albums live, listed and administered.
 *
 * This fixture has no Google credentials, which is the state that matters here:
 * an instance whose storage is declared and not connected is what an operator
 * sees on their first afternoon, and every message on this screen exists to say
 * what to do about it.
 */
test.describe('Storage, on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/server');
  });

  test('the instance lists what it reads, and how many albums read it', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Storage' })).toBeVisible();

    // The connection migration 17 creates for every instance. This one carries
    // no Google credentials, so the row says the one thing that would otherwise
    // be looked for in the logs.
    await expect(
      page.getByText('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect Google Drive' })).toBeDisabled();
    // Both fixture albums point at it, which is what makes it undeletable.
    await expect(page.getByText('2 albums read it.')).toBeVisible();
  });

  test('a second storage can be added, and deleting an occupied one is refused', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Add a storage' }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill('Drive professionnel');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    // A second Drive is exactly what the single-row `oauth_token` table forbade.
    await expect(
      page.getByRole('button', { name: 'Delete the storage Drive professionnel' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Delete the storage Google Drive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();

    // Removing it would leave every thumbnail of those two albums failing, with
    // nothing on the screen explaining why.
    await expect(page.getByRole('status')).toContainText('still holds albums');
  });

  test('an album names the storage it reads once there is a choice', async ({ page }) => {
    // Its own connection: this instance is shared by every test in the file, and
    // adding one that another test already added would only prove the conflict.
    await page.getByRole('button', { name: 'Add a storage' }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill('Archives');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Delete the storage Archives' })).toBeVisible();

    await page.goto('/admin/albums');
    await page
      .getByRole('button', { name: /^Edit album/ })
      .first()
      .click();

    // Offered only now: with one storage the select would decide nothing. On a
    // phone it is a row showing its value, like every other closed list here.
    const row = page.getByRole('button', { name: /^Storage/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Google Drive');

    await row.click();
    await expect(page.getByLabel('Storage', { exact: true })).toHaveValue('drive');
  });
});
