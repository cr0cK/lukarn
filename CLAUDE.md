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

Il vérifie en plus que chaque variable lue par `env.ts` **atteint réellement le
conteneur** — transmise par le bloc `environment:` de `docker-compose.yml`, ou
fixée par le `Dockerfile`. Être documentée ne suffit pas : Compose ne propage
pas l'environnement de l'hôte, et `.env` ne sert qu'à l'interpolation. Une
variable oubliée là est inchangeable en production tout en paraissant réglable
partout ailleurs (D78). Si tu ajoutes une variable, câble-la dans le même geste.

**Une décision est un fichier**, `specs/08-decisions/D<AAMMJJ>-<slug>.md`, et son
identifiant est la **date du jour**, pas le rang suivant : `D260809`, puis une
lettre — `b`, `c` — si le jour en porte déjà une. Le rang obligeait à connaître
le dernier numéro de `main`, qu'une branche ne voit pas des autres, et l'ajout en
fin d'un fichier unique faisait conflit à chaque fusion parallèle même quand les
numéros différaient (D260809). D1 à D99 gardent leur rang : les renommer
traverserait les trois cents renvois que le code leur adresse.

`check:specs` contrôle le format de l'identifiant, l'accord entre le titre et le
nom du fichier, l'absence de doublon toutes sources confondues, et l'absence de
renvoi `(Dxx)` — dans les specs comme dans le code — vers une décision qui
n'existe pas. Ces défauts sont arrivés (D75).

Il vérifie enfin qu'un **document de specs cité en texte** entre backticks —
`specs/05-api.md`, `08-decisions/` — désigne un fichier qui existe. Ni les liens
markdown ni les renvois `(Dxx)` ne couvrent ce cas, et un répertoire renommé y
laissait un chemin faux que rien ne signalait (D260809d). Le répertoire des
décisions en est exclu : un journal nomme ce qui a été remplacé.

`pnpm check:links` complète les précédents sur l'autre défaut silencieux : un
renvoi entre les trois documents qui ne mène plus nulle part. Il résout chaque
lien relatif et chaque ancre, et n'appelle pas le réseau — un contrôle qui
échoue parce qu'un site tiers est lent finit désactivé.

Le contrôle vérifie l'**existence** d'une mention, pas sa qualité : il attrape
la route ajoutée sans un mot dans `05-api.md`, jamais un paragraphe devenu faux.
Ce dernier cas reste à ta charge — c'est d'ailleurs le plus fréquent quand on
modifie un comportement existant plutôt que d'en ajouter un.

Si un manque signalé est un faux positif — un composant trivial dont le rôle est
décrit sans que son nom apparaisse — ajoute-le à `MODULES_TOLERES` dans
`tools/check-specs.mjs`, avec la raison. Un contrôle bruyant finit désactivé.

