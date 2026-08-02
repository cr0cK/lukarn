# 05 — API

Tout est monté sous le préfixe `/api` (`packages/server/src/app.ts`). Les formes
de réponse sont les types de `packages/shared/src/index.ts`.

Colonne « Accès » :

- **aucun** — route ouverte ;
- **session** — cookie `gdv_session` valide, sinon 401 `unauthorized` ;
- **admin** — session **et** `admin: true`, sinon 401 ou 403 `forbidden`.

## Réponses d'erreur

Toutes les erreurs ont la forme `ApiError` :
`{ "error": "<code>", "message": "<texte français>" }`.

Le gestionnaire global d'`app.ts` renvoie `internal_error` / « Erreur interne »
pour tout statut ≥ 500 — le détail reste dans les logs — et `request_error` avec
le message réel en dessous.

## Santé

| Méthode | Chemin        | Accès | Réponse                |
| ------- | ------------- | ----- | ---------------------- |
| GET     | `/api/health` | aucun | `200 { status: 'ok' }` |

Utilisée par le `HEALTHCHECK` du Dockerfile.

## Authentification — `routes/auth.ts`

| Méthode | Chemin             | Accès   |
| ------- | ------------------ | ------- |
| POST    | `/api/auth/login`  | aucun   |
| POST    | `/api/auth/logout` | aucun   |
| GET     | `/api/auth/me`     | aucun\* |

**`POST /api/auth/login`** — corps `{ username, password }` (1–64 et 1–512
caractères).

| Code | Corps                                       | Quand                                                                               |
| ---- | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| 200  | `SessionUser` = `{ username, admin }`       | Succès. Pose le cookie `gdv_session`.                                               |
| 400  | `bad_request`                               | Corps absent ou hors bornes.                                                        |
| 401  | `invalid_credentials`                       | Identifiant inconnu **ou** mot de passe faux — message identique dans les deux cas. |
| 429  | `too_many_attempts` + en-tête `Retry-After` | Throttle actif pour ce couple IP/identifiant.                                       |

**`POST /api/auth/logout`** — détruit la session si le cookie en désigne une,
efface le cookie. Répond toujours `200 { ok: true }`, même sans session.

**`GET /api/auth/me`** — `200 SessionUser` si connecté, `401 unauthorized`
sinon. \*Route ouverte au sens où elle ne rejette pas avant d'entrer : le 401 est
la réponse normale d'un visiteur non connecté, et le front s'en sert pour décider
d'afficher le formulaire.

## Albums — `routes/albums.ts`

`requireAuth` en `preHandler` sur tout le préfixe.

| Méthode | Chemin                                | Accès   | Réponse       |
| ------- | ------------------------------------- | ------- | ------------- |
| GET     | `/api/albums`                         | session | `Album[]`     |
| GET     | `/api/albums/:albumId`                | session | `Album`       |
| GET     | `/api/albums/:albumId/items`          | session | `ItemsPage`   |
| GET     | `/api/albums/:albumId/items/:mediaId` | session | `MediaDetail` |

**`GET /api/albums`** — uniquement les albums attribués à l'utilisateur, dans
leur ordre de création (colonne `position`). Tableau nu, non enveloppé.

**`GET /api/albums/:albumId`** — `404 not_found` si l'album n'existe pas **ou**
n'est pas attribué (voir [04](./04-securite-et-acces.md)).

**`GET /api/albums/:albumId/items`** — paramètres de requête :

| Paramètre | Type             | Défaut | Contrainte                                                     |
| --------- | ---------------- | ------ | -------------------------------------------------------------- |
| `cursor`  | chaîne base64url | —      | ≤ 512 caractères. Illisible ⇒ ignoré, la page repart du début. |
| `limit`   | entier           | 200    | 1 à 500                                                        |
| `order`   | `desc` \| `asc`  | `desc` | Toute autre valeur ⇒ **400**, pas de repli silencieux.         |

