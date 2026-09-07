import { isLocale, type AdminAlbum, type Locale } from '@lukarn/shared';
import { type FormEvent, type ReactElement, useId, useRef, useState } from 'react';
import { errorText } from '../../api/client';
import { useInviteMember } from '../../api/hooks';
import { validateEmail } from '../../lib/adminForm';
import { useT } from '../../lib/i18n';
import { InviteLinkModal } from './InviteLinkModal';
import { Button, FormError, SelectField, TextField, localeOptions, type Notify } from './ui';

interface InviteMemberModalProps {
  albums: AdminAlbum[];
  onClose: () => void;
  notify: Notify;
}

/**
 * Modal dialog for inviting a member without a password.
 * Captures email, optional display name, album access list, and preferred language.
 */
export function InviteMemberModal({
  albums,
  onClose,
  notify,
}: InviteMemberModalProps): ReactElement {
  const t = useT();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const invite = useInviteMember();

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [locale, setLocale] = useState<Locale>(t.locale);
  const [selectedAlbums, setSelectedAlbums] = useState<string[]>(albums.map((a) => a.id));
  const [touched, setTouched] = useState(false);
  const [offlineUrl, setOfflineUrl] = useState<string | null>(null);

  const emailError = validateEmail(email, t);

  const selectAll = (): void => {
    setSelectedAlbums(albums.map((a) => a.id));
  };

  const clearAll = (): void => {
    setSelectedAlbums([]);
  };

  const toggleAlbum = (id: string, checked: boolean): void => {
    if (checked) {
      setSelectedAlbums((prev) => [...prev, id]);
    } else {
      setSelectedAlbums((prev) => prev.filter((aId) => aId !== id));
    }
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setTouched(true);
    if (emailError) return;

    invite.mutate(
      {
        email: email.trim(),
        displayName: displayName.trim() || undefined,
        albums: selectedAlbums,
        locale,
      },
      {
        onSuccess: (result) => {
          if (result.inviteUrl) {
            setOfflineUrl(result.inviteUrl);
          } else {
            notify({
              tone: 'ok',
              text: t('adminUsers.memberInvited', email.trim()),
            });
            onClose();
          }
        },
      },
    );
  };

  if (offlineUrl) {
    return <InviteLinkModal inviteUrl={offlineUrl} onClose={onClose} notify={notify} />;
  }

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
        className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl border border-ink-700 bg-ink-850 p-6 shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-base font-medium text-ink-100">
              {t('adminUsers.inviteMemberTitle')}
            </h2>
            <p className="mt-1 text-xs text-ink-400">{t('adminUsers.inviteMemberExplain')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.cancel')}
            className="rounded-lg p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-100"
          >
            <svg
              className="size-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {invite.error && (
          <div className="mt-4">
            <FormError message={errorText(invite.error, t('adminUsers.inviteFailed'))} />
          </div>
        )}

        <form onSubmit={submit} className="mt-4 flex-1 overflow-y-auto space-y-4 pr-1">
          <TextField
            id="member-email"
            label={t('adminUsers.memberEmail')}
            type="email"
            value={email}
            onChange={setEmail}
            autoFocus
            disabled={invite.isPending}
            placeholder={t('adminUsers.memberEmailPlaceholder')}
            error={touched ? emailError : null}
          />

          <TextField
            id="member-display-name"
            label={t('adminUsers.memberDisplayName')}
            value={displayName}
            onChange={setDisplayName}
            disabled={invite.isPending}
            placeholder={t('adminUsers.memberDisplayNamePlaceholder')}
          />

          <SelectField
            id="member-locale"
            label={t('userForm.locale')}
            value={locale}
            options={localeOptions()}
            onChange={(value) => isLocale(value) && setLocale(value)}
            disabled={invite.isPending}
            hint={t('userForm.localeHint')}
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink-300">{t('access.legend')}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-xs text-accent hover:underline"
                >
                  {t('adminUsers.selectAll')}
                </button>
                <span className="text-xs text-ink-600">·</span>
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-xs text-ink-400 hover:underline"
                >
                  {t('adminUsers.clearAll')}
                </button>
              </div>
            </div>

            {albums.length === 0 ? (
              <p className="rounded-lg border border-dashed border-ink-700 px-3 py-4 text-xs text-ink-400">
                {t('access.noAlbum')}
              </p>
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-ink-700 p-2">
                {albums.map((album) => {
                  const checked = selectedAlbums.includes(album.id);
                  return (
                    <label
                      key={album.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-ink-800"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => toggleAlbum(album.id, e.target.checked)}
                        className="rounded border-ink-600 text-accent focus:ring-accent"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-ink-200">{album.title}</p>
                        <p className="text-[11px] text-ink-400">
                          {t('access.albumDetail', album.id, album.itemCount)}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-2 pt-2 border-t border-ink-800">
            <Button onClick={onClose} disabled={invite.isPending}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" type="submit" disabled={invite.isPending}>
              {invite.isPending ? t('common.sending') : t('adminUsers.sendMemberInvite')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
