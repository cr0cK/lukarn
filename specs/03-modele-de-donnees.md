# 03 — Modèle de données

Base unique : `${DATA_DIR}/gdv.db`, ouverte par `packages/server/src/db.ts`.

## Pragmas

| Pragma                 | Raison                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `journal_mode = WAL`   | Les lectures de la grille ne bloquent pas la sync qui écrit en fond.                                     |
| `synchronous = NORMAL` | Compromis durabilité/débit acceptable : l'index est reconstructible.                                     |
| `foreign_keys = ON`    | Indispensable depuis la migration 3 : c'est lui qui fait jouer les `ON DELETE CASCADE` de `user_albums`. |
| `busy_timeout = 5000`  | Une écriture concurrente attend au lieu de renvoyer `SQLITE_BUSY`.                                       |

## Tables

### `media`

L'index. Une ligne = un fichier Drive **dans un album**.

| Colonne                                                                                                       | Type    | Note                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `album_id`                                                                                                    | TEXT    | Id de l'album, tel qu'il figure dans la table `albums`. Pas de clé étrangère : l'index est nettoyé explicitement (voir plus bas).     |
| `id`                                                                                                          | TEXT    | Id du fichier Drive.                                                                                                                  |
| `name`                                                                                                        | TEXT    | Nom du fichier ; sert au `Content-Disposition` du téléchargement.                                                                     |
| `mime_type`                                                                                                   | TEXT    | Renvoyé tel quel sur `/original`.                                                                                                     |
| `kind`                                                                                                        | TEXT    | `CHECK (kind IN ('photo','video'))`.                                                                                                  |
| `size`                                                                                                        | INTEGER | Nullable : Drive ne déclare pas toujours une taille.                                                                                  |
| `width` / `height`                                                                                            | INTEGER | **Déjà corrigées de la rotation EXIF** par `toUpsert`. C'est ce qui permet au front de calculer la mise en page sans charger d'image. |
| `taken_at`                                                                                                    | TEXT    | ISO 8601 UTC. Photo : date EXIF si connue, sinon `modifiedTime`. Vidéo : reconstruite depuis le fichier — voir ci-dessous.            |
| `taken_at_from_exif`                                                                                          | INTEGER | 0/1. Le front écrit « Prise de vue » ou « Modifié le » selon la valeur. À 1 dès que la date vient du fichier, EXIF ou conteneur.      |
| `modified_time`                                                                                               | TEXT    | ISO 8601. Écrit à chaque sync, jamais relu — conservé, voir « Colonnes écrites et jamais relues » plus bas.                           |
| `duration_ms`                                                                                                 | INTEGER | Vidéos seulement.                                                                                                                     |
| `camera_make`, `camera_model`, `lens`, `iso_speed`, `exposure_time`, `aperture`, `focal_length`, `lat`, `lng` |         | EXIF, tous nullables. Servis par `/items/:mediaId`.                                                                                   |
| `md5`                                                                                                         | TEXT    | Empreinte du contenu Drive. Porte la version des URL et des ETag, et entre dans la clé du cache disque.                               |
| `has_thumbnail`                                                                                               | INTEGER | 0/1, le `hasThumbnail` de Drive. Décide si une **vidéo** a une vignette — voir ci-dessous.                                            |
| `seen_at`                                                                                                     | TEXT    | Estampille de la sync qui a vu cette ligne. Base de `deleteStale`.                                                                    |
| `added_at`                                                                                                    | TEXT    | Date d'entrée dans l'index, écrite à l'INSERT et **jamais** par le `ON CONFLICT DO UPDATE`. Nullable — voir ci-dessous.               |
| **PK**                                                                                                        |         | `(album_id, id)`                                                                                                                      |

**`has_thumbnail` ne concerne en pratique que les vidéos.** Une photo a toujours
un rendu — le pipeline la décode, et retombe sur l'aperçu Drive quand libvips ne
la lit pas —, alors qu'une vidéo n'a d'image que si Drive en a produit une de sa
première seconde ([08](./08-decisions.md), D92). L'API n'expose donc pas la
colonne mais la question qu'on lui pose : `MediaItem.hasPreview`, calculé par
`toItem()` comme `kind === 'photo' || has_thumbnail === 1`. Le front demande une
vignette « quand il y en a une », sans rejouer la règle photo/vidéo de son côté.

**`taken_at` d'une vidéo ne vient pas de Drive.** `videoMediaMetadata` se limite
à `{width, height, durationMillis}` : aucune date de prise de vue. La sync lit
donc le `creation_time` du conteneur par quelques requêtes `Range`, et le
confronte à l'horodatage du nom du fichier — `resolveVideoTakenAt`, quatre
règles décrites en [08](./08-decisions.md), D97. `taken_at_from_exif` vaut 1
dans les trois premières et 0 dans la dernière, celle où seule la date de
téléversement restait : le panneau écrit alors « Modifié le », qui est
exactement ce qu'on sait. Aucune migration n'accompagne ce changement — la sync
ré-upserte chaque fichier, et une vidéo déjà datée depuis son fichier n'est
relue que si son `md5` a bougé.

**`added_at` n'est pas un doublon de `seen_at`, et c'est le piège de la
migration 5.** `seen_at` est réécrit sur _tous_ les médias à chaque passage de
la synchronisation, y compris ceux déjà connus : compter les nouveautés dessus
compterait l'album entier, toutes les demi-heures. `added_at`, lui, ne bouge
plus une fois posé — ce qui rend `WHERE added_at > ?` fiable, et c'est ce que
lit `MediaRepo.countAddedSince`.