Réponse `ItemsPage` = `{ items: MediaItem[], nextCursor: string | null }`.
`nextCursor: null` signale la fin de l'album. Codes : `400 bad_request` si les
paramètres sont invalides, `404 not_found` si l'album est inconnu ou interdit —
le contrôle d'accès passe **avant** la validation des paramètres.

`packages/server/test/items-order.test.ts` verrouille le contrat de cette route :
le défaut `desc` (les liens déjà partagés ne portent pas `order` et doivent
continuer d'ouvrir l'album dans le même sens), la pagination dans le sens
demandé, le 400 sur `zigzag`, `ASC`, `''` ou `asc,desc`, et le 404 sur un album
interdit quel que soit l'ordre.

**`GET /api/albums/:albumId/items/:mediaId`** — `MediaDetail` = `MediaItem` plus
le bloc `exif`. `404` si l'album est inconnu/interdit, `404` si le média n'est
pas dans **cet** album.

## Médias — `routes/media.ts`

`requireAuth` puis `authorize` en `preHandler` sur tout le préfixe. `authorize`
répond `404 not_found` dès que l'utilisateur n'a droit à aucun album contenant ce
média.

Un gestionnaire d'erreurs local traduit les pannes Drive : `503 drive_revoked`
(`DriveRevokedError`) et `503 drive_disconnected` (`DriveNotConnectedError`),
plutôt qu'une 500 opaque répétée sur chaque vignette de la grille.

| Méthode | Chemin                         | Accès           | Réponse                   |
| ------- | ------------------------------ | --------------- | ------------------------- |
| GET     | `/api/media/:mediaId/thumb?s=` | session + accès | `image/webp`              |
| GET     | `/api/media/:mediaId/full`     | session + accès | `image/webp`              |
| GET     | `/api/media/:mediaId/hd`       | session + accès | `image/webp`              |
| GET     | `/api/media/:mediaId/original` | session + accès | flux du fichier d'origine |

**`thumb`** — `s` vaut 320 (défaut), 640 ou 1280 ; toute autre valeur donne
`400 bad_request`. Un `s` non numérique retombe sur 320 plutôt que d'échouer.

**`full`** — rendu plein écran, côté long plafonné à 2560 px, qualité WebP 82.

**`hd`** — rendu de zoom, côté long plafonné à 4096 px, qualité 88.
`withoutEnlargement` empêche de suréchantillonner : une photo de 3000 px reste à
3000 px.

Les trois répondent :

| Code | Quand                                                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- |
| 200  | `Content-Type: image/webp`, `Cache-Control: private, max-age=31536000, immutable`, `ETag: "<mediaId>-<320\|640\|1280\|full\|hd>"` |
| 304  | `If-None-Match` correspondant à l'ETag                                                                                            |
| 404  | Média absent de l'index, ou album interdit                                                                                        |
| 415  | `unsupported` — le média est une vidéo, il n'y a pas de rendu image                                                               |
| 503  | Drive non connecté ou révoqué                                                                                                     |

**`original`** — le fichier tel quel, relayé depuis Drive sans passer par le
cache disque.

- `?download=1` ajoute `Content-Disposition: attachment; filename*=UTF-8''…`.
- Le header `Range` de la requête est validé (`media/range.ts`) puis transmis à
  Drive ; `Content-Length` et `Content-Range` de la réponse Drive sont recopiés
  tels quels. Un `Range` invalide ou multiple est **ignoré** et le fichier entier
  est servi, conformément à la RFC 9110.
- Réponse `206` si Drive a répondu 206, sinon `200`. Toujours
  `Accept-Ranges: bytes` — sans quoi le navigateur refuserait le seek vidéo.
- **`416`** si Drive a répondu 416 : le `Content-Range` reçu est recopié et le
  corps est vide. Une plage insatisfaisable — offset au-delà de la fin, courant
  quand on change de vidéo pendant qu'une requête est en vol — appartient au
  protocole `Range` normal ; en faire une erreur serveur donnerait un 500 là où
  le lecteur attend un code qu'il sait interpréter.
- `502 bad_gateway` si Drive répond sans corps ; `404` si le média n'est pas
  indexé ; `503` sur Drive non connecté ou révoqué.
