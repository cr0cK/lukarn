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
l'ordre de déclaration d'`albums.yaml`. Tableau nu, non enveloppé.

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
- `502 bad_gateway` si Drive répond sans corps ; `404` si le média n'est pas
  indexé ; `503` sur Drive non connecté ou révoqué.
- Contrairement aux rendus, cette route ne filtre pas sur `kind` : elle sert
  aussi bien l'original d'une photo que le flux d'une vidéo.

## Administration — `routes/admin.ts`

`requireAdmin` en `preHandler` sur tout le préfixe `/api/admin`.

| Méthode | Chemin                        | Réponse                                             |
| ------- | ----------------------------- | --------------------------------------------------- |
| GET     | `/api/admin/status`           | `200 AdminStatus`                                   |
| GET     | `/api/admin/oauth/start`      | `200 { url }` · `400 oauth_not_configured`          |
| POST    | `/api/admin/drive/disconnect` | `200 { ok: true }`                                  |
| POST    | `/api/admin/resync`           | `202 { started: string[] }` · `400` · `404` · `503` |
| POST    | `/api/admin/reload`           | `200 { ok, users, albums }` · `400 invalid_config`  |
| POST    | `/api/admin/cache/clear`      | `200 { ok: true }`                                  |

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

**`reload`** — relit `albums.yaml`. En cas d'échec, `400 invalid_config` avec le
message de parsing tel quel — c'est exactement ce qu'il faut corriger — et **la
config précédente reste active**.

**`cache/clear`** — supprime le répertoire de cache et le recrée. Les vignettes
sont régénérées à la demande.

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
