#!/usr/bin/env node
/**
 * Checks that the documentation has not drifted from the code and SDP structure.
 *
 * Verifies:
 *   1. Every environment variable read by `env.ts` (+ `UV_THREADPOOL_SIZE`) is
 *      documented in `docs/specs/` and wired into `docker-compose.yml` or `Dockerfile` (D78).
 *   2. Every spec in `docs/specs/<CODE>.md` carries valid SDP front matter and is
 *      listed in `docs/specs/README.md`.
 *   3. Every decision in `docs/decisions/` follows the `D<YYMMDD>` / `D<n>` format,
 *      has no duplicate ID, and every `(Dxx)` citation in docs and code comments exists.
 *   4. Any rewritten decision title in `docs/decisions/` includes a `Swept: Dxx`
 *      acknowledgement in the commit body when citations exist.
 *   5. Every backticked `docs/...` or `specs/...` file path resolves on disk (D260809d).
 *   6. `README.md` lists every storage kind (`SUPPORTED_KINDS`) and admin tab (`ADMIN_TABS`).
 *
 *   node tools/check-specs.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const DOCS_SPECS = join(RACINE, 'docs/specs');
const DOCS_DECISIONS = join(RACINE, 'docs/decisions');

function lire(chemin) {
  return readFileSync(chemin, 'utf8');
}

function fichiers(repertoire, filtre, acc = []) {
  if (!existsSync(repertoire)) return acc;
  for (const entree of readdirSync(repertoire)) {
    const chemin = join(repertoire, entree);
    if (statSync(chemin).isDirectory()) fichiers(chemin, filtre, acc);
    else if (filtre(entree)) acc.push(chemin);
  }
  return acc;
}

/** Parses a simple YAML scalar value, stripping trailing comments and outer quotes. */
function yamlScalar(frontMatter, key) {
  const match = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm').exec(frontMatter);
  if (!match) return null;
  let raw = match[1].trim();
  const quote = raw[0];
  if ((quote === '"' || quote === "'") && raw.includes(quote, 1)) {
    const end = raw.indexOf(quote, 1);
    return raw.slice(1, end).trim();
  }
  const hash = raw.indexOf(' #');
  if (hash !== -1) raw = raw.slice(0, hash).trim();
  return raw || null;
}

/** Extracts JS/TS comment text while preserving 1-based line numbers for reporting. */
function commentLines(source) {
  const lines = source.split('\n');
  const out = [];
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) {
        out.push({ lineNumber: i + 1, text: line });
      } else {
        out.push({ lineNumber: i + 1, text: line.slice(0, end + 2) });
        inBlock = false;
      }
      continue;
    }
    const blockStart = line.indexOf('/*');
    const lineStart = line.indexOf('//');
    if (blockStart !== -1 && (lineStart === -1 || blockStart < lineStart)) {
      const end = line.indexOf('*/', blockStart + 2);
      if (end === -1) {
        out.push({ lineNumber: i + 1, text: line.slice(blockStart) });
        inBlock = true;
      } else {
        out.push({ lineNumber: i + 1, text: line.slice(blockStart, end + 2) });
      }
    } else if (lineStart !== -1) {
      out.push({ lineNumber: i + 1, text: line.slice(lineStart) });
    }
  }
  return out;
}

const specFiles = fichiers(DOCS_SPECS, (n) => n.endsWith('.md'));
const texteSpecs = specFiles.map(lire).join('\n');
const specsReadme = existsSync(join(DOCS_SPECS, 'README.md'))
  ? lire(join(DOCS_SPECS, 'README.md'))
  : '';

const manques = [];

/* ------------------------------------------------- Environment variables */

const envSource = lire(join(RACINE, 'packages/server/src/env.ts'));
const variables = new Set(
  [...envSource.matchAll(/^\s{2}([A-Z][A-Z0-9_]{2,}):\s/gm)].map((m) => m[1]),
);
// Set outside the zod schema, but just as important to operations.
variables.add('UV_THREADPOOL_SIZE');

for (const variable of variables) {
  if (!texteSpecs.includes(variable)) {
    manques.push(`Environment variable "${variable}" missing from docs/specs/`);
  }
}

