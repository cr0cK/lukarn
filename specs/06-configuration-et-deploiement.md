# 06 — Configuration et déploiement

Deux sources de configuration, deux natures :

- **`.env`** — secrets et chemins, lus au démarrage, jamais rechargés à chaud.
- **La base** — comptes, albums, droits et réglages, administrés depuis
  `/admin`, appliqués sans redémarrage. `config/albums.yaml` ne sert plus qu'à
  **amorcer** une installation neuve.

## Variables d'environnement — `packages/server/src/env.ts`

Schéma zod ; une valeur invalide empêche le démarrage avec un message qui nomme
la variable et le problème.

| Variable                      | Défaut                                        | Rôle et conséquence d'une erreur                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                    | `development`                                 | `development` active `pino-pretty`. Valeurs admises : `development`, `production`, `test`.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `PORT`                        | `8080`                                        | Entier positif.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `HOST`                        | `0.0.0.0`                                     | En conteneur, `127.0.0.1` rendrait l'app injoignable depuis l'hôte.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `PUBLIC_URL`                  | `http://localhost:8080`                       | URL valide obligatoire. Les `/` finaux sont retirés. **Sert à deux choses : construire l'URI de redirection OAuth, et décider si les cookies sont `secure`.** Une valeur fausse casse le consentement (`redirect_uri_mismatch`) ou, en HTTPS mal déclaré, empêche le cookie de revenir.                                                                                                                                                                                                                                                                  |
| `SESSION_SECRET`              | —                                             | **Obligatoire**, ≥ 32 caractères. Signe les cookies. Le changer déconnecte tout le monde.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `TOKEN_KEY`                   | —                                             | **Obligatoire**, ≥ 32 caractères. Chiffre le refresh token. Le changer rend le jeton stocké illisible : il est supprimé et il faut refaire le consentement.                                                                                                                                                                                                                                                                                                                                                                                              |
| `GOOGLE_CLIENT_ID`            | absent                                        | Optionnel, mais **indissociable** de `GOOGLE_CLIENT_SECRET` : n'en renseigner qu'un fait échouer le démarrage. Sans les deux, l'app tourne et sert l'index existant, `/admin` affiche « non configuré ».                                                                                                                                                                                                                                                                                                                                                 |
| `GOOGLE_CLIENT_SECRET`        | absent                                        | Idem.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | absent                                        | Optionnel. Chemin de la clé JSON d'un compte de service. Renseignée, elle **prend le pas** sur `GOOGLE_CLIENT_*` : plus de consentement, plus de refresh token, plus d'écran « Google n'a pas validé cette application ». Chaque dossier d'album doit alors être partagé en lecture avec l'adresse du compte de service. Un fichier absent ou mal formé **arrête le démarrage** plutôt que de retomber sur OAuth. Voir [04](./04-securite-et-acces.md) et D46.                                                                                           |
| `SMTP_URL`                    | absent                                        | Optionnel, **indissociable** de `MAIL_FROM`. URL du relais : `smtp://utilisateur:motdepasse@hote:587` ou `smtps://…` pour du TLS implicite. Absent ⇒ **les commentaires sont indisponibles** : le code de vérification d'adresse ne peut pas partir, donc personne ne peut s'identifier. L'interface le dit au lieu d'offrir un formulaire condamné. **L'annonce des nouvelles photos ne part pas non plus**, et le notifieur ne touche alors à rien — le jour où un relais est configuré, son premier passage pose la borne sans annoncer l'historique. |
| `MAIL_FROM`                   | absent                                        | Expéditeur des notifications, par exemple `Galerie <galerie@exemple.fr>`. Beaucoup de relais imposent une adresse qu'ils autorisent.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `CONFIG_PATH`                 | `./config/albums.yaml`                        | Fichier d'**amorçage**, résolu depuis le répertoire du `.env`, pas depuis le cwd (voir plus bas). Absent ⇒ le serveur démarre quand même ; s'il n'y a aucun compte en base, il dit comment créer le premier administrateur.                                                                                                                                                                                                                                                                                                                              |
| `DATA_DIR`                    | `./data`                                      | Contient `gdv.db`. Créé s'il manque. **La seule donnée irremplaçable.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `CACHE_DIR`                   | `./cache`                                     | Dérivés WebP. Régénérable — le supprimer ne coûte que du CPU.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `WEB_DIR`                     | `packages/web/dist`, calculé depuis le module | Front buildé. Absent ⇒ seule l'API est servie, avec un avertissement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `LOG_LEVEL`                   | `info`                                        | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `UV_THREADPOOL_SIZE`          | `16`, posé par le serveur s'il manque         | Taille du pool de fils de libuv, partagé entre le décodage d'images, les lectures de fichiers et argon2. Le défaut de Node (4) fait attendre une vignette déjà en cache derrière quelques rendus — mesuré à 2 s au 95e centile (D32). Une valeur présente dans l'environnement fait autorité.                                                                                                                                                                                                                                                            |

