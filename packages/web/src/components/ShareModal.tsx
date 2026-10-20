import {
  SHARE_LABEL_MAX_LENGTH,
  type AdminShareLink,
  type CreateShareItemInput,
} from '@lukarn/shared';
import { type FormEvent, type ReactElement, useEffect, useId, useRef, useState } from 'react';
import { errorText } from '../api/client';
import { useAddShareItems, useAdminAlbums, useAdminShares, useCreateShare } from '../api/hooks';
import { useT } from '../lib/i18n';
import { Switch } from './admin/ui';
import { Spinner } from './Spinner';

interface ShareModalProps {
  albumId?: string | null;
  albumTitle?: string;
  mediaId?: string | null;
  mediaName?: string | null;
  items?: CreateShareItemInput[] | null;
  initialMode?: 'new' | 'existing';
  isOpen: boolean;
  onClose: () => void;
}

type ExpiryOption = '7d' | '30d' | 'never';

/**
 * Contextual share modal: lets an administrator issue and copy a link to an album,
 * a single photograph, or a multi-photo selection, or append items to an existing share.
 */
export function ShareModal({
  albumId,
  albumTitle,
  mediaId,
  mediaName,
  items,
  initialMode = 'new',
  isOpen,
  onClose,
}: ShareModalProps): ReactElement | null {
  const t = useT();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const create = useCreateShare();
  const addItems = useAddShareItems();
  const { data: existingShares = [] } = useAdminShares();
  const { data: adminAlbums = [] } = useAdminAlbums();

  const activeShares = existingShares.filter(
    (s) => !s.revokedAt && (!s.expiresAt || new Date(s.expiresAt).getTime() > Date.now()),
  );

  const [mode, setMode] = useState<'new' | 'existing'>(initialMode);
  const [targetShareToken, setTargetShareToken] = useState<string>('');
  const [selectedAlbumId, setSelectedAlbumId] = useState<string>('');
  const [label, setLabel] = useState('');
  const [expiry, setExpiry] = useState<ExpiryOption>('30d');
  const [allowComments, setAllowComments] = useState(true);
  const [requireIdentity, setRequireIdentity] = useState(false);
  const [created, setCreated] = useState<AdminShareLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setMode(initialMode);
      setLabel('');
      setExpiry('30d');
      setAllowComments(true);
      setRequireIdentity(false);
      setCreated(null);
      setCopied(false);
      setError(null);
      return;
    }

    setMode(initialMode);
    if (activeShares[0] && !targetShareToken) {
      setTargetShareToken(activeShares[0].token);
    }
    if (adminAlbums[0] && !selectedAlbumId) {
      setSelectedAlbumId(adminAlbums[0].id);
    }

    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previous?.focus();
  }, [isOpen, initialMode, activeShares, adminAlbums, targetShareToken, selectedAlbumId]);

  if (!isOpen) return null;

  const isSelection = Boolean(items && items.length > 0);
  const isMedia = Boolean(mediaId);
  const hasContextTarget = Boolean(albumId || isMedia || isSelection);
  const modalTitle = t(
    isSelection
      ? 'shares.shareSelection'
      : isMedia
        ? 'shares.sharePhoto'
        : hasContextTarget
          ? 'shares.shareAlbum'
          : 'shares.createTab',
  );
  const targetName = isSelection
    ? t('shares.selectedCount', items!.length)
    : isMedia
      ? (mediaName ?? mediaId)
      : (albumTitle ?? albumId ?? null);

  const getExpiresAt = (): string | null => {
    if (expiry === '7d') return new Date(Date.now() + 7 * 86_400_000).toISOString();
    if (expiry === '30d') return new Date(Date.now() + 30 * 86_400_000).toISOString();
    return null;
  };

  const copyUrl = async (token: string): Promise<void> => {
    const url = `${window.location.origin}/s/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access rejected by browser
    }
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);

    if (mode === 'existing' && hasContextTarget) {
      const shareToken = targetShareToken || activeShares[0]?.token;
      if (!shareToken) return;
      const body = isSelection
        ? { items: items! }
        : isMedia && albumId
          ? { items: [{ albumId, mediaId: mediaId! }] }
          : albumId
            ? { albumIds: [albumId] }
            : {};
      addItems.mutate(
        { token: shareToken, body },
        {
          onSuccess: () => {
            onClose();
          },
          onError: (err) => {
            setError(errorText(err, t('shares.updateFailed')));
          },
        },
      );
      return;
    }

    const resolvedAlbumId = albumId ?? selectedAlbumId ?? adminAlbums[0]?.id ?? '';
    const body = isSelection
      ? {
          items: items!,
          label: label.trim() || null,
          expiresAt: getExpiresAt(),
          allowComments,
          requireIdentity,
        }
      : {
          albumId: resolvedAlbumId,
          mediaId: mediaId ?? null,
          label: label.trim() || null,
          expiresAt: getExpiresAt(),
          allowComments,
          requireIdentity,
        };

    create.mutate(body, {
      onSuccess: (link) => {
        setCreated(link);
        void copyUrl(link.token);
      },
      onError: (err) => {
        setError(errorText(err, t('shares.createFailed')));
      },
    });
  };

  const isPending = create.isPending || addItems.isPending;
  const shareUrl = created ? `${window.location.origin}/s/${created.token}` : '';

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
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-ink-800 bg-surface-base p-6 shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-ink-100">
              {modalTitle}
            </h2>
            {targetName && <p className="mt-0.5 truncate text-xs text-ink-400">{targetName}</p>}
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

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        {created ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
              {t('shares.shareCreated')}
            </div>

            <div>
              <label htmlFor="share-link-url" className="text-sm font-medium text-ink-300">
                {t('shares.title')}
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="share-link-url"
                  type="text"
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.target.select()}
                  className="min-w-0 flex-1 rounded-lg border border-ink-700 bg-surface-elevated px-3 py-2 text-sm text-ink-100 select-all"
                />
                <button
                  type="button"
                  onClick={() => void copyUrl(created.token)}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium whitespace-nowrap text-accent-ink hover:opacity-90"
                >
                  {t(copied ? 'shares.copied' : 'shares.copy')}
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-ink-600 px-4 py-2 text-sm font-medium text-ink-200 hover:bg-tint"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            {hasContextTarget && activeShares.length > 0 && (
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-ink-800 bg-surface-elevated p-1">
                <button
                  type="button"
                  onClick={() => setMode('new')}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    mode === 'new'
                      ? 'bg-ink-700 text-ink-100 shadow-xs'
                      : 'text-ink-400 hover:text-ink-200'
                  }`}
                >
                  {t('shares.modeCreateNew')}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('existing')}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    mode === 'existing'
                      ? 'bg-ink-700 text-ink-100 shadow-xs'
                      : 'text-ink-400 hover:text-ink-200'
                  }`}
                >
                  {t('shares.modeAddToExisting')}
                </button>
              </div>
            )}

            {mode === 'existing' && hasContextTarget ? (
              <div>
                <label htmlFor="share-modal-target" className="text-sm font-medium text-ink-300">
                  {t('shares.targetShare')}
                </label>
                <select
                  id="share-modal-target"
                  value={targetShareToken || activeShares[0]?.token || ''}
                  onChange={(e) => setTargetShareToken(e.target.value)}
                  disabled={isPending}
                  className="mt-1 w-full rounded-lg border border-ink-700 bg-surface-elevated px-3 py-2 text-sm text-ink-100 focus:border-accent focus:outline-none"
                >
                  {activeShares.map((s) => (
                    <option key={s.token} value={s.token}>
                      {s.label || s.albumTitle || t('shares.selectionDefaultTitle')}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <p className="text-xs text-ink-400">{t('shares.shareDialogIntro')}</p>

                {!hasContextTarget && adminAlbums.length > 0 && (
                  <div>
                    <label htmlFor="share-modal-album" className="text-sm font-medium text-ink-300">
                      {t('shares.album')}
                    </label>
                    <select
                      id="share-modal-album"
                      value={selectedAlbumId || adminAlbums[0]?.id || ''}
                      onChange={(e) => setSelectedAlbumId(e.target.value)}
                      disabled={isPending}
                      className="mt-1 w-full rounded-lg border border-ink-700 bg-surface-elevated px-3 py-2 text-sm text-ink-100 focus:border-accent focus:outline-none"
                    >
                      {adminAlbums.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label htmlFor="share-modal-label" className="text-sm font-medium text-ink-300">
                    {t('shares.label')}
                  </label>
                  <input
                    id="share-modal-label"
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value.slice(0, SHARE_LABEL_MAX_LENGTH))}
                    placeholder={t('shares.labelHint')}
                    disabled={isPending}
                    className="mt-1 w-full rounded-lg border border-ink-700 bg-surface-elevated px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-accent focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-ink-300">
                    {t('shares.expiresAt')}
                  </label>
                  <div className="mt-1 grid grid-cols-3 gap-2">
                    {(
                      [
                        ['7d', 'shares.expiry7Days'],
                        ['30d', 'shares.expiry30Days'],
                        ['never', 'shares.expiryNever'],
                      ] as const
                    ).map(([key, labelKey]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setExpiry(key)}
                        disabled={isPending}
                        className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                          expiry === key
                            ? 'border-accent bg-accent-soft text-accent'
                            : 'border-ink-700 bg-surface-elevated text-ink-300 hover:border-ink-600 hover:text-ink-100'
                        }`}
                      >
                        {t(labelKey)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="divide-y divide-ink-800 rounded-xl border border-ink-800 bg-surface-elevated px-4 py-1">
                  <div className="py-2">
                    <Switch
                      checked={allowComments}
                      onChange={setAllowComments}
                      label={t('shares.allowComments')}
                      hint={t('shares.allowCommentsHint')}
                      disabled={isPending}
                    />
                  </div>
                  <div className="py-2">
                    <Switch
                      checked={requireIdentity}
                      onChange={setRequireIdentity}
                      label={t('shares.requireIdentity')}
                      hint={t('shares.requireIdentityHint')}
                      disabled={isPending}
                    />
                  </div>
                </div>
              </>
            )}

            <div className="flex justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="rounded-lg border border-ink-600 px-4 py-2 text-sm font-medium text-ink-200 hover:bg-tint"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
              >
                {isPending ? (
                  <Spinner />
                ) : (
                  t(mode === 'existing' && hasContextTarget ? 'shares.addToShare' : 'shares.create')
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
