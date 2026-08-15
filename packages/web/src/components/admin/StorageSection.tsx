import type { AdminStatus, StorageConnectionStatus, StorageKind } from '@lukarn/shared';
import { type FormEvent, type ReactElement, useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, errorText } from '../../api/client';
import {
  useAdminStorage,
  useCreateStorage,
  useDeleteStorage,
  useDisconnectStorage,
  useTestStorage,
} from '../../api/hooks';
import { slugifyAlbumId, validateAlbumId } from '../../lib/adminForm';
import { formatRelative } from '../../lib/format';
import { useT, type MessageKey } from '../../lib/i18n';
import { Spinner } from '../Spinner';
import { ConfirmDialog } from './ConfirmDialog';
import {
  Button,
  FormError,
  ROW_ACTIONS_CLASS,
  ROW_CLASS,
  Section,
  SelectField,
  TextField,
  type Notify,
} from './ui';

/** What each kind is called on screen. Adding a kind adds a key, never a branch. */
const KIND_LABELS: Record<StorageKind, MessageKey> = {
  drive: 'storage.kindDrive',
  local: 'storage.kindLocal',
  s3: 'storage.kindS3',
  webdav: 'storage.kindWebdav',
};

/**
 * "Storage" section: every backend this instance reads, and what state each is in.
 *
 * One instance may read several — a Drive for the family album and a bucket for the
 * archives — so this is a **list** rather than the single connection panel of 1.1.
 * Each row states the one thing that decides whether its albums work: can this
 * storage serve bytes right now, and if not, why not.
 */
export function StorageSection({
  status,
  notify,
}: {
  status: AdminStatus;
  notify: Notify;
}): ReactElement {
  const t = useT();
  const connections = useAdminStorage();
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<StorageConnectionStatus | null>(null);
  const remove = useDeleteStorage();

  const confirmDelete = (connection: StorageConnectionStatus): void => {
    remove.mutate(connection.id, {
      onSuccess: () => {
        notify({ tone: 'ok', text: t('storage.deleted', connection.label) });
        setConfirming(null);
      },
      onError: (error) => {
        notify({ tone: 'error', text: errorText(error, t('storage.deleteFailed')) });
        setConfirming(null);
      },
    });
  };

  return (
    <Section
      title={t('storage.title')}
      description={t('storage.description')}
      action={
        <Button variant="primary" onClick={() => setAdding(true)} disabled={adding}>
          {t('storage.add')}
        </Button>
      }
    >
      {adding && (
        <StorageForm kinds={status.storageKinds} onClose={() => setAdding(false)} notify={notify} />
      )}

      {connections.isPending && <Spinner />}
      {connections.error && (
        <FormError message={errorText(connections.error, t('storage.loadFailed'))} />
      )}

      {connections.data?.map((connection) => (
        <StorageRow
          key={connection.id}
          connection={connection}
          oauthConfigured={status.oauthConfigured}
          notify={notify}
          onDelete={() => setConfirming(connection)}
        />
      ))}

      {confirming && (
        <ConfirmDialog
          title={t('storage.confirmTitle', confirming.label)}
          confirmLabel={t('storage.confirmButton')}
          busy={remove.isPending}
          onConfirm={() => confirmDelete(confirming)}
          onCancel={() => setConfirming(null)}
        >
          {/* Nothing leaves the storage itself: this removes how the instance
              reaches it, which is what makes the sentence worth writing. */}
          <p>{t('storage.confirmNothingDeleted')}</p>
        </ConfirmDialog>
      )}
    </Section>
  );
}

