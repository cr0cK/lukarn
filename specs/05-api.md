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

| Méthode | Chemin                  | Accès   |
| ------- | ----------------------- | ------- |
| POST    | `/api/auth/login`       | aucun   |
| POST    | `/api/auth/logout`      | aucun   |
| GET     | `/api/auth/me`          | aucun\* |
| GET     | `/api/auth/setup-state` | aucun   |

**`POST /api/auth/login`** — corps `{ username, password }` (1–64 et 1–512
caractères).

| Code | Corps                                       | Quand                                                                               |
| ---- | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| 200  | `SessionUser` = `{ username, admin }`       | Succès. Pose le cookie `gdv_session`.                                               |
| 400  | `bad_request`                               | Corps absent ou hors bornes.                                                        |
| 401  | `invalid_credentials`                       | Identifiant inconnu **ou** mot de passe faux — message identique dans les deux cas. |
| 429  | `too_many_attempts` + en-tête `Retry-After` | Throttle actif sur l'un des trois axes : couple IP/identifiant, identifiant, IP.    |

**`POST /api/auth/logout`** — détruit la session si le cookie en désigne une,
efface le cookie. Répond toujours `200 { ok: true }`, même sans session.

**`GET /api/auth/me`** — `200 SessionUser` si connecté, `401 unauthorized`
sinon. \*Route ouverte au sens où elle ne rejette pas avant d'entrer : le 401 est
la réponse normale d'un visiteur non connecté, et le front s'en sert pour décider
d'afficher le formulaire.

**`GET /api/auth/setup-state`** — `200 { needsSetup: boolean }`. Dit si la base
ne contient encore aucun compte, auquel cas l'écran de connexion affiche la
commande à lancer (`pnpm create-admin`) au lieu de refuser toutes les tentatives
sans explication.

Publique, et elle doit l'être : elle est interrogée avant toute connexion. Elle
ne divulgue rien — sur une instance sans compte il n'y a rien à protéger, et la
réponse ne dit jamais **qui** existe, seulement s'il existe quelqu'un
(`packages/server/test/setup-state.test.ts` le vérifie).

## Albums — `routes/albums.ts`

`requireAuth` en `preHandler` sur tout le préfixe.

| Méthode | Chemin                                | Accès   | Réponse       |
| ------- | ------------------------------------- | ------- | ------------- |
| GET     | `/api/albums`                         | session | `Album[]`     |
| GET     | `/api/albums/:albumId`                | session | `Album`       |
| GET     | `/api/albums/:albumId/days`           | session | `AlbumDay[]`  |
| GET     | `/api/albums/:albumId/items`          | session | `ItemsPage`   |
| GET     | `/api/albums/:albumId/items/:mediaId` | session | `MediaDetail` |

**`GET /api/albums`** — uniquement les albums attribués à l'utilisateur, dans
leur ordre de création (colonne `position`). Tableau nu, non enveloppé.

`Album` porte `groupBy` (`month` \| `day`) : le découpage appliqué à l'ouverture
de l'album, que le paramètre `?group=` de l'URL peut contredire. C'est une
préférence de l'album, pas un découpage de la requête — la liste servie est la
même dans les deux cas.

**`GET /api/albums/:albumId`** — `404 not_found` si l'album n'existe pas **ou**
n'est pas attribué (voir [04](./04-securite-et-acces.md)).

**`GET /api/albums/:albumId/days`** — les journées annotées de l'album. Même
règle d'accès que le reste : `404 not_found` si l'album est inconnu **ou** non
attribué.

```ts
interface AlbumDay {
  day: string; // 'YYYY-MM-DD' UTC, la clé du découpage par jour
  description: string | null;
  place: string | null; // saisi à la main, prime sur autoPlaces
  autoPlaces: string[]; // déduits de l'EXIF, du plus tôt au plus tard
}
```

