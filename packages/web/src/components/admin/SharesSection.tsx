import { SHARE_LABEL_MAX_LENGTH, type AdminAlbum, type AdminShareLink } from '@lukarn/shared';
import { type FormEvent, type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { errorText } from '../../api/client';
import {
  useAdminShares,
  useCreateShare,
  useDeleteShare,
  useRestoreShare,
  useRevokeShare,
  useUpdateShare,
} from '../../api/hooks';
import { formatLocalDateTime, formatRelative } from '../../lib/format';
import { useT, type MessageKey, type Translate } from '../../lib/i18n';
import { DateTimePicker } from '../DateTimePicker';
import { Spinner } from '../Spinner';
import { ConfirmDialog } from './ConfirmDialog';
import {
  Button,
  FormError,
  ROW_ACTIONS_CLASS,
  ROW_CLASS,
  Section,
  SelectField,
  TextField,
  type Notify,
} from './ui';

/** What the confirmation dialog is about, since revoking and deleting differ (D260825b). */
type Pending = { link: AdminShareLink; action: 'revoke' | 'delete' };

type SharesTab = 'existing' | 'create';

/**
 * "Links" section: every share link this instance has issued.
 *
 * Organized into sub-tabs (D-01):
 * - "Existing links": Link list with status badges, search filtering, and lifecycle actions.
 * - "Create a link": Dedicated creation form for album or single photo shares.
 *
 * Shows the **token**, which no other screen does: administration's reader already
 * holds every credential this instance has, and a link nobody can copy is a link nobody
 * can send. It also shows the record of use — when each was last opened (D260825c).
 */
export function SharesSection({
  albums,
  notify,
}: {
  albums: AdminAlbum[];
  notify: Notify;
}): ReactElement {
  const t = useT();
  const links = useAdminShares();
  const [tab, setTab] = useState<SharesTab>('existing');
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [editing, setEditing] = useState<AdminShareLink | null>(null);
  const [restoring, setRestoring] = useState<AdminShareLink | null>(null);
  const revoke = useRevokeShare();
  const remove = useDeleteShare();

  const confirm = (): void => {
    if (!pending) return;
    const done = { onSuccess: () => setPending(null), onError: () => setPending(null) };
    if (pending.action === 'revoke') revoke.mutate(pending.link.token, done);
    else remove.mutate(pending.link.token, done);
  };

  const filteredLinks = useMemo(() => {
    if (!links.data) return [];
    if (!search.trim()) return links.data;
    const q = search.trim().toLowerCase();
    return links.data.filter((link) => {
      const label = (link.label ?? describe(link, t)).toLowerCase();
      const album = (link.albumTitle ?? link.albumId).toLowerCase();
      const media = (link.mediaName ?? '').toLowerCase();
      const token = link.token.toLowerCase();
      return label.includes(q) || album.includes(q) || media.includes(q) || token.includes(q);
    });
  }, [links.data, search, t]);

  return (
    <Section title={t('shares.title')} description={t('shares.intro')}>
      {/* Sub-navigation tabs (D-01) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-850 px-4 py-3">
        <div className="flex gap-1 rounded-lg border border-ink-700 p-0.5">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'existing'}
            onClick={() => setTab('existing')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              tab === 'existing' ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-200'
            }`}
          >
            <span>{t('shares.tabExisting')}</span>
            {links.data && links.data.length > 0 && (
              <span className="rounded-full bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-300">
                {links.data.length}
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'create'}
            onClick={() => setTab('create')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              tab === 'create' ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-200'
            }`}
          >
            {t('shares.tabCreate')}
          </button>
        </div>

        {tab === 'existing' && links.data && links.data.length > 0 && (
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('shares.searchPlaceholder')}
            aria-label={t('shares.searchPlaceholder')}
            className="min-w-0 rounded-lg border border-ink-700 bg-ink-850 px-3 py-1 text-xs text-ink-100 outline-none placeholder:text-ink-500 focus:border-accent-dim sm:w-48"
          />
        )}
      </div>

      {tab === 'create' && (
        <ShareForm
          albums={albums}
          notify={notify}
          onCreated={() => {
            setSearch('');
            setTab('existing');
          }}
        />
      )}

      {tab === 'existing' && (
        <>
          {links.isPending && (
            <div className="px-4 py-6">
              <Spinner />
            </div>
          )}
          {links.error && (
            <div className="px-4 py-4">
              <FormError message={errorText(links.error, t('shares.createFailed'))} />
            </div>
          )}

          {links.data?.length === 0 && (
            <p className="px-4 py-6 text-sm text-ink-400">{t('shares.none')}</p>
          )}

          {links.data && links.data.length > 0 && filteredLinks.length === 0 && (
            <p className="px-4 py-6 text-sm text-ink-400">{t('shares.noSearchResults')}</p>
          )}

          {filteredLinks.map((link) => (
            <div key={link.token} className={`${ROW_CLASS} border-t border-ink-850 px-4 py-4`}>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm text-ink-100">
                  <span className="truncate">{link.label ?? describe(link, t)}</span>
                  <StateBadge state={link.state} />
                </p>
                <p className="mt-1 truncate text-xs text-ink-400">
                  {link.albumTitle ?? link.albumId}
                  {link.mediaName ? ` — ${link.mediaName}` : ''}
                </p>
                <p className="mt-1 text-xs text-ink-400">
                  {t('shares.issuedBy', link.createdBy, formatLocalDateTime(link.createdAt, t))}
                  {link.expiresAt
                    ? ` · ${t('shares.expiresOn', formatLocalDateTime(link.expiresAt, t))}`
                    : ''}
                </p>
                <p className="mt-1 text-xs text-ink-400">
                  {link.openings.length === 0
                    ? t('shares.neverOpened')
                    : `${t('shares.lastOpened', formatRelative(link.openings[0]!.openedAt, t) ?? '')} · ${t('shares.openings', link.openingCount)}`}
                </p>
              </div>

              <div className={ROW_ACTIONS_CLASS}>
                <CopyButton token={link.token} />

                {/* State-dependent actions (D-02) */}
                {link.state === 'live' && (
                  <>
                    <Button onClick={() => setEditing(link)}>{t('shares.edit')}</Button>
                    <Button onClick={() => setPending({ link, action: 'revoke' })}>
                      {t('shares.revoke')}
                    </Button>
                  </>
                )}

                {link.state === 'revoked' && (
                  <Button onClick={() => setRestoring(link)}>{t('shares.restore')}</Button>
                )}

                {link.state === 'expired' && (
                  <Button onClick={() => setEditing(link)}>{t('shares.extend')}</Button>
                )}

                <Button variant="danger" onClick={() => setPending({ link, action: 'delete' })}>
                  {t('shares.delete')}
                </Button>
              </div>
            </div>
          ))}
        </>
      )}

      {editing && (
        <EditShareDialog link={editing} onClose={() => setEditing(null)} notify={notify} />
      )}

      {restoring && (
        <RestoreShareDialog link={restoring} onClose={() => setRestoring(null)} notify={notify} />
      )}

      {pending && (
        <ConfirmDialog
          title={pending.link.label ?? describe(pending.link, t)}
          confirmLabel={t(pending.action === 'revoke' ? 'shares.revoke' : 'shares.delete')}
          busy={revoke.isPending || remove.isPending}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        >
          <p className="text-sm text-ink-300">
            {t(pending.action === 'revoke' ? 'shares.confirmRevoke' : 'shares.confirmDelete')}
          </p>
        </ConfirmDialog>
      )}
    </Section>
  );
}