- Un `401` de Drive n'est jamais relayé : le jeton d'accès est renouvelé et la
  requête retentée une fois. Si Google refuse aussi le renouvellement, la
  connexion est marquée révoquée et la réponse est `503 drive_revoked`.
- Contrairement aux rendus, cette route ne filtre pas sur `kind` : elle sert
  aussi bien l'original d'une photo que le flux d'une vidéo.

## Administration — `routes/admin.ts`

`requireAdmin` en `preHandler` sur tout le préfixe `/api/admin`.

| Méthode | Chemin                        | Réponse                                                        |
| ------- | ----------------------------- | -------------------------------------------------------------- |
| GET     | `/api/admin/status`           | `200 AdminStatus`                                              |
| GET     | `/api/admin/users`            | `200 AdminUser[]`                                              |
| POST    | `/api/admin/users`            | `201 AdminUser` · `400` · `400 unknown_album` · `409 conflict` |
| PATCH   | `/api/admin/users/:username`  | `200 AdminUser` · `400` · `404` · `409 last_admin`             |
| DELETE  | `/api/admin/users/:username`  | `200 { ok: true }` · `404` · `409 last_admin`                  |
| GET     | `/api/admin/albums`           | `200 AdminAlbum[]`                                             |
| POST    | `/api/admin/albums`           | `201 AdminAlbum` · `400` · `409 conflict`                      |
| PATCH   | `/api/admin/albums/:id`       | `200 AdminAlbum` · `400` · `404`                               |
| DELETE  | `/api/admin/albums/:id`       | `200 { ok: true }` · `404`                                     |
| GET     | `/api/admin/settings`         | `200 AppSettings`                                              |
| PATCH   | `/api/admin/settings`         | `200 AppSettings` · `400`                                      |
| GET     | `/api/admin/oauth/start`      | `200 { url }` · `400 oauth_not_configured`                     |
| POST    | `/api/admin/drive/disconnect` | `200 { ok: true }`                                             |
| POST    | `/api/admin/resync`           | `202 { started: string[] }` · `400` · `404` · `503`            |
| POST    | `/api/admin/cache/clear`      | `200 { ok: true }`                                             |

