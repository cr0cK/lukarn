# 04 — Sécurité et accès

## Trois choses distinctes, à ne pas confondre

|                  | Ce que c'est                                | Ce que ça ouvre                       |
| ---------------- | ------------------------------------------- | ------------------------------------- |
| **OAuth Google** | Le consentement du propriétaire             | La lecture de _son_ Drive, au serveur |
| **`users`**      | Une **clé d'accès**, possiblement partagée  | Les albums attribués                  |
| **`commenters`** | Une **personne**, adresse vérifiée par code | Le droit de signer un commentaire     |

La distinction entre les deux dernières est récente et structurante : un
identifiant confié à tout un foyer ne dit pas qui écrit. Voir D38.

## Les deux authentifications, à ne pas confondre

C'est la confusion la plus coûteuse du projet. Ce sont deux mécanismes sans
rapport, qui ne partagent ni stockage, ni durée de vie, ni population.

L'accès du serveur à Drive emprunte l'un de **deux** chemins, exclusifs :
`GOOGLE_SERVICE_ACCOUNT_FILE` renseigné, c'est le compte de service ; sinon,
OAuth. Le tableau ci-dessous décrit OAuth, qui reste le défaut ; le compte de
service a sa section plus bas.

|                 | OAuth Google                           | Identifiant / mot de passe       |
| --------------- | -------------------------------------- | -------------------------------- |
| Qui             | Le propriétaire du Drive, une personne | Chaque visiteur                  |
| Quand           | Une fois, à l'installation             | À chaque session (un an)         |
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

`packages/server/src/throttle.ts`, en mémoire. Chaque échec incrémente **trois**
compteurs, et c'est le plus contraignant des trois qui décide du blocage.

| Axe           | Clé                           | Essais libres | Ce qu'il attrape                                         |
| ------------- | ----------------------------- | ------------- | -------------------------------------------------------- |
| `couple`      | `<ip>` + `<identifiant>`      | 5             | Le cas normal : quelqu'un qui se trompe de mot de passe. |
| `identifiant` | `<identifiant en minuscules>` | 10            | Une attaque distribuée sur un compte précis.             |
| `ip`          | `<ip>`                        | 20            | Une même source qui fait tourner les identifiants.       |

Au-delà des essais libres, chaque axe applique le même barème : 2 s, puis
doublement (4, 8, 16 s…), plafonné à **15 minutes**. Une heure sans échec efface
la série (`RESET_AFTER_MS`).

L'axe `ip` n'existe pas pour la forme : sans lui, une adresse qui essaie des
milliers d'identifiants aléatoires ne crée que des compteurs à une tentative,
n'est jamais freinée, et obtient autant de vérifications argon2 — le calcul le
plus cher du serveur.

Une connexion réussie efface les compteurs `couple` et `identifiant`, **pas**
celui de l'IP : disposer d'un compte valide sur l'instance ne doit pas donner de
quoi remettre à zéro son budget de balayage entre deux rafales. Le blocage
répond **429** avec un en-tête `Retry-After` en secondes, et il est vérifié
**avant** toute vérification argon2.

La table est bornée à `MAX_ENTRIES = 20 000` entrées : au-delà, les séries
expirées puis les plus anciennes sont sacrifiées (retour à 90 % de la borne, pour
ne pas retrier à chaque tentative suivante). `LoginThrottle.purge()` est appelée
par le ménage horaire de `main.ts`, avec la purge des sessions expirées : sans
elle, les compteurs d'une rafale survivraient jusqu'au redémarrage.

`trustProxy` est indispensable ici (`app.ts`) : derrière Caddy, `request.ip`
vaudrait sinon l'adresse du proxy — tous les visiteurs seraient regroupés sous
une seule adresse, et l'axe `ip` bloquerait l'instance entière.

Sa valeur est une **liste**, `['loopback', 'uniquelocal']`, et pas `true`.
`true` fait confiance à n'importe quel `X-Forwarded-For`, y compris celui qu'un
client écrit lui-même : il suffirait alors d'en changer à chaque tentative pour
que les trois axes ci-dessus comptent chacun une seule occurrence, et le
throttle ne freinerait plus rien. Ne sont crus que les intermédiaires joignables
sur la boucle locale ou un réseau privé — c'est-à-dire nos propres proxys, le
seul chemin par lequel une requête arrive. Un en-tête venu d'une adresse
publique est ignoré, et `request.ip` retombe sur l'adresse de la connexion.