function RestoreShareDialog({
  link,
  onClose,
  notify,
}: {
  link: AdminShareLink;
  onClose: () => void;
  notify: Notify;
}): ReactElement {
  const t = useT();
  const restore = useRestoreShare();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previous?.focus();
  }, []);

  const isPastExpiry = Boolean(link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now());
  const [expiresAt, setExpiresAt] = useState<string | null>(() => {
    if (isPastExpiry) {
      const d = new Date(Date.now() + 30 * 86_400_000);
      d.setSeconds(0, 0);
      return d.toISOString();
    }
    return link.expiresAt;
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    restore.mutate(
      {
        token: link.token,
        body: { expiresAt },
      },
      {
        onSuccess: () => {
          notify({ tone: 'ok', text: t('shares.restoreSuccess') });
          onClose();
        },
        onError: (error) => {
          notify({ tone: 'error', text: errorText(error, t('shares.restoreFailed')) });
        },
      },
    );
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
        aria-labelledby="restore-share-title"
        tabIndex={-1}
        className="w-full max-w-md rounded-xl border border-ink-800 bg-surface-base p-6 shadow-2xl outline-none"
      >
        <h2 id="restore-share-title" className="text-base font-medium text-ink-100">
          {t('shares.restoreTitle')}
        </h2>
        <p className="mt-1 truncate text-xs text-ink-400">
          {link.label ?? describe(link, t)} · {link.albumTitle ?? link.albumId}
        </p>

        <form onSubmit={submit} className="mt-4 space-y-4">
          <p className="text-xs text-ink-300">
            {isPastExpiry ? t('shares.restoreExpiredWarning') : t('shares.confirmRestore')}
          </p>

          <DateTimePicker
            id="restore-share-expires"
            label={t('shares.expiresAt')}
            value={expiresAt}
            onChange={setExpiresAt}
            hint={t('shares.expiresHint')}
            disabled={restore.isPending}
          />

          <div className="flex justify-end gap-3 pt-2">
            <Button onClick={onClose} disabled={restore.isPending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={restore.isPending}>
              {t('shares.restore')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditShareDialog({
  link,
  onClose,
  notify,
}: {
  link: AdminShareLink;
  onClose: () => void;
  notify: Notify;
}): ReactElement {
  const t = useT();
  const update = useUpdateShare();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previous?.focus();
  }, []);

  const [label, setLabel] = useState(link.label ?? '');
  const [expiresAt, setExpiresAt] = useState<string | null>(link.expiresAt);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    update.mutate(
      {
        token: link.token,
        body: {
          label: label.trim() || null,
          expiresAt,
        },
      },
      {
        onSuccess: () => {
          onClose();
        },
        onError: (error) => {
          notify({ tone: 'error', text: errorText(error, t('shares.updateFailed')) });
        },
      },
    );
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
        aria-labelledby="edit-share-title"
        tabIndex={-1}
        className="w-full max-w-md rounded-xl border border-ink-800 bg-surface-base p-6 shadow-2xl outline-none"
      >
        <h2 id="edit-share-title" className="text-base font-medium text-ink-100">
          {t('shares.editTitle')}
        </h2>
        <p className="mt-1 truncate text-xs text-ink-400">
          {link.albumTitle ?? link.albumId}
          {link.mediaName ? ` — ${link.mediaName}` : ''}
        </p>

        <form onSubmit={submit} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="edit-share-label"
              className="mb-1 block text-xs font-medium text-ink-300"
            >
              {t('shares.label')}
            </label>
            <input
              id="edit-share-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value.slice(0, SHARE_LABEL_MAX_LENGTH))}
              disabled={update.isPending}
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-ink-100 outline-none transition-colors placeholder:text-ink-400 focus:border-accent-dim disabled:opacity-60"
            />
            <p className="mt-1 text-xs text-ink-400">{t('shares.labelHint')}</p>
          </div>

          <DateTimePicker
            id="edit-share-expires"
            label={t('shares.expiresAt')}
            value={expiresAt}
            onChange={setExpiresAt}
            hint={t('shares.expiresHint')}
            disabled={update.isPending}
          />

          <div className="flex justify-end gap-3 pt-2">
            <Button onClick={onClose} disabled={update.isPending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={update.isPending}>
              {t('shares.save')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Issuing one. The form carries no `kind`: a photograph identifier makes it a
 * photograph link and leaving it empty makes it an album link, so the two cannot
 * disagree about what was asked for.
 */
function ShareForm({
  albums,
  notify,
  onCreated,
}: {
  albums: AdminAlbum[];
  notify: Notify;
  onCreated?: () => void;
}): ReactElement {
  const t = useT();
  const create = useCreateShare();
  const [albumId, setAlbumId] = useState(albums[0]?.id ?? '');
  const [mediaId, setMediaId] = useState('');
  const [label, setLabel] = useState('');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    create.mutate(
      {
        albumId,
        mediaId: mediaId.trim() || null,
        label: label.trim() || null,
        expiresAt,
      },
      {
        onSuccess: () => {
          setMediaId('');
          setLabel('');
          setExpiresAt(null);
          notify({ tone: 'ok', text: t('shares.createSuccess') });
          onCreated?.();
        },
        onError: (error) =>
          notify({ tone: 'error', text: errorText(error, t('shares.createFailed')) }),
      },
    );
  };

  return (
    <form onSubmit={submit} className="grid gap-4 px-4 py-4 sm:grid-cols-2">
      <SelectField
        id="share-album"
        label={t('shares.album')}
        value={albumId}
        options={albums.map((album) => ({ value: album.id, label: album.title }))}
        onChange={setAlbumId}
        disabled={create.isPending}
      />
      <TextField
        id="share-media"
        label={t('shares.mediaId')}
        value={mediaId}
        onChange={setMediaId}
        hint={t('shares.mediaHint')}
        disabled={create.isPending}
      />
      <TextField
        id="share-label"
        label={t('shares.label')}
        value={label}
        onChange={(value) => setLabel(value.slice(0, SHARE_LABEL_MAX_LENGTH))}
        hint={t('shares.labelHint')}
        disabled={create.isPending}
      />
      <div className="sm:col-span-2">
        <DateTimePicker
          id="share-expires"
          label={t('shares.expiresAt')}
          value={expiresAt}
          onChange={setExpiresAt}
          hint={t('shares.expiresHint')}
          disabled={create.isPending}
        />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" variant="primary" disabled={!albumId || create.isPending}>
          {t('shares.create')}
        </Button>
      </div>
    </form>
  );
}

/**
 * Copies the address, not the token.
 *
 * `origin` rather than a configured public URL: what is copied has to be what the
 * administrator's own browser reached this page on, or a link sent from a machine on
 * the local network would carry an address nobody outside it can open.
 */
function CopyButton({ token }: { token: string }): ReactElement {
  const t = useT();
  const [copied, setCopied] = useState(false);

  return (
    <Button
      onClick={() => {
        void navigator.clipboard.writeText(`${window.location.origin}/s/${token}`).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {t(copied ? 'shares.copied' : 'shares.copy')}
    </Button>
  );
}

const STATE_LABEL: Record<AdminShareLink['state'], MessageKey> = {
  live: 'shares.stateLive',
  revoked: 'shares.stateRevoked',
  expired: 'shares.stateExpired',
};

/**
 * Working, taken back, or expired.
 *
 * The two dead states share one muted treatment: what the row's reader does about
 * either is the same, and only the accompanying sentence differs.
 */
function StateBadge({ state }: { state: AdminShareLink['state'] }): ReactElement {
  const t = useT();
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
        state === 'live' ? 'bg-accent-soft text-ink-100' : 'bg-ink-800 text-ink-400'
      }`}
    >
      {t(STATE_LABEL[state])}
    </span>
  );
}

/** What to call a link nobody gave a label. */
function describe(link: AdminShareLink, t: Translate): string {
  return t(link.kind === 'album' ? 'shares.kindAlbum' : 'shares.kindMedia');
}
