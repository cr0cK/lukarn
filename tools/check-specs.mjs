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

/* ------------------------- Variables réellement câblées jusqu'au conteneur */

// Être mentionnée dans les specs ne suffit pas : encore faut-il que la valeur
// atteigne le processus. Compose ne propage pas l'environnement de l'hôte, et
// `.env` ne sert qu'à l'interpolation — une variable absente du bloc
// `environment:` et non fixée par le Dockerfile est donc **inchangeable en
// production**, la seule installation qui compte.
//
// Le défaut n'est pas théorique : `APP_NAME` et `GEOCODING_URL` ont vécu
// déclarées dans le schéma zod, dans `.env.example` et dans trois specs, sans
// jamais parvenir au conteneur. La documentation promettait qu'un redémarrage
// suffisait à renommer l'instance, et qu'une valeur vide coupait le géocodage :
// les deux étaient faux, et rien ne le signalait (D78).
const compose = lire(join(RACINE, 'docker-compose.yml'));
const dockerfile = lire(join(RACINE, 'Dockerfile'));

for (const variable of variables) {
  // `NOM: ${NOM…}` plutôt que la seule présence du nom : le contrôle porte sur
  // le câblage, et une variable citée dans un commentaire n'en est pas un.
  const transmise = new RegExp(String.raw`^\s+${variable}:\s*\$\{${variable}[:}-]`, 'm').test(
    compose,
  );
  const fixee = new RegExp(String.raw`^ENV ${variable}=`, 'm').test(dockerfile);
  if (!transmise && !fixee) {
    manques.push(
      `Variable « ${variable} » lue par env.ts, mais ni transmise par docker-compose.yml ni fixée par le Dockerfile : inchangeable en production`,
    );
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

/* ------------------------------------------------------------- Décisions */

/**
 * Une décision porte un identifiant, et rien dans git ne l'arbitre.
 *
 * Deux défauts en découlent, qu'aucun des contrôles ci-dessus n'attrape. Le
 * premier : deux entrées portant le même identifiant. Le second, plus coûteux :
 * un renvoi `(Dxx)` vers une décision qui n'existe pas, ou qui a changé de sens
 * depuis. Un tel renvoi ne casse rien, se lit sans accroc, et envoie le lecteur
 * sur une décision qui parle d'autre chose.
 *
 * `check-links.mjs` ne peut pas les voir : un renvoi `(D67)` en texte brut
 * n'est pas un lien markdown.
 */

/**
 * Deux familles d'identifiants, et c'est assumé.
 *
 * `D260809` : la date de la décision, au format AAMMJJ, une lettre si le jour en
 * porte déjà une. C'est la forme de toute décision nouvelle — une date se
 * connaît sans regarder les autres branches, un rang non.
 *
 * `D1` à `D99` : le rang qu'elles avaient du temps du fichier unique. Les
 * renommer traverserait les trois cents renvois que le code leur adresse, et un
 * identifiant qui change après coup n'en est plus un (D260809).
 */
const FORMAT_DATE = /^D(\d{2})(\d{2})(\d{2})([a-z])?$/;
const FORMAT_RANG = /^D([1-9]\d{0,2})$/;

/** Identifiant → d'où il vient, pour nommer les deux fautifs sur un doublon. */
const definies = new Map();

function definir(identifiant, origine) {
  const deja = definies.get(identifiant);
  if (deja) {
    manques.push(`Décision « ${identifiant} » définie deux fois : ${deja} et ${origine}`);
    return;
  }
  definies.set(identifiant, origine);
}

// Une décision par fichier : c'est ce qui rend deux branches parallèles
// fusionnables sans arbitrage, le conflit d'insertion en fin de journal ayant
// coûté plus cher que la collision d'identifiant elle-même.
for (const chemin of fichiers(join(SPECS, '08-decisions'), (n) => n.endsWith('.md'))) {
  const nomDeFichier = chemin.split('/').pop();
  if (nomDeFichier === 'README.md') continue;
  const ici = relative(RACINE, chemin);

  const titres = [...lire(chemin).matchAll(/^#\s+(\S+)\s+—\s/gm)];
  if (titres.length !== 1) {
    manques.push(
      `${ici} : une décision porte un titre « # D<AAMMJJ> — … » et un seul ` +
        `(${titres.length} trouvé(s))`,
    );
    continue;
  }

  const identifiant = titres[0][1];
  const date = FORMAT_DATE.exec(identifiant);
  if (!date && !FORMAT_RANG.test(identifiant)) {
    manques.push(
      `${ici} : « ${identifiant} » n'est pas un « D<AAMMJJ> » suivi d'une lettre au plus`,
    );
    continue;
  }
  if (date && (Number(date[2]) < 1 || Number(date[2]) > 12)) {
    manques.push(`${ici} : « ${identifiant} » n'encode pas une date (AAMMJJ)`);
  } else if (date && (Number(date[3]) < 1 || Number(date[3]) > 31)) {
    manques.push(`${ici} : « ${identifiant} » n'encode pas une date (AAMMJJ)`);
  }
  // Le nom de fichier est ce qu'on lit dans `git log` et dans le dossier ; il
  // ment dès qu'il diverge du titre, sans que rien ne s'en aperçoive.
  if (!nomDeFichier.startsWith(`${identifiant}-`)) {
    manques.push(`${ici} : le fichier devrait s'appeler « ${identifiant}-<slug>.md »`);
  }

  definir(identifiant, ici);
}

// Les renvois vivent autant dans le code que dans les specs : un commentaire
// qui justifie une ligne par une décision est la forme la plus utile du renvoi,
// et la plus facile à laisser pourrir.
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
          `${relative(RACINE, chemin)}:${index + 1} renvoie à « ${identifiant} », qui n'existe pas`,
        );
      }
    });
}

/* --------------------------------------------------------------- Verdict */

if (manques.length === 0) {
  console.log(
    `specs : à jour (routes, variables, migrations, modules, ${definies.size} décisions)`,
  );
  process.exit(0);
}

console.error(`\nLa documentation a décroché du code — ${manques.length} écart(s) :\n`);
for (const manque of manques) console.error(`  · ${manque}`);
console.error(
  '\nCLAUDE.md indique quel document suit quel fichier. Un changement de code' +
    "\nsans changement de spec n'est pas terminé.\n",
);
process.exit(1);
