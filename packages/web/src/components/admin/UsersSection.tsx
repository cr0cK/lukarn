import type { AccountState, AdminAlbum, AdminUser } from '@lukarn/shared';
import { type ReactElement, useMemo, useState } from 'react';
import { errorText } from '../../api/client';
import {
  useAdminStatus,
  useAdminUsers,
  useDeleteUser,
  useInviteUser,
  useMe,
} from '../../api/hooks';
import { formatAlbumAccess, validateEmail } from '../../lib/adminForm';
import { formatDate } from '../../lib/format';
import { useT } from '../../lib/i18n';
import type { MessageKey, Translate } from '../../lib/i18n/translate';
import { Spinner } from '../Spinner';
import { ConfirmDialog } from './ConfirmDialog';
import { UserForm } from './UserForm';
import {
  Button,
  FormError,
  ROW_ACTIONS_CLASS,
  ROW_CLASS,
  Section,
  TextField,
  type Notify,
} from './ui';

/**
 * Colour of the state badge, by state.
 *
 * "No way in" is deliberately the loudest of the four: an invitation that expired
 * unread is the one thing about an account that nothing else reports, and a grey
 * label reading "no way in" is a grey label nobody reads. The other three describe
 * a working account and say so quietly.
 */
const STATE_BADGE: Record<AccountState, string> = {
  shared_key: 'bg-ink-800 text-ink-300',
  person: 'bg-emerald-500/15 text-emerald-300',
  invited: 'bg-amber-500/10 text-amber-200',
  no_way_in: 'border border-red-500/40 bg-red-500/15 font-medium text-red-300',
};

const STATE_LABEL = {
  shared_key: 'adminUsers.stateSharedKey',
  person: 'adminUsers.statePerson',
  invited: 'adminUsers.stateInvited',
  no_way_in: 'adminUsers.stateNoWayIn',
} as const satisfies Record<AccountState, MessageKey>;

/**
 * The sentence under the badge: what that state means for this account.
 *
 * Driven by `state` rather than by whichever field happens to be filled, because an
 * invitation is also in flight on accounts whose state is `shared_key` — reading
 * `invitation` first printed the invitation sentence twice on those rows, once here
 * and once on the line below that exists for exactly that case.
 */
function stateDetail(user: AdminUser, t: Translate): string {
  switch (user.state) {
    case 'person':
      return user.identity
        ? t('adminUsers.statePersonDetail', user.identity.displayName, user.identity.email)
        : t('adminUsers.statePerson');
    case 'invited':
      return user.invitation
        ? t(
            'adminUsers.stateInvitedDetail',
            user.invitation.email,
            formatDate(user.invitation.expiresAt, t),
          )
        : t('adminUsers.stateInvited');
    case 'no_way_in':
      return t('adminUsers.stateNoWayInDetail');
    case 'shared_key':
      return t('adminUsers.stateSharedKeyDetail');
  }
}

