/**
 * Emoji in comments.
 *
 * Two paths and one storage format. On mobile, people type actual emoji on the
 * keyboard: they pass through the API and SQLite unchanged, so no work is needed.
 * On a physical keyboard, people write ":)" — this module translates that shortcut.
 *
 * **Translation happens on display, never on write.** Stored content remains as
 * entered: substitution during `POST` would be irreversible, and the shortcut
 * list could not evolve without rewriting published comments. The cost is one
 * call per render on two-line texts.
 *
 * Output remains plain text — never markup or `dangerouslySetInnerHTML`: this
 * keeps React escaping as the sole safeguard instead of adding another to audit.
 */

/**
 * Recognised shortcuts. Deliberately short: every entry is a string that can no
 * longer be written literally in a comment.
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
 * Recognise a shortcut only in isolation: preceded by the start or whitespace,
 * followed by the end or a character that is neither a letter nor a number.
 *
 * Both boundaries are essential for different reasons. Without the left one,
 * `http://example.com` becomes `http😕/example.com`. Without the right one,
 * ":pizza" becomes "😛izza".
 *
 * The left boundary is a capturing group, not a `lookbehind`: Safari implemented
 * it only in 16.4, and a badly rendered comment on a five-year-old iPad is
 * exactly the failure that would never be seen here.
 *
 * Put longer shortcuts first in the alternation so `:-)` is not split by `:)`.
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
 * Replaces shortcuts in comment content with their emoji.
 *
 * Idempotent: applied twice, it returns the same text — an emoji is not a shortcut.
 */
export function emojify(text: string): string {
  return text.replace(PATTERN, (match, before: string, token: string) => {
    const emoji = REPLACEMENTS.get(token);
    return emoji === undefined ? match : `${before}${emoji}`;
  });
}

/**
 * Picker palette.
 *
 * Thirty-two entries, not three thousand: this is not a replacement keyboard but
 * a shortcut for what people write beneath a family photo. A complete palette
 * would require search, an index and a dependency — for a panel holding one sentence.
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

/** Text and cursor position after insertion. */
export interface Insertion {
  value: string;
  caret: number;
}

/**
 * Inserts an emoji in place of the current input selection.
 *
 * The cursor returns **after** the inserted emoji: otherwise it would remain at
 * the field start after each palette click and place the second emoji before the first.
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
