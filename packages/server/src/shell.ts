import { derivePalette, paletteProperties } from '@lukarn/shared';

/**
 * Instance identity injected into the two files that carry it.
 *
 * The name and the primary colour must apply at **request** time, not build time and
 * no longer even at startup: one image serves every installation, and both are now
 * settings changed from /admin (D260813c). Both files therefore contain the built-in
 * values — correct as-is in development where Vite bypasses this code — and the
 * server substitutes what the instance has chosen.
 *
 * Substitution targets precise locations in files owned by this repository. This is
 * not HTML parsing; it is a template with known slots.
 */

/** What the shell and the manifest need to know about the instance. */
export interface Branding {
  instanceName: string;
  /** `#rrggbb`. The whole palette is derived from it — see `derivePalette`. */
  primaryColor: string;
}

/**
 * Escapes characters in a name that would break the surrounding HTML.
 *
 * The name is set by an administrator, not a visitor, but one `"` can leave an
 * attribute and break the page, and nobody reviews a settings form as valid HTML.
 */
function echapper(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Replaces the default name and palette in the HTML shell.
 *
 * Three name locations serve different purposes: `<title>` names the tab,
 * `apple-mobile-web-app-title` names the iOS home icon — Safari does not read the
 * manifest for this — and the front end reads `application-name` for its sign-in
 * screen, avoiding a network round trip to display a title.
 *
 * The palette goes in the `style` attribute of `<html>` rather than a `<style>`
 * block, for two reasons. An inline custom property beats any stylesheet rule on
 * the same element, whatever order Vite emits its `<link>` in; and it is parsed
 * before the first paint, so no visitor sees the built-in colour flash into the
 * configured one.
 */
export function renderShell(html: string, branding: Branding): string {
  const nom = echapper(branding.instanceName);
  const palette = Object.entries(paletteProperties(derivePalette(branding.primaryColor)))
    .map(([property, value]) => `${property}: ${value}`)
    .join('; ');

  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${nom}</title>`)
    .replace(/(<meta\s+name="apple-mobile-web-app-title"\s+content=")[^"]*(")/, `$1${nom}$2`)
    .replace(/(<meta\s+name="application-name"\s+content=")[^"]*(")/, `$1${nom}$2`)
    .replace(/(<html\b[^>]*\sstyle=")[^"]*(")/, `$1${palette}$2`);
}

/**
 * Replaces the name in the installation manifest.
 *
 * The static file remains authoritative for icons, colours, `display` and everything
 * else. Overriding only two name fields avoids declaring the icon list twice and
 * diverging when a size is added.
 *
 * An unreadable manifest prevents startup: it belongs to the repository, so parse
 * failure means a broken build, while serving an empty manifest would silently make
 * the application uninstallable.
 */
export function renderManifest(raw: string, branding: Branding): string {
  const manifeste = JSON.parse(raw) as Record<string, unknown>;
  return JSON.stringify(
    { ...manifeste, name: branding.instanceName, short_name: branding.instanceName },
    null,
    2,
  );
}
