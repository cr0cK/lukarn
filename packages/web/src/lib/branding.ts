import { derivePalette, paletteProperties } from '@lukarn/shared';
import { useSyncExternalStore } from 'react';
import { brandingUrl } from '../api/client';
import { appName } from './appName';

/**
 * Applying a changed identity to the page already open.
 *
 * The server writes the name and the palette into the shell and the browser reads
 * the logo from `/api/branding/logo` — all correct on load, and all stale the
 * moment an administrator saves. Reloading would work; it would also throw away
 * the form, the notice that says the save succeeded, and any sense that the
 * colour picker did anything.
 *
 * So the three changes are pushed onto the live document instead. Nothing here is
 * a source of truth: a reload produces exactly the same result from the server.
 */

/**
 * Writes a primary colour, and the palette derived from it, onto `<html>`.
 *
 * The same custom properties `shell.ts` fills, computed by the same shared
 * function — so the preview cannot disagree with what a reload would show.
 */
export function applyPalette(primary: string): void {
  const style = document.documentElement.style;
  for (const [property, value] of Object.entries(paletteProperties(derivePalette(primary)))) {
    style.setProperty(property, value);
  }
}

/**
 * Discriminator appended to logo URLs. Zero until something changes, so the
 * usual page requests the plain URL and shares one cache entry with the favicon.
 */
let version = 0;
const listeners = new Set<() => void>();

/**
 * Declares the logo replaced, and reloads what already displays it.
 *
 * The route answers `no-cache`, which makes the browser revalidate — on the next
 * request. An `<img>` on screen makes none, so the version in the URL is what
 * makes it one. The tab icon is updated by hand for the same reason: it is not
 * part of any React tree.
 */
export function logoChanged(): void {
  version += 1;
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) icon.href = brandingUrl.logo(version);
  for (const listener of listeners) listener();
}

/**
 * Rewrites the instance name in the three places the shell carries it.
 *
 * The DOM is the source every reader uses — `appName()` reads it rather than
 * calling the API, because the sign-in screen must show a name while no
 * authenticated route would answer. Renaming therefore means rewriting exactly
 * what `shell.ts` wrote, and the album list, which now displays it in its header,
 * follows through `useInstanceName`.
 */
export function applyInstanceName(name: string): void {
  document.title = name;
  const metas = document.querySelectorAll<HTMLMetaElement>(
    'meta[name="application-name"], meta[name="apple-mobile-web-app-title"]',
  );
  for (const meta of metas) meta.content = name;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current discriminator, re-rendering its component whenever the logo changes. */
export function useLogoVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    // Server snapshot: this front end is not server-rendered, but React asks for
    // one under `StrictMode` and a missing getter is a runtime error, not a type one.
    () => 0,
  );
}

/**
 * The instance name, re-rendering its component when an administrator changes it.
 *
 * Reads the DOM on every call rather than caching: the value is a string, so React
 * compares it by value and a name that has not changed causes no render. One
 * subscription list is shared with the logo — both are "the identity moved", and
 * an extra render of a header costs nothing.
 */
export function useInstanceName(): string {
  return useSyncExternalStore(subscribe, appName, appName);
}