Ne sont rendues que les journées **qui ont quelque chose à montrer** : une note,
un lieu saisi, ou au moins un lieu déduit déjà géocodé. Une journée réduite à
des cellules qu'aucun géocodage n'a encore nommées n'a rien à afficher, et la
transporter ajouterait une entrée par jour d'album. Une cellule sans libellé
disparaît d'`autoPlaces` au lieu d'y laisser un trou.

`autoPlaces` est asynchrone par nature : le géocodage tourne en fond, plafonné à
une requête par seconde (voir [02](./02-architecture.md) et D48). L'interface
doit donc tenir sans lui, et les lieux s'allument tout seuls au passage suivant.

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

**Effet de bord assumé** : sur la **première page** seulement (`cursor` absent),
si la session porte une identité vérifiée, un `INSERT OR IGNORE` abonne cette
personne aux nouveautés de l'album (voir [04](./04-securite-et-acces.md) et
[08](./08-decisions.md), D41). Une écriture par ouverture d'album, négligeable.
Ni les pages suivantes ni `/items/:mediaId` ne le font.

`packages/server/test/items-order.test.ts` verrouille le contrat de cette route :
le défaut `desc` (les liens déjà partagés ne portent pas `order` et doivent
continuer d'ouvrir l'album dans le même sens), la pagination dans le sens
demandé, le 400 sur `zigzag`, `ASC`, `''` ou `asc,desc`, et le 404 sur un album
interdit quel que soit l'ordre.

**`GET /api/albums/:albumId/items/:mediaId`** — `MediaDetail` = `MediaItem` plus
le bloc `exif` et `commentCount`. `404` si l'album est inconnu/interdit, `404` si
le média n'est pas dans **cet** album.

`commentCount` est composé par la route, pas par `MediaRepo` : l'index média n'a
pas à connaître les commentaires, sans quoi chaque requête média deviendrait une
jointure de plus. Il compte les commentaires **visibles**, réponses comprises, et
voyage avec le détail pour que la visionneuse affiche « 3 » sur son onglet sans
charger un fil que la plupart des visiteurs n'ouvriront pas.

## Identité de commentateur — `routes/identity.ts`

`requireAuth` sur tout le préfixe : on déclare une identité depuis une session
déjà ouverte, la clé d'accès et la personne étant deux choses distinctes.

| Méthode | Chemin                       | Réponse       |
| ------- | ---------------------------- | ------------- |
| POST    | `/api/identity/request-code` | `202`         |
| POST    | `/api/identity/verify`       | `SessionUser` |
| POST    | `/api/identity/forget`       | `SessionUser` |

**`request-code`** — corps `IdentityRequest` = `{ email, displayName }`. Envoie
un code à six chiffres et répond `202` **que l'adresse soit déjà connue ou
non** : distinguer les deux dirait à qui l'essaie quelles adresses ont déjà
commenté ici. Le nom fourni n'est pas appliqué tout de suite si l'identité est
déjà vérifiée — il attend le code (D42). `429 too_soon` avec `Retry-After` si un code a été envoyé
dans la minute — sans quoi le formulaire expédierait des emails en rafale vers
une adresse qu'on ne possède pas. `503 mail_not_configured` sans SMTP : aucun
code ne peut partir, donc personne ne peut commenter.

**`verify`** — corps `VerifyIdentityRequest` = `{ email, code }`. Rattache
l'identité à la session et rend le `SessionUser` à jour. `400` sur un code faux,
expiré ou épuisé — **le même message dans les trois cas**, détailler lequel
aidant surtout celui qui essaie des codes au hasard. Cinq tentatives, puis il
faut redemander un code.

**`forget`** — délie l'identité de cette session. Les commentaires déjà écrits
restent en place : ils appartiennent à la conversation, pas à l'appareil. Se
ré-identifier avec la même adresse les retrouve, et le droit de les supprimer
avec.

