import type { ReactElement } from 'react';

/** Indicateur de chargement neutre, utilisé partout où l'attente est courte. */
export function Spinner({ label = 'Chargement' }: { label?: string }): ReactElement {
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
