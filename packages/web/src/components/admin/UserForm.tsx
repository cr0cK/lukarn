import {
  ALL_ALBUMS,
  PASSWORD_MIN_LENGTH,
  type AdminAlbum,
  type AdminUser,
  type UpdateUserRequest,
} from '@lukarn/shared';
import { type FormEvent, type ReactElement, useId, useState } from 'react';
import { errorText } from '../../api/client';
import { useCreateUser, useUpdateUser } from '../../api/hooks';
import { validatePassword, validateUsername } from '../../lib/adminForm';
import { useT } from '../../lib/i18n';
import { AlbumAccessPicker } from './AlbumAccessPicker';
import { Button, Checkbox, FormError, TextField, type Notify } from './ui';

interface UserFormProps {
  albums: AdminAlbum[];
  /** Absent means creating an account. */
  user?: AdminUser;
  /** `true` when editing the current session's account. */
  isSelf?: boolean;
  onClose: () => void;
  notify: Notify;
}

/** Form for creating and editing an account. */
export function UserForm({
  albums,
  user,
  isSelf = false,
  onClose,
  notify,
}: UserFormProps): ReactElement {
  const t = useT();
  const fieldId = useId();
  const create = useCreateUser();
  const update = useUpdateUser();
  const editing = user !== undefined;

  const [username, setUsername] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [admin, setAdmin] = useState(user?.admin ?? false);
  const [userAlbums, setUserAlbums] = useState<string[]>(user?.albums ?? []);
  const [touched, setTouched] = useState(false);

  const usernameError = editing ? null : validateUsername(username, t);
  const passwordError = validatePassword(password, !editing, t);
  const pending = create.isPending || update.isPending;
  const serverError = create.error ?? update.error;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setTouched(true);
    if (usernameError || passwordError) return;

    if (!editing) {
      create.mutate(
        { username: username.trim(), password, admin, albums: userAlbums },
        {
          onSuccess: (created) => {
            notify({ tone: 'ok', text: t('userForm.created', created.username) });
            onClose();
          },
        },
      );
      return;
    }

    // An absent field preserves its value: sending only changes avoids overwriting
    // an edit made elsewhere in the meantime.
    const body: UpdateUserRequest = {};
    if (password) body.password = password;
    if (admin !== user.admin) body.admin = admin;
    if (!sameAlbums(userAlbums, user.albums)) body.albums = userAlbums;

    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }

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
          {pending ? t('common.saving') : editing ? t('common.save') : t('userForm.create')}
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
