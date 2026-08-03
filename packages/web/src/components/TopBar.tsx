import type { ReactElement, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLogout, useMe } from '../api/hooks';

interface TopBarProps {
  title: string;
  subtitle?: string | null;
  /** Affiche une flèche de retour vers la liste des albums. */
  back?: boolean;
  children?: ReactNode;
}

/** Barre supérieure collante, commune à toutes les pages authentifiées. */
export function TopBar({ title, subtitle, back = false, children }: TopBarProps): ReactElement {
  const { data: user } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 border-b border-ink-850 bg-ink-900/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[2000px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-6">
        {back && (
          <Link
            to="/"
            className="-ml-1 rounded-full p-2 text-ink-300 transition-colors hover:bg-white/5 hover:text-ink-100"
            aria-label="Retour aux albums"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M15 18 9 12l6-6" />
            </svg>
          </Link>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-medium tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-xs text-ink-400">{subtitle}</p>}
        </div>

        {/* Les contrôles de vue passent sous le titre en dessous de `sm`.
            Alignés sur une seule ligne, ils réduisaient le titre d'album à une
            initiale suivie de points de suspension — le nom de l'album compte
            plus que de gagner une rangée. */}
        {children && (
          <div className="order-last flex w-full items-center gap-2 sm:order-none sm:w-auto">
            {children}
          </div>
        )}

        {user?.admin && (
          <Link
            to="/admin"
            className="rounded-lg px-2.5 py-1.5 text-sm text-ink-300 transition-colors hover:bg-white/5 hover:text-ink-100"
          >
            Admin
          </Link>
        )}

        <button
          type="button"
          onClick={() =>
            logout.mutate(undefined, {
              onSuccess: () => void navigate('/login', { replace: true }),
            })
          }
          className="rounded-lg px-2.5 py-1.5 text-sm text-ink-300 transition-colors hover:bg-white/5 hover:text-ink-100"
        >
          Déconnexion
        </button>
      </div>
    </header>
  );
}