| Si tu touches…                                                               | Mets à jour…                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/server/src/routes/*.ts` (route, code de retour, payload)           | `specs/05-api.md`                                                               |
| `packages/shared/src/index.ts`                                               | `specs/05-api.md`, et `03` si le modèle bouge                                   |
| `packages/server/src/db.ts` (`MIGRATIONS`, index, pragmas)                   | `specs/03-modele-de-donnees.md`                                                 |
| `packages/server/src/repo.ts` (curseurs, requêtes)                           | `specs/03-modele-de-donnees.md`                                                 |
| `packages/server/src/comments.ts` (fils, modération)                         | `specs/03-modele-de-donnees.md`, `specs/04-securite-et-acces.md`                |
| `packages/server/src/commenters.ts` (identités, vérification par code)       | `specs/03-modele-de-donnees.md`, `specs/04-securite-et-acces.md`                |
| `packages/server/src/mail.ts` (transport, file, composition)                 | `specs/06-configuration-et-deploiement.md`, et `08` si un compromis change      |
| `packages/server/src/env.ts`, `config.ts` ou `bootstrap.ts`                  | `specs/06-configuration-et-deploiement.md`                                      |
| `packages/server/src/config-repo.ts` (comptes, albums, réglages)             | `specs/03-modele-de-donnees.md`, `specs/04-securite-et-acces.md`                |
| `Dockerfile`, `docker-compose.yml`, volumes                                  | `specs/06-configuration-et-deploiement.md`                                      |
| `deploy/` (cloud-init, `backup.sh`, `deploy.sh`)                             | `specs/06-configuration-et-deploiement.md`, et `deploy/README.md`               |
| `plugins/auth.ts`, `sessions.ts`, `crypto.ts`, `throttle.ts`, règles d'accès | `specs/04-securite-et-acces.md`                                                 |
| `drive/service.ts`, `drive/sync.ts`, `drive/metadata.ts`                     | `specs/02-architecture.md` (cheminement de sync)                                |
| `media/renderer.ts`, `media/cache.ts`, `media/range.ts`                      | `specs/02-architecture.md`, et `08` si un compromis change                      |
| `packages/web/src/lib/justify.ts`, `useGridLayout.ts`, composants            | `specs/07-frontend.md`                                                          |
| `packages/server/src/shell.ts` (nom d'instance, coquille, manifeste)         | `specs/05-api.md`, `specs/07-frontend.md`                                       |
| `packages/web/src/styles.css` (tokens `@theme`)                              | `specs/07-frontend.md`                                                          |
| Un compromis assumé, une alternative écartée, un « pourquoi pas X »          | `specs/08-decisions/` — **un nouveau fichier**, on ne réécrit pas les anciennes |
| Le périmètre : une fonctionnalité entre ou sort                              | `specs/01-vision-et-perimetre.md`                                               |

Cinq documentations, cinq lecteurs, aucune duplication entre elles :

| Fichier            | Lecteur                    | Répond à                                           |
| ------------------ | -------------------------- | -------------------------------------------------- |
| `README.md`        | Qui découvre le projet     | Qu'est-ce que c'est, et comment le lancer en local |
| `deploy/README.md` | Qui exploite un serveur    | Installer, mettre à jour, sauvegarder, restaurer   |
| `specs/`           | Qui reprend le code        | Pourquoi c'est fait ainsi                          |
| `CONTRIBUTING.md`  | Qui veut proposer un patch | Comment travailler ici, et ce qui sera refusé      |
| `SECURITY.md`      | Qui trouve une faille      | Où le dire, et ce qui compte comme faille          |

Le `README.md` de la racine reste **court** : ce qu'est l'application, ce qu'elle
fait, comment la lancer en local, et le tableau de liens. Toute procédure serveur va dans
`deploy/README.md`, à côté des scripts qu'elle décrit (D64).

## Commandes

```bash
pnpm install

pnpm --filter @nonni/server dev      # API sur :8080 (tsx watch)
pnpm --filter @nonni/web dev         # front sur :5173, proxy /api vers :8080
pnpm dev                           # les deux en parallèle

pnpm build                         # shared, puis web, puis server — l'ordre compte
pnpm typecheck
pnpm lint                          # eslint .
pnpm format                        # prettier --write .
pnpm test                          # runner natif de Node, tous les packages
pnpm check:format                  # prettier --check . — le formatage est-il celui du dépôt ?
pnpm check:specs                   # les specs ont-elles décroché du code ?
pnpm check:links                   # les renvois entre documents mènent-ils quelque part ?
pnpm verify                        # les six d'un coup — la porte avant de publier

pnpm create-admin <identifiant>    # premier administrateur d'une base vide
pnpm reset-password <identifiant>  # mot de passe perdu : dernier recours hors /admin
pnpm hash-password                 # hash argon2id, pour un config/albums.yaml d'amorçage
pnpm --filter @nonni/server seed-demo 300   # jeu de données de démo, sans compte Drive
```

Avant de déclarer un travail terminé : **`pnpm verify`** — typecheck, lint,
formatage, tests, contrôle des specs et contrôle des liens. C'est ce que lance
la CI, et les deux contrôles de documentation tournent aussi sur `pre-push` :
une divergence bloque la publication avant d'atteindre le dépôt distant.

`pnpm format` réécrit, `pnpm check:format` constate. Le second est dans
`verify` parce que le premier ne s'exécute que si on y pense : tant que rien ne
le vérifiait, du code non formaté atteignait `main`, et la personne suivante qui
lançait `pnpm format` reformatait au passage le travail de quelqu'un d'autre —
un diff brouillé pour un correctif qui n'était pas le sien (D75).

## Conventions de code

- **Anglais partout**, y compris ce qui l'était en français jusqu'ici :
  commentaires, messages d'erreur, libellés d'interface, noms de tests, journaux.
  Voir « Langue » plus bas : la bascule est en cours, et la règle vaut dès
  maintenant pour tout ce qu'on écrit.
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
- **Tests**, avec le runner natif de Node et `node:assert/strict`. Ils portent
  sur les invariants (cloisonnement, réversibilité des migrations, absence de
  doublon en pagination), pas sur les détails d'implémentation.
- **Formatage** : Prettier, 100 colonnes, guillemets simples, virgules finales.
- Le contrat d'API vit dans `packages/shared` ; le front ne redéclare jamais une
  forme de réponse de son côté.

## Langue

**Tout est en anglais.** Le dépôt est public sous AGPL (D260811) : le partage par
audience — anglais pour ce qui se lit depuis GitHub, français pour le reste — ne
tenait plus dès lors qu'un contributeur inconnu doit lire le code, ses
commentaires, les specs qui les expliquent, et éditer un `.env.example`. Une
seule langue, donc, et c'est celle du plus grand nombre de lecteurs possibles.

**La bascule est progressive et la règle vaut dès maintenant** : ce qu'on écrit
est en anglais, sans obligation de traduire les alentours d'un changement. Ordre
de traversée, du plus lu au moins lu :

| Lot | Périmètre                                                      | État    |
| --- | -------------------------------------------------------------- | ------- |
| 4   | Surface d'installation — voir ci-dessous                       | fait    |
| 5a  | Serveur : messages HTTP, journaux, exceptions, commandes, démo | fait    |
| 5b  | Emails, pages de désabonnement, interface (`packages/web`)     | fait    |
| 6   | Commentaires du code, noms de tests, `specs/`, ce fichier      | à faire |

**Le lot 5b ne se vérifiait pas par `pnpm verify`.** Une quinzaine de libellés
n'ont été trouvés qu'en parcourant l'application au navigateur : ils étaient
courts et sans accent (`Chargement`, `Modifier`, `Supprimer`), seuls sur leur
ligne dans du JSX, ou noyés dans un gabarit interpolé
(`` `Supprimer l'album ${album.title}` ``). Aucun grep de littéral ne les voyait,
et aucun test n'échouait. C'est aussi le navigateur qui a montré qu'un
remplacement global de `label="Identifiant"` avait posé « Username » sur le champ
**identifiant d'album**, où il ne veut rien dire.

Le lot 6 hérite d'un reliquat : les identifiants de code encore en français
(`titre` dans `SearchBox`, `Mesure`/`valeur`/`unite`/`visiteur` dans
`VisitsSection`, `elaguer`, `accord`) contredisent la règle « les identifiants
restent en anglais » depuis plus longtemps que cette bascule.

Ce qui est déjà en anglais : les deux `README.md`, `CONTRIBUTING.md`,
`SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, les gabarits et les
workflows de `.github/`, les commits et les PR, et toute la surface
d'installation — `.env.example`, `Dockerfile`, les deux `docker-compose*.yml`,
`Caddyfile`, `config/albums.example.yaml`, `deploy/` en entier, `.gitignore`,
`eslint.config.js`, `pnpm-workspace.yaml`.

Reste donc le code (`packages/`), les `specs/` et ce fichier.

Tant que la bascule n'est pas finie, un exemple peut diverger d'un document à
l'autre — les README disent `photos.example.com`, les specs encore
`photos.exemple.fr`. C'est sans conséquence : chacun est idiomatique dans sa
langue, et le lot 6 les réunira.

> **Les PR #1 à #11 ont été retitrées en anglais le 2026-08-07, mais les commits
> correspondants restent en français dans `main`.** La liste des PR et
> `git log` divergent donc sur ces onze entrées, et c'est **voulu** : les
> réaligner supposerait de réécrire l'historique de la branche principale, ce
> qui casse tous les clones existants pour un gain cosmétique. Ne pas « corriger »
> cette divergence.

## Ton de la documentation et des PR

Ce dépôt est en open source. Ce qu'on y écrit s'adresse à un inconnu, pas à
l'équipe qui l'a écrit. `CONTRIBUTING.md` dit à ce lecteur-là ce que cette page
dit à un agent : garde les deux d'accord.

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
- **`index.html` et le manifeste sont lus une fois au démarrage** (`shell.ts`,
  qui y substitue `APP_NAME`). Rebuilder le front sous un serveur qui tourne
  laisse donc servir l'ancien HTML, qui référence des bundles supprimés : page
  blanche. Redémarre. Sans objet en production comme sous `pnpm dev`.
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