Corollaire assumé : les lignes indexées **avant** la migration 5 restent à
`NULL`, donc exclues de toute comparaison. C'est voulu — sans quoi la première
annonce de nouveautés parlerait de l'historique entier de la galerie.

### `sync_state`

Une ligne par album : `album_id` (PK), `last_sync_at`, `status`
(`never` \| `running` \| `ok` \| `error`), `error`, `notified_at`.

`status` et `error` sont écrasés à chaque tentative, mais `last_sync_at` n'est
mis à jour qu'en cas de succès (`drive/sync.ts`) : `/admin` peut donc afficher
« en erreur, dernière synchro réussie il y a 3 h ».

`notified_at` porte la date des dernières nouveautés annoncées par email
(`notifier.ts`). `SyncStateRepo.set()` ne la touche jamais : elle survit donc
aux synchronisations comme à leurs échecs, faute de quoi une sync ratée ferait
tout réannoncer. `NULL` signifie « jamais annoncé », et la première exécution du
notifieur pose la borne **sans rien envoyer**.

### `oauth_token`

Une seule ligne, garantie par `CHECK (id = 1)`. Colonnes : `ciphertext` (le
refresh token chiffré, voir [04](./04-securite-et-acces.md)), `account` (courriel
affiché dans `/admin`), `scope`, `granted_at`, `revoked_at`.

`revoked_at` non nul signifie « Google a refusé le jeton ». La ligne est
**conservée** plutôt que supprimée : une table vide se lirait comme une
installation neuve, alors qu'ici il faut dire à l'administrateur _quel_ compte a
perdu son autorisation.

### `sessions`

`id` (PK, 32 octets aléatoires en base64url), `username`, `created_at`,
`expires_at`. TTL d'un an (`sessions.ts`), repoussé d'autant dès qu'une session
passe sa mi-vie — le cookie est réémis en même temps, sans quoi le navigateur
jetterait le sien à la date d'origine et la prolongation ne servirait à rien.

### `users`, `albums`, `user_albums`, `settings`

La configuration : qui se connecte, quels dossiers Drive sont exposés, et les
réglages. Écrites **uniquement** par `ConfigRepo` (`config-repo.ts`).

