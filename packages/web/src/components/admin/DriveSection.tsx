import type { AdminStatus } from '@nonni/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { api, errorText } from '../../api/client';
import { queryKeys } from '../../api/hooks';
import { formatRelative } from '../../lib/format';
import { Button, ROW_ACTIONS_CLASS, ROW_CLASS, Section, type Notify } from './ui';

/** Section « Connexion Google Drive » : état de l'autorisation OAuth. */
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
    // Redirection pleine page : le consentement Google refuse d'être affiché
    // dans une iframe, et le callback doit revenir sur cette origine.
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (error) => notify({ tone: 'error', text: errorText(error, 'Connexion impossible.') }),
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
   * En compte de service, il n'y a rien à connecter ni à déconnecter :
   * l'autorisation vit dans le partage du dossier côté Drive, que l'API ne sait
   * pas interroger. Afficher les boutons du consentement ici laisserait croire
   * qu'ils agissent — et « Déconnecter » supprimerait une ligne qui n'existe
   * pas. Ce qu'il faut montrer, c'est l'adresse à qui partager.
   */
  if (status.driveMode === 'service_account') {
    return (
      <Section title="Google Drive connection">
        <div className="px-4 py-4">
          <p className="text-sm text-ink-200">
            Compte de service{status.driveAccount ? ` — ${status.driveAccount}` : ''}
          </p>
          <p className="mt-1 text-xs text-ink-400">
            No consent to give, no token to renew. Every album folder has to be shared read-only
            with this address from Google Drive — otherwise it stays invisible, et sa
            synchronisation ne trouve rien.
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
            // L'autorisation a existé mais Google la refuse désormais.
            // Le dire explicitement évite de chercher la panne ailleurs.
            <>
              <p className="text-sm text-red-300">
                Authorisation revoked
                {status.driveAccount ? ` pour ${status.driveAccount}` : ''} —{' '}
                {formatRelative(status.driveRevokedAt)}
              </p>
              <p className="mt-1 text-xs text-ink-400">
                Access was withdrawn on the Google side, or the token expired. The albums stay
                consultables tant que les vignettes sont en cache. Reconnecte pour reprendre les
                synchronisations.
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
