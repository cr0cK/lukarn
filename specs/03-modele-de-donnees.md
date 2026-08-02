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
| `modified_time`                                                                                               | TEXT    | ISO 8601. Écrit à chaque sync ; aucune lecture ne s'en sert aujourd'hui.                                                              |
| `duration_ms`                                                                                                 | INTEGER | Vidéos seulement.                                                                                                                     |
| `camera_make`, `camera_model`, `lens`, `iso_speed`, `exposure_time`, `aperture`, `focal_length`, `lat`, `lng` |         | EXIF, tous nullables. Servis par `/items/:mediaId`.                                                                                   |
| `md5`                                                                                                         | TEXT    | Écrit, jamais lu. Réservé à une future détection de doublons.                                                                         |
| `seen_at`                                                                                                     | TEXT    | Estampille de la sync qui a vu cette ligne. Base de `deleteStale`.                                                                    |
| **PK**                                                                                                        |         | `(album_id, id)`                                                                                                                      |

### `sync_state`

Une ligne par album : `album_id` (PK), `last_sync_at`, `status`
(`never` \| `running` \| `ok` \| `error`), `error`.

`status` et `error` sont écrasés à chaque tentative, mais `last_sync_at` n'est
mis à jour qu'en cas de succès (`drive/sync.ts`) : `/admin` peut donc afficher
« en erreur, dernière synchro réussie il y a 3 h ».

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
`expires_at`. TTL de 30 jours (`sessions.ts`).

### `users`, `albums`, `user_albums`, `settings`

La configuration : qui se connecte, quels dossiers Drive sont exposés, et les
réglages. Écrites **uniquement** par `ConfigRepo` (`config-repo.ts`).

| Table         | Colonnes                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `users`       | `username` (PK, `COLLATE NOCASE`), `password_hash`, `admin`, `all_albums`, `created_at`, `updated_at` |
| `albums`      | `id` (PK), `title`, `description`, `folder_id`, `recursive`, `position`, `created_at`, `updated_at`   |
| `user_albums` | `username`, `album_id`, PK composite, deux clés étrangères `ON DELETE CASCADE`                        |
| `settings`    | `key` (PK), `value` — JSON. Clés : `syncIntervalMinutes`, `syncOnStartup`, `cacheMaxSizeGB`           |

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

## La clé primaire composite `(album_id, id)`

Un fichier Drive présent dans deux albums (typiquement des dossiers imbriqués,
tous deux déclarés) produit **deux lignes**. Conséquences à connaître :

- Les métadonnées sont dupliquées. C'est assumé : le coût est quelques centaines
  d'octets par doublon, contre une jointure sur chaque lecture de grille.
- `getDetail(albumId, id)` est scopé à un album ; `getFileMeta(id)` ne l'est pas
  et prend la première ligne trouvée (`LIMIT 1`). C'est correct puisque les
  colonnes qu'il lit (`name`, `mime_type`, `kind`, `size`) décrivent le fichier,
  pas son appartenance.
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
sans perdre son jeton ni son index, `migrate` est idempotente, et un échec
laisse `user_version` inchangé pour que la reprise reparte de la même étape.

État actuel :

| Version | Contenu                                                                             |
| ------- | ----------------------------------------------------------------------------------- |
| 1       | Schéma initial : `media`, `sync_state`, `oauth_token`, `sessions` et leurs index.   |
| 2       | `ALTER TABLE oauth_token ADD COLUMN revoked_at TEXT`.                               |
| 3       | `users`, `albums`, `user_albums`, `settings` : la configuration entre dans la base. |

La migration 3 crée des tables vides. Ce sont `bootstrap.ts` et `ConfigRepo` qui
les remplissent au démarrage, à partir de `config/albums.yaml` si l'installation
en avait un (voir [06](./06-configuration-et-deploiement.md)) —
`packages/server/test/bootstrap.test.ts` vérifie qu'une instance en service
retrouve ses comptes, ses droits, ses réglages, son index et son jeton OAuth
après la mise à jour.

## Pagination par curseur

`MediaRepo.listItems(albumId, limit, cursor, order)` rend `limit` lignes et lit
`limit + 1` pour savoir s'il y a une suite, sans `COUNT`.

Le curseur est `base64url("<taken_at> <id>")` — un simple encodage, pas un
secret. La reprise est :

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
  volontairement (voir [08](./08-decisions.md)).

En revanche, les comptes, les albums et les réglages **y sont** depuis la
migration 3. `config/albums.yaml` ne sert plus qu'à amorcer une installation
neuve. Conséquence d'exploitation : le volume `gdv-data` contient désormais les
comptes, c'est la seule chose à sauvegarder.
