# 04 — Sécurité et accès

## Les deux authentifications, à ne pas confondre

C'est la confusion la plus coûteuse du projet. Ce sont deux mécanismes sans
rapport, qui ne partagent ni stockage, ni durée de vie, ni population.

|                 | OAuth Google                           | Identifiant / mot de passe       |
| --------------- | -------------------------------------- | -------------------------------- |
| Qui             | Le propriétaire du Drive, une personne | Chaque visiteur                  |
| Quand           | Une fois, à l'installation             | À chaque session (30 jours)      |
| Ce que ça ouvre | La lecture du Drive **par le serveur** | Les albums attribués à ce compte |
| Où c'est stocké | `oauth_token`, refresh token chiffré   | Table `users`, hash argon2id     |
| Qui déclenche   | `/admin` → « Connecter Google Drive »  | Le formulaire de `/login`        |

Un visiteur ne voit jamais Google, n'a besoin d'aucun compte Google, et ne reçoit
jamais d'URL `googleapis.com`. L'application détient un seul jeton — celui du
propriétaire — et sert tout le contenu à travers lui.

## Mots de passe

Hachés en **argon2id** avec les paramètres par défaut de `argon2.hash()`. Le mot
de passe arrive en clair sur `POST`/`PATCH /api/admin/users` et n'est haché que
côté serveur ; **aucune réponse d'API ne contient jamais d'empreinte**
(`packages/server/test/admin-config.test.ts` le vérifie sur la création comme sur
la liste). Longueur minimale : `PASSWORD_MIN_LENGTH` (8), partagée avec le front.

Deux autres chemins produisent une empreinte : `pnpm create-admin` pour le tout
premier administrateur d'une installation neuve, et `pnpm hash-password` pour un
`config/albums.yaml` d'amorçage — `config.ts` y refuse toute valeur qui ne
commence pas par `$argon2`, ce qui écarte un mot de passe laissé en clair par
mégarde.

`routes/auth.ts` compare **toujours** un hash, même quand l'identifiant est
inconnu : un `DUMMY_HASH` constant est vérifié dans ce cas. Sans cette
précaution, un login inexistant répondrait en une fraction du temps d'un mot de
passe faux, ce qui permettrait d'énumérer les comptes au chronomètre.

La recherche d'utilisateur est **insensible à la casse** (`ConfigRepo.user`), et
l'unicité l'est aussi — c'est le rôle du `COLLATE NOCASE` de la clé primaire
(voir [03](./03-modele-de-donnees.md)). Créer « ALEXIS » quand « alexis » existe
répond **409**, jamais un écrasement silencieux.

## Throttle des tentatives

`packages/server/src/throttle.ts`, en mémoire, clé `<ip>:<username en
minuscules>`.

| Paramètre        | Valeur    | Effet                                                        |
| ---------------- | --------- | ------------------------------------------------------------ |
| `FREE_ATTEMPTS`  | 5         | Aucune pénalité — une erreur de frappe ne fait pas attendre. |
| `BASE_DELAY_MS`  | 2 000     | Le 6ᵉ échec impose 2 s, puis doublement : 4, 8, 16 s…        |
| `MAX_DELAY_MS`   | 900 000   | Plafond à 15 minutes.                                        |
| `RESET_AFTER_MS` | 3 600 000 | Une heure sans échec efface la série.                        |

Une connexion réussie remet le compteur à zéro. Le blocage répond **429** avec un
en-tête `Retry-After` en secondes.

`trustProxy: true` est indispensable ici (`app.ts`) : derrière Caddy ou nginx,
`request.ip` vaudrait sinon l'adresse du proxy et le throttle regrouperait tous
les visiteurs sous une clé unique.

Limites assumées : la clé combine IP **et** identifiant, donc une attaque
distribuée sur un seul compte, ou une attaque locale qui fait tourner les
identifiants, n'est pas ralentie globalement. Pour une instance à quelques
comptes derrière un reverse-proxy, c'est le compromis retenu.

## Sessions

`packages/server/src/sessions.ts`. Identifiant de 32 octets aléatoires
(`randomBytes(32).toString('base64url')`), stocké en base avec sa date
d'expiration. TTL 30 jours. Purge horaire des sessions expirées par le minuteur
de `main.ts`.

Le cookie `gdv_session` est `httpOnly`, `sameSite: 'lax'`, **signé** avec
`SESSION_SECRET` via `@fastify/cookie`, et `secure` uniquement si `PUBLIC_URL`
commence par `https://` — sinon le navigateur ne le renverrait jamais en
développement local.

