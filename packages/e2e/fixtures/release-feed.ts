import { createServer } from 'node:http';
import { FEED_PORT, PUBLISHED_VERSION } from './instance.js';

/**
 * A release feed that always has one more version than this instance runs.
 *
 * Its own process rather than a path on the SMTP sink: the two fake different
 * parts of the outside world, and a fixture that answers both eventually grows a
 * router nobody wanted. Both are here for the same reason — a suite that called
 * the real GitHub would fail on a rate limit, and its assertion would change on
 * every release.
 *
 * It answers the two fields `updates.ts` reads, and nothing else: what a
 * self-hoster has to produce to point `UPDATE_CHECK_URL` at their own mirror is
 * exactly what is written below.
 */
createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      tag_name: `v${PUBLISHED_VERSION}`,
      html_url: `https://example.test/releases/v${PUBLISHED_VERSION}`,
    }),
  );
}).listen(FEED_PORT, '127.0.0.1');
