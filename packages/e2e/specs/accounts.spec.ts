import { expect, test, type Page } from '@playwright/test';
import { ALBUMS, BASE_URL } from '../fixtures/instance.js';
import { clearMail, verificationCode, waitForMail, type SinkMessage } from '../fixtures/mail.js';
import { signIn } from '../fixtures/session.js';

/**
 * An account that is a person, from the invitation to the second device.
 *
 * The four tests are **one journey**, in order: the account created here is the
 * account signed into two tests later, and the code read out of the sink is the code
 * typed after that. `serial` states that — a later test starting from a state an
 * earlier one failed to produce reports the same defect three times over.
 *
 * Nothing here waits for a delay to pass. The one-a-minute rule on sending is real,
 * and the flow simply never asks it to be broken: the invitation is taken up through
 * the link its own message carries, which mints nothing, and the sign-in code of the
 * last test is asked for after consumption has removed the invitation row that would
 * otherwise have been the address's most recent send.
 */
test.describe.configure({ mode: 'serial' });

/** The account an administrator opens, and the person who takes it up. */
const INVITED = {
  username: 'mamie',
  email: 'mamie@example.com',
  /** Nobody has said this yet: the acceptance step is where it is first given. */
  name: 'Mamie Jeanne',
};

/**
 * Not a photo another spec opens: `viewer.spec.ts` needs an empty thread on
 * `IMG_0000.jpg` and `comments.spec.ts` posts on `IMG_0001.jpg`. The specs share one
 * instance, and a comment posted here is posted for good.
 */
const PHOTO = 'IMG_0002.jpg';

const MESSAGE = 'Signed with my own name, and I never gave my address twice.';

/** What the messages name the instance by, and what the link in them points at. */
const HOST = new URL(BASE_URL).host;

/** The `Subject:` header as the mail client shows it in the list. */
function subjectOf(message: SinkMessage): string {
  const subject = message.body.match(/^Subject: (.*)$/m);
  if (!subject) throw new Error(`No subject in the message to ${message.to.join(', ')}`);
  return subject[1]!.trim();
}

/**
 * The message as a reader meets it, quoted-printable undone.
 *
 * Both halves are needed and for different reasons. Soft breaks, because a sentence
 * long enough to matter is long enough to be wrapped at 76 characters, and one broken
 * across two lines is one no assertion below would find. Escapes, because the very
 * character this file looks for in the invitation link is `=`, which travels as
 * `=3D` — a check for the address the reader is handed would otherwise be a check for
 * an encoding artefact.
 */