Dérivé, non configurable : `oauthRedirectUri = PUBLIC_URL + '/api/oauth/callback'`.

**Les variables qui vont par paire échouent au démarrage si une seule est
donnée** — `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` comme `SMTP_URL`/`MAIL_FROM`.
Une instance configurée avec un relais mais sans expéditeur ne se manifesterait
qu'au premier commentaire posté, des semaines après la mise en service.

**Les notifications ne bloquent jamais une requête.** Poster un commentaire
répond dès que la ligne est écrite ; les emails partent ensuite, sur une file
sérialisée (`mail.ts`). Un échec d'envoi est **journalisé et abandonné**, sans
réessai : une notification manquée est un désagrément, un rejet non géré en tâche
de fond terminerait le process — même précaution que pour l'éviction du cache
disque. `PUBLIC_URL` sert à construire les liens des emails : mal renseignée,
elle produit des notifications qui ne mènent nulle part.

**Trois sortes d'emails partent d'une instance** : le code de vérification
d'adresse, la notification d'un nouveau commentaire, et l'annonce des nouvelles
photos d'un album. Cette dernière est déclenchée par le **ménage horaire** de
`main.ts` (`notifier.ts`), pas par la fin d'une synchronisation : avec une sync
toutes les demi-heures écrivant par lots, verser deux cents photos enverrait une
dizaine d'emails dans la journée. Un album n'est annonçable que si sa dernière
synchronisation **réussie** est calme depuis une heure ; le délai entre l'arrivée
des photos et l'email est donc de une à deux heures.

**Résolution des chemins relatifs.** `loadDotEnv()` (`src/dotenv.ts`) remonte
l'arborescence depuis le cwd **puis** depuis le module pour trouver un `.env`, et
`loadEnv` prend le répertoire de ce fichier comme racine des chemins relatifs.
Conséquence utile : un script lancé depuis `packages/server` vise les mêmes
fichiers que le serveur lancé depuis la racine. L'absence de `.env` n'est pas une
erreur — en conteneur, tout vient de l'environnement.

## `config/albums.yaml` — amorçage seulement

Modèle commenté dans `config/albums.example.yaml`. Le fichier n'est pas suivi par
git. Il est lu par `packages/server/src/config.ts`, mais **uniquement tant
qu'aucun compte n'existe en base** (`bootstrap.ts`) :

| Base    | Fichier    | Ce qui se passe                                                                                      |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| vide    | présent    | Comptes, albums, droits et réglages sont importés en une transaction, puis le fichier n'est plus lu. |
| vide    | absent     | Le serveur démarre, journalise `pnpm create-admin <identifiant>`, et l'écran de connexion l'affiche. |
| vide    | invalide   | **Refus de démarrer**, avec l'erreur de validation : démarrer sans aucun compte serait inutilisable. |
| peuplée | quelconque | Le fichier est ignoré. Le modifier ne fait plus rien — c'est `/admin` qui administre.                |

