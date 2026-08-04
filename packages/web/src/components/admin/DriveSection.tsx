import type { AdminStatus } from '@gdv/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { api, errorText } from '../../api/client';
import { queryKeys } from '../../api/hooks';
import { formatRelative } from '../../lib/format';
import { Button, Section, type Notify } from './ui';

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
      notify({ tone: 'ok', text: 'Google Drive déconnecté.' });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminStatus });
    },
    onError: (error) =>
      notify({ tone: 'error', text: errorText(error, 'Déconnexion impossible.') }),
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
      <Section title="Connexion Google Drive">
        <div className="px-4 py-4">
          <p className="text-sm text-ink-200">
            Compte de service{status.driveAccount ? ` — ${status.driveAccount}` : ''}
          </p>
          <p className="mt-1 text-xs text-ink-400">
            Aucun consentement à donner, aucun jeton à renouveler. Chaque dossier d'album doit être
            partagé en lecture avec cette adresse depuis Google Drive — sans quoi il reste
            invisible, et sa synchronisation ne trouve rien.
          </p>
        </div>
      </Section>
    );
  }

  return (
    <Section title="Connexion Google Drive">
      <div className="flex flex-wrap items-center gap-4 px-4 py-4">
        <div className="min-w-0 flex-1">
          {!status.oauthConfigured ? (
            <p className="text-sm text-amber-300">
              GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET ne sont pas définis dans le fichier{' '}
              <code>.env</code>.
            </p>
          ) : status.driveRevokedAt ? (
            // L'autorisation a existé mais Google la refuse désormais.
            // Le dire explicitement évite de chercher la panne ailleurs.
            <>
              <p className="text-sm text-red-300">
                Autorisation révoquée
                {status.driveAccount ? ` pour ${status.driveAccount}` : ''} —{' '}
                {formatRelative(status.driveRevokedAt)}
              </p>
              <p className="mt-1 text-xs text-ink-400">
                L'accès a été retiré côté Google, ou le jeton a expiré. Les albums restent
                consultables tant que les vignettes sont en cache. Reconnecte pour reprendre les
                synchronisations.
              </p>
            </>
          ) : status.driveConnected ? (
            <p className="text-sm text-ink-200">
              Connecté{status.driveAccount ? ` — ${status.driveAccount}` : ''}
            </p>
          ) : (
            <p className="text-sm text-ink-300">
              Aucun compte connecté. Autorise l'accès en lecture à ton Drive.
            </p>
          )}
        </div>

        {status.driveConnected ? (
          <Button
            variant="danger"
            onClick={() => disconnect.mutate()}
            disabled={disconnect.isPending}
          >
            Déconnecter
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() => connect.mutate()}
            disabled={!status.oauthConfigured || connect.isPending}
          >
            {status.driveRevokedAt ? 'Reconnecter Google Drive' : 'Connecter Google Drive'}
          </Button>
        )}
      </div>
    </Section>
  );
}
