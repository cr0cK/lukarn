import { type DevicePairingStart, formatUserCode } from '@gdv/shared';
import { type ReactElement, useMemo } from 'react';
import { ApiError } from '../api/client';
import { usePairingPoll } from '../api/hooks';
import { qrCode } from '../lib/qr';
import { Spinner } from './Spinner';

/** Marge blanche autour du QR, en modules. En deçà de quatre, il ne se lit plus. */
const QUIET_ZONE = 4;

interface DeviceLoginProps {
  /** La demande ouverte, `null` tant qu'elle n'est pas arrivée. */
  pairing: DevicePairingStart | null;
  /** Échec de l'ouverture, s'il y en a un — l'instance en refuse de nouvelles. */
  error: unknown;
  /** Rouvre une demande : le code a expiré, ou l'ouverture avait échoué. */
  onRetry: () => void;
  /** Retour au formulaire. */
  onCancel: () => void;
}

/**
 * L'appairage vu de l'écran sans clavier (D260809c).
 *
 * Il affiche le QR et le code, puis sonde le serveur jusqu'à ce qu'un téléphone
 * déjà connecté approuve. La session arrivée est écrite dans le cache par
 * `usePairingPoll` : `LoginPage` la voit par `useMe()` et navigue, ce composant
 * n'a personne à prévenir.
 *
 * **L'ouverture de la demande appartient au parent, et ne peut pas venir d'ici.**
 * Une mutation lancée depuis un effet de montage se perd sous `StrictMode` : le
 * démontage simulé détache l'observateur de la mutation en cours, et
 * `MutationObserver` ne le rattache pas au remontage — la requête aboutit, son
 * résultat n'atteint plus personne, et l'écran tourne indéfiniment. Elle part
 * donc du clic, qui est de toute façon l'événement qui la justifie.
 */
export function DeviceLogin({ pairing, error, onRetry, onCancel }: DeviceLoginProps): ReactElement {
  const url = useMemo(
    () => (pairing ? `${window.location.origin}/pair?code=${pairing.userCode}` : null),
    [pairing],
  );
  const qr = useMemo(() => (url ? qrCode(url) : null), [url]);

  const poll = usePairingPoll(pairing?.deviceCode ?? null, pairing?.intervalMs ?? 2000);

  // Le serveur ne garde une demande que cinq minutes : c'est son 404 qui dit
  // qu'elle est morte, plutôt qu'un compte à rebours tenu de ce côté-ci qui
  // pourrait diverger du sien.
  const expired = poll.error instanceof ApiError && poll.error.status === 404;
  const message = error instanceof ApiError ? error.message : null;

  return (
    <div className="space-y-5 text-center">
      <div>
        <h2 className="text-sm font-medium text-ink-100">Connecter avec un téléphone</h2>
        <p className="mt-1 text-sm text-ink-400">
          Scanne ce code avec un téléphone déjà connecté, puis autorise cet écran.
        </p>
      </div>

      {!pairing && !message && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}

      {message && (
        <div className="space-y-3">
          <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {message}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90"
          >
            Réessayer
          </button>
        </div>
      )}

      {pairing && qr && url && (
        <>
          <div className="flex justify-center">
            <svg
              viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${qr.size + QUIET_ZONE * 2} ${qr.size + QUIET_ZONE * 2}`}
              className="size-56 rounded-lg"
              role="img"
              aria-label={`QR code vers ${url}`}
            >
              {/* Contrastes fixes, indépendants du thème : un lecteur de QR ne
                  déchiffre qu'un dessin sombre sur fond clair. */}
              <rect
                x={-QUIET_ZONE}
                y={-QUIET_ZONE}
                width={qr.size + QUIET_ZONE * 2}
                height={qr.size + QUIET_ZONE * 2}
                fill="#ffffff"
              />
              {/* shapeRendering : sans lui, l'antialiasing brouille la
                  frontière des modules une fois le tracé agrandi. */}
              <path d={qr.path} fill="#000000" shapeRendering="crispEdges" />
            </svg>
          </div>

          <div>
            <p className="text-xs text-ink-400">
              Ou va sur <span className="text-ink-300">{window.location.host}/pair</span> et saisis
            </p>
            {/* Le code est affiché en clair, et c'est nécessaire : il sert
                autant à entrer l'appairage sans caméra qu'à vérifier, sur le
                téléphone, qu'on autorise bien l'écran qu'on regarde. */}
            <p className="mt-1 font-mono text-3xl tracking-widest text-ink-100">
              {formatUserCode(pairing.userCode)}
            </p>
          </div>

          {expired ? (
            <div className="space-y-3">
              <p role="alert" className="text-sm text-amber-300">
                Ce code a expiré.
              </p>
              <button
                type="button"
                onClick={onRetry}
                className="w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90"
              >
                Afficher un nouveau code
              </button>
            </div>
          ) : (
            <p className="text-sm text-ink-400" aria-live="polite">
              En attente de l'autorisation…
            </p>
          )}
        </>
      )}

      <button
        type="button"
        onClick={onCancel}
        className="text-sm text-ink-400 underline-offset-4 transition-colors hover:text-ink-200 hover:underline"
      >
        Utiliser un identifiant et un mot de passe
      </button>
    </div>
  );
}
