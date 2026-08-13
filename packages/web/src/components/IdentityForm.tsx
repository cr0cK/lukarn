import { VERIFICATION_CODE_LENGTH } from '@lukarn/shared';
import { type FormEvent, type ReactElement, useState } from 'react';
import { errorText } from '../api/client';
import { useRequestIdentityCode, useVerifyIdentity } from '../api/hooks';
import { useT } from '../lib/i18n';

/**
 * Declares and verifies commenter identity.
 *
 * The username and password open albums and may be shared by an entire household,
 * so they do not say who writes. This form establishes it: a name, an address
 * and a code received by email to prove ownership of that address. Without this
 * proof, anyone behind the shared key could sign with somebody else's name.
 *
 * Two steps in one component: the address entered in the first remains visible
 * in the second, making a typo apparent without starting over.
 */
export function IdentityForm({ onDone }: { onDone?: () => void }): ReactElement {
  const t = useT();
  const [step, setStep] = useState<'declare' | 'code'>('declare');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState('');

  const requestCode = useRequestIdentityCode();
  const verify = useVerifyIdentity();

  const submitDeclare = (event: FormEvent): void => {
    event.preventDefault();
    if (!email.trim() || !displayName.trim() || requestCode.isPending) return;
    requestCode.mutate(
      { email: email.trim(), displayName: displayName.trim() },
      { onSuccess: () => setStep('code') },
    );
  };

  const submitCode = (event: FormEvent): void => {
    event.preventDefault();
    if (code.trim().length !== VERIFICATION_CODE_LENGTH || verify.isPending) return;
    verify.mutate({ email: email.trim(), code: code.trim() }, { onSuccess: () => onDone?.() });
  };

  if (step === 'code') {
    return (
      <form onSubmit={submitCode} className="space-y-3">
        <p className="text-sm text-ink-300">
          {t('identity.codeSent', VERIFICATION_CODE_LENGTH)}{' '}
          <span className="text-ink-100">{email}</span>.
        </p>

        <input
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={VERIFICATION_CODE_LENGTH}
          placeholder="123456"
          aria-label={t('identity.codeLabel')}
          className="w-full rounded border border-ink-700 bg-ink-900 px-3 py-2 text-center font-mono text-lg tracking-[0.3em] text-ink-100 placeholder:text-ink-400 focus:border-accent focus:outline-none"
        />

        {verify.isError && (
          <p className="text-xs text-red-400">
            {errorText(verify.error, t('identity.checkFailed'))}
          </p>
        )}

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setStep('declare');
              setCode('');
            }}
            className="text-xs text-ink-400 transition-colors hover:text-ink-100"
          >
            {t('identity.fixAddress')}
          </button>
          <button
            type="submit"
            disabled={code.length !== VERIFICATION_CODE_LENGTH || verify.isPending}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {t(verify.isPending ? 'identity.checking' : 'identity.confirm')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submitDeclare} className="space-y-3">
      {/* This is the only time someone decides to provide their address, so every
          use must be explained here, including automatic subscription to updates
          from opened albums. A default subscription is defensible in a private
          circle if announced and removable in one click — not if discovered when
          the first email arrives. */}
      <p className="text-sm text-ink-300">{t('identity.intro')}</p>

      <input
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        maxLength={64}
        placeholder={t('identity.namePlaceholder')}
        aria-label={t('identity.nameLabel')}
        className="w-full rounded border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-400 focus:border-accent focus:outline-none"
      />

      <input
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        aria-label={t('identity.emailLabel')}
        className="w-full rounded border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-400 focus:border-accent focus:outline-none"
      />

      {requestCode.isError && (
        <p className="text-xs text-red-400">
          {errorText(requestCode.error, t('identity.sendFailed'))}
        </p>
      )}

      <button
        type="submit"
        disabled={!email.trim() || !displayName.trim() || requestCode.isPending}
        className="w-full rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {t(requestCode.isPending ? 'common.sending' : 'identity.getCode')}
      </button>
    </form>
  );
}
