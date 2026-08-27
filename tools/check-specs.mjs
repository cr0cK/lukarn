#!/usr/bin/env node
/**
 * Checks that the documentation has not drifted from the code.
 *
 * A written rule is followed for as long as someone remembers it. This check
 * removes that burden: it compares what the code exposes with what the specs
 * describe, and fails on any discrepancy. It does not judge the quality of the
 * prose — only whether a route, environment variable or module exists without
 * being mentioned anywhere.
 *
 * Deliberately based on verifiable anchors rather than "did the commit touch
 * specs/?", which an empty line would satisfy.
 *
 *   node tools/check-specs.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const SPECS = join(RACINE, 'specs');

/**
 * Modules whose behaviour is documented without naming the file. The specs
 * describe what the application does, not its file inventory: requiring the
 * name of a trivial component would create noise, and noisy checks get disabled.
 */
const MODULES_TOLERES = new Set([
  'Spinner', // generic indicator, referred to by its role
  'ShortcutsOverlay', // the `?` help is described in the shortcuts table
  'main', // entry point, described by what it starts
  'index', // type barrels
]);

function lire(chemin) {
  return readFileSync(chemin, 'utf8');
}

function fichiers(repertoire, filtre, acc = []) {
  for (const entree of readdirSync(repertoire)) {
    const chemin = join(repertoire, entree);
    if (statSync(chemin).isDirectory()) fichiers(chemin, filtre, acc);
    else if (filtre(entree)) acc.push(chemin);
  }
  return acc;
}

/**
 * Two directories under `specs/` describe what does not exist yet, and both are
 * excluded from the text the module check reads: a document naming a file before
 * that file exists satisfies the check the day it is written, and the module then
 * ships documented by nothing.
 *
 * `specs/09-plans/` holds plans, which the pull request that finishes them deletes,
 * so a module documented only by one would ship documented by a page about to
 * disappear. `specs/10-prds/` holds product intent written ahead of the code, which
 * is the same defect one step earlier: it names what somebody intends to build.
 *
 * Everything else still applies to both: they are read for `(Dxx)` references and
 * for cited spec files below. `specs/10-prds/` need not exist — the exclusion is a
 * prefix test, never a walk, so it costs nothing until the first PRD is written.
 */
const PLANS = join(SPECS, '09-plans');
const PRDS = join(SPECS, '10-prds');

const texteSpecs = fichiers(SPECS, (n) => n.endsWith('.md'))
  .filter((chemin) => ![PLANS, PRDS].some((dir) => chemin.startsWith(`${dir}/`)))
  .map(lire)
  .join('\n');
const specApi = lire(join(SPECS, '05-api.md'));
const specConfig = lire(join(SPECS, '06-configuration-and-deployment.md'));

const manques = [];

/* ------------------------------------------------------------------ Routes */

/**
 * An undocumented route is the most costly omission: it is the application's
 * public contract, and nothing in the code signals that it is missing.
 */
const routesDeclarees = new Set();
for (const chemin of fichiers(join(RACINE, 'packages/server/src/routes'), (n) =>
  n.endsWith('.ts'),
)) {
  const source = lire(chemin);
  for (const [, methode, url] of source.matchAll(
    /app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g,
  )) {
    // The mount prefix comes from `app.ts`; only the final segment is compared,
    // as it is distinctive enough and unaffected by prefix restructuring.
    const segment = url
      .replace(/:[a-zA-Z]+/g, '')
      .replace(/\/+/g, '/')
      .replace(/\/$/, '');
    if (segment && segment !== '/') routesDeclarees.add(`${methode.toUpperCase()} ${segment}`);
  }
}

for (const route of routesDeclarees) {
  const segment = route.split(' ')[1];
  const motif = segment.split('/').filter(Boolean).pop();
  if (motif && !specApi.includes(motif)) {
    manques.push(`Route "${route}" missing from specs/05-api.md (searched for "${motif}")`);
  }
}

/* ------------------------------------------------- Environment variables */