C'est aussi le chemin de mise à jour d'une instance en service : au premier
démarrage après la migration, sa configuration est reprise telle quelle. Ni
réindexation, ni nouveau consentement Google, ni perte d'accès —
`packages/server/test/bootstrap.test.ts` le verrouille.

Le cas « base vide, pas de fichier » demande un signal visible : le serveur
répond normalement mais refuse toute connexion, ce qui se lit comme une panne
alors qu'il ne manque qu'une commande. `GET /api/auth/setup-state` — publique,
puisque interrogée avant toute connexion — répond `{ needsSetup }`, et l'écran
de connexion affiche alors la commande à lancer. Elle ne divulgue rien : sur une
instance sans compte il n'y a rien à protéger, et elle ne dit jamais **qui**
existe (`packages/server/test/setup-state.test.ts`).

Le schéma ci-dessous est donc figé sur ce que les installations existantes ont pu
écrire ; les évolutions de la configuration se font dans `ConfigRepo` et
l'API d'administration, pas ici.

### `users[]`

| Champ          | Type    | Défaut  | Contrainte                                                                                        |
| -------------- | ------- | ------- | ------------------------------------------------------------------------------------------------- |
| `username`     | chaîne  | —       | 1–64 caractères, `^[a-z0-9][a-z0-9._-]*$` (casse indifférente). Doublons refusés, casse comprise. |
| `passwordHash` | chaîne  | —       | Doit commencer par `$argon2`. Produit par `pnpm hash-password`.                                   |
| `admin`        | booléen | `false` | Ouvre `/api/admin/*` et le callback OAuth. N'accorde **aucun** album au passage.                  |
| `albums`       | tableau | `[]`    | Ids d'albums, ou `["*"]` pour tous. Un id inconnu fait échouer le chargement.                     |

### `albums[]`

| Champ         | Type    | Défaut | Contrainte                                                                                                                                                       |
| ------------- | ------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | chaîne  | —      | Même format que `username`. Doublons refusés. Sert dans les URL et comme `album_id` en base.                                                                     |
| `title`       | chaîne  | —      | Non vide. Affiché.                                                                                                                                               |
| `description` | chaîne  | absent | Optionnelle.                                                                                                                                                     |
| `folderId`    | chaîne  | —      | Non vide. Le segment après `/folders/` dans l'URL Drive — **pas un chemin**, l'API Drive ne connaît que des identifiants. Survit aux renommages et déplacements. |
| `recursive`   | booléen | `true` | Descendre dans les sous-dossiers. `false` n'indexe que la racine du dossier.                                                                                     |

### `sync` et `cache`

| Champ                  | Défaut | Effet                                                                                  |
| ---------------------- | ------ | -------------------------------------------------------------------------------------- |
| `sync.intervalMinutes` | `30`   | Entier ≥ 0. `0` désactive la resynchronisation périodique ; `/admin` reste disponible. |
| `sync.onStartup`       | `true` | Synchroniser tous les albums au démarrage, sans bloquer l'écoute HTTP.                 |
| `cache.maxSizeGB`      | `20`   | Nombre > 0. Au-delà, éviction LRU jusqu'à 90 % de la limite.                           |

### Erreurs de validation

Le chargement rassemble toutes les erreurs zod en un message multiligne préfixé
du chemin (`users.1.albums.0: album inconnu : "fantome"`). Trois vérifications
custom vont au-delà du schéma : ids d'albums en double, identifiants en double
(insensibles à la casse), et référence à un album inexistant — presque toujours
une faute de frappe qui priverait silencieusement quelqu'un de son accès.

## Administration à chaud

Tout se fait par `/api/admin/*` (voir [05](./05-api.md)), sans redémarrage et
sans fichier. `POST /api/admin/reload` et `AppContext.reloadConfig()` ont disparu
avec le fichier qu'ils relisaient.

