import { expect, test } from '@playwright/test';
import { COMMENTER } from '../fixtures/instance.js';
import { clearMail, verificationCode, waitForMail } from '../fixtures/mail.js';
import { openDayAlbum } from '../fixtures/session.js';

/**
 * Not the album's first photo, which `viewer.spec.ts` opens on an empty thread.
 * The specs share one instance, and a comment posted here is posted for good.
 */
const PHOTO = 'IMG_0001.jpg';

const MESSAGE = 'The light on the cliffs is exactly as promised.';

test('a comment is signed by an address the sender proves they own', async ({ page }) => {
  // The code cannot be read out of the database — `verification_codes.code_hash`
  // holds an HMAC — so intercepting the message is the only way through this flow.
  await clearMail();

  await openDayAlbum(page);
  await page.getByRole('button', { name: PHOTO }).click();

  const viewer = page.getByRole('dialog', { name: PHOTO });
  await expect(viewer).toBeVisible();
  // It opens bare; the chrome, and with it the sheet, is one tap away.
  await viewer.locator('img').last().click();

  const sheet = page.getByRole('dialog', { name: 'Information and comments' });
  await sheet.getByRole('tab', { name: /Comments/ }).click();
  await sheet.getByRole('button', { name: 'Sign in to comment' }).click();

  await sheet.getByRole('textbox', { name: 'Display name' }).fill(COMMENTER.name);
  await sheet.getByRole('textbox', { name: 'Email address' }).fill(COMMENTER.email);
  await sheet.getByRole('button', { name: 'Get a code' }).click();

  const code = verificationCode(await waitForMail(COMMENTER.email));
  await sheet.getByRole('textbox', { name: 'Verification code' }).fill(code);
  await sheet.getByRole('button', { name: 'Confirm' }).click();

  // The form only appears once the address is proven: that is the whole point of
  // the exchange, since the album credential may be shared by a household.
  const field = sheet.getByPlaceholder(`Comment as ${COMMENTER.name}…`);
  await expect(field).toBeVisible();
  await field.fill(MESSAGE);
  await sheet.getByRole('button', { name: 'Post' }).click();

  await expect(sheet.getByRole('tabpanel')).toContainText(MESSAGE);
  await expect(sheet.getByRole('tabpanel')).toContainText(COMMENTER.name);

  // And it reaches the one place somebody would stumble upon it: a conversation
  // nobody discovers is a conversation nobody has.
  //
  // `Escape` unwinds one layer at a time, so the panel goes first and the viewer
  // second — one press must not do both.
  await page.keyboard.press('Escape');
  await expect(sheet.getByRole('tabpanel')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();

  await page
    .getByRole('navigation', { name: 'Main sections' })
    .getByRole('button', {
      name: /Recent activity/,
    })
    .click();

  const feed = page.getByRole('dialog', { name: 'Recent activity' });
  await expect(feed).toBeVisible();
  await expect(feed).toContainText(MESSAGE);
});
