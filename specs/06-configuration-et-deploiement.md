# 06 — Configuration et déploiement

Deux sources de configuration, deux natures :

- **`.env`** — secrets et chemins, lus au démarrage, jamais rechargés à chaud.
- **La base** — comptes, albums, droits et réglages, administrés depuis
  `/admin`, appliqués sans redémarrage. `config/albums.yaml` ne sert plus qu'à
  **amorcer** une installation neuve.

## Variables d'environnement — `packages/server/src/env.ts`

Schéma zod ; une valeur invalide empêche le démarrage avec un message qui nomme
la variable et le problème.

Déclarer une variable ici ne la rend pas réglable pour autant : sous Docker, elle
n'atteint le processus que si le bloc `environment:` de `docker-compose.yml` la
transmet ou si le `Dockerfile` la fixe. Compose ne propage pas l'environnement de
l'hôte, et le `.env` ne sert qu'à l'interpolation. `check:specs` compare donc le
schéma à ces deux fichiers et échoue sur l'oubli, parce qu'il s'est déjà produit
sans que rien ne le signale (D78).

| Variable                      | Défaut                                        | Rôle et conséquence d'une erreur                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                    | `development`                                 | `development` active `pino-pretty`. Valeurs admises : `development`, `production`, `test`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `PORT`                        | `8080`                                        | Entier positif.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `HOST`                        | `0.0.0.0`                                     | En conteneur, `127.0.0.1` rendrait l'app injoignable depuis l'hôte.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `PUBLIC_URL`                  | `http://localhost:8080`                       | URL valide obligatoire. Les `/` finaux sont retirés. **Sert à quatre choses : construire l'URI de redirection OAuth, décider si les cookies sont `secure`, décider si `Strict-Transport-Security` est posé, et — en production — donner à Caddy le domaine dont il obtient le certificat.** Une valeur fausse casse le consentement (`redirect_uri_mismatch`) ou, en HTTPS mal déclaré, empêche le cookie de revenir. Le `Caddyfile` la lit directement (`{$PUBLIC_URL}`) : le domaine servi et le domaine déclaré ne peuvent donc pas diverger.                                                                                                                                                                                                                                                                                                                                                         |
| `APP_NAME`                    | `Photos`                                      | Nom de l'instance. Il apparaît dans le titre de l'onglet, sur l'écran de connexion, et surtout **sous l'icône une fois l'application posée sur un écran d'accueil**. Le serveur le substitue au démarrage dans `index.html` et dans le manifeste (`shell.ts`), donc un redémarrage suffit à le changer — pas un rebuild, ce qui compte quand une seule image sert toutes les installations. Court de préférence : Android tronque au-delà d'une douzaine de caractères sous l'icône. Vide ⇒ refus de démarrer, pour ne pas afficher une application sans nom.                                                                                                                                                                                                                                                                                                                                            |
| `SESSION_SECRET`              | —                                             | **Obligatoire**, ≥ 32 caractères. Signe les cookies. Le changer déconnecte tout le monde.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `TOKEN_KEY`                   | —                                             | **Obligatoire**, ≥ 32 caractères. Chiffre le refresh token. Le changer rend le jeton stocké illisible : il est supprimé et il faut refaire le consentement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GOOGLE_CLIENT_ID`            | absent                                        | Optionnel, mais **indissociable** de `GOOGLE_CLIENT_SECRET` : n'en renseigner qu'un fait échouer le démarrage. Sans les deux, l'app tourne et sert l'index existant, `/admin` affiche « non configuré ».                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `GOOGLE_CLIENT_SECRET`        | absent                                        | Idem.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | absent                                        | Optionnel. Chemin de la clé JSON d'un compte de service. Renseignée, elle **prend le pas** sur `GOOGLE_CLIENT_*` : plus de consentement, plus de refresh token, plus d'écran « Google n'a pas validé cette application ». Chaque dossier d'album doit alors être partagé en lecture avec l'adresse du compte de service. Un fichier absent ou mal formé **arrête le démarrage** plutôt que de retomber sur OAuth. Voir [04](./04-securite-et-acces.md) et D46.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `SMTP_URL`                    | absent                                        | Optionnel, **indissociable** de `MAIL_FROM`. URL du relais : `smtp://utilisateur:motdepasse@hote:587` ou `smtps://…` pour du TLS implicite. Contrôlée au démarrage (`new URL`, schéma `smtp`/`smtps`, hôte présent) : un mot de passe contenant `/`, `?` ou `#` non encodé coupe l'adresse au milieu des identifiants, et nodemailer construirait alors sans broncher un transport vers un hôte qui est en fait le nom d'utilisateur — l'instance démarre, et n'échoue qu'au premier envoi. Absent ⇒ **les commentaires sont indisponibles** : le code de vérification d'adresse ne peut pas partir, donc personne ne peut s'identifier. L'interface le dit au lieu d'offrir un formulaire condamné. **L'annonce des nouvelles photos ne part pas non plus**, et le notifieur ne touche alors à rien — le jour où un relais est configuré, son premier passage pose la borne sans annoncer l'historique. |
| `MAIL_FROM`                   | absent                                        | Expéditeur des notifications, par exemple `Galerie <galerie@exemple.fr>`. Beaucoup de relais imposent une adresse qu'ils autorisent — c'est celle que SPF et DKIM signent, et en changer pour récupérer les réponses envoie les messages en indésirable. La forme est contrôlée au démarrage (`Nom <adresse>` ou `adresse` nue) : un chevron non refermé partirait tel quel dans l'en-tête.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `MAIL_REPLY_TO`               | absent                                        | Optionnel, et indépendant des deux précédentes : adresse portée par l'en-tête `Reply-To`. Un relais transactionnel n'a **pas** de boîte de réception, et le domaine d'envoi n'en a pas forcément une — répondre à une notification part alors dans le vide ou rebondit, sans que l'instance en sache rien. Même contrôle de forme que `MAIL_FROM`. Absente, aucun `Reply-To` n'est posé et une réponse suit `MAIL_FROM` : c'est le bon réglage quand cette adresse reçoit son courrier. Renseignée sans relais, ou désignant la même adresse que `MAIL_FROM`, elle est inopérante : le démarrage l'**avertit** sans échouer. Voir D81.                                                                                                                                                                                                                                                                   |
| `GEOCODING_URL`               | `https://nominatim.openstreetmap.org`         | Racine du service de géocodage inverse, qui donne un nom aux coordonnées EXIF des photos. **Une chaîne vide le désactive** : les journées gardent leurs grappes de positions, simplement sans libellé, et le reste de l'application est inchangé. Une instance Nominatim privée se met ici. Le `User-Agent` envoyé est dérivé de `PUBLIC_URL`, comme l'exige la politique d'usage de l'instance publique — elle plafonne aussi à **une requête par seconde**, ce que le passage de fond respecte (voir [02](./02-architecture.md) et D48). Une URL invalide arrête le démarrage plutôt que de laisser un géocodage échouer silencieusement pendant des mois.                                                                                                                                                                                                                                             |
| `CONFIG_PATH`                 | `./config/albums.yaml`                        | Fichier d'**amorçage**, résolu depuis le répertoire du `.env`, pas depuis le cwd (voir plus bas). Absent ⇒ le serveur démarre quand même ; s'il n'y a aucun compte en base, il dit comment créer le premier administrateur.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `DATA_DIR`                    | `./data`                                      | Contient `gdv.db`. Créé s'il manque. **La seule donnée irremplaçable.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `CACHE_DIR`                   | `./cache`                                     | Dérivés WebP à la racine, vidéos préparées sous `CACHE_DIR/video` — deux magasins, deux budgets, deux LRU indépendants (D260809b). Régénérable, mais pas au même prix : quelques secondes de CPU par vignette, plusieurs minutes par vidéo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `WEB_DIR`                     | `packages/web/dist`, calculé depuis le module | Front buildé. Absent ⇒ seule l'API est servie, avec un avertissement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `LOG_LEVEL`                   | `info`                                        | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `UV_THREADPOOL_SIZE`          | `16`, posé par le serveur s'il manque         | Taille du pool de fils de libuv, partagé entre le décodage d'images, les lectures de fichiers et argon2. Le défaut de Node (4) fait attendre une vignette déjà en cache derrière quelques rendus — mesuré à 2 s au 95e centile (D32). Une valeur présente dans l'environnement fait autorité.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

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

