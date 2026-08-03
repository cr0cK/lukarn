import { type ReactElement, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorText } from '../api/client';
import { useAdminAlbums, useAdminStatus } from '../api/hooks';
import { Spinner } from '../components/Spinner';
import { TopBar } from '../components/TopBar';
import { AlbumsSection } from '../components/admin/AlbumsSection';
import { CommentsSection } from '../components/admin/CommentsSection';
import { DriveSection } from '../components/admin/DriveSection';
import { MaintenanceSection } from '../components/admin/MaintenanceSection';
import { SettingsSection } from '../components/admin/SettingsSection';
import { UsersSection } from '../components/admin/UsersSection';
import { FormError, type Notice } from '../components/admin/ui';

/** Messages du retour de consentement Google, passés en `?oauth=`. */
const OAUTH_MESSAGES: Record<string, Notice> = {
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

export default function AdminPage(): ReactElement {
  const status = useAdminStatus();
  const albums = useAdminAlbums();
  const [searchParams, setSearchParams] = useSearchParams();
  const [notice, setNotice] = useState<Notice | null>(null);

  const oauthResult = searchParams.get('oauth');
  const message = notice ?? (oauthResult ? OAUTH_MESSAGES[oauthResult] : undefined) ?? null;

  const dismiss = (): void => {
    setNotice(null);
    if (oauthResult) setSearchParams({}, { replace: true });
  };

  return (
    <div className="min-h-full">
      <TopBar title="Administration" back />

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
        {message && (
          // Collé sous la barre : les sections sont longues, et un message
          // affiché tout en haut passerait inaperçu depuis le bas de la page.
          <p
            role="status"
            className={`sticky top-16 z-20 rounded-lg px-4 py-3 text-sm ${
              message.tone === 'ok'
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-red-500/15 text-red-300'
            }`}
          >
            {message.text}
            <button
              type="button"
              onClick={dismiss}
              className="ml-3 text-xs underline underline-offset-2 opacity-70 hover:opacity-100"
            >
              masquer
            </button>
          </p>
        )}

        {status.isPending && <Spinner />}

        {status.error && (
          <FormError
            message={errorText(status.error, "Impossible de charger l'état du serveur.")}
          />
        )}

        {status.data && <DriveSection status={status.data} notify={setNotice} />}

        {albums.isPending && <Spinner label="Chargement des albums" />}

        {albums.error && (
          <FormError message={errorText(albums.error, 'Impossible de charger les albums.')} />
        )}

        {/* Les deux sections partagent la même liste d'albums : l'attribution
            d'un compte ne peut pas s'afficher avant de la connaître, sous peine
            d'annoncer « aucun album » à tort. */}
        {albums.data && (
          <>
            <UsersSection albums={albums.data} notify={setNotice} />
            <AlbumsSection
              albums={albums.data}
              driveConnected={status.data?.driveConnected ?? false}
              notify={setNotice}
            />
          </>
        )}

        <CommentsSection notify={setNotice} />

        <SettingsSection notify={setNotice} />

        {status.data && <MaintenanceSection status={status.data} notify={setNotice} />}
      </main>
    </div>
  );
}
