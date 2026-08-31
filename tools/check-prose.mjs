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
 * Code blocks and inline code are exempt: the point is prose, and a document
 * has to be able to quote the phrases it forbids.
 *
 *   node tools/check-prose.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * The documents this check reads, and the em dashes each may still carry.
 *
 * `specs/` is deliberately absent: it is read by whoever takes over the code,
 * not by whoever discovers the project, and twenty thousand lines of it would
 * make this a rewrite rather than a check.
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
function withoutVersionTitles(source) {
  return source.replace(/^## \[.*$/gm, '');
}

/**
 * The changelog section still being written.
 *
 * `## [Unreleased]` by name, the way `check-changelog.mjs` finds it, rather
 * than "whatever sits at the top": between a release and the next feature the
 * topmost section is the one that has just shipped, and holding it to this
 * check would demand edits to notes a GitHub release page already carries.
 * With no unreleased section there is nothing here to judge.
 */
function draftSection(source) {
  const start = source.search(/^## \[?unreleased\]?/im);
  if (start < 0) return '';
  const next = source.slice(start).search(/\n## /);
  return next < 0 ? source.slice(start) : source.slice(start, start + next);
}

/**
 * Constructions with a plain equivalent, and the equivalent.
 *
 * Each one is a habit rather than a mistake, which is why the message names the
 * replacement: a check that only says "no" teaches nothing the second time.
 *
 * The patterns must not overlap. `not just` and `it's not just` would both
 * match the same words and report one lapse twice, so the longer form keeps
 * only the alternative the shorter ones do not already cover.
 */
const TURNS = [
  {
    pattern: /\band nothing (?:else|more)\b/gi,
    advice: 'say what it does ask for, or drop the clause',
  },
  { pattern: /\bnot just\b/gi, advice: 'state the thing itself' },
  { pattern: /\bnot only\b(?![^.]{0,30}\bbut\b)/gi, advice: 'state the thing itself' },
  { pattern: /\bit'?s not merely\b/gi, advice: 'state the thing itself' },
  { pattern: /\bis not (?:a|an|the)\b[^.]{0,40}\bit is\b/gi, advice: 'say what it is' },
  { pattern: /,\s*never (?:a|an|the)\s/gi, advice: 'use "rather than", or a sentence of its own' },
  { pattern: /\bat its core\b/gi, advice: 'delete it' },
  { pattern: /\bthe real question is\b/gi, advice: 'ask the question' },
  { pattern: /\bwhat really matters\b/gi, advice: 'say what matters' },
  { pattern: /\bit is worth noting that\b/gi, advice: 'note it' },
  {
    pattern: /\blet'?s (?:dive|explore|break)\b/gi,
    advice: 'do the thing instead of announcing it',
  },
];

/** Fenced blocks and inline code, which are quoted rather than written. */
function withoutCode(source) {
  return source.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

/** Line breaks hide a phrase from a search; prose is read as one string. */
function flattened(source) {
  return source.replace(/\s+/g, ' ');
}

const failures = [];

for (const [file, budget] of Object.entries(BUDGETS)) {
  const raw = readFileSync(join(ROOT, file), 'utf8');
  const source = withoutCode(
    file === 'CHANGELOG.md' ? withoutVersionTitles(draftSection(raw)) : raw,
  );

  const dashes = (source.match(/—/g) ?? []).length;
  if (dashes > budget) {
    failures.push(
      `${file}: ${dashes} em dashes for a budget of ${budget}. ` +
        'A comma, a colon or a full stop carries almost all of them.',
    );
  }

  const prose = flattened(source);
  for (const { pattern, advice } of TURNS) {
    for (const found of prose.matchAll(pattern)) {
      const excerpt = prose.slice(Math.max(0, found.index - 40), found.index + 60).trim();
      failures.push(`${file}: "${found[0]}" (${advice})\n      …${excerpt}…`);
    }
  }
}

if (failures.length === 0) {
  console.log(`prose: ${Object.keys(BUDGETS).length} public documents read as written`);
  process.exit(0);
}

console.error(`\nThe register of a public document has drifted — ${failures.length} issue(s):\n`);
for (const failure of failures) console.error(`  · ${failure}`);
console.error(
  '\nThese documents address a stranger, and the tone rule is in AGENTS.md' +
    '\nand CONTRIBUTING.md. Raising a budget is a decision, not a fix.\n',
);
process.exit(1);
