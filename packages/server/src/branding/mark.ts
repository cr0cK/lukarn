import { DEFAULT_PRIMARY_COLOR, normalizeHexColor } from '@lukarn/shared';

/**
 * The Lukarn mark, drawn as source rather than exported from a design tool.
 *
 * The delivered file is a Fabric.js export: nested groups, `matrix(2.2987785…)`
 * on every element and a `<desc>` naming the editor. Nothing in it can be
 * recoloured without reverse-engineering four levels of transform, which is
 * exactly what an instance-configurable dot requires.
 *
 * So the shape was **measured** off that export and redrawn on a 0–256 grid, at
 * the proportions it actually has: the square's corner radius is a fifth of its
 * side, the dot sits at (82.5 %, 18.5 %) with a radius of 8.3 %, and the `L`
 * spans 40.5–61.8 % across and 52.8–82.4 % down, with a stem 31.8 % of its own
 * width and a foot 21.4 % of its height.
 *
 * Four elements, because the `L` is two rectangles rather than a six-point
 * polygon: the two carry the measurements above directly, and a stem or a foot
 * can be adjusted without recomputing the other five vertices.
 *
 * Rendered server-side, not shipped as a static file, because the dot carries
 * the instance's primary colour and that colour changes at runtime.
 */

/**
 * The square's own black — `--color-ink-950`.
 *
 * The application's deepest ink rather than pure black: the mark sits on
 * `--color-ink-900` in the top bar, and a second black beside the first would be
 * a value nothing else in the interface uses.
 */
const SQUARE = '#08080a';

/**
 * Builds the mark with its dot in `primary`.
 *
 * A colour that is not `#rrggbb` falls back to the default instead of being
 * interpolated: this string is served as `image/svg+xml` from our own origin, and
 * an unvalidated value would be an attribute injection into a document the browser
 * executes scripts from.
 */
export function renderMark(primary: string): string {
  const dot = normalizeHexColor(primary) ?? DEFAULT_PRIMARY_COLOR;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <rect width="256" height="256" rx="51.2" fill="${SQUARE}" />
  <rect x="103.7" y="135.2" width="17.4" height="75.9" fill="#ffffff" />
  <rect x="103.7" y="194.8" width="54.6" height="16.3" fill="#ffffff" />
  <circle cx="211.3" cy="47.3" r="21.1" fill="${dot}" />
</svg>
`;
}
