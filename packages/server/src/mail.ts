import { createTransport } from 'nodemailer';
import { signAlbumUnsubscribeToken, signUnsubscribeToken } from './crypto.js';
import { parseMailAddress, type Env } from './env.js';

/**
 * Email notifications: SMTP transport, queuing and message composition.
 *
 * Two principles govern this module.
 *
 * **Delivery never blocks a request.** Posting a comment responds as soon as the
 * row is written; emails are sent afterwards through a serialised queue. A slow
 * or unreachable SMTP server must not be visible from the interface.
 *
 * **A delivery failure does not propagate.** It is logged and abandoned. An
 * unhandled rejection in a background task terminates the Node process: the whole
 * gallery would go down because an SMTP relay refused a connection — the same
 * precaution applies to disk-cache eviction.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Replaceable in tests, which naturally open no SMTP connection. */
export type Deliver = (message: MailMessage) => Promise<void>;

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  debug: (msg: string) => void;
}

export class Mailer {
  /**
   * Queue reduced to a chained promise. Deliveries run sequentially rather than
   * together: a typical SMTP relay limits concurrent connections, and a comment
   * never produces more than a few messages.
   */
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly deliver: Deliver | null,
    private readonly log: Logger,
  ) {}

  /**
   * Builds the transport from the environment. Returns an inert `Mailer` — rather
   * than `null` — when SMTP is not configured, so callers need not know whether
   * the instance sends email.
   */
  static fromEnv(env: Env, log: Logger): Mailer {
    if (!env.mail) {
      log.info(
        'SMTP not configured: neither comment notifications nor new-photo ' +
          'announcements will send anything.',
      );
      // Warn rather than prevent startup: disabling SMTP during maintenance is
      // legitimate, and a variable that is not itself invalid must not block the
      // instance in the process.
      if (env.mailReplyTo) {
        log.warn(
          'MAIL_REPLY_TO is set but no relay is configured: without SMTP_URL and ' +
            'MAIL_FROM nothing is sent at all, so the reply address serves no ' +
            'purpose.',
        );
      }
      return new Mailer(null, log);
    }

    // This guard targets the reflex of copying MAIL_FROM into MAIL_REPLY_TO. The
    // configuration appears complete, while replies still go exactly where they
    // could not be received.
    if (env.mailReplyTo && parseMailAddress(env.mailReplyTo) === parseMailAddress(env.mail.from)) {
      log.warn(
        `MAIL_REPLY_TO points at the same address as MAIL_FROM (${env.mailReplyTo}): ` +
          'the Reply-To header then redirects nothing. Put an address that really ' +
          'receives mail, or leave the variable empty.',
      );
    }

    // `replyTo` is only set when configured: an empty header is worse than no header,
    // as the email client otherwise falls back to the sender address — precisely the
    // one that receives nothing.
    const transport = createTransport(env.mail.smtpUrl, {
      from: env.mail.from,
      ...(env.mailReplyTo ? { replyTo: env.mailReplyTo } : {}),
    });
    return new Mailer(async (message) => {
      await transport.sendMail(message);
    }, log);
  }

  get enabled(): boolean {
    return this.deliver !== null;
  }

  /** Queues without waiting. The caller handles nothing, not even failure. */
  queue(message: MailMessage): void {
    if (!this.deliver) return;
    const deliver = this.deliver;

    this.tail = this.tail.then(async () => {
      try {
        await deliver(message);
        this.log.debug(`Notification sent to ${message.to}`);
      } catch (error) {
        // Logged and abandoned: no retry. A missed notification is an inconvenience;
        // a retry queue is a mechanism that requires monitoring — and the comment
        // itself has been safely recorded.
        this.log.warn(`Delivery to ${message.to} failed: ${(error as Error).message}`);
      }
    });
  }

  /** Waits for the queue to empty. Used for graceful shutdown and tests. */
  async drain(): Promise<void> {
    await this.tail;
  }
}

/** The comment data required to compose the notification. */
export interface CommentNotification {
  albumId: string;
  albumTitle: string;
  mediaId: string;
  mediaName: string | null;
  authorDisplayName: string;
  body: string;
}

/**
 * Who receives it, and why. `moderation` identifies the instance address set in
 * /admin: it has no commenter identity and therefore no unsubscribe link — remove
 * it by clearing the form field.
 */