/* ------------------------------- Variables actually wired to the container */

// Being mentioned in the specs is not enough: the value still has to reach the
// process. Compose does not pass through the host environment, and `.env` is
// only used for interpolation — a variable missing from the `environment:`
// block and not set by the Dockerfile is therefore **unchangeable in
// production**, the only installation that matters (D78).
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

/* ----------------------------------------------------- SDP spec front matter */

const RESERVED_CODES = new Set(['AND', 'NOT', 'OR']);
const VALID_STATUSES = new Set(['draft', 'active', 'done', 'shipped']);

for (const chemin of specFiles) {
  const nom = chemin.split('/').pop();
  if (nom === 'README.md') continue;
  const ici = relative(RACINE, chemin);
  const codeAttendu = nom.replace(/\.md$/, '');
  const contenu = lire(chemin);

  const fmMatch = /^---\n([\s\S]*?)\n---\n/.exec(contenu);
  if (!fmMatch) {
    manques.push(`${ici}: missing YAML front matter`);
    continue;
  }

  const fm = fmMatch[1];
  const code = yamlScalar(fm, 'code');
  const status = yamlScalar(fm, 'status');
  const version = yamlScalar(fm, 'version');
  const created = yamlScalar(fm, 'created');
  const tracking = yamlScalar(fm, 'tracking');

  if (!code || code !== codeAttendu || !/^[A-Z]{3}[0-9]?$/.test(code) || RESERVED_CODES.has(code)) {
    manques.push(
      `${ici}: front matter "code" must match filename "${codeAttendu}" (3 uppercase letters + optional digit, not AND/NOT/OR)`,
    );
  }
  if (!status || !VALID_STATUSES.has(status)) {
    manques.push(`${ici}: front matter "status" must be draft, active, or done`);
  }
  if (!version) {
    manques.push(`${ici}: front matter "version" is required`);
  }
  if ((status === 'draft' || status === 'active') && !tracking) {
    manques.push(`${ici}: front matter "tracking" is required for ${status} specs`);
  }
  if (!created || !/^\d{4}-\d{2}-\d{2}$/.test(created)) {
    manques.push(`${ici}: front matter "created" must be YYYY-MM-DD`);
  }
  if (!new RegExp(`\\\`${codeAttendu}\\\``).test(specsReadme)) {
    manques.push(`${ici}: spec code "${codeAttendu}" is not listed in docs/specs/README.md`);
  }
}

/* ------------------------------------------------------------- Decisions */

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

for (const chemin of fichiers(DOCS_DECISIONS, (n) => n.endsWith('.md'))) {
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
  if (!nomDeFichier.startsWith(`${identifiant}-`)) {
    manques.push(`${ici}: the file should be named "${identifiant}-<slug>.md"`);
  }

  definir(identifiant, ici);
}

const markdownCitants = [...specFiles, ...fichiers(DOCS_DECISIONS, (n) => n.endsWith('.md'))];
const codeCitants = [
  ...fichiers(join(RACINE, 'tools'), (n) => n.endsWith('.mjs')),
  ...fichiers(join(RACINE, 'packages/shared/src'), (n) => n.endsWith('.ts')),
  ...fichiers(join(RACINE, 'packages/server/src'), (n) => n.endsWith('.ts')),
  ...fichiers(join(RACINE, 'packages/server/test'), (n) => n.endsWith('.ts')),
  ...fichiers(join(RACINE, 'packages/web/src'), (n) => /\.tsx?$/.test(n)),
  ...fichiers(join(RACINE, 'packages/web/test'), (n) => /\.tsx?$/.test(n)),
  ...fichiers(join(RACINE, 'packages/web/public'), (n) => n.endsWith('.js')),
];

