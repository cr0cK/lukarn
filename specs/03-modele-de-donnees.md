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
| `taken_at`                                                                                                    | TEXT    | ISO 8601 UTC. Date EXIF si connue, sinon `modifiedTime` de Drive.                                                                     |
| `taken_at_from_exif`                                                                                          | INTEGER | 0/1. Le front écrit « Prise de vue » ou « Modifié le » selon la valeur.                                                               |
| `modified_time`                                                                                               | TEXT    | ISO 8601. Écrit à chaque sync, jamais relu — conservé, voir « Colonnes écrites et jamais relues » plus bas.                           |
| `duration_ms`                                                                                                 | INTEGER | Vidéos seulement.                                                                                                                     |
| `camera_make`, `camera_model`, `lens`, `iso_speed`, `exposure_time`, `aperture`, `focal_length`, `lat`, `lng` |         | EXIF, tous nullables. Servis par `/items/:mediaId`.                                                                                   |
| `md5`                                                                                                         | TEXT    | Empreinte du contenu Drive. Porte la version des URL et des ETag, et entre dans la clé du cache disque.                               |
| `seen_at`                                                                                                     | TEXT    | Estampille de la sync qui a vu cette ligne. Base de `deleteStale`.                                                                    |
| `added_at`                                                                                                    | TEXT    | Date d'entrée dans l'index, écrite à l'INSERT et **jamais** par le `ON CONFLICT DO UPDATE`. Nullable — voir ci-dessous.               |
| **PK**                                                                                                        |         | `(album_id, id)`                                                                                                                      |

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

| Table         | Colonnes                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `users`       | `username` (PK, `COLLATE NOCASE`), `password_hash`, `admin`, `all_albums`, `created_at`, `updated_at`                          |
| `albums`      | `id` (PK), `title`, `description`, `folder_id`, `recursive`, `position`, `created_at`, `updated_at`                            |
| `user_albums` | `username`, `album_id`, PK composite, deux clés étrangères `ON DELETE CASCADE`                                                 |
| `settings`    | `key` (PK), `value` — JSON. Clés : `syncIntervalMinutes`, `syncOnStartup`, `cacheMaxSizeGB`, `prewarmCache`, `moderationEmail` |

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

| Colonne                  | Rôle                                                                  |
| ------------------------ | --------------------------------------------------------------------- |
| `id`                     | PK, `AUTOINCREMENT`                                                   |
| `album_id`, `media_id`   | Le couple auquel le fil appartient                                    |
| `parent_id`              | `NULL` pour une racine, sinon l'id de la racine — jamais plus profond |
| `username`               | Auteur, `COLLATE NOCASE`, FK `ON DELETE CASCADE`                      |
| `body`, `created_at`     | Le message et sa date                                                 |
| `hidden_at`, `hidden_by` | Modération a posteriori                                               |

Cinq choix structurants :

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

`settings` porte des valeurs JSON et les défauts vivent dans le code
(`DEFAULT_SETTINGS`) : une clé absente n'est pas une anomalie, et ajouter un
réglage ne demande pas de migration.

**Cache mémoire.** `canSee()` est appelé à chaque requête média, donc sur chaque
vignette d'une grille. `ConfigRepo` tient un instantané en mémoire (albums,
comptes, droits, réglages), reconstruit à la première lecture qui suit une
écriture. Étant le seul écrivain de ces quatre tables, il ne peut pas servir un
instantané périmé.

## Index

| Index                                                      | Ce qu'il sert                                                                                                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idx_media_album_taken (album_id, taken_at DESC, id DESC)` | Le tri chronologique de la grille et la reprise par curseur. SQLite parcourt le même index à l'envers pour `order=asc`, donc un seul index couvre les deux sens. |
| `idx_media_id (id)`                                        | `albumsContaining(mediaId)`, appelé à **chaque** requête média pour le contrôle d'accès. Sans lui, chaque vignette provoquerait un scan complet.                 |
| `idx_sessions_expires (expires_at)`                        | La purge horaire des sessions expirées.                                                                                                                          |
| `idx_user_albums_album (album_id)`                         | « Qui a accès à cet album », affiché par `GET /api/admin/albums`. Le sens inverse est déjà couvert par la clé primaire `(username, album_id)`.                   |
| `idx_comments_thread (album_id, media_id, id)`             | La lecture d'un fil et le compteur servi avec le détail d'un média. Trier sur `id` suffit — il croît avec le temps —, d'où l'absence d'index sur `created_at`.   |
| `idx_comments_parent (parent_id)`                          | Le rattachement des réponses à leur racine, et leur remontée en tête de fil quand le parent disparaît.                                                           |
| `idx_comments_commenter (commenter_id)`                    | « Mes commentaires » : ceux que le lecteur courant peut supprimer.                                                                                               |
| `idx_album_subscriptions_album (album_id)`                 | « Qui est abonné à cet album », seule lecture du notifieur. Le sens inverse est déjà couvert par la clé primaire `(commenter_id, album_id)`.                     |

Pas d'index sur `(album_id, added_at)` : le comptage des nouveautés a lieu une
fois par heure et par album, et la clé primaire `(album_id, id)` borne déjà le
parcours à l'album concerné. Un index de plus se paierait à chaque
synchronisation, pour une lecture horaire.

## La clé primaire composite `(album_id, id)`

Un fichier Drive présent dans deux albums (typiquement des dossiers imbriqués,
tous deux déclarés) produit **deux lignes**. Conséquences à connaître :

- Les métadonnées sont dupliquées. C'est assumé : le coût est quelques centaines
  d'octets par doublon, contre une jointure sur chaque lecture de grille.
- `getDetail(albumId, id)` est scopé à un album ; `getFileMeta(id)` ne l'est pas.
  Les colonnes qu'il lit (`name`, `mime_type`, `kind`, `size`, `md5`) décrivent
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
| `media.modified_time` | Repère chronologique dont `taken_at` dérive quand l'EXIF manque ; permet de recalculer sans réindexer. |
| `oauth_token.scope`   | Portée consentie : dira, quand `SCOPES` évoluera, si le jeton stocké couvre encore ce qui est demandé. |
| `sessions.created_at` | Seule trace de l'ancienneté d'une session — la première question posée après un accès suspect.         |

En revanche, les comptes, les albums et les réglages **y sont** depuis la
migration 3. `config/albums.yaml` ne sert plus qu'à amorcer une installation
neuve. Conséquence d'exploitation : le volume `gdv-data` contient désormais les
comptes, c'est la seule chose à sauvegarder.
