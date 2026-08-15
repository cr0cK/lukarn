import type { AdminAlbum, StorageConnectionStatus, SyncStatus } from '@lukarn/shared';
import { type ReactElement, useState } from 'react';
import { errorText } from '../../api/client';
import { useDeleteAlbum, useResync, useUpdateAlbum } from '../../api/hooks';
import { formatRelative } from '../../lib/format';
import { useT, type Translate } from '../../lib/i18n';
import { AlbumForm } from './AlbumForm';
import { ConfirmDialog } from './ConfirmDialog';
import { Button, ROW_ACTIONS_CLASS, ROW_CLASS, Section, type Notify } from './ui';

const SYNC_LABELS: Record<SyncStatus, { text: Parameters<Translate>[0]; className: string }> = {
  never: { text: 'adminAlbums.statusNever', className: 'text-ink-400' },
  running: { text: 'adminAlbums.statusRunning', className: 'text-accent' },
  ok: { text: 'adminAlbums.statusOk', className: 'text-emerald-400' },
  error: { text: 'adminAlbums.statusError', className: 'text-red-400' },
};

interface AlbumsSectionProps {
  albums: AdminAlbum[];
  /**
   * The instance's storages. An album can only resynchronise if **its own** is
   * connected: with several, one revoked Drive must not grey out the button of an
   * album reading a bucket that answers perfectly well.
   */
  storage: StorageConnectionStatus[];
  notify: Notify;
}