**Le mail de code fait exception aux deux autres.** Son sujet nomme l'hôte de
`PUBLIC_URL` et **jamais le code** ([D65](./08-decisions.md)), et il ne porte
aucun lien cliquable : l'hôte y figure en texte seulement, parce qu'un lien
ouvrirait une seconde session dans un autre navigateur alors que le code est
attendu dans l'onglet resté ouvert. Le corps rappelle le geste qui a déclenché
l'envoi — renseigner cette adresse sur cet hôte — pour que la destinataire
sache d'où vient ce message sans avoir à le deviner.

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

| Champ         | Type    | Défaut  | Contrainte                                                                                                                                                                               |
| ------------- | ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | chaîne  | —       | Même format que `username`. Doublons refusés. Sert dans les URL et comme `album_id` en base.                                                                                             |
| `title`       | chaîne  | —       | Non vide. Affiché.                                                                                                                                                                       |
| `description` | chaîne  | absent  | Optionnelle.                                                                                                                                                                             |
| `folderId`    | chaîne  | —       | Non vide. Le segment après `/folders/` dans l'URL Drive — **pas un chemin**, l'API Drive ne connaît que des identifiants. Survit aux renommages et déplacements.                         |
| `recursive`   | booléen | `true`  | Descendre dans les sous-dossiers. `false` n'indexe que la racine du dossier.                                                                                                             |
| `groupBy`     | chaîne  | `month` | `month` ou `day` : découpage de la grille à l'ouverture. `day` convient à un séjour, et c'est le seul découpage où les notes de journée s'affichent. Modifiable ensuite depuis `/admin`. |

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
| `videoCacheMaxSizeGB` | Idem sur le magasin des vidéos préparées, qui a son propre budget.                                          |
| `syncIntervalMinutes` | `startScheduler` réarme son minuteur ; réarmer à valeur égale est évité, ça repousserait la synchro.        |
| `syncOnStartup`       | N'a de sens qu'au démarrage — mais il est lu en base, donc pris en compte au suivant.                       |
| `prewarmCache`        | Relu à chaque photo par `media/prewarm.ts` : décocher arrête le passage en cours, pas seulement le suivant. |
| `transcodeVideos`     | Relu à chaque vidéo par `media/transcode.ts`, de la même façon. Sans effet si `ffmpeg` manque.              |