| Table         | Colonnes                                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`       | `username` (PK, `COLLATE NOCASE`), `password_hash`, `admin`, `all_albums`, `created_at`, `updated_at`                                           |
| `albums`      | `id` (PK), `title`, `description`, `folder_id`, `recursive`, `group_by`, `sort_order`, `cover_media_id`, `position`, `created_at`, `updated_at` |
| `user_albums` | `username`, `album_id`, PK composite, deux clés étrangères `ON DELETE CASCADE`                                                                  |
| `settings`    | `key` (PK), `value` — JSON. Clés : `syncIntervalMinutes`, `syncOnStartup`, `cacheMaxSizeGB`, `prewarmCache`, `moderationEmail`                  |

Quatre choix à connaître :

- **`COLLATE NOCASE` sur `users.username`.** Le login est insensible à la casse
  depuis toujours ; l'unicité devait l'être aussi, sinon « Alexis » et « alexis »
  coexisteraient et la connexion en désignerait un au hasard. La collation donne
  les deux à la fois : la casse saisie est stockée et affichée telle quelle,
  l'index qui porte la clé primaire compare sans la casse. Une seconde colonne en
  minuscules aurait fait le même travail au prix d'un risque de désynchronisation
  entre les deux. NOCASE ne replie que l'ASCII — ce que `USERNAME_PATTERN` est le
  seul à accepter.
- **Le joker `*` est un booléen `all_albums`, pas une ligne de liaison.** Une
  ligne `album_id = '*'` demanderait un album fictif pour satisfaire la clé
  étrangère, ou d'y renoncer. Surtout, le joker doit couvrir les albums **créés
  plus tard** : une liste de liaisons figée ne le ferait pas.
- **`position`** porte l'ordre d'affichage. `created_at` ne le restituerait pas :
  l'amorçage crée tous les albums dans la même milliseconde.
- **`group_by`** (`CHECK (group_by IN ('month', 'day'))`, défaut `month`) est le
  découpage appliqué à l'ouverture de l'album. Il vivait uniquement dans l'URL,
  c'est-à-dire nulle part : un séjour se lit par jour, dix ans de photos
  d'enfants par mois, et rouvrir l'album redonnait le défaut global à chaque
  fois. Le paramètre `?group=` continue de primer — c'est une préférence, pas
  une contrainte.
- **`sort_order`** (`CHECK (sort_order IN ('desc', 'asc'))`, défaut `asc`) est le
  sens de lecture appliqué à l'ouverture, pour la même raison que `group_by` : un
  séjour se raconte du premier jour au dernier, une bibliothèque qu'on alimente
  au fil de l'eau se lit par la fin. Le paramètre `?order=` prime, et le
  navigateur retient par album ce que son lecteur a choisi — la colonne n'est que
  le troisième recours (voir [07](./07-frontend.md) et D99).
- **`cover_media_id`** est la photo choisie comme couverture, `NULL` pour la plus
  récente automatiquement. Aucune clé étrangère vers `media`, pour la même raison
  que `comments.media_id` : `deleteStale` retire une ligne dès qu'une
  synchronisation ne la revoit pas, et une cascade effacerait le choix sur un
  contretemps d'indexation. Le repli est donc calculé à la lecture, par
  `MediaRepo.stats(albumId, chosenId)` : la photo absente de l'index — ou qui est
  une vidéo — rend la main à la plus récente sans que le choix soit effacé. Une
  vidéo a bien une vignette depuis D92, mais celle-ci appartient à Drive et peut
  manquer, or la couverture est la seule image dont l'absence se voit depuis la
  page d'accueil, sans repli. L'identifiant Drive étant stable, la
  photo revenue redevient la couverture.
- **`created_at` / `updated_at` sont écrits par l'application**, en ISO 8601 UTC,
  pas par `CURRENT_TIMESTAMP` qui produirait un format différent du reste de la
  base.
  **Aucune adresse email sur `users`, et c'est délibéré.** Un compte est une clé
  d'accès, pas quelqu'un de joignable : le même identifiant peut être partagé par
  tout un foyer. Les adresses appartiennent à `commenters` ci-dessous, et
  l'adresse prévenue des nouveaux commentaires est un réglage d'instance
  (`settings.moderationEmail`).

### `commenters`

Une **personne**, par opposition à la clé d'accès de `users`.

| Colonne                                                         | Rôle                                          |
| --------------------------------------------------------------- | --------------------------------------------- |
| `id`                                                            | PK, `AUTOINCREMENT`                           |
| `email`                                                         | `NOT NULL UNIQUE COLLATE NOCASE` — l'identité |
| `display_name`                                                  | Nom qui signe les commentaires                |
| `notify`                                                        | Désabonnement                                 |
| `verified_at`                                                   | `NULL` tant que le code n'a pas été saisi     |
| `code_hash`, `code_expires_at`, `code_sent_at`, `code_attempts` | La vérification en cours                      |
| `pending_display_name`                                          | Renommage demandé, en attente du code         |

Cinq choix à connaître :

- **L'adresse EST l'identité.** Se ré-identifier avec la même, depuis un autre
  appareil ou après avoir vidé ses cookies, retrouve ses commentaires — et le
  droit de les supprimer. Sans cette clé stable, chaque navigateur créerait une
  personne de plus, et plus personne ne pourrait effacer ses propres messages.
- **`verified_at` n'est pas décoratif.** L'identité est déclarative : n'importe
  qui derrière la clé d'accès partagée pourrait signer du nom d'un autre, ou
  faire arriver les notifications dans la boîte d'un tiers. Le code envoyé par
  email est ce qui l'empêche.
- **`code_hash` et jamais le code en clair.** Un HMAC coûte moins qu'une requête
  SQL, et un dump de la base ne doit pas livrer de quoi valider une adresse.
- **`code_sent_at` et `code_attempts` sont des garde-fous, pas des traces.** Le
  premier interdit de renvoyer un code dans la minute — sinon le formulaire
  devient une machine à expédier des emails vers une adresse qu'on ne possède
  pas ; le second plafonne à cinq essais, six chiffres se parcourant en un
  million de tentatives.
- **`pending_display_name` retient un renommage jusqu'à la preuve.** Le nom
  d'une identité **déjà vérifiée** ne change qu'à la validation du code, jamais
  à la demande : sinon, connaître l'adresse de quelqu'un suffisait à le
  renommer, et comme la signature d'un commentaire est relue à chaque requête,
  tout son historique changeait de nom sans qu'un seul code ait été saisi. Une
  identité pas encore vérifiée s'écrit directement — rien n'est signé d'elle.

`sessions` porte un `commenter_id` (`ON DELETE SET NULL`) : la session
**mémorise** l'identité, elle ne la définit pas. Perdre son identité ne coupe
donc jamais l'accès aux albums, qui ne vient que de la clé d'accès.

### `comments`

Un fil de discussion par média **et par album**.

| Colonne                  | Rôle                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | PK, `AUTOINCREMENT`                                                                                                                           |
| `album_id`, `media_id`   | Le couple auquel le fil appartient                                                                                                            |
| `parent_id`              | `NULL` pour une racine, sinon l'id de la racine — jamais plus profond                                                                         |
| `commenter_id`           | L'**auteur**, FK vers `commenters` `ON DELETE CASCADE` — une personne, pas une clé d'accès                                                    |
| `account`                | La clé d'accès utilisée pour écrire, `COLLATE NOCASE`, FK vers `users` `ON DELETE SET NULL` — gardée pour la modération                       |
| `body`                   | Le message. **Seule colonne réécrite après coup**, et seulement par son auteur dans les 30 s (D57)                                            |
| `created_at`             | Date de publication. Ne bouge **jamais**, y compris après correction : le message doit garder sa place dans un fil que d'autres lisaient déjà |
| `hidden_at`, `hidden_by` | Modération a posteriori                                                                                                                       |

Les choix structurants :

- **`AUTOINCREMENT` plutôt que le rowid ordinaire.** SQLite réattribue sinon
  l'identifiant d'une ligne supprimée. Les emails de notification portent un lien
  vers un commentaire et survivent des mois dans une boîte aux lettres : un id
  recyclé ferait pointer un vieux message vers la conversation de quelqu'un
  d'autre. C'est aussi ce qui rend l'ordre des id égal à l'ordre d'écriture, donc
  le tri et la pagination possibles sur un simple entier.
- **Le fil appartient au couple `(album_id, media_id)`.** Un même fichier Drive
  indexé sous deux albums porte deux conversations. Les réunir montrerait à un
  visiteur les propos tenus dans un album qu'il n'a pas le droit de voir, ce qui
  contredirait le cloisonnement de [04](./04-securite-et-acces.md).
- **Aucune clé étrangère vers `media`.** `deleteStale` retire une photo dès
  qu'une synchronisation ne la revoit pas — dossier renommé, sync interrompue,
  passage par la corbeille Drive. Une cascade détruirait des commentaires sur un
  simple contretemps d'indexation, alors que l'identifiant Drive est stable : la
  photo revenue retrouve son fil. Le prix est un commentaire orphelin possible,
  que la modération affiche sans nom de fichier.
- **`parent_id` en `ON DELETE SET NULL`, pas `CASCADE`.** Supprimer une identité
  emporte ses messages (cascade sur `commenter_id`), mais les réponses que
  d'autres y ont écrites leur appartiennent : elles remontent en tête de fil
  plutôt que de disparaître avec lui.
- **`account` en `ON DELETE SET NULL`.** C'est la clé d'accès utilisée au moment
  d'écrire, gardée pour la modération : elle dit par quel mot de passe partagé un
  message gênant est arrivé, donc lequel changer. Supprimer un compte ne doit pas
  emporter des commentaires qui ne lui appartiennent pas — ils appartiennent à
  leur auteur.
- **`album_id` en `ON DELETE CASCADE`.** Supprimer un album emporte ses
  commentaires : ils désignaient un contenu qui n'est plus exposé.

### `album_subscriptions`

Qui veut être prévenu des nouvelles photos d'un album. Écrite par
`subscriptions.ts`, lue par `notifier.ts`.

| Colonne        | Rôle                                     |
| -------------- | ---------------------------------------- |
| `commenter_id` | La personne. FK `ON DELETE CASCADE`      |
| `album_id`     | L'album. FK `ON DELETE CASCADE`          |
| `state`        | `CHECK (state IN ('auto', 'opted_out'))` |
| `created_at`   | Date de la première ouverture de l'album |
| **PK**         | `(commenter_id, album_id)`               |

Deux choix à connaître :

- **Un état, et non la simple présence d'une ligne.** L'abonnement étant
  automatique (D41), effacer la ligne au désabonnement la ferait recréer à la
  réouverture de l'album le lendemain — précisément ce qui fait détester un
  service. L'inscription s'écrit `INSERT OR IGNORE`, qui laisse intacte une
  ligne déjà `opted_out`.
- **La vérification est portée par le SQL.** L'inscription est un
  `INSERT … SELECT … WHERE verified_at IS NOT NULL` : une adresse seulement
  déclarée peut être celle d'un tiers, et cette galerie n'a rien à lui écrire.

### `album_days` et `geo_places`

Ce qu'on a fait un jour donné, et où. Écrites par `places.ts` (les lieux
déduits) et par l'API d'administration (la saisie) ; `geo_places` est le cache
du géocodeur (`geocoder.ts`).

| Table        | Colonnes                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| `album_days` | `album_id` (FK `ON DELETE CASCADE`), `day`, `description`, `place`, `cells`, `updated_at`, PK `(album_id, day)` |
| `geo_places` | `cell` (PK), `label`, `fetched_at`                                                                              |

Quatre choix à connaître :

- **`day` est un jour UTC `YYYY-MM-DD`**, exactement la clé que `dayKey()`
  calcule côté front. Un jour local ferait basculer de section une photo de
  23 h 30, et la note se retrouverait sur la mauvaise journée.
- **`place` et `cells` sont deux colonnes, pas une.** `cells` est déduit de
  l'EXIF et réécrit à chaque passage ; `place` est saisi à la main et **prime**.
  Un libellé figé une fois pour toutes obligerait à choisir entre ne jamais
  recalculer les journées et rappeler Nominatim à chaque passage — séparées, le
  recalcul est gratuit et les libellés s'allument tout seuls quand ils arrivent
  (voir [08](./08-decisions.md), D48).
- **Le recalcul n'écrase jamais une saisie.** `replaceCells` fait un
  `DO UPDATE SET cells = excluded.cells` **et rien d'autre** : un
  `excluded.description` glissé là effacerait, à chaque ménage horaire, tout ce
  que l'administrateur a écrit. Une journée dont les photos positionnées
  disparaissent de l'index perd ses `cells` ; sa note, elle, survit — la journée
  a bien eu lieu.
- **`geo_places.label = NULL` n'est pas un échec.** C'est un géocodage abouti
  sans résultat exploitable — pleine mer, désert — et la ligne existe
  précisément pour ne plus redemander. Un échec réseau, lui, n'écrit **aucune
  ligne** et sera retenté au passage suivant. Le cache est partagé entre albums :
  deux séjours au même endroit ne comptent qu'un appel.

`settings` porte des valeurs JSON et les défauts vivent dans le code
(`DEFAULT_SETTINGS`) : une clé absente n'est pas une anomalie, et ajouter un
réglage ne demande pas de migration.

**Cache mémoire.** `canSee()` est appelé à chaque requête média, donc sur chaque
vignette d'une grille. `ConfigRepo` tient un instantané en mémoire (albums,
comptes, droits, réglages), reconstruit à la première lecture qui suit une
écriture. Étant le seul écrivain de ces quatre tables, il ne peut pas servir un
instantané périmé.

### `media_notes`

Ce qui se passe sur **une** photo. L'album dit où l'on était, la journée ce
qu'on y a fait ; « Léa saute du ponton, troisième essai » ne se déduit ni du nom
de fichier, ni de l'EXIF, ni de la note du jour. Écrite par `MediaRepo`, la
seule classe qui possède cette table.

| Table         | Colonnes                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| `media_notes` | `album_id` (FK `ON DELETE CASCADE`), `media_id` (**sans FK**), `description`, `updated_at`, PK `(album_id, media_id)` |

Quatre choix à connaître :

- **La portée est l'album, pas le fichier Drive.** Le même fichier indexé sous
  deux albums porte deux descriptions, exactement comme il porte deux fils de
  commentaires. Les confondre montrerait à un visiteur ce qui a été écrit dans
  un album qu'il ne peut pas ouvrir (D12).
- **Aucune clé étrangère vers `media`**, pour la raison de `comments.media_id` et
  d'`albums.cover_media_id` : `deleteStale` retire une photo dès qu'une
  synchronisation ne la revoit pas — corbeille Drive le temps d'un retour en
  arrière, dossier renommé, sync interrompue. Une cascade détruirait sur un
  contretemps d'indexation un texte écrit à la main, que rien ne régénère.
  L'identifiant Drive est stable : la photo revenue retrouve sa description
  (voir [08](./08-decisions.md), D83).
- **Aucun ménage n'y touche.** Ni `deleteStale`, ni `clearAlbum`, ni
  `pruneAlbums`, ni le `ON CONFLICT DO UPDATE` d'`upsertMany` — même invariant
  que `AlbumDayRepo` : le passage de fond n'écrase jamais une saisie. La seule
  suppression vient de la cascade sur `albums`, c'est-à-dire de la suppression
  de l'album lui-même.
- **Une ligne vide n'existe pas.** `setDescription` fait un `DELETE` quand la
  valeur reçue est `null`, vide ou blanche : la garder ferait grossir la table
  sans rien dire de plus qu'une ligne absente.

`listItems` et `getDetail` lisent la description par un
`LEFT JOIN media_notes ON (album_id, media_id)`. Le `SELECT` devient `media.*` :
les deux tables portent une colonne `album_id`, et une étoile nue rendrait la
ligne ambiguë à la lecture. La jointure est **1-pour-1** sur la clé primaire de
`media_notes` — elle ne duplique ni ne perd de ligne, donc la pagination par
curseur est inchangée, ce que `packages/server/test/media-notes.test.ts`
verrouille en paginant un album dont deux photos sur cinq sont décrites.

Vidéos comprises, contrairement à la couverture : une vidéo mérite une légende,
et rien dans le pipeline ne s'y oppose.

### Les quatre tables FTS5 de recherche

Ce qui rend « où sont les photos de Marseille » interrogeable. Elles sont créées
par la **migration 11** et lues par `SearchRepo` (`search.ts`) ; personne ne les
écrit depuis le code.

| Table             | Colonnes indexées      | Contenu externe |
| ----------------- | ---------------------- | --------------- |
| `albums_fts`      | `title`, `description` | `albums`        |
| `album_days_fts`  | `description`, `place` | `album_days`    |
| `media_notes_fts` | `description`          | `media_notes`   |
| `geo_places_fts`  | `label`                | `geo_places`    |

Toutes en `content='<table>', content_rowid='rowid'` — **contenu externe** : la
table FTS ne stocke que l'index, jamais une copie du texte, et se joint à sa
table d'origine par `rowid`.

Quatre choix à connaître :

- **Ce sont des déclencheurs SQL qui les tiennent, pas du code applicatif.**
  Trois par table (`_ai`, `_ad`, `_au`), forme documentée de FTS5 : la
  suppression passe par `INSERT INTO x_fts(x_fts, rowid, …) VALUES('delete', …)`
  avec les **anciennes** valeurs, seule façon pour FTS5 de retrouver les termes à
  retirer d'une ligne qui n'existe plus. Ces textes s'écrivent depuis six
  endroits — `ConfigRepo.saveAlbum`, `AlbumDayRepo.upsertNote` et
  `.replaceCells`, `Geocoder`, `MediaRepo.setDescription`, et les cascades sur
  `albums`. Réindexer depuis le code demanderait de n'en oublier aucun,
  aujourd'hui et dans tout chemin d'écriture écrit plus tard ; un index périmé ne
  se voit pas, il rend simplement moins de résultats
  ([08](./08-decisions.md), D96).
- **Les déclencheurs `AFTER DELETE` couvrent les suppressions en cascade.**
  Supprimer un album emporte ses journées et ses descriptions de photo par
  `ON DELETE CASCADE`, et l'index suit sans qu'aucun `DELETE` n'ait été écrit —
  vérifié sur `better-sqlite3@12.11.1` (SQLite 3.53.2), `integrity-check`
  compris.
- **Tokenizer `unicode61 remove_diacritics 2`** : « ete » trouve « été »,
  « nim » trouve « Nîmes », sans colonne normalisée à tenir à la main.
- **`geo_places` n'a pas d'`album_id`** — c'est un cache partagé entre albums.
  Le rattachement d'un libellé à une journée passe par
  `json_each(album_days.cells)`, ce qui laisse le cloisonnement à `album_days`,
  seule table à savoir de quel album il s'agit.

## Index

| Index                                                      | Ce qu'il sert                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idx_media_album_taken (album_id, taken_at DESC, id DESC)` | Le tri chronologique de la grille et la reprise par curseur. SQLite parcourt le même index à l'envers pour `order=asc`, donc un seul index couvre les deux sens.                                                                                                                                   |
| `idx_media_id (id)`                                        | `albumsContaining(mediaId)`, appelé à **chaque** requête média pour le contrôle d'accès. Sans lui, chaque vignette provoquerait un scan complet.                                                                                                                                                   |
| `idx_sessions_expires (expires_at)`                        | La purge horaire des sessions expirées.                                                                                                                                                                                                                                                            |
| `idx_user_albums_album (album_id)`                         | « Qui a accès à cet album », affiché par `GET /api/admin/albums`. Le sens inverse est déjà couvert par la clé primaire `(username, album_id)`.                                                                                                                                                     |
| `idx_comments_thread (album_id, media_id, id)`             | La lecture d'un fil, le compteur servi avec le détail d'un média, et le `GROUP BY media_id` qui rend les compteurs de tout un album (D54) — SQLite y lit la tranche de l'album déjà ordonnée par média. Trier sur `id` suffit — il croît avec le temps —, d'où l'absence d'index sur `created_at`. |
| `idx_comments_parent (parent_id)`                          | Le rattachement des réponses à leur racine, et leur remontée en tête de fil quand le parent disparaît.                                                                                                                                                                                             |
| `idx_comments_commenter (commenter_id)`                    | « Mes commentaires » : ceux que le lecteur courant peut supprimer.                                                                                                                                                                                                                                 |
| `idx_album_subscriptions_album (album_id)`                 | « Qui est abonné à cet album », seule lecture du notifieur. Le sens inverse est déjà couvert par la clé primaire `(commenter_id, album_id)`.                                                                                                                                                       |

