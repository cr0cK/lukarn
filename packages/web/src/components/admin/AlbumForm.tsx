import type { AdminAlbum, UpdateAlbumRequest } from '@nonni/shared';
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
  /** Absent means creating an album. */
  album?: AdminAlbum;
  onClose: () => void;
  notify: Notify;
}

/** Form for creating and editing an album. */
export function AlbumForm({ album, onClose, notify }: AlbumFormProps): ReactElement {
  const fieldId = useId();
  const create = useCreateAlbum();
  const update = useUpdateAlbum();
  const editing = album !== undefined;

  const [albumId, setAlbumId] = useState(album?.id ?? '');
  // Until the identifier is touched, follow the title: this value appears in the
  // album URL, so keep it readable.
  const [idTouchedByUser, setIdTouchedByUser] = useState(editing);
  const [title, setTitle] = useState(album?.title ?? '');
  const [description, setDescription] = useState(album?.description ?? '');
  const [folder, setFolder] = useState(album?.folderId ?? '');
  const [recursive, setRecursive] = useState(album?.recursive ?? true);
  const [byDay, setByDay] = useState(album?.groupBy === 'day');
  const [newestFirst, setNewestFirst] = useState(album?.sortOrder === 'desc');
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
          groupBy: byDay ? 'day' : 'month',
          sortOrder: newestFirst ? 'desc' : 'asc',
        },
        {
          onSuccess: (created) => {
            notify({
              tone: 'ok',
              text: `Album "${created.title}" created. Syncing will fill it.`,
            });
            onClose();
          },
        },
      );
      return;
    }

    // Send only changed fields: an absent field remains unchanged server-side,
    // and `description: null` is the only way to clear it.
    const body: UpdateAlbumRequest = {};
    if (title.trim() !== album.title) body.title = title.trim();
    if ((description.trim() || null) !== album.description) {
      body.description = description.trim() || null;
    }
    if (folderId !== album.folderId) body.folderId = folderId;
    if (recursive !== album.recursive) body.recursive = recursive;
    if ((byDay ? 'day' : 'month') !== album.groupBy) body.groupBy = byDay ? 'day' : 'month';
    if ((newestFirst ? 'desc' : 'asc') !== album.sortOrder) {
      body.sortOrder = newestFirst ? 'desc' : 'asc';
    }

    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }

    update.mutate(
      { albumId: album.id, body },
      {
        onSuccess: (saved) => {
          notify({ tone: 'ok', text: `Album "${saved.title}" saved.` });
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
          label="Title"
          value={title}
          onChange={changeTitle}
          autoFocus={!editing}
          disabled={pending}
          error={touched ? titleError : null}
        />

        <TextField
          id={`${fieldId}-id`}
          label="Identifier"
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
              ? 'The identifier does not change: it is the address of the album.'
              : 'Appears in the URL of the album. Suggested from the title.'
          }
        />
      </div>

      <TextField
        id={`${fieldId}-description`}
        label="Description (optional)"
        value={description}
        onChange={setDescription}
        disabled={pending}
        multiline
      />

      <TextField
        id={`${fieldId}-folder`}
        label="Google Drive folder"
        value={folder}
        onChange={setFolder}
        onBlur={() => {
          // Normalise on blur so the displayed value is exactly what is sent.
          if (folderId !== null) setFolder(folderId);
        }}
        autoComplete="off"
        placeholder="https://drive.google.com/drive/folders/…"
        disabled={pending}
        error={touched ? folderError : null}
        hint={
          extracted ? (
            <>
              Identifier used: <code className="text-ink-300">{folderId}</code>
            </>
          ) : (
            'Paste the folder URL: the identifier is the segment after /folders/.'
          )
        }
      />

      <Checkbox
        id={`${fieldId}-recursive`}
        label="Include subfolders"
        checked={recursive}
        onChange={setRecursive}
        disabled={pending}
        hint="Untick to index only the files sitting directly in the folder."
      />

      <Checkbox
        id={`${fieldId}-group-by`}
        label="Open the grid grouped by day"
        checked={byDay}
        onChange={setByDay}
        disabled={pending}
        hint="The right split for a trip. Day notes only show up per day. A visitor can always flip it back."
      />

      <Checkbox
        id={`${fieldId}-sort-order`}
        label="Open the album newest first"
        checked={newestFirst}
        onChange={setNewestFirst}
        disabled={pending}
        hint="Unticked, the album reads in the order it was lived. Tick it for a library fed as things happen. A visitor can flip it back, and their browser remembers."
      />

      <FormError message={serverError ? errorText(serverError, 'Saving failed.') : null} />

      <div className="flex justify-end gap-2">
        <Button onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : editing ? 'Save' : 'Create the album'}
        </Button>
      </div>
    </form>
  );
}
