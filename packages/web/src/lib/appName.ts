/**
 * Instance name as placed in the shell by the server.
 *
 * Read from the DOM rather than requested from the API: the name is present when
 * the first JavaScript byte runs, while a network call would show an empty — or
 * worse, incorrect — title until the response. This is also the only way to have
 * it on the sign-in screen, shown precisely when no authenticated route responds.
 *
 * `application-name` is the standard element for this; `shell.ts` fills it
 * server-side from `APP_NAME`.
 */
export function appName(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="application-name"]');
  return meta?.content?.trim() || 'Photos';
}
