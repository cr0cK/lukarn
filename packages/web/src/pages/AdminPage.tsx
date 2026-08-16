import type { AdminAlbum } from '@lukarn/shared';
import { type ReactElement, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { errorText } from '../api/client';
import { useAdminAlbums, useAdminStatus } from '../api/hooks';
import { BottomTabs } from '../components/BottomTabs';
import { CommentsFeed, useActivityFeed } from '../components/CommentsFeed';
import { Spinner } from '../components/Spinner';
import { useT } from '../lib/i18n';
import { PHONE_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import { TopBar } from '../components/TopBar';
import { AdminMenu, AdminNav, type AdminTab, isAdminTab } from '../components/admin/AdminNav';
import { AlbumsSection } from '../components/admin/AlbumsSection';
import { CommentsSection } from '../components/admin/CommentsSection';
import { OAUTH_MESSAGES, StorageSection } from '../components/admin/storage/StorageSection';
import { IdentitySection } from '../components/admin/IdentitySection';
import { MaintenanceSection } from '../components/admin/MaintenanceSection';
import { SettingsSection } from '../components/admin/SettingsSection';
import { UsersSection } from '../components/admin/UsersSection';
import { VisitsSection } from '../components/admin/VisitsSection';
import { PoweredBy } from '../components/PoweredBy';
import { FormError, Section, type Notice } from '../components/admin/ui';

export default function AdminPage(): ReactElement {
  const t = useT();
  const { tab } = useParams<{ tab: string }>();
  const status = useAdminStatus();
  const albums = useAdminAlbums();
  const [searchParams, setSearchParams] = useSearchParams();
  const [notice, setNotice] = useState<Notice | null>(null);
  // Administration also carries the tab bar on a phone, and a tab that does
  // nothing on one page is exactly the irregularity these tabs remove. The
  // drawer is global anyway — its scope is `null`, every album the account sees.
  const activity = useActivityFeed();
  const phone = useMediaQuery(PHONE_QUERY);

  const oauthResult = searchParams.get('oauth');
  const retourOauth = oauthResult ? OAUTH_MESSAGES[oauthResult] : undefined;
  const message: Notice | null =
    notice ?? (retourOauth ? { tone: retourOauth.tone, text: t(retourOauth.text) } : null);

  const dismiss = (): void => {
    setNotice(null);
    if (oauthResult) setSearchParams({}, { replace: true });
  };

  // Two sections await the same album list: neither account assignment nor sync
  // status can appear before it is known, or they would wrongly announce "no albums".
  const avecAlbums = (rendu: (liste: AdminAlbum[]) => ReactElement): ReactElement => (
    <>
      {albums.isPending && <Spinner label={t('albums.loading')} />}
      {albums.error && <FormError message={errorText(albums.error, t('albums.loadFailed'))} />}
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
          <AlbumsSection albums={liste} storage={status.data?.storage ?? []} notify={setNotice} />
        ));
      case 'accounts':
        return avecAlbums((liste) => <UsersSection albums={liste} notify={setNotice} />);
      case 'comments':
        return <CommentsSection notify={setNotice} />;
      case 'identity':
        return <IdentitySection notify={setNotice} />;
      case 'storage':
        return (
          <>
            {status.isPending && <Spinner />}
            {status.error && (
              <FormError message={errorText(status.error, t('admin.statusFailed'))} />
            )}
            {status.data && <StorageSection status={status.data} notify={setNotice} />}
          </>
        );
      case 'server':
        return (
          <>
            {/* Only maintenance reads the server state here; settings and the
                version line do not, and neither waits on it. */}
            {status.isPending && <Spinner />}
            {status.error && (
              <FormError message={errorText(status.error, t('admin.statusFailed'))} />
            )}
            <SettingsSection notify={setNotice} />
            {status.data && <MaintenanceSection status={status.data} notify={setNotice} />}
            {/* Last, and its own section: whoever operates the instance is here,
                not in the account menu, and an available release is the one thing
                on this page that comes from outside the machine. */}
            <Section title={t('version.title')}>
              <div className="px-4 py-4">
                <PoweredBy />
              </div>
            </Section>
          </>
        );
      case 'visits':
        return <VisitsSection />;
    }
  };

  // An unknown section — stale link or typo — is better redirected to the root
  // than displayed as a blank page. `/admin` itself carries no segment and is
  // not an error: it is the root of administration.
  if (tab !== undefined && !isAdminTab(tab)) return <Navigate to="/admin" replace />;

  /**
   * `/admin` is the list of sections **on a phone only**. On a desktop the
   * sidebar already lists them beside every section, so a screen whose whole
   * content repeated that column would be a screen for nothing — and it keeps
   * redirecting to the first section, exactly as D66 left it, which also keeps
   * `AdminNav` reading its selected entry from the router rather than from a
   * path comparison.
   */
  const root = tab === undefined;
  if (root && !phone) return <Navigate to="/admin/albums" replace />;

  return (
    <div className="min-h-full">
      {/* The back arrow follows the level above, which differs by width: a phone
          came from the list of sections, a desktop from the gallery, where
          `/admin` was never a screen of its own. */}
      <TopBar title={t('admin.title')} back backTo={phone && !root ? '/admin' : '/'} />

      {/* Use 90 rem rather than the original 64 rem: the content column grows from
          760 to 1170 px on a laptop, where album rows truncated their title while
          one third of the screen remained empty on either side. */}
      {/* The tab bar is `fixed` and therefore outside the flow: the page reserves
          its height itself, or the last setting would end underneath it. */}
      <main className="mx-auto flex max-w-[90rem] flex-col gap-6 px-4 py-6 pb-[calc(5rem_+_env(safe-area-inset-bottom))] sm:px-6 md:flex-row md:pb-6">
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
                {t('common.hide')}
              </button>
            </p>
          )}

          {root ? <AdminMenu unread={activity.unread} /> : rubrique(tab)}
        </div>
      </main>

      <BottomTabs current={null} activity={activity} />

      {activity.isOpen && (
        <CommentsFeed albumId={null} albumTitle={null} onClose={activity.close} />
      )}
    </div>
  );
}