La signature affichée est **celle du moment**, pas celle de l'écriture : le fil
lit `commenters.display_name` par jointure. Se renommer renomme donc tout son
historique, ce qui est le comportement voulu — l'identité est l'adresse, le nom
n'en est que l'étiquette courante. C'est aussi pourquoi un renommage attend la
validation du code (`pending_display_name`, voir
[03](./03-modele-de-donnees.md)) : sans cela, la demande seule aurait suffi à
réécrire la signature de tous les messages d'un tiers.

## Commentaires — `routes/comments.ts`

| Méthode | Chemin                            | Accès     | Réponse              |
| ------- | --------------------------------- | --------- | -------------------- |
| GET     | `/api/comments/:albumId`          | session   | `AlbumCommentCounts` |
| GET     | `/api/comments/:albumId/:mediaId` | session   | `CommentsPage`       |
| POST    | `/api/comments/:albumId/:mediaId` | session   | `Comment`            |
| PATCH   | `/api/comments/:commentId`        | session   | `Comment`            |
| DELETE  | `/api/comments/:commentId`        | session   | `204`                |
| GET     | `/api/comments/unsubscribe`       | **aucun** | page HTML            |

Le contrôle d'accès est refait dans chaque handler plutôt que posé en
`preHandler` de préfixe comme pour les médias : ici l'album n'occupe pas un
segment fixe de l'URL. Il reste identique à celui des albums — **404 et jamais
403** sur un album inconnu ou non attribué (voir
[04](./04-securite-et-acces.md)).

**`GET /api/comments/:albumId`** — `AlbumCommentCounts` = `{ counts: Record<mediaId, number> }`,
masqués exclus. Les photos sans commentaire **n'y figurent pas** : sur un album
de milliers de vues dont une dizaine porte une conversation, la réponse tient en
quelques centaines d'octets. Une photo absente vaut donc zéro.

Un appel pour l'album entier, et non un par photo : la pastille de la visionneuse
doit être là dès qu'on atteint une photo, et parcourir un album à la flèche
déclencherait sinon une requête par photo traversée (voir
[08](./08-decisions.md), D54). Le compteur de `MediaDetail.commentCount` reste :
il sert l'onglet du panneau ouvert, sur une photo précise.

Cette route paramétrique **ne masque pas `/api/comments/unsubscribe`** : la table
de routage de Fastify fait passer un segment littéral avant un paramètre. C'est
vérifié par un test — l'inverse ferait répondre 401 aux liens de désabonnement
des emails déjà partis, sans rattrapage possible.

Le revers est vrai depuis cette route, et il faut le savoir : `ALBUM_ID_PATTERN`
autorise l'identifiant `unsubscribe`, créable depuis `/admin`. Un tel album
n'obtiendrait **jamais** ses compteurs — `GET /api/comments/unsubscribe` rendrait
la page HTML de désabonnement, hors session. C'est une collision assumée : la
précédence protège le lien des emails déjà partis, ce qui est le cas irréparable,
contre un identifiant d'album que son créateur peut renommer.

**`GET /api/comments/:albumId/:mediaId`** — `CommentsPage` = `{ threads: CommentThread[], total: number }`, où
`CommentThread` = `{ root, replies }`. Les commentaires masqués par la modération
n'y figurent pas, **y compris pour leur auteur**. Une réponse dont la racine
vient d'être masquée remonte en tête de fil, `parentId` remis à `null` : la
laisser accrochée à un parent absent la ferait disparaître sans que personne ne
l'ait décidé.

**`POST`** — corps `CreateCommentRequest` = `{ body, parentId? }`. `body` est
découpé aux espaces avant contrôle : 1 à `COMMENT_MAX_LENGTH` (2000) caractères.
`201` avec le `Comment` créé.

- **`403 identity_required`** tant qu'aucune identité vérifiée n'est rattachée à
  la session. Seconde exception assumée au « 404 et jamais 403 » (voir
  [04](./04-securite-et-acces.md)) : le refus porte sur l'état de son propre
  compte, pas sur une ressource d'autrui.

