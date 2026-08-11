import type { AdminAlbum } from '@nonni/shared';
import { type ReactElement, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { errorText } from '../api/client';
import { useAdminAlbums, useAdminStatus } from '../api/hooks';
import { Spinner } from '../components/Spinner';
import { TopBar } from '../components/TopBar';
import { AdminNav, type AdminTab, isAdminTab } from '../components/admin/AdminNav';
import { AlbumsSection } from '../components/admin/AlbumsSection';
import { CommentsSection } from '../components/admin/CommentsSection';
import { DriveSection } from '../components/admin/DriveSection';
import { MaintenanceSection } from '../components/admin/MaintenanceSection';
import { SettingsSection } from '../components/admin/SettingsSection';
import { UsersSection } from '../components/admin/UsersSection';
import { VisitsSection } from '../components/admin/VisitsSection';
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
  const { tab } = useParams<{ tab: string }>();
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

  // Deux rubriques attendent la même liste d'albums : ni l'attribution d'un
  // compte ni l'état de synchronisation ne peuvent s'afficher avant de la
  // connaître, sous peine d'annoncer « aucun album » à tort.
  const avecAlbums = (rendu: (liste: AdminAlbum[]) => ReactElement): ReactElement => (
    <>
      {albums.isPending && <Spinner label="Chargement des albums" />}
      {albums.error && (
        <FormError message={errorText(albums.error, 'Impossible de charger les albums.')} />
      )}
      {albums.data && rendu(albums.data)}
    </>
  );

  // Chaque rubrique monte ses sections *et* les attentes qui les concernent :
  // la file de modération n'a que faire du chargement des albums ou d'une erreur
  // sur l'état du serveur, qui ne changeraient rien à ce qu'elle affiche.
  const rubrique = (courante: AdminTab): ReactElement => {
    switch (courante) {
      case 'albums':
        return avecAlbums((liste) => (
          <AlbumsSection
            albums={liste}
            driveConnected={status.data?.driveConnected ?? false}
            notify={setNotice}
          />
        ));
      case 'comptes':
        return avecAlbums((liste) => <UsersSection albums={liste} notify={setNotice} />);
      case 'commentaires':
        return <CommentsSection notify={setNotice} />;
      case 'serveur':
        return (
          <>
            {status.isPending && <Spinner />}
            {status.error && (
              <FormError
                message={errorText(status.error, "Impossible de charger l'état du serveur.")}
              />
            )}
            {status.data && <DriveSection status={status.data} notify={setNotice} />}
            <SettingsSection notify={setNotice} />
            {status.data && <MaintenanceSection status={status.data} notify={setNotice} />}
          </>
        );
      case 'visites':
        return <VisitsSection />;
    }
  };

  // Une rubrique inconnue — lien vieilli, faute de frappe — vaut mieux ramenée
  // à la première qu'affichée en page vide.
  if (!isAdminTab(tab)) return <Navigate to="/admin/albums" replace />;

  return (
    <div className="min-h-full">
      <TopBar title="Administration" back />

      {/* 90 rem plutôt que les 64 rem d'origine : la colonne de contenu passe de
          760 à 1170 px sur un écran de portable, où les rangées d'albums
          tronquaient leur titre alors qu'un tiers de l'écran restait vide de
          chaque côté. */}
      <main className="mx-auto flex max-w-[90rem] flex-col gap-6 px-4 py-6 sm:px-6 md:flex-row">
        <AdminNav />

        <div className="min-w-0 flex-1 space-y-6">
          {message && (
            // Collé sous la barre : la rubrique des commentaires reste longue,
            // et un message affiché tout en haut passerait inaperçu depuis le
            // bas de la file.
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

          {rubrique(tab)}
        </div>
      </main>
    </div>
  );
}