const envSource = lire(join(RACINE, 'packages/server/src/env.ts'));
const variables = new Set(
  [...envSource.matchAll(/^\s{2}([A-Z][A-Z0-9_]{2,}):\s/gm)].map((m) => m[1]),
);
// Set outside the zod schema, but just as important to operations.
variables.add('UV_THREADPOOL_SIZE');

for (const variable of variables) {
  if (!specConfig.includes(variable)) {
    manques.push(`Environment variable "${variable}" missing from specs/06`);
  }
}

/* ------------------------------- Variables actually wired to the container */

// Being mentioned in the specs is not enough: the value still has to reach the
// process. Compose does not pass through the host environment, and `.env` is
// only used for interpolation — a variable missing from the `environment:`
// block and not set by the Dockerfile is therefore **unchangeable in
// production**, the only installation that matters.
//
// The defect is not theoretical: `APP_NAME` and `GEOCODING_URL` were declared
// in the zod schema, in `.env.example` and in three specs without ever reaching
// the container. The documentation promised that a restart was enough to
// rename the instance, and that an empty value disabled geocoding: both claims
// were false, and nothing flagged them (D78).
const compose = lire(join(RACINE, 'docker-compose.yml'));
const dockerfile = lire(join(RACINE, 'Dockerfile'));

for (const variable of variables) {
  // `NAME: ${NAME…}` rather than the mere presence of the name: the check covers
  // wiring, and a variable mentioned in a comment is not wired.
  const transmise = new RegExp(String.raw`^\s+${variable}:\s*\$\{${variable}[:}-]`, 'm').test(
    compose,
  );
  const fixee = new RegExp(String.raw`^ENV ${variable}=`, 'm').test(dockerfile);
  if (!transmise && !fixee) {
    manques.push(`Variable "${variable}" read by env.ts is not wired to the production container`);
  }
}

/* ----------------------------------------------------------- Migrations */

