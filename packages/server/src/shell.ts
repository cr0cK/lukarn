/**
 * Instance name injected into the two files that carry it.
 *
 * `APP_NAME` must apply at startup, not build time: one image serves every installation,
 * and nobody rebuilds a container to rename a gallery. Both files therefore contain
 * a hard-coded "Photos" — correct as-is in development where Vite bypasses this code —
 * and the server substitutes the configured name at runtime.
 *
 * Substitution targets three precise locations in a file owned by this repository.
 * This is not HTML parsing; it is a template with known slots.
 */

/**
 * Escapes characters in a name that would break the surrounding HTML.
 *
 * The name comes from the operator's `.env`, not a visitor, but one `"` can leave an
 * attribute and break the page, and nobody reviews `.env` as valid HTML.
 */
function echapper(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Replaces the default name in the HTML shell.
 *
 * Three locations serve different purposes: `<title>` names the tab,
 * `apple-mobile-web-app-title` names the iOS home icon — Safari does not read the
 * manifest for this — and the front end reads `application-name` for its sign-in
 * screen, avoiding a network round trip to display a title.
 */
export function renderShell(html: string, appName: string): string {
  const nom = echapper(appName);
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${nom}</title>`)
    .replace(/(<meta\s+name="apple-mobile-web-app-title"\s+content=")[^"]*(")/, `$1${nom}$2`)
    .replace(/(<meta\s+name="application-name"\s+content=")[^"]*(")/, `$1${nom}$2`);
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
export function renderManifest(raw: string, appName: string): string {
  const manifeste = JSON.parse(raw) as Record<string, unknown>;
  return JSON.stringify({ ...manifeste, name: appName, short_name: appName }, null, 2);
}