- `404` si l'album est inconnu/interdit, ou si le média n'est pas dans cet album.
- `404` si `parentId` désigne un commentaire inexistant **ou vivant sur un autre
  média** — sans ce second contrôle, un client pourrait greffer sa réponse sur un
  fil qu'il n'a pas le droit de lire en devinant un identifiant.
- Répondre à une réponse **n'échoue pas** : le message est rattaché à la racine
  du fil (voir [08](./08-decisions.md), D35).

**`PATCH`** — corps `UpdateCommentRequest` = `{ body }`, mêmes bornes que le
`POST`. **Son auteur seulement**, et seulement pendant `COMMENT_EDIT_WINDOW_MS`
(30 s) après la publication. `parentId` est **ignoré** : le schéma ne retient que
`body`, et Zod écarte silencieusement les clés inconnues — un `PATCH` qui en
enverrait un répond `200` sans avoir déplacé le message, il ne répond pas `400`.
Corriger une faute de frappe ne doit pas permettre de changer de conversation.
`created_at` ne bouge
pas non plus — le message reste à sa place dans un fil que d'autres lisaient
déjà. Voir [08](./08-decisions.md), D57.

- **`409 edit_window_closed`** quand le délai est passé. Ni 403 ni 404 : le refus
  porte sur l'**état** du message et non sur un droit d'accès — son auteur le
  voit déjà, il n'y a rien à lui cacher. La doctrine du 404 (D12) ne s'y applique
  donc pas.
- `404` si le commentaire n'existe pas, appartient à quelqu'un d'autre, a été
  masqué depuis, ou vit dans un album qu'on ne voit plus. Ces cas restent
  indistinguables, comme pour `DELETE`.
- **L'administrateur n'y a aucun privilège.** Il modère en masquant ou en
  supprimant ; réécrire sous le nom d'un autre est un pouvoir d'une autre nature.

Le contrôle du délai est **côté serveur**, pas seulement dans l'interface : une
règle que seul le front applique n'est pas une règle.

Un `Comment` porte donc **deux droits calculés par le serveur**, et leur
asymétrie est la décision de D57 :

- `canDelete` — son propre commentaire, ou n'importe lequel si l'on est
  administrateur. Stable tant que la session ne change pas.
- `canEdit` — son propre commentaire, et seulement dans la fenêtre. Aucun
  privilège d'administrateur. C'est une valeur qui **périme toute seule** : elle
  dit ce que le serveur accepterait à l'instant de la réponse, et le front doit
  la recouper avec `createdAt` via `remainingEditMs`, partagée pour que les deux
  côtés tranchent à l'identique.

Le front ne rejoue jamais ces règles d'autorisation lui-même.

**`DELETE`** — l'auteur son propre commentaire, un administrateur n'importe
lequel. `404` dans tous les cas de refus, sans distinguer « inexistant » de
« pas à toi ». Un visiteur ne peut supprimer que dans un album qu'il voit encore,
sinon un accès retiré laisserait subsister un droit d'écriture.

**`GET /api/comments/unsubscribe?u=&t=`** — `u` est l'**adresse email**, pas un
identifiant de compte : c'est elle qui identifie une personne. **Seule route de
ce préfixe sans session.** On clique ce lien depuis sa boîte aux lettres, souvent sur un autre
appareil : exiger une connexion pour cesser d'être dérangé reviendrait à ne pas
répondre à la demande. `t` est un HMAC de l'identifiant, sans expiration (voir
[04](./04-securite-et-acces.md)). Rend une page HTML servie par le serveur — pas
le front, qui redirigerait vers l'écran de connexion. Un jeton invalide répond
`400` ; un compte supprimé depuis l'envoi rend la page en le disant.

## Abonnements — `routes/subscriptions.ts`

| Méthode | Chemin                           | Accès     | Réponse   |
| ------- | -------------------------------- | --------- | --------- |
| GET     | `/api/subscriptions/unsubscribe` | **aucun** | page HTML |

