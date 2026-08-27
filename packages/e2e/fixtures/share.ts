import { expect, type APIRequestContext } from '@playwright/test';
import { ADMIN, ALBUMS } from './instance.js';

/**
 * Issues a share link and returns the address it produced.
 *
 * It goes through the API on a **request context**, never through the browser, and
 * that is the point: making a link requires an administrator by construction, while
 * every claim about what a link opens has to be made by a page that has never held a
 * session. Putting the administrator's cookie in the page context would prove
 * nothing about the stranger the page is built for.
 */
export async function issueShare(
  request: APIRequestContext,
  options: { mediaId?: string; label?: string } = {},
): Promise<string> {
  await asAdmin(request);

  const created = await request.post('/api/admin/shares', {
    data: {
      albumId: ALBUMS.day.id,
      mediaId: options.mediaId ?? null,
      label: options.label ?? null,
    },
  });
  expect(created.status(), await created.text()).toBe(201);

  const { token } = (await created.json()) as { token: string };
  return `/s/${token}`;
}

/**
 * Signs the **request context** in, never a page.
 *
 * Idempotent: a second login on the same context replaces one cookie with another,
 * which costs a request and keeps each helper able to stand alone.
 */
async function asAdmin(request: APIRequestContext): Promise<void> {
  const response = await request.post('/api/auth/login', {
    data: { username: ADMIN.username, password: ADMIN.password },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

/** Revokes a link by its address, using the same request context that issued it. */
export async function revokeShare(request: APIRequestContext, address: string): Promise<void> {
  const token = address.slice('/s/'.length);
  const response = await request.post(`/api/admin/shares/${token}/revoke`);
  expect(response.ok(), await response.text()).toBeTruthy();
}

/** The first photograph of the day album, as the grid serves it. */
export async function firstPhotoId(request: APIRequestContext): Promise<string> {
  await asAdmin(request);
  const response = await request.get(`/api/albums/${ALBUMS.day.id}/items?limit=1`);
  expect(response.ok(), await response.text()).toBeTruthy();
  const page = (await response.json()) as { items: { id: string }[] };
  return page.items[0]!.id;
}
