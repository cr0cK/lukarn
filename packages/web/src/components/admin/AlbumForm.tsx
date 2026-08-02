import type { AdminAlbum, UpdateAlbumRequest } from '@gdv/shared';
import { type FormEvent, type ReactElement, useId, useState } from 'react';
import { errorText } from '../../api/client';
import { useCreateAlbum, useUpdateAlbum } from '../../api/hooks';
import {
  extractFolderId,
  slugifyAlbumId,
  validateAlbumId,
  validateFolderInput,
  validateTitle,
} from '../../lib/adminForm';
import { Button, Checkbox, FormError, TextField, type Notify } from './ui';

interface AlbumFormProps {
  /** Absent = création d'un album. */
  album?: AdminAlbum;
  onClose: () => void;
  notify: Notify;
}

/** Formulaire de création et de modification d'un album. */
export function AlbumForm({ album, onClose, notify }: AlbumFormProps): ReactElement {
  const fieldId = useId();
  const create = useCreateAlbum();
  const update = useUpdateAlbum();
  const editing = album !== undefined;

  const [albumId, setAlbumId] = useState(album?.id ?? '');
  // Tant que l'identifiant n'a pas été touché, il suit le titre : c'est la
  // valeur qu'on retrouve dans l'URL de l'album, autant qu'elle soit lisible.
  const [idTouchedByUser, setIdTouchedByUser] = useState(editing);
  const [title, setTitle] = useState(album?.title ?? '');
  const [description, setDescription] = useState(album?.description ?? '');
  const [folder, setFolder] = useState(album?.folderId ?? '');
  const [recursive, setRecursive] = useState(album?.recursive ?? true);
  const [touched, setTouched] = useState(false);

  const idError = editing ? null : validateAlbumId(albumId);
  const titleError = validateTitle(title);
  const folderError = validateFolderInput(folder);
  const pending = create.isPending || update.isPending;
  const serverError = create.error ?? update.error;

  const folderId = extractFolderId(folder);
  const extracted = folderId !== null && folderId !== folder.trim();

  const changeTitle = (value: string): void => {
    setTitle(value);
    if (!idTouchedByUser) setAlbumId(slugifyAlbumId(value));
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setTouched(true);
    if (idError || titleError || folderError || folderId === null) return;

    if (!editing) {
      create.mutate(
        {
          id: albumId.trim(),
          title: title.trim(),
          description: description.trim() || undefined,
          folderId,
          recursive,
        },
        {
          onSuccess: (created) => {
            notify({
              tone: 'ok',
              text: `Album « ${created.title} » créé. La synchronisation le remplira.`,
            });
            onClose();
          },
        },
      );
      return;
    }

    // Seuls les champs modifiés partent : un champ absent reste inchangé côté
    // serveur, et `description: null` est le seul moyen de l'effacer.
    const body: UpdateAlbumRequest = {};
    if (title.trim() !== album.title) body.title = title.trim();
    if ((description.trim() || null) !== album.description) {
      body.description = description.trim() || null;
    }
    if (folderId !== album.folderId) body.folderId = folderId;
    if (recursive !== album.recursive) body.recursive = recursive;

    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }

    update.mutate(
      { albumId: album.id, body },
      {
        onSuccess: (saved) => {
          notify({ tone: 'ok', text: `Album « ${saved.title} » modifié.` });
          onClose();
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4 border-b border-ink-850 bg-ink-900/40 px-4 py-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id={`${fieldId}-title`}
          label="Titre"
          value={title}
          onChange={changeTitle}
          autoFocus={!editing}
          disabled={pending}
          error={touched ? titleError : null}
        />

        <TextField
          id={`${fieldId}-id`}
          label="Identifiant"
          value={albumId}
          onChange={(value) => {
            setIdTouchedByUser(true);
            setAlbumId(value);
          }}
          autoComplete="off"
          readOnly={editing}
          disabled={pending}
          error={touched ? idError : null}
          hint={
            editing
              ? "L'identifiant ne se change pas : il sert d'adresse à l'album."
              : "Apparaît dans l'URL de l'album. Proposé d'après le titre."
          }
        />
      </div>

      <TextField
        id={`${fieldId}-description`}
        label="Description (facultative)"
        value={description}
        onChange={setDescription}
        disabled={pending}
        multiline
      />

      <TextField
        id={`${fieldId}-folder`}
        label="Dossier Google Drive"
        value={folder}
        onChange={setFolder}
        onBlur={() => {
          // Normaliser à la sortie du champ : ce qui reste affiché est
          // exactement ce qui sera envoyé.
          if (folderId !== null) setFolder(folderId);
        }}
        autoComplete="off"
        placeholder="https://drive.google.com/drive/folders/…"
        disabled={pending}
        error={touched ? folderError : null}
        hint={
          extracted ? (
            <>
              Identifiant retenu : <code className="text-ink-300">{folderId}</code>
            </>
          ) : (
            "Colle l'URL du dossier : l'identifiant est le segment après /folders/."
          )
        }
      />

      <Checkbox
        id={`${fieldId}-recursive`}
        label="Inclure les sous-dossiers"
        checked={recursive}
        onChange={setRecursive}
        disabled={pending}
        hint="Décoche pour n'indexer que les fichiers posés directement dans le dossier."
      />

      <FormError
        message={serverError ? errorText(serverError, "L'enregistrement a échoué.") : null}
      />

      <div className="flex justify-end gap-2">
        <Button onClick={onClose} disabled={pending}>
          Annuler
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Enregistrement…' : editing ? 'Enregistrer' : "Créer l'album"}
        </Button>
      </div>
    </form>
  );
}
