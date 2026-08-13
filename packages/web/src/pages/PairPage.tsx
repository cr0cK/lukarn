import { USER_CODE_LENGTH, formatUserCode, normalizeUserCode } from '@lukarn/shared';
import { type FormEvent, type ReactElement, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useApprovePairing, usePairingState } from '../api/hooks';
import { Spinner } from '../components/Spinner';
import { useT } from '../lib/i18n';

/**
 * Pairing as seen from the phone (D260809c). `RequireAuth` guards it: without a
 * session, `/login` comes first and returns here with the code.
 *
 * It does one thing explicitly: shows the code **as displayed by the screen**
 * and asks for confirmation. This comparison is the only possible check against
 * a QR code from a different screen.
 */
export default function PairPage(): ReactElement {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const code = normalizeUserCode(params.get('code') ?? '');

  const state = usePairingState(code);
  const approve = useApprovePairing();

  if (!code) return <CodeForm onSubmit={(value) => setParams({ code: value })} />;

  if (state.isPending) {
    return (
      <Card>
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      </Card>
    );
  }

  if (state.isError) {
    return (
      <Card>
        <Title>{t('pair.expiredTitle')}</Title>
        <p className="text-sm text-ink-400">{t('pair.expiredBody')}</p>
        <SecondaryButton onClick={() => setParams({})}>{t('pair.enterAnother')}</SecondaryButton>
      </Card>
    );
  }

  if (approve.isSuccess) {
    return (
      <Card>
        <Title>{t('pair.doneTitle')}</Title>
        <p className="text-sm text-ink-400">
          {t('pair.doneBody')} <span className="text-ink-200">{t('pair.doneAccount')}</span>.
        </p>
        <SecondaryButton onClick={() => void navigate('/')}>
          {t('pair.backToAlbums')}
        </SecondaryButton>
      </Card>
    );
  }

  // Approved by somebody else before arrival: this is not an error but a state
  // to announce — otherwise the button promises an action the server rejects with 409.
  if (state.data.approved) {
    return (
      <Card>
        <Title>{t('pair.alreadyTitle')}</Title>
        <p className="text-sm text-ink-400">{t('pair.alreadyBody')}</p>
        <SecondaryButton onClick={() => void navigate('/')}>
          {t('pair.backToAlbums')}
        </SecondaryButton>
      </Card>
    );
  }

  const message = approve.error instanceof ApiError ? approve.error.message : null;

  return (
    <Card>
      <Title>{t('pair.approveTitle')}</Title>
      <p className="text-sm text-ink-400">{t('pair.approveCheck')}</p>

      <p className="my-2 font-mono text-3xl tracking-widest text-ink-100">
        {formatUserCode(state.data.userCode)}
      </p>

      <p className="text-xs text-ink-400">{t('pair.approveWarning')}</p>

      {message && (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {message}
        </p>
      )}

      <button
        type="button"
        disabled={approve.isPending}
        onClick={() => approve.mutate(code)}
        className="w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t(approve.isPending ? 'pair.approving' : 'pair.approve')}
      </button>
      <SecondaryButton onClick={() => void navigate('/')}>{t('common.cancel')}</SecondaryButton>
    </Card>
  );
}

/** Code input for someone opening `/pair` without scanning the QR code. */
function CodeForm({ onSubmit }: { onSubmit: (code: string) => void }): ReactElement {
  const t = useT();
  const [value, setValue] = useState('');
  const code = normalizeUserCode(value);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (code.length === USER_CODE_LENGTH) onSubmit(code);
  };

  return (
    <Card>
      <Title>{t('pair.formTitle')}</Title>
      <p className="text-sm text-ink-400">{t('pair.formHint')}</p>
      <form onSubmit={submit} className="space-y-4">
        <input
          name="code"
          // Use `characters`, not `words`: the field is uppercase, and autocorrection
          // would replace a code with a known word.
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="ABCD-EFGH"
          className="w-full rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5 text-center font-mono text-xl tracking-widest uppercase outline-none transition-colors placeholder:text-ink-400 focus:border-accent-dim"
        />
        <button
          type="submit"
          disabled={code.length !== USER_CODE_LENGTH}
          className="w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('pair.continue')}
        </button>
      </form>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }): ReactElement {
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm space-y-4 text-center">{children}</div>
    </div>
  );
}

function Title({ children }: { children: React.ReactNode }): ReactElement {
  return <h1 className="text-xl font-semibold tracking-tight">{children}</h1>;
}

function SecondaryButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-sm text-ink-400 underline-offset-4 transition-colors hover:text-ink-200 hover:underline"
    >
      {children}
    </button>
  );
}