const dbSource = lire(join(RACINE, 'packages/server/src/db.ts'));
// A migration opens its literal with a backtick alone on its line; it closes it
// with "`,", which does not match this pattern. Counting the openings therefore
// gives the number of migrations directly — dividing it by two, as before, made
// the count half as large, and even fractional for an odd number:
// `Number.isInteger` was then false and silently disabled the check.
const nbMigrations = (dbSource.match(/^\s{2}`$/gm) ?? []).length;
const annoncees = [...lire(join(SPECS, '03-data-model.md')).matchAll(/migration (\d+)/gi)]
  .map((m) => Number(m[1]))
  .reduce((max, n) => Math.max(max, n), 0);

if (Number.isInteger(nbMigrations) && nbMigrations > 0 && annoncees < nbMigrations) {
  manques.push(
    `${nbMigrations} migrations in db.ts, but specs/03 only documents up to migration ${annoncees}`,
  );
}

/* -------------------------------------------------------------- Modules */

const sources = [
  ...fichiers(join(RACINE, 'packages/server/src'), (n) => n.endsWith('.ts')),
  ...fichiers(join(RACINE, 'packages/web/src/lib'), (n) => n.endsWith('.ts')),
  ...fichiers(join(RACINE, 'packages/web/src/components'), (n) => n.endsWith('.tsx')),
];

for (const chemin of sources) {
  const nom = chemin
    .split('/')
    .pop()
    .replace(/\.tsx?$/, '');
  if (MODULES_TOLERES.has(nom)) continue;
  // Operational scripts are documented by their `pnpm` command.
  if (chemin.includes('/scripts/')) continue;
  if (!texteSpecs.includes(nom)) {
    manques.push(`Module "${relative(RACINE, chemin)}" not mentioned anywhere in specs/`);
  }
}

/* ------------------------------------------------------------- Decisions */

/**
 * A decision has an identifier, and nothing in git arbitrates it.
 *
 * This leaves two faults that none of the checks above catch. First: two entries
 * with the same identifier. Second, and more costly: a `(Dxx)` reference to a
 * decision that does not exist, or whose meaning has since changed. Such a
 * reference breaks nothing, reads smoothly, and sends the reader to a decision
 * about something else.
 *
 * `check-links.mjs` cannot see them: a plain-text `(D67)` reference is not a
 * markdown link.
 */

/**
 * There are deliberately two families of identifiers.
 *
 * `D260809`: the decision date in YYMMDD format, with a letter if the day already
 * has one. Every new decision uses this form — a date is known without looking
 * at other branches, whereas a sequence number is not.
 *
 * `D1` to `D99`: the sequence number they had when there was a single file.
 * Renaming them would touch the three hundred references from the code, and an
 * identifier that changes afterwards is no longer an identifier (D260809).
 */
const FORMAT_DATE = /^D(\d{2})(\d{2})(\d{2})([a-z])?$/;
const FORMAT_RANG = /^D([1-9]\d{0,2})$/;

/** Identifier → its origin, so both offenders can be named for a duplicate. */
const definies = new Map();

function definir(identifiant, origine) {
  const deja = definies.get(identifiant);
  if (deja) {
    manques.push(`Decision "${identifiant}" defined twice: ${deja} and ${origine}`);
    return;
  }
  definies.set(identifiant, origine);
}

// One decision per file: this makes two parallel branches mergeable without
// arbitration, as the insertion conflict at the end of the log cost more than
// the identifier collision itself.
for (const chemin of fichiers(join(SPECS, '08-decisions'), (n) => n.endsWith('.md'))) {
  const nomDeFichier = chemin.split('/').pop();
  if (nomDeFichier === 'README.md') continue;
  const ici = relative(RACINE, chemin);

  const titres = [...lire(chemin).matchAll(/^#\s+(\S+)\s+—\s/gm)];
  if (titres.length !== 1) {
    manques.push(
      `${ici}: a decision must have exactly one "# D<YYMMDD> — …" title ` +
        `(${titres.length} found)`,
    );
    continue;
  }

  const identifiant = titres[0][1];
  const date = FORMAT_DATE.exec(identifiant);
  if (!date && !FORMAT_RANG.test(identifiant)) {
    manques.push(`${ici}: "${identifiant}" is not a "D<YYMMDD>" followed by at most one letter`);
    continue;
  }
  if (date && (Number(date[2]) < 1 || Number(date[2]) > 12)) {
    manques.push(`${ici}: "${identifiant}" does not encode a date (YYMMDD)`);
  } else if (date && (Number(date[3]) < 1 || Number(date[3]) > 31)) {
    manques.push(`${ici}: "${identifiant}" does not encode a date (YYMMDD)`);
  }
  // The filename is what appears in `git log` and in the directory; it lies as
  // soon as it diverges from the title, without anything noticing.
  if (!nomDeFichier.startsWith(`${identifiant}-`)) {
    manques.push(`${ici}: the file should be named "${identifiant}-<slug>.md"`);
  }

  definir(identifiant, ici);
}

// References live in the code as much as in the specs: a comment that justifies
// a line with a decision is the most useful form of reference, and the easiest
// one to let rot.
const porteursDeRenvois = [
  ...fichiers(SPECS, (n) => n.endsWith('.md')),
  ...fichiers(join(RACINE, 'tools'), (n) => n.endsWith('.mjs')),
  ...fichiers(join(RACINE, 'packages/shared/src'), (n) => n.endsWith('.ts')),
  ...fichiers(join(RACINE, 'packages/server/src'), (n) => n.endsWith('.ts')),
  ...fichiers(join(RACINE, 'packages/server/test'), (n) => n.endsWith('.ts')),
  ...fichiers(join(RACINE, 'packages/web/src'), (n) => /\.tsx?$/.test(n)),
  ...fichiers(join(RACINE, 'packages/web/test'), (n) => /\.tsx?$/.test(n)),
  ...fichiers(join(RACINE, 'packages/web/public'), (n) => n.endsWith('.js')),
];

for (const chemin of porteursDeRenvois) {
  lire(chemin)
    .split('\n')
    .forEach((ligne, index) => {
      for (const [identifiant] of ligne.matchAll(/\bD\d+[a-z]?\b/g)) {
        if (definies.has(identifiant)) continue;
        manques.push(
          `${relative(RACINE, chemin)}:${index + 1} references missing decision "${identifiant}"`,
        );
      }
    });
}

/* ------------------------------------------- A rewritten decision is swept */

/**
 * When a decision is rewritten, the prose it seeded elsewhere is reread.
 *
 * Every check above proves that a mention **exists**. None of them looks at the
 * paragraph the new mention contradicts, and that is where this documentation
 * actually rots: D92 said a video poster comes from Drive and nothing is decoded
 * here, ffmpeg made it false, and the sentence survived in five documents for a
 * week. The pull request that did it had updated all seven specs, so no gate
 * reading "were the specs touched?" could ever have seen it.
 *
 * A decision states the rule in force and is rewritten when that rule changes
 * (D260822). Rewriting one is therefore the signal: this check lists every
 * paragraph of `specs/` and every source file that cites it, and asks for a
 * `Swept: D92 — <what was checked>` line in the commit body, in the shape
 * `check-changelog.mjs` already uses for an escape hatch that states its reason.
 *
 * What this forces is **seeing the list**, not reading each paragraph. It is the
 * honest limit of a mechanical check on prose, and the reason `specs/09-plans/`
 * carries a second layer whose whole task is the reading.
 */
const SWEPT = /^Swept:\s*(D\d+[a-z]?)/gim;

function git(...args) {
  // stderr is discarded: `git show` on a path absent from a commit writes a fatal
  // there before exiting non-zero, and `readAt` answers that case with an empty
  // string rather than with a line of noise above a legible report.
  return execFileSync('git', args, {
    cwd: RACINE,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/**
 * The commit this branch grew from, or `null` when there is nothing to compare.
 *
 * Actions supplies the target branch through `GITHUB_BASE_REF`, and `verify.yml`
 * checks out the full history so the merge base with it exists. The merge base
 * rather than the branch tip: `main` moves while a branch is open, and its tip
 * would attribute somebody else's rewrite — and their sweep — to this one.
 */
function baseCommit() {
  const references = process.env.GITHUB_BASE_REF
    ? [`origin/${process.env.GITHUB_BASE_REF}`]
    : ['origin/main', 'main'];

  for (const reference of references) {
    try {
      const fusion = git('merge-base', reference, 'HEAD');
      return fusion === git('rev-parse', 'HEAD') ? null : fusion;
    } catch {
      continue;
    }
  }
  return null;
}

/** Identifier stated by a decision file's title, or `null`. */
function identifierOf(contents) {
  const titre = /^#\s+(D\d+[a-z]?)\s+—\s/m.exec(contents);
  return titre ? titre[1] : null;
}

/** The whole title line, which is the sentence stating the rule. */
function titleLine(contents) {
  const titre = /^#\s+.*$/m.exec(contents);
  return titre ? titre[0].trim() : '';
}

/** A file's contents at a commit, or `''` where it did not exist. */
function readAt(commit, chemin) {
  try {
    return git('show', `${commit}:${chemin}`);
  } catch {
    return '';
  }
}

const base = existsSync(join(RACINE, '.git')) ? baseCommit() : null;

if (base) {
  const prefix = 'specs/08-decisions/';
  const rewritten = new Set();

  // **The title is the signal, not the diff.** A title states the rule, so a rule
  // that changed shows there and nowhere else. Firing on any edit to a decision
  // file would have demanded a sweep of D79, D260809g and D260816b in this very
  // change, whose only edit was a reference pointing at a renamed file — three
  // false alarms out of five, which is how a check earns its way to being
  // disabled.
  //
  // Titles are compared **by identifier**, never by path. Git's rename detection
  // needs the two versions to still resemble each other, and a decision rewritten
  // thoroughly enough to matter — one absorbing the newer decision that replaced
  // it — reads to git as one file added and another deleted. Keying on the
  // identifier the title states survives that, and survives a fold, where the
  // identifier simply stops existing.
  const before = new Map();
  const after = new Map();

  for (const chemin of git('diff', '--name-only', base, '--', prefix).split('\n')) {
    if (!chemin || chemin.endsWith('README.md')) continue;

    for (const [contenu, table] of [
      [readAt(base, chemin), before],
      [existsSync(join(RACINE, chemin)) ? lire(join(RACINE, chemin)) : '', after],
    ]) {
      const identifiant = contenu && identifierOf(contenu);
      if (identifiant) table.set(identifiant, titleLine(contenu));
    }
  }

  for (const [identifiant, titre] of before) {
    if (after.get(identifiant) !== titre) rewritten.add(identifiant);
  }

  const declared = new Set(
    [...git('log', '--format=%B', `${base}..HEAD`).matchAll(SWEPT)].map((m) => m[1]),
  );

  for (const identifiant of rewritten) {
    if (declared.has(identifiant)) continue;

    const cites = new RegExp(`\\b${identifiant}\\b`);
    const sites = [];
    const code = [];

    for (const chemin of porteursDeRenvois) {
      if (chemin.startsWith(`${join(SPECS, '08-decisions')}/`)) continue;
      const texte = lire(chemin);
      if (!cites.test(texte)) continue;
      if (!chemin.startsWith(`${SPECS}/`)) {
        code.push(relative(RACINE, chemin));
        continue;
      }
      texte.split('\n').forEach((ligne, index) => {
        if (cites.test(ligne)) sites.push(`${relative(RACINE, chemin)}:${index + 1}`);
      });
    }

    // Nothing restates it, so there is nothing to reread. This is the ordinary
    // shape of a fold, where the identifier stops existing and every citation has
    // already moved — the reference check above guarantees it. Asking for a
    // `Swept:` line there would be a demand with an empty list attached.
    if (sites.length === 0 && code.length === 0) continue;

    manques.push(
      `"${identifiant}" was rewritten: reread what restates it, then say so with ` +
        `"Swept: ${identifiant} — <what you checked>" in the commit body` +
        (sites.length > 0 ? `\n      specs: ${sites.join(', ')}` : '') +
        (code.length > 0 ? `\n      source: ${code.join(', ')}` : ''),
    );
  }
}

/* ------------------------------------------- References between spec files */

/**
 * Does a specs document cited in text, between backticks, identify an existing
 * file?
 *
 * Between `check-links.mjs`, which follows markdown links, and the `(Dxx)`
 * reference check above, this case slipped through: "a decision is a file in
 * `specs/decisions/`" remained true until the directory was renamed, and nothing
 * flagged it (D260809d).
 *
 * The decisions directory is excluded: a log inherently talks about the past —
 * it names what has been replaced, and requiring it to remain present would
 * make the log impossible to write.
 */
const ABREVIATION = /^specs\/0\d$/; // "see specs/06", the repository convention
const DESIGNE_UNE_SPEC = /^(specs\/|0\d-[a-z-]+(\.md)?$|decisions\/|08-decisions)/;

const citantDesSpecs = [
  ...fichiers(SPECS, (n) => n.endsWith('.md')).filter(
    (c) => !c.includes(`${join(SPECS, '08-decisions')}/`),
  ),
  join(RACINE, 'README.md'),
  join(RACINE, 'CLAUDE.md'),
  ...(existsSync(join(RACINE, 'AGENTS.md')) ? [join(RACINE, 'AGENTS.md')] : []),
  join(RACINE, 'deploy/README.md'),
];

for (const chemin of citantDesSpecs) {
  for (const [, cite] of lire(chemin).matchAll(/`([^`\n]+)`/g)) {
    if (!DESIGNE_UNE_SPEC.test(cite) || ABREVIATION.test(cite)) continue;
    // A form (`D<YYMMDD>`, a wildcard) does not promise a specific file.
    if (cite.includes('<') || cite.includes('*')) continue;
    const candidats = [join(RACINE, cite), join(SPECS, cite), join(SPECS, `${cite}.md`)];
    if (candidats.some((c) => existsSync(c))) continue;
    manques.push(`${relative(RACINE, chemin)} cites "${cite}", which does not exist`);
  }
}

/* ------------------------------------------------------- A finished plan */

/**
 * A plan whose every item is ticked should no longer exist.
 *
 * `specs/09-plans/` is the one directory describing what does not exist yet, and
 * CLAUDE.md says the pull request that finishes a plan deletes it. Nothing
 * enforced that, and a finished plan is worse than no plan: it keeps naming
 * branches that were merged and states as pending work that shipped, which is
 * exactly what the last one did — three items still unticked on `main` for code
 * `specs/02-architecture.md` already documented.
 *
 * Every box ticked is the one unambiguous signal available. A plan half-done is
 * left alone, because that is what a plan is for.
 */
for (const chemin of fichiers(PLANS, (n) => n.endsWith('.md'))) {
  // The directory's own README explains what a plan is; it is never finished.
  if (chemin.endsWith('/README.md')) continue;

  const source = lire(chemin);
  const total = (source.match(/^\s*-\s\[[ x]\]/gm) ?? []).length;
  const restants = (source.match(/^\s*-\s\[ \]/gm) ?? []).length;

  if (total > 0 && restants === 0) {
    manques.push(
      `${relative(RACINE, chemin)}: every one of its ${total} items is ticked — the pull ` +
        'request that finishes a plan deletes it',
    );
  }
}

/* ------------------------------------------------ What the README claims */

/**
 * Does the README still name every storage a released instance can read?
 *
 * The README is the front door, and it is the document that drifts most quietly:
 * nothing breaks when it keeps describing an application that gained a feature
 * six weeks ago. It claimed "Drive is the first storage it reads, and the only
 * one it reads today" for as long as three other backends shipped, because no
 * check reads prose.
 *
 * The anchor is `SUPPORTED_KINDS` — what /admin can actually build — paired with
 * the label the interface shows for it. Requiring that exact label rather than a
 * paraphrase is deliberate: someone reading "S3-compatible bucket" in the README
 * looks for those words in the form, and finds them.
 */
const kindsSupportes = /SUPPORTED_KINDS[^=]*=\s*\[([^\]]*)\]/.exec(
  lire(join(RACINE, 'packages/server/src/storage/registry.ts')),
);

