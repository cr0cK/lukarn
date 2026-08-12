import { type ReactElement, type ReactNode, useEffect, useId, useRef } from 'react';
import { Button } from './ui';

interface ConfirmDialogProps {
  /** Names what will be deleted — never "Are you sure?". */
  title: string;
  /** Describes the exact consequence, including what is NOT affected. */
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal confirmation of a destructive action.
 *
 * Deliberately not `window.confirm`: the text must name the affected object and
 * consequences, which a native dialog cannot format, and the dangerous button
 * must not receive focus on opening — a reflexive Enter would then delete it.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): ReactElement {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    // Restore focus to the triggering element: otherwise keyboard navigation
    // restarts at the top of the page after every cancellation.
    return () => previous?.focus();
  }, []);

  return (
    <div
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-md rounded-xl border border-ink-700 bg-ink-850 p-5 shadow-2xl outline-none"
      >
        <h2 id={titleId} className="text-base font-medium text-ink-100">
          {title}
        </h2>

        <div className="mt-3 space-y-2 text-sm text-ink-300">{children}</div>

        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Deleting…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
