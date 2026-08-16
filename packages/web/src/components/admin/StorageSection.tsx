import type {
  AdminStatus,
  CreateStorageRequest,
  StorageConnectionStatus,
  StorageKind,
} from '@lukarn/shared';
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
import { extractContainer, slugifyAlbumId, validateAlbumId } from '../../lib/adminForm';
import { formatRelative } from '../../lib/format';
import { useT, type MessageKey } from '../../lib/i18n';
import { Spinner } from '../Spinner';
import { ConfirmDialog } from './ConfirmDialog';
import {
  Button,
  Checkbox,
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
              onClick={() =>
                disconnect.mutate(connection.id, {
                  onSuccess: () =>
                    notify({ tone: 'ok', text: t('storage.disconnected', connection.label) }),
                  onError: (error) =>
                    notify({
                      tone: 'error',
                      text: errorText(error, t('storage.disconnectFailed')),
                    }),
                })
              }
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

/** The fields an S3 connection is typed into, before anything is stored. */
interface S3Draft {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  pathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

const EMPTY_S3: S3Draft = {
  endpoint: '',
  region: '',
  bucket: '',
  prefix: '',
  pathStyle: false,
  accessKeyId: '',
  secretAccessKey: '',
};

/**
 * The draft as the API takes it: settings in the clear, the key pair as the one secret.
 *
 * A connection stores exactly **one** encrypted string, so a backend needing two values
 * puts JSON in it. Assembling that here rather than server-side keeps the secret in a
 * single field all the way through: nothing between this form and `TOKEN_KEY` ever sees
 * the two halves separately.
 */
function s3Payload(draft: S3Draft): Pick<CreateStorageRequest, 'settings' | 'secret'> {
  return {
    settings: {
      endpoint: draft.endpoint.trim(),
      region: draft.region.trim(),
      bucket: draft.bucket.trim(),
      prefix: draft.prefix.trim(),
      pathStyle: String(draft.pathStyle),
    },
    secret: JSON.stringify({
      accessKeyId: draft.accessKeyId.trim(),
      secretAccessKey: draft.secretAccessKey.trim(),
    }),
  };
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
  const [path, setPath] = useState('');
  // Until the identifier is touched, follow the label: it is written into every
  // album that reads this storage, so keep it readable.
  const [idTouched, setIdTouched] = useState(false);
  const [touched, setTouched] = useState(false);
  const [s3, setS3] = useState<S3Draft>(EMPTY_S3);

  // A local folder is authorised by its settings rather than by consent: the one
  // thing to choose is which folder **under `STORAGE_LOCAL_ROOT`** it reads. The
  // root itself is never typed here — it is the fence the container declares, and
  // an administrator cannot move it (D260816d).
  const needsPath = kind === 'local';
  const labelError = label.trim() ? null : t('validate.storageLabel');
  const idError = validateAlbumId(id, t);
  const pathError =
    needsPath && path.trim() && extractContainer(path, kind) === null
      ? t('validate.storagePath')
      : null;
  // A bucket is unusable without all four: the connection would be created, every album
  // on it would stay empty, and the Test button would be the only thing saying so.
  const s3Errors =
    kind === 's3'
      ? {
          endpoint: s3.endpoint.trim() ? null : t('validate.storageEndpoint'),
          bucket: s3.bucket.trim() ? null : t('validate.storageBucket'),
          accessKeyId: s3.accessKeyId.trim() ? null : t('validate.storageAccessKey'),
          secretAccessKey: s3.secretAccessKey.trim() ? null : t('validate.storageSecretKey'),
        }
      : null;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setTouched(true);
    if (labelError || idError || pathError) return;
    if (s3Errors && Object.values(s3Errors).some(Boolean)) return;

    create.mutate(
      {
        id: id.trim(),
        kind,
        label: label.trim(),
        // Each kind contributes its own half and no other: a local folder sends its
        // subpath — empty means the root the container declared — and a bucket sends
        // its address alongside the one secret it encrypts.
        ...(needsPath ? { settings: { path: extractContainer(path, kind) ?? '' } } : {}),
        ...(kind === 's3' ? s3Payload(s3) : {}),
      },
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

      {needsPath && (
        <TextField
          id={`${fieldId}-path`}
          label={t('storage.path')}
          value={path}
          onChange={setPath}
          autoComplete="off"
          disabled={create.isPending}
          error={touched ? pathError : null}
          hint={t('storage.pathHint')}
        />
      )}

      {/* A bucket is authorised by what is typed here and nowhere else: there is no
          consent screen to come back from, so the connection is created complete. */}
      {s3Errors && (
        <S3Fields
          fieldId={fieldId}
          draft={s3}
          errors={touched ? s3Errors : null}
          disabled={create.isPending}
          onChange={(patch) => setS3((current) => ({ ...current, ...patch }))}
        />
      )}

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

/**
 * Where the bucket is, and what opens it.
 *
 * Five settings and a key pair, laid out in the order they are read off a provider's
 * console. The secret half is a password field for the reason every password field
 * exists here: this form is filled in on a laptop with somebody else in the room, and
 * the value is never shown again once it is stored.
 */
function S3Fields({
  fieldId,
  draft,
  errors,
  disabled,
  onChange,
}: {
  fieldId: string;
  draft: S3Draft;
  /** Only the four that are required: a region and a prefix have working defaults. */
  errors: Record<'endpoint' | 'bucket' | 'accessKeyId' | 'secretAccessKey', string | null> | null;
  disabled: boolean;
  onChange: (patch: Partial<S3Draft>) => void;
}): ReactElement {
  const t = useT();

  return (
    <div className="space-y-4 border-t border-ink-850 pt-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id={`${fieldId}-endpoint`}
          label={t('storage.endpoint')}
          value={draft.endpoint}
          onChange={(value) => onChange({ endpoint: value })}
          placeholder="https://s3.eu-west-3.amazonaws.com"
          autoComplete="off"
          disabled={disabled}
          error={errors?.endpoint ?? null}
          hint={t('storage.endpointHint')}
        />

        <TextField
          id={`${fieldId}-region`}
          label={t('storage.region')}
          value={draft.region}
          onChange={(value) => onChange({ region: value })}
          placeholder="us-east-1"
          autoComplete="off"
          disabled={disabled}
          hint={t('storage.regionHint')}
        />

        <TextField
          id={`${fieldId}-bucket`}
          label={t('storage.bucket')}
          value={draft.bucket}
          onChange={(value) => onChange({ bucket: value })}
          autoComplete="off"
          disabled={disabled}
          error={errors?.bucket ?? null}
        />

        <TextField
          id={`${fieldId}-prefix`}
          label={t('storage.prefix')}
          value={draft.prefix}
          onChange={(value) => onChange({ prefix: value })}
          autoComplete="off"
          disabled={disabled}
          hint={t('storage.prefixHint')}
        />

        <TextField
          id={`${fieldId}-access-key`}
          label={t('storage.accessKeyId')}
          value={draft.accessKeyId}
          onChange={(value) => onChange({ accessKeyId: value })}
          autoComplete="off"
          disabled={disabled}
          error={errors?.accessKeyId ?? null}
        />

        <TextField
          id={`${fieldId}-secret-key`}
          label={t('storage.secretAccessKey')}
          value={draft.secretAccessKey}
          onChange={(value) => onChange({ secretAccessKey: value })}
          type="password"
          autoComplete="off"
          disabled={disabled}
          error={errors?.secretAccessKey ?? null}
          hint={t('storage.secretAccessKeyHint')}
        />
      </div>

      <Checkbox
        id={`${fieldId}-path-style`}
        label={t('storage.pathStyle')}
        hint={t('storage.pathStyleHint')}
        checked={draft.pathStyle}
        disabled={disabled}
        onChange={(checked) => onChange({ pathStyle: checked })}
      />
    </div>
  );
}