export interface Recipient {
  email: string;
  reason: 'moderation' | 'reply';
}

/**
 * Composes the message for one recipient.
 *
 * The link points to the commented photo, not the home page: a notification email
 * is opened to see what it is about, and requiring three more clicks is enough to
 * make someone give up. The viewer opens on `?photo=<id>` (see `AlbumPage`), which
 * is exactly the URL a visitor would share.
 *
 * It also includes `&panel=comments`: this email announces a **message**, not a
 * photo. Landing on the image with the panel closed would leave the reader looking
 * for what the email referred to.
 */
export function buildCommentMail(
  notification: CommentNotification,
  recipient: Recipient,
  env: Env,
): MailMessage {
  const link = `${env.publicUrl}/album/${encodeURIComponent(notification.albumId)}?photo=${encodeURIComponent(notification.mediaId)}&panel=comments`;
  /**
   * This link disables `commenters.notify`, and therefore **everything** the gallery
   * sends: replies to comments as well as new-photo announcements. The wording says
   * so explicitly — "unsubscribe from these emails" would suggest that only comment
   * notifications are disabled, and the surprise would result in a spam report.
   *
   * To silence only one album, use the link in the new-photo email
   * (`buildAlbumUpdateMail`).
   */
  const unsubscribe =
    recipient.reason === 'reply'
      ? `${env.publicUrl}/api/comments/unsubscribe?u=${encodeURIComponent(recipient.email)}&t=${signUnsubscribeToken(recipient.email, env.sessionSecret)}`
      : null;

  // The subject also serves as the opening line in the body: readers opening from
  // a notification have already read this sentence, and repeating it verbatim tells
  // them they are in the right place.
  const subject =
    recipient.reason === 'reply'
      ? `${notification.authorDisplayName} replied to your comment`
      : `${notification.authorDisplayName} commented on a photo`;

  const where = notification.mediaName
    ? `${notification.mediaName} — ${notification.albumTitle}`
    : notification.albumTitle;

  const text = [
    `${subject}:`,
    '',
    quote(notification.body),
    '',
    where,
    link,
    ...(unsubscribe ? ['', '—', `Stop receiving any email from this gallery: ${unsubscribe}`] : []),
  ].join('\n');

  // Deliberately plain HTML: inline styles, no image, no remote font. Email clients
  // remove everything else, and an email that loads nothing from the server cannot
  // report that it has been read either.
  const html = `
    <div style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.5; color: #1a1a1a;">
      <p style="margin: 0 0 16px;">${escapeHtml(subject)}:</p>
      <blockquote style="margin: 0 0 16px; padding: 12px 16px; border-left: 3px solid #d4d4d4; background: #fafafa; white-space: pre-wrap;">${escapeHtml(notification.body)}</blockquote>
      <p style="margin: 0 0 8px; color: #666;">${escapeHtml(where)}</p>
      <p style="margin: 0 0 24px;"><a href="${escapeHtml(link)}" style="color: #2563eb;">View the photo</a></p>
      ${
        unsubscribe
          ? `<hr style="border: none; border-top: 1px solid #e5e5e5; margin: 0 0 12px;">
      <p style="margin: 0; font-size: 13px; color: #888;">
        <a href="${escapeHtml(unsubscribe)}" style="color: #888;">Stop receiving any email from this gallery</a>
      </p>`
          : ''
      }
    </div>
  `.trim();

  return { to: recipient.email, subject, text, html };
}

/** The album data required to announce its new items. */
export interface AlbumUpdateNotification {
  albumId: string;
  albumTitle: string;
  /** Media added to the index since the last announcement. */
  count: number;
}

/**
 * Announces an album's new photos to someone who has opened it.
 *
 * The count appears in the subject: it distinguishes "there is something new"
 * from "there is a lot that is new", and can be read without opening the message.
 * The unsubscribe link includes the album, not just the address — unsubscribing
 * from a busy gallery must not silence the others.
 */
