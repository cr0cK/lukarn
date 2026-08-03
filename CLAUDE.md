# CLAUDE.md

Visionneuse photos Google Drive auto-hébergée : monorepo pnpm (`shared`,
`server`, `web`), un conteneur, Fastify sert l'API et le front buildé.

La conception est documentée dans [`specs/`](./specs/). Lis
[`specs/README.md`](./specs/README.md) en premier, il donne l'ordre selon ce que
tu cherches à faire. Par défaut : `01-vision-et-perimetre` → `02-architecture` →
`08-decisions`.

## Règle de mise à jour de la documentation

**Toute évolution du comportement, de l'API, du modèle de données, de la
configuration ou d'un choix technique met à jour la spec correspondante DANS LE
MÊME travail que le code.** Une spec mise à jour « plus tard » ne l'est jamais.
Un changement de code sans changement de spec n'est pas terminé.

| Si tu touches…                                                               | Mets à jour…                                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/server/src/routes/*.ts` (route, code de retour, payload)           | `specs/05-api.md`                                                              |
| `packages/shared/src/index.ts`                                               | `specs/05-api.md`, et `03` si le modèle bouge                                  |
| `packages/server/src/db.ts` (`MIGRATIONS`, index, pragmas)                   | `specs/03-modele-de-donnees.md`                                                |
| `packages/server/src/repo.ts` (curseurs, requêtes)                           | `specs/03-modele-de-donnees.md`                                                |
| `packages/server/src/env.ts`, `config.ts` ou `bootstrap.ts`                  | `specs/06-configuration-et-deploiement.md`                                     |
| `packages/server/src/config-repo.ts` (comptes, albums, réglages)             | `specs/03-modele-de-donnees.md`, `specs/04-securite-et-acces.md`               |
| `Dockerfile`, `docker-compose.yml`, volumes                                  | `specs/06-configuration-et-deploiement.md`                                     |
| `plugins/auth.ts`, `sessions.ts`, `crypto.ts`, `throttle.ts`, règles d'accès | `specs/04-securite-et-acces.md`                                                |
| `drive/service.ts`, `drive/sync.ts`, `drive/metadata.ts`                     | `specs/02-architecture.md` (cheminement de sync)                               |
| `media/renderer.ts`, `media/cache.ts`, `media/range.ts`                      | `specs/02-architecture.md`, et `08` si un compromis change                     |
| `packages/web/src/lib/justify.ts`, `useGridLayout.ts`, composants            | `specs/07-frontend.md`                                                         |
| `packages/web/src/styles.css` (tokens `@theme`)                              | `specs/07-frontend.md`                                                         |
| Un compromis assumé, une alternative écartée, un « pourquoi pas X »          | `specs/08-decisions.md` — **nouvelle entrée**, on ne réécrit pas les anciennes |
| Le périmètre : une fonctionnalité entre ou sort                              | `specs/01-vision-et-perimetre.md`                                              |

Le `README.md` de la racine s'adresse à l'installateur (installer, exploiter,
sauvegarder). Les specs s'adressent au développeur (pourquoi c'est fait ainsi).
Ne duplique pas l'un dans l'autre.

## Commandes

```bash
pnpm install

pnpm --filter @gdv/server dev      # API sur :8080 (tsx watch)
pnpm --filter @gdv/web dev         # front sur :5173, proxy /api vers :8080
pnpm dev                           # les deux en parallèle

pnpm build                         # shared, puis web, puis server — l'ordre compte
pnpm typecheck
pnpm lint                          # eslint .
pnpm format                        # prettier --write .
pnpm test                          # runner natif de Node, tous les packages

pnpm create-admin <identifiant>    # premier administrateur d'une base vide
pnpm reset-password <identifiant>  # mot de passe perdu : dernier recours hors /admin
pnpm hash-password                 # hash argon2id, pour un config/albums.yaml d'amorçage
pnpm --filter @gdv/server seed-demo 300   # jeu de données de démo, sans compte Drive
```

Avant de déclarer un travail terminé : `pnpm typecheck && pnpm lint && pnpm test`.

## Conventions de code

- **Français partout** : commentaires, messages d'erreur, libellés d'interface,
  noms de tests, journaux. Les identifiants de code restent en anglais.
- **Les commentaires expliquent le pourquoi, jamais le quoi.** Un commentaire qui
  paraphrase la ligne suivante est à supprimer. Le bon commentaire dit ce qui
  casserait si on faisait autrement — c'est le style en vigueur dans tout le
  dépôt, reprends-le.
- **TypeScript strict**, avec `noUncheckedIndexedAccess`. Les `!` sont autorisés
  après une vérification que le compilateur ne peut pas suivre (accès indexé,
  paramètres de route Fastify) ; `@typescript-eslint/no-non-null-assertion` est
  désactivé pour ça.
- **JSDoc sur les exports** : chaque fonction, classe et type exporté porte une
  phrase qui dit son rôle et, si utile, sa raison d'être.
- **Tests en français**, avec le runner natif de Node et `node:assert/strict`.
  Ils portent sur les invariants (cloisonnement, réversibilité des migrations,
  absence de doublon en pagination), pas sur les détails d'implémentation.
- **Formatage** : Prettier, 100 colonnes, guillemets simples, virgules finales.
- Le contrat d'API vit dans `packages/shared` ; le front ne redéclare jamais une
  forme de réponse de son côté.

## Pièges à connaître

- **Le serveur inventorie le cache disque au démarrage** (`MediaCache.load()`).
  Un fichier déposé dans `CACHE_DIR` pendant que le serveur tourne est invisible
  jusqu'au redémarrage — c'est pour ça que `seed-demo` demande de redémarrer.
- **`PUBLIC_URL` doit correspondre exactement à l'URI de redirection déclarée
  dans Google Cloud** (`PUBLIC_URL + /api/oauth/callback`). Un `/` final, `http`
  au lieu de `https`, un `www.` en trop : `redirect_uri_mismatch`. `PUBLIC_URL`
  décide aussi si les cookies sont `secure`.
- **Ne jamais modifier une migration déjà publiée.** Les instances en service
  l'ont déjà exécutée ; la retoucher fait diverger le schéma réel du schéma
  supposé. Ajoute une entrée à la fin de `MIGRATIONS`.
- **Les dates sont stockées et affichées en UTC**, parce que `taken_at`
  représente l'heure de l'appareil au déclenchement, lue d'un EXIF sans fuseau.
  Toute date affichée passe par `packages/web/src/lib/format.ts`, dont tous les
  formateurs sont en `timeZone: 'UTC'`. Réafficher dans le fuseau local
  décalerait la photo et ferait basculer de mois les prises de vue de fin de mois.
- **La base fait autorité pour les comptes, les albums et les réglages.**
  `config/albums.yaml` n'est lu que tant qu'aucun compte n'existe (amorçage d'une
  installation neuve ou mise à jour d'une instance en service) ; ensuite il est
  ignoré. Toute écriture passe par `ConfigRepo`, qui tient un instantané mémoire
  — un `UPDATE` direct sur ces tables, **dans le même processus**, servirait un
  état périmé. Depuis un autre processus (les commandes en ligne), c'est sans
  danger : `read()` surveille `PRAGMA data_version`, qui ne bouge que pour les
  écritures venues d'ailleurs, et reconstruit l'instantané le cas échéant.
- **Le contrôle d'accès média est un `preHandler` de préfixe** dans
  `routes/media.ts`. Une nouvelle route média en hérite automatiquement — ne la
  monte pas ailleurs.
- **Un refus d'accès répond 404, jamais 403** (albums et médias). Seul
  `/api/admin/*` répond 403.
- **`better-sqlite3` est synchrone** : garde les requêtes indexées et bornées.
- **`threadpool.ts` doit rester le premier import de `main.ts`.** Node fixe la
  taille du pool de libuv au premier usage de celui-ci, et en ESM tous les
  imports sont évalués avant le corps du module : un seul import qui ouvrirait un
  fichier avant lui figerait la valeur par défaut. Mesuré : avec quatre fils, une
  vignette déjà en cache met 2 s à être servie pendant des rendus (D32).
- **Le décodage d'images est bridé** (`media/semaphore.ts`). N'appelle pas sharp
  hors de `MediaRenderer` sans passer par ce limiteur : c'est lui qui empêche une
  grille à froid de faire tripler la mémoire du processus.
- **Ordre de build imposé** : `shared` avant `web` avant `server`.
