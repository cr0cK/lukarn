import { useEffect, useRef } from 'react';
import { isTyping } from './typing';

/**
 * One-key global shortcut. Ignored while typing and when a modifier is pressed,
 * so it never overrides a browser shortcut.
 */
export function useShortcut(key: string, handler: () => void, enabled = true): void {
  // Read the handler at event time, avoiding listener reattachment on every render.
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
