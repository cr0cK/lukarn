import {
  ALL_ALBUMS,
  PASSWORD_MIN_LENGTH,
  isLocale,
  type AdminAlbum,
  type AdminUser,
  type CreateUserRequest,
  type Locale,
  type UpdateUserRequest,
} from '@lukarn/shared';
import { type FormEvent, type ReactElement, useId, useState } from 'react';
import { errorText } from '../../api/client';
import { useAdminShares, useCreateUser, useUpdateUser } from '../../api/hooks';
import { validateEmail, validatePassword, validateUsername } from '../../lib/adminForm';
import { useT } from '../../lib/i18n';
import { AlbumAccessPicker } from './AlbumAccessPicker';
import {
  Button,
  Checkbox,
  Choice,
  FormError,
  SelectField,
  Switch,
  TextField,
  localeOptions,
  type Notify,
} from './ui';

interface UserFormProps {
  albums: AdminAlbum[];
  /** Absent means creating an account. */
  user?: AdminUser;
  /** `true` when editing the current session's account. */
  isSelf?: boolean;
  /** `false` disables creating by address: with no relay the invitation never leaves. */
  mailConfigured?: boolean;
  onClose: () => void;
  notify: Notify;
}

/** Form for creating and editing an account. */
export function UserForm({
  albums,
  user,
  isSelf = false,
  mailConfigured = true,
  onClose,
  notify,
}: UserFormProps): ReactElement {
  const t = useT();
  const fieldId = useId();
  const create = useCreateUser();
  const update = useUpdateUser();
  const { data: sharesData } = useAdminShares();
  const activeShares = (sharesData ?? []).filter((s) => s.revokedAt === null);
  const editing = user !== undefined;

  const [username, setUsername] = useState(user?.username ?? '');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  // Whoever invites usually speaks to the person they are inviting in the language
  // they are themselves reading, so that is where the choice starts.
  const [locale, setLocale] = useState<Locale>(t.locale);
  // The credential is chosen before either field is shown, so a form carrying both a
  // password and an address never exists: the request takes exactly one of them, and
  // a choice made up front is a rule the person reads rather than a refusal they meet.
  const [byEmail, setByEmail] = useState(false);
  const [admin, setAdmin] = useState(user?.admin ?? false);
  const [roleViewer, setRoleViewer] = useState(user?.roleViewer ?? true);
  const [roleCommenter, setRoleCommenter] = useState(user?.roleCommenter ?? true);
  const [userAlbums, setUserAlbums] = useState<string[]>(user?.albums ?? []);
  const [userShares, setUserShares] = useState<string[]>(user?.shareTokens ?? []);
  const [notifyPhotos, setNotifyPhotos] = useState(user?.notifyPhotos ?? true);
  const [notifyComments, setNotifyComments] = useState(user?.notifyComments ?? true);
  const [touched, setTouched] = useState(false);

  const inviting = !editing && byEmail;
  const usernameError = editing ? null : validateUsername(username, t);
  const passwordError = inviting ? null : validatePassword(password, !editing, t);
  const emailError = inviting ? validateEmail(email, t) : null;
  const pending = create.isPending || update.isPending;
  const serverError = create.error ?? update.error;

  const toggleShare = (shareToken: string, checked: boolean): void => {
    setUserShares((prev) =>
      checked ? [...prev, shareToken] : prev.filter((token) => token !== shareToken),
    );
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setTouched(true);
    if (usernameError || passwordError || emailError) return;

    if (!editing) {
      const common = {
        username: username.trim(),
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        admin,
        roleViewer,
        roleCommenter,
        albums: userAlbums,
        ...(userShares.length > 0 ? { shareTokens: userShares } : {}),
      };
      const body: CreateUserRequest = inviting
        ? { ...common, email: email.trim(), locale }
        : { ...common, password };

      create.mutate(body, {
        onSuccess: (created) => {
          notify({
            tone: 'ok',
            text: inviting
              ? t('userForm.invited', created.username, email.trim())
              : t('userForm.created', created.username),
          });
          onClose();
        },
      });
      return;
    }

    // An absent field preserves its value: sending only changes avoids overwriting
    // an edit made elsewhere in the meantime.
    const fields: UpdateUserRequest = {};
    if (displayName.trim() !== (user.displayName ?? '')) {
      fields.displayName = displayName.trim();
    }
    if (admin !== user.admin) {
      fields.admin = admin;
    }
    if (roleViewer !== (user.roleViewer ?? true)) {
      fields.roleViewer = roleViewer;
    }
    if (roleCommenter !== (user.roleCommenter ?? true)) {
      fields.roleCommenter = roleCommenter;
    }
    if (!sameAlbums(userAlbums, user.albums)) fields.albums = userAlbums;
    if (!sameAlbums(userShares, user.shareTokens ?? [])) fields.shareTokens = userShares;
    if (notifyPhotos !== (user.notifyPhotos ?? true)) fields.notifyPhotos = notifyPhotos;
    if (notifyComments !== (user.notifyComments ?? true)) fields.notifyComments = notifyComments;

    if (!password && Object.keys(fields).length === 0) {
      onClose();
      return;
    }

    const body: UpdateUserRequest = !password ? fields : { ...fields, password };

    update.mutate(
      { username: user.username, body },
      {
        onSuccess: (saved) => {
          notify({ tone: 'ok', text: t('userForm.saved', saved.username) });
          onClose();
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4 border-b border-ink-850 bg-ink-900/40 px-4 py-4">
      {!editing && (
        <fieldset disabled={pending} className="min-w-0">
          <legend className="mb-1.5 text-sm text-ink-300">{t('userForm.howLegend')}</legend>
          <div className="space-y-2">
            <Choice
              name={`${fieldId}-how`}
              id={`${fieldId}-how-password`}
              checked={!byEmail}
              onSelect={() => setByEmail(false)}
              label={t('userForm.byPassword')}
              hint={t('userForm.byPasswordHint')}
            />
            <Choice
              name={`${fieldId}-how`}
              id={`${fieldId}-how-email`}
              checked={byEmail}
              onSelect={() => setByEmail(true)}
              // Offered and refused rather than hidden: an administrator looking for
              // this option needs to be told it exists and what it waits on.
              disabled={!mailConfigured}
              label={t('userForm.byEmail')}
              hint={t(mailConfigured ? 'userForm.byEmailHint' : 'userForm.byEmailNoMail')}
            />
          </div>
        </fieldset>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id={`${fieldId}-username`}
          label={t('userForm.username')}
          value={username}
          onChange={setUsername}
          autoComplete="off"
          autoFocus={!editing}
          readOnly={editing}
          disabled={pending}
          error={touched ? usernameError : null}
          hint={t(editing ? 'userForm.usernameFixed' : 'userForm.usernameHint')}
        />

        <TextField
          id={`${fieldId}-display-name`}
          label={t('adminUsers.memberDisplayName')}
          value={displayName}
          onChange={setDisplayName}
          autoComplete="off"
          disabled={pending}
          placeholder={t('adminUsers.memberDisplayNamePlaceholder')}
        />

        {!inviting && (
          <TextField
            id={`${fieldId}-password`}
            label={t(editing ? 'userForm.newPassword' : 'userForm.password')}
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            disabled={pending}
            error={touched ? passwordError : null}
            hint={
              editing ? t('userForm.passwordKeep') : t('userForm.passwordHint', PASSWORD_MIN_LENGTH)
            }
          />
        )}

        {inviting && (
          <TextField
            id={`${fieldId}-email`}
            label={t('userForm.email')}
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="off"
            disabled={pending}
            error={touched ? emailError : null}
            hint={t('userForm.emailHint')}
          />
        )}

        {/* In the grid beside the address rather than under the form: the language
            is a property of the message being addressed there, and a control sitting
            below the album picker would be read after the decision it belongs to. */}
        {inviting && (
          <SelectField
            id={`${fieldId}-locale`}
            label={t('userForm.locale')}
            value={locale}
            options={localeOptions()}
            // Guarded rather than cast, as `/settings` does: a `select` hands back a
            // string, and the predicate in `@lukarn/shared` is the one thing that
            // decides what counts as a language.
            onChange={(value) => isLocale(value) && setLocale(value)}
            disabled={pending}
            hint={t('userForm.localeHint')}
          />
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm text-ink-300">{t('adminUsers.colRoles')}</p>
        <div className="space-y-2">
          <Checkbox
            id={`${fieldId}-admin`}
            label={t('userForm.admin')}
            checked={admin}
            onChange={setAdmin}
            disabled={pending || isSelf}
            hint={t(isSelf ? 'userForm.adminSelf' : 'userForm.adminHint')}
          />
          <Checkbox
            id={`${fieldId}-role-visitor`}
            label={t('adminUsers.roleVisitor')}
            checked={roleViewer}
            onChange={setRoleViewer}
            disabled={pending}
          />
          <Checkbox
            id={`${fieldId}-role-commenter`}
            label={t('adminUsers.roleCommenter')}
            checked={roleCommenter}
            onChange={setRoleCommenter}
            disabled={pending}
          />
        </div>
      </div>

      <AlbumAccessPicker
        albums={albums}
        value={userAlbums}
        onChange={setUserAlbums}
        disabled={pending}
      />

      {activeShares.length > 0 && (
        <div className="space-y-2">
          <span className="text-sm text-ink-300">{t('shares.title')}</span>
          <div className="flex flex-wrap gap-2">
            {activeShares.map((sh) => {
              const checked = userShares.includes(sh.token);
              const label = sh.label || sh.albumTitle || sh.mediaName || sh.token.slice(0, 12);
              return (
                <label
                  key={sh.token}
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                    checked
                      ? 'border-accent/40 bg-accent/10 text-ink-100'
                      : 'border-ink-800 bg-ink-900/50 text-ink-400 hover:text-ink-200'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={pending}
                    onChange={(e) => toggleShare(sh.token, e.target.checked)}
                    className="rounded border-ink-600 text-accent focus:ring-accent"
                  />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {editing && (
        <div className="space-y-2 rounded-xl border border-ink-800 bg-ink-850/40 p-3">
          <Switch
            id={`${fieldId}-notify-photos`}
            checked={notifyPhotos}
            onChange={setNotifyPhotos}
            disabled={pending}
            label={t('prefs.notifyPhotos')}
            hint={t('prefs.notifyPhotosHint')}
          />
          <Switch
            id={`${fieldId}-notify-comments`}
            checked={notifyComments}
            onChange={setNotifyComments}
            disabled={pending}
            label={t('prefs.notifyComments')}
            hint={t('prefs.notifyCommentsHint')}
          />
        </div>
      )}

      <FormError message={serverError ? errorText(serverError, t('common.saveFailed')) : null} />

      <div className="flex justify-end gap-2">
        <Button onClick={onClose} disabled={pending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending
            ? t('common.saving')
            : editing
              ? t('common.save')
              : inviting
                ? t('userForm.invite')
                : t('userForm.create')}
        </Button>
      </div>
    </form>
  );
}

/** Compares two assignments regardless of input order. */
function sameAlbums(a: string[], b: string[]): boolean {
  if (a.includes(ALL_ALBUMS) || b.includes(ALL_ALBUMS)) {
    return a.includes(ALL_ALBUMS) && b.includes(ALL_ALBUMS);
  }
  if (a.length !== b.length) return false;
  const sorted = [...b].sort();
  return [...a].sort().every((id, index) => id === sorted[index]);
}
