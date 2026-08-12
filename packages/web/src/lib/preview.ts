/**
 * What to show while a **photo** is prepared: blurred preview, activity indicator
 * and failure message.
 *
 * Isolated here because the rule is easy to break without a failure: an incorrect
 * combination produces no error, only a misleading screen. The missed case is a
 * blurred preview shown **without** an indicator — it looks like a blurred photo,
 * not a loading one, suggesting the application is broken.
 *
 * Video no longer goes through this: it has only two states, playing or
 * unplayable. Its wait is covered by the element's `poster` and native browser
 * controls, which already carry an indicator — overlaying another produced two
 * spinning over one another (D98).
 */

export interface PreviewInput {
  /** The requested render arrived and decoded. */
  loaded: boolean;
  /** The render could not be obtained. */
  failed: boolean;
  /** False while dimensions are unknown: there is nothing to position. */
  measured: boolean;
}

export interface PreviewOverlay {
  /** Enlarged, blurred thumbnail while awaiting the final render. */
  placeholder: boolean;
  /** Activity indicator: says the blur is waiting, not a result. */
  spinner: boolean;
  /** Failure message replacing everything else. */
  error: boolean;
}

/**
 * Never show a blurred preview alone: the indicator always accompanies it, and
 * both disappear together.
 *
 * Show the indicator even without a preview — dimensions unknown, so nothing to
 * display while waiting: a silent black screen would be worse.
 */
export function previewOverlay({ loaded, failed, measured }: PreviewInput): PreviewOverlay {
  if (failed) return { placeholder: false, spinner: false, error: true };
  if (loaded) return { placeholder: false, spinner: false, error: false };
  return { placeholder: measured, spinner: true, error: false };
}
