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
      className={`${size === 'sm' ? 'size-7' : 'size-12'} shrink-0 rounded-lg ${className}`}
    />
  );
}
