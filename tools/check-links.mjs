#!/usr/bin/env node
/**
 * Vérifie que les liens internes de la documentation mènent quelque part.
 *
 * La documentation est répartie sur trois fichiers qui se renvoient l'un à
 * l'autre (D56) : `README.md`, `deploy/README.md` et `specs/`. Rien ne signale
 * un renvoi devenu faux — déplacer une section ou renommer un fichier casse un
 * lien en silence, et personne ne s'en aperçoit avant de cliquer. Ce contrôle
 * résout chaque lien relatif et chaque ancre, et échoue sur le premier qui ne
 * mène nulle part.
 *
 * Les liens externes ne sont **pas** suivis : cela demanderait le réseau, et un
 * contrôle qui échoue parce qu'un site tiers est lent finit désactivé.
 *
 *   node tools/check-links.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('..', import.meta.url));

/** Répertoires sans documentation à contrôler, ou qui n'appartiennent pas au dépôt. */
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
 * Retire les blocs de code avant d'y chercher des liens.
 *
 * `deploy/README.md` contient des commandes shell entre backticks où des
 * crochets et des parenthèses se suivent ; les prendre pour des liens
 * produirait des échecs sur des chemins qui n'ont jamais prétendu en être.
 */
function sansBlocsDeCode(source) {
  return source.replace(/^```[\s\S]*?^```/gm, '');
}

/**
 * Reproduit la façon dont GitHub fabrique l'ancre d'un titre : minuscules,
 * ponctuation retirée, espaces en tirets. Les tirets déjà présents sont gardés,
 * ce qui explique la double tiret d'un titre contenant un tiret cadratin entre
 * deux espaces.
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
    // Protocoles et ancres de page servie ailleurs : hors de portée d'un
    // contrôle hors ligne.
    if (/^[a-z][a-z0-9+.-]*:/i.test(cible)) continue;

    const [chemin, fragment] = cible.split('#');
    verifies += 1;

    let destination = fichier;
    if (chemin) {
      destination = resolve(repertoire, chemin);
      if (!existsSync(destination)) {
        casses.push(`${ici} → « ${cible} » (dans « ${texte} ») : fichier introuvable`);
        continue;
      }
    }

    // Une ancre ne se vérifie que dans un markdown : ailleurs, le fragment est
    // interprété par ce qui sert le fichier, pas par nous.
    if (!fragment || !destination.endsWith('.md')) continue;

    if (!ancresEnCache(destination).has(fragment.toLowerCase())) {
      casses.push(`${ici} → « ${cible} » (dans « ${texte} ») : aucun titre ne produit cette ancre`);
    }
  }
}

if (casses.length === 0) {
  console.log(`liens : ${verifies} renvois internes valides`);
  process.exit(0);
}

console.error(`\n${casses.length} lien(s) interne(s) cassé(s) :\n`);
for (const casse of casses) console.error(`  · ${casse}`);
console.error(
  "\nUn renvoi faux coûte plus cher qu'une absence de renvoi : il envoie le\n" +
    'lecteur ailleurs au lieu de le laisser chercher.\n',
);
process.exit(1);