function readable(message: SinkMessage): string {
  const joined = message.body.replace(/=\r?\n/g, '');
  // Through bytes rather than code points: an em dash arrives as three of them, and
  // decoding each escape to a character of its own would produce three wrong ones.
  const decoded = joined.replace(/=([0-9A-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  return Buffer.from(decoded, 'latin1').toString('utf8');
}

/**
 * The album grouped by day, from the album list.
 *
 * `session.ts` has this attached to a password sign-in; both sessions below are
 * opened by a code instead, which is the whole subject of this file.
 */
async function openDayAlbum(page: Page): Promise<void> {
  await page.getByRole('heading', { name: ALBUMS.day.title }).click();

  await expect(page).toHaveURL(new RegExp(`/album/${ALBUMS.day.id}$`));
  await expect(page.locator('main img').first()).toBeVisible();
}

/** Opens the side panel on a photo, at its Comments tab. */
async function openComments(page: Page) {
  await page.getByRole('button', { name: PHOTO }).click();

  const viewer = page.getByRole('dialog', { name: PHOTO });
  await expect(viewer).toBeVisible();
  // It opens bare; the chrome, and with it the sheet, is one tap away.
  await viewer.locator('img').last().click();

  const sheet = page.getByRole('dialog', { name: 'Information and comments' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('tab', { name: /Comments/ }).click();
  return sheet;
}

test('an account is created by an address, and the list says so until its date', async ({
  page,
}) => {
  // From here on, everything the sink holds was sent by this file.
  await clearMail();

  await signIn(page);
  await page.goto('/admin/accounts');
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();

  await page.getByRole('button', { name: 'New account' }).click();

  // The credential is chosen before either field appears, so a form carrying both a
  // password and an address never exists — the request takes exactly one of them.
  await page.getByRole('radio', { name: 'With an invitation sent by email' }).check();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);

  await page.getByLabel('Username', { exact: true }).fill(INVITED.username);
  await page.getByLabel('Email address', { exact: true }).fill(INVITED.email);
  await page.getByRole('radio', { name: 'Every album' }).check();
  await page.getByRole('button', { name: 'Send the invitation' }).click();

  await expect(page.getByRole('status')).toContainText(
    `Account "${INVITED.username}" created and invited at ${INVITED.email}.`,
  );

  // The state column, which is the only thing that will ever tell an owner that an
  // invitation went nowhere. Today it says the opposite: one is open, until its date.
  await expect(page.getByText(INVITED.username, { exact: true })).toBeVisible();
  await expect(page.getByText('invited', { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      new RegExp(`^Invitation sent to ${INVITED.email}, open until \\d{1,2} \\w+ \\d{4}\\.$`),
    ),
  ).toBeVisible();

  // Re-inviting and deleting side by side on the row: an invitation nobody takes up
  // leaves an account, and both ways out of that are offered where it is read.
  await expect(
    page.getByRole('button', {
      name: `Send the invitation for account ${INVITED.username} again`,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Delete account ${INVITED.username}` }),
  ).toBeVisible();
});

test('the invitation says what the code grants, and carries the digits in the body alone', async () => {
  const invitation = await waitForMail(INVITED.email);
  const subject = subjectOf(invitation);
  const body = readable(invitation);
  const code = verificationCode(invitation);

  // D65: the subject names the instance and what arriving here means, never the
  // code. A code in a subject is read over a shoulder and stays in notification
  // history long after the message has been opened.
  expect(subject).toBe(`An account for you on ${HOST}`);
  expect(subject).not.toContain(code);
  expect(subject).not.toMatch(/\d{6}/);

  // The first line says what the code grants, which is the whole defence against the
  // one attack left standing: it is social, and consists of talking the holder of a
  // code into reading it out. `indexOf` rather than a line index because the sentence
  // has to come **before** the digits to be read before them.
  const intro = `An account has been opened for you on ${HOST}.`;
  expect(body).toContain(intro);
  expect(body).toContain('this address becomes the name your comments are signed with');
  expect(body.indexOf(intro)).toBeLessThan(body.indexOf(code));

  // Seven days, stated in the message as well as on the account list.
  expect(body).toContain('It lasts seven days and works once.');

  // The link carries no secret: it fills the address in and asks for the six digits,
  // which is the line between it and a magic link (D260819b).
  expect(body).toContain(`${BASE_URL}/login?email=${encodeURIComponent(INVITED.email)}`);
});

test('the code opens the account, once its holder has said what to call them', async ({ page }) => {
  const code = verificationCode(await waitForMail(INVITED.email));

  // The link the message carries. It lands on the code step **without** asking for a
  // code: the reader is holding the one that message was sent with, and minting
  // another would invalidate it.
  await page.goto(`/login?email=${encodeURIComponent(INVITED.email)}`);
  await expect(
    page.getByText(`Enter the 6-digit code from the message sent to ${INVITED.email}.`),
  ).toBeVisible();

  await page.getByRole('textbox', { name: 'Sign-in code' }).fill(code);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  // `commenters.display_name` is NOT NULL and the invitation holds an address and an
  // account, so nothing yet names this person. Asking is also the right side of D38:
  // somebody's name is theirs to give. The same code is then resubmitted — nothing
  // was consumed and no attempt was counted, or a correct code arriving fifth would
  // be exhausted by the time the name came back.
  await expect(page.getByText('This code is an invitation.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Display name' }).fill(INVITED.name);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page.getByRole('heading', { name: ALBUMS.day.title })).toBeVisible();

  await openDayAlbum(page);
  const sheet = await openComments(page);

  // The point of the release. Behind a shared key, writing a comment starts with an
  // address and a code, because the key says nothing about who is holding it. Here
  // the account **is** the person, so the form is simply there.
  await expect(sheet.getByRole('button', { name: 'Sign in to comment' })).toHaveCount(0);
  const field = sheet.getByPlaceholder(`Comment as ${INVITED.name}…`);
  await expect(field).toBeVisible();

  // And no offer to change it: the server refuses to move or forget the identity of a
  // bound account, and the way out is to sign out.
  await expect(sheet.getByRole('button', { name: 'Change address' })).toHaveCount(0);

  await field.fill(MESSAGE);
  await sheet.getByRole('button', { name: 'Post' }).click();

  await expect(sheet.getByRole('tabpanel')).toContainText(MESSAGE);
  await expect(sheet.getByRole('tabpanel')).toContainText(INVITED.name);

  await page.keyboard.press('Escape');
  await expect(sheet.getByRole('tabpanel')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: PHOTO })).toBeHidden();

  // The menu shows both, and showing both is the claim: the identifier opens the
  // albums, the address says who the comments above were signed by.
  await page
    .getByRole('navigation', { name: 'Main sections' })
    .getByRole('button', { name: 'Account', exact: true })
    .click();

  const menu = page.getByRole('dialog', { name: 'Account' });
  await expect(menu).toContainText(INVITED.username);
  await expect(menu).toContainText(INVITED.email);

  await menu.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('another browser context signs in with a code, and finds the same person', async ({
  page,
}) => {
  // A context of its own, holding none of the cookies the last one signed out of: a
  // second device is what this stands for, and the address is proven to it the only
  // way a bound account ever is.
  await clearMail();

  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(INVITED.email);
  await page.getByRole('button', { name: 'Email a code' }).click();

  // Conditional, and it has to stay conditional: `request` answers 202 for an address
  // this gallery knows and one it does not alike, so a screen announcing "sent" would
  // reopen in the interface the enumeration channel that answer exists to close.
  await expect(page.getByText(`If ${INVITED.email} is known here`)).toBeVisible();

  const signInMail = await waitForMail(INVITED.email);
  const body = readable(signInMail);

  // Greeted by the name given at acceptance, and told what the code grants before it
  // is read out to anybody. This is a sign-in rather than a second invitation: the
  // address opens an account now.
  expect(body).toContain(`Hello ${INVITED.name},`);
  expect(body).toContain(`This code signs in to ${HOST} as the person this address`);
  expect(body).not.toContain('An account has been opened for you');

  await page.getByRole('textbox', { name: 'Sign-in code' }).fill(verificationCode(signInMail));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  // Straight in, and arriving at the album list is what says so: a name asked for a
  // second time would have held this session on `/login`, which is where the previous
  // test spent a step. The identity is the account's now, written when the invitation
  // was consumed and reread on every request.
  await expect(page.getByRole('heading', { name: ALBUMS.day.title })).toBeVisible();

  await openDayAlbum(page);
  const sheet = await openComments(page);

  // The comment written from the other context is signed by the person this one just
  // opened as, and this one is offered the form without proving anything again.
  await expect(sheet.getByRole('tabpanel')).toContainText(MESSAGE);
  await expect(sheet.getByRole('tabpanel')).toContainText(INVITED.name);
  await expect(sheet.getByRole('button', { name: 'Sign in to comment' })).toHaveCount(0);
  await expect(sheet.getByPlaceholder(`Comment as ${INVITED.name}…`)).toBeVisible();
});