## Dockerfile — trois étapes

`Dockerfile`, base `node:24-slim`, pnpm par corepack.

1. **`builder`** — installe `python3 make g++` (nécessaires si `better-sqlite3`,
   `argon2` ou `sharp` n'ont pas de binaire prébuilt pour la plateforme), copie
   **d'abord les manifestes seuls** pour que Docker réutilise le cache de
   `pnpm install` tant qu'ils ne bougent pas, puis les sources, puis `pnpm build`.
2. **`deps`** — même installation en `--prod`, sans les sources : c'est
   l'arborescence `node_modules` que l'image finale embarquera.
3. **`runtime`** — pas de compilateur, mais `ffmpeg`. Copie `node_modules` et
   `packages/` depuis `deps`, puis les trois `dist/` depuis `builder`. Crée
   `/app/{data,cache,config}` et les donne à `node` **avant** le montage des
   volumes, sinon ils appartiendraient à root. Tourne en `USER node`.

**`ffmpeg` fait grossir l'image d'environ 250 Mo**, et c'est de loin la plus
grosse dépendance système de l'application. C'est le prix d'entrée du
transcodage des vidéos HEVC (D260809b), et il est dit tel quel plutôt que découvert
au premier `docker pull`. L'alternative — une image sans lui, et un paquet à
installer à la main — remettrait à chaque exploitant une étape que rien ne
signale tant qu'on n'a pas de vidéo HEVC dans sa bibliothèque.

Sans `ffmpeg`, le serveur démarre normalement : il l'annonce dans son journal,
la préparation reste inerte, et les vidéos concernées gardent le message et le
bouton **Télécharger** de D79.

`tini` en `ENTRYPOINT` : relaie `SIGTERM` pour que l'arrêt gracieux de `main.ts`
(fermeture des minuteurs, du serveur et de la base) se déclenche réellement, et
récolte les zombies. Le `HEALTHCHECK` interroge `/api/health` toutes les 30 s.

Le cache pnpm est monté en `--mount=type=cache`, donc il n'entre pas dans les
couches de l'image.

## docker-compose et volumes

`docker-compose.yml` déclare **deux services** :

- **`app`** — l'application. Elle ne publie **aucun port sur l'hôte** (`expose`
  et non `ports`) : elle n'est joignable que par le réseau interne du compose.
  Rien de l'application n'écoute sur une interface publique.
- **`caddy`** — `caddy:2-alpine`, seul à publier 80, 443 et 443/udp. Il termine
  le TLS, obtient et renouvelle le certificat Let's Encrypt sans tâche
  planifiée, et relaie vers `app:8080`.

Le `Caddyfile` est monté en lecture seule et tient en une dizaine de lignes.
Son adresse de site est `{$PUBLIC_URL}` : la variable qui construit l'URI de
redirection OAuth est aussi celle qui décide du domaine servi, ce qui supprime
la divergence la plus fréquente de cette application. Elle doit donc valoir
exactement `https://photos.exemple.fr`, sans `/` final ni port.

Le `Caddyfile` ne pose **aucun en-tête de sécurité** : ils viennent de
`plugins/headers.ts` (voir [04](./04-securite-et-acces.md)), pour qu'ils valent
aussi en développement et derrière un frontal remplacé.

Deux autres réglages y vivent, et ce sont les seuls : `request_body max_size
1MB`, qui refuse au frontal un corps que `bodyLimit` rejetterait de toute façon,
et `flush_interval -1`, sans lequel une vidéo relayée en `Range` serait
accumulée avant d'être envoyée.

Un proxy déjà présent sur l'hôte se substitue à `caddy` : supprimer le service
et rendre à `app` un `ports: ['127.0.0.1:8080:8080']`.

`PUBLIC_URL`, `SESSION_SECRET` et `TOKEN_KEY` sont déclarés avec la syntaxe
`${VAR:?message}` : compose refuse de démarrer s'ils manquent, avec le message
qui dit quoi faire. Les variables optionnelles — `GOOGLE_SERVICE_ACCOUNT_FILE`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SMTP_URL`, `MAIL_FROM` — sont
transmises en `${VAR:-}`. **Elles doivent l'être explicitement** : une variable
présente dans le `.env` mais absente du bloc `environment` n'atteint jamais le
conteneur, et l'instance démarre en annonçant simplement que les commentaires
sont indisponibles ou que Drive n'est pas configuré — sans que rien ne désigne
la vraie cause.

`GOOGLE_SERVICE_ACCOUNT_FILE` désigne un chemin **vu par le serveur** :
`/app/config/…` sous Docker, `./config/…` en développement.

**Les quatre volumes portent un `name:` explicite**, et c'est une correction, pas
un détail de présentation. Sans lui, compose préfixe chaque volume du nom du
projet — celui du répertoire de travail : `gdv-data` s'appelle en réalité
`googledrive-viewer_gdv-data`, ou autre chose si on a cloné sous un autre nom.
Or docker **crée en silence** un volume nommé qui n'existe pas : la commande de
sauvegarde du `README.md`, `docker run -v gdv-data:/data … tar czf`, montait donc
un volume neuf et vide et écrivait une archive vide, sans un mot. Une sauvegarde
qui ne sauvegarde rien et ne le dit pas ne se découvre qu'à la restauration
(D53). Le nom explicite rend ces commandes justes quel que soit le répertoire de
clonage ; la migration d'une instance déjà en service — recopier
`<projet>_gdv-data` vers `gdv-data` **avant** le premier `up` — est décrite dans
`deploy/README.md`.

| Montage                   | Contenu                                                                                                                          | Sauvegarde                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `./config:/app/config:ro` | `albums.yaml` d'amorçage, et la clé du compte de service si l'instance en utilise une. Lecture seule : l'app n'écrit jamais ici. | **Oui, si la clé y est** — sinon inutile après l'amorçage                                                   |
| `./Caddyfile:ro`          | Configuration du frontal                                                                                                         | Non — versionné dans le dépôt                                                                               |
| `gdv-data`                | `gdv.db` — **comptes, albums, réglages**, index, sessions, refresh token chiffré                                                 | **Oui. C'est la seule donnée irremplaçable.**                                                               |
| `gdv-cache`               | Dérivés WebP                                                                                                                     | Non — régénérable à la demande                                                                              |
| `caddy-data`              | Certificats et clé de compte ACME                                                                                                | Souhaitable — sinon réémission à chaque redéploiement, et Let's Encrypt plafonne par domaine et par semaine |
| `caddy-config`            | État interne de Caddy                                                                                                            | Non                                                                                                         |

Sauvegarder `gdv-data` ne suffit pas seul, et pour deux raisons distinctes. Sans
`TOKEN_KEY`, le refresh token qu'il contient est indéchiffrable : le `.env` part
donc avec. Et sur une instance en compte de service, l'accès à Drive ne vit ni
dans le volume ni dans le `.env` mais dans `config/`, que Google ne redélivre
pas : il part avec aussi. `backup.sh` prend les trois. La procédure complète —
arrêt de `app` pour que SQLite soit au repos, `tar` du volume, copie hors du
VPS — est dans `deploy/README.md`, qui s'adresse à l'installateur.

Les logs des deux services sont plafonnés (`json-file`, 10 Mo × 3).

## Durcissement de la machine

Le dépôt en porte l'amorçage : `deploy/cloud-init.yaml`, passé en « user data »
à la création de la machine, monte un système Debian/Ubuntu avec un compte
`deploy` sudo par clé seule, `PasswordAuthentication no`, `unattended-upgrades`
activé sans son `dpkg-reconfigure` interactif, Docker, `rclone`, Tailscale, et
`ufw` ouvert sur 22, 80, 443/tcp et 443/udp. Le compose en tire parti :
l'application ne publie aucun port sur l'hôte, il n'y a donc rien d'autre à
ouvrir.

**Le fichier ne suppose aucun hébergeur** (D63). Cloud-init est un standard _de
facto_ — une implémentation open source unique, que la quasi-totalité des images
cloud Linux embarquent et que tous les grands fournisseurs alimentent sous le nom
de « user data ». Pas une norme publiée : il n'y a ni RFC ni comité, et les
exceptions existent (Fedora CoreOS et Flatcar utilisent **Ignition**, Windows
**cloudbase-init**, et une image minimale peut ne pas embarquer le paquet). Le
`deploy/README.md` les nomme et renvoie à la procédure manuelle, plutôt que de laisser
quelqu'un chercher pourquoi rien ne se passe.

`deploy/README.md` illustre l'opération avec trois CLI différents, dans un bloc
replié et à égalité, précisément pour qu'aucun ne se lise comme le chemin
recommandé. Le compte s'appelle `deploy` et non du prénom de quelqu'un : c'est
un rôle, et un dépôt public ne crée pas un compte système au nom de son auteur.

**L'accès d'administration passe par Tailscale, et le séquencement est la seule
difficulté.** Le fichier installe Tailscale mais ne l'authentifie pas :
`tailscale up` ouvre une URL à valider dans un navigateur, c'est une action
humaine. Tant qu'elle n'a pas eu lieu, SSH sur l'IP publique est l'unique chemin
vers la machine — le fermer depuis le cloud-init la rendrait inatteignable. Le
port 22 reste donc ouvert à l'amorçage, et se ferme à la main **après** avoir
vérifié `ssh deploy@<nom-tailnet>` depuis un second terminal (`ufw delete allow
OpenSSH`, `PermitRootLogin no`, retrait de la règle 22 du pare-feu amont, quand
l'hébergeur en propose un).
`disable_root: false` et `PermitRootLogin prohibit-password` gardent le compte
root par clé accessible pendant cet intervalle ; la console série de
l'hébergeur, hors réseau de l'instance, est le filet de dernier recours. Tout
cela est répété en tête de `deploy/cloud-init.yaml` et dans `deploy/README.md` :
c'est le seul endroit de l'installation où une erreur coûte une réinstallation.

Tailscale ne demande aucune ouverture entrante — il sort en UDP 41641 et se
rabat sur un relais DERP.

**Le poste d'administration doit être sur le tailnet, lui aussi.** Un tailnet
n'a d'intérêt qu'à deux nœuds au moins : `ssh deploy@<nom-tailnet>`, qui devient
l'unique porte une fois le 22 fermé, ne résout que depuis une machine qui a
elle-même rejoint le réseau. Le cloud-init ne peut rien pour ce côté-là, et
c'est le genre d'omission qu'on ne constate qu'au pire moment — juste après
avoir fermé le port 22. `deploy/README.md` en fait donc son § 0, avant même la
création de la machine.

**La machine n'a ni Node ni pnpm**, et c'est délibéré : le `docker compose
up --build` construit tout dans l'image, il n'y a pas de second runtime à tenir
à jour sur l'hôte. Conséquence à ne pas oublier en documentant : les commandes
d'administration hors application — `create-admin`, `reset-password` — n'ont pas
d'invocation `pnpm` sur un serveur. Elles se lancent dans le conteneur, sur leur
forme compilée (voir « Scripts » plus bas).

Restent hors du dépôt, parce qu'ils tiennent à un compte et non à du code :
l'authentification auprès de l'hébergeur, la création du tailnet **et
l'installation du client Tailscale sur le poste d'administration**,
l'enregistrement DNS `A`/`AAAA`, et la configuration du remote `rclone` des
sauvegardes.

## Scripts de déploiement — `deploy/`

Deux scripts bash, lancés depuis la machine, qui se replacent seuls à la racine
du dépôt depuis `$0`.

| Script             | Effet                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deploy/backup.sh` | `docker compose stop app`, `tar` du volume `gdv-data`, redémarrage, copie du `.env` et archive de `config/` à côté, rétention des 7 derniers de chaque. `--local` s'arrête là ; sinon `rclone copy` vers le remote de `GDV_BACKUP_REMOTE`. |
| `deploy/deploy.sh` | `git pull --ff-only`, `backup.sh --local`, `docker compose up -d --build`, puis **attente active** du retour à `healthy`. Échec ⇒ `docker compose logs --tail=50 app` et code de sortie non nul.                                           |

**Pourquoi arrêter `app` pour sauvegarder.** SQLite est en WAL : copier le
fichier pendant une écriture donne une base à recomposer. L'arrêt dure quelques
secondes et rend l'archive triviale à restaurer. Écarté : `db.backup()` à chaud,
correct mais qu'il faudrait déclencher depuis l'extérieur du conteneur, par une
route ou un signal — plus de surface pour un gain de quelques secondes
d'indisponibilité par jour.

**Pourquoi le script vérifie sa propre archive.** Il refuse une archive qui ne
contient pas `gdv.db` : c'est exactement le symptôme du volume mal nommé
ci-dessus, et le seul moment où on le constaterait autrement serait la
restauration. Un volume `gdv-data` **absent** est en revanche un cas normal —
installation neuve, rien à sauvegarder — et le script sort à 0 en le disant.

**Pourquoi `deploy.sh` attend.** `docker compose up -d` rend la main dès que le
conteneur est lancé, pas quand il fonctionne : une migration qui échoue ou une
variable manquante laisse un conteneur qui redémarre en boucle pendant qu'on
croit le déploiement terminé. Le script s'appuie sur le `HEALTHCHECK` de l'image
et plafonne l'attente à 150 s — `start-period` de 20 s, puis trois essais à 30 s
d'intervalle avant qu'un conteneur soit déclaré `unhealthy`, plus une marge.

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

**Ces invocations `pnpm` supposent un poste de développement.** Sur un serveur
monté par `deploy/cloud-init.yaml`, il n'y a pas de pnpm — seulement Docker. Les
deux commandes qui ont un sens en production s'y lancent donc sur leur forme
compilée, celle que `tsc` a écrite dans `dist/` et que le `Dockerfile` copie
dans l'image :

```bash
docker compose exec app node packages/server/dist/scripts/create-admin.js <identifiant>
docker compose exec app node packages/server/dist/scripts/reset-password.js <identifiant>
```

`exec` demande que `app` tourne ; `docker compose run --rm app node …` fait la
même chose avant le premier démarrage, ce qui permet de créer l'administrateur
sur une base encore inexistante. Les deux passent par un **processus distinct**
de celui du serveur, et c'est ce qui les rend sûrs : l'instantané mémoire de
`ConfigRepo` se reconstruit sur `PRAGMA data_version`, qui ne bouge que pour les
écritures venues d'ailleurs (voir [03](./03-modele-de-donnees.md)).

`hash-password` n'a pas d'équivalent conteneur, et n'en a pas besoin : il ne
sert qu'à préparer un `albums.yaml` d'amorçage, ce qui se fait avant le
déploiement.

## Vérifications

```bash
pnpm verify   # typecheck, lint, check:format, tests, check:specs, check:links
```

Les tests serveur tournent avec le runner natif de Node (`node --import tsx
--test`) : pas de framework de test dans les dépendances.

`check:format` est un `prettier --check` : il constate là où `pnpm format`
réécrit. Sans lui, le formatage n'était vérifié nulle part et dérivait — cinq
fichiers de `main` s'en écartaient (D75).

Deux contrôles portent sur la documentation, et aucun ne juge la prose :
`tools/check-specs.mjs` compare ce que le code expose à ce que les specs
mentionnent ; `tools/check-links.mjs` résout les liens relatifs et les ancres
des trois documents qui se renvoient l'un à l'autre (D64). Les deux tournent
aussi sur `pre-push`. Les liens externes ne sont pas suivis : cela demanderait
le réseau, et un contrôle qui échoue parce qu'un site tiers est lent finit
désactivé.

`check-specs.mjs` porte en outre sur la **cohérence interne de
`08-decisions.md`** : un numéro de décision défini deux fois, ou un renvoi
`(Dxx)` vers une entrée absente. `check-links.mjs` ne peut pas les voir — un
`(D67)` en texte brut n'est pas un lien, et un `[D67](./08-decisions.md)`
désigne le fichier, jamais l'entrée.

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
