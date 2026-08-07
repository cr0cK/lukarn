/**
 * Emoji dans les commentaires.
 *
 * Deux chemins, et un seul stockage. Sur mobile, les gens tapent de vrais
 * caractères emoji au clavier : ils traversent l'API et SQLite sans traitement,
 * il n'y a rien à faire pour eux. Sur un clavier physique, on écrit « :) » —
 * c'est ce raccourci que ce module traduit.
 *
 * **La traduction se fait à l'affichage, jamais à l'écriture.** Le corps stocké
 * reste celui qui a été saisi : une substitution faite au moment du `POST`
 * serait irréversible, et la liste des raccourcis ne peut pas évoluer sans
 * réécrire les commentaires déjà publiés. Le prix est un appel par rendu, sur
 * des textes de deux lignes.
 *
 * La sortie reste du texte pur — jamais de balise, jamais de `dangerouslySetInnerHTML` :
 * c'est ce qui garde l'échappement de React comme unique rempart, au lieu d'en
 * ajouter un second qu'il faudrait vérifier.
 */

/**
 * Raccourcis reconnus. Volontairement court : chaque entrée est une chaîne
 * qu'on ne pourra plus jamais écrire littéralement dans un commentaire.
 */
const EMOTICONS: ReadonlyArray<readonly [string, string]> = [
  [':-)', '🙂'],
  [':)', '🙂'],
  ['=)', '🙂'],
  [':-D', '😄'],
  [':D', '😄'],
  ['xD', '😆'],
  ['XD', '😆'],
  [';-)', '😉'],
  [';)', '😉'],
  [':-(', '🙁'],
  [':(', '🙁'],
  [":'(", '😢'],
  [':-P', '😛'],
  [':-p', '😛'],
  [':P', '😛'],
  [':p', '😛'],
  [':-o', '😮'],
  [':-O', '😮'],
  [':o', '😮'],
  [':O', '😮'],
  [':-/', '😕'],
  [':/', '😕'],
  [':|', '😐'],
  [':-*', '😘'],
  [':*', '😘'],
  ['>:(', '😠'],
  ['^^', '😊'],
  ['<3', '❤️'],
  ['</3', '💔'],
];

function escapeForRegExp(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Un raccourci n'est reconnu qu'isolé : précédé du début du texte ou d'un blanc,
 * suivi de la fin ou d'un caractère qui n'est ni lettre ni chiffre.
 *
 * Les deux bornes sont indispensables, et pour des raisons différentes. Sans
 * celle de gauche, `http://exemple.fr` deviendrait `http😕/exemple.fr`. Sans
 * celle de droite, « :pizza » deviendrait « 😛izza ».
 *
 * La borne gauche est un groupe capturant et non un `lookbehind` : Safari ne
 * l'a implémenté qu'en 16.4, et un commentaire mal rendu sur un iPad d'il y a
 * cinq ans est exactement le genre de panne qu'on ne verrait jamais d'ici.
 *
 * Les raccourcis les plus longs passent en premier dans l'alternance, pour que
 * `:-)` ne soit pas coupé par `:)`.
 */
const PATTERN = new RegExp(
  `(^|\\s)(${[...EMOTICONS]
    .sort((a, b) => b[0].length - a[0].length)
    .map(([token]) => escapeForRegExp(token))
    .join('|')})(?=$|[^\\p{L}\\p{N}])`,
  'gu',
);

const REPLACEMENTS = new Map(EMOTICONS);

/**
 * Remplace les raccourcis d'un corps de commentaire par leur emoji.
 *
 * Idempotente : appliquée deux fois, elle rend le même texte — un emoji n'est
 * pas un raccourci.
 */
export function emojify(text: string): string {
  return text.replace(PATTERN, (match, before: string, token: string) => {
    const emoji = REPLACEMENTS.get(token);
    return emoji === undefined ? match : `${before}${emoji}`;
  });
}

/**
 * Palette du sélecteur.
 *
 * Trente-deux entrées, pas trois mille : ce n'est pas un clavier de rechange
 * mais un raccourci pour ce qu'on écrit sous une photo de famille. Une palette
 * exhaustive demanderait une recherche, donc un index, donc une dépendance —
 * pour un panneau où l'on tape une phrase.
 */
export const PICKER_EMOJI: readonly string[] = [
  '😀',
  '😄',
  '😁',
  '🙂',
  '😉',
  '😍',
  '🥰',
  '😘',
  '🤩',
  '😎',
  '🤗',
  '😢',
  '😭',
  '😱',
  '🤣',
  '😂',
  '👍',
  '👏',
  '🙌',
  '🙏',
  '💪',
  '❤️',
  '🔥',
  '✨',
  '🎉',
  '🥳',
  '😻',
  '🐶',
  '🌞',
  '🌈',
  '📸',
  '🍾',
];

/** Texte et position du curseur après insertion. */
export interface Insertion {
  value: string;
  caret: number;
}

/**
 * Insère un emoji à la place de la sélection courante d'un champ de saisie.
 *
 * Le curseur revient **après** l'emoji inséré : sans ça, il resterait au début
 * du champ à chaque clic dans la palette, et le second emoji se placerait avant
 * le premier.
 */
export function insertEmoji(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  emoji: string,
): Insertion {
  const start = Math.max(0, Math.min(selectionStart, text.length));
  const end = Math.max(start, Math.min(selectionEnd, text.length));
  return {
    value: `${text.slice(0, start)}${emoji}${text.slice(end)}`,
    caret: start + emoji.length,
  };
}
