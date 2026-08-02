import type { Album, SyncStatus } from '@gdv/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import { queryKeys, useAdminStatus } from '../api/hooks';
import { Spinner } from '../components/Spinner';
import { TopBar } from '../components/TopBar';
import { formatBytes, formatRelative } from '../lib/format';

/** Messages du retour de consentement Google, passés en `?oauth=`. */
const OAUTH_MESSAGES: Record<string, { tone: 'ok' | 'error'; text: string }> = {
  connected: {
    tone: 'ok',
    text: 'Google Drive est connecté. La première synchronisation a démarré.',
  },
  denied: { tone: 'error', text: 'Autorisation refusée côté Google.' },
  invalid: { tone: 'error', text: 'Réponse Google incomplète. Recommence la connexion.' },
  state_mismatch: {
    tone: 'error',
    text: 'Le jeton anti-CSRF ne correspond pas. Relance la connexion depuis cette page.',
  },
  error: { tone: 'error', text: 'La connexion a échoué. Consulte les logs du serveur.' },
};

const SYNC_LABELS: Record<SyncStatus, { text: string; className: string }> = {
  never: { text: 'jamais synchronisé', className: 'text-ink-400' },
  running: { text: 'synchronisation en cours', className: 'text-accent' },
  ok: { text: 'à jour', className: 'text-emerald-400' },
  error: { text: 'en erreur', className: 'text-red-400' },
};

function Button({
  children,
  onClick,
  disabled = false,
  variant = 'default',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'danger';
}): ReactElement {
  const styles = {
    default: 'border border-ink-600 text-ink-200 hover:bg-white/5',
    primary: 'bg-accent text-ink-950 hover:opacity-90',
    danger: 'border border-red-500/40 text-red-300 hover:bg-red-500/10',
  }[variant];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

function AlbumRow({ album, onResync }: { album: Album; onResync: () => void }): ReactElement {
  const status = SYNC_LABELS[album.syncStatus];
  const synced = formatRelative(album.lastSyncAt);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink-850 px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-100">{album.title}</p>
        <p className="truncate text-xs text-ink-400">
          <code>{album.id}</code> · {album.itemCount.toLocaleString('fr-FR')} éléments
          {synced ? ` · synchronisé ${synced}` : ''}
        </p>
        {album.syncError && (
          <p className="mt-1 text-xs break-words text-red-400">{album.syncError}</p>
        )}
      </div>

      <span className={`text-xs ${status.className}`}>{status.text}</span>

      <Button onClick={onResync} disabled={album.syncStatus === 'running'}>
        Resynchroniser
      </Button>
    </div>
  );
}

export default function AdminPage(): ReactElement {
  const queryClient = useQueryClient();
  const { data: status, isPending } = useAdminStatus();
  const [searchParams, setSearchParams] = useSearchParams();
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const oauthResult = searchParams.get('oauth');
  const oauthMessage = oauthResult ? OAUTH_MESSAGES[oauthResult] : undefined;

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminStatus });
  };

  const connect = useMutation({
    mutationFn: api.oauthStart,
    // Redirection pleine page : le consentement Google refuse d'être affiché
    // dans une iframe, et le callback doit revenir sur cette origine.
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (error) =>
      setNotice({
        tone: 'error',
        text: error instanceof ApiError ? error.message : 'Connexion impossible.',
      }),
  });

  const disconnect = useMutation({
    mutationFn: api.driveDisconnect,
    onSuccess: () => {
      setNotice({ tone: 'ok', text: 'Google Drive déconnecté.' });
      refresh();
    },
  });

  const resync = useMutation({
    mutationFn: (albumId?: string) => api.resync(albumId),
    onSuccess: ({ started }) => {
      setNotice({ tone: 'ok', text: `Synchronisation lancée : ${started.join(', ')}` });
      refresh();
    },
    onError: (error) =>
      setNotice({
        tone: 'error',
        text: error instanceof ApiError ? error.message : 'Synchronisation impossible.',
      }),
  });

  const reload = useMutation({
    mutationFn: api.reloadConfig,
    onSuccess: (result) => {
      setNotice({
        tone: 'ok',
        text: `Configuration rechargée : ${result.users} utilisateurs, ${result.albums} albums.`,
      });
      void queryClient.invalidateQueries();
    },
    onError: (error) =>
      setNotice({
        tone: 'error',
        text: error instanceof ApiError ? error.message : 'Rechargement impossible.',
      }),
  });

  const clearCache = useMutation({
    mutationFn: api.clearCache,
    onSuccess: () => {
      setNotice({ tone: 'ok', text: 'Cache vidé. Les vignettes seront régénérées à la demande.' });
      refresh();
    },
  });

  const message = notice ?? oauthMessage ?? null;

  return (
    <div className="min-h-full">
      <TopBar title="Administration" back />

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
        {message && (
          <p
            role="status"
            className={`rounded-lg px-4 py-3 text-sm ${
              message.tone === 'ok'
                ? 'bg-emerald-500/10 text-emerald-300'
                : 'bg-red-500/10 text-red-300'
            }`}
          >
            {message.text}
            <button
              type="button"
              onClick={() => {
                setNotice(null);
                if (oauthResult) setSearchParams({}, { replace: true });
              }}
              className="ml-3 text-xs underline underline-offset-2 opacity-70 hover:opacity-100"
            >
              masquer
            </button>
          </p>
        )}

        {isPending && <Spinner />}

        {status && (
          <>
            <section className="rounded-xl border border-ink-800 bg-ink-850/50">
              <header className="border-b border-ink-850 px-4 py-3">
                <h2 className="text-sm font-medium">Connexion Google Drive</h2>
              </header>

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
                        consultables tant que les vignettes sont en cache. Reconnecte pour reprendre
                        les synchronisations.
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
                  <Button variant="danger" onClick={() => disconnect.mutate()}>
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
            </section>

            <section className="rounded-xl border border-ink-800 bg-ink-850/50">
              <header className="flex items-center justify-between border-b border-ink-850 px-4 py-3">
                <h2 className="text-sm font-medium">Albums</h2>
                <Button
                  onClick={() => resync.mutate(undefined)}
                  disabled={!status.driveConnected || resync.isPending}
                >
                  Tout resynchroniser
                </Button>
              </header>

              {status.albums.length === 0 ? (
                <p className="px-4 py-6 text-sm text-ink-400">Aucun album déclaré.</p>
              ) : (
                status.albums.map((album) => (
                  <AlbumRow key={album.id} album={album} onResync={() => resync.mutate(album.id)} />
                ))
              )}
            </section>

            <section className="rounded-xl border border-ink-800 bg-ink-850/50">
              <header className="border-b border-ink-850 px-4 py-3">
                <h2 className="text-sm font-medium">Maintenance</h2>
              </header>

              <div className="flex flex-wrap items-center gap-4 px-4 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-200">
                    Cache : {formatBytes(status.cache.bytes)} sur{' '}
                    {formatBytes(status.cache.maxBytes)}
                  </p>
                  <p className="text-xs text-ink-400">
                    {status.cache.entryCount.toLocaleString('fr-FR')} vignettes générées
                  </p>
                </div>

                <Button onClick={() => reload.mutate()} disabled={reload.isPending}>
                  Recharger albums.yaml
                </Button>
                <Button
                  variant="danger"
                  onClick={() => clearCache.mutate()}
                  disabled={clearCache.isPending}
                >
                  Vider le cache
                </Button>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
