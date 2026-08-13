/**
 * The instance's primary colour, and the three values derived from it.
 *
 * Shared because both ends compute the same palette: the server writes it into the
 * HTML shell before first paint, and the administration form previews a colour that
 * has not been saved yet. Two implementations would drift, and the one that drifted
 * would be the preview — the only one nobody compares against anything.
 *
 * Everything here returns plain `#rrggbb`. The obvious alternative,
 * `color-mix(in srgb, …)`, would place the derivation in the stylesheet and cost
 * nothing to write, but it does not exist before Chromium 111 — and the television
 * this gallery is read on reports Chromium 79 (D260809f). A colour the browser
 * cannot parse falls back to *nothing*: buttons would lose their background rather
 * than merely look different.
 */

/** The red of the mark's dot, and the colour an instance uses until it picks one. */
export const DEFAULT_PRIMARY_COLOR = '#eb2020';

/**
 * Accepted colour form. Six digits only: three-digit and eight-digit forms would
 * have to be expanded before every mix, and an alpha channel has no meaning for a
 * value used as an opaque surface.
 */
export const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/**
 * Instance name shown while no setting has been saved and `APP_NAME` is unset.
 * Deliberately generic: it names what the application is, not whose it is.
 */
export const DEFAULT_INSTANCE_NAME = 'Photos';

/**
 * Instance-name limit. Short because Android truncates beyond roughly a dozen
 * characters under a home-screen icon; the cap only rules out a name that would
 * break the top bar's single row.
 */
export const INSTANCE_NAME_MAX_LENGTH = 64;

/**
 * Largest logo upload accepted.
 *
 * Half a megabyte: ample for any logo a browser has already turned into a PNG or
 * JPEG, and small enough that a request cannot be used to occupy memory — the body
 * is held whole before an image library sees it. Shared so the browser can say no
 * before spending an upload, and the server can say no whatever the browser did.
 */
export const LOGO_MAX_BYTES = 512 * 1024;

/**
 * Icons the branding route generates, keyed by the `<name>` in
 * `/api/branding/icon-<name>`.
 *
 * Here rather than beside the code that renders them because two packages must
 * agree on this list and neither owns it: the server answers these URLs, and
 * `manifest.webmanifest` declares three of them. A name added on one side without
 * the other is an icon nobody requests, or a 404 nobody notices until an
 * installation shows a blank square.
 */
export const ICON_VARIANTS = {
  '192.png': { size: 192, inset: 1, background: null },
  '512.png': { size: 512, inset: 1, background: null },
  /**
   * Android crops a maskable icon to a circle and keeps roughly the middle 80 %.
   * A full-bleed rounded square would lose its corners, and with them the dot that
   * makes the mark recognisable — hence the inset, on the application background
   * (`--color-ink-900`) so the padding is not a white halo.
   */
  'maskable-512.png': { size: 512, inset: 0.62, background: '#0b0b0d' },
  /**
   * iOS composites a home-screen icon on black and applies its own rounding, so
   * transparent corners come out as a colour nobody chose. Flattening onto the
   * mark's own black (`--color-ink-950`) makes them disappear into the square.
   */
  'apple-180.png': { size: 180, inset: 1, background: '#08080a' },
} as const satisfies Record<string, { size: number; inset: number; background: string | null }>;

/** URL suffix of a generated icon: `icon-192.png` carries `192.png`. */
export type IconName = keyof typeof ICON_VARIANTS;

export function isIconName(value: string): value is IconName {
  return Object.hasOwn(ICON_VARIANTS, value);
}

/** The four values the interface actually paints with. */
export interface Palette {
  /** The chosen colour: filled buttons, active tab border, focus ring, the dot. */
  accent: string;
  /** Darker, for a border resting against the accent — a focused field. */
  accentDim: string;
  /** The accent barely mixed into the panel background: a hovered row. */
  accentSoft: string;
  /** Readable **on** `accent`: the label of a filled button. */
  accentInk: string;
}

/** Custom properties the palette fills, in the order the stylesheet declares them. */
export type PaletteProperties = Record<`--color-accent${string}`, string>;

/** Parsed `#rrggbb`, or `null` when the value is not one. */
function parseHex(value: string): [number, number, number] | null {
  if (!HEX_COLOR_PATTERN.test(value)) return null;
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function toHex([r, g, b]: [number, number, number]): string {
  const channel = (v: number): string =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * Lower-case `#rrggbb`, or `null` when the value is not a six-digit colour.
 *
 * Folding case matters beyond tidiness: the colour ends up in an `ETag` and in the
 * cache key for generated icons, where `#EB2020` and `#eb2020` would otherwise be
 * two entries for one image.
 */
export function normalizeHexColor(value: string): string | null {
  return HEX_COLOR_PATTERN.test(value) ? value.toLowerCase() : null;
}

/** Panel background the soft hover is mixed into — `--color-ink-850`. */
const INK_850: [number, number, number] = [0x12, 0x12, 0x15];

/** Near-black used as a foreground on a pale accent — `--color-ink-950`. */
const INK_950 = '#08080a';

/**
 * Relative luminance, as defined by WCAG 2. Used only to choose between two
 * foregrounds, never to reject a colour: an operator's choice is theirs.
 */
function luminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Where the readable foreground switches from white to near-black.
 *
 * Not the 0.179 at which the two tie by WCAG contrast: at that point both measure
 * around 4.5:1, and the tie is settled by what a saturated colour actually looks
 * like. The default red lands at 0.19, where near-black measures a hair better and
 * reads far worse. Above 0.3 only pale accents remain, and there near-black is the
 * unambiguous answer — it is what the previous fixed blue already used.
 */
const INK_THRESHOLD = 0.3;

/**
 * The palette an instance paints with, derived from one colour.
 *
 * An unparseable value falls back to the default rather than throwing: this runs
 * while rendering a page, and a malformed setting must cost the gallery its brand
 * colour, not its ability to serve.
 */
export function derivePalette(primary: string): Palette {
  const rgb = parseHex(primary) ?? parseHex(DEFAULT_PRIMARY_COLOR)!;
  const accent = toHex(rgb);

  return {
    accent,
    // 28 % darker. Enough to read as a border against the accent it sits beside,
    // little enough to stay the same colour rather than become a second one.
    accentDim: toHex(rgb.map((v) => v * 0.72) as [number, number, number]),
    accentSoft: toHex(rgb.map((v, i) => v * 0.16 + INK_850[i]! * 0.84) as [number, number, number]),
    accentInk: luminance(rgb) > INK_THRESHOLD ? INK_950 : '#ffffff',
  };
}

/**
 * The palette as custom properties.
 *
 * One function rather than four literals at each call site: the server writes these
 * onto `<html>` and the administration preview writes them onto a `div`, and a
 * property renamed in `styles.css` must not leave one of the two spelling the old name.
 */
export function paletteProperties(palette: Palette): PaletteProperties {
  return {
    '--color-accent': palette.accent,
    '--color-accent-dim': palette.accentDim,
    '--color-accent-soft': palette.accentSoft,
    '--color-accent-ink': palette.accentInk,
  };
}
