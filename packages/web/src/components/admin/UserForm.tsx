import {
  ALL_ALBUMS,
  PASSWORD_MIN_LENGTH,
  type AdminAlbum,
  type AdminUser,
  type UpdateUserRequest,
} from '@nonni/shared';
import { type FormEvent, type ReactElement, useId, useState } from 'react';
import { errorText } from '../../api/client';
import { useCreateUser, useUpdateUser } from '../../api/hooks';
import { validatePassword, validateUsername } from '../../lib/adminForm';
import { AlbumAccessPicker } from './AlbumAccessPicker';
import { Button, Checkbox, FormError, TextField, type Notify } from './ui';

interface UserFormProps {
  albums: AdminAlbum[];
  /** Absent = création d'un compte. */
  user?: AdminUser;
  /** `true` si le compte modifié est celui de la session en cours. */
  isSelf?: boolean;
  onClose: () => void;
  notify: Notify;
}

/** Formulaire de création et de modification d'un compte. */
export function UserForm({
  albums,
  user,
  isSelf = false,
  onClose,
  notify,
}: UserFormProps): ReactElement {
  const fieldId = useId();
  const create = useCreateUser();
  const update = useUpdateUser();
  const editing = user !== undefined;

  const [username, setUsername] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [admin, setAdmin] = useState(user?.admin ?? false);
  const [userAlbums, setUserAlbums] = useState<string[]>(user?.albums ?? []);
  const [touched, setTouched] = useState(false);

  const usernameError = editing ? null : validateUsername(username);
  const passwordError = validatePassword(password, !editing);
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
            notify({ tone: 'ok', text: `Account "${created.username}" created.` });
            onClose();
          },
        },
      );
      return;
    }

    // Un champ absent laisse la valeur en place : n'envoyer que ce qui a changé
    // évite d'écraser une modification faite ailleurs entre-temps.
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
          notify({ tone: 'ok', text: `Account "${saved.username}" saved.` });
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
          label="Username"
          value={username}
          onChange={setUsername}
          autoComplete="off"
          autoFocus={!editing}
          readOnly={editing}
          disabled={pending}
          error={touched ? usernameError : null}
          hint={
            editing
              ? 'The username does not change; delete and recreate the account if needed.'
              : 'Lettres, chiffres, point, tiret ou tiret bas.'
          }
        />

        <TextField
          id={`${fieldId}-password`}
          label={editing ? 'New password' : 'Password'}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          disabled={pending}
          error={touched ? passwordError : null}
          hint={
            editing
              ? 'Leave empty to keep the current password.'
              : `${PASSWORD_MIN_LENGTH} characters minimum.`
          }
        />
      </div>

      <Checkbox
        id={`${fieldId}-admin`}
        label="Administrator role"
        checked={admin}
        onChange={setAdmin}
        disabled={pending || isSelf}
        hint={
          isSelf
            ? 'You cannot remove your own role: this page needs an administrator.'
            : 'Grants access to this page. Album access stays the one chosen below.'
        }
      />

      <AlbumAccessPicker
        albums={albums}
        value={userAlbums}
        onChange={setUserAlbums}
        disabled={pending}
      />

      <FormError message={serverError ? errorText(serverError, 'Saving failed.') : null} />

      <div className="flex justify-end gap-2">
        <Button onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : editing ? 'Save' : 'Create the account'}
        </Button>
      </div>
    </form>
  );
}

/** Compare deux attributions sans tenir compte de l'ordre de saisie. */
function sameAlbums(a: string[], b: string[]): boolean {
  if (a.includes(ALL_ALBUMS) || b.includes(ALL_ALBUMS)) {
    return a.includes(ALL_ALBUMS) && b.includes(ALL_ALBUMS);
  }
  if (a.length !== b.length) return false;
  const sorted = [...b].sort();
  return [...a].sort().every((id, index) => id === sorted[index]);
}
