#!/usr/bin/env node
/**
 * Checks that a change someone will notice is written down where they will read it.
 *
 * `check-specs.mjs` keeps the specs honest for whoever takes over the code.
 * This one keeps `CHANGELOG.md` honest for whoever runs the application: the
 * section matching a `v*` tag becomes the body of its GitHub release, so a
 * feature absent from it is a feature nobody is told about.
 *
 * **The trigger is the commit type, not the paths touched.** A rule reading
 * `packages/web/src/**` would demand an entry for a rename, and a check that
 * fires on work nobody would report eventually gets disabled — the reason
 * `MODULES_TOLERES` exists next door. Conventional Commits already carry the
 * author's own answer: `feat`, `fix` and `perf` are the three types that claim
 * somebody will notice. The others — `refactor`, `docs`, `test`, `chore`,
 * `build`, `ci`, `style` — say the opposite and are believed.
 *
 * Escape hatch, for the `fix` nobody outside the repository could observe:
 * a `Changelog: none — <reason>` line in a commit body. Stating the reason is
 * the point; a silent skip is what this check exists to prevent.
 *
 *   node tools/check-changelog.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('..', import.meta.url));

/** The types that promise somebody will notice, per Conventional Commits. */
const TYPES_VISIBLES = /^(feat|fix|perf)(\([^)]*\))?!?:/;

/**
 * Types that can be dispensed when internal. `feat` is deliberately absent:
 * a feature is by definition user-facing and cannot excuse itself from CHANGELOG.md.
 */
const TYPES_DISPENSABLES = /^(fix|perf)(\([^)]*\))?!?:/;

/** Opts one commit out, and says why in the same breath. */
const DISPENSE = /^Changelog:\s*none\b/im;

function git(...args) {
  return execFileSync('git', args, { cwd: RACINE, encoding: 'utf8' }).trim();
}

/**
 * The commit this branch grew from.
 *
 * In a pull request, Actions supplies the target branch through
 * `GITHUB_BASE_REF`; `verify.yml` checks out the full history so the merge base
 * with it exists, which a shallow clone does not carry.
 */
function base() {
  const references = process.env.GITHUB_BASE_REF
    ? [`origin/${process.env.GITHUB_BASE_REF}`]
    : ['origin/main', 'main'];

  for (const reference of references) {
    let fusion;
    try {
      // The merge base, never the branch tip: `main` moves while a branch is
      // open, and comparing against its tip would attribute somebody else's
      // commits — and their changelog entry — to this one.
      fusion = git('merge-base', reference, 'HEAD');
    } catch {
      continue;
    }
    // On `main` itself the merge base **is** HEAD: nothing was added here, and
    // whatever brought it was checked on the branch before it merged.
    return fusion === git('rev-parse', 'HEAD') ? null : fusion;
  }

  // No base to compare against — a clone too shallow to hold one, or a branch
  // with no relation to `main`. Report rather than guess: a check that invents
  // a base would either pass on everything or fail on everything.
  return undefined;
}

/** The `## [Unreleased]` section, or `''` when the file carries none. */
function sectionInedite(markdown) {
  const debut = markdown.search(/^## \[?unreleased\]?/im);
  if (debut < 0) return '';
  const suite = markdown.slice(debut).search(/\n## /);
  return suite < 0 ? markdown.slice(debut) : markdown.slice(debut, debut + suite);
}

function auCommit(reference, chemin) {
  try {
    return git('show', `${reference}:${chemin}`);
  } catch {
    // The file did not exist there. An empty section then differs from any
    // section, which is the answer wanted.
    return '';
  }
}

/* ------------------------------------------------------------------ Verdict */

const depuis = base();

if (depuis === null) {
  console.log('changelog: nothing to compare (no commit beyond the base branch)');
  process.exit(0);
}

if (depuis === undefined) {
  console.error(
    '\nNo merge base with `main` — a clone too shallow to hold one, or a' +
      '\nbranch unrelated to it. Fetch the history (`git fetch --unshallow`)' +
      '\nbefore reading this as a verdict.\n',
  );
  process.exit(1);
}

const journal = git('log', '--format=%H%x00%B%x00%x00', `${depuis}..HEAD`)
  .split('\0\0')
  .map((entree) => entree.trim())
  .filter(Boolean)
  .map((entree) => {
    const [sha, message = ''] = entree.split('\0');
    return { sha: sha.slice(0, 7), sujet: message.trim().split('\n')[0] ?? '', message };
  });

const reclament = journal.filter(
  (commit) =>
    TYPES_VISIBLES.test(commit.sujet) &&
    (!TYPES_DISPENSABLES.test(commit.sujet) || !DISPENSE.test(commit.message)),
);

if (reclament.length === 0) {
  console.log(`changelog: no commit claims a visible change (${journal.length} examined)`);
  process.exit(0);
}

const avant = sectionInedite(auCommit(depuis, 'CHANGELOG.md'));
const apres = sectionInedite(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'));

if (avant !== apres) {
  console.log(`changelog: ${reclament.length} visible change(s), and the notes moved with them`);
  process.exit(0);
}

console.error(
  `\nCHANGELOG.md has not moved — ${reclament.length} commit(s) claim a change` +
    '\nsomeone using the application will notice:\n',
);
for (const commit of reclament) console.error(`  · ${commit.sha}  ${commit.sujet}`);
console.error(
  '\nAdd what they change under "## [Unreleased]", in the voice of the' +
    '\nfile: what it does for the reader, not what the diff does. The' +
    '\nsection of a `v*` tag becomes the body of its GitHub release.' +
    '\n\nFor a fix nobody outside this repository could observe, put' +
    '\n"Changelog: none — <reason>" in the commit body. A "feat" commit' +
    '\nalways demands an entry.\n',
);
process.exit(1);
