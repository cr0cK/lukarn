import { createServer as createHttpServer } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import { SINK_PORT, SMTP_PORT } from './instance.js';

/**
 * A relay that keeps everything and delivers nothing.
 *
 * It is **required, not a convenience**. `commentsEnabled` is derived from
 * whether SMTP is configured, so without a relay the interface never offers the
 * comment form at all; and the verification code cannot be read out of the
 * database either — `verification_codes.code_hash` holds an HMAC, never the digits.
 * Intercepting the message is the only way to complete the identity flow.
 *
 * It speaks the four commands nodemailer sends and advertises no extension:
 * unadvertised, `PIPELINING` is never used, so commands arrive one at a time and
 * the parser stays a line splitter.
 *
 * What it captured is exposed over HTTP because the workers that need it are
 * other processes: a `waitForMessage` closed over an in-memory array would only
 * ever be readable from the process that owns the socket.
 */

interface Captured {
  from: string;
  to: string[];
  /** The `DATA` payload verbatim, headers included. */
  body: string;
  at: string;
}

const captured: Captured[] = [];

/** The address inside `MAIL FROM:<…>` or `RCPT TO:<…>`, folded for comparison. */
function address(line: string): string {
  return (line.match(/<([^>]*)>/)?.[1] ?? '').trim().toLowerCase();
}

createSocketServer((socket) => {
  let pending = '';
  let reading = false;
  let body = '';
  let envelope: { from: string; to: string[] } = { from: '', to: [] };

  const say = (line: string): void => {
    socket.write(`${line}\r\n`);
  };

  say('220 lukarn-e2e ESMTP sink');

  socket.on('data', (chunk) => {
    pending += chunk.toString('utf8');

    for (let end = pending.indexOf('\r\n'); end >= 0; end = pending.indexOf('\r\n')) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 2);

      if (reading) {
        if (line === '.') {
          reading = false;
          captured.push({ ...envelope, body, at: new Date().toISOString() });
          body = '';
          envelope = { from: '', to: [] };
          say('250 2.0.0 Ok: queued');
        } else {
          // Dot stuffing: a body line that starts with a dot arrives doubled,
          // and leaving it would corrupt the one line the specs read.
          body += `${line.startsWith('..') ? line.slice(1) : line}\n`;
        }
        continue;
      }

      switch (line.slice(0, 4).toUpperCase()) {
        case 'EHLO':
        case 'HELO':
          // One line, no extensions: everything this sink does not implement is
          // therefore something nodemailer will not try.
          say('250 lukarn-e2e');
          break;
        case 'MAIL':
          envelope.from = address(line);
          say('250 2.1.0 Ok');
          break;
        case 'RCPT':
          envelope.to.push(address(line));
          say('250 2.1.5 Ok');
          break;
        case 'DATA':
          reading = true;
          say('354 End data with <CR><LF>.<CR><LF>');
          break;
        case 'RSET':
          envelope = { from: '', to: [] };
          say('250 2.0.0 Ok');
          break;
        case 'QUIT':
          say('221 2.0.0 Bye');
          socket.end();
          break;
        default:
          say('250 2.0.0 Ok');
      }
    }
  });

  // A client that disappears mid-conversation is not an error worth reporting:
  // the mailer abandons a failed delivery by design, and an unhandled `error`
  // event would take this process down with it.
  socket.on('error', () => {});
}).listen(SMTP_PORT, '127.0.0.1');

createHttpServer((request, response) => {
  if (request.method === 'DELETE') {
    captured.length = 0;
    response.writeHead(204).end();
    return;
  }

  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(captured));
}).listen(SINK_PORT, '127.0.0.1');
