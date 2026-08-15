import { expect, test } from '@playwright/test';
import { PUBLISHED_VERSION, RUNNING_VERSION } from '../fixtures/instance.js';
import { signIn } from '../fixtures/session.js';

/**
 * What the gallery says it runs, and what it says about a newer release.
 *
 * Both claims are rendered text behind a network answer, which is exactly the
 * gap the unit tests cannot reach: `updates.ts` is covered by
 * `packages/server/test/updates.test.ts`, and none of it proves a line ever
 * reaches a screen. The feed here is the local fixture, so the version being
 * offered is known in advance (D260815).
 */
test.describe('What runs this gallery', () => {
  test('the account menu names the software, its version and where to read the changes', async ({
    page,
  }) => {
    await signIn(page);

    // On a phone the account menu is the Account tab, and it opens as a sheet.
    await page.getByRole('button', { name: 'Account' }).click();

    const menu = page.getByRole('dialog', { name: 'Account' });
    await expect(menu).toContainText(`Powered by Lukarn v${RUNNING_VERSION}`);

    const changelog = menu.getByRole('link', { name: 'Changelog' });
    await expect(changelog).toHaveAttribute(
      'href',
      'https://github.com/cr0cK/lukarn/blob/main/CHANGELOG.md',
    );
  });

  test('an administrator is offered the newer release, as a link and not a button', async ({
    page,
  }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Account' }).click();

    // A link, deliberately: nothing in the application replaces the image it
    // runs on, and a button here would suggest otherwise.
    const badge = page
      .getByRole('dialog', { name: 'Account' })
      .getByRole('link', { name: `Update to ${PUBLISHED_VERSION}` });
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute(
      'href',
      `https://example.test/releases/v${PUBLISHED_VERSION}`,
    );
  });

  test('administration carries the same line, in its Server section', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/server');

    const section = page.getByRole('heading', { name: 'Version', exact: true });
    await expect(section).toBeVisible();
    await expect(page.getByText(`Powered by Lukarn v${RUNNING_VERSION}`)).toBeVisible();
    await expect(page.getByRole('link', { name: `Update to ${PUBLISHED_VERSION}` })).toBeVisible();
  });
});