/** "Albums" section: list, create, edit, delete and resynchronise. */
export function AlbumsSection({ albums, storage, notify }: AlbumsSectionProps): ReactElement {
  const t = useT();
  const resync = useResync();
  const remove = useDeleteAlbum();
  const update = useUpdateAlbum();

  const connected = new Set(
    storage.filter((connection) => connection.connected).map((connection) => connection.id),
  );
  const anyConnected = connected.size > 0;

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AdminAlbum | null>(null);

  const startResync = (albumId?: string): void => {
    resync.mutate(albumId, {
      onSuccess: ({ started }) =>
        notify({
          tone: 'ok',
          text: started.length
            ? t('adminAlbums.syncStarted', started.join(', '))
            : t('adminAlbums.nothingToSync'),
        }),
      onError: (error) =>
        notify({ tone: 'error', text: errorText(error, t('adminAlbums.syncFailed')) }),
    });
  };

  /**
   * Returns cover selection to automatic. The reverse action — choosing a photo
   * — happens in the album on the photo itself: a picker here would reproduce the
   * grid without adding anything, and a cover is chosen while viewing it large.
   */
  const clearCover = (album: AdminAlbum): void => {
    update.mutate(
      { albumId: album.id, body: { coverId: null } },
      {
        onSuccess: () => notify({ tone: 'ok', text: t('adminAlbums.coverCleared', album.title) }),
        onError: (error) =>
          notify({ tone: 'error', text: errorText(error, t('adminAlbums.updateFailed')) }),
      },
    );
  };

  const confirmDelete = (album: AdminAlbum): void => {
    remove.mutate(album.id, {
      onSuccess: () => {
        notify({ tone: 'ok', text: t('adminAlbums.deleted', album.title) });
        setConfirming(null);
      },
      onError: (error) => {
        notify({ tone: 'error', text: errorText(error, t('adminAlbums.deleteFailed')) });
        setConfirming(null);
      },
    });
  };

  return (
    <Section
      title={t('adminAlbums.title')}
      description={t('adminAlbums.description')}
      action={
        <div className="flex gap-2">
          <Button
            onClick={() => startResync(undefined)}
            disabled={!anyConnected || resync.isPending}
            title={anyConnected ? undefined : t('adminAlbums.noStorage')}
          >
            {t('adminAlbums.resyncAll')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setCreating(true);
            }}
            disabled={creating}
          >
            {t('adminAlbums.new')}
          </Button>
        </div>
      }
    >
      {creating && (
        <AlbumForm storage={storage} onClose={() => setCreating(false)} notify={notify} />
      )}

      {albums.length === 0 && !creating && (
        <p className="px-4 py-6 text-sm text-ink-400">{t('adminAlbums.none')}</p>
      )}

      {albums.map((album) =>
        editing === album.id ? (
          <AlbumForm
            key={album.id}
            album={album}
            storage={storage}
            onClose={() => setEditing(null)}
            notify={notify}
          />
        ) : (
          <div
            key={album.id}
            className={`${ROW_CLASS} border-b border-ink-850 px-4 py-3 last:border-b-0 xl:items-center`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink-100">{album.title}</p>
              <p className="truncate text-xs text-ink-400">
                <code>{album.id}</code> · {t('adminAlbums.itemCount', album.itemCount)}
                {/* Named only when there is a choice: on a single-storage instance
                    it would be the same word under every album. */}
                {storage.length > 1
                  ? ` · ${storage.find((c) => c.id === album.connectionId)?.label ?? album.connectionId}`
                  : ''}
                {album.recursive ? ` · ${t('adminAlbums.recursive')}` : ''}
                {formatRelative(album.lastSyncAt, t)
                  ? ` · ${t('adminAlbums.syncedAgo', formatRelative(album.lastSyncAt, t)!)}`
                  : ''}
              </p>
              <p className="truncate text-xs text-ink-400">
                {album.members.length > 0
                  ? t('adminAlbums.assignedTo', album.members.join(', '))
                  : t('adminAlbums.assignedToNobody')}
              </p>
              {album.syncError && (
                <p className="mt-1 text-xs break-words text-red-400">{album.syncError}</p>
              )}
            </div>

            {/* Sync status opens the action group rather than closing metadata:
                it is read before deciding to resynchronise, and thus stays next
                to the button it prompts once the row stacks. */}
            <div className={ROW_ACTIONS_CLASS}>
              <span className={`mr-1 text-xs ${SYNC_LABELS[album.syncStatus].className}`}>
                {t(SYNC_LABELS[album.syncStatus].text)}
              </span>

              <Button
                onClick={() => startResync(album.id)}
                disabled={album.syncStatus === 'running' || !connected.has(album.connectionId)}
                ariaLabel={t('adminAlbums.resyncAlbum', album.title)}
              >
                {t('adminAlbums.resync')}
              </Button>

              {/* Its presence alone says a cover was selected: the metadata row
                  above is truncated as the window narrows, and an unseen
                  indicator is no indicator. */}
              {album.coverId && (
                <Button
                  onClick={() => clearCover(album)}
                  disabled={update.isPending}
                  title={t('adminAlbums.automaticCoverHint')}
                  ariaLabel={t('adminAlbums.automaticCoverLabel', album.title)}
                >
                  {t('adminAlbums.automaticCover')}
                </Button>
              )}

              <Button
                onClick={() => {
                  setCreating(false);
                  setEditing(album.id);
                }}
                ariaLabel={t('adminAlbums.editAlbum', album.title)}
              >
                {t('adminAlbums.edit')}
              </Button>

              <Button
                variant="danger"
                onClick={() => setConfirming(album)}
                ariaLabel={t('adminAlbums.deleteAlbum', album.title)}
              >
                {t('adminAlbums.delete')}
              </Button>
            </div>
          </div>
        ),
      )}

      {confirming && (
        <ConfirmDialog
          title={t('adminAlbums.confirmTitle', confirming.title)}
          confirmLabel={t('adminAlbums.confirmButton')}
          busy={remove.isPending}
          onConfirm={() => confirmDelete(confirming)}
          onCancel={() => setConfirming(null)}
        >
          <p>{t('adminAlbums.confirmMedia', confirming.itemCount)}</p>
          <p className="text-ink-200">
            {t('adminAlbums.confirmDrive')} <code className="break-all">{confirming.folderId}</code>
            {t('adminAlbums.confirmDriveEnd')}
          </p>
        </ConfirmDialog>
      )}
    </Section>
  );
}
