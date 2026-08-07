import type { ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useMe } from './api/hooks';
import { Spinner } from './components/Spinner';
import AdminPage from './pages/AdminPage';
import AlbumPage from './pages/AlbumPage';
import AlbumsPage from './pages/AlbumsPage';
import LoginPage from './pages/LoginPage';

function FullPageSpinner(): ReactElement {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  );
}

/**
 * Garde d'authentification. Le serveur refuse déjà toute route protégée : ce
 * garde ne fait qu'éviter d'afficher une page vide en attendant le 401.
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
    // La destination est mémorisée pour y revenir après la connexion.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (admin && !user.admin) return <Navigate to="/" replace />;

  return children;
}

export default function App(): ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
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
      {/* `/admin` sans rubrique reste un lien valide : les signets et la barre
          supérieure y mènent encore. */}
      <Route path="/admin" element={<Navigate to="/admin/albums" replace />} />
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
