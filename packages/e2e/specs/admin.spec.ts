import { expect, test } from '@playwright/test';
import { LOCAL_CONNECTION } from '../fixtures/instance.js';
import { signIn } from '../fixtures/session.js';

/** Every section, and the group each belongs to on a phone. */
const SECTIONS = [
  { group: 'Library', name: 'Storage' },
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
      // Anchored rather than exact: Comments carries the unread count inside its
      // name — "Comments 1" — as soon as a spec running before this file has left a
      // message behind, which `accounts.spec.ts` does. That badge is the other
      // file's claim; the claim here is that each section is a row of its own.
      const row = sections.getByRole('link', { name: new RegExp(`^${section.name}`) });
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
 * Storage is a section, and Server is about the machine.
 *
 * The screen answering "where do my photos come from?" used to sit inside Server,
 * between the sync interval and the cache budget. These claims are what moving it
 * has to keep true: it is reachable as a section of its own, it opens the list
 * rather than a settings form, and nothing about storage was left behind.
 */
test.describe('Storage is a section of its own', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('it opens from /admin, at the head of the library group', async ({ page }) => {
    await page.goto('/admin');

    const sections = page.getByRole('navigation', { name: 'Administration sections' });
    await sections.getByRole('link', { name: 'Storage', exact: true }).click();

    await expect(page).toHaveURL(/\/admin\/storage$/);
    await expect(page.getByRole('heading', { name: 'Storage' })).toBeVisible();
    // The list, not a form: this section answers what the instance reads before
    // it offers to change it.
    await expect(page.getByRole('button', { name: 'Add a storage' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Delete the storage/ }).first()).toBeVisible();
  });

  test('Server keeps the machine and nothing about storage', async ({ page }) => {
    await page.goto('/admin/server');

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Version', exact: true })).toBeVisible();

    // Not a heading that moved out of sight but the controls themselves: an
    // unmoved section would still answer here.
    await expect(page.getByRole('button', { name: 'Add a storage' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Delete the storage/ })).toHaveCount(0);
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
    await page.goto('/admin/storage');
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

    // A name is the only thing asked for. The identifier used to be a field beside
    // it, warning it could never change — about a value nothing outside this screen
    // ever names (D260816h).
    await expect(page.getByRole('textbox', { name: 'Identifier' })).toHaveCount(0);

    await page.getByRole('textbox', { name: 'Name' }).fill('Drive professionnel');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    // A second Drive is exactly what the single-row `oauth_token` table forbade.
    await expect(
      page.getByRole('button', { name: 'Delete the storage Drive professionnel' }),
    ).toBeVisible();

    // Derived from the name and still shown: this is the word a log line uses for
    // the connection, and reading one is what it stays legible for.
    await expect(page.locator('main')).toContainText('drive-professionnel');

    await page.getByRole('button', { name: 'Delete the storage Google Drive' }).click();

    // Removing it would leave every thumbnail of those two albums failing, with
    // nothing on the screen explaining why. The dialog says which albums and
    // refuses to send: the server's 409 is the boundary, not the way to find out.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('2 albums still read this storage');
    await expect(dialog.getByRole('button', { name: 'Delete' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  test('a connection is corrected in place, keeping the key already stored', async ({ page }) => {
    await page.getByRole('button', { name: 'Add a storage' }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill('Bucket a corriger');
    await page.getByRole('button', { name: /^Kind/ }).click();
    await page.getByLabel('Kind', { exact: true }).selectOption('s3');
    await page.getByRole('textbox', { name: 'Endpoint' }).fill('https://s3.exemple.invalid');
    await page.getByRole('textbox', { name: 'Bucket' }).fill('famille');
    await page.getByRole('textbox', { name: 'Access key' }).fill('AKIAIOSFODNN7EXAMPLE');
    await page.getByLabel('Secret key').fill('wJalrXUtnFEMI');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    await page.getByRole('button', { name: 'Edit the storage Bucket a corriger' }).click();

    // Settings come back, so the closed rows **are** the stored values — which is the
    // whole point: there is something to correct rather than a blank form.
    const endpoint = page.getByRole('button', { name: /^Endpoint/ });
    await expect(endpoint).toContainText('https://s3.exemple.invalid');
    await expect(page.getByRole('button', { name: /^Bucket/ })).toContainText('famille');
    // The kind and the identifier are stated and cannot be edited: every album
    // reading this connection points at both.
    await expect(page.getByRole('button', { name: /^Kind/ })).toContainText('bucket-a-corriger');

    // The key does not come back, because the server never sends a secret. Its row is
    // therefore open on an empty field, and empty means "keep the stored one".
    await expect(page.getByRole('textbox', { name: 'Access key' })).toHaveValue('');

    await endpoint.click();
    await page.getByRole('textbox', { name: 'Endpoint' }).fill('https://s3.exemple.test');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    // Saved without a word about the missing key: retyping one to change an address
    // is what deleting and recreating the connection used to cost.
    await expect(page.getByRole('status')).toContainText('saved');
    await page.getByRole('button', { name: 'Edit the storage Bucket a corriger' }).click();
    await expect(page.getByRole('button', { name: /^Endpoint/ })).toContainText(
      'https://s3.exemple.test',
    );
  });

  test('a bucket asks for what opens it, and refuses to be created half-typed', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Add a storage' }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill('Photos froides');

    // The kind is a closed row here: a list always has a value to read, so it is
    // the one control on this form that has to be opened before it can be used.
    await page.getByRole('button', { name: /^Kind/ }).click();
    await page.getByLabel('Kind', { exact: true }).selectOption({ label: 'S3-compatible bucket' });

    // A bucket is authorised by what is typed here and nowhere else: there is no
    // consent screen to come back from, so the fields appear with the kind.
    const endpoint = page.getByRole('textbox', { name: 'Endpoint' });
    await expect(endpoint).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Address the bucket by path/ })).toBeVisible();

    // Half a bucket says which halves are missing. Creating it instead would
    // produce a connection whose albums stay empty with nothing explaining why.
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Enter the name of the bucket.')).toBeVisible();
    await expect(page.getByText('Enter the secret key.')).toBeVisible();

    await endpoint.fill('https://s3.example.com');
    await page.getByRole('textbox', { name: 'Bucket' }).fill('famille');
    await page.getByRole('textbox', { name: 'Access key' }).fill('AKIAIOSFODNN7EXAMPLE');
    await page.getByLabel('Secret key').fill('wJalrXUtnFEMI');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(
      page.getByRole('button', { name: 'Delete the storage Photos froides' }),
    ).toBeVisible();
  });

  test('an album on a path-addressed storage needs no folder of its own', async ({ page }) => {
    await page.goto('/admin/albums');
    await page.getByRole('button', { name: 'New album' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Tout le disque');

    // Drive names a folder by identifier, so there is no empty one and the field
    // stays required — which is what makes the other answer meaningful.
    await page.getByRole('button', { name: 'Create the album' }).click();
    await expect(page.getByText('Enter the Drive folder.')).toBeVisible();

    await page.getByRole('button', { name: /^Storage/ }).click();
    await page.getByLabel('Storage', { exact: true }).selectOption(LOCAL_CONNECTION.id);

    // Empty now means the whole of what that connection declares: a bucket or a
    // folder holding one gallery has no subfolder to invent.
    await page.getByRole('button', { name: 'Create the album' }).click();
    await expect(page.getByRole('button', { name: /^Edit album Tout le disque/ })).toBeVisible();
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

  test('a WebDAV storage asks for its address and password before it is created', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Add a storage' }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill('Nextcloud maison');

    // The kind decides which fields exist at all: a Drive is authorised by a
    // button afterwards, a WebDAV server by what is typed here and nowhere else.
    await page.getByRole('button', { name: /^Kind/ }).click();
    await page.getByLabel('Kind', { exact: true }).selectOption('webdav');

    const address = page.getByRole('textbox', { name: 'WebDAV address' });
    await expect(address).toBeVisible();

    // Submitting without them says what is missing. Creating the connection
    // anyway would move the failure to the first synchronisation, where it reads
    // as "refused" and names nothing.
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Enter the WebDAV address, starting with')).toBeVisible();

    await address.fill('https://cloud.example.com/remote.php/dav/files/alexis');
    await page.getByRole('textbox', { name: 'Username' }).fill('alexis');
    await page.getByLabel('App password').fill('app-password');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(
      page.getByRole('button', { name: 'Delete the storage Nextcloud maison' }),
    ).toBeVisible();
  });
});
