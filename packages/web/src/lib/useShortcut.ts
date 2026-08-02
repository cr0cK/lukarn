import { useEffect, useRef } from 'react';

/** Un champ de saisie a le focus : les raccourcis à une touche doivent se taire. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

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
