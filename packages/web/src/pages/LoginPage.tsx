import { type FormEvent, type ReactElement, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useLogin, useMe, useSetupState, useStartPairing } from '../api/hooks';
import { Brand } from '../components/Brand';
import { DeviceLogin } from '../components/DeviceLogin';
import { PasswordInput } from '../components/PasswordInput';
import { Spinner } from '../components/Spinner';
import { appName } from '../lib/appName';
import { useT } from '../lib/i18n';

export default function LoginPage(): ReactElement {
  const t = useT();
  const { data: user, isPending } = useMe();
  const { data: setup } = useSetupState();
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // Pairing starts here from the click, not from a mount effect in `DeviceLogin`:
  // the latter would lose its result under `StrictMode` (see the component
  // comment). `isIdle` simply says whether the panel is open.
  const pairing = useStartPairing();

  const origin = (location.state as { from?: { pathname: string; search?: string } } | null)?.from;
  // Search is part of the destination: `/pair?code=…` without its code would
  // return to a page that no longer knows what to approve.
  const from = origin ? `${origin.pathname}${origin.search ?? ''}` : '/';

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
    // An identifier never contains spaces (`USERNAME_PATTERN`), but a mobile
    // keyboard adds one after autocomplete and pasted text brings them on both
    // sides. Without trimming, input looks correct while sign-in is refused
    // without further explanation.
    login.mutate(
      { username: username.trim(), password },
      { onSuccess: () => void navigate(from, { replace: true }) },
    );
  };

  const message =
    login.error instanceof ApiError ? login.error.message : login.error ? t('login.failed') : null;

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        {/* The one screen where the application introduces itself: whoever arrives
            here has followed a link from an email or a message, and the mark is
            what tells them they are on the right gallery before they type. */}
        <Brand className="mb-5" />
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">{appName()}</h1>
        <p className="mb-8 text-sm text-ink-400">{t('login.subtitle')}</p>

        {!pairing.isIdle ? (
          <DeviceLogin
            pairing={pairing.data ?? null}
            error={pairing.error}
            onRetry={() => pairing.mutate()}
            onCancel={() => pairing.reset()}
          />
        ) : (
          <>
            {/* On a fresh installation no input can succeed until an account exists.
            Saying so avoids looking for a failure when one installation step
            merely remains. */}
            {setup?.needsSetup && (
              <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                <p className="font-medium">{t('login.noAccount')}</p>
                <p className="mt-1 text-amber-200/80">{t('login.createAdmin')}</p>
                <code className="mt-2 block rounded bg-black/30 px-2 py-1 font-mono text-xs text-amber-100">
                  pnpm create-admin &lt;username&gt;
                </code>
              </div>
            )}

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label htmlFor="username" className="mb-1.5 block text-sm text-ink-300">
                  {t('login.username')}
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
                  {t('login.password')}
                </label>
                <PasswordInput
                  id="password"
                  name="password"
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
                className="w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t(login.isPending ? 'login.submitting' : 'login.submit')}
              </button>
            </form>

            {/* The second path is for a screen without a keyboard: a television
                where every character is entered by remote (D260809c). It opens
                no request until clicked. */}
            <button
              type="button"
              onClick={() => pairing.mutate()}
              className="mt-6 w-full rounded-lg border border-ink-700 px-3 py-2.5 text-sm text-ink-300 transition-colors hover:border-ink-500 hover:text-ink-100"
            >
              {t('login.withPhone')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
