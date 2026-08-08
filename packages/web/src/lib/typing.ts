/**
 * Un champ de saisie a le focus : aucun raccourci global ne doit partir.
 *
 * Le test vit ici parce que les trois gestionnaires de clavier — `useShortcut`,
 * la grille et la visionneuse — en avaient chacun leur copie, et qu'une seule
 * suffisait à diverger. C'est arrivé : celle de la grille ne connaissait que
 * `INPUT`, si bien que les flèches, `Début` et `Fin` déplaçaient la sélection
 * au lieu du curseur dès qu'on écrivait dans un `textarea` — la description
 * d'un album, la note d'une journée. Le texte devenait inéditable au clavier.
 */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