Pas d'index sur `(album_id, added_at)` : le comptage des nouveautés a lieu une
fois par heure et par album, et la clé primaire `(album_id, id)` borne déjà le
parcours à l'album concerné. Un index de plus se paierait à chaque
synchronisation, pour une lecture horaire.

Pas d'index non plus pour `MediaRepo.geolocatedPoints`, la lecture du passage des
lieux : `idx_media_album_taken` borne déjà le parcours à l'album et rend les
lignes dans l'ordre chronologique, ce dont l'agglomération a besoin. Un index
sur `(album_id, lat)` n'éviterait que le filtre `lat IS NOT NULL`, pour une
lecture horaire — même arbitrage. `album_days` et `geo_places` se lisent par
leur clé primaire.

## La clé primaire composite `(album_id, id)`

Un fichier Drive présent dans deux albums (typiquement des dossiers imbriqués,
tous deux déclarés) produit **deux lignes**. Conséquences à connaître :

- Les métadonnées sont dupliquées. C'est assumé : le coût est quelques centaines
  d'octets par doublon, contre une jointure sur chaque lecture de grille.
- `getDetail(albumId, id)` est scopé à un album ; `getFileMeta(id)` ne l'est pas.
  Les colonnes qu'il lit (`name`, `mime_type`, `kind`, `size`, `md5`,
  `has_thumbnail`) décrivent
  le fichier et non son appartenance — mais les deux lignes peuvent **diverger**
  entre deux synchronisations, l'une ayant déjà vu une nouvelle version du
  fichier que l'autre ignore encore. La sélection est donc
  `ORDER BY seen_at DESC, album_id ASC LIMIT 1` : la ligne revue le plus
  récemment décrit le fichier tel qu'il est aujourd'hui dans Drive. Un `LIMIT 1`
  sans tri laisserait SQLite rendre l'ancienne, et le cache produirait un dérivé
  à partir d'une empreinte périmée, servi sous un ETag qui le déclare immuable.
  `album_id` départage les ex æquo, pour que deux appels consécutifs répondent
  la même chose.