/** "Accounts" section: list, create, edit, invite and delete accounts. */
export function UsersSection({
  albums,
  notify,
}: {
  albums: AdminAlbum[];
  notify: Notify;
}): ReactElement {
  const t = useT();
  const { data: users, isPending, error } = useAdminUsers();
  const { data: me } = useMe();
  const { data: status } = useAdminStatus();
  const remove = useDeleteUser();
  const invite = useInviteUser();
  const mailConfigured = status?.mailConfigured !== false;

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AdminUser | null>(null);
  const [converting, setConverting] = useState<AdminUser | null>(null);
  const [address, setAddress] = useState('');
  // Validated as the address is typed rather than on submit: the dialog's confirm
  // button is refused until it is valid, so a rejection with nothing said would be a
  // button that looks broken.
  const addressError = validateEmail(address, t);

  const titles = useMemo(() => new Map(albums.map((album) => [album.id, album.title])), [albums]);

  const confirmDelete = (user: AdminUser): void => {
    remove.mutate(user.username, {
      onSuccess: () => {
        notify({ tone: 'ok', text: t('adminUsers.deleted', user.username) });
        setConfirming(null);
      },
      onError: (deleteError) => {
        notify({ tone: 'error', text: errorText(deleteError, t('adminUsers.deleteFailed')) });
        setConfirming(null);
      },
    });
  };

  const openConversion = (user: AdminUser): void => {
    setAddress('');
    setConverting(user);
  };

  const confirmConversion = (user: AdminUser): void => {
    if (addressError) return;
    const email = address.trim();
    invite.mutate(
      { username: user.username, body: { email } },
      {
        onSuccess: () => {
          notify({ tone: 'ok', text: t('adminUsers.invited', user.username, email) });
          setConverting(null);
        },
        onError: (inviteError) => {
          notify({ tone: 'error', text: errorText(inviteError, t('adminUsers.inviteFailed')) });
        },
      },
    );
  };

  /** Remints the invitation already pending: no address to give, nothing to confirm. */
  const resend = (user: AdminUser): void => {
    invite.mutate(
      { username: user.username, body: {} },
      {
        onSuccess: () => notify({ tone: 'ok', text: t('adminUsers.resent', user.username) }),
        onError: (inviteError) =>
          notify({ tone: 'error', text: errorText(inviteError, t('adminUsers.inviteFailed')) }),
      },
    );
  };

  return (
    <Section
      title={t('adminUsers.title')}
      description={t('adminUsers.description')}
      action={
        <Button
          variant="primary"
          onClick={() => {
            setEditing(null);
            setCreating(true);
          }}
          disabled={creating}
        >
          {t('adminUsers.new')}
        </Button>
      }
    >
      {creating && (
        <UserForm
          albums={albums}
          mailConfigured={mailConfigured}
          onClose={() => setCreating(false)}
          notify={notify}
        />
      )}

      {isPending && (
        <div className="px-4 py-6">
          <Spinner label={t('adminUsers.loading')} />
        </div>
      )}

      {error && (
        <div className="px-4 py-4">
          <FormError message={errorText(error, t('adminUsers.loadFailed'))} />
        </div>
      )}

      {users?.length === 0 && !creating && (
        <p className="px-4 py-6 text-sm text-ink-400">{t('adminUsers.none')}</p>
      )}

      {users?.map((user) =>
        editing === user.username ? (
          <UserForm
            key={user.username}
            albums={albums}
            user={user}
            isSelf={user.username === me?.username}
            mailConfigured={mailConfigured}
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
                    {t('adminUsers.administrator')}
                  </span>
                )}
                {user.username === me?.username && (
                  <span className="shrink-0 text-xs font-normal text-ink-400">
                    {t('adminUsers.you')}
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-ink-400">
                {formatAlbumAccess(user.albums, titles, t)}
              </p>
            </div>

            {/* How the account is entered, as a column of its own from `xl` and a
                line of its own below it. Fixed width rather than `flex-1`: the
                badge is the word the eye looks for down the list, and a column
                that resizes with its neighbour puts it somewhere new on each row. */}
            <div className="min-w-0 xl:w-72 xl:shrink-0">
              <p>
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs ${STATE_BADGE[user.state]}`}
                >
                  {t(STATE_LABEL[user.state])}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-ink-400">{stateDetail(user, t)}</p>
              {/* An invitation on an account that still has its password: the state
                  stays "shared key" because the key still works, so the invitation
                  in flight has nowhere else to appear. */}
              {user.invitation && user.state === 'shared_key' && (
                <p className="mt-0.5 text-xs text-amber-200">
                  {t(
                    'adminUsers.pendingInvitation',
                    user.invitation.email,
                    formatDate(user.invitation.expiresAt, t),
                  )}
                </p>
              )}
            </div>

            <div className={ROW_ACTIONS_CLASS}>
              <Button
                onClick={() => {
                  setCreating(false);
                  setEditing(user.username);
                }}
                ariaLabel={t('adminUsers.editAccount', user.username)}
              >
                {t('adminUsers.edit')}
              </Button>

              {/* Inviting sits beside deleting, and a bound account offers neither
                  form of it: the server refuses both with `already_bound`. */}
              {!user.identity &&
                (user.invitation ? (
                  <Button
                    onClick={() => resend(user)}
                    disabled={invite.isPending}
                    ariaLabel={t('adminUsers.resendAccount', user.username)}
                  >
                    {t('adminUsers.resend')}
                  </Button>
                ) : (
                  <Button
                    onClick={() => openConversion(user)}
                    disabled={!mailConfigured}
                    ariaLabel={t('adminUsers.inviteAccount', user.username)}
                    title={mailConfigured ? undefined : t('userForm.byEmailNoMail')}
                  >
                    {t('adminUsers.invite')}
                  </Button>
                ))}

              <Button
                variant="danger"
                onClick={() => setConfirming(user)}
                disabled={user.username === me?.username}
                ariaLabel={t('adminUsers.deleteAccount', user.username)}
                title={
                  user.username === me?.username ? t('adminUsers.cannotDeleteSelf') : undefined
                }
              >
                {t('adminUsers.delete')}
              </Button>
            </div>
          </div>
        ),
      )}

      {confirming && (
        <ConfirmDialog
          title={t('adminUsers.confirmTitle', confirming.username)}
          confirmLabel={t('adminUsers.confirmButton', confirming.username)}
          busy={remove.isPending}
          onConfirm={() => confirmDelete(confirming)}
          onCancel={() => setConfirming(null)}
        >
          <p>{t('adminUsers.confirmSignIn')}</p>
          <p>{t('adminUsers.confirmMedia')}</p>
        </ConfirmDialog>
      )}

      {/* The same dialog that guards deletion, because this is the same kind of act:
          on an account that still has a password, accepting the invitation closes
          every session it has open and retires that password. */}
      {converting && (
        <ConfirmDialog
          title={t('adminUsers.inviteTitle', converting.username)}
          confirmLabel={t('adminUsers.inviteButton')}
          busyLabel={t('adminUsers.inviting')}
          busy={invite.isPending}
          confirmDisabled={addressError !== null}
          onConfirm={() => confirmConversion(converting)}
          onCancel={() => setConverting(null)}
        >
          <p>{t('adminUsers.inviteExplain')}</p>
          <p>
            {converting.state === 'shared_key'
              ? t('adminUsers.inviteConverts', converting.username)
              : t('adminUsers.inviteRevives')}
          </p>
          <TextField
            id="invite-address"
            label={t('adminUsers.inviteAddress')}
            type="email"
            value={address}
            onChange={setAddress}
            autoComplete="off"
            disabled={invite.isPending}
            // Only once something has been typed: an error under an untouched field
            // is the dialog telling somebody off for having just opened it.
            error={address ? addressError : null}
          />
        </ConfirmDialog>
      )}
    </Section>
  );
}