| Changement            | Effet immédiat                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| Compte, droits, rôle  | Relus à chaque requête par `plugins/auth.ts` et `canSee()`.                                                 |
| Album créé/supprimé   | Suppression : ses médias et son `sync_state` partent avec lui.                                              |
| `folderId` modifié    | L'index de l'album est vidé et une resynchronisation démarre si Drive est connecté.                         |
| `cacheMaxSizeGB`      | `MediaCache.setMaxBytes()`, avec éviction immédiate si la limite baisse.                                    |
| `syncIntervalMinutes` | `startScheduler` réarme son minuteur ; réarmer à valeur égale est évité, ça repousserait la synchro.        |
| `syncOnStartup`       | N'a de sens qu'au démarrage — mais il est lu en base, donc pris en compte au suivant.                       |
| `prewarmCache`        | Relu à chaque photo par `media/prewarm.ts` : décocher arrête le passage en cours, pas seulement le suivant. |

## Dockerfile — trois étapes

`Dockerfile`, base `node:24-slim`, pnpm par corepack.

1. **`builder`** — installe `python3 make g++` (nécessaires si `better-sqlite3`,
   `argon2` ou `sharp` n'ont pas de binaire prébuilt pour la plateforme), copie
   **d'abord les manifestes seuls** pour que Docker réutilise le cache de
   `pnpm install` tant qu'ils ne bougent pas, puis les sources, puis `pnpm build`.
2. **`deps`** — même installation en `--prod`, sans les sources : c'est
   l'arborescence `node_modules` que l'image finale embarquera.
3. **`runtime`** — pas de compilateur. Copie `node_modules` et `packages/`
   depuis `deps`, puis les trois `dist/` depuis `builder`. Crée
   `/app/{data,cache,config}` et les donne à `node` **avant** le montage des
   volumes, sinon ils appartiendraient à root. Tourne en `USER node`.

`tini` en `ENTRYPOINT` : relaie `SIGTERM` pour que l'arrêt gracieux de `main.ts`
(fermeture des minuteurs, du serveur et de la base) se déclenche réellement, et
récolte les zombies. Le `HEALTHCHECK` interroge `/api/health` toutes les 30 s.

Le cache pnpm est monté en `--mount=type=cache`, donc il n'entre pas dans les
couches de l'image.

## docker-compose et volumes

`docker-compose.yml` expose un service, sur **`127.0.0.1:8080` seulement** : le
TLS et l'accès public relèvent d'un reverse-proxy (Caddy, nginx, Traefik) sur le
VPS. Retirer le préfixe `127.0.0.1:` joint l'app directement, sans HTTPS.

`PUBLIC_URL`, `SESSION_SECRET` et `TOKEN_KEY` sont déclarés avec la syntaxe
`${VAR:?message}` : compose refuse de démarrer s'ils manquent, avec le message
qui dit quoi faire.

| Montage                   | Contenu                                                                                                                          | Sauvegarde                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `./config:/app/config:ro` | `albums.yaml` d'amorçage, et la clé du compte de service si l'instance en utilise une. Lecture seule : l'app n'écrit jamais ici. | **Oui, si la clé y est** — sinon inutile après l'amorçage |
| `gdv-data`                | `gdv.db` — **comptes, albums, réglages**, index, sessions, refresh token chiffré                                                 | **Oui. C'est la seule donnée irremplaçable.**             |
| `gdv-cache`               | Dérivés WebP                                                                                                                     | Non — régénérable à la demande                            |

Sauvegarder `gdv-data` ne suffit pas seul : sans `TOKEN_KEY`, le refresh token
qu'il contient est indéchiffrable. Sauvegarde le `.env` avec.

Les logs sont plafonnés (`json-file`, 10 Mo × 3).

## Configuration côté Google Cloud

Dans un **projet dédié** : l'écran de consentement est unique par projet et porte
le nom affiché, les scopes et le statut de publication ; y loger plusieurs
applications les mélange dans une même demande d'autorisation.

1. **API et services → Bibliothèque** : activer **Google Drive API**.
2. **Écran de consentement OAuth** : type **Externe**, nom d'application, adresse
   d'assistance.
3. **Publier l'application.** Étape indispensable : tant qu'elle reste en statut
   « Test », **Google fait expirer le refresh token au bout de 7 jours** et il
   faut se reconnecter chaque semaine. C'est aussi l'une des causes possibles de
   l'`invalid_grant` que détecte `DriveService` (voir
   [04](./04-securite-et-acces.md)).

   Publier ne déclenche aucune procédure de vérification tant qu'on ne la demande
   pas : l'application reste « publiée, non vérifiée », plafonnée à
   100 utilisateurs. Seule conséquence visible : au moment du consentement, un
   écran « Google n'a pas validé cette application », à passer par **Paramètres
   avancés → Accéder à**. Une seule fois, et pour le propriétaire uniquement.
   (Avec Google Workspace, le type « Interne » évite cet écran ; il n'est pas
   proposé aux adresses `gmail.com`.)