- `albumsContaining(id)` rend **tous** les albums porteurs. L'autorisation
  accorde l'accès dès qu'un seul est visible par l'utilisateur — c'est la règle
  correcte : le fichier est déjà légitimement accessible par ce chemin-là.
- `deleteStale` d'un album ne touche pas les lignes du même fichier dans les
  autres albums. Le cache disque, lui, est indexé par id de fichier seul : les
  albums partagent donc leurs vignettes, ce qui est voulu.

## Migrations

`MIGRATIONS` est un tableau de chaînes SQL dans `db.ts`. `migrate(db)` lit
`PRAGMA user_version` et applique tout ce qui suit, chaque migration dans sa
propre transaction, avec `ROLLBACK` et message explicite en cas d'échec.
`user_version` vaut donc « nombre de migrations appliquées ».

**Règle absolue : ne jamais modifier une migration déjà publiée.** Les instances
en service ont déjà exécuté ce SQL ; le retoucher ne le rejouerait nulle part et
ferait diverger le schéma réel du schéma supposé. Toute évolution ajoute une
entrée à la fin du tableau.

`packages/server/test/migrate.test.ts` verrouille les invariants : une base
neuve arrive à la dernière version, une base en version 1 gagne `revoked_at`
sans perdre son jeton ni son index, une base en version 3 gagne les commentaires
**sans que `users` change d'une colonne** — les clés d'accès existantes gardent
leur empreinte, et les sessions ouvertes ne sont pas invalidées —, `migrate` est
idempotente, et un échec laisse `user_version` inchangé pour que la reprise
reparte de la même étape.

