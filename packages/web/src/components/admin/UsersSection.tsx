import {
  isLocale,
  type AccountState,
  type AdminAlbum,
  type AdminUser,
  type Locale,
} from '@lukarn/shared';
import { type ReactElement, useMemo, useState } from 'react';
import { errorText } from '../../api/client';
import {
  useAdminStatus,
  useAdminUsers,
  useDeleteUser,
  useInviteUser,
  useMe,
  useUpdateUser,
} from '../../api/hooks';
import { formatAlbumAccess, validateEmail } from '../../lib/adminForm';
import { formatDate } from '../../lib/format';
import { useT } from '../../lib/i18n';
import type { MessageKey, Translate } from '../../lib/i18n/translate';
import { Spinner } from '../Spinner';
import { ConfirmDialog } from './ConfirmDialog';
import { InviteLinkModal } from './InviteLinkModal';
import { InviteMemberModal } from './InviteMemberModal';
import { UserForm } from './UserForm';
import {
  Button,
  FormError,
  ROW_ACTIONS_CLASS,
  ROW_CLASS,
  Section,
  SelectField,
  TextField,
  localeOptions,
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

function credentialLabel(user: AdminUser): MessageKey {
  if (user.state === 'invited') return 'adminUsers.stateInvited';
  if (user.state === 'no_way_in') return 'adminUsers.stateNoWayIn';
  if (user.hasPassword && user.identity) return 'adminUsers.credBoth';
  if (user.identity) return 'adminUsers.credEmail';
  return 'adminUsers.credPassword';
}

function stateDetail(user: AdminUser, t: Translate): string | null {
  switch (user.state) {
    case 'person':
    case 'shared_key':
      return user.identity ? user.identity.email : null;
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
  }
}

/** "Users" section: list, create, edit, invite and delete accounts. */
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
  const updateUser = useUpdateUser();
  const mailConfigured = status?.mailConfigured !== false;

  const [creating, setCreating] = useState(false);
  const [invitingMember, setInvitingMember] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AdminUser | null>(null);
  const [converting, setConverting] = useState<AdminUser | null>(null);
  const [offlineInviteUrl, setOfflineInviteUrl] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  // The language whoever is inviting reads themselves: they are usually about to
  // speak to that person in it.
  const [locale, setLocale] = useState<Locale>(t.locale);
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
    setLocale(t.locale);
    setConverting(user);
  };

  const confirmConversion = (user: AdminUser): void => {
    if (addressError) return;
    const email = address.trim();
    invite.mutate(
      { username: user.username, body: { email, locale } },
      {
        onSuccess: (res) => {
          setConverting(null);
          if (res && typeof res === 'object' && 'inviteUrl' in res && res.inviteUrl) {
            setOfflineInviteUrl(res.inviteUrl as string);
          } else {
            notify({ tone: 'ok', text: t('adminUsers.invited', user.username, email) });
          }
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
        onSuccess: (res) => {
          if (res && typeof res === 'object' && 'inviteUrl' in res && res.inviteUrl) {
            setOfflineInviteUrl(res.inviteUrl as string);
          } else {
            notify({ tone: 'ok', text: t('adminUsers.resent', user.username) });
          }
        },
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
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              setEditing(null);
              setCreating(false);
              setInvitingMember(true);
            }}
          >
            {t('adminUsers.inviteMember')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setInvitingMember(false);
              setCreating(true);
            }}
            disabled={creating}
          >
            {t('adminUsers.new')}
          </Button>
        </div>
      }
    >
      {invitingMember && (
        <InviteMemberModal
          albums={albums}
          onClose={() => setInvitingMember(false)}
          notify={notify}
        />
      )}
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
            <div className="min-w-0 flex-1 space-y-1">
              {/* Apply `truncate` only to the identifier and `shrink-0` to the
                  labels after it: on the whole row, the badge shrank with the
                  rest and "administrator" appeared as "administ". Half a role
                  reads like another role. */}
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-100">
                <span className="truncate">{user.username}</span>
                {user.displayName && user.displayName !== user.username && (
                  <span className="truncate text-xs font-normal text-ink-400">
                    ({user.displayName})
                  </span>
                )}
                {user.admin && (
                  <span className="shrink-0 whitespace-nowrap rounded-full bg-accent/15 px-2 py-0.5 text-xs font-normal text-accent">
                    {t('adminUsers.administrator')}
                  </span>
                )}
                {user.username === me?.username && (
                  <span className="shrink-0 whitespace-nowrap text-xs font-normal text-ink-400">
                    {t('adminUsers.you')}
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-ink-400">
                {formatAlbumAccess(user.albums, titles, t)}
                {user.shareTokens && user.shareTokens.length > 0
                  ? ` · ${t('adminUsers.sharesScope', user.shareTokens.length)}`
                  : ''}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <button
                  type="button"
                  disabled={user.username === me?.username || updateUser.isPending}
                  onClick={() =>
                    updateUser.mutate({
                      username: user.username,
                      body: {
                        admin: !user.admin,
                      },
                    })
                  }
                  className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs transition-colors ${
                    user.admin
                      ? 'border-accent/40 bg-accent/15 text-accent'
                      : 'border-ink-800 bg-ink-900/50 text-ink-400 hover:text-ink-200'
                  } disabled:opacity-50`}
                >
                  {user.admin ? '✓ ' : ''}
                  {t('adminUsers.roleAdmin')}
                </button>
                <button
                  type="button"
                  disabled={updateUser.isPending}
                  onClick={() =>
                    updateUser.mutate({
                      username: user.username,
                      body: { roleViewer: !(user.roleViewer ?? true) },
                    })
                  }
                  className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs transition-colors ${
                    (user.roleViewer ?? true)
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                      : 'border-ink-800 bg-ink-900/50 text-ink-400 hover:text-ink-200'
                  }`}
                >
                  {(user.roleViewer ?? true) ? '✓ ' : ''}
                  {t('adminUsers.roleVisitor')}
                </button>
                <button
                  type="button"
                  disabled={updateUser.isPending}
                  onClick={() =>
                    updateUser.mutate({
                      username: user.username,
                      body: { roleCommenter: !(user.roleCommenter ?? true) },
                    })
                  }
                  className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs transition-colors ${
                    (user.roleCommenter ?? true)
                      ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                      : 'border-ink-800 bg-ink-900/50 text-ink-400 hover:text-ink-200'
                  }`}
                >
                  {(user.roleCommenter ?? true) ? '✓ ' : ''}
                  {t('adminUsers.roleCommenter')}
                </button>
                <button
                  type="button"
                  disabled={updateUser.isPending}
                  onClick={() =>
                    updateUser.mutate({
                      username: user.username,
                      body: { notifyPhotos: !(user.notifyPhotos ?? true) },
                    })
                  }
                  className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs transition-colors ${
                    (user.notifyPhotos ?? true)
                      ? 'border-ink-700 bg-ink-800 text-ink-200'
                      : 'border-ink-800 bg-ink-900/50 text-ink-500 hover:text-ink-300'
                  }`}
                >
                  {t('adminUsers.notifyPhotosLabel')}: {(user.notifyPhotos ?? true) ? 'ON' : 'OFF'}
                </button>
                <button
                  type="button"
                  disabled={updateUser.isPending}
                  onClick={() =>
                    updateUser.mutate({
                      username: user.username,
                      body: { notifyComments: !(user.notifyComments ?? true) },
                    })
                  }
                  className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs transition-colors ${
                    (user.notifyComments ?? true)
                      ? 'border-ink-700 bg-ink-800 text-ink-200'
                      : 'border-ink-800 bg-ink-900/50 text-ink-500 hover:text-ink-300'
                  }`}
                >
                  {t('adminUsers.notifyCommentsLabel')}:{' '}
                  {(user.notifyComments ?? true) ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>

            {/* How the account is entered, as a column of its own from `xl` and a
                line of its own below it. Fixed width rather than `flex-1`: the
                badge is the word the eye looks for down the list, and a column
                that resizes with its neighbour puts it somewhere new on each row. */}
            <div className="min-w-0 xl:w-72 xl:shrink-0">
              <p>
                <span
                  className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${STATE_BADGE[user.state]}`}
                >
                  {t(credentialLabel(user))}
                </span>
              </p>
              {stateDetail(user, t) && (
                <p className="mt-0.5 text-xs text-ink-400">{stateDetail(user, t)}</p>
              )}
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
                    ariaLabel={t('adminUsers.inviteAccount', user.username)}
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
          <SelectField
            id="invite-locale"
            label={t('userForm.locale')}
            value={locale}
            options={localeOptions()}
            // Guarded rather than cast, as `/settings` does: a `select` hands back a
            // string, and the predicate in `@lukarn/shared` is the one thing that
            // decides what counts as a language.
            onChange={(value) => isLocale(value) && setLocale(value)}
            disabled={invite.isPending}
            hint={t('userForm.localeHint')}
          />
        </ConfirmDialog>
      )}

      {offlineInviteUrl && (
        <InviteLinkModal
          inviteUrl={offlineInviteUrl}
          onClose={() => setOfflineInviteUrl(null)}
          notify={notify}
        />
      )}
    </Section>
  );
}