/** One connection: its state, and the controls its kind of authorisation allows. */
function StorageRow({
  connection,
  oauthConfigured,
  notify,
  onDelete,
}: {
  connection: StorageConnectionStatus;
  oauthConfigured: boolean;
  notify: Notify;
  onDelete: () => void;
}): ReactElement {
  const t = useT();
  const test = useTestStorage();
  const disconnect = useDisconnectStorage();
  const kindLabel = t(KIND_LABELS[connection.kind]);

  const connect = useMutation({
    mutationFn: () => api.oauthStart(connection.id),
    // Full-page redirect: Google consent refuses display in an iframe, and the
    // callback must return to this origin.
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (error) =>
      notify({ tone: 'error', text: errorText(error, t('storage.connectFailed')) }),
  });

  const runTest = (): void => {
    test.mutate(connection.id, {
      onSuccess: (probe) =>
        notify(
          probe.ok
            ? { tone: 'ok', text: t('storage.testOk', probe.account ?? connection.label) }
            : { tone: 'error', text: probe.error ?? t('storage.testFailed') },
        ),
      onError: (error) =>
        notify({ tone: 'error', text: errorText(error, t('storage.testFailed')) }),
    });
  };

  return (
    <div
      className={`${ROW_CLASS} border-b border-ink-850 px-4 py-4 last:border-b-0 xl:items-center`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-100">
          {connection.label}{' '}
          <span className="text-xs font-normal text-ink-400">
            {/* The kind, unless the name already is it: "Google Drive Google
                Drive" is what naming a connection after its backend produces,
                and it is the default name. */}
            {kindLabel === connection.label ? '' : `${kindLabel} · `}
            <code>{connection.id}</code>
          </span>
        </p>

        {/* The state line answers the only question this screen is opened with:
            can this storage serve anything, and if not what has to be done. */}
        {connection.authorization === 'consent' && !oauthConfigured ? (
          <p className="mt-1 text-sm text-amber-300">
            {t('storage.notConfigured')} <code>.env</code>
            {t('storage.notConfiguredEnd')}
          </p>
        ) : connection.revokedAt ? (
          <>
            <p className="mt-1 text-sm text-red-300">
              {t('storage.revoked')}
              {connection.account ? ` ${t('storage.revokedFor', connection.account)}` : ''} —{' '}
              {formatRelative(connection.revokedAt, t)}
            </p>
            <p className="mt-1 text-xs text-ink-400">{t('storage.revokedHint')}</p>
          </>
        ) : connection.connected ? (
          <p className="mt-1 text-sm text-ink-200">
            {t('storage.connected')}
            {connection.account ? ` — ${connection.account}` : ''}
          </p>
        ) : (
          <p className="mt-1 text-sm text-ink-300">{t('storage.notConnected')}</p>
        )}

        {/* A service account has nothing to connect: authorisation lives in Drive
            folder sharing, which the API cannot inspect. The address to share with
            is the only useful thing to show (D46). */}
        {connection.authorization === 'key' && (
          <p className="mt-1 text-xs text-ink-400">{t('storage.serviceAccountHint')}</p>
        )}

        <p className="mt-1 text-xs text-ink-400">
          {t('storage.albumCount', connection.albumCount)}
        </p>
      </div>

      <div className={ROW_ACTIONS_CLASS}>
        <Button onClick={runTest} disabled={test.isPending}>
          {test.isPending ? t('storage.testing') : t('storage.test')}
        </Button>

        {connection.authorization === 'consent' &&
          (connection.connected ? (
            <Button
              variant="danger"
              onClick={() => disconnect.mutate(connection.id)}
              disabled={disconnect.isPending}
            >
              {t('storage.disconnect')}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => connect.mutate()}
              disabled={!oauthConfigured || connect.isPending}
            >
              {t(connection.revokedAt ? 'storage.reconnect' : 'storage.connect')}
            </Button>
          ))}

        {/* Deleting is refused server-side while albums read it; the count above
            says why, so the button stays visible rather than silently disabled. */}
        <Button
          variant="danger"
          onClick={onDelete}
          ariaLabel={t('storage.deleteOne', connection.label)}
        >
          {t('storage.delete')}
        </Button>
      </div>
    </div>
  );
}

/** Adding a connection: what it is called, what kind it is, and its identifier. */
function StorageForm({
  kinds,
  onClose,
  notify,
}: {
  kinds: StorageKind[];
  onClose: () => void;
  notify: Notify;
}): ReactElement {
  const t = useT();
  const fieldId = useId();
  const create = useCreateStorage();

  const [kind, setKind] = useState<StorageKind>(kinds[0] ?? 'drive');
  const [label, setLabel] = useState('');
  const [id, setId] = useState('');
  // Until the identifier is touched, follow the label: it is written into every
  // album that reads this storage, so keep it readable.
  const [idTouched, setIdTouched] = useState(false);
  const [touched, setTouched] = useState(false);

  const labelError = label.trim() ? null : t('validate.storageLabel');
  const idError = validateAlbumId(id, t);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setTouched(true);
    if (labelError || idError) return;

    create.mutate(
      { id: id.trim(), kind, label: label.trim() },
      {
        onSuccess: (created) => {
          notify({ tone: 'ok', text: t('storage.created', created.label) });
          onClose();
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4 border-b border-ink-850 bg-ink-900/40 px-4 py-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id={`${fieldId}-label`}
          label={t('storage.label')}
          value={label}
          onChange={(value) => {
            setLabel(value);
            if (!idTouched) setId(slugifyAlbumId(value));
          }}
          autoFocus
          disabled={create.isPending}
          error={touched ? labelError : null}
        />

        <TextField
          id={`${fieldId}-id`}
          label={t('storage.identifier')}
          value={id}
          onChange={(value) => {
            setIdTouched(true);
            setId(value);
          }}
          autoComplete="off"
          disabled={create.isPending}
          error={touched ? idError : null}
          hint={t('storage.identifierHint')}
        />
      </div>

      <SelectField
        id={`${fieldId}-kind`}
        label={t('storage.kind')}
        value={kind}
        options={kinds.map((available) => ({
          value: available,
          label: t(KIND_LABELS[available]),
        }))}
        onChange={(value) => setKind(value as StorageKind)}
        hint={t('storage.kindHint')}
      />

      <FormError message={create.error ? errorText(create.error, t('common.saveFailed')) : null} />

      <div className="flex justify-end gap-2">
        <Button onClick={onClose} disabled={create.isPending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={create.isPending}>
          {create.isPending ? t('common.saving') : t('storage.create')}
        </Button>
      </div>
    </form>
  );
}
