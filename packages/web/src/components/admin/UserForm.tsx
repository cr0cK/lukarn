import {
  ALL_ALBUMS,
  PASSWORD_MIN_LENGTH,
  type AdminAlbum,
  type AdminUser,
  type CreateUserRequest,
  type UpdateUserRequest,
} from '@lukarn/shared';
import { type FormEvent, type ReactElement, useId, useState } from 'react';
import { errorText } from '../../api/client';
import { useCreateUser, useUpdateUser } from '../../api/hooks';
import { validateEmail, validatePassword, validateUsername } from '../../lib/adminForm';
import { useT } from '../../lib/i18n';
import { AlbumAccessPicker } from './AlbumAccessPicker';
import { Button, Checkbox, Choice, FormError, TextField, type Notify } from './ui';

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
  const editing = user !== undefined;
  // A bound account is refused an ordinary password change by the server, and the
  // single way through — unbind and set in one act — is what the field below offers.
  const bound = user?.identity ?? null;

  const [username, setUsername] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  // The credential is chosen before either field is shown, so a form carrying both a
  // password and an address never exists: the request takes exactly one of them, and
  // a choice made up front is a rule the person reads rather than a refusal they meet.
  const [byEmail, setByEmail] = useState(false);
  const [admin, setAdmin] = useState(user?.admin ?? false);
  const [userAlbums, setUserAlbums] = useState<string[]>(user?.albums ?? []);
  const [touched, setTouched] = useState(false);

  const inviting = !editing && byEmail;
  const usernameError = editing ? null : validateUsername(username, t);
  const passwordError = inviting ? null : validatePassword(password, !editing, t);
  const emailError = inviting ? validateEmail(email, t) : null;
  const pending = create.isPending || update.isPending;
  const serverError = create.error ?? update.error;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setTouched(true);
    if (usernameError || passwordError || emailError) return;

    if (!editing) {
      const body: CreateUserRequest = inviting
        ? { username: username.trim(), email: email.trim(), admin, albums: userAlbums }
        : { username: username.trim(), password, admin, albums: userAlbums };

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
    const fields: { admin?: boolean; albums?: string[] } = {};
    if (admin !== user.admin) fields.admin = admin;
    if (!sameAlbums(userAlbums, user.albums)) fields.albums = userAlbums;

    if (!password && Object.keys(fields).length === 0) {
      onClose();
      return;
    }

    const body: UpdateUserRequest = !password
      ? fields
      : bound
        ? { ...fields, password, unbind: true }
        : { ...fields, password };

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

        {!inviting && (
          <TextField
            id={`${fieldId}-password`}
            label={t(
              bound
                ? 'userForm.unbindPassword'
                : editing
                  ? 'userForm.newPassword'
                  : 'userForm.password',
            )}
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            disabled={pending}
            error={touched ? passwordError : null}
            hint={
              bound
                ? t('userForm.unbindHint', bound.email)
                : editing
                  ? t('userForm.passwordKeep')
                  : t('userForm.passwordHint', PASSWORD_MIN_LENGTH)
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
      </div>

      <Checkbox
        id={`${fieldId}-admin`}
        label={t('userForm.admin')}
        checked={admin}
        onChange={setAdmin}
        disabled={pending || isSelf}
        hint={t(isSelf ? 'userForm.adminSelf' : 'userForm.adminHint')}
      />

      <AlbumAccessPicker
        albums={albums}
        value={userAlbums}
        onChange={setUserAlbums}
        disabled={pending}
      />

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
