import type { AdminAlbum, AdminUser } from '@lukarn/shared';
import { type ReactElement, useMemo, useState } from 'react';
import { errorText } from '../../api/client';
import { useAdminUsers, useDeleteUser, useMe } from '../../api/hooks';
import { formatAlbumAccess } from '../../lib/adminForm';
import { Spinner } from '../Spinner';
import { ConfirmDialog } from './ConfirmDialog';
import { UserForm } from './UserForm';
import { Button, FormError, ROW_ACTIONS_CLASS, ROW_CLASS, Section, type Notify } from './ui';

/** "Accounts" section: list, create, edit and delete accounts. */
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
        notify({ tone: 'ok', text: `Account "${user.username}" deleted.` });
        setConfirming(null);
      },
      onError: (deleteError) => {
        notify({ tone: 'error', text: errorText(deleteError, 'Cannot delete.') });
        setConfirming(null);
      },
    });
  };

  return (
    <Section
      title="Accounts"
      description="Who can sign in, and to which albums."
      action={
        <Button
          variant="primary"
          onClick={() => {
            setEditing(null);
            setCreating(true);
          }}
          disabled={creating}
        >
          New account
        </Button>
      }
    >
      {creating && <UserForm albums={albums} onClose={() => setCreating(false)} notify={notify} />}

      {isPending && (
        <div className="px-4 py-6">
          <Spinner label="Loading accounts" />
        </div>
      )}

      {error && (
        <div className="px-4 py-4">
          <FormError message={errorText(error, 'Cannot load the accounts.')} />
        </div>
      )}

      {users?.length === 0 && !creating && (
        <p className="px-4 py-6 text-sm text-ink-400">
          No account. Create one so that someone can sign in.
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
              {/* Apply `truncate` only to the identifier and `shrink-0` to the
                  labels after it: on the whole row, the badge shrank with the
                  rest and "administrator" appeared as "administ". Half a role
                  reads like another role. */}
              <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink-100">
                <span className="truncate">{user.username}</span>
                {user.admin && (
                  <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-normal text-accent">
                    administrator
                  </span>
                )}
                {user.username === me?.username && (
                  <span className="shrink-0 text-xs font-normal text-ink-400">(you)</span>
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
                ariaLabel={`Edit account ${user.username}`}
              >
                Edit
              </Button>

              <Button
                variant="danger"
                onClick={() => setConfirming(user)}
                disabled={user.username === me?.username}
                ariaLabel={`Delete account ${user.username}`}
                title={
                  user.username === me?.username ? "You can't delete your own account." : undefined
                }
              >
                Delete
              </Button>
            </div>
          </div>
        ),
      )}

      {confirming && (
        <ConfirmDialog
          title={`Delete account "${confirming.username}"?`}
          confirmLabel={`Delete ${confirming.username}`}
          busy={remove.isPending}
          onConfirm={() => confirmDelete(confirming)}
          onCancel={() => setConfirming(null)}
        >
          <p>This account will no longer be able to sign in.</p>
          <p>The albums and the indexed media are untouched.</p>
        </ConfirmDialog>
      )}
    </Section>
  );
}