export function buildAlbumUpdateMail(
  notification: AlbumUpdateNotification,
  email: string,
  env: Env,
): MailMessage {
  // `?order=desc`: the message announces what has just arrived, so the link must
  // lead there. The parameter only applies to this visit — it takes precedence over
  // the album's default order without overwriting the browser's memory (D99).
  const link = `${env.publicUrl}/album/${encodeURIComponent(notification.albumId)}?order=desc`;
  const unsubscribe =
    `${env.publicUrl}/api/subscriptions/unsubscribe` +
    `?u=${encodeURIComponent(email)}&a=${encodeURIComponent(notification.albumId)}` +
    `&t=${signAlbumUnsubscribeToken(email, notification.albumId, env.sessionSecret)}`;

  const plural = notification.count > 1;
  const subject = `${notification.count} new photo${plural ? 's' : ''} in ${notification.albumTitle}`;

  const text = [
    `${subject}.`,
    '',
    link,
    '',
    '—',
    `You are getting this because you have opened this album.`,
    `Stop hearing about new photos in "${notification.albumTitle}": ${unsubscribe}`,
  ].join('\n');

  // As restrained as comment notifications: inline styles and nothing to load from
  // the server — so nothing reports that the message has been read either.
  const html = `
    <div style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.5; color: #1a1a1a;">
      <p style="margin: 0 0 16px;">${escapeHtml(subject)}.</p>
      <p style="margin: 0 0 24px;"><a href="${escapeHtml(link)}" style="color: #2563eb;">View the album</a></p>
      <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 0 0 12px;">
      <p style="margin: 0; font-size: 13px; color: #888;">
        You are getting this because you have opened this album.
        <br>
        <a href="${escapeHtml(unsubscribe)}" style="color: #888;">Stop hearing about new photos in &quot;${escapeHtml(notification.albumTitle)}&quot;</a>
      </p>
    </div>
  `.trim();

  return { to: email, subject, text, html };
}

/** Plain-text quotation, prefixed with ">" according to email convention. */
function quote(body: string): string {
  return body
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/**
 * A comment body is entered by a visitor: it passes through this function before
 * entering the email HTML, otherwise a message containing a tag would execute in
 * the recipient's email client.
 */
/**
 * HTML escaping for text composed by the application — album names, author names
 * and comment bodies.
 *
 * Exported because unsubscribe confirmation pages need it too: two copies of a
 * security function eventually diverge, and the one that is forgotten allows an
 * injection through.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Address verification code.
 *
 * The subject names the instance, not the code (D65): the host explains why the
 * message arrived, whereas a code in the subject can be read over someone's
 * shoulder and remains visible in notification history.
 *
 * No clickable link, not even to the gallery: a code is copied into the tab left
 * open, whereas a link would open a second session in another browser. The host is
 * therefore only mentioned as text.
 *
 * The code is displayed as one unit, never grouped as "123 456": `verify` requires
 * six characters after `trim()`, and pasting it with the middle space would be
 * rejected. Visual spacing uses `letter-spacing`, which does not affect the copied
 * string.
 */
export function buildVerificationMail(
  email: string,
  displayName: string,
  code: string,
  env: Env,
): MailMessage {
  const host = new URL(env.publicUrl).host;
  const subject = `Verification code — ${host}`;

  const text = [
    `Hello ${displayName},`,
    '',
    `You have just given this address on ${host} to sign your comments.`,
    'Here is your code:',
    '',
    code,
    '',
    'Type it into the page you left open. It lasts fifteen minutes and works',
    'once.',
    '',
    '—',
    'If you did not ask for this, ignore the message: until the code is entered,',
    'nothing is tied to this address. Do not pass it on to anyone.',
  ].join('\n');

  const html = `
    <div style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.5; color: #1a1a1a;">
      <p style="margin: 0 0 16px;">Hello ${escapeHtml(displayName)},</p>
      <p style="margin: 0 0 8px;">
        You have just given this address on ${escapeHtml(host)} to sign your comments.
        Here is your code:
      </p>
      <p style="margin: 0 0 16px; font-size: 28px; font-weight: 600; letter-spacing: 0.15em;">${escapeHtml(code)}</p>
      <p style="margin: 0 0 24px; color: #666;">
        Type it into the page you left open. It lasts fifteen minutes and works
        once.
      </p>
      <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 0 0 12px;">
      <p style="margin: 0; font-size: 13px; color: #888;">
        If you did not ask for this, ignore the message: until the code is entered,
        nothing is tied to this address. Do not pass it on to anyone.
      </p>
    </div>
  `.trim();

  return { to: email, subject, text, html };
}
