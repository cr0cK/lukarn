/**
 * The reader's theme, applied before anything is painted.
 *
 * This is the one script the application loads without a bundler, from `<head>`,
 * with neither `defer` nor `type="module"`. Both of those would let the parser
 * carry on and the stylesheet paint the dark page first: whoever chose light, or
 * whose phone did, would watch it flash black on every cold load. A blocking
 * script runs where it stands, and `index.html` puts it after the metas it edits
 * and before the first paint.
 *
 * A separate file rather than a few inline lines because the Content-Security-
 * Policy this server sends is `script-src 'self'` (`plugins/headers.ts`): an
 * inline script is refused, and relaxing that directive to save one small
 * same-origin request would also make an injected `<script>` in an album title
 * executable.
 *
 * It duplicates `readStoredTheme` and `systemTheme` from `src/lib/theme.ts`,
 * which cannot be imported here — that module is bundled, this file is not.
 * `theme.test.ts` reads both and fails if they stop agreeing.
 */
(function () {
  var stored = null;
  try {
    stored = window.localStorage.getItem('lukarn:theme');
  } catch {
    // Denied storage — private browsing on older Safari — falls back to the
    // device preference. Never a thrown error: nothing would render after it.
  }

  var light =
    stored === 'light' ||
    (stored !== 'dark' &&
      !!window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: light)').matches);

  // `index.html` already ships the dark class, so dark has nothing to do.
  if (!light) return;

  document.documentElement.classList.remove('theme-dark');
  document.documentElement.classList.add('theme-light');

  // The colour the browser paints its own chrome with — the address bar on
  // Android, the area above a rubber-band scroll on iOS. Left at the dark
  // value it frames a light page in black. `--color-ink-900` of the light ramp.
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', '#f5f5f7');
})();
