import type { ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useMe } from './api/hooks';
import { Spinner } from './components/Spinner';
import AdminPage from './pages/AdminPage';
import AlbumPage from './pages/AlbumPage';
import AlbumsPage from './pages/AlbumsPage';
import DiagnosticPage from './pages/DiagnosticPage';
import LoginPage from './pages/LoginPage';
import PairPage from './pages/PairPage';

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

  if (admin && !user.admin) return <Navigate to="/" replace />;

  return children;
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
