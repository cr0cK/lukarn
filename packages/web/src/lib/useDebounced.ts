import { useEffect, useState } from 'react';

/**
 * Retard d'une valeur qui change au rythme de la frappe.
 *
 * Cent cinquante millisecondes : au-delà, la liste paraît traîner derrière les
 * doigts ; en deçà, « Marseille » part en neuf requêtes dont huit sont périmées
 * avant d'arriver. Sans ce délai, c'est chaque caractère qui interroge la base.
 */
export function useDebounced<T>(value: T, delayMs = 150): T {
  const [retarded, setRetarded] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setRetarded(value), delayMs);
    // Nettoyage à chaque frappe : c'est lui qui fait le retard, la minuterie
    // repartant de zéro tant que la valeur bouge.
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return retarded;
}
