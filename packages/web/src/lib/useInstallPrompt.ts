import { useEffect, useState } from 'react';

/**
 * Event Chrome emits when the application meets installation criteria. Absent
 * from DOM types, which describe only the standard.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

/** Whether the application already runs outside the browser. */
function estInstallee(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS Safari does not implement `display-mode` and exposes this flag instead.
  return 'standalone' in navigator && navigator.standalone === true;
}

/**
 * iOS has no installation API: nothing triggers or prompts. The only path is a
 * manual action in the share menu, and its invisibility is precisely why it must
 * be explained.
 */
function estIOS(): boolean {
  const ua = navigator.userAgent;
  // A recent iPad presents itself as a Mac; its touchscreen reveals it.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** What the interface needs to offer installation. */
export interface InstallPrompt {
  /** Whether offering installation leads anywhere. Otherwise show nothing. */
  disponible: boolean;
  /** True on iOS: no API, so instructions are the only path. */
  manuel: boolean;
  /** Triggers the browser's native prompt. No effect when `manuel`. */
  installer: () => void;
}

/**
 * Installation state, separate from its presentation.
 *
 * The offer appears in two places depending on width — a bar button and a menu
 * row — and duplicated state would eventually diverge: the button might
 * disappear after `appinstalled` while the menu row remained.
 */
export function useInstallPrompt(): InstallPrompt {
  const [invite, setInvite] = useState<BeforeInstallPromptEvent | null>(null);
  const [installee, setInstallee] = useState(estInstallee);

  useEffect(() => {
    const onInvite = (event: Event): void => {
      // Without `preventDefault`, Chrome shows its own banner and the event cannot
      // be replayed: the button would have nothing left to trigger.
      event.preventDefault();
      setInvite(event as BeforeInstallPromptEvent);
    };
    const onInstallee = (): void => {
      setInstallee(true);
      setInvite(null);
    };

    window.addEventListener('beforeinstallprompt', onInvite);
    window.addEventListener('appinstalled', onInstallee);
    return () => {
      window.removeEventListener('beforeinstallprompt', onInvite);
      window.removeEventListener('appinstalled', onInstallee);
    };
  }, []);

  const manuel = !invite && estIOS();

  return {
    disponible: !installee && (Boolean(invite) || manuel),
    manuel,
    installer: () => {
      if (!invite) return;
      void invite.prompt();
      // The prompt cannot be replayed: Chrome emits a new one if installation is
      // declined and later becomes available again.
      setInvite(null);
    },
  };
}
