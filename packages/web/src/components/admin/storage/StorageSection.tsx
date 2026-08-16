import type { AdminStatus, StorageConnectionStatus } from '@lukarn/shared';
import { type ReactElement, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorText } from '../../../api/client';
import { useAdminAlbums, useAdminStorage, useDeleteStorage } from '../../../api/hooks';
import { useT, type MessageKey } from '../../../lib/i18n';
import { Spinner } from '../../Spinner';
import { ConfirmDialog } from '../ConfirmDialog';
import { Button, FormError, Section, type Notice, type Notify } from '../ui';
import { StorageForm } from './StorageForm';
import { StorageRow } from './StorageRow';

/**
 * Messages from the Google consent return, passed in `?oauth=`.
 *
 * They live beside the section the callback redirects to rather than beside the banner
 * that shows them: the return is an answer to the Connect button, and moving that
 * button would otherwise leave its answer behind on another screen.
 */
export const OAUTH_MESSAGES: Record<string, { tone: Notice['tone']; text: MessageKey }> = {
  connected: { tone: 'ok', text: 'admin.oauthConnected' },
  denied: { tone: 'error', text: 'admin.oauthDenied' },
  invalid: { tone: 'error', text: 'admin.oauthInvalid' },
  state_mismatch: { tone: 'error', text: 'admin.oauthStateMismatch' },
  error: { tone: 'error', text: 'admin.oauthError' },
};

/**
 * "Storage" section: every backend this instance reads, and what state each is in.
 *
 * One instance may read several — a Drive for the family album and a bucket for the
 * archives — so this is a **list** rather than the single connection panel of 1.1.
 * Each row states the one thing that decides whether its albums work: can this
 * storage serve bytes right now, and if not, why not.
 */
export function StorageSection({
  status,
  notify,
}: {
  status: AdminStatus;
  notify: Notify;
}): ReactElement {
  const t = useT();
  const connections = useAdminStorage();
  // Read without being waited on, like the moderation queue's album filter: the list
  // of connections is what this screen is opened for, and only the deletion dialog
  // needs album titles. TanStack Query shares the request `AdminPage` already made.
  const albums = useAdminAlbums();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<StorageConnectionStatus | null>(null);
  const remove = useDeleteStorage();

  const readers = confirming
    ? (albums.data ?? []).filter((album) => album.connectionId === confirming.id)
    : [];

  const confirmDelete = (connection: StorageConnectionStatus): void => {
    remove.mutate(connection.id, {
      onSuccess: () => {
        notify({ tone: 'ok', text: t('storage.deleted', connection.label) });
        setConfirming(null);
      },
      onError: (error) => {
        notify({ tone: 'error', text: errorText(error, t('storage.deleteFailed')) });
        setConfirming(null);
      },
    });
  };

  return (
    <Section
      title={t('storage.title')}
      description={t('storage.description')}
      action={
        <Button
          variant="primary"
          onClick={() => {
            setEditing(null);
            setAdding(true);
          }}
          disabled={adding}
        >
          {t('storage.add')}
        </Button>
      }
    >
      {adding && (
        <StorageForm
          kinds={status.storageKinds}
          localRoot={status.storageLocalRoot}
          onClose={() => setAdding(false)}
          notify={notify}
        />
      )}

      {connections.isPending && <Spinner />}
      {connections.error && (
        <FormError message={errorText(connections.error, t('storage.loadFailed'))} />
      )}

      {connections.data?.map((connection) =>
        editing === connection.id ? (
          <StorageForm
            key={connection.id}
            connection={connection}
            kinds={status.storageKinds}
            localRoot={status.storageLocalRoot}
            onClose={() => setEditing(null)}
            notify={notify}
          />
        ) : (
          <StorageRow
            key={connection.id}
            connection={connection}
            oauthConfigured={status.oauthConfigured}
            notify={notify}
            onEdit={() => {
              setAdding(false);
              setEditing(connection.id);
            }}
            onDelete={() => setConfirming(connection)}
          />
        ),
      )}

      {confirming && (
        <ConfirmDialog
          title={t('storage.confirmTitle', confirming.label)}
          confirmLabel={t('storage.confirmButton')}
          busy={remove.isPending}
          // The server refuses this while an album reads the connection, and names the
          // albums when it does. Naming them here instead turns that refusal from the
          // way it is discovered into something that never has to be reached.
          confirmDisabled={confirming.albumCount > 0}
          onConfirm={() => confirmDelete(confirming)}
          onCancel={() => setConfirming(null)}
        >
          {confirming.albumCount > 0 ? (
            <>
              <p>{t('storage.confirmInUse', confirming.albumCount)}</p>
              {/* Titles rather than a count: "move them first" is only actionable
                  once it says which. They arrive with the album list, so the count
                  above carries the sentence on its own until then. */}
              {readers.length > 0 && (
                <ul className="list-inside list-disc text-ink-200">
                  {readers.map((album) => (
                    <li key={album.id}>{album.title}</li>
                  ))}
                </ul>
              )}
              <p>
                <Link
                  to="/admin/albums"
                  className="text-accent underline underline-offset-2"
                  onClick={() => setConfirming(null)}
                >
                  {t('storage.confirmMoveThem')}
                </Link>
              </p>
            </>
          ) : (
            /* Nothing leaves the storage itself: this removes how the instance
               reaches it, which is what makes the sentence worth writing. */
            <p>{t('storage.confirmNothingDeleted')}</p>
          )}
        </ConfirmDialog>
      )}
    </Section>
  );
}
