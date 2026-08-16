import type { StorageConnectionStatus } from '@lukarn/shared';
import type { ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, errorText } from '../../../api/client';
import { useDisconnectStorage, useTestStorage } from '../../../api/hooks';
import { formatRelative } from '../../../lib/format';
import { useT } from '../../../lib/i18n';
import { KIND_LABELS } from '../../../lib/storageDraft';
import { Button, ROW_ACTIONS_CLASS, ROW_CLASS, type Notify } from '../ui';

/**
 * One connection: its state, and the controls its kind of **authorisation** allows.
 *
 * Every branch below reads `authorization`, never the kind. Reading the kind instead
 * would mean a new branch for every backend, in a component whose job is not to know
 * them apart: what decides whether there is a button to press is how a connection is
 * authorised, and three kinds already share the same answer.
 */
export function StorageRow({
  connection,
  oauthConfigured,
  notify,
  onEdit,
  onDelete,
}: {
  connection: StorageConnectionStatus;
  oauthConfigured: boolean;
  notify: Notify;
  onEdit: () => void;
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

        {/* A corrected endpoint or a rotated key is an edit, not a deletion followed
            by a recreation — which the albums reading this connection forbid anyway. */}
        <Button onClick={onEdit} ariaLabel={t('storage.editOne', connection.label)}>
          {t('storage.edit')}
        </Button>

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
