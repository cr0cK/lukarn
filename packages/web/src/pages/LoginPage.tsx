import { VERIFICATION_CODE_LENGTH } from '@lukarn/shared';
import { type FormEvent, type ReactElement, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, errorText } from '../api/client';
import {
  useLogin,
  useMe,
  useRequestSignInCode,
  useSetupState,
  useStartPairing,
  useVerifySignInCode,
} from '../api/hooks';
import { Brand } from '../components/Brand';
import { DeviceLogin } from '../components/DeviceLogin';
import { PasswordInput } from '../components/PasswordInput';
import { Spinner } from '../components/Spinner';
import { appName } from '../lib/appName';
import { useT } from '../lib/i18n';

/**
 * The two fields on this screen, and the code step that follows the second one.
 *
 * `credentials` shows both ways in at once: a username with its password, which may
 * be a whole household's shared key, and an address, which is how somebody invited by
 * email arrives — they have never been told a username, so a screen offering only that
 * would leave them nothing to type. `code` replaces them with the six digits.
 */
type Step = 'credentials' | 'code';

export default function LoginPage(): ReactElement {
  const t = useT();
  const { data: user, isPending } = useMe();
  const { data: setup } = useSetupState();
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // The address carried by the link in an invitation. It is a convenience and no more:
  // it holds no secret and authenticates nobody, and the six digits are still typed.
  const invited = searchParams.get('email')?.trim() ?? '';
  const [email, setEmail] = useState(invited);
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  // Arriving from that link lands on the code step **without** asking for a code: the
  // reader is holding the one the message was sent with, and minting another would
  // invalidate it. `codeSent` is what separates the two, and only the wording depends
  // on it — "send another code" is offered as a deliberate action instead.
  const [step, setStep] = useState<Step>(invited ? 'code' : 'credentials');
  const [codeSent, setCodeSent] = useState(false);
  // Latched rather than read from the last error: a second refusal would otherwise
  // remove the field along with the name already typed into it.
  const [nameNeeded, setNameNeeded] = useState(false);
  const requestCode = useRequestSignInCode();
  const verifyCode = useVerifySignInCode();
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

  const askForCode = (address: string, onSent: () => void): void => {
    if (!address || requestCode.isPending) return;
    verifyCode.reset();
    requestCode.mutate({ email: address }, { onSuccess: onSent });
  };

  const submitEmail = (event: FormEvent): void => {
    event.preventDefault();
    const address = email.trim();
    askForCode(address, () => {
      setEmail(address);
      setCodeSent(true);
      setStep('code');
    });
  };

  const submitCode = (event: FormEvent): void => {
    event.preventDefault();
    const typed = code.trim();
    if (typed.length !== VERIFICATION_CODE_LENGTH || verifyCode.isPending) return;
    verifyCode.mutate(
      {
        email: email.trim(),
        code: typed,
        // Sent only once the server has asked for it. On every other path it is
        // ignored, and a name travelling with a sign-in code must never rename an
        // identity that already exists.
        ...(nameNeeded ? { displayName: displayName.trim() } : {}),
      },
      {
        onSuccess: () => void navigate(from, { replace: true }),
        onError: (error) => {
          // A valid invitation at an address no identity has verified. Nothing was
          // consumed and no attempt was counted, so the same code is resubmitted with
          // the name rather than a fresh one being requested.
          if (error instanceof ApiError && error.code === 'display_name_required') {
            setNameNeeded(true);
          }
        },
      },
    );
  };

  const useAnotherAddress = (): void => {
    setStep('credentials');
    setCode('');
    setDisplayName('');
    setNameNeeded(false);
    setCodeSent(false);
    verifyCode.reset();
    requestCode.reset();
  };

  const message =
    login.error instanceof ApiError ? login.error.message : login.error ? t('login.failed') : null;

  // A property of the instance rather than of the address typed: the server's own
  // wording for it speaks of comments, which is not what is being attempted here.
  const requestMessage =
    requestCode.error instanceof ApiError && requestCode.error.code === 'mail_not_configured'
      ? t('login.mailNotConfigured')
      : requestCode.error
        ? errorText(requestCode.error, t('login.sendFailed'))
        : null;

  // `display_name_required` is a request for one more field, not a refusal: showing it
  // in red beside the code would report a failure where nothing failed.
  const codeMessage =
    verifyCode.error instanceof ApiError && verifyCode.error.code === 'display_name_required'
      ? null
      : verifyCode.error
        ? errorText(verifyCode.error, t('login.codeFailed'))
        : null;

  const codeReady =
    code.length === VERIFICATION_CODE_LENGTH && (!nameNeeded || displayName.trim().length > 0);

  const fieldClass =
    'w-full rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-ink-400 focus:border-accent-dim';
  const primaryClass =
    'w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
  const secondaryClass =
    'w-full rounded-lg border border-ink-700 px-3 py-2.5 text-sm text-ink-300 transition-colors hover:border-ink-500 hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-50';
  const alertClass = 'rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300';

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
        ) : step === 'code' ? (
          <form onSubmit={submitCode} className="space-y-4">
            {/* True for an address nothing knows here as well: the server answers the
                same for a known address, an unknown one and one asked again inside the
                minute, and a screen announcing "sent" would reopen in the interface
                the enumeration channel that answer closes. */}
            <p className="text-sm text-ink-300">
              {codeSent
                ? t('login.codeSent', VERIFICATION_CODE_LENGTH, email)
                : t('login.codeFromEmail', VERIFICATION_CODE_LENGTH, email)}
            </p>

            <div>
              <label htmlFor="code" className="mb-1.5 block text-sm text-ink-300">
                {t('login.codeLabel')}
              </label>
              <input
                id="code"
                name="code"
                // Six digits typed on a phone keyboard, or pasted from the message with
                // the spaces a selection brings along: everything but a digit is
                // dropped, since the server trims and then requires exactly six.
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                value={code}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={VERIFICATION_CODE_LENGTH}
                required
                autoFocus
                placeholder="123456"
                className={`${fieldClass} text-center font-mono text-lg tracking-[0.3em]`}
              />
            </div>

            {nameNeeded && (
              <div>
                <p className="mb-3 text-sm text-ink-300">{t('login.nameNeeded')}</p>
                <label htmlFor="displayName" className="mb-1.5 block text-sm text-ink-300">
                  {t('login.nameLabel')}
                </label>
                <input
                  id="displayName"
                  name="displayName"
                  type="text"
                  autoComplete="name"
                  maxLength={64}
                  required
                  autoFocus
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder={t('login.namePlaceholder')}
                  className={fieldClass}
                />
              </div>
            )}

            {codeMessage && (
              <p role="alert" className={alertClass}>
                {codeMessage}
              </p>
            )}
            {requestMessage && (
              <p role="alert" className={alertClass}>
                {requestMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={!codeReady || verifyCode.isPending}
              className={primaryClass}
            >
              {t(verifyCode.isPending ? 'login.submitting' : 'login.submit')}
            </button>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={useAnotherAddress}
                className="text-xs text-ink-400 transition-colors hover:text-ink-100"
              >
                {t('login.otherAddress')}
              </button>
              <button
                type="button"
                onClick={() => askForCode(email.trim(), () => setCodeSent(true))}
                disabled={requestCode.isPending}
                className="text-xs text-ink-400 transition-colors hover:text-ink-100 disabled:opacity-50"
              >
                {t(requestCode.isPending ? 'common.sending' : 'login.resend')}
              </button>
            </div>

            {/* An invitation that has run out leaves nothing to send again, and the
                server cannot say so without also saying which addresses it knows. The
                screen states it beforehand rather than leaving somebody pressing a
                button that will silently do nothing. */}
            <p className="text-xs text-ink-400">{t('login.invitationExpired')}</p>
          </form>
        ) : (
          <>
            {/* On a fresh installation no input can succeed until an account exists.
            Saying so avoids looking for a failure when one installation step
            merely remains. */}
            {setup?.needsSetup && (
              <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                <p className="font-medium">{t('login.noAccount')}</p>
                {/* Both forms: this screen cannot tell which one the reader can run,
                and the published image carries no pnpm — naming only that one left
                every container installation with a command that does not exist
                there (D260815e). */}
                <p className="mt-1 text-amber-200/80">{t('login.createAdmin')}</p>
                <code className="mt-2 block rounded bg-black/30 px-2 py-1 font-mono text-xs break-all text-amber-100">
                  docker compose exec app node packages/server/dist/scripts/create-admin.js
                  &lt;username&gt;
                </code>
                <p className="mt-2 text-amber-200/80">{t('login.createAdminFromSource')}</p>
                <code className="mt-1 block rounded bg-black/30 px-2 py-1 font-mono text-xs break-all text-amber-100">
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
                  className={fieldClass}
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
                  className={fieldClass}
                />
              </div>

              {message && (
                <p role="alert" className={alertClass}>
                  {message}
                </p>
              )}

              <button type="submit" disabled={login.isPending} className={primaryClass}>
                {t(login.isPending ? 'login.submitting' : 'login.submit')}
              </button>
            </form>

            {/* The other way in, on the same screen and shown at the same time: whoever
                was invited by email holds an address and no username, and a screen that
                made them work out which of the two is theirs would already have lost
                them. */}
            <form onSubmit={submitEmail} className="mt-6 space-y-4 border-t border-ink-700 pt-6">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm text-ink-300">
                  {t('login.email')}
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className={fieldClass}
                />
                <p className="mt-1.5 text-xs text-ink-400">{t('login.emailHint')}</p>
              </div>

              {requestMessage && (
                <p role="alert" className={alertClass}>
                  {requestMessage}
                </p>
              )}

              <button type="submit" disabled={requestCode.isPending} className={secondaryClass}>
                {t(requestCode.isPending ? 'common.sending' : 'login.sendCode')}
              </button>
            </form>

            {/* The third path is for a screen without a keyboard: a television
                where every character is entered by remote (D260809c). It opens
                no request until clicked. */}
            <button
              type="button"
              onClick={() => pairing.mutate()}
              className={`mt-6 ${secondaryClass}`}
            >
              {t('login.withPhone')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