if (!kindsSupportes) {
  manques.push('storage/registry.ts no longer declares SUPPORTED_KINDS as a literal list');
} else {
  const catalogue = lire(join(RACINE, 'packages/web/src/lib/i18n/messages-en.ts'));
  const readme = lire(join(RACINE, 'README.md'));

  for (const [, kind] of kindsSupportes[1].matchAll(/'([a-z0-9]+)'/g)) {
    const cle = `storage.kind${kind[0].toUpperCase()}${kind.slice(1)}`;
    const libelle = new RegExp(`'${cle}':\\s*'([^']+)'`).exec(catalogue);

    if (!libelle) {
      manques.push(`messages-en.ts has no "${cle}" for the supported storage kind "${kind}"`);
      continue;
    }
    if (!readme.includes(libelle[1])) {
      manques.push(`README.md never names "${libelle[1]}", which /admin offers as a storage kind`);
    }
  }

  const tabsNav = lire(join(RACINE, 'packages/web/src/components/admin/AdminNav.tsx'));
  const tabsMatch = /ADMIN_TABS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(tabsNav);

  if (!tabsMatch) {
    manques.push('AdminNav.tsx no longer declares ADMIN_TABS as a literal array');
  } else {
    const readmeMin = readme.toLowerCase();
    const MOTS_CLEFS_TABS = {
      storage: ['storage'],
      albums: ['album'],
      shares: ['share', 'sharing', 'link'],
      accounts: ['account'],
      comments: ['comment'],
    };

    for (const [, slug, group] of tabsMatch[1].matchAll(
      /slug:\s*'([a-z0-9]+)',.*?group:\s*'(admin\.group(?:Library|People))'/g,
    )) {
      const mots = MOTS_CLEFS_TABS[slug] ?? [slug];
      if (!mots.some((mot) => readmeMin.includes(mot))) {
        manques.push(`README.md does not describe "${slug}", which /admin offers in ${group}`);
      }
    }
  }
}

/* --------------------------------------------------------------- Verdict */

if (manques.length === 0) {
  console.log(
    `specs: up to date (routes, variables, migrations, modules, ${definies.size} decisions)`,
  );
  process.exit(0);
}

console.error(`\nDocumentation has drifted from code — ${manques.length} issue(s):\n`);
for (const manque of manques) console.error(`  · ${manque}`);
console.error(
  '\nCLAUDE.md states which document tracks each file. A code change' +
    '\nwithout a spec change is not complete.\n',
);
process.exit(1);
