# Specs

Documentation de conception de la visionneuse. Le `README.md` de la racine
explique comment installer et exploiter l'application ; ces documents-ci
expliquent **pourquoi** elle est faite ainsi, pour qu'un développeur qui n'a pas
participé à sa conception puisse la reprendre.

## Les documents

| Document                                                                  | Contenu                                                                                 |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [01 — Vision et périmètre](./01-vision-et-perimetre.md)                   | Le problème résolu, pour qui, ce qui est volontairement hors périmètre, les contraintes |
| [02 — Architecture](./02-architecture.md)                                 | Rôle de chaque package, cheminement d'une vignette et d'une synchronisation             |
| [03 — Modèle de données](./03-modele-de-donnees.md)                       | Tables, index, migrations, pagination par curseur                                       |
| [04 — Sécurité et accès](./04-securite-et-acces.md)                       | Les deux authentifications, sessions, contrôle d'accès média, chiffrement du token      |
| [05 — API](./05-api.md)                                                   | Inventaire exhaustif des routes                                                         |
| [06 — Configuration et déploiement](./06-configuration-et-deploiement.md) | Variables d'environnement, amorçage, Docker, `deploy/`, console Google Cloud            |
| [07 — Frontend](./07-frontend.md)                                         | Routage, état, layout justifié, virtualisation, clavier, thème                          |
| [08 — Décisions](./08-decisions/)                                         | Journal des décisions techniques et des alternatives écartées, une par fichier          |

## Par où commencer

| Ce que tu veux faire                       | Ordre de lecture                     |
| ------------------------------------------ | ------------------------------------ |
| Comprendre le projet de zéro               | 01 → 02 → 08                         |
| Ajouter ou modifier une route              | 05 → 04 → 03                         |
| Toucher au schéma SQLite                   | 03 → 02                              |
| Travailler sur la grille ou la visionneuse | 07 → 02                              |
| Déployer, diagnostiquer une panne OAuth    | 06 → 04                              |
| Changer un choix technique                 | 08 → le document du domaine concerné |

## Tenir ces documents à jour

La règle et le tableau « si tu touches X, mets à jour Y » sont dans le
[`CLAUDE.md`](../CLAUDE.md) de la racine. En résumé : la spec se met à jour dans
le même travail que le code, jamais après.
