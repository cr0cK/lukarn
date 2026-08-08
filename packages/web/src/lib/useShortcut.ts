import { useEffect, useRef } from 'react';
import { isTyping } from './typing';

/**
 * Raccourci global à une touche. Ignoré pendant la saisie et lorsqu'un
 * modificateur est enfoncé, pour ne jamais recouvrir un raccourci navigateur.
 */
export function useShortcut(key: string, handler: () => void, enabled = true): void {
  // Le handler est lu au moment de l'événement : pas besoin de réattacher
  // l'écouteur à chaque rendu.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;
      if (event.key !== key) return;
      event.preventDefault();
      handlerRef.current();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [key, enabled]);
}