Cette protection ne dépend donc plus de la topologie du déploiement. Elle tenait
auparavant au seul fait que le port n'était publié que sur `127.0.0.1` : le jour
où quelqu'un retirait ce préfixe, le throttle devenait contournable sans que
rien ne le signale.

Limites assumées : les compteurs sont en mémoire, donc perdus au redémarrage, et
une attaque vraiment distribuée (une adresse par tentative, un identifiant par
tentative) n'est freinée par aucun des trois axes. Pour une instance à quelques
comptes derrière un reverse-proxy, c'est le compromis retenu.

## Sessions

`packages/server/src/sessions.ts`. Identifiant de 32 octets aléatoires
(`randomBytes(32).toString('base64url')`), stocké en base avec sa date
d'expiration. **TTL d'un an, repoussé dès que la session a passé sa mi-vie** :
en pratique on ne se déconnecte jamais tant qu'on utilise la galerie, et une
session vraiment abandonnée finit par s'éteindre. Purge horaire des sessions
expirées par le minuteur de `main.ts`.

Pourquoi pas d'expiration du tout, comme le mot « indéfiniment » le suggérait :
une session éternelle est un jeton de connexion permanent — volé une fois,
valable à vie — et la table grossirait sans que rien ne la nettoie. Attention au
vocabulaire au passage : un _cookie de session_ au sens HTTP, sans `maxAge`, est
celui qui meurt à la fermeture du navigateur, soit exactement l'inverse. Le
cookie posé ici est persistant. Repousser l'échéance à mi-vie plutôt qu'à chaque
requête ramène le coût à une écriture par visiteur et par semestre, au lieu
d'une par vignette.

Le cookie `gdv_session` est `httpOnly`, `sameSite: 'lax'`, **signé** avec
`SESSION_SECRET` via `@fastify/cookie`, et `secure` uniquement si `PUBLIC_URL`
commence par `https://` — sinon le navigateur ne le renverrait jamais en
développement local. Ses options sortent d'une seule fonction
(`sessionCookieOptions`), utilisée à la connexion **comme à la prolongation** :
deux jeux d'options qui divergeraient, c'est un cookie qui change de portée au
premier renouvellement.

Prolonger la session en base ne suffit pas : le cookie porte sa propre échéance,
que le navigateur applique sans rien savoir de la base. Le hook `onRequest` le
réémet donc dès que la lecture a repoussé l'expiration — sans quoi le visiteur
le plus assidu se retrouvait déconnecté un an après sa connexion, la
prolongation ne servant qu'à faire grossir `sessions`.

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

## Appairage d'un écran sans clavier

`packages/server/src/pairings.ts` pour l'état, `routes/auth.ts` pour les quatre
routes. Le raisonnement complet est en
[D260809c](./08-decisions/D260809c-approbation-ecran.md) ; ce qui suit est ce qui
touche à l'accès.

Un téléviseur n'a pas de caméra : c'est **lui** qui affiche le QR, et un
téléphone déjà connecté qui le scanne. L'appairage délègue donc un accès
existant, il n'en crée aucun — le mot de passe reste le seul chemin d'entrée
d'un premier appareil.

|                     | Ce que c'est                                      | Qui le voit                       |
| ------------------- | ------------------------------------------------- | --------------------------------- |
| `userCode`, 8 car.  | Le nom d'une demande en attente                   | L'écran, le QR, la pièce entière  |
| `deviceCode`, 32 o. | La preuve d'être l'appareil qui a fait la demande | Le demandeur, et personne d'autre |

Ce qui tient l'ensemble :

- **Le code affiché ne relève rien.** Seul le `deviceCode` permet de récupérer
  la session, et il n'apparaît jamais à l'écran. Sans cette séparation, une
  photo du téléviseur suffirait à prendre sa place.
- **Approuver exige une session** (`requireAuth`), et la session créée porte le
  compte de l'approbateur, avec ses albums — réévalués à chaque requête comme
  pour n'importe quelle session.
- **L'identité de commentateur ne suit pas.** L'écran appairé arrive sans
  identité, comme après une connexion au mot de passe : elle vaut pour la
  personne, pas pour la clé d'accès. Sans cette règle, le téléviseur du salon
  signerait du nom de celui qui a approuvé.
- **Un `deviceCode` ne vaut qu'une session** : la demande est supprimée à la
  relève, et un rejeu répond comme un code inconnu.