État actuel :

| Version | Contenu                                                                             |
| ------- | ----------------------------------------------------------------------------------- |
| 1       | Schéma initial : `media`, `sync_state`, `oauth_token`, `sessions` et leurs index.   |
| 2       | `ALTER TABLE oauth_token ADD COLUMN revoked_at TEXT`.                               |
| 3       | `users`, `albums`, `user_albums`, `settings` : la configuration entre dans la base. |
| 4       | `commenters`, `comments` et leurs index ; `sessions.commenter_id`.                  |
| 5       | `album_subscriptions` et son index ; `sync_state.notified_at` ; `media.added_at`.   |
| 6       | `commenters.pending_display_name`.                                                  |
| 7       | `album_days`, `geo_places` ; `albums.group_by`.                                     |
| 8       | `albums.cover_media_id`.                                                            |
| 9       | `media_notes` : une description par photo, portée par l'album.                      |
| 10      | `media.has_thumbnail` : Drive a-t-il un aperçu de ce fichier ?                      |
| 11      | Les quatre tables FTS5 de recherche, leurs déclencheurs, et leur `rebuild`.         |
| 12      | `albums.sort_order` : le sens de lecture par défaut de l'album.                     |

La migration 12 ajoute le sens de lecture, et c'est la seule à ce jour qui
**change le comportement des albums en service** : la colonne arrive à `'asc'`,
alors qu'ils s'ouvraient jusque-là du plus récent au plus ancien. Le contraire
aurait figé un sens que personne n'a choisi — c'était la seule valeur possible
tant qu'elle vivait dans une constante globale, et elle faisait découvrir un
séjour par sa dernière journée (D99). Le propriétaire rebascule album par album
depuis /admin, et chaque visiteur pour lui-même depuis la grille.
`packages/server/test/migrate.test.ts` le vérifie sur une base en version 11
portant un album : la ligne survit, la colonne arrive à `asc`.

