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
        <Title>Ce code n'est plus valide</Title>
        <p className="text-sm text-ink-400">
          Une demande expire au bout de cinq minutes. Relance la connexion depuis l'écran, puis
          scanne le nouveau code.
        </p>
        <SecondaryButton onClick={() => setParams({})}>Saisir un autre code</SecondaryButton>
      </Card>
    );
  }

  if (approve.isSuccess) {
    return (
      <Card>
        <Title>C'est bon</Title>
        <p className="text-sm text-ink-400">
          L'écran s'ouvre dans quelques secondes, avec les albums de{' '}
          <span className="text-ink-200">ton compte</span>.
        </p>
        <SecondaryButton onClick={() => void navigate('/')}>Revenir aux albums</SecondaryButton>
      </Card>
    );
  }

  // Approuvée par quelqu'un d'autre avant qu'on n'arrive : ce n'est pas une
  // erreur, c'est un état à annoncer — sans quoi le bouton promettrait une
  // action que le serveur refusera par un 409.
  if (state.data.approved) {
    return (
      <Card>
        <Title>Cet écran a déjà été connecté</Title>
        <p className="text-sm text-ink-400">
          Un compte a déjà autorisé cette demande. S'il ne s'agit pas de toi, relance la connexion
          depuis l'écran pour obtenir un nouveau code.
        </p>
        <SecondaryButton onClick={() => void navigate('/')}>Revenir aux albums</SecondaryButton>
      </Card>
    );
  }

  const message = approve.error instanceof ApiError ? approve.error.message : null;

  return (
    <Card>
      <Title>Autoriser cet écran ?</Title>
      <p className="text-sm text-ink-400">
        Vérifie que ce code est bien celui affiché sur l'écran que tu veux connecter.
      </p>

      <p className="my-2 font-mono text-3xl tracking-widest text-ink-100">
        {formatUserCode(state.data.userCode)}
      </p>

      <p className="text-xs text-ink-400">
        L'écran aura accès aux mêmes albums que toi, tant que personne ne change le mot de passe de
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
        {approve.isPending ? 'Autorisation…' : 'Autoriser'}
      </button>
      <SecondaryButton onClick={() => void navigate('/')}>Annuler</SecondaryButton>
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
      <Title>Connecter un écran</Title>
      <p className="text-sm text-ink-400">Saisis le code affiché sur l'écran à connecter.</p>
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
          Continuer
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
