import { derivePalette, paletteProperties } from '@lukarn/shared';
import { useSyncExternalStore } from 'react';
import { brandingUrl } from '../api/client';

/**
 * Applying a changed identity to the page already open.
 *
 * The server writes the palette into the `style` attribute of `<html>` and the
 * browser reads the logo from `/api/branding/logo` — both correct on load, and
 * both stale the moment an administrator saves. Reloading would work; it would
 * also throw away the form, the notice that says the save succeeded, and any
 * sense that the colour picker did anything.
 *
 * So the two changes are pushed onto the live document instead. Nothing here is
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