4. **Identifiants → Créer → ID client OAuth**, type **Application Web**.
5. Dans « URI de redirection autorisés », ajouter **exactement** `PUBLIC_URL`
   suivi de `/api/oauth/callback`. Un caractère de différence — `http` au lieu de
   `https`, un `/` final, `www.` en trop — donne un `redirect_uri_mismatch` au
   moment du consentement.

## Scripts

| Commande                                           | Effet                                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm create-admin <identifiant> [mot de passe]`   | Crée le premier administrateur **en base**, avec le joker sur les albums — `admin` seul n'accorde aucun album, et il faut bien qu'il voie ceux qu'il va créer. Seule porte d'entrée quand il n'y a ni compte ni fichier d'amorçage. Refuse un identifiant déjà pris.   |
| `pnpm reset-password <identifiant> [mot de passe]` | Remplace le mot de passe d'un compte existant et ferme ses sessions ouvertes. Traite le seul cas que l'application ne peut pas régler seule : l'unique administrateur a perdu le sien et ne peut plus atteindre `/admin`. Pour tout autre compte, passer par `/admin`. |
| `pnpm hash-password`                               | Demande un mot de passe sans l'afficher et imprime la ligne `passwordHash:` à coller. Ne sert plus qu'à préparer un `albums.yaml` d'amorçage. Un argument est accepté mais laisse une trace dans l'historique du shell.                                                |
| `pnpm --filter @gdv/server seed-demo [nombre]`     | Remplit l'index **et** le cache avec des médias générés localement, pour travailler l'interface sans compte Drive. Défaut : 240 par album.                                                                                                                             |

`seed-demo` insère dans **tous** les albums de la base et écrit les cinq variantes
en cache (`t320`, `t640`, `t1280`, `full`, `hd`) pour que le pipeline ne cherche
jamais à joindre Drive. Deux avertissements : il faut **redémarrer le
serveur** ensuite, puisque le cache n'est inventorié qu'au démarrage ; et il ne
faut pas le lancer sur une instance réelle — la prochaine synchronisation
supprimerait ces entrées, mais elles pollueraient les albums entre-temps.

## Vérifications

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Les tests serveur tournent avec le runner natif de Node (`node --import tsx
--test`) : pas de framework de test dans les dépendances.

### Voir les emails pour de vrai

Les tests vérifient ce que `buildCommentMail`, `buildAlbumUpdateMail` et
`buildVerificationMail` composent — sujet, liens, échappement. Ils ne disent
rien du rendu dans un client, ni de l'encodage MIME des accents, qui ne se
constatent qu'après un envoi. Un relais bouchon suffit :

```bash
docker run -d --rm --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit
# puis, dans .env : SMTP_URL=smtp://localhost:1025 et MAIL_FROM=Galerie <galerie@exemple.fr>
```

Mailpit accepte tout, ne relaie rien et rend les messages sur
`http://localhost:8025`. C'est le seul moyen d'essayer les emails sans envoyer
de courrier à une vraie adresse, et sans faire dépendre un test d'un relais
distant.
