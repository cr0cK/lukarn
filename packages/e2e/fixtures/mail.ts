import { expect } from '@playwright/test';
import { SINK_URL } from './instance.js';

/** One message the sink kept, as `smtp-sink.ts` recorded it. */
export interface SinkMessage {
  from: string;
  to: string[];
  body: string;
  at: string;
}

/** Everything the instance has sent since the sink last started, or was emptied. */
export async function sentMail(): Promise<SinkMessage[]> {
  const response = await fetch(`${SINK_URL}/messages`);
  if (!response.ok) throw new Error(`The mail sink answered ${response.status}`);
  return (await response.json()) as SinkMessage[];
}

/** Forgets what was sent, so one spec cannot read another spec's message. */
export async function clearMail(): Promise<void> {
  await fetch(`${SINK_URL}/messages`, { method: 'DELETE' });
}

/**
 * The first message addressed to someone.
 *
 * Delivery is deliberately outside the request path — posting a comment answers
 * as soon as the row is written and the mailer sends afterwards — so the message
 * arrives some time after the click that caused it, and polling is what that
 * design leaves.
 */
export async function waitForMail(to: string): Promise<SinkMessage> {
  const recipient = to.toLowerCase();
  let arrived: SinkMessage | undefined;

  await expect
    .poll(
      async () => {
        arrived = (await sentMail()).find((message) => message.to.includes(recipient));
        return arrived !== undefined;
      },
      { message: `nothing reached ${to}`, timeout: 15_000 },
    )
    .toBe(true);

  return arrived!;
}

/**
 * The six digits out of a verification message.
 *
 * The code sits alone on its own line of the text part, which is what makes
 * this a line match rather than MIME parsing: quoted-printable only ever wraps
 * at 76 characters, so the one line that matters cannot be split. Its soft
 * breaks are still undone first, because a longer body one day might.
 */
export function verificationCode(message: SinkMessage): string {
  const code = message.body.replace(/=\r?\n/g, '').match(/^\s*(\d{6})\s*$/m);
  if (!code) throw new Error(`No verification code in the message to ${message.to.join(', ')}`);
  return code[1]!;
}
