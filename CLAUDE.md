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

Cette règle **est contrôlée**, elle ne repose pas sur la mémoire :
`pnpm check:specs` compare ce que le code expose — routes déclarées, variables
d'environnement, migrations, modules — à ce que les specs mentionnent, et échoue
sur l'écart. Il tourne dans `pnpm verify`, dans la CI, et sur `pre-push`.

Le contrôle vérifie l'**existence** d'une mention, pas sa qualité : il attrape
la route ajoutée sans un mot dans `05-api.md`, jamais un paragraphe devenu faux.
Ce dernier cas reste à ta charge — c'est d'ailleurs le plus fréquent quand on
modifie un comportement existant plutôt que d'en ajouter un.

Si un manque signalé est un faux positif — un composant trivial dont le rôle est
décrit sans que son nom apparaisse — ajoute-le à `MODULES_TOLERES` dans
`tools/check-specs.mjs`, avec la raison. Un contrôle bruyant finit désactivé.

| Si tu touches…                                                               | Mets à jour…                                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/server/src/routes/*.ts` (route, code de retour, payload)           | `specs/05-api.md`                                                              |
| `packages/shared/src/index.ts`                                               | `specs/05-api.md`, et `03` si le modèle bouge                                  |
| `packages/server/src/db.ts` (`MIGRATIONS`, index, pragmas)                   | `specs/03-modele-de-donnees.md`                                                |
| `packages/server/src/repo.ts` (curseurs, requêtes)                           | `specs/03-modele-de-donnees.md`                                                |
| `packages/server/src/comments.ts` (fils, modération)                         | `specs/03-modele-de-donnees.md`, `specs/04-securite-et-acces.md`               |
| `packages/server/src/commenters.ts` (identités, vérification par code)       | `specs/03-modele-de-donnees.md`, `specs/04-securite-et-acces.md`               |
| `packages/server/src/mail.ts` (transport, file, composition)                 | `specs/06-configuration-et-deploiement.md`, et `08` si un compromis change     |
| `packages/server/src/env.ts`, `config.ts` ou `bootstrap.ts`                  | `specs/06-configuration-et-deploiement.md`                                     |
| `packages/server/src/config-repo.ts` (comptes, albums, réglages)             | `specs/03-modele-de-donnees.md`, `specs/04-securite-et-acces.md`               |
| `Dockerfile`, `docker-compose.yml`, volumes                                  | `specs/06-configuration-et-deploiement.md`                                     |
| `deploy/` (cloud-init, `backup.sh`, `deploy.sh`)                             | `specs/06-configuration-et-deploiement.md`, et le `README.md` de la racine     |
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
pnpm check:specs                   # les specs ont-elles décroché du code ?
pnpm verify                        # les quatre d'un coup — la porte avant de publier

pnpm create-admin <identifiant>    # premier administrateur d'une base vide
pnpm reset-password <identifiant>  # mot de passe perdu : dernier recours hors /admin
pnpm hash-password                 # hash argon2id, pour un config/albums.yaml d'amorçage
pnpm --filter @gdv/server seed-demo 300   # jeu de données de démo, sans compte Drive
```

Avant de déclarer un travail terminé : **`pnpm verify`** — typecheck, lint,
tests et contrôle des specs. C'est ce que lance la CI, et `check:specs` tourne
aussi sur `pre-push` : une divergence bloque la publication avant d'atteindre
le dépôt distant.

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

## Ton de la documentation et des PR

Ce dépôt part en open source. Ce qu'on y écrit s'adresse à un inconnu, pas à
l'équipe qui l'a écrit.

**Ce qui se lit depuis GitHub est en anglais** — `README.md`, commits et pull
requests, titre compris. C'est la seule exception à la règle « français
partout » ci-dessus, et la ligne de partage est l'audience :

| En anglais                   | En français                                     |
| ---------------------------- | ----------------------------------------------- |
| `README.md`                  | `specs/` — conception, pour qui reprend le code |
| Commits, PR (titre et corps) | `CLAUDE.md` — instructions internes             |
|                              | Code, commentaires, tests, interface, journaux  |

Le `README.md` s'adresse à qui installe, souvent sans parler français ; les
`specs/` s'adressent au développeur qui reprend le projet, et restent cohérentes
avec le code et les tests. Un exemple qui apparaît des deux côtés peut donc
diverger — le README dit `photos.example.com`, les specs `photos.exemple.fr` :
c'est sans conséquence, chacun est idiomatique dans sa langue.

> **Les PR #1 à #11 ont été retitrées en anglais le 2026-08-07, mais les commits
> correspondants restent en français dans `main`.** La liste des PR et
> `git log` divergent donc sur ces onze entrées, et c'est **voulu** : les
> réaligner supposerait de réécrire l'historique de la branche principale, ce
> qui casse tous les clones existants pour un gain cosmétique. Ne pas « corriger »
> cette divergence. Elle s'éteint d'elle-même : tout ce qui est écrit à partir
> de maintenant est en anglais des deux côtés.

**Une PR dit ce qu'elle apporte ou corrige, pas ce que son auteur a vécu.**
Concrètement :

- Pas de `I`, pas de `we`, pas de récit de la session. Le sujet grammatical est
  le code, le comportement, l'utilisateur — jamais celui qui a tapé.
- **Court.** L'intention en tête, en une phrase ; le problème puis le correctif ;
  deux à quatre puces à l'échelle du sous-système. La profondeur — alternatives
  écartées, vérifications, chiffres — va dans un unique `<details>` replié.
- Pas de restitution fichier par fichier du diff : l'onglet Files le fait mieux.

**Aucun hébergeur, aucun service tiers n'est présenté comme le bon choix** (D63).
La documentation énonce ce qu'il faut obtenir ; les commandes propres à un
fournisseur vivent dans un bloc replié, à égalité avec les autres. Un composant
nommé dans le corps du texte — Tailscale, Caddy, Let's Encrypt — doit être un
choix d'architecture assumé et documenté comme remplaçable, pas une habitude.

**Rien de nominatif dans ce qui s'exécute.** Un compte système porte un rôle
(`deploy`), pas un prénom. Les identifiants d'exemple des specs et des tests
sont une autre affaire : ils restent tels quels.

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
