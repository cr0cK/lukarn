import {
  ALL_ALBUMS,
  PASSWORD_MIN_LENGTH,
  type AdminAlbum,
  type AdminUser,
  type UpdateUserRequest,
} from '@gdv/shared';
import { type FormEvent, type ReactElement, useId, useState } from 'react';
import { errorText } from '../../api/client';
import { useAdminStatus, useCreateUser, useUpdateUser } from '../../api/hooks';
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
  // Déjà chargé par le tableau de bord : cette lecture sert le cache, pas une
  // requête de plus. Renseigner une adresse sans serveur SMTP ne produit rien,
  // et le formulaire doit le dire au lieu de laisser espérer des emails.
  const { data: status } = useAdminStatus();
  const mailConfigured = status?.mailConfigured !== false;

  const [username, setUsername] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [admin, setAdmin] = useState(user?.admin ?? false);
  const [userAlbums, setUserAlbums] = useState<string[]>(user?.albums ?? []);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
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
        {
          username: username.trim(),
          password,
          admin,
          albums: userAlbums,
          displayName: displayName.trim(),
          email: email.trim(),
        },
        {
          onSuccess: (created) => {
            notify({ tone: 'ok', text: `Compte « ${created.username} » créé.` });
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
    if (displayName.trim() !== (user.displayName ?? '')) body.displayName = displayName.trim();
    if (email.trim() !== (user.email ?? '')) body.email = email.trim();

    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }

    update.mutate(
      { username: user.username, body },
      {
        onSuccess: (saved) => {
          notify({ tone: 'ok', text: `Compte « ${saved.username} » modifié.` });
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
          label="Identifiant"
          value={username}
          onChange={setUsername}
          autoComplete="off"
          autoFocus={!editing}
          readOnly={editing}
          disabled={pending}
          error={touched ? usernameError : null}
          hint={
            editing
              ? "L'identifiant ne se change pas ; supprime et recrée le compte au besoin."
              : 'Lettres, chiffres, point, tiret ou tiret bas.'
          }
        />

        <TextField
          id={`${fieldId}-password`}
          label={editing ? 'Nouveau mot de passe' : 'Mot de passe'}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          disabled={pending}
          error={touched ? passwordError : null}
          hint={
            editing
              ? 'Laisse vide pour conserver le mot de passe actuel.'
              : `${PASSWORD_MIN_LENGTH} caractères au minimum.`
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id={`${fieldId}-display-name`}
          label="Nom affiché"
          value={displayName}
          onChange={setDisplayName}
          autoComplete="off"
          disabled={pending}
          hint="Signe les commentaires. Vide : l'identifiant est utilisé."
        />

        <TextField
          id={`${fieldId}-email`}
          label="Adresse email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="off"
          disabled={pending}
          hint={
            mailConfigured
              ? 'Reçoit les notifications de commentaires. Vide : aucun envoi.'
              : "Aucun serveur SMTP configuré : renseignée, elle ne recevra rien pour l'instant."
          }
        />
      </div>

      {editing && user.email && !user.notify && (
        <p className="text-xs text-ink-400">
          Ce compte s’est désabonné des notifications. Son adresse est conservée ; il faut son
          accord pour le réabonner.
        </p>
      )}

      <Checkbox
        id={`${fieldId}-admin`}
        label="Rôle administrateur"
        checked={admin}
        onChange={setAdmin}
        disabled={pending || isSelf}
        hint={
          isSelf
            ? 'Tu ne peux pas retirer ton propre rôle : il faut un administrateur pour cette page.'
            : "Donne accès à cette page. L'accès aux albums reste celui choisi ci-dessous."
        }
      />

      <AlbumAccessPicker
        albums={albums}
        value={userAlbums}
        onChange={setUserAlbums}
        disabled={pending}
      />

      <FormError
        message={serverError ? errorText(serverError, "L'enregistrement a échoué.") : null}
      />

      <div className="flex justify-end gap-2">
        <Button onClick={onClose} disabled={pending}>
          Annuler
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Enregistrement…' : editing ? 'Enregistrer' : 'Créer le compte'}
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
