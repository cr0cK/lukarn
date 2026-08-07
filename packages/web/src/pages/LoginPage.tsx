import { type FormEvent, type ReactElement, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useLogin, useMe, useSetupState } from '../api/hooks';
import { Spinner } from '../components/Spinner';
import { appName } from '../lib/appName';

export default function LoginPage(): ReactElement {
  const { data: user, isPending } = useMe();
  const { data: setup } = useSetupState();
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';

  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (user) return <Navigate to={from} replace />;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    login.mutate(
      { username, password },
      { onSuccess: () => void navigate(from, { replace: true }) },
    );
  };

  const message =
    login.error instanceof ApiError
      ? login.error.message
      : login.error
        ? 'Connexion impossible. Réessaie.'
        : null;

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">{appName()}</h1>
        <p className="mb-8 text-sm text-ink-400">Connecte-toi pour accéder aux albums.</p>

        {/* Installation neuve : aucune saisie ne peut aboutir tant qu'aucun
            compte n'existe. Le dire ici évite de chercher une panne là où il
            n'y a qu'une étape d'installation qui reste à faire. */}
        {setup?.needsSetup && (
          <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <p className="font-medium">Aucun compte n'est encore configuré.</p>
            <p className="mt-1 text-amber-200/80">
              Crée le premier administrateur sur le serveur :
            </p>
            <code className="mt-2 block rounded bg-black/30 px-2 py-1 font-mono text-xs text-amber-100">
              pnpm create-admin &lt;identifiant&gt;
            </code>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="username" className="mb-1.5 block text-sm text-ink-300">
              Identifiant
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="w-full rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-ink-400 focus:border-accent-dim"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm text-ink-300">
              Mot de passe
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-ink-400 focus:border-accent-dim"
            />
          </div>

          {message && (
            <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={login.isPending}
            className="w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {login.isPending ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  );
}
