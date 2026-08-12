import { useEffect, useState } from 'react';

/**
 * Delays a value changing at typing speed.
 *
 * One hundred and fifty milliseconds: above that, the list seems to trail the
 * fingers; below it, "Marseille" causes nine requests, eight stale before arrival.
 * Without this delay every character queries the database.
 */
export function useDebounced<T>(value: T, delayMs = 150): T {
  const [retarded, setRetarded] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setRetarded(value), delayMs);
    // Cleanup on every keystroke creates the delay by restarting the timer while
    // the value keeps changing.
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return retarded;
}