On ne s'abonne par aucune route : l'abonnement est l'effet de bord de
l'ouverture de l'album décrit plus haut. Ce préfixe ne porte donc que le
désabonnement.

**`GET /api/subscriptions/unsubscribe?u=&a=&t=`** — `u` l'adresse email, `a`
l'id de l'album, `t` un HMAC du **couple**, sans expiration : le jeton d'un
album ne vaut pas pour un autre, sinon un lien recopié couperait un abonnement
qu'on n'a pas visé. Sans session, comme le désabonnement des commentaires — on
clique depuis sa boîte aux lettres, souvent sur un autre appareil.

`400 bad_request` sur un lien incomplet, un id d'album hors motif ou un jeton
invalide. Sinon `200` et une page HTML servie par le serveur : celle du front
redirigerait vers l'écran de connexion. Un album supprimé ou une identité
effacée depuis l'envoi rendent la page en le disant, sans erreur. Le
désabonnement ne touche que cet album — les réponses aux commentaires
continuent d'arriver, elles se coupent depuis `/api/comments/unsubscribe`.

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

| Code | Quand                                                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200  | `Content-Type: image/webp`, `Cache-Control: private, max-age=31536000, immutable`, `Vary: Cookie`, `ETag: "<mediaId>-<version>-<320\|640\|1280\|full\|hd>"` |
| 304  | `If-None-Match` correspondant à l'ETag                                                                                                                      |
| 404  | Média absent de l'index, ou album interdit                                                                                                                  |
| 415  | `unsupported` — le média est une vidéo, il n'y a pas de rendu image                                                                                         |
| 503  | Drive non connecté ou révoqué                                                                                                                               |

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
- **`503 drive_unavailable`, avec `Retry-After`**, sur un échec **transitoire** :
  délai de téléchargement dépassé, ou débit limité par Google au-delà des
  réessais. À distinguer d'un 500, que le navigateur traite comme définitif :
  ici la vignette doit revenir, et elle le fait d'elle-même (D60). Aucun en-tête
  de cache n'accompagne cette réponse — un échec ne se mémorise jamais.
- Un `401` de Drive n'est jamais relayé : le jeton d'accès est renouvelé et la
  requête retentée une fois. Si Google refuse aussi le renouvellement, la
  connexion est marquée révoquée et la réponse est `503 drive_revoked`.
- Contrairement aux rendus, cette route ne filtre pas sur `kind` : elle sert
  aussi bien l'original d'une photo que le flux d'une vidéo.

## Administration — `routes/admin.ts`

`requireAdmin` en `preHandler` sur tout le préfixe `/api/admin`.

| Méthode | Chemin                            | Réponse                                                        |
| ------- | --------------------------------- | -------------------------------------------------------------- |
| GET     | `/api/admin/status`               | `200 AdminStatus`                                              |
| GET     | `/api/admin/users`                | `200 AdminUser[]`                                              |
| POST    | `/api/admin/users`                | `201 AdminUser` · `400` · `400 unknown_album` · `409 conflict` |
| PATCH   | `/api/admin/users/:username`      | `200 AdminUser` · `400` · `404` · `409 last_admin`             |
| DELETE  | `/api/admin/users/:username`      | `200 { ok: true }` · `404` · `409 last_admin`                  |
| GET     | `/api/admin/albums`               | `200 AdminAlbum[]`                                             |
| POST    | `/api/admin/albums`               | `201 AdminAlbum` · `400` · `409 conflict`                      |
| PATCH   | `/api/admin/albums/:id`           | `200 AdminAlbum` · `400` · `404`                               |
| DELETE  | `/api/admin/albums/:id`           | `200 { ok: true }` · `404`                                     |
| PATCH   | `/api/admin/albums/:id/days/:day` | `200 AlbumDay` · `400` · `404`                                 |
| GET     | `/api/admin/settings`             | `200 AppSettings`                                              |
| PATCH   | `/api/admin/settings`             | `200 AppSettings` · `400`                                      |
| GET     | `/api/admin/oauth/start`          | `200 { url }` · `400 oauth_not_configured`                     |
| POST    | `/api/admin/drive/disconnect`     | `200 { ok: true }`                                             |
| POST    | `/api/admin/resync`               | `202 { started: string[] }` · `400` · `404` · `503`            |
| POST    | `/api/admin/cache/clear`          | `200 { ok: true }`                                             |

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