for (const chemin of markdownCitants) {
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

for (const chemin of codeCitants) {
  for (const { lineNumber, text } of commentLines(lire(chemin))) {
    for (const [identifiant] of text.matchAll(/\bD\d+[a-z]?\b/g)) {
      if (definies.has(identifiant)) continue;
      manques.push(
        `${relative(RACINE, chemin)}:${lineNumber} references missing decision "${identifiant}"`,
      );
    }
  }
}

/* ------------------------------------------- A rewritten decision is swept */

const SWEPT = /^Swept:\s*(D\d+[a-z]?)/gim;

function git(...args) {
  return execFileSync('git', args, {
    cwd: RACINE,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

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

function identifierOf(contents) {
  const titre = /^#\s+(D\d+[a-z]?)\s+—\s/m.exec(contents);
  return titre ? titre[1] : null;
}

function titleLine(contents) {
  const titre = /^#\s+.*$/m.exec(contents);
  return titre ? titre[0].trim() : '';
}

function readAt(commit, chemin) {
  try {
    return git('show', `${commit}:${chemin}`);
  } catch {
    return '';
  }
}

const base = existsSync(join(RACINE, '.git')) ? baseCommit() : null;

if (base) {
  const prefix = 'docs/decisions/';
  const rewritten = new Set();

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

    for (const chemin of specFiles) {
      const texte = lire(chemin);
      if (!cites.test(texte)) continue;
      texte.split('\n').forEach((ligne, index) => {
        if (cites.test(ligne)) sites.push(`${relative(RACINE, chemin)}:${index + 1}`);
      });
    }

    for (const chemin of codeCitants) {
      if (commentLines(lire(chemin)).some(({ text }) => cites.test(text))) {
        code.push(relative(RACINE, chemin));
      }
    }

    if (sites.length === 0 && code.length === 0) continue;

    manques.push(
      `"${identifiant}" was rewritten: reread what restates it, then say so with ` +
        `"Swept: ${identifiant} — <what you checked>" in the commit body` +
        (sites.length > 0 ? `\n      specs: ${sites.join(', ')}` : '') +
        (code.length > 0 ? `\n      source: ${code.join(', ')}` : ''),
    );
  }
}

/* ------------------------------------------- References between doc files */

const DESIGNE_UNE_DOC = /^(docs\/(specs|decisions)\/|specs\/)/;

const citantDesDocs = [
  ...specFiles,
  join(RACINE, 'README.md'),
  ...(existsSync(join(RACINE, 'CLAUDE.md')) ? [join(RACINE, 'CLAUDE.md')] : []),
  ...(existsSync(join(RACINE, 'GEMINI.md')) ? [join(RACINE, 'GEMINI.md')] : []),
  ...(existsSync(join(RACINE, 'AGENTS.md')) ? [join(RACINE, 'AGENTS.md')] : []),
  ...(existsSync(join(RACINE, 'CONTRIBUTING.md')) ? [join(RACINE, 'CONTRIBUTING.md')] : []),
  ...(existsSync(join(RACINE, 'SECURITY.md')) ? [join(RACINE, 'SECURITY.md')] : []),
  join(RACINE, 'deploy/README.md'),
];

for (const chemin of citantDesDocs) {
  for (const [, cite] of lire(chemin).matchAll(/`([^`\n]+)`/g)) {
    if (!DESIGNE_UNE_DOC.test(cite)) continue;
    // A form (`<CODE>`, `D<YYMMDD>`, a wildcard) does not promise a specific file.
    if (cite.includes('<') || cite.includes('*')) continue;
    if (existsSync(join(RACINE, cite))) continue;
    manques.push(`${relative(RACINE, chemin)} cites "${cite}", which does not exist`);
  }
}

/* ------------------------------------------------ What the README claims */

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

const specCount = specFiles.filter((p) => !p.endsWith('/README.md')).length;

if (manques.length === 0) {
  console.log(
    `specs: up to date (${specCount} specs, ${variables.size} env vars, ${definies.size} decisions)`,
  );
  process.exit(0);
}

console.error(`\nDocumentation has drifted from code — ${manques.length} issue(s):\n`);
for (const manque of manques) console.error(`  · ${manque}`);
console.error(
  '\nAGENTS.md describes the SDP workflow and decision log.\n' +
    'Update the affected spec via a spec PR, or the decision log, as appropriate.\n',
);
process.exit(1);
