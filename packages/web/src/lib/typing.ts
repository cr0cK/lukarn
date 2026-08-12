/**
 * An input has focus: no global shortcut may run.
 *
 * The test lives here because three keyboard handlers — `useShortcut`, the grid
 * and viewer — each had a copy, and one divergence was enough. This happened:
 * the grid knew only `INPUT`, so arrows, `Home` and `End` moved selection rather
 * than the cursor inside a `textarea` — an album description or day note. Text
 * became impossible to edit with the keyboard.
 */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
