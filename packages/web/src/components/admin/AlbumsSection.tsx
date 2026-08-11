import type { AdminAlbum, SyncStatus } from '@nonni/shared';
import { type ReactElement, useState } from 'react';
import { errorText } from '../../api/client';
import { useDeleteAlbum, useResync, useUpdateAlbum } from '../../api/hooks';
import { formatRelative } from '../../lib/format';
import { AlbumForm } from './AlbumForm';
import { ConfirmDialog } from './ConfirmDialog';
import { Button, ROW_ACTIONS_CLASS, ROW_CLASS, Section, type Notify } from './ui';

const SYNC_LABELS: Record<SyncStatus, { text: string; className: string }> = {
  never: { text: 'jamais synchronisé', className: 'text-ink-400' },
  running: { text: 'synchronisation en cours', className: 'text-accent' },
  ok: { text: 'à jour', className: 'text-emerald-400' },
  error: { text: 'en erreur', className: 'text-red-400' },
};

interface AlbumsSectionProps {
  albums: AdminAlbum[];
  /** Sans compte Drive connecté, aucune synchronisation ne peut partir. */
  driveConnected: boolean;
  notify: Notify;
}

/** Section « Albums » : liste, création, modification, suppression, resynchronisation. */
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
          text: started.length
            ? `Synchronisation lancée : ${started.join(', ')}`
            : 'Aucun album à synchroniser.',
        }),
      onError: (error) =>
        notify({ tone: 'error', text: errorText(error, 'Synchronisation impossible.') }),
    });
  };

  /**
   * Rend la couverture au choix automatique. Le geste inverse — désigner une
   * photo — se fait dans l'album, sur la photo elle-même : un sélecteur ici
   * rejouerait la grille sans rien apporter, et on choisit une couverture en la
   * regardant en grand.
   */
  const clearCover = (album: AdminAlbum): void => {
    update.mutate(
      { albumId: album.id, body: { coverId: null } },
      {
        onSuccess: () =>
          notify({
            tone: 'ok',
            text: `L'album « ${album.title} » reprend sa photo la plus récente en couverture.`,
          }),
        onError: (error) =>
          notify({ tone: 'error', text: errorText(error, 'Modification impossible.') }),
      },
    );
  };

  const confirmDelete = (album: AdminAlbum): void => {
    remove.mutate(album.id, {
      onSuccess: () => {
        notify({ tone: 'ok', text: `Album « ${album.title} » supprimé.` });
        setConfirming(null);
      },
      onError: (error) => {
        notify({ tone: 'error', text: errorText(error, 'Suppression impossible.') });
        setConfirming(null);
      },
    });
  };

  return (
    <Section
      title="Albums"
      description="Un album = un dossier Google Drive indexé. Sa couverture se choisit sur la photo, depuis l'album."
      action={
        <div className="flex gap-2">
          <Button
            onClick={() => startResync(undefined)}
            disabled={!driveConnected || resync.isPending}
            title={driveConnected ? undefined : 'Aucun compte Google Drive connecté.'}
          >
            Tout resynchroniser
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setCreating(true);
            }}
            disabled={creating}
          >
            Nouvel album
          </Button>
        </div>
      }
    >
      {creating && <AlbumForm onClose={() => setCreating(false)} notify={notify} />}

      {albums.length === 0 && !creating && (
        <p className="px-4 py-6 text-sm text-ink-400">
          Aucun album. Crée-en un à partir d'un dossier de ton Drive.
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
                <code>{album.id}</code> · {album.itemCount.toLocaleString('fr-FR')} éléments
                {album.recursive ? ' · sous-dossiers inclus' : ''}
                {formatRelative(album.lastSyncAt)
                  ? ` · synchronisé ${formatRelative(album.lastSyncAt)}`
                  : ''}
              </p>
              <p className="truncate text-xs text-ink-400">
                {album.members.length > 0
                  ? `Attribué à ${album.members.join(', ')}`
                  : 'Attribué à aucun compte nommément'}
              </p>
              {album.syncError && (
                <p className="mt-1 text-xs break-words text-red-400">{album.syncError}</p>
              )}
            </div>

            {/* L'état de synchronisation ouvre le groupe d'actions au lieu de
                fermer les métadonnées : c'est lui qu'on lit avant de décider de
                resynchroniser, et il reste ainsi contre le bouton qu'il appelle
                une fois la ligne empilée. */}
            <div className={ROW_ACTIONS_CLASS}>
              <span className={`mr-1 text-xs ${SYNC_LABELS[album.syncStatus].className}`}>
                {SYNC_LABELS[album.syncStatus].text}
              </span>

              <Button
                onClick={() => startResync(album.id)}
                disabled={album.syncStatus === 'running' || !driveConnected}
                ariaLabel={`Resynchroniser l'album ${album.title}`}
              >
                Resynchroniser
              </Button>

              {/* Sa seule présence dit qu'une couverture a été choisie : la ligne
                  de métadonnées au-dessus est tronquée dès que la fenêtre se
                  resserre, et un indicateur qu'on ne voit pas n'en est pas un. */}
              {album.coverId && (
                <Button
                  onClick={() => clearCover(album)}
                  disabled={update.isPending}
                  title="Une photo a été choisie comme couverture. Rendre à l'album sa photo la plus récente."
                  ariaLabel={`Rendre automatique la couverture de l'album ${album.title}`}
                >
                  Couverture automatique
                </Button>
              )}

              <Button
                onClick={() => {
                  setCreating(false);
                  setEditing(album.id);
                }}
                ariaLabel={`Modifier l'album ${album.title}`}
              >
                Modifier
              </Button>

              <Button
                variant="danger"
                onClick={() => setConfirming(album)}
                ariaLabel={`Supprimer l'album ${album.title}`}
              >
                Supprimer
              </Button>
            </div>
          </div>
        ),
      )}

      {confirming && (
        <ConfirmDialog
          title={`Supprimer l'album « ${confirming.title} » ?`}
          confirmLabel="Supprimer l'album"
          busy={remove.isPending}
          onConfirm={() => confirmDelete(confirming)}
          onCancel={() => setConfirming(null)}
        >
          <p>
            Les {confirming.itemCount.toLocaleString('fr-FR')} médias indexés sont retirés de la
            visionneuse, et l'album disparaît pour les comptes qui y avaient accès.
          </p>
          <p className="text-ink-200">
            Rien n'est supprimé dans Google Drive : les fichiers restent dans le dossier{' '}
            <code className="break-all">{confirming.folderId}</code>. Recréer l'album sur le même
            dossier le réindexera.
          </p>
        </ConfirmDialog>
      )}
    </Section>
  );
}
