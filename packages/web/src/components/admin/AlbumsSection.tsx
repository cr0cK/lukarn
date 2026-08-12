import type { AdminAlbum, SyncStatus } from '@nonni/shared';
import { type ReactElement, useState } from 'react';
import { errorText } from '../../api/client';
import { useDeleteAlbum, useResync, useUpdateAlbum } from '../../api/hooks';
import { formatRelative } from '../../lib/format';
import { AlbumForm } from './AlbumForm';
import { ConfirmDialog } from './ConfirmDialog';
import { Button, ROW_ACTIONS_CLASS, ROW_CLASS, Section, type Notify } from './ui';

const SYNC_LABELS: Record<SyncStatus, { text: string; className: string }> = {
  never: { text: 'never synced', className: 'text-ink-400' },
  running: { text: 'sync in progress', className: 'text-accent' },
  ok: { text: 'up to date', className: 'text-emerald-400' },
  error: { text: 'failed', className: 'text-red-400' },
};

interface AlbumsSectionProps {
  albums: AdminAlbum[];
  /** No sync can start without a connected Drive account. */
  driveConnected: boolean;
  notify: Notify;
}

/** "Albums" section: list, create, edit, delete and resynchronise. */
export function AlbumsSection({
  albums,
  driveConnected,
  notify,
}: AlbumsSectionProps): ReactElement {
  const resync = useResync();
  const remove = useDeleteAlbum();
  const update = useUpdateAlbum();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AdminAlbum | null>(null);

  const startResync = (albumId?: string): void => {
    resync.mutate(albumId, {
      onSuccess: ({ started }) =>
        notify({
          tone: 'ok',
          text: started.length ? `Sync started: ${started.join(', ')}` : 'No album to sync.',
        }),
      onError: (error) => notify({ tone: 'error', text: errorText(error, 'Cannot sync.') }),
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
        onSuccess: () =>
          notify({
            tone: 'ok',
            text: `Album "${album.title}" takes its most recent photo as cover again.`,
          }),
        onError: (error) => notify({ tone: 'error', text: errorText(error, 'Cannot update.') }),
      },
    );
  };

  const confirmDelete = (album: AdminAlbum): void => {
    remove.mutate(album.id, {
      onSuccess: () => {
        notify({ tone: 'ok', text: `Album "${album.title}" deleted.` });
        setConfirming(null);
      },
      onError: (error) => {
        notify({ tone: 'error', text: errorText(error, 'Cannot delete.') });
        setConfirming(null);
      },
    });
  };

  return (
    <Section
      title="Albums"
      description="One album = one indexed Google Drive folder. Its cover is chosen on the photo, from the album."
      action={
        <div className="flex gap-2">
          <Button
            onClick={() => startResync(undefined)}
            disabled={!driveConnected || resync.isPending}
            title={driveConnected ? undefined : 'No Google Drive account connected.'}
          >
            Resync everything
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setCreating(true);
            }}
            disabled={creating}
          >
            New album
          </Button>
        </div>
      }
    >
      {creating && <AlbumForm onClose={() => setCreating(false)} notify={notify} />}

      {albums.length === 0 && !creating && (
        <p className="px-4 py-6 text-sm text-ink-400">
          No album. Create one from a folder of your Drive.
        </p>
      )}

      {albums.map((album) =>
        editing === album.id ? (
          <AlbumForm
            key={album.id}
            album={album}
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
                <code>{album.id}</code> · {album.itemCount.toLocaleString('en-GB')} items
                {album.recursive ? ' · subfolders included' : ''}
                {formatRelative(album.lastSyncAt)
                  ? ` · synced ${formatRelative(album.lastSyncAt)}`
                  : ''}
              </p>
              <p className="truncate text-xs text-ink-400">
                {album.members.length > 0
                  ? `Assigned to ${album.members.join(', ')}`
                  : 'Assigned to no account by name'}
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
                {SYNC_LABELS[album.syncStatus].text}
              </span>

              <Button
                onClick={() => startResync(album.id)}
                disabled={album.syncStatus === 'running' || !driveConnected}
                ariaLabel={`Resync album ${album.title}`}
              >
                Resync
              </Button>

              {/* Its presence alone says a cover was selected: the metadata row
                  above is truncated as the window narrows, and an unseen
                  indicator is no indicator. */}
              {album.coverId && (
                <Button
                  onClick={() => clearCover(album)}
                  disabled={update.isPending}
                  title="A photo was chosen as cover. Give the album its most recent photo back."
                  ariaLabel={`Make the cover of album ${album.title} automatic again`}
                >
                  Automatic cover
                </Button>
              )}

              <Button
                onClick={() => {
                  setCreating(false);
                  setEditing(album.id);
                }}
                ariaLabel={`Edit album ${album.title}`}
              >
                Edit
              </Button>

              <Button
                variant="danger"
                onClick={() => setConfirming(album)}
                ariaLabel={`Delete album ${album.title}`}
              >
                Delete
              </Button>
            </div>
          </div>
        ),
      )}

      {confirming && (
        <ConfirmDialog
          title={`Delete album "${confirming.title}"?`}
          confirmLabel="Delete the album"
          busy={remove.isPending}
          onConfirm={() => confirmDelete(confirming)}
          onCancel={() => setConfirming(null)}
        >
          <p>
            The {confirming.itemCount.toLocaleString('en-GB')} indexed media are removed from the
            viewer, and the album disappears for the accounts that could reach it.
          </p>
          <p className="text-ink-200">
            Nothing is deleted in Google Drive: the files stay in folder{' '}
            <code className="break-all">{confirming.folderId}</code>. Recreating the album on the
            same folder will reindex it.
          </p>
        </ConfirmDialog>
      )}
    </Section>
  );
}
