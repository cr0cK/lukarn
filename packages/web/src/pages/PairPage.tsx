import { USER_CODE_LENGTH, formatUserCode, normalizeUserCode } from '@nonni/shared';
import { type FormEvent, type ReactElement, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useApprovePairing, usePairingState } from '../api/hooks';
import { Spinner } from '../components/Spinner';

/**
 * L'appairage vu du téléphone (D260809c). `RequireAuth` la garde : sans session, on
 * passe d'abord par `/login`, qui ramène ici avec le code.
 *
 * Elle ne fait qu'une chose, et le fait explicitement : montrer le code **tel
 * que l'écran l'affiche**, et demander une confirmation. Cette comparaison est
 * la seule vérification possible contre un QR qui ne serait pas celui qu'on
 * regarde.
 */
export default function PairPage(): ReactElement {
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
        <Title>That code is no longer valid</Title>
        <p className="text-sm text-ink-400">
          A request expires after five minutes. Start the sign-in again from the screen, then scanne
          le nouveau code.
        </p>
        <SecondaryButton onClick={() => setParams({})}>Enter another code</SecondaryButton>
      </Card>
    );
  }

  if (approve.isSuccess) {
    return (
      <Card>
        <Title>All set</Title>
        <p className="text-sm text-ink-400">
          The screen opens in a few seconds, with the albums of{' '}
          <span className="text-ink-200">ton compte</span>.
        </p>
        <SecondaryButton onClick={() => void navigate('/')}>Back to the albums</SecondaryButton>
      </Card>
    );
  }

  // Approuvée par quelqu'un d'autre avant qu'on n'arrive : ce n'est pas une
  // erreur, c'est un état à annoncer — sans quoi le bouton promettrait une
  // action que le serveur refusera par un 409.
  if (state.data.approved) {
    return (
      <Card>
        <Title>This screen has already been paired</Title>
        <p className="text-sm text-ink-400">
          An account has already approved this request. If that was not you, start the sign-in again
          from the screen to get a new code.
        </p>
        <SecondaryButton onClick={() => void navigate('/')}>Back to the albums</SecondaryButton>
      </Card>
    );
  }

  const message = approve.error instanceof ApiError ? approve.error.message : null;

  return (
    <Card>
      <Title>Approve this screen?</Title>
      <p className="text-sm text-ink-400">
        Check that this code is the one shown on the screen you want to pair.
      </p>

      <p className="my-2 font-mono text-3xl tracking-widest text-ink-100">
        {formatUserCode(state.data.userCode)}
      </p>

      <p className="text-xs text-ink-400">
        The screen will reach the same albums as you, for as long as nobody changes the password of
        ce compte. Il ne pourra pas signer de commentaire en ton nom.
      </p>

      {message && (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {message}
        </p>
      )}

      <button
        type="button"
        disabled={approve.isPending}
        onClick={() => approve.mutate(code)}
        className="w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {approve.isPending ? 'Approving…' : 'Approve'}
      </button>
      <SecondaryButton onClick={() => void navigate('/')}>Cancel</SecondaryButton>
    </Card>
  );
}

/** La saisie du code, pour qui ouvre `/pair` sans avoir scanné le QR. */
function CodeForm({ onSubmit }: { onSubmit: (code: string) => void }): ReactElement {
  const [value, setValue] = useState('');
  const code = normalizeUserCode(value);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (code.length === USER_CODE_LENGTH) onSubmit(code);
  };

  return (
    <Card>
      <Title>Pair a screen</Title>
      <p className="text-sm text-ink-400">Enter the code shown on the screen you want to pair.</p>
      <form onSubmit={submit} className="space-y-4">
        <input
          name="code"
          // `characters` et non `words` : le champ est en majuscules, et la
          // correction automatique remplacerait un code par un mot connu.
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
          className="w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continue
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
