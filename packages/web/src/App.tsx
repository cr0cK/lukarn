import type { ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useMe } from './api/hooks';
import { Spinner } from './components/Spinner';
import { useT } from './lib/i18n';
import AdminPage from './pages/AdminPage';
import AlbumPage from './pages/AlbumPage';
import AlbumsPage from './pages/AlbumsPage';
import DiagnosticPage from './pages/DiagnosticPage';
import LoginPage from './pages/LoginPage';
import PairPage from './pages/PairPage';
import SettingsPage from './pages/SettingsPage';
import SharePage, { ShareFrame } from './pages/SharePage';

function FullPageSpinner(): ReactElement {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  );
}

/**
 * Authentication guard. The server already rejects every protected route: this
 * guard only avoids showing a blank page while waiting for the 401.
 */
function RequireAuth({
  children,
  admin = false,
}: {
  children: ReactElement;
  admin?: boolean;
}): ReactElement {
  const { data: user, isPending } = useMe();
  const location = useLocation();

  if (isPending) return <FullPageSpinner />;

  if (!user) {
    // Remember the destination so it can be restored after sign-in.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // A **share link** opened this session, and it reaches its own page and no other
  // (D260825d). The guard is told what kind of session it holds rather than only
  // whether it holds one: `/api/auth/me` answers for a link exactly as it does for
  // an account, so on its own that answer would draw the album list, the settings
  // screen and the account menu with its sign-out control — the whole of what that
  // decision refuses. The server refuses the rest in any case; what is at stake
  // here is that the recipient is never shown it.
  //
  // It **renders** rather than redirects, and there is nowhere to redirect to: the
  // token lives in the address the visitor was sent and nothing here holds a copy,
  // so `/` would send them to `/`. The page says what to do instead, carrying the
  // instance's mark and no sign-in control, exactly as the share page does.
  if (user.username === null) return <ShareElsewhere />;

  if (admin && !user.admin) return <Navigate to="/" replace />;

  return children;
}

/**
 * What a link's session gets anywhere but its own page.
 *
 * Not the album list, not the sign-in screen, and not a blank page: one sentence
 * telling somebody who typed an address they were not sent where the photographs
 * are. Nothing here says that other content exists (D260825d).
 */
function ShareElsewhere(): ReactElement {
  const t = useT();
  return (
    <ShareFrame>
      <p className="text-center text-sm text-ink-300">{t('share.elsewhere')}</p>
    </ShareFrame>
  );
}

export default function App(): ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Unguarded, like the sign-in screen: it reports a browser that renders
          badly, and the one that cannot sign in is precisely the one whose
          report is needed. It exposes only the visitor's capabilities, nothing
          about the instance. */}
      <Route path="/diagnostic" element={<DiagnosticPage />} />
      {/* Unguarded, and it has to be: its visitor holds a link and no session, and
          this is the address that opens one for them. Ordering is not the lever —
          this router matches by computed rank, so the catch-all sorts last wherever
          it is written (D260825d). */}
      <Route path="/s/:token" element={<SharePage />} />
      {/* Screen approval, opened from the phone. Guarded like the rest: without
          a session, /login brings the visitor back here with the code. */}
      <Route
        path="/pair"
        element={
          <RequireAuth>
            <PairPage />
          </RequireAuth>
        }
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AlbumsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/album/:albumId"
        element={
          <RequireAuth>
            <AlbumPage />
          </RequireAuth>
        }
      />
      {/* Guarded, but **not** by `admin`: nothing here acts on the instance, only
          on how this browser shows it. */}
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />
      {/* `/admin` is a page of its own, not a redirect: on a phone it is the list
          of sections, and a redirect would leave nowhere for a section's back
          arrow to return to. From `md` it still opens on Albums, so the address
          behaves as it always did on a desktop. */}
      <Route
        path="/admin"
        element={
          <RequireAuth admin>
            <AdminPage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin/:tab"
        element={
          <RequireAuth admin>
            <AdminPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
