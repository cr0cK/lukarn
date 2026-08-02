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
      <div className="mx-auto flex max-w-[2000px] items-center gap-3 px-4 py-3 sm:px-6">
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

        {children}

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