`sameSite: 'lax'` et non `strict` : le retour du callback OAuth est une
navigation entrante depuis `accounts.google.com`, et `strict` empêcherait le
cookie de partir, donc le callback échouerait sur un 401.

**Pourquoi pas un JWT.** Un JWT est valide jusqu'à son expiration, où qu'il se
trouve : le retirer suppose une liste de révocation, c'est-à-dire une table en
base — exactement ce qu'on cherchait à éviter. Ici la session _est_ la ligne en
base, donc :

- `POST /auth/logout` la supprime, l'accès est coupé au tir suivant ;
- le hook `onRequest` de `plugins/auth.ts` revérifie à **chaque requête** que le
  compte de la session existe encore en base, et détruit la session sinon. La
  configuration fait autorité, pas le cookie.

Quelles opérations d'administration ferment une session, et lesquelles ne le
font pas :

| Opération                  | Sessions    | Pourquoi                                                                                          |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| Supprimer un compte        | **fermées** | Le compte n'existe plus ; le hook les tuerait de toute façon, autant le faire tout de suite.      |
| Changer le mot de passe    | **fermées** | C'est la raison même du changement : le navigateur déjà connecté doit être coupé.                 |
| Retirer le rôle admin      | conservées  | Le compte reste légitime. `admin` est relu à chaque requête : `/api/admin/*` répond 403 aussitôt. |
| Modifier la liste d'albums | conservées  | Idem : `canSee()` est réévalué à chaque requête, l'accès retiré tombe au tir suivant.             |

Le coût est une lecture SQLite par requête — négligeable en process.

## Contrôle d'accès aux albums

Tout part de `ConfigRepo` : `albumsFor(username)` et `canSee(username, albumId)`,
exposés par `AppContext` sous les mêmes noms. Les droits d'un compte sont soit
une liste d'ids (table `user_albums`), soit le joker `*` (colonne `all_albums`),
qui couvre aussi les albums créés ensuite.

Les deux lectures passent par l'instantané mémoire de `ConfigRepo`, pas par
SQLite : `canSee()` est appelé sur chaque vignette d'une grille, une requête par
tuile serait un net recul.

Attribuer un album inexistant est refusé (**400 `unknown_album`**) — c'est la
vérification que faisait le chargement du YAML, presque toujours une faute de
frappe qui priverait silencieusement quelqu'un de son accès.

`admin: true` donne accès aux routes `/api/admin/*` et au callback OAuth. Ça ne
donne **pas** automatiquement tous les albums : le joker est un réglage distinct.

**Le dernier administrateur est protégé.** Le supprimer, ou lui retirer son rôle,
répond **409 `last_admin`** : sans lui, plus personne ne pourrait connecter
Drive, créer un compte, ni rendre le rôle à quiconque — l'instance deviendrait
inadministrable et il faudrait un accès shell pour la réparer.

## Contrôle d'accès aux médias : 404 et jamais 403

`routes/media.ts` installe deux `preHandler` sur tout le préfixe `/media` :
`requireAuth`, puis `authorize`. Ce dernier appelle
`media.albumsContaining(mediaId)` et accorde l'accès dès qu'un de ces albums est
visible par l'utilisateur.

La règle : **un refus répond 404, jamais 403.** Un 403 confirmerait que la
ressource existe, ce qui rendrait la structure des albums d'autrui observable par
sondage. La même réponse couvre donc trois cas indistinguables de l'extérieur :
média inexistant, média non indexé, média dans un album interdit. La règle vaut
aussi pour les albums : `GET /api/albums/:albumId` répond 404 sur un album
interdit comme sur un album inexistant.

`packages/server/test/access.test.ts` verrouille ce comportement sur
`/api/albums/prive`, `/items`, `/items/:mediaId` et les quatre routes média.

L'exception assumée : `/api/admin/*` répond **403** à un utilisateur connecté non
administrateur. L'existence de l'espace d'administration n'est pas un secret —
il est annoncé par le README et par un lien dans la barre supérieure.

## Chiffrement du refresh token

`packages/server/src/crypto.ts`. AES-256-GCM, clé dérivée par `scryptSync` d'un
sel tiré à chaque chiffrement. Format stocké :
`base64( salt(16) | iv(12) | tag(16) | ciphertext )`.

Le sel étant aléatoire, deux chiffrements du même jeton donnent deux chaînes
différentes — un observateur de la base ne peut pas déduire que le jeton n'a pas
changé.

