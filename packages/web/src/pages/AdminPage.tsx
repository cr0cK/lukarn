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

/** Messages from the Google consent return, passed in `?oauth=`. */
const OAUTH_MESSAGES: Record<string, Notice> = {
  connected: {
    tone: 'ok',
    text: 'Google Drive is connected. The first sync has started.',
  },
  denied: { tone: 'error', text: 'Authorisation refused on the Google side.' },
  invalid: { tone: 'error', text: 'Incomplete response from Google. Start the connection again.' },
  state_mismatch: {
    tone: 'error',
    text: 'The anti-CSRF token does not match. Start the connection again from this page.',
  },
  error: { tone: 'error', text: 'The connection failed. Check the server logs.' },
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

  // Two sections await the same album list: neither account assignment nor sync
  // status can appear before it is known, or they would wrongly announce "no albums".
  const avecAlbums = (rendu: (liste: AdminAlbum[]) => ReactElement): ReactElement => (
    <>
      {albums.isPending && <Spinner label="Loading albums" />}
      {albums.error && <FormError message={errorText(albums.error, 'Cannot load the albums.')} />}
      {albums.data && rendu(albums.data)}
    </>
  );

  // Each section mounts its contents *and* relevant waits: the moderation queue
  // does not care about album loading or a server-status error, neither of which
  // changes what it displays.
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
      case 'accounts':
        return avecAlbums((liste) => <UsersSection albums={liste} notify={setNotice} />);
      case 'comments':
        return <CommentsSection notify={setNotice} />;
      case 'server':
        return (
          <>
            {status.isPending && <Spinner />}
            {status.error && (
              <FormError message={errorText(status.error, 'Cannot load the server state.')} />
            )}
            {status.data && <DriveSection status={status.data} notify={setNotice} />}
            <SettingsSection notify={setNotice} />
            {status.data && <MaintenanceSection status={status.data} notify={setNotice} />}
          </>
        );
      case 'visits':
        return <VisitsSection />;
    }
  };

  // An unknown section — stale link or typo — is better redirected to the
  // first than displayed as a blank page.
  if (!isAdminTab(tab)) return <Navigate to="/admin/albums" replace />;

  return (
    <div className="min-h-full">
      <TopBar title="Administration" back />

      {/* Use 90 rem rather than the original 64 rem: the content column grows from
          760 to 1170 px on a laptop, where album rows truncated their title while
          one third of the screen remained empty on either side. */}
      <main className="mx-auto flex max-w-[90rem] flex-col gap-6 px-4 py-6 sm:px-6 md:flex-row">
        <AdminNav />

        <div className="min-w-0 flex-1 space-y-6">
          {message && (
            // Keep it beneath the bar: the comments section remains long, and a
            // message at the very top would go unnoticed from the bottom of the queue.
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
