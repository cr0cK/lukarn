import type { AdminStatus } from '@lukarn/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { api, errorText } from '../../api/client';
import { queryKeys } from '../../api/hooks';
import { formatRelative } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { Button, ROW_ACTIONS_CLASS, ROW_CLASS, Section, type Notify } from './ui';

/** "Google Drive connection" section: OAuth authorisation status. */
export function DriveSection({
  status,
  notify,
}: {
  status: AdminStatus;
  notify: Notify;
}): ReactElement {
  const t = useT();
  const queryClient = useQueryClient();

  const connect = useMutation({
    mutationFn: api.oauthStart,
    // Full-page redirect: Google consent refuses display in an iframe, and the
    // callback must return to this origin.
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (error) => notify({ tone: 'error', text: errorText(error, t('drive.connectFailed')) }),
  });

  const disconnect = useMutation({
    mutationFn: api.driveDisconnect,
    onSuccess: () => {
      notify({ tone: 'ok', text: t('drive.disconnected') });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminStatus });
    },
    onError: (error) =>
      notify({ tone: 'error', text: errorText(error, t('drive.disconnectFailed')) }),
  });

  /**
   * With a service account there is nothing to connect or disconnect:
   * authorisation lives in Drive folder sharing, which the API cannot inspect.
   * Showing consent buttons here would imply they act — and "Disconnect" would
   * delete a row that does not exist. Show the address to share with instead.
   */
  if (status.driveMode === 'service_account') {
    return (
      <Section title={t('drive.title')}>
        <div className="px-4 py-4">
          <p className="text-sm text-ink-200">
            {t('drive.serviceAccount')}
            {status.driveAccount ? ` — ${status.driveAccount}` : ''}
          </p>
          <p className="mt-1 text-xs text-ink-400">{t('drive.serviceAccountHint')}</p>
        </div>
      </Section>
    );
  }

  return (
    <Section title={t('drive.title')}>
      <div className={`${ROW_CLASS} px-4 py-4 xl:items-center`}>
        <div className="min-w-0 flex-1">
          {!status.oauthConfigured ? (
            <p className="text-sm text-amber-300">
              {t('drive.notConfigured')} <code>.env</code>
              {t('drive.notConfiguredEnd')}
            </p>
          ) : status.driveRevokedAt ? (
            // Authorisation existed but Google now refuses it. State this explicitly
            // to avoid looking for the failure elsewhere.
            <>
              <p className="text-sm text-red-300">
                {t('drive.revoked')}
                {status.driveAccount ? ` ${t('drive.revokedFor', status.driveAccount)}` : ''} —{' '}
                {formatRelative(status.driveRevokedAt, t)}
              </p>
              <p className="mt-1 text-xs text-ink-400">{t('drive.revokedHint')}</p>
            </>
          ) : status.driveConnected ? (
            <p className="text-sm text-ink-200">
              {t('drive.connected')}
              {status.driveAccount ? ` — ${status.driveAccount}` : ''}
            </p>
          ) : (
            <p className="text-sm text-ink-300">{t('drive.notConnected')}</p>
          )}
        </div>

        <div className={ROW_ACTIONS_CLASS}>
          {status.driveConnected ? (
            <Button
              variant="danger"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
            >
              {t('drive.disconnect')}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => connect.mutate()}
              disabled={!status.oauthConfigured || connect.isPending}
            >
              {t(status.driveRevokedAt ? 'drive.reconnect' : 'drive.connect')}
            </Button>
          )}
        </div>
      </div>
    </Section>
  );
}
