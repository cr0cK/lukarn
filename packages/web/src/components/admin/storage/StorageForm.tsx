import type { StorageConnectionStatus, StorageKind } from '@lukarn/shared';
import { type FormEvent, type ReactElement, useId, useState } from 'react';
import { errorText } from '../../../api/client';
import { useCreateStorage, useUpdateStorage } from '../../../api/hooks';
import {
  draftErrors,
  draftFromSettings,
  draftPayload,
  draftUpdate,
  emptyDraft,
  KIND_LABELS,
  secretTyped,
  type StorageDraft,
} from '../../../lib/storageDraft';
import { useT } from '../../../lib/i18n';
import { Button, FormError, SelectField, TextField, type Notify } from '../ui';
import { LocalFields } from './LocalFields';
import { S3Fields } from './S3Fields';
import { WebdavFields } from './WebdavFields';

/**
 * Adding or editing a connection: what it is called, what kind it is, then the fields
 * that kind needs.
 *
 * This is the one place the **kind** is read rather than the authorisation, and the only
 * one: everything after the selector comes from `storageDraft.ts`, so a new backend adds
 * a fields component and a branch of one line here.
 *
 * Editing exists so that a corrected endpoint or a rotated key is not a deletion
 * followed by a recreation — which the albums reading the connection would forbid
 * anyway, since a connection they point at cannot be removed (D260816i).
 */
export function StorageForm({
  connection,
  kinds,
  localRoot,
  onClose,
  notify,
}: {
  /** Absent means adding a connection. */
  connection?: StorageConnectionStatus;
  kinds: StorageKind[];
  /** What a local subpath is relative to, or `null` when the server declared none. */
  localRoot: string | null;
  onClose: () => void;
  notify: Notify;
}): ReactElement {
  const t = useT();
  const fieldId = useId();
  const create = useCreateStorage();
  const update = useUpdateStorage();
  const editing = connection !== undefined;

  // The draft carries the kind: a bucket's keys have no meaning under **WebDAV
  // server**, so changing the selector starts the fields again rather than keeping
  // half of a form the backend never asked for.
  const [draft, setDraft] = useState<StorageDraft>(() =>
    connection
      ? draftFromSettings(connection.kind, connection.settings)
      : emptyDraft(kinds[0] ?? 'drive'),
  );
  const [label, setLabel] = useState(connection?.label ?? '');
  const [touched, setTouched] = useState(false);

  // Editing starts with the credential fields empty because the server never sends a
  // secret back. Blank therefore means "keep the stored one", and only something typed
  // replaces it — the rule an account's password field already follows.
  const typed = secretTyped(draft);
  const labelError = label.trim() ? null : t('validate.storageLabel');
  const errors = draftErrors(draft, t, editing && !typed);
  const shown = touched ? errors : null;
  const pending = create.isPending || update.isPending;
  const serverError = create.error ?? update.error;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setTouched(true);
    if (labelError) return;
    if (Object.values(errors).some(Boolean)) return;

    if (editing) {
      update.mutate(
        { id: connection.id, body: { label: label.trim(), ...draftUpdate(draft, typed) } },
        {
          onSuccess: (saved) => {
            notify({ tone: 'ok', text: t('storage.saved', saved.label) });
            onClose();
          },
        },
      );
      return;
    }

    create.mutate(
      {
        // No identifier: the server derives a readable one from the name and makes
        // it free (D260816h). Nothing outside this screen ever names a connection.
        kind: draft.kind,
        label: label.trim(),
        // Each kind contributes its own half and no other: a local folder sends its
        // subpath, a bucket its address alongside the one secret it encrypts, and a
        // Drive nothing at all — its authorisation is a consent still to be given.
        ...draftPayload(draft),
      },
      {
        onSuccess: (created) => {
          notify({ tone: 'ok', text: t('storage.created', created.label) });
          onClose();
        },
      },
    );
  };

  const fieldProps = {
    fieldId,
    errors: shown,
    disabled: pending,
  };

  return (
    <form onSubmit={submit} className="space-y-4 border-b border-ink-850 bg-ink-900/40 px-4 py-4">
      <TextField
        id={`${fieldId}-label`}
        label={t('storage.label')}
        value={label}
        onChange={setLabel}
        autoFocus
        disabled={pending}
        error={touched ? labelError : null}
      />

      {/* The kind is chosen once and never again: an album points at this connection
          by identifier, and a connection that changed backend under it would leave
          every one of its media addressed in a language the new one does not speak. */}
      {editing ? (
        <TextField
          id={`${fieldId}-kind`}
          label={t('storage.kind')}
          value={`${t(KIND_LABELS[connection.kind])} · ${connection.id}`}
          onChange={() => undefined}
          readOnly
          disabled={pending}
          hint={t('storage.kindFixed')}
        />
      ) : (
        <SelectField
          id={`${fieldId}-kind`}
          label={t('storage.kind')}
          value={draft.kind}
          options={kinds.map((available) => ({
            value: available,
            label: t(KIND_LABELS[available]),
          }))}
          onChange={(value) => setDraft(emptyDraft(value as StorageKind))}
          hint={t('storage.kindHint')}
        />
      )}

      {/* A kind authorised by its settings is authorised by what is typed here and
          nowhere else: there is no consent screen to come back from, so the connection
          is created complete or not at all. */}
      {draft.kind === 'local' && (
        <LocalFields {...fieldProps} draft={draft} localRoot={localRoot} onChange={setDraft} />
      )}

      {draft.kind === 's3' && (
        <S3Fields {...fieldProps} draft={draft} keepingSecret={editing} onChange={setDraft} />
      )}

      {draft.kind === 'webdav' && (
        <WebdavFields {...fieldProps} draft={draft} keepingSecret={editing} onChange={setDraft} />
      )}

      <FormError message={serverError ? errorText(serverError, t('common.saveFailed')) : null} />

      <div className="flex justify-end gap-2">
        <Button onClick={onClose} disabled={pending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? t('common.saving') : editing ? t('common.save') : t('storage.create')}
        </Button>
      </div>
    </form>
  );
}