**Aucune adresse email ici** : un compte est une clé d'accès, possiblement
partagée, pas quelqu'un de joignable. Les adresses appartiennent aux identités
de commentateur, et celle prévenue des nouveaux commentaires est le réglage
`moderationEmail`.

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
recursive?, groupBy? }` (`recursive` vaut `true` par défaut, `groupBy` vaut
`month`). `PATCH` : `UpdateAlbumRequest`, où `description: null` efface la
description. `409 conflict` sur un id déjà pris.

`groupBy` est le découpage appliqué à l'ouverture de l'album — une préférence,
que `?group=` contredit. Le changer ne touche **pas** à l'index : contrairement
à `folderId` et `recursive`, il ne modifie pas le périmètre Drive, seulement la
mise en page.

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

### Journées d'un album

`PATCH /api/admin/albums/:id/days/:day` — corps `UpdateAlbumDayRequest` =
`{ description?, place? }`. Champ absent = inchangé, `null` **ou chaîne vide** =
effacé (les deux sont ramenés au même `NULL`, comme `moderationEmail`, pour que
le front n'ait pas à traduire un champ vidé). Bornes : 300 caractères pour la
description, 120 pour le lieu. `:day` doit être `AAAA-MM-JJ`, sinon `400`. `404`
si l'album est inconnu. La réponse est l'`AlbumDay` à jour.

**La saisie vit dans l'album, la mutation reste ici.** On décrit une journée en
voyant ses photos, donc le crayon est dans la grille ; mais l'écriture passe par
`/api/admin`, seul préfixe qui répond **403**. Partout ailleurs un refus d'accès
répond 404, et cette route ne déplace pas cet invariant (D50).

La **description de l'album** suit exactement la même règle : son crayon vit sur
la page de l'album, son écriture passe par `PATCH /api/admin/albums/:id`, avec le
champ `description` de `UpdateAlbumRequest`. Sa borne est
`ALBUM_DESCRIPTION_MAX_LENGTH` (2000), exportée par `@gdv/shared` plutôt
qu'écrite en littéral dans le schéma Zod : le compteur de caractères du front la
lit désormais, et deux limites divergentes rendraient une saisie acceptée à
l'écran refusée par le serveur.

La ligne est créée si la journée n'en avait pas : on peut annoter une journée
dont aucune photo ne porte de position. Une journée vidée de sa note **et** de
son lieu disparaît de `GET /days` si l'EXIF ne lui en donne aucun.

### Modération des commentaires

| Méthode | Chemin                                    | Réponse                 |
| ------- | ----------------------------------------- | ----------------------- |
| GET     | `/api/admin/comments`                     | `AdminCommentsPage`     |
| POST    | `/api/admin/comments/:id/hide`            | `{ ok: true }`          |
| POST    | `/api/admin/comments/:id/show`            | `{ ok: true }`          |
| POST    | `/api/admin/commenters/:commenterId/hide` | `BulkModerationResult`  |
| POST    | `/api/admin/commenters/:commenterId/show` | `BulkModerationResult`  |

Paramètres de `GET` :

| Paramètre | Valeurs                                | Défaut |
| --------- | -------------------------------------- | ------ |
| `filter`  | `all`, `visible`, `hidden`             | `all`  |
| `albumId` | un identifiant d'album                 | tous   |
| `q`       | 1 à 200 caractères, coupés aux bords   | —      |
| `limit`   | 1 à 200                                | 50     |
| `cursor`  | entier positif                         | —      |

Le curseur est un **simple entier**, l'identifiant du dernier commentaire rendu :
`AUTOINCREMENT` garantit que l'ordre des id est l'ordre d'écriture, ce qui évite
le curseur composite dont la pagination des médias a besoin.

`q` est cherché dans le corps, le nom déclaré **et** l'adresse — on cherche aussi
bien un mot qu'on nous a rapporté que la personne qui l'a écrit. Les jokers de
`LIKE` sont échappés : taper `%` cherche un pourcent, il ne ramène pas tout le
corpus. La casse n'est repliée que sur l'ASCII, limite de `LIKE` en SQLite
(D67).

`AdminCommentsPage` = `{ comments, nextCursor, total }`. **`total` ignore le
curseur** : c'est la taille du corpus que le filtre retient, pas celle du reste à
parcourir — sans quoi « 3 sur 6 » deviendrait « 3 sur 4 » en tournant la page.

`AdminComment` ajoute au `Comment` de quoi savoir de quelle photo on parle et
qui écrit — `albumId`, `albumTitle`, `mediaId`, `mediaName`, `authorEmail`,
`commenterId`, `account`, `hiddenAt`, `hiddenBy`. `authorEmail` et `commenterId`
n'apparaissent **qu'ici** : la modération a besoin de savoir qui parle derrière
un nom déclaré, et de pouvoir viser tous ses messages ; le fil public n'a ni
l'un ni l'autre à révéler.
`account` est la clé d'accès employée pour écrire, ce qui dit quel mot de passe
partagé changer.
`mediaName` vaut `null` si le média a disparu de l'index depuis : le commentaire
reste modérable, seul le lien vers la photo n'est plus rendu.

La file couvre **tous les albums**, y compris ceux que cet administrateur ne
verrait pas dans la galerie : modérer suppose de tout lire, et restreindre la
file au périmètre de lecture laisserait des commentaires que personne ne
pourrait traiter.

**`hide` / `show`** — masquer plutôt que supprimer : la décision reste
réversible. Masquer deux fois n'est pas une erreur et ne réécrit pas `hiddenAt`,
qui doit garder la date de la décision d'origine. La suppression définitive passe
par `DELETE /api/comments/:commentId`, où l'administrateur a tous les droits.

**`/commenters/:commenterId/hide|show`** — la même décision, sur **tous les
messages d'une identité à la fois**, tous albums confondus. Le geste d'après une
clé d'accès qui a trop circulé : retirer quinze messages un par un est un travail
que personne ne fait. `BulkModerationResult` = `{ affected }`, le nombre de
messages réellement touchés — les déjà-masqués n'en font pas partie, pour la même
raison qu'à l'unité. Une identité inconnue répond **404** et non `{affected: 0}`,
qui serait indiscernable d'une identité sans message.

`AdminStatus` porte `hiddenComments` (pastille de la file) et `mailConfigured` —
sans SMTP, renseigner une adresse ne produit rien, et l'écran d'administration
doit le dire plutôt que de laisser espérer des notifications.

### Réglages

`AppSettings` = `{ syncIntervalMinutes, syncOnStartup, cacheMaxSizeGB,
prewarmCache, moderationEmail }`. `PATCH`
accepte un sous-ensemble (`UpdateSettingsRequest`) et renvoie l'état complet.
Bornes : `syncIntervalMinutes` entier de 0 à 10080, `cacheMaxSizeGB` > 0,
`prewarmCache` booléen (défaut `true`, relu à chaque photo par le préchauffage —
le décocher arrête le passage en cours, pas seulement le suivant).
`moderationEmail` accepte une adresse valide, `null` ou la chaîne vide — les deux
dernières valant « aucune alerte », `ConfigRepo` les ramenant au même `NULL`.

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

Ne renvoie jamais de JSON : redirige toujours vers `/admin/serveur?oauth=<raison>`
— la rubrique qui porte le bouton de connexion (D66).

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
