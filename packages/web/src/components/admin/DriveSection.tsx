import type { AdminStatus } from '@lukarn/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { api, errorText } from '../../api/client';
import { queryKeys } from '../../api/hooks';
import { formatRelative } from '../../lib/format';
import { Button, ROW_ACTIONS_CLASS, ROW_CLASS, Section, type Notify } from './ui';

/** "Google Drive connection" section: OAuth authorisation status. */
export function DriveSection({
  status,
  notify,
}: {
  status: AdminStatus;
  notify: Notify;
}): ReactElement {
  const queryClient = useQueryClient();

  const connect = useMutation({
    mutationFn: api.oauthStart,
    // Full-page redirect: Google consent refuses display in an iframe, and the
    // callback must return to this origin.
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (error) => notify({ tone: 'error', text: errorText(error, 'Connection failed.') }),
  });

  const disconnect = useMutation({
    mutationFn: api.driveDisconnect,
    onSuccess: () => {
      notify({ tone: 'ok', text: 'Google Drive disconnected.' });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminStatus });
    },
    onError: (error) => notify({ tone: 'error', text: errorText(error, 'Cannot disconnect.') }),
  });

  /**
   * With a service account there is nothing to connect or disconnect:
   * authorisation lives in Drive folder sharing, which the API cannot inspect.
   * Showing consent buttons here would imply they act — and "Disconnect" would
   * delete a row that does not exist. Show the address to share with instead.
   */
  if (status.driveMode === 'service_account') {
    return (
      <Section title="Google Drive connection">
        <div className="px-4 py-4">
          <p className="text-sm text-ink-200">
            Service account{status.driveAccount ? ` — ${status.driveAccount}` : ''}
          </p>
          <p className="mt-1 text-xs text-ink-400">
            No consent to give, no token to renew. Every album folder has to be shared read-only
            with this address from Google Drive — otherwise it stays invisible, and its
            synchronisation finds nothing.
          </p>
        </div>
      </Section>
    );
  }

  return (
    <Section title="Google Drive connection">
      <div className={`${ROW_CLASS} px-4 py-4 xl:items-center`}>
        <div className="min-w-0 flex-1">
          {!status.oauthConfigured ? (
            <p className="text-sm text-amber-300">
              GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set in the <code>.env</code> file.
            </p>
          ) : status.driveRevokedAt ? (
            // Authorisation existed but Google now refuses it. State this explicitly
            // to avoid looking for the failure elsewhere.
            <>
              <p className="text-sm text-red-300">
                Authorisation revoked
                {status.driveAccount ? ` for ${status.driveAccount}` : ''} —{' '}
                {formatRelative(status.driveRevokedAt)}
              </p>
              <p className="mt-1 text-xs text-ink-400">
                Access was withdrawn on the Google side, or the token expired. The albums stay
                viewable as long as thumbnails remain cached. Reconnect to resume synchronisation.
              </p>
            </>
          ) : status.driveConnected ? (
            <p className="text-sm text-ink-200">
              Connected{status.driveAccount ? ` — ${status.driveAccount}` : ''}
            </p>
          ) : (
            <p className="text-sm text-ink-300">
              No account connected. Authorise read access to your Drive.
            </p>
          )}
        </div>

        <div className={ROW_ACTIONS_CLASS}>
          {status.driveConnected ? (
            <Button
              variant="danger"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
            >
              Disconnect
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => connect.mutate()}
              disabled={!status.oauthConfigured || connect.isPending}
            >
              {status.driveRevokedAt ? 'Reconnect Google Drive' : 'Connect Google Drive'}
            </Button>
          )}
        </div>
      </div>
    </Section>
  );
}
