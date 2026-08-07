import { useEffect, useState } from 'react';

/**
 * L'événement que Chrome émet quand l'application remplit les critères
 * d'installation. Absent des types du DOM, qui ne décrivent que le standard.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

/** L'application tourne-t-elle déjà hors du navigateur ? */
function estInstallee(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // Safari iOS n'implémente pas `display-mode` et expose ce drapeau à la place.
  return 'standalone' in navigator && navigator.standalone === true;
}

/**
 * iOS n'a pas d'API d'installation : rien ne se déclenche, rien ne se demande.
 * Le seul chemin est un geste manuel dans le menu de partage, et c'est
 * précisément parce qu'il ne se devine pas qu'il faut l'écrire.
 */
function estIOS(): boolean {
  const ua = navigator.userAgent;
  // Un iPad récent se présente comme un Mac ; l'écran tactile le trahit.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Ce que l'interface a besoin de savoir pour proposer l'installation. */
export interface InstallPrompt {
  /** Proposer l'installation mène-t-il quelque part ? Sinon, ne rien afficher. */
  disponible: boolean;
  /** Vrai sur iOS : aucune API, le seul chemin passe par un mode d'emploi. */
  manuel: boolean;
  /** Déclenche l'invite native du navigateur. Sans effet si `manuel`. */
  installer: () => void;
}

/**
 * L'état de l'installation, séparé de ce qui l'affiche.
 *
 * La proposition apparaît à deux endroits selon la largeur — un bouton dans la
 * barre, une ligne dans le menu — et un état dupliqué entre les deux finirait
 * par diverger : le bouton disparaîtrait après `appinstalled`, la ligne de menu
 * non.
 */
export function useInstallPrompt(): InstallPrompt {
  const [invite, setInvite] = useState<BeforeInstallPromptEvent | null>(null);
  const [installee, setInstallee] = useState(estInstallee);

  useEffect(() => {
    const onInvite = (event: Event): void => {
      // Sans ce `preventDefault`, Chrome affiche sa propre bannière et
      // l'événement n'est plus rejouable : le bouton n'aurait plus rien à
      // déclencher.
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
      // L'invite ne se rejoue pas : Chrome en émettra une neuve si
      // l'installation est refusée puis redevient possible.
      setInvite(null);
    },
  };
}
