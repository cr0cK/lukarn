import { type DevicePairingStart, formatUserCode } from '@nonni/shared';
import { type ReactElement, useMemo } from 'react';
import { ApiError } from '../api/client';
import { usePairingPoll } from '../api/hooks';
import { qrCode } from '../lib/qr';
import { Spinner } from './Spinner';

/** White margin around the QR code, in modules. Below four, it becomes unreadable. */
const QUIET_ZONE = 4;

interface DeviceLoginProps {
  /** The open request, `null` until it arrives. */
  pairing: DevicePairingStart | null;
  /** Opening failure, if any — the instance refuses new requests. */
  error: unknown;
  /** Opens another request: the code expired or opening failed. */
  onRetry: () => void;
  /** Returns to the form. */
  onCancel: () => void;
}

/**
 * Pairing as seen from the screen without a keyboard (D260809c).
 *
 * It displays the QR code and code, then polls the server until an already
 * signed-in phone approves. `usePairingPoll` writes the arriving session to the
 * cache: `LoginPage` sees it through `useMe()` and navigates, so this component
 * has nobody to notify.
 *
 * **Opening the request belongs to the parent and cannot happen here.** A
 * mutation started from a mount effect is lost under `StrictMode`: the simulated
 * unmount detaches the observer from the running mutation, and `MutationObserver`
 * does not reattach it on remount — the request succeeds, its result reaches
 * nobody, and the screen spins indefinitely. It therefore starts on the click,
 * which is the event that justifies it anyway.
 */
export function DeviceLogin({ pairing, error, onRetry, onCancel }: DeviceLoginProps): ReactElement {
  const url = useMemo(
    () => (pairing ? `${window.location.origin}/pair?code=${pairing.userCode}` : null),
    [pairing],
  );
  const qr = useMemo(() => (url ? qrCode(url) : null), [url]);

  const poll = usePairingPoll(pairing?.deviceCode ?? null, pairing?.intervalMs ?? 2000);

  // The server keeps a request for only five minutes: its 404 says when the
  // request is dead, avoiding a client-side countdown that could drift from it.
  const expired = poll.error instanceof ApiError && poll.error.status === 404;
  const message = error instanceof ApiError ? error.message : null;

  return (
    <div className="space-y-5 text-center">
      <div>
        <h2 className="text-sm font-medium text-ink-100">Sign in with a phone</h2>
        <p className="mt-1 text-sm text-ink-400">
          Scan this code with a phone that is already signed in, then approve this screen.
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
            Try again
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
              aria-label={`QR code to ${url}`}
            >
              {/* Fixed contrast, independent of the theme: a QR reader decodes
                  only a dark pattern on a light background. */}
              <rect
                x={-QUIET_ZONE}
                y={-QUIET_ZONE}
                width={qr.size + QUIET_ZONE * 2}
                height={qr.size + QUIET_ZONE * 2}
                fill="#ffffff"
              />
              {/* shapeRendering: without it, antialiasing blurs module edges
                  once the path is enlarged. */}
              <path d={qr.path} fill="#000000" shapeRendering="crispEdges" />
            </svg>
          </div>

          <div>
            <p className="text-xs text-ink-400">
              Or go to <span className="text-ink-300">{window.location.host}/pair</span> and enter
            </p>
            {/* The code is shown in clear text because it is used both to pair
                without a camera and to verify on the phone that the visible
                screen is the one being authorised. */}
            <p className="mt-1 font-mono text-3xl tracking-widest text-ink-100">
              {formatUserCode(pairing.userCode)}
            </p>
          </div>

          {expired ? (
            <div className="space-y-3">
              <p role="alert" className="text-sm text-amber-300">
                This code has expired.
              </p>
              <button
                type="button"
                onClick={onRetry}
                className="w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90"
              >
                Show a new code
              </button>
            </div>
          ) : (
            <p className="text-sm text-ink-400" aria-live="polite">
              Waiting for authorisation…
            </p>
          )}
        </>
      )}

      <button
        type="button"
        onClick={onCancel}
        className="text-sm text-ink-400 underline-offset-4 transition-colors hover:text-ink-200 hover:underline"
      >
        Use a username and password
      </button>
    </div>
  );
}
