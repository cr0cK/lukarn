import type { ReactElement } from 'react';

/** Neutral loading indicator used wherever the wait is short. */
export function Spinner({ label = 'Loading' }: { label?: string }): ReactElement {
  return (
    <div className="flex items-center gap-3 text-ink-300" role="status" aria-live="polite">
      <span
        className="size-5 animate-spin rounded-full border-2 border-ink-600 border-t-accent"
        aria-hidden="true"
      />
      <span className="text-sm">{label}</span>
    </div>
  );
}
