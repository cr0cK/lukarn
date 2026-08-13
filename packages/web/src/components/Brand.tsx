import type { ReactElement } from 'react';
import { brandingUrl } from '../api/client';
import { useLogoVersion } from '../lib/branding';

/**
 * The instance's mark, wherever the application introduces itself.
 *
 * One component for the three surfaces that show it — the sign-in screen, the top
 * bar and the administration preview — because they must show the *same* image.
 * Three `<img>` tags would eventually differ in their URL, and the one that
 * differed would be the one nobody looks at until an operator uploads a logo.
 *
 * `/api/branding/logo` rather than a bundled file: the mark carries the configured
 * primary colour in its dot, and an instance may have replaced it altogether. The
 * route is public — it is requested before any session exists.
 */
export function Brand({
  size = 'md',
  className = '',
}: {
  /** `sm` sits in the top bar beside a title; `md` above the sign-in heading. */
  size?: 'sm' | 'md';
  className?: string;
}): ReactElement {
  // Zero on an ordinary page load, so this shares one cache entry with the tab
  // icon. It only moves after an administrator replaces the logo, and then every
  // mark on screen follows without a reload.
  const version = useLogoVersion();

  return (
    <img
      src={brandingUrl.logo(version || undefined)}
      // Decorative in both places: the instance name is written beside it as
      // text, and reading the same name twice helps nobody.
      alt=""
      aria-hidden="true"
      // Rounded, because the built-in mark already is and a square upload
      // otherwise sits oddly next to the rest of this interface's radii. The
      // mark's own corners fall inside this one, so nothing is clipped.
      //
      // **The hairline is what makes the mark visible here.** Its square is
      // black, which is right on the white of an email header, on a README and
      // against light browser chrome — and is the one value darker than every
      // surface in this interface. On `ink-900` it has no edge at all, and what
      // is left on screen is a floating white `L`. Lightening the square would
      // fix this page and break the others; lightening the page would move the
      // manifest's colours and the ground the photos sit on. The silhouette is
      // missing only where the mark meets a near-black surface, so it is
      // restored here rather than in the palette.
      //
      // **Outside the box, never `ring-inset`.** An inset shadow on a replaced
      // element is painted *behind* the replaced content, and the mark's square
      // is opaque and full-bleed: the ring was covered by the very image it was
      // meant to outline, leaving the page pixel-identical to having no ring at
      // all. `ring` rather than `border`, which would take a pixel from the image.
      //
      // `ink-600` and not the `ink-700` used for panel edges: this line separates
      // two nearly black surfaces rather than a panel from a page, and at
      // `ink-700` it was there but not legible at 28 px.
      className={`${size === 'sm' ? 'size-7' : 'size-12'} shrink-0 rounded-lg ring-1 ring-ink-600 ${className}`}
    />
  );
}
