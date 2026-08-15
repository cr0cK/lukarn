import type { AdminAlbum, StorageConnectionStatus, UpdateAlbumRequest } from '@lukarn/shared';
import { type FormEvent, type ReactElement, useId, useState } from 'react';
import { errorText } from '../../api/client';
import { useCreateAlbum, useUpdateAlbum } from '../../api/hooks';
import {
  extractContainer,
  slugifyAlbumId,
  validateAlbumId,
  validateContainerInput,
  validateTitle,
} from '../../lib/adminForm';
import { useT } from '../../lib/i18n';
import { Button, Checkbox, FormError, SelectField, TextField, type Notify } from './ui';

interface AlbumFormProps {
  /** Absent means creating an album. */
  album?: AdminAlbum;
  /** The storages to choose between. The first one is the default for a new album. */
  storage: StorageConnectionStatus[];
  onClose: () => void;
  notify: Notify;
}

/** Form for creating and editing an album. */
export function AlbumForm({ album, storage, onClose, notify }: AlbumFormProps): ReactElement {
  const t = useT();
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
  const [connectionId, setConnectionId] = useState(
    album?.connectionId ?? storage[0]?.id ?? 'drive',
  );
  const [folder, setFolder] = useState(album?.folderId ?? '');
  const [recursive, setRecursive] = useState(album?.recursive ?? true);
  const [byDay, setByDay] = useState(album?.groupBy === 'day');
  const [newestFirst, setNewestFirst] = useState(album?.sortOrder === 'desc');
  const [touched, setTouched] = useState(false);

  // What the container field means depends on the storage: Drive addresses a folder
  // by an opaque identifier pasted from a URL, while every other backend addresses
  // one by path. Validating the wrong one would refuse a perfectly good path.
  const kind = storage.find((connection) => connection.id === connectionId)?.kind ?? 'drive';

  const idError = editing ? null : validateAlbumId(albumId, t);
  const titleError = validateTitle(title, t);
  const folderError = validateContainerInput(folder, kind, t);
  const pending = create.isPending || update.isPending;
  const serverError = create.error ?? update.error;

  const folderId = extractContainer(folder, kind);
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
          connectionId,
          folderId,
          recursive,
          groupBy: byDay ? 'day' : 'month',
          sortOrder: newestFirst ? 'desc' : 'asc',
        },
        {
          onSuccess: (created) => {
            notify({ tone: 'ok', text: t('albumForm.created', created.title) });
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
    if (connectionId !== album.connectionId) body.connectionId = connectionId;
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
          notify({ tone: 'ok', text: t('albumForm.saved', saved.title) });
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
          label={t('albumForm.titleField')}
          value={title}
          onChange={changeTitle}
          autoFocus={!editing}
          disabled={pending}
          error={touched ? titleError : null}
        />

        <TextField
          id={`${fieldId}-id`}
          label={t('albumForm.id')}
          value={albumId}
          onChange={(value) => {
            setIdTouchedByUser(true);
            setAlbumId(value);
          }}
          autoComplete="off"
          readOnly={editing}
          disabled={pending}
          error={touched ? idError : null}
          hint={t(editing ? 'albumForm.idFixed' : 'albumForm.idHint')}
        />
      </div>

      <TextField
        id={`${fieldId}-description`}
        label={t('albumForm.description')}
        value={description}
        onChange={setDescription}
        disabled={pending}
        multiline
      />

      {/* Only offered when there is a choice: one storage means one possible
          answer, and a select with a single option is a control that decides
          nothing. Changing it purges the album index, like changing the folder. */}
      {storage.length > 1 && (
        <SelectField
          id={`${fieldId}-connection`}
          label={t('albumForm.storage')}
          value={connectionId}
          options={storage.map((connection) => ({
            value: connection.id,
            label: connection.label,
          }))}
          onChange={setConnectionId}
          hint={t(editing ? 'albumForm.storageEditHint' : 'albumForm.storageHint')}
        />
      )}

      <TextField
        id={`${fieldId}-folder`}
        label={t(kind === 'drive' ? 'albumForm.folder' : 'albumForm.container')}
        value={folder}
        onChange={setFolder}
        onBlur={() => {
          // Normalise on blur so the displayed value is exactly what is sent.
          if (folderId !== null) setFolder(folderId);
        }}
        autoComplete="off"
        placeholder={
          kind === 'drive'
            ? 'https://drive.google.com/drive/folders/…'
            : t('albumForm.containerPlaceholder')
        }
        disabled={pending}
        error={touched ? folderError : null}
        hint={
          extracted ? (
            <>
              {t('albumForm.folderExtracted')} <code className="text-ink-300">{folderId}</code>
            </>
          ) : (
            t(kind === 'drive' ? 'albumForm.folderHint' : 'albumForm.containerHint')
          )
        }
      />

      <Checkbox
        id={`${fieldId}-recursive`}
        label={t('albumForm.recursive')}
        checked={recursive}
        onChange={setRecursive}
        disabled={pending}
        hint={t('albumForm.recursiveHint')}
      />

      <Checkbox
        id={`${fieldId}-group-by`}
        label={t('albumForm.byDay')}
        checked={byDay}
        onChange={setByDay}
        disabled={pending}
        hint={t('albumForm.byDayHint')}
      />

      <Checkbox
        id={`${fieldId}-sort-order`}
        label={t('albumForm.newestFirst')}
        checked={newestFirst}
        onChange={setNewestFirst}
        disabled={pending}
        hint={t('albumForm.newestFirstHint')}
      />

      <FormError message={serverError ? errorText(serverError, t('common.saveFailed')) : null} />

      <div className="flex justify-end gap-2">
        <Button onClick={onClose} disabled={pending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? t('common.saving') : editing ? t('common.save') : t('albumForm.create')}
        </Button>
      </div>
    </form>
  );
}