La migration 11 rend la bibliothèque interrogeable. Elle crée les quatre tables
FTS5 à contenu externe décrites plus haut, leurs douze déclencheurs, puis lance
un `INSERT INTO x_fts(x_fts) VALUES('rebuild')` par table. **Ce `rebuild` est
tout l'intérêt de la migration** : sans lui, les déclencheurs n'indexeraient que
les écritures suivantes, et une instance en service resterait muette sur tout ce
qu'elle contient déjà — c'est-à-dire sur tout, pour un album qu'on ne retouche
plus. `packages/server/test/migrate.test.ts` le vérifie sur une base en
version 10 portant un album, une journée annotée, une description de photo et un
lieu géocodé : les quatre sont trouvables après la mise à jour.

La migration 10 ajoute l'aperçu Drive, à `0` sur toutes les lignes existantes.
Le défaut est délibéré : une vidéo déjà indexée n'affiche pas d'aperçu tant que
la synchronisation suivante n'a pas rempli la colonne — seule la sync sait ce
que Drive possède. Un manque passager vaut mieux qu'une rafale de requêtes
vouées au 415, une par vidéo et par chargement de grille.
`packages/server/test/migrate.test.ts` le vérifie sur une base en version 9
portant une vidéo : la ligne survit, la colonne arrive à 0.

La migration 9 ajoute la table des descriptions de photo. Elle arrive vide et ne
touche à aucune ligne existante : une instance en service la traverse sans rien
voir changer, jusqu'à ce que quelqu'un décrive une photo.
`packages/server/test/migrate.test.ts` le vérifie sur une base en version 8
portant un album et un média — et vérifie aussi que la table ne référence
**qu'**`albums`, l'absence de clé étrangère vers `media` étant tout l'intérêt de
sa forme.

La migration 8 ajoute la couverture choisie. Elle arrive à `NULL` sur toutes les
lignes, c'est-à-dire au comportement d'avant : chaque album continue d'afficher
sa photo la plus récente jusqu'à ce qu'un administrateur en désigne une autre.

La migration 7 ajoute de quoi annoter une journée et nommer le lieu que ses
photos portent déjà. Elle ne touche à aucune donnée existante : les deux tables
arrivent vides — `places.ts` les remplit au premier passage — et
`albums.group_by` arrive à `'month'`, c'est-à-dire au découpage que l'URL
appliquait déjà faute de préférence. Une instance en service la traverse sans
rien voir changer, jusqu'à ce que son propriétaire règle un album sur « jour ».

La migration 6 ajoute `commenters.pending_display_name`, vide sur l'existant :
`COALESCE(pending_display_name, display_name)` au premier code validé rend donc
le nom déjà en place, et personne n'est renommé par la mise à jour.

La migration 5 ajoute deux colonnes qui arrivent à `NULL` sur une base en
service, et c'est tout l'intérêt : `media.added_at` vide exclut l'historique du
comptage des nouveautés, `sync_state.notified_at` vide fait poser la borne sans
envoyer. Une instance qui se met à jour n'annonce donc **rien** rétroactivement.
`packages/server/test/migrate.test.ts` le vérifie sur une base en version 4
portant un album, une identité vérifiée, un média et un état de sync.

La migration 4 sépare ce que l'application confondait : elle crée `commenters`
et `comments` sans toucher à une seule colonne de `users`. Une instance en
service la traverse sans que ses clés d'accès ni ses sessions ouvertes en
pâtissent.

La migration 3 crée des tables vides. Ce sont `bootstrap.ts` et `ConfigRepo` qui
les remplissent au démarrage, à partir de `config/albums.yaml` si l'installation
en avait un (voir [06](./06-configuration-et-deploiement.md)) —
`packages/server/test/bootstrap.test.ts` vérifie qu'une instance en service
retrouve ses comptes, ses droits, ses réglages, son index et son jeton OAuth
après la mise à jour.

## Pagination par curseur

`MediaRepo.listItems(albumId, limit, cursor, order)` rend `limit` lignes et lit
`limit + 1` pour savoir s'il y a une suite, sans `COUNT`.

Le curseur est `base64url("<taken_at>\u0000<id>")` — un simple encodage, pas un
secret. Le séparateur est l'octet nul : ni une date ISO ni un identifiant Drive
ne peuvent en contenir, là où l'espace resterait un pari sur la forme des
identifiants. Il s'écrit `\u0000` dans la source et **jamais littéralement** —
un octet nul fait classer le fichier comme binaire par git, qui cesse alors
d'en afficher les diffs. La reprise est :

```sql
WHERE album_id = ?
  AND (taken_at <op> ? OR (taken_at = ? AND id <op> ?))
ORDER BY taken_at <dir>, id <dir>
```