- **Cinq minutes**, puis la demande meurt. La purge horaire de `main.ts` efface
  ce que personne n'a relevé.
- **Un code inconnu, expiré ou déjà pris répond la même chose** — 404
  `unknown_code`. Distinguer « expiré » de « jamais existé » dirait à qui essaie
  des codes au hasard lesquels ont existé.
- **Les échecs comptent dans le throttle**, sur les trois mêmes axes que la
  connexion (`throttle.ts`), le code tenant lieu d'identifiant. Un sondage de
  codes est donc freiné exactement comme un sondage de mots de passe, et sans
  compteur de plus.
- **Le nombre de demandes en attente est borné** (`MAX_PENDING`). Au-delà, la
  route d'ouverture purge puis répond 429 : la table est en base, et une rafale
  de demandes ne doit pas la faire grossir sans fin. Personne n'y gagne un
  accès — au pire l'appairage devient indisponible le temps de la rafale, ce
  qu'une rafale obtiendrait de toute façon.

**Le risque assumé** est social, et aucun secret n'y change rien : faire scanner
à quelqu'un un QR qui n'est pas le sien lui fait donner son accès. La page
d'approbation affiche le code, qui doit correspondre à celui de l'écran qu'on
regarde ; la demande expire en cinq minutes ; et ce qui se donne est une clé
d'accès partagée, révocable en changeant son mot de passe — ce qui ferme toutes
ses sessions, y compris celle de l'écran.

`packages/server/test/device-pairing.test.ts` verrouille ces points.

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

**Le cache navigateur est cloisonné par session.** Les réponses média portent
`Vary: Cookie` en plus de `Cache-Control: private, …, immutable`. Sans lui, deux
comptes qui se succèdent dans le même profil de navigateur — l'ordinateur du
salon — partagent les mêmes entrées de cache : le second rouvre depuis
l'historique une photo d'un album qu'il n'a jamais eu le droit de voir, sans
qu'aucune requête n'atteigne `authorize()`. Ce que cet en-tête ne règle pas, et
qu'aucun autre ne réglerait, est décrit en D43.

## Identité de commentateur

`routes/identity.ts` et `commenters.ts`. Trois routes : déclarer une adresse et
un nom, valider le code reçu, oublier l'identité de cette session.

- **Le code est un HMAC en base** (`hashVerificationCode`), jamais le code en
  clair : un dump ne doit pas livrer de quoi valider une adresse. Il vit quinze
  minutes, tolère cinq essais, et ne peut être renvoyé qu'une fois par minute.
- **La vérification est ce qui empêche l'usurpation.** Sans elle, quiconque
  connaît le mot de passe partagé pourrait signer « Mamie », ou déclarer
  l'adresse d'un tiers pour lui faire recevoir les notifications.
- **Une demande de code ne renomme personne.** Le nom fourni pour une identité
  déjà vérifiée attend dans `pending_display_name` et n'est appliqué que par
  `verify`. Sans cela, la demande seule — que n'importe qui derrière la clé
  partagée peut faire pour l'adresse d'un autre — renommait sa signature sur
  tout son historique, le fil relisant le nom courant à chaque requête.
- **`POST /identity/request-code` répond `202` que l'adresse soit déjà connue ou
  non** : distinguer les deux dirait à qui l'essaie quelles adresses ont déjà
  commenté sur cette instance. Un `429` reste possible dans la minute qui suit un
  envoi — il ne révèle pas qu'une adresse est connue de l'instance, seulement
  qu'un code vient de partir vers elle, et la route n'est ouverte qu'à un compte
  authentifié.
- **La session mémorise l'identité, elle ne la définit pas.** L'identité est
  relue à chaque requête : une adresse supprimée retire le droit de commenter
  sans attendre une reconnexion — la session dure un an.
- **Sans SMTP, aucun code ne part**, donc personne ne peut s'identifier ni
  commenter. `SessionUser.commentsEnabled` le dit au front, qui l'annonce au lieu
  d'offrir un formulaire condamné à échouer.

## Commentaires : le fil est cloisonné comme l'album

`routes/comments.ts` refait le contrôle dans chaque handler au lieu de le poser
en `preHandler` de préfixe : l'album n'occupe pas ici un segment fixe de l'URL.
La règle reste celle des albums — 404 sur un album inconnu comme sur un album
interdit.

Les points qui tiennent ce cloisonnement :

