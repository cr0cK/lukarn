import { type ReactElement, useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import { Button, type Notify } from './ui';

interface InviteLinkModalProps {
  inviteUrl: string;
  onClose: () => void;
  notify?: Notify;
}

/**
 * Modal displaying a generated offline magic onboarding link with a copy button.
 */
export function InviteLinkModal({
  inviteUrl,
  onClose,
  notify,
}: InviteLinkModalProps): ReactElement {
  const t = useT();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const copyUrl = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      notify?.({ tone: 'ok', text: t('adminUsers.inviteLinkCopied') });
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access rejected by browser; user can still select and copy manually
    }
  };

  return (
    <div
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
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
          {t('adminUsers.offlineModalTitle')}
        </h2>

        <p className="mt-2 text-sm text-ink-300">{t('adminUsers.offlineModalExplain')}</p>

        <div className="mt-4 flex gap-2">
          <input
            id="invite-link-input"
            type="text"
            readOnly
            value={inviteUrl}
            onFocus={(e) => e.target.select()}
            className="min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-xs text-ink-100 select-all outline-none focus:border-accent-dim"
          />
          <Button variant="primary" onClick={() => void copyUrl()}>
            {copied ? t('shares.copied') : t('adminUsers.copyInviteLink')}
          </Button>
        </div>

        <div className="mt-5 flex justify-end">
          <Button onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    </div>
  );
}
