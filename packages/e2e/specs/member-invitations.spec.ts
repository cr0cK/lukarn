import { expect, test } from '@playwright/test';
import { openDb } from '../../server/src/db.js';
import { VerificationCodeRepo } from '../../server/src/verification-codes.js';
import { ALBUMS, BASE_URL, DATA_DIR, instanceEnv } from '../fixtures/instance.js';
import { clearMail, waitForMail, type SinkMessage } from '../fixtures/mail.js';
import { signIn } from '../fixtures/session.js';

test.describe.configure({ mode: 'serial' });

const PHOTO = 'IMG_0003.jpg';

function readable(message: SinkMessage): string {
  const joined = message.body.replace(/=\r?\n/g, '');
  const decoded = joined.replace(/=([0-9A-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  return Buffer.from(decoded, 'latin1').toString('utf8');
}

test('admin invites member with SMTP, recipient follows magic link and accesses assigned albums', async ({
  page,
  browser,
}) => {
  await clearMail();
  await signIn(page);
  await page.goto('/admin/accounts');

  // Open "Invite a member" modal
  await page.getByRole('button', { name: 'Invite a member' }).click();
  const modal = page.getByRole('dialog', { name: 'Invite a member to the gallery' });
  await expect(modal).toBeVisible();

  // Fill in email and display name
  await modal.getByLabel('Email address').fill('mamie.suzy@example.com');
  await modal.getByLabel('First name or display name (optional)').fill('Mamie Suzy');

  // Clear all albums then select only the day album
  await modal.getByRole('button', { name: 'Clear all' }).click();
  await modal.getByText(ALBUMS.day.title).click();

  // Submit invitation
  await modal.getByRole('button', { name: 'Invite', exact: true }).click();

  // Toast confirmation
  await expect(page.getByRole('status')).toContainText('Invitation sent by email');

  // Check account row in admin list
  await expect(page.getByText('mamie.suzy', { exact: true })).toBeVisible();
  await expect(page.getByText('invited', { exact: true })).toBeVisible();

  // Intercept email
  const invitation = await waitForMail('mamie.suzy@example.com');
  const body = readable(invitation);
  const match = body.match(/\/invite\/([a-zA-Z0-9_-]+)/);
  expect(match).not.toBeNull();
  const token = match![1]!;

  // Fresh browser context for recipient
  const recipientContext = await browser.newContext();
  const recipientPage = await recipientContext.newPage();

  // Recipient opens magic link
  await recipientPage.goto(`/invite/${token}`);

  // Since display name was provided, recipient lands directly on gallery home
  await expect(recipientPage).toHaveURL(new RegExp(`${BASE_URL}/?$`));

  // Boundary verification: assigned album is present, unassigned is absent
  await expect(recipientPage.getByRole('heading', { name: ALBUMS.day.title })).toBeVisible();
  await expect(recipientPage.getByRole('heading', { name: ALBUMS.month.title })).toHaveCount(0);

  // Open photo comments
  await recipientPage.getByRole('heading', { name: ALBUMS.day.title }).click();
  await recipientPage.getByRole('button', { name: PHOTO }).click();
  const viewer = recipientPage.getByRole('dialog', { name: PHOTO });
  await expect(viewer).toBeVisible();
  await viewer.locator('img').last().click();

  const sheet = recipientPage.getByRole('dialog', { name: 'Information and comments' });
  await sheet.getByRole('tab', { name: /Comments/ }).click();

  // Ready to comment directly as Mamie Suzy without asking for email or password
  await expect(sheet.getByPlaceholder('Comment as Mamie Suzy…')).toBeVisible();

  await recipientContext.close();
});

test('admin creates invitation with offline link copy mode and recipient onboards with name prompt', async ({
  page,
  browser,
}) => {
  await signIn(page);
  await page.goto('/admin/accounts');

  const db = openDb(DATA_DIR);
  // Insert user with no password hash for 'cousin' first to satisfy foreign key
  db.prepare(
    `
    INSERT OR REPLACE INTO users (username, password_hash, admin, all_albums, created_at, updated_at)
    VALUES ('cousin', 'NO_PASSWORD', 0, 0, datetime('now'), datetime('now'))
  `,
  ).run();
  db.prepare(
    `
    INSERT OR IGNORE INTO user_albums (username, album_id) VALUES ('cousin', ?)
  `,
  ).run(ALBUMS.day.id);

  // Mint a real invite token in the DB to test offline onboarding
  const codes = new VerificationCodeRepo(db, instanceEnv().SESSION_SECRET!);
  const minted = codes.mintInviteToken('cousin@example.com', 'cousin', { bypassRateLimit: true });
  if ('failure' in minted) throw new Error('Failed to mint token');
  const offlineToken = minted.token;
  const offlineUrl = `${BASE_URL}/invite/${offlineToken}`;
  db.close();

  // Mock the POST endpoint response with inviteUrl to simulate mailer disabled
  await page.route('**/api/admin/users/invite', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          username: 'cousin',
          admin: false,
          allAlbums: false,
          albums: [ALBUMS.day.id],
          state: 'invited',
          invitation: {
            email: 'cousin@example.com',
            expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          },
        },
        inviteUrl: offlineUrl,
      }),
    });
  });

  // Open "Invite a member" modal
  await page.getByRole('button', { name: 'Invite a member' }).click();
  const modal = page.getByRole('dialog', { name: 'Invite a member to the gallery' });
  await modal.getByLabel('Email address').fill('cousin@example.com');
  await modal.getByRole('button', { name: 'Invite', exact: true }).click();

  // Verify offline link modal appears
  const offlineModal = page.getByRole('dialog', { name: 'Invitation link generated' });
  await expect(offlineModal).toBeVisible();
  await expect(offlineModal.locator('#invite-link-input')).toHaveValue(offlineUrl);

  // Copy link
  await offlineModal.getByRole('button', { name: 'Copy link' }).click();
  await expect(offlineModal.getByRole('button', { name: 'Copied' })).toBeVisible();
  await offlineModal.getByRole('button', { name: 'Close' }).click();

  // Fresh browser context to open copied link
  const offlineContext = await browser.newContext();
  const offlinePage = await offlineContext.newPage();
  await offlinePage.goto(offlineUrl);

  // Prompted for display name since none was set
  await expect(offlinePage.getByText('Welcome to the gallery!')).toBeVisible();
  await expect(
    offlinePage.getByText('How would you like your name to appear under comments?'),
  ).toBeVisible();

  await offlinePage.getByPlaceholder('Your name or nickname').fill('Cousin Pierre');
  await offlinePage.getByRole('button', { name: 'Access the gallery' }).click();

  // Successfully lands on home page with access to assigned album
  await expect(offlinePage).toHaveURL(new RegExp(`${BASE_URL}/?$`));
  await expect(offlinePage.getByRole('heading', { name: ALBUMS.day.title })).toBeVisible();

  await offlineContext.close();
});