- **Un fil appartient au couple `(albumId, mediaId)`.** Le même fichier Drive
  indexé sous deux albums porte deux conversations distinctes. Sans cela, un
  visiteur lirait dans son album les propos tenus dans un album qu'il n'a pas le
  droit d'ouvrir — le contrôle d'accès média porte sur les octets de la photo,
  pas sur ce qu'on en a dit.
- **`parentId` est vérifié contre le média courant.** Répondre à un commentaire
  suppose de prouver qu'il vit sur cette photo-là ; sinon un identifiant deviné
  suffirait à greffer un message dans un fil qu'on ne peut pas lire.
- **Supprimer exige de voir encore l'album.** Un visiteur dont l'accès vient
  d'être retiré conserverait sinon un droit d'écriture sur un contenu qu'il ne
  peut plus consulter. La même garde vaut pour la correction.
- **Corriger est réservé à l'auteur, et à lui seul.** Un administrateur peut
  masquer ou supprimer, jamais réécrire : mettre d'autres mots dans la bouche de
  quelqu'un sous son nom est un pouvoir d'une autre nature que celui de retirer
  un propos. La fenêtre de `COMMENT_EDIT_WINDOW_MS` (30 s) est contrôlée **côté
  serveur** — une règle que seul le front applique n'est pas une règle. Un délai
  dépassé répond **409 `edit_window_closed`**, ni 403 ni 404 : le refus porte sur
  l'état du message, pas sur un droit d'accès, et son auteur le voit déjà.
- **Commenter exige une identité vérifiée**, faute de quoi la route répond
  **403 `identity_required`**. C'est la seconde exception assumée au « 404 et
  jamais 403 » : ce refus ne porte pas sur une ressource d'autrui dont il
  faudrait cacher l'existence, mais sur l'état de son propre compte — il ne
  révèle rien.
- **L'adresse email n'apparaît jamais dans un fil.** Elle identifie et notifie ;
  seuls le nom déclaré et la modération y ont accès. Il en va de même de
  l'identifiant d'identité : `AdminComment` le porte pour que la modération
  puisse viser tous les messages d'une personne, `Comment` non — une clé stable
  dans un fil public permettrait de recoller ses messages d'un album à l'autre.

`packages/server/test/comments.test.ts` verrouille ces points, ainsi que
l'indistinguabilité des réponses 404 entre album interdit et album inexistant.

**Modération.** Un commentaire masqué disparaît de la lecture pour tout le monde,
**y compris son auteur** : le laisser croire que son message est encore lu serait
un mensonge par omission, et c'est ce qui sépare une modération assumée d'un
bannissement furtif. Masquer est réversible ; la suppression, elle, est
définitive et reste offerte à l'auteur comme à l'administrateur.

**Modération groupée.** `POST /api/admin/commenters/:commenterId/hide` retire
d'un coup tous les messages d'une identité, tous albums confondus — le geste
d'après une clé d'accès qui a trop circulé. Il ne crée aucun pouvoir nouveau :
c'est le même masquage, à la main duquel personne ne le ferait quinze fois. Il
reste réversible par le `show` symétrique, et **ne bannit pas** — l'identité peut
toujours écrire, ce qui est cohérent avec le refus du bannissement furtif
ci-dessus. Fermer la porte se fait en changeant la clé d'accès, que la file
affiche à côté de chaque message. `packages/server/test/moderation.test.ts`
vérifie que l'action ne déborde pas sur les autres identités et qu'elle répond
403 à un visiteur, jamais 404.

## Abonnement aux nouveautés d'un album

`subscriptions.ts` pour l'état, `notifier.ts` pour l'envoi,
`routes/subscriptions.ts` pour le désabonnement. Le raisonnement complet est en
[D41](./08-decisions/D41-on-s-abonne-aux-nouveautes-en-ouvrant-l-album.md) ; ce qui suit est ce qui touche à l'accès et au
consentement.

- **On s'abonne en ouvrant l'album**, sur la première page de
  `GET /api/albums/:albumId/items` — donc derrière `requireAuth` et derrière le
  contrôle d'album, exactement comme la lecture. Personne ne peut donc s'abonner
  à un album qu'il n'a pas le droit de voir.
- **Seule une identité vérifiée est abonnée.** La condition vit dans le SQL de
  `SubscriptionRepo.subscribe`, pas chez l'appelant : une adresse seulement
  déclarée peut être celle d'un tiers (D39), à qui cette galerie n'a rien à
  écrire.
