#!/usr/bin/env node
/**
 * Checks that internal documentation links lead somewhere.
 *
 * The documentation is spread across three places that refer to one another
 * (D64): `README.md`, `deploy/README.md` and `specs/`. Nothing flags a reference
 * that has become invalid — moving a section or renaming a file silently breaks
 * a link, and nobody notices until they click it. This check resolves every
 * relative link and anchor, and fails on the first one that leads nowhere.
 *
 * External links are **not** followed: that would require network access, and a
 * check that fails because a third-party site is slow eventually gets disabled.
 *
 *   node tools/check-links.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('..', import.meta.url));

/**
 * Directories with no documentation to check, or which do not belong to the
 * repository.
 */
const IGNORES = new Set(['node_modules', 'dist', '.git', '.claude', 'data', 'cache']);

function fichiersMarkdown(repertoire, acc = []) {
  for (const entree of readdirSync(repertoire)) {
    if (IGNORES.has(entree)) continue;
    const chemin = join(repertoire, entree);
    if (statSync(chemin).isDirectory()) fichiersMarkdown(chemin, acc);
    else if (entree.endsWith('.md')) acc.push(chemin);
  }
  return acc;
}

/**
 * Removes code blocks before searching them for links.
 *
 * `deploy/README.md` contains shell commands between backticks where brackets
 * and parentheses follow one another; mistaking them for links would cause
 * failures on paths that were never meant to be links.
 */
function sansBlocsDeCode(source) {
  return source.replace(/^```[\s\S]*?^```/gm, '');
}

/**
 * Reproduces how GitHub builds a heading anchor: lowercase, punctuation removed,
 * spaces replaced with hyphens. Existing hyphens are preserved, which explains
 * the double hyphen for a heading containing an em dash between two spaces.
 */
function ancre(titre) {
  return titre
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function ancresDe(chemin) {
  const source = sansBlocsDeCode(readFileSync(chemin, 'utf8'));
  return new Set([...source.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => ancre(m[1])));
}

const ancresParFichier = new Map();
function ancresEnCache(chemin) {
  if (!ancresParFichier.has(chemin)) ancresParFichier.set(chemin, ancresDe(chemin));
  return ancresParFichier.get(chemin);
}

const casses = [];
let verifies = 0;

for (const fichier of fichiersMarkdown(RACINE)) {
  const source = sansBlocsDeCode(readFileSync(fichier, 'utf8'));
  const repertoire = dirname(fichier);
  const ici = relative(RACINE, fichier);

  for (const [, texte, cible] of source.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)) {
    // Protocols and anchors for pages served elsewhere are beyond the scope of
    // an offline check.
    if (/^[a-z][a-z0-9+.-]*:/i.test(cible)) continue;

    const [chemin, fragment] = cible.split('#');
    verifies += 1;

    let destination = fichier;
    if (chemin) {
      destination = resolve(repertoire, chemin);
      if (!existsSync(destination)) {
        casses.push(`${ici} → "${cible}" (in "${texte}"): file not found`);
        continue;
      }
    }

    // An anchor can only be checked in markdown: elsewhere, the fragment is
    // interpreted by whatever serves the file, not by us.
    if (!fragment || !destination.endsWith('.md')) continue;

    if (!ancresEnCache(destination).has(fragment.toLowerCase())) {
      casses.push(`${ici} → "${cible}" (in "${texte}"): no heading produces this anchor`);
    }
  }
}

if (casses.length === 0) {
  console.log(`links: ${verifies} valid internal references`);
  process.exit(0);
}

console.error(`\n${casses.length} broken internal link(s):\n`);
for (const casse of casses) console.error(`  · ${casse}`);
console.error(
  '\nAn invalid reference costs more than no reference: it sends the reader\n' +
    'elsewhere instead of leaving them to search.\n',
);
process.exit(1);
