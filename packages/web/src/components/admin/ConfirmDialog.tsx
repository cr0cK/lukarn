import { type ReactElement, type ReactNode, useEffect, useId, useRef } from 'react';
import { Button } from './ui';

interface ConfirmDialogProps {
  /** Nomme ce qui va être supprimé — jamais « Êtes-vous sûr ? ». */
  title: string;
  /** Décrit la conséquence exacte, y compris ce qui n'est PAS touché. */
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation modale d'une action destructrice.
 *
 * Volontairement pas `window.confirm` : le texte doit citer l'objet concerné et
 * ses conséquences, ce qu'une boîte native ne met pas en forme, et le bouton
 * dangereux ne doit pas prendre le focus à l'ouverture — un Entrée réflexe
 * suffirait alors à supprimer.
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
    // Rendre le focus à l'élément déclencheur : sans ça, la navigation clavier
    // repart du début de la page après chaque annulation.
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