**`status`** — `AdminStatus` : `driveConnected`, `driveAccount`,
`driveRevokedAt`, `oauthConfigured`, `albums` (**tous** les albums déclarés, pas
seulement ceux de l'administrateur), `cache: { entryCount, bytes, maxBytes }`.
Le front réinterroge toutes les 2 s tant qu'un album est en `syncStatus:
'running'`.

**`oauth/start`** — `400 oauth_not_configured` si `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` sont absents. Sinon pose le cookie signé
`gdv_oauth_state` et renvoie l'URL de consentement, que le front suit en
redirection pleine page.

**`drive/disconnect`** — supprime la ligne `oauth_token`. L'index et le cache
restent, les albums restent consultables tant que les vignettes sont en cache.

**`resync`** — corps optionnel `{ albumId }`. Sans lui, tous les albums.
`503 drive_disconnected` si Drive n'est pas connecté, `404 not_found` si
l'`albumId` fourni n'existe pas. Répond **202** immédiatement : la
synchronisation tourne en tâche de fond, elle dépasserait le timeout d'une
requête HTTP sur un gros album. L'avancement se suit dans `status`.

**`cache/clear`** — supprime le répertoire de cache et le recrée. Les vignettes
sont régénérées à la demande.

### Comptes

Corps de `POST` : `CreateUserRequest` = `{ username, password, admin?, albums? }`.
`PATCH` : `UpdateUserRequest` = `{ password?, admin?, albums? }`, champ absent
valant « inchangé ». La réponse est un `AdminUser` — **jamais d'empreinte de mot
de passe, sous aucune clé**.

- `username` : `USERNAME_PATTERN`, 64 caractères au plus. `password` :
  `PASSWORD_MIN_LENGTH` (8) au minimum, 512 au plus.
- `albums` : liste d'ids, ou `['*']` (`ALL_ALBUMS`) pour le joker. Un id inconnu
  répond `400 unknown_album` en nommant le fautif. Une liste mêlant `'*'` et des
  ids vaut joker.
- `409 conflict` si l'identifiant est pris, **casse comprise**.
- `409 last_admin` sur la suppression du dernier administrateur ou le retrait de
  son rôle.
- Supprimer un compte et changer son mot de passe ferment ses sessions ; changer
  son rôle ou ses albums non (voir [04](./04-securite-et-acces.md)).

### Albums

`POST` : `CreateAlbumRequest` = `{ id, title, description?, folderId,
recursive? }` (`recursive` vaut `true` par défaut). `PATCH` :
`UpdateAlbumRequest`, où `description: null` efface la description. `409
conflict` sur un id déjà pris.

`AdminAlbum` complète la configuration par l'état réel : `itemCount`,
`lastSyncAt`, `syncStatus`, `syncError`, et `members` — les comptes ayant un
accès **explicite**, les détenteurs du joker n'y figurant pas.

Deux effets de bord assumés :

- **Changer `folderId` vide l'index de l'album** et remet son état de synchro à
  `never` ; une resynchronisation démarre en fond si Drive est connecté. Les
  médias indexés désignaient l'ancien dossier : les laisser en place les
  laisserait consultables jusqu'à la prochaine sync.
- **Supprimer un album retire ses médias de l'index.** Un fichier présent dans un
  autre album y garde sa ligne (clé primaire `(album_id, id)`). Les dérivés en
  cache disque sont laissés : ils sont indexés par id de fichier, donc partagés
  entre albums, et régénérables — `cache/clear` les balaie tous.

### Réglages

`AppSettings` = `{ syncIntervalMinutes, syncOnStartup, cacheMaxSizeGB }`. `PATCH`
accepte un sous-ensemble (`UpdateSettingsRequest`) et renvoie l'état complet.
Bornes : `syncIntervalMinutes` entier de 0 à 10080, `cacheMaxSizeGB` > 0.

**Les réglages s'appliquent sans redémarrage** : la limite de `MediaCache` est
ajustée dans la foulée (avec éviction si elle baisse) et le minuteur de
synchronisation de `main.ts` est reprogrammé. C'était la limite du rechargement
de configuration d'avant, qui ne relisait ces valeurs qu'au démarrage.

## Callback OAuth — `routes/admin.ts`

| Méthode | Chemin                | Accès |
| ------- | --------------------- | ----- |
| GET     | `/api/oauth/callback` | admin |

Monté hors du préfixe `/admin` parce que son URL est figée dans la console
Google Cloud, mais protégé par le même `requireAdmin`. Paramètres `code`,
`state`, `error` posés par Google.

Ne renvoie jamais de JSON : redirige toujours vers `/admin?oauth=<raison>`.

| `oauth=`         | Cause                                              |
| ---------------- | -------------------------------------------------- |
| `connected`      | Succès. Une première synchronisation démarre.      |
| `denied`         | Google a renvoyé `error` (consentement refusé).    |
| `invalid`        | `code` ou `state` manquant.                        |
| `state_mismatch` | Le cookie anti-CSRF ne correspond pas.             |
| `error`          | L'échange du code a échoué (détail dans les logs). |

## Routes non-API

Servies par `registerFrontend` (`app.ts`) quand `WEB_DIR/index.html` existe.

| Chemin        | Comportement                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| `/`           | `index.html`, `Cache-Control: no-cache`                                                                         |
| `/assets/*`   | Fichier réel, `Cache-Control: public, max-age=31536000, immutable`. Absent ⇒ **404 JSON**, jamais `index.html`. |
| `/api/*`      | Inconnu ⇒ `404 { error: 'not_found', message: 'Route inconnue' }`                                               |
| tout le reste | `index.html` — le routage vit dans le front, un rechargement sur `/album/x` doit fonctionner                    |

Sans build du front, toutes les routes non-`/api` répondent un 404 JSON invitant
à lancer `pnpm dev` ou `pnpm build`. `packages/server/test/static.test.ts`
verrouille chacun de ces comportements.
