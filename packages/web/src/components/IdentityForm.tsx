import { VERIFICATION_CODE_LENGTH } from '@nonni/shared';
import { type FormEvent, type ReactElement, useState } from 'react';
import { errorText } from '../api/client';
import { useRequestIdentityCode, useVerifyIdentity } from '../api/hooks';

/**
 * Déclaration et vérification de l'identité de commentateur.
 *
 * L'identifiant et le mot de passe ouvrent des albums et peuvent être partagés
 * par tout un foyer ; ils ne disent donc pas qui écrit. C'est ce formulaire qui
 * l'établit : un nom, une adresse, et un code reçu par email pour prouver que
 * l'adresse est bien la sienne. Sans cette preuve, n'importe qui derrière la
 * clé partagée pourrait signer du nom d'un autre.
 *
 * Deux étapes dans un seul composant : l'adresse saisie à la première reste
 * affichée à la seconde, ce qui permet de voir sa faute de frappe sans repartir
 * de zéro.
 */
export function IdentityForm({ onDone }: { onDone?: () => void }): ReactElement {
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
          Un code à {VERIFICATION_CODE_LENGTH} chiffres vient d’être envoyé à{' '}
          <span className="text-ink-100">{email}</span>.
        </p>

        <input
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={VERIFICATION_CODE_LENGTH}
          placeholder="123456"
          aria-label="Code de vérification"
          className="w-full rounded border border-ink-700 bg-ink-900 px-3 py-2 text-center font-mono text-lg tracking-[0.3em] text-ink-100 placeholder:text-ink-400 focus:border-accent focus:outline-none"
        />

        {verify.isError && (
          <p className="text-xs text-red-400">
            {errorText(verify.error, 'Le code n’a pas pu être vérifié.')}
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
            Corriger l’adresse
          </button>
          <button
            type="submit"
            disabled={code.length !== VERIFICATION_CODE_LENGTH || verify.isPending}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {verify.isPending ? 'Vérification…' : 'Valider'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submitDeclare} className="space-y-3">
      {/* C'est le seul moment où quelqu'un décide de donner son adresse : tout
          ce qu'on en fera doit être dit ici, y compris l'abonnement automatique
          aux nouveautés des albums ouverts. Un abonnement par défaut se défend
          dans un cercle privé à condition d'être annoncé et défait en un clic —
          pas s'il se découvre à la réception du premier email. */}
      <p className="text-sm text-ink-300">
        Pour commenter, dis-nous qui tu es. Ton adresse sert à signer tes messages, à te prévenir
        des réponses, et à t’annoncer les nouvelles photos des albums que tu ouvres ; elle n’est
        jamais montrée aux autres. Chaque email reçu porte un lien pour s’en désabonner.
      </p>

      <input
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        maxLength={64}
        placeholder="Ton nom, tel qu’il s’affichera"
        aria-label="Nom affiché"
        className="w-full rounded border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-400 focus:border-accent focus:outline-none"
      />

      <input
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        type="email"
        autoComplete="email"
        placeholder="ton@adresse.fr"
        aria-label="Adresse email"
        className="w-full rounded border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-400 focus:border-accent focus:outline-none"
      />

      {requestCode.isError && (
        <p className="text-xs text-red-400">
          {errorText(requestCode.error, 'Le code n’a pas pu être envoyé.')}
        </p>
      )}

      <button
        type="submit"
        disabled={!email.trim() || !displayName.trim() || requestCode.isPending}
        className="w-full rounded bg-accent px-3 py-2 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {requestCode.isPending ? 'Envoi…' : 'Recevoir un code'}
      </button>
    </form>
  );
}