où `<op>` vaut `<` et `<dir>` `DESC` en `order=desc`, `>` et `ASC` en `asc`. Les
deux basculent ensemble : les désaccorder ferait relire la page déjà servie.
`order` vient d'une union fermée validée par zod, jamais d'une chaîne brute —
c'est ce qui rend l'interpolation acceptable ici.

**Pourquoi pas `OFFSET`.** Une synchronisation peut insérer ou supprimer des
médias pendant que l'utilisateur défile. Avec `OFFSET`, chaque insertion en
amont décale la fenêtre : le lecteur reverrait une photo déjà vue, ou en
sauterait une. Le curseur désigne une **position dans l'ordre de tri**, pas un
rang : quoi qu'il arrive en amont, la page suivante reprend strictement après la
dernière ligne rendue. `packages/server/test/repo.test.ts` vérifie qu'un
parcours complet ne produit ni doublon ni oubli, et qu'un curseur illisible
repart du début plutôt que d'échouer.

Le tri secondaire sur `id` n'est pas décoratif : sans lui, deux photos de même
`taken_at` (rafale, import en masse) auraient un ordre indéterminé, et le
curseur ne saurait pas laquelle a déjà été servie.

### La file de modération

`CommentRepo.listForModeration(query)` pagine sur le même principe, avec un
curseur réduit à l'identifiant : `AUTOINCREMENT` fait de l'ordre des id l'ordre
d'écriture, il n'y a pas de second champ à départager.

`query` porte un filtre (`all`, `visible`, `hidden`), un album, une recherche et
les bornes. Les conditions sont construites **une fois** et servies à deux
requêtes : la page, et un `COUNT(*)` qui rend `total`. Les écrire deux fois les
ferait diverger, et le total annoncerait un corpus qui n'est pas celui qu'on
liste. Le comptage omet le curseur — c'est la taille du corpus filtré, pas celle
du reste — et se passe des `LEFT JOIN` d'album et de média, qui ne changent pas
le nombre de lignes.

La recherche est un `LIKE '%…%'` sur le corps, le nom déclaré et l'adresse, avec
`ESCAPE`. **L'échappement n'est pas décoratif** : `%` et `_` sont les jokers de
`LIKE`, et sans lui une recherche contenant un `%` ramènerait tout le corpus
pendant qu'un `_` remplacerait n'importe quel caractère — on chercherait autre
chose que ce qu'on a tapé, sans que rien ne le signale.

`hideAllFrom(commenterId, by)` et `showAllFrom(commenterId)` traitent tous les
messages d'une identité d'un coup et rendent le nombre de lignes touchées. La
clause `AND hidden_at IS NULL` (respectivement `IS NOT NULL`) préserve la date
d'un message déjà masqué : c'est celle de la décision d'origine qui compte, même
règle qu'à l'unité.

**Aucun index n'a été ajouté pour ces requêtes** (D67). Une recherche
`LIKE '%…%'` est un parcours qu'aucun index ne sert, le corpus est borné par ce
que des humains écrivent, et `idx_comments_thread` continue de couvrir le chemin
chaud de la galerie. À revoir au-delà de la dizaine de milliers de commentaires.

### Le fil d'activité

`CommentRepo.listFeed(query)` sert le tiroir d'activité du visiteur : le même
curseur par identifiant, la même page antéchronologique, mais restreinte aux
albums qu'on a le droit de voir.

**`albumIds` est la seule barrière de cloisonnement**, et elle vient de
`albumsFor()` — jamais de la requête. Une liste vide rend une page vide, et non
tout le corpus : c'est ce que produirait un `IN ()` oublié, et c'est le cas que
le test couvre en premier.

Là non plus, **aucun index nouveau** (D82). `ORDER BY c.id DESC` est l'ordre de
la clé primaire : SQLite parcourt la table à rebours et s'arrête au `LIMIT`. Un
index `(album_id, id DESC)` ne ferait pas mieux — SQLite ne sait pas fusionner
l'ordre de plusieurs tranches d'un `IN`, et il faudrait alors trier. Le cas
défavorable est connu et assumé : un compte qui ne voit qu'un album sur cinquante
fait traverser les commentaires des quarante-neuf autres avant de réunir sa page.

## Ce qui n'est pas dans la base

- Les dérivés d'images : fichiers sur disque sous `CACHE_DIR`, inventoriés en
  mémoire au démarrage.
- Les compteurs du throttle de connexion : en mémoire, perdus au redémarrage —
  volontairement (voir [08](./08-decisions.md)). Bornés en nombre et purgés à
  l'heure, faute de quoi une rafale d'identifiants inventés les ferait croître
  sans limite.

## Colonnes écrites et jamais relues

Trois colonnes n'apparaissent dans aucune requête de lecture. Elles sont
**conservées** — SQLite ne retire une colonne qu'en recréant la table, ce qui ne
vaut pas le gain sur une base en service (voir [08](./08-decisions.md), D28) —
et `db.ts` dit à quoi elles servent :

| Colonne               | Pourquoi elle reste                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `media.modified_time` | Repère chronologique dont `taken_at` dérive en dernier recours ; permet de recalculer sans réindexer.  |
| `oauth_token.scope`   | Portée consentie : dira, quand `SCOPES` évoluera, si le jeton stocké couvre encore ce qui est demandé. |
| `sessions.created_at` | Seule trace de l'ancienneté d'une session — la première question posée après un accès suspect.         |

En revanche, les comptes, les albums et les réglages **y sont** depuis la
migration 3. `config/albums.yaml` ne sert plus qu'à amorcer une installation
neuve. Conséquence d'exploitation : le volume `gdv-data` contient désormais les
comptes, c'est la seule chose à sauvegarder.
