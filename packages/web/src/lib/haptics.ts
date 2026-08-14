/**
 * A short vibration confirming that a gesture landed.
 *
 * **It is silent on iOS**, and that is worth stating rather than discovering:
 * `navigator.vibrate` is an Android and Chromium API, and Safari has never
 * implemented it — on the archetypal phone for a photo gallery, this does
 * nothing at all. It is kept because it costs one guarded call and works on
 * every other phone, not because it covers the case someone would expect first.
 *
 * Detected at runtime rather than by browser: the property is absent on every
 * desktop engine too, where the call would otherwise throw.
 */

/** Long enough to be felt, short enough not to be heard on a table. */
const TAP_MS = 8;

/**
 * Whether movement is welcome at all.
 *
 * Read on each call rather than cached: the setting can change during a session,
 * and a value captured at module load would keep buzzing for the rest of it.
 */
function motionWelcome(): boolean {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Confirms that a sheet reached a new stop.
 *
 * The gesture already shows where the sheet went; this says the release was
 * **read**, which the eye cannot tell from a sheet settling on its own.
 */
export function tapFeedback(): void {
  if (!motionWelcome()) return;
  navigator.vibrate?.(TAP_MS);
}