- **Pas sur le détail d'un média.** Sinon cliquer « Voir la photo » depuis une
  notification de commentaire abonnerait aux nouveautés de l'album, ce que
  personne n'a demandé.
- **Un désabonnement survit à la réouverture de l'album.** C'est l'invariant le
  plus important de cette fonctionnalité : l'abonnement étant automatique, une
  simple ligne effacée serait recréée le lendemain. D'où l'état `opted_out` et
  l'`INSERT OR IGNORE` (voir [03](./03-modele-de-donnees.md)).
- **Le désabonnement est par album.** `commenters.notify` reste le commutateur
  global : il coupe les réponses aux commentaires **et** les annonces de
  nouveautés. Sans cette distinction, quelqu'un qui trouve « Noël 2019 » trop
  bavard couperait tout, et perdrait les réponses à ses propres commentaires —
  ce qu'il y a de plus précieux.
- **Le jeton de désabonnement couvre l'adresse et l'album**
  (`signAlbumUnsubscribeToken`). Sans l'album dans le message signé, le lien
  reçu pour un album vaudrait pour tous les autres. Comme celui des
  commentaires : sans expiration, sans session, comparé en temps constant.
- Un album ou une identité disparus depuis l'envoi rendent la page en le disant,
  plutôt qu'une erreur : le lien vit dans un email qu'on rouvre des mois plus
  tard.

`packages/server/test/subscriptions.test.ts` verrouille ces points, y compris
par l'API : la première page abonne, le détail d'un média non, une page suivante
non plus, et le jeton d'un album est refusé sur un autre.

**Lien de désabonnement.** `signUnsubscribeToken` (`crypto.ts`) produit un HMAC
de l'adresse avec `SESSION_SECRET`, comparé en temps constant. **Sans
expiration et sans session** : le lien vit dans un email qu'on rouvre des mois
plus tard, et un jeton périmé renverrait vers un écran de connexion quelqu'un qui
cherche précisément à ne plus être dérangé. Ce qu'il ouvre est sans gravité —
couper ses propres notifications — et se rétablit depuis /admin. Changer
`SESSION_SECRET` invalide les liens déjà envoyés, au même titre que les sessions.

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

## Limites de débit Drive

À distinguer de la révocation, qu'elles peuvent imiter : Google refuse une
requête de trop avec un `429`, ou un `403` dont **le corps** porte le motif.
`fetchAuthorized` réessaie jusqu'à quatre fois, en doublant l'attente (1 s, 2 s,
4 s…, plafond 30 s) ou en suivant le `Retry-After` annoncé quand il est là.

Le corps décide, pas le statut : un `403` est aussi ce que répond un fichier
auquel le compte n'a pas accès, et le réessayer quatre fois ne ferait que
retarder l'échec. `downloadQuotaExceeded` est exclu pour la même raison — ce
quota-là se compte en heures, attendre trente secondes n'y change rien.

Sans ce repli, chaque refus laisserait une vignette cassée qu'aucun mécanisme ne
rattrape. Il compte d'autant plus depuis le préchauffage (D45, dont D58 a
redéfini ce qui est téléchargé et quand), qui concentre les téléchargements au
lieu de les étaler sur les clics.

## Compte de service, en alternative au consentement

`GOOGLE_SERVICE_ACCOUNT_FILE` désigne la clé JSON d'un compte de service. Quand
elle est là, `DriveService.mode` vaut `service_account` et **rien d'autre n'est
lu** : ni `oauth_token`, ni `TOKEN_KEY`, ni `GOOGLE_CLIENT_*`. `auth.JWT`
échange la clé contre un access token et le renouvelle de lui-même.

Ce que ça change, et pourquoi c'est le chemin recommandé (D46) :

- **Plus d'écran « Google n'a pas validé cette application ».** `drive.readonly`
  est un scope _restreint_ : le faire lever demanderait la vérification de
  l'application par Google, avec audit de sécurité tiers.
- **Plus de refresh token**, donc plus rien à chiffrer, à renouveler, ni à
  perdre — `invalid_grant` après six mois d'inactivité disparaît avec lui.
- **Portée réduite.** `drive.readonly` donne la lecture de **tout** le Drive du
  propriétaire ; un compte de service ne voit que ce qui lui est explicitement
  partagé. C'est un gain de sécurité, et une contrainte : chaque dossier
  d'album doit être partagé en lecture avec l'adresse du compte de service,
  sans quoi sa synchronisation ne trouve rien.
