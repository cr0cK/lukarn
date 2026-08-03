#!/usr/bin/env node
/**
 * Vérifie que la documentation n'a pas décroché du code.
 *
 * Une règle écrite se respecte tant qu'on y pense. Ce contrôle ne demande pas
 * d'y penser : il compare ce que le code expose à ce que les specs décrivent, et
 * échoue sur l'écart. Il ne juge pas la qualité de la prose — seulement le fait
 * qu'une route, une variable d'environnement ou un module existe sans être
 * mentionné nulle part.
 *
 * Volontairement fondé sur des points d'ancrage vérifiables plutôt que sur
 * « le commit a-t-il touché specs/ ? », qui se satisferait d'une ligne vide.
 *
 *   node tools/check-specs.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const SPECS = join(RACINE, 'specs');

/**
 * Modules dont le comportement est documenté sans que le fichier soit nommé.
 * Les specs décrivent ce que fait l'application, pas l'inventaire de ses
 * fichiers : exiger le nom d'un composant trivial produirait du bruit, et du
 * bruit fait désactiver un contrôle.
 */
const MODULES_TOLERES = new Set([
  'Spinner', // indicateur générique, cité par son rôle
  'ShortcutsOverlay', // l'aide `?` est décrite dans le tableau des raccourcis
  'main', // point d'entrée, décrit par ce qu'il démarre
  'index', // barils de types
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

const texteSpecs = fichiers(SPECS, (n) => n.endsWith('.md'))
  .map(lire)
  .join('\n');
const specApi = lire(join(SPECS, '05-api.md'));
const specConfig = lire(join(SPECS, '06-configuration-et-deploiement.md'));

const manques = [];

/* ------------------------------------------------------------------ Routes */

/**
 * Une route non documentée est le manque le plus coûteux : c'est le contrat
 * public de l'application, et rien dans le code ne signale son absence.
 */
const routesDeclarees = new Set();
for (const chemin of fichiers(join(RACINE, 'packages/server/src/routes'), (n) =>
  n.endsWith('.ts'),
)) {
  const source = lire(chemin);
  for (const [, methode, url] of source.matchAll(/app\.(get|post|patch|delete)\(\s*'([^']+)'/g)) {
    // Le préfixe de montage vient d'`app.ts` ; on ne compare que le segment
    // final, suffisamment discriminant et insensible au remaniement des préfixes.
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
    manques.push(`Route « ${route} » absente de specs/05-api.md (cherché « ${motif} »)`);
  }
}

/* ------------------------------------------- Variables d'environnement */

const envSource = lire(join(RACINE, 'packages/server/src/env.ts'));
const variables = new Set(
  [...envSource.matchAll(/^\s{2}([A-Z][A-Z0-9_]{2,}):\s/gm)].map((m) => m[1]),
);
// Réglée hors du schéma zod, mais tout aussi structurante pour l'exploitation.
variables.add('UV_THREADPOOL_SIZE');

for (const variable of variables) {
  if (!specConfig.includes(variable)) {
    manques.push(`Variable d'environnement « ${variable} » absente de specs/06`);
  }
}

/* ----------------------------------------------------------- Migrations */

const dbSource = lire(join(RACINE, 'packages/server/src/db.ts'));
// Une migration ouvre son littéral par un backtick seul sur sa ligne ; elle le
// referme par « `, », qui ne correspond pas à ce motif. Compter les ouvertures
// donne donc directement le nombre de migrations — le diviser par deux, comme
// on le faisait, rendait un compte deux fois trop petit, et carrément
// fractionnaire en nombre impair : `Number.isInteger` était alors faux et le
// contrôle se désactivait sans rien dire.
const nbMigrations = (dbSource.match(/^\s{2}`$/gm) ?? []).length;
const annoncees = [...lire(join(SPECS, '03-modele-de-donnees.md')).matchAll(/migration (\d+)/gi)]
  .map((m) => Number(m[1]))
  .reduce((max, n) => Math.max(max, n), 0);

if (Number.isInteger(nbMigrations) && nbMigrations > 0 && annoncees < nbMigrations) {
  manques.push(
    `${nbMigrations} migrations dans db.ts, mais specs/03 ne va que jusqu'à la ${annoncees}`,
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
  // Les scripts d'exploitation sont documentés par leur commande `pnpm`.
  if (chemin.includes('/scripts/')) continue;
  if (!texteSpecs.includes(nom)) {
    manques.push(`Module « ${relative(RACINE, chemin)} » cité nulle part dans specs/`);
  }
}

/* --------------------------------------------------------------- Verdict */

if (manques.length === 0) {
  console.log('specs : à jour (routes, variables, migrations, modules)');
  process.exit(0);
}

console.error(`\nLa documentation a décroché du code — ${manques.length} écart(s) :\n`);
for (const manque of manques) console.error(`  · ${manque}`);
console.error(
  '\nCLAUDE.md indique quel document suit quel fichier. Un changement de code' +
    "\nsans changement de spec n'est pas terminé.\n",
);
process.exit(1);
