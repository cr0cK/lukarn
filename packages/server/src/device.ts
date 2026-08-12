import type { DeviceKind } from '@lukarn/shared';

/**
 * Device class inferred from the user-agent when the session is created.
 *
 * The user-agent itself is **never** stored: it is a fingerprint, often unique down
 * to a browser version. One of four classes cannot re-identify anyone and answers
 * the only question asked — "what device is this gallery viewed from?" — which
 * determines what to optimise (D260809h).
 *
 * `null` when the request has no header: an invented value would be indistinguishable
 * from a measurement.
 */
export function classifyDevice(userAgent: string | undefined): DeviceKind | null {
  if (!userAgent) return null;

  // Order decides everything, and television comes first: webOS advertises both
  // "Mobile" **and** "Safari" in its user-agent, and a naive test would classify it
  // as a phone. This case motivated the measurement — the living-room screen is
  // precisely the one that cannot be seen in logs.
  if (/webOS|Web0S|Tizen|SmartTV|SMART-TV|BRAVIA|AppleTV|CrKey|HbbTV/i.test(userAgent)) {
    return 'tv';
  }

  // `Android` without `Mobi` identifies an Android tablet: Chrome only writes
  // "Mobile" on a phone. Without this rule, all Android tablets would count as
  // phones and the column would no longer distinguish what it claims to distinguish.
  if (/iPad|Tablet|PlayBook|Silk/i.test(userAgent)) return 'tablette';
  if (/Android/i.test(userAgent) && !/Mobi/i.test(userAgent)) return 'tablette';

  if (/Mobi|Android|iPhone|iPod/i.test(userAgent)) return 'mobile';

  // A recent iPad identifies itself as "Macintosh" and therefore lands here: Apple
  // chose this to receive desktop sites, and nothing in the header can recover the
  // distinction. The bias is known and accepted — correcting it would require
  // probing touch support in JavaScript, which would amount to tracking.
  return 'ordinateur';
}