Le modèle de menace est explicite : **un dump de `gdv.db` ne doit pas suffire à
accéder au Drive.** Il faut aussi `TOKEN_KEY`, qui vit dans l'environnement du
process et n'est jamais écrite en base. Le VPS n'est pas un HSM ; quelqu'un qui
obtient un shell dans le conteneur a les deux.

Si `TOKEN_KEY` change, le déchiffrement échoue sur le tag GCM.
`DriveService.authorizedClient()` traite ce cas en supprimant le jeton
irrécupérable et en journalisant le conseil : refaire le consentement depuis
`/admin`.

## Détection de `invalid_grant`

Google renvoie `invalid_grant` quand le refresh token n'est plus échangeable :
accès retiré depuis `myaccount.google.com`, six mois sans utilisation, ou
application repassée en statut « Test » (voir
[06](./06-configuration-et-deploiement.md)).

`DriveService.guard(operation)` enveloppe tout appel à Drive. `isRevocation`
reconnaît l'erreur sur **deux** emplacements — `error.response.data.error` et le
message — parce que sa forme varie selon qu'elle naît du rafraîchissement du
jeton ou d'un appel à l'API. Au déclenchement :

1. `revoked_at` est daté dans `oauth_token` (le jeton et le compte sont
   conservés) ;
2. le client OAuth en cache est jeté ;
3. une `DriveRevokedError` est levée à la place de l'erreur d'origine.

Ensuite, `authorizedClient()` échoue immédiatement sur `DriveRevokedError` sans
rappeler Google : inutile de retenter un jeton déjà refusé.
`Syncer.syncAll` interrompt la boucle sur cette erreur. `/admin` affiche
« Autorisation révoquée pour <compte> » plutôt que « non connecté », et propose
« Reconnecter ». Un nouveau consentement remet `revoked_at` à `NULL`.

Une coupure réseau ou un 500 de Google **ne** déclenche pas la révocation :
`packages/server/test/revocation.test.ts` le vérifie explicitement. Invalider la
connexion sur une erreur passagère imposerait un nouveau consentement pour rien.

## Consentement OAuth

- `GET /api/admin/oauth/start` exige une session administrateur, tire un `state`
  aléatoire de 24 octets, le dépose dans un cookie signé `gdv_oauth_state`
  (path `/api`, TTL 600 s) et renvoie l'URL de consentement.
- `authUrl()` demande `access_type: 'offline'` et `prompt: 'consent'` : sans ce
  dernier, une seconde autorisation ne renverrait pas de refresh token et la
  reconnexion échouerait sans que rien ne le dise.
- `GET /api/oauth/callback` **exige la même session administrateur** et compare
  le `state` reçu au cookie. Sans cette double vérification, un tiers pourrait
  faire aboutir un callback avec un code obtenu ailleurs et connecter _son_ Drive
  à cette instance. Les échecs redirigent vers `/admin?oauth=<raison>` plutôt que
  d'afficher une erreur brute.

Les scopes demandés sont `drive.readonly` (lecture de tout le Drive — nécessaire
pour pointer n'importe quel dossier sans avoir à le partager) et
`userinfo.email` (uniquement pour afficher le compte connecté dans `/admin` ;
son échec est ignoré).

## Ce que voit, et ne voit pas, un visiteur

| Voit                                                                                                       | Ne voit pas                                                 |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Les albums qui lui sont attribués, leur titre, description, couverture, nombre d'éléments, bornes de dates | L'existence des autres albums, y compris par sondage d'URL  |
| Les métadonnées et l'EXIF des médias de ses albums                                                         | Toute URL Google, tout id de dossier Drive, tout `folderId` |
| Les originaux de ses albums, en téléchargement                                                             | La liste des comptes, les réglages, l'état des synchros     |
| Son propre identifiant et son statut admin (`/auth/me`)                                                    | `/admin` (403) et le lien « Admin » de la barre, masqué     |

## Divers

- `noindex, nofollow` sur toutes les pages (`packages/web/index.html`).
- `bodyLimit: 64 * 1024` : seuls de courts JSON sont postés, les gros transferts
  sont sortants.
- Le gestionnaire d'erreurs global (`app.ts`) ne renvoie jamais le détail d'une
  500 — il peut contenir des chemins ou des identifiants. Le message reste dans
  les logs, la réponse dit « Erreur interne ».
- `safeEqual` (`crypto.ts`) fait une comparaison en temps constant tolérante aux
  longueurs différentes. Il n'est pas utilisé par le code de production
  actuel — le `state` OAuth est comparé par `unsignCookie` puis égalité stricte.
