import type { ReactElement } from 'react';
import { useT } from '../lib/i18n';

/** Neutral loading indicator used wherever the wait is short. */
export function Spinner({ label }: { label?: string }): ReactElement {
  const t = useT();
  return (
    <div className="flex items-center gap-3 text-ink-300" role="status" aria-live="polite">
      <span
        className="size-5 animate-spin rounded-full border-2 border-ink-600 border-t-accent"
        aria-hidden="true"
      />
      <span className="text-sm">{label ?? t('common.loadingLabel')}</span>
    </div>
  );
}
