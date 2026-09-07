import { type FormEvent, type ReactElement, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useConsumeInvite, useUpdateProfile } from '../api/hooks';
import { Brand } from '../components/Brand';
import { Spinner } from '../components/Spinner';
import { useT } from '../lib/i18n';

/**
 * Onboarding page reached via magic invitation links (/invite/:token).
 * Consumes the token, sets the session cookie, offers a display name prompt if missing,
 * and navigates directly to the user's albums.
 */
export default function InvitePage(): ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const { token } = useParams<{ token: string }>();
  const consume = useConsumeInvite();
  const updateProfile = useUpdateProfile();

  const [displayName, setDisplayName] = useState('');
  const [promptName, setPromptName] = useState(false);

  useEffect(() => {
    if (!token) return;
    consume.mutate(token, {
      onSuccess: (data) => {
        // If display name is already populated, proceed directly to home
        if (data.user.identity?.displayName) {
          navigate('/', { replace: true });
        } else {
          // Display name not set, prompt the user
          setPromptName(true);
        }
      },
    });
  }, [token]);

  const submitName = (event: FormEvent): void => {
    event.preventDefault();
    const name = displayName.trim();
    if (!name) {
      navigate('/', { replace: true });
      return;
    }

    updateProfile.mutate(
      { displayName: name },
      {
        onSettled: () => {
          navigate('/', { replace: true });
        },
      },
    );
  };

  const skip = (): void => {
    navigate('/', { replace: true });
  };

  const fieldClass =
    'w-full rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-ink-400 focus:border-accent-dim';
  const primaryClass =
    'w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
  const secondaryClass =
    'w-full rounded-lg border border-ink-700 px-3 py-2.5 text-sm text-ink-300 transition-colors hover:border-ink-500 hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-50';

  if (consume.isPending || (!consume.isError && !promptName)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
        <Brand className="mb-5" />
        <Spinner label={t('invitePage.validating')} />
      </div>
    );
  }

  if (consume.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
        <div className="w-full max-w-sm rounded-2xl border border-ink-800 bg-surface-base p-8 shadow-xl">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-500/15 text-red-400">
            <svg
              className="size-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 className="mt-4 text-base font-semibold text-ink-100">
            {t('invitePage.invalidOrExpired')}
          </h1>
          <p className="mt-2 text-xs text-ink-400">{t('invitePage.requestNew')}</p>
          <div className="mt-6">
            <button
              type="button"
              onClick={() => navigate('/login', { replace: true })}
              className={primaryClass}
            >
              {t('invitePage.goToLogin')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Brand className="mb-5" />
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          {t('invitePage.welcomeTitle')}
        </h1>
        <p className="mb-6 text-sm text-ink-400">{t('invitePage.welcomeSubtitle')}</p>

        <form onSubmit={submitName} className="space-y-4">
          <div>
            <label
              htmlFor="invite-display-name"
              className="mb-1.5 block text-xs font-medium text-ink-300"
            >
              {t('invitePage.promptDisplayName')}
            </label>
            <input
              id="invite-display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t('invitePage.displayNamePlaceholder')}
              autoFocus
              className={fieldClass}
            />
          </div>

          <button type="submit" disabled={updateProfile.isPending} className={primaryClass}>
            {updateProfile.isPending ? t('common.saving') : t('invitePage.continueToGallery')}
          </button>

          <button
            type="button"
            onClick={skip}
            disabled={updateProfile.isPending}
            className={secondaryClass}
          >
            {t('invitePage.skipAndContinue')}
          </button>
        </form>
      </div>
    </div>
  );
}