- **La clé ne s'expire pas.** Elle se protège comme `TOKEN_KEY` : hors du dépôt,
  montée en lecture seule dans le conteneur.

Une clé désignée mais illisible **arrête le démarrage** (`env.ts`) au lieu de
retomber sur OAuth : basculer en silence ferait réapparaître l'écran de
consentement là où on venait de le supprimer, sans dire pourquoi. Un chemin non
monté dans le conteneur est l'erreur la plus probable, et elle doit se voir.

`/api/admin/oauth/start` et `/api/admin/drive/disconnect` répondent **409** dans
ce mode : le premier enregistrerait un jeton que rien n'utilise, le second
laisserait croire que l'instance est coupée alors qu'elle continue de tout lire.
/admin affiche à la place l'adresse du compte de service — c'est elle qu'on
recopie dans le partage Drive.

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
  à cette instance. Les échecs redirigent vers `/admin/serveur?oauth=<raison>` plutôt que
  d'afficher une erreur brute.

Les scopes demandés sont `drive.readonly` (lecture de tout le Drive — nécessaire
pour pointer n'importe quel dossier sans avoir à le partager) et
`userinfo.email` (uniquement pour afficher le compte connecté dans `/admin` ;
son échec est ignoré).

## Ce que voit, et ne voit pas, un visiteur

| Voit                                                                                                       | Ne voit pas                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Les albums qui lui sont attribués, leur titre, description, couverture, nombre d'éléments, bornes de dates | L'existence des autres albums, y compris par sondage d'URL                                                |
| Les métadonnées et l'EXIF des médias de ses albums                                                         | Toute URL Google, tout id de dossier Drive, tout `folderId`                                               |
| Les originaux de ses albums, en téléchargement                                                             | La liste des comptes, les réglages, l'état des synchros                                                   |
| Son propre identifiant et son statut admin (`/auth/me`)                                                    | `/admin` (403) et le lien « Admin » de la barre, masqué                                                   |
| —                                                                                                          | La télémétrie de visite : qui est venu, et ce que les autres ont regardé                                  |
| Les commentaires des photos de ses albums, et le nom affiché de leurs auteurs                              | Les commentaires portant sur un album qui ne lui est pas attribué, et ceux qu'un administrateur a masqués |

## Télémétrie de visite : ce qui est enregistré, et ce qui ne l'est pas

`packages/server/src/telemetry.ts` pour les compteurs, `device.ts` pour la classe
d'appareil. La mesure se fait **en base, côté serveur** : aucun script tiers, donc
aucune donnée qui sorte de l'instance pour ça (D260809h).

| Enregistré                                     | Non enregistré                        |
| ---------------------------------------------- | ------------------------------------- |
| La clé d'accès (`username`)                    | L'adresse IP                          |
| L'identifiant de session, déjà en base         | Le user-agent brut                    |
| L'album, le jour (UTC) et des compteurs        | Le média ouvert, un par un            |
| La classe d'appareil : mobile/tablette/ordi/TV | Le référent, la résolution, la langue |

Deux points portent tout le reste :

- **La classe d'appareil est déduite du user-agent à la création de la session,
  puis le user-agent est jeté.** Il est une empreinte — version de navigateur,
  d'OS, modèle — quand une valeur parmi quatre ne ré-identifie personne. Le
  distinguo est ce qui permet de savoir depuis quoi la galerie est regardée sans
  pouvoir séparer deux personnes derrière une clé partagée.
- **Jamais le média.** Compter photo par photo produirait l'historique de lecture
  de quelqu'un, dans une application où un mot de passe est partagé par tout un
  foyer. Les compteurs s'arrêtent à « combien de photos ouvertes dans cet album
  ce jour-là ».

La lecture est réservée aux administrateurs : `GET /api/admin/visits` est sous le
`requireAdmin` de préfixe, comme le reste (voir [05](./05-api.md)). La rétention
est de quatre cents jours, par la purge horaire de `main.ts`.

## Ce qui sort de l'instance

Trois destinations, et seulement trois. Les connaître importe pour une
application dont la promesse est que rien ne fuit.

| Destination                     | Ce qui part                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Google Drive                    | Les requêtes d'indexation et de téléchargement, avec le jeton du propriétaire      |
| Le relais SMTP                  | Codes de vérification, notifications de commentaires, annonces de nouvelles photos |
| `GEOCODING_URL` (Nominatim/OSM) | Des **coordonnées arrondies au centième de degré**, et rien d'autre                |

Le géocodage mérite d'être explicité, parce qu'il envoie une donnée des photos à
un tiers. Ce qui part est une cellule `lat,lng` arrondie à deux décimales, soit
un point à environ un kilomètre près : jamais un identifiant de fichier, jamais
une date, jamais un nom d'album, et jamais une position exacte. Le service ne
peut donc pas reconstituer un déplacement, et deux séjours au même endroit ne
produisent qu'une requête grâce au cache `geo_places`. `GEOCODING_URL` accepte
une instance Nominatim privée, et une valeur vide coupe entièrement cette
sortie — les journées gardent alors leurs grappes, sans libellé.

## En-têtes de sécurité

`packages/server/src/plugins/headers.ts`, enregistré **avant** tout le reste
dans `app.ts`. Le hook est `onRequest` : à ce stade aucune route n'a répondu,
donc aucune ne peut oublier les en-têtes — pas même celles que
`@fastify/static` sert sans passer par un gestionnaire à nous, ni les 404 et
les 500.

| En-tête                     | Valeur                             | Ce qu'il empêche                                                                                   |
| --------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`   | voir ci-dessous                    | L'exécution d'un script injecté, l'exfiltration vers une origine tierce, l'encadrement de la page. |
| `X-Content-Type-Options`    | `nosniff`                          | Qu'un navigateur devine un type MIME et exécute comme script ce qui est servi comme autre chose.   |
| `X-Frame-Options`           | `DENY`                             | Le clickjacking sur les navigateurs qui ne connaissent pas `frame-ancestors`.                      |
| `Referrer-Policy`           | `no-referrer`                      | Qu'un identifiant Drive, présent dans une URL de média, parte dans les journaux d'un site tiers.   |
| `Strict-Transport-Security` | `max-age=15552000`, **si `https`** | Le retour en clair, et l'interception au premier accès sur un réseau hostile.                      |

La CSP tient en une ligne dont une seule directive fait le travail :
`script-src 'self'`. C'est elle qui rend inexploitable un `<script>` glissé dans
un titre d'album ou un commentaire — React échappe déjà ce qu'il affiche, la CSP
est la seconde barrière, celle qui tient si la première cède. Le reste ferme les
portes voisines : `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`,
`frame-ancestors 'none'`, `connect-src 'self'`.

Deux tolérances, et leur raison :

- **`style-src 'unsafe-inline'`.** React pose ses styles par la propriété
  `style` du DOM, que la CSP ne filtre pas ; mais Vite peut inliner une petite
  feuille au build, et une CSP qui casse la mise en page à la prochaine mise à
  jour de l'outillage finit désactivée. Le style en ligne ne permet pas
  d'exécuter du code.
- **`img-src 'self' data:`.** Vite inline en `data:` les images de moins de
  4 ko.

**HSTS n'est posé que si `PUBLIC_URL` commence par `https://`.** Le poser
inconditionnellement condamnerait un navigateur ayant visité une instance de
développement à réclamer du HTTPS à `localhost` pendant six mois, sans moyen
simple de revenir en arrière. Le `max-age` est de six mois et non de deux ans,
et sans `preload` : assez pour que la protection serve, assez court pour qu'une
instance qui perdrait son certificat redevienne joignable dans un délai humain.

Ces en-têtes viennent de l'**application**, pas du frontal. Ils valent donc en
développement, dans les tests, et derrière un proxy que personne n'a pensé à
configurer — un `Caddyfile` remplacé par un `nginx.conf` ne les emporte pas avec
lui (D47).

## Divers

- `noindex, nofollow` sur toutes les pages (`packages/web/index.html`).
- `bodyLimit: 64 * 1024` : seuls de courts JSON sont postés, les gros transferts
  sont sortants.
- Le gestionnaire d'erreurs global (`app.ts`) ne renvoie jamais le détail d'une
  500 — il peut contenir des chemins ou des identifiants. Le message reste dans
  les logs, la réponse dit « Erreur interne ».
- `safeEqual` (`crypto.ts`) fait une comparaison en temps constant tolérante aux
  longueurs différentes. Il sert aux jetons de désabonnement et aux codes de
  vérification ; le `state` OAuth, lui, est comparé par `unsignCookie` puis
  égalité stricte.