test('album update notifications respect album permissions and auto-subscriptions', async () => {
  const db = openDb(DATA_DIR);
  // Verify mamie-suzy has an auto subscription in album_subscriptions for ALBUMS.day.id
  const commenter = db
    .prepare('SELECT id FROM commenters WHERE email = ?')
    .get('mamie.suzy@example.com') as { id: number } | undefined;
  expect(commenter).toBeDefined();

  const sub = db
    .prepare('SELECT state FROM album_subscriptions WHERE commenter_id = ? AND album_id = ?')
    .get(commenter!.id, ALBUMS.day.id) as { state: string } | undefined;
  expect(sub).toBeDefined();
  expect(sub!.state).toBe('auto');

  // Verify subscribers query returns mamie.suzy for ALBUMS.day.id
  const subRows = db
    .prepare(
      `
    SELECT c.email FROM album_subscriptions s
    JOIN commenters c ON c.id = s.commenter_id
    WHERE s.album_id = ? AND s.state = 'auto'
      AND c.verified_at IS NOT NULL AND c.notify = 1
      AND (
        NOT EXISTS (SELECT 1 FROM users u WHERE u.commenter_id = c.id)
        OR EXISTS (
          SELECT 1 FROM users u
          WHERE u.commenter_id = c.id
            AND (u.all_albums = 1 OR EXISTS (
              SELECT 1 FROM user_albums ua WHERE ua.username = u.username AND ua.album_id = s.album_id
            ))
        )
      )
  `,
    )
    .all(ALBUMS.day.id) as { email: string }[];
  expect(subRows.some((r) => r.email === 'mamie.suzy@example.com')).toBe(true);

  // And for ALBUMS.month.id (which she does NOT have access to):
  const unassignedRows = db
    .prepare(
      `
    SELECT c.email FROM album_subscriptions s
    JOIN commenters c ON c.id = s.commenter_id
    WHERE s.album_id = ? AND s.state = 'auto'
      AND c.verified_at IS NOT NULL AND c.notify = 1
      AND (
        NOT EXISTS (SELECT 1 FROM users u WHERE u.commenter_id = c.id)
        OR EXISTS (
          SELECT 1 FROM users u
          WHERE u.commenter_id = c.id
            AND (u.all_albums = 1 OR EXISTS (
              SELECT 1 FROM user_albums ua WHERE ua.username = u.username AND ua.album_id = s.album_id
            ))
        )
      )
  `,
    )
    .all(ALBUMS.month.id) as { email: string }[];
  expect(unassignedRows.some((r) => r.email === 'mamie.suzy@example.com')).toBe(false);

  db.close();
});

test('invalid or already consumed invitation tokens show friendly error screen', async ({
  page,
}) => {
  // Unknown / invalid token
  await page.goto('/invite/completely-invalid-or-unknown-token');
  await expect(page.getByText('This invitation link is invalid or has expired.')).toBeVisible();
  await expect(
    page.getByText('Please ask the administrator for a new invitation link.'),
  ).toBeVisible();

  // Click "Go to sign in" button
  await page.getByRole('button', { name: 'Go to sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`${BASE_URL}/login$`));
});
