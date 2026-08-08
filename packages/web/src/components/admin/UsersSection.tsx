import type { AdminAlbum, AdminUser } from '@gdv/shared';
import { type ReactElement, useMemo, useState } from 'react';
import { errorText } from '../../api/client';
import { useAdminUsers, useDeleteUser, useMe } from '../../api/hooks';
import { formatAlbumAccess } from '../../lib/adminForm';
import { Spinner } from '../Spinner';
import { ConfirmDialog } from './ConfirmDialog';
import { UserForm } from './UserForm';
import { Button, FormError, ROW_ACTIONS_CLASS, ROW_CLASS, Section, type Notify } from './ui';

/** Rubrique « Comptes » : liste des comptes, création, modification, suppression. */
export function UsersSection({
  albums,
  notify,
}: {
  albums: AdminAlbum[];
  notify: Notify;
}): ReactElement {
  const { data: users, isPending, error } = useAdminUsers();
  const { data: me } = useMe();
  const remove = useDeleteUser();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AdminUser | null>(null);

  const titles = useMemo(() => new Map(albums.map((album) => [album.id, album.title])), [albums]);

  const confirmDelete = (user: AdminUser): void => {
    remove.mutate(user.username, {
      onSuccess: () => {
        notify({ tone: 'ok', text: `Compte « ${user.username} » supprimé.` });
        setConfirming(null);
      },
      onError: (deleteError) => {
        notify({ tone: 'error', text: errorText(deleteError, 'Suppression impossible.') });
        setConfirming(null);
      },
    });
  };

  return (
    <Section
      title="Comptes"
      description="Qui peut se connecter, et à quels albums."
      action={
        <Button
          variant="primary"
          onClick={() => {
            setEditing(null);
            setCreating(true);
          }}
          disabled={creating}
        >
          Nouveau compte
        </Button>
      }
    >
      {creating && <UserForm albums={albums} onClose={() => setCreating(false)} notify={notify} />}

      {isPending && (
        <div className="px-4 py-6">
          <Spinner label="Chargement des comptes" />
        </div>
      )}

      {error && (
        <div className="px-4 py-4">
          <FormError message={errorText(error, 'Impossible de charger les comptes.')} />
        </div>
      )}

      {users?.length === 0 && !creating && (
        <p className="px-4 py-6 text-sm text-ink-400">
          Aucun compte. Crée-en un pour permettre une connexion.
        </p>
      )}

      {users?.map((user) =>
        editing === user.username ? (
          <UserForm
            key={user.username}
            albums={albums}
            user={user}
            isSelf={user.username === me?.username}
            onClose={() => setEditing(null)}
            notify={notify}
          />
        ) : (
          <div
            key={user.username}
            className={`${ROW_CLASS} border-b border-ink-850 px-4 py-3 last:border-b-0 xl:items-center`}
          >
            <div className="min-w-0 flex-1">
              {/* `truncate` sur le seul identifiant, et les mentions qui le
                  suivent en `shrink-0` : posé sur la ligne entière, il laissait
                  le badge se rétracter avec le reste et « administrateur »
                  s'affichait « administ ». Un rôle à moitié écrit se lit comme
                  un autre rôle. */}
              <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink-100">
                <span className="truncate">{user.username}</span>
                {user.admin && (
                  <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-normal text-accent">
                    administrateur
                  </span>
                )}
                {user.username === me?.username && (
                  <span className="shrink-0 text-xs font-normal text-ink-400">(toi)</span>
                )}
              </p>
              <p className="truncate text-xs text-ink-400">
                {formatAlbumAccess(user.albums, titles)}
              </p>
            </div>

            <div className={ROW_ACTIONS_CLASS}>
              <Button
                onClick={() => {
                  setCreating(false);
                  setEditing(user.username);
                }}
                ariaLabel={`Modifier le compte ${user.username}`}
              >
                Modifier
              </Button>

              <Button
                variant="danger"
                onClick={() => setConfirming(user)}
                disabled={user.username === me?.username}
                ariaLabel={`Supprimer le compte ${user.username}`}
                title={
                  user.username === me?.username
                    ? 'Tu ne peux pas supprimer ton propre compte.'
                    : undefined
                }
              >
                Supprimer
              </Button>
            </div>
          </div>
        ),
      )}

      {confirming && (
        <ConfirmDialog
          title={`Supprimer le compte « ${confirming.username} » ?`}
          confirmLabel={`Supprimer ${confirming.username}`}
          busy={remove.isPending}
          onConfirm={() => confirmDelete(confirming)}
          onCancel={() => setConfirming(null)}
        >
          <p>Ce compte ne pourra plus se connecter.</p>
          <p>Les albums et les médias indexés ne sont pas touchés.</p>
        </ConfirmDialog>
      )}
    </Section>
  );
}
