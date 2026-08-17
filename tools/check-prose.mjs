#!/usr/bin/env node
/**
 * Checks the register of the documents a stranger reads.
 *
 * `check-specs.mjs` keeps the documentation honest and `check-changelog.mjs`
 * keeps it fed. This one keeps it sounding like a person wrote it. The five
 * files below are the front door of the project, and they had drifted into a
 * recognisable machine register: an em dash every seven lines, a sentence
 * qualified by "and nothing else", a claim built as "not X, but Y". None of it
 * is wrong, and all of it reads as generated.
 *
 * **A budget, not a ban.** An em dash is a legitimate mark, and a check that
 * refused every one of them would be argued with rather than obeyed. What is
 * being caught is density: past roughly one per hundred lines the punctuation
 * stops being a choice and becomes a tic. The phrase list is different, since
 * those constructions have a plain equivalent every time.
 *
 * Code blocks and tables of shell commands are exempt: the point is prose.
 *
 *   node tools/check-prose.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('..', import.meta.url));

/**
 * The documents this check reads, and the em dashes each may still carry.
 *
 * `specs/` is deliberately absent: it is read by whoever takes over the code,
 * not by whoever discovers the project, and twenty thousand lines of it would
 * make this a rewrite rather than a check.
 *
 * `CHANGELOG.md` is read down to its second version heading and no further. The
 * section of a version that has shipped is the body of a GitHub release that
 * already exists, and editing it here would make the file disagree with the page
 * people were sent to. Only the notes still being written are held to this.
 */
const BUDGETS = {
  'README.md': 2,
  'CHANGELOG.md': 0,
  'CONTRIBUTING.md': 5,
  'SECURITY.md': 1,
  'deploy/README.md': 4,
};

/**
 * The version headings, whose `## [1.2.0] — 2026-08-17` is a date separator
 * rather than a sentence, and has been the file's format since 1.0.0.
 */
function sansTitresDeVersion(source) {
  return source.replace(/^## \[.*$/gm, '');
}

/** The preamble and the newest section: everything above the second `## [`. */
function sectionEnCours(source) {
  const versions = [...source.matchAll(/^## \[/gm)];
  return versions.length < 2 ? source : source.slice(0, versions[1].index);
}

/**
 * Constructions with a plain equivalent, and the equivalent.
 *
 * Each one is a habit rather than a mistake, which is why the message names the
 * replacement: a check that only says "no" teaches nothing the second time.
 */
const TOURNURES = [
  {
    motif: /\band nothing (?:else|more)\b/gi,
    conseil: 'say what it does ask for, or drop the clause',
  },
  { motif: /\bnot just\b/gi, conseil: 'state the thing itself' },
  { motif: /\bnot only\b(?![^.]{0,30}\bbut\b)/gi, conseil: 'state the thing itself' },
  { motif: /\bit'?s not (?:just|merely|only)\b/gi, conseil: 'state the thing itself' },
  { motif: /\bis not (?:a|an|the)\b[^.]{0,40}\bit is\b/gi, conseil: 'say what it is' },
  { motif: /,\s*never (?:a|an|the)\s/gi, conseil: 'use "rather than", or a sentence of its own' },
  { motif: /\bat its core\b/gi, conseil: 'delete it' },
  { motif: /\bthe real question is\b/gi, conseil: 'ask the question' },
  { motif: /\bwhat really matters\b/gi, conseil: 'say what matters' },
  { motif: /\bit is worth noting that\b/gi, conseil: 'note it' },
  {
    motif: /\blet'?s (?:dive|explore|break)\b/gi,
    conseil: 'do the thing instead of announcing it',
  },
];

/** Fenced blocks and inline code, which are quoted rather than written. */
function sansCode(source) {
  return source.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

/** Line breaks hide a phrase from a search; prose is read as one string. */
function aplati(source) {
  return source.replace(/\s+/g, ' ');
}

const manques = [];

for (const [fichier, budget] of Object.entries(BUDGETS)) {
  const brut = readFileSync(join(RACINE, fichier), 'utf8');
  const source = sansCode(
    fichier === 'CHANGELOG.md' ? sansTitresDeVersion(sectionEnCours(brut)) : brut,
  );

  const cadratins = (source.match(/—/g) ?? []).length;
  if (cadratins > budget) {
    manques.push(
      `${fichier}: ${cadratins} em dashes for a budget of ${budget}. ` +
        'A comma, a colon or a full stop carries almost all of them.',
    );
  }

  const plat = aplati(source);
  for (const { motif, conseil } of TOURNURES) {
    for (const trouve of plat.matchAll(motif)) {
      const extrait = plat.slice(Math.max(0, trouve.index - 40), trouve.index + 60).trim();
      manques.push(`${fichier}: "${trouve[0]}" (${conseil})\n      …${extrait}…`);
    }
  }
}

if (manques.length === 0) {
  console.log(`prose: ${Object.keys(BUDGETS).length} public documents read as written`);
  process.exit(0);
}

console.error(`\nThe register of a public document has drifted — ${manques.length} issue(s):\n`);
for (const manque of manques) console.error(`  · ${manque}`);
console.error(
  '\nThese documents address a stranger, and the tone rule is in CLAUDE.md' +
    '\nand CONTRIBUTING.md. Raising a budget is a decision, not a fix.\n',
);
process.exit(1);
