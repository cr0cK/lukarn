import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

/**
 * Trois colonnes sont écrites sans qu'aucune requête ne les relise. Ce n'est
 * pas un oubli, et il ne faut pas les supprimer — SQLite ne sait pas retirer
 * une colonne autrement qu'en recréant la table, ce qui ne vaut pas le gain sur
 * une base en service :
 *
 * - `media.modified_time` — date de modification Drive, seul repère
 *   chronologique quand l'EXIF manque. `takenAt` en dérive au moment de la
 *   synchronisation ; la garder permet de recalculer sans réindexer, et de
 *   diagnostiquer un `taken_at` qui surprend.
 * - `oauth_token.scope` — portée demandée lors du consentement. Elle sert à
 *   savoir, quand `SCOPES` évoluera, si le jeton stocké couvre encore ce que
 *   l'application demande ou s'il faut refaire le consentement.
 * - `sessions.created_at` — date d'ouverture. `expires_at` suffit à la purge,
 *   mais c'est la seule trace qui dise depuis quand une session traîne, ce qui
 *   est la première question posée après un accès suspect.
 *
 * Migrations appliquées dans l'ordre, suivies par `PRAGMA user_version`.
 * Ne jamais modifier une migration déjà publiée : en ajouter une nouvelle.
 *
 * Exporté pour que les tests puissent reconstituer une base d'une version
 * antérieure et vérifier qu'elle se met à jour sans perdre de données.
 */
export const MIGRATIONS: string[] = [
  // 1 — schéma initial
  `
  CREATE TABLE media (
    album_id            TEXT NOT NULL,
    id                  TEXT NOT NULL,
    name                TEXT NOT NULL,
    mime_type           TEXT NOT NULL,
    kind                TEXT NOT NULL CHECK (kind IN ('photo', 'video')),
    size                INTEGER,
    width               INTEGER,
    height              INTEGER,
    taken_at            TEXT NOT NULL,
    taken_at_from_exif  INTEGER NOT NULL DEFAULT 0,
    modified_time       TEXT NOT NULL,
    duration_ms         INTEGER,
    camera_make         TEXT,
    camera_model        TEXT,
    lens                TEXT,
    iso_speed           INTEGER,
    exposure_time       REAL,
    aperture            REAL,
    focal_length        REAL,
    lat                 REAL,
    lng                 REAL,
    md5                 TEXT,
    seen_at             TEXT NOT NULL,
    PRIMARY KEY (album_id, id)
  );

  -- Sert le tri chronologique de la grille et la pagination par curseur.
  CREATE INDEX idx_media_album_taken ON media (album_id, taken_at DESC, id DESC);
  -- Sert la résolution mediaId -> albums pour le contrôle d'accès.
  CREATE INDEX idx_media_id ON media (id);

  CREATE TABLE sync_state (
    album_id      TEXT PRIMARY KEY,
    last_sync_at  TEXT,
    status        TEXT NOT NULL DEFAULT 'never',
    error         TEXT
  );

  -- Ligne unique (id = 1) : le refresh token Google chiffré.
  CREATE TABLE oauth_token (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    ciphertext  TEXT NOT NULL,
    account     TEXT,
    scope       TEXT,
    granted_at  TEXT NOT NULL
  );

  CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    username    TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
  );

  CREATE INDEX idx_sessions_expires ON sessions (expires_at);
  `,

  // 2 — trace de la révocation du refresh token par Google (`invalid_grant`),
  // pour que /admin distingue « jamais connecté » de « accès retiré ».
  `
  ALTER TABLE oauth_token ADD COLUMN revoked_at TEXT;
  `,

  // 3 — comptes, albums et réglages passent de config/albums.yaml à la base.
  // Le fichier ne sert plus qu'à amorcer une installation neuve ; une fois ces
  // tables peuplées, il n'est plus jamais relu.
  `
  CREATE TABLE users (
    -- COLLATE NOCASE sur la clé primaire : le login est déjà insensible à la
    -- casse, et l'unicité doit l'être aussi — sinon « Alexis » et « alexis »
    -- coexisteraient et la connexion en désignerait un au hasard. La casse
    -- saisie reste stockée telle quelle et c'est elle qui est affichée. Une
    -- seconde colonne en minuscules donnerait le même résultat, au prix d'un
    -- risque de désynchronisation entre les deux. NOCASE ne replie que
    -- l'ASCII : c'est exactement ce qu'accepte USERNAME_PATTERN.
    username       TEXT PRIMARY KEY COLLATE NOCASE,
    password_hash  TEXT NOT NULL,
    admin          INTEGER NOT NULL DEFAULT 0,
    -- Joker « tous les albums ». Un booléen plutôt qu'une ligne '*' dans
    -- user_albums : cette ligne-là exigerait un album fictif pour satisfaire la
    -- clé étrangère, ou d'y renoncer. Et le joker doit suivre les albums créés
    -- plus tard, ce qu'une liste de liaisons figées ne ferait pas.
    all_albums     INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );

  CREATE TABLE albums (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    description  TEXT,
    folder_id    TEXT NOT NULL,
    recursive    INTEGER NOT NULL DEFAULT 1,
    -- Rang d'affichage. Il remplace l'ordre de déclaration du YAML, que
    -- created_at ne restituerait pas : l'amorçage crée tous les albums dans la
    -- même milliseconde.
    position     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  -- ON DELETE CASCADE : une liaison orpheline redonnerait l'accès à un compte
  -- homonyme recréé plus tard, ou à un album recréé sous le même id.
  CREATE TABLE user_albums (
    username  TEXT NOT NULL REFERENCES users (username) ON DELETE CASCADE,
    album_id  TEXT NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
    PRIMARY KEY (username, album_id)
  );

  -- Sert « qui a accès à cet album », affiché dans l'écran d'administration.
  CREATE INDEX idx_user_albums_album ON user_albums (album_id);

  -- Réglages en clé/valeur JSON. Les défauts vivent dans le code : une clé
  -- absente n'est pas une anomalie, et ajouter un réglage ne demande pas de
  -- migration.
  CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
  `,

  // 4 — commentaires, et l'identité qui les signe.
  //
  // Deux niveaux à ne pas confondre, et c'est toute la raison de cette migration :
  //
  //   users      — une CLÉ D'ACCÈS. Elle ouvre des albums, et rien n'interdit de
  //                la confier à plusieurs personnes : un mot de passe partagé par
  //                toute une famille est l'usage prévu depuis albums.yaml.
  //   commenters — une PERSONNE, identifiée par une adresse qu'elle a vérifiée
  //                elle-même. C'est elle qui signe un commentaire.
  //
  // Les confondre ferait signer « famille » tous les messages du foyer, et
  // laisserait l'administrateur responsable d'adresses qui ne sont pas les
  // siennes.
  `
  CREATE TABLE commenters (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    -- L'adresse EST l'identité : se ré-identifier avec la même, depuis un autre
    -- appareil ou après avoir vidé ses cookies, retrouve ses commentaires. Sans
    -- cette clé stable, chaque navigateur créerait une personne de plus.
    email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name    TEXT NOT NULL,
    notify          INTEGER NOT NULL DEFAULT 1,
    -- NULL tant que le code reçu par email n'a pas été saisi. Sans cette
    -- vérification l'identité serait purement déclarative : n'importe qui
    -- derrière la clé d'accès partagée pourrait signer du nom d'un autre, ou
    -- faire atterrir les notifications dans la boîte d'un tiers.
    verified_at     TEXT,
    -- HMAC du code, jamais le code en clair : un dump de la base ne doit pas
    -- livrer de quoi valider une adresse. Même secret que le lien de
    -- désabonnement, SESSION_SECRET.
    code_hash       TEXT,
    code_expires_at TEXT,
    -- Date du dernier envoi : sans elle, le formulaire deviendrait une machine à
    -- expédier des emails vers une adresse qu'on ne possède pas.
    code_sent_at    TEXT,
    -- Six chiffres se parcourent en un million d'essais. Sans plafond, la
    -- vérification ne vérifierait rien.
    code_attempts   INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
  );

  -- La session mémorise l'identité, elle ne la définit pas. ON DELETE SET NULL :
  -- perdre son identité ne coupe pas l'accès aux albums, qui ne vient que de la
  -- clé d'accès.
  ALTER TABLE sessions ADD COLUMN commenter_id INTEGER REFERENCES commenters (id) ON DELETE SET NULL;

  -- AUTOINCREMENT, contrairement au rowid ordinaire : sans lui, SQLite réattribue
  -- l'identifiant d'une ligne supprimée à la ligne suivante. Les emails de
  -- notification portent un lien vers #<id> et survivent des mois dans une boîte
  -- aux lettres ; un id recyclé ferait pointer un vieux message vers la
  -- conversation de quelqu'un d'autre.
  CREATE TABLE comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Le fil appartient au couple (album, média), jamais au seul média : le même
    -- fichier Drive indexé sous deux albums porte deux conversations. Les
    -- mélanger montrerait à un visiteur les propos tenus dans un album auquel il
    -- n'a pas accès, ce qui contredirait le cloisonnement décidé en D12.
    album_id    TEXT NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
    -- Pas de clé étrangère vers media : deleteStale retire une photo dès
    -- qu'une synchronisation ne la revoit pas — dossier renommé, sync
    -- interrompue, corbeille Drive le temps d'un retour en arrière. Une cascade
    -- détruirait les commentaires sur un simple contretemps d'indexation, alors
    -- que l'identifiant Drive est stable : la photo revenue retrouve son fil.
    media_id    TEXT NOT NULL,
    -- ON DELETE SET NULL et non CASCADE : supprimer une identité emporte ses
    -- messages, mais les réponses que d'autres y ont écrites leur appartiennent.
    -- Elles remontent en tête de fil plutôt que de disparaître avec lui.
    parent_id   INTEGER REFERENCES comments (id) ON DELETE SET NULL,
    -- L'auteur est une personne, pas une clé d'accès.
    commenter_id INTEGER NOT NULL REFERENCES commenters (id) ON DELETE CASCADE,
    -- Clé d'accès utilisée au moment d'écrire, gardée pour la modération : c'est
    -- ce qui dit par quel mot de passe partagé un message gênant est arrivé,
    -- donc lequel changer. ON DELETE SET NULL — supprimer un compte ne doit pas
    -- emporter des commentaires qui ne lui appartiennent pas.
    account     TEXT COLLATE NOCASE REFERENCES users (username) ON DELETE SET NULL,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    -- Modération a posteriori : le commentaire est publié tout de suite et
    -- masqué après coup, plutôt que retenu jusqu'à validation. Masquer plutôt que
    -- supprimer laisse à l'administrateur le droit de se raviser.
    hidden_at   TEXT,
    hidden_by   TEXT COLLATE NOCASE
  );

  -- Sert la lecture d'un fil et le compteur affiché avec le détail d'un média.
  -- Trier sur id plutôt que sur created_at suffit : AUTOINCREMENT ne réattribue
  -- jamais un identifiant, donc l'ordre des id est l'ordre d'écriture. C'est ce
  -- qui permet aussi à la file de modération de paginer sur un simple entier
  -- plutôt que sur un curseur (date, id).
  CREATE INDEX idx_comments_thread ON comments (album_id, media_id, id);
  -- Sert le rattachement des réponses à leur racine, et leur remontée en tête de
  -- fil quand le parent disparaît (ON DELETE SET NULL ci-dessus).
  CREATE INDEX idx_comments_parent ON comments (parent_id);
  -- Sert « mes commentaires » : ceux que le lecteur courant peut supprimer.
  CREATE INDEX idx_comments_commenter ON comments (commenter_id);
  `,

  // 5 — annonce des nouvelles photos d'un album à ceux qui l'ouvrent.
  //
  // Une identité n'est rattachée à aucun album : l'accès vient de la clé, et
  // l'identité de l'adresse vérifiée. On ne sait donc pas nativement à qui
  // écrire — d'où l'abonnement à l'ouverture, et cette table pour le porter.
  `
  CREATE TABLE album_subscriptions (
    commenter_id INTEGER NOT NULL REFERENCES commenters (id) ON DELETE CASCADE,
    album_id     TEXT NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
    -- 'auto' : abonné en ouvrant l'album. 'opted_out' : s'est désabonné.
    --
    -- Un état plutôt qu'une simple présence, parce que l'abonnement est
    -- automatique : sans lui, rouvrir l'album le lendemain d'un désabonnement
    -- réabonnerait — précisément ce qui fait détester un service. L'inscription
    -- s'écrit INSERT OR IGNORE, qui laisse intacte une ligne déjà 'opted_out'.
    state        TEXT NOT NULL CHECK (state IN ('auto', 'opted_out')),
    created_at   TEXT NOT NULL,
    PRIMARY KEY (commenter_id, album_id)
  );

  -- Sert « qui est abonné à cet album », la seule lecture du notifieur. Le sens
  -- inverse est déjà couvert par la clé primaire.
  CREATE INDEX idx_album_subscriptions_album ON album_subscriptions (album_id);

  -- Date des dernières photos annoncées. Sans elle, une seconde synchronisation
  -- réannoncerait tout : l'index ne garde aucune trace de ce qui a été signalé.
  -- NULL sur une base déjà en service : la première exécution l'initialise sans
  -- rien envoyer, faute de quoi la mise à jour annoncerait tout l'historique.
  ALTER TABLE sync_state ADD COLUMN notified_at TEXT;

  -- Date d'entrée dans l'index, renseignée à l'INSERT et JAMAIS touchée par le
  -- ON CONFLICT DO UPDATE de upsertMany. La colonne seen_at ne peut pas jouer
  -- ce rôle : elle est réécrite sur *tous* les médias à chaque passage de la
  -- sync, y compris ceux déjà connus — compter les nouveautés dessus les
  -- compterait toutes.
  --
  -- Les lignes existantes restent à NULL, et WHERE added_at > ? les exclut :
  -- c'est ce qui évite d'annoncer rétroactivement un album entier.
  ALTER TABLE media ADD COLUMN added_at TEXT;
  `,

  // 6 — un renommage n'a lieu qu'une fois le code validé.
  //
  // `requestCode` écrivait `display_name` immédiatement, avant toute
  // vérification : demander un code pour l'adresse d'un tiers déjà vérifié
  // renommait donc son identité, et avec elle tous ses commentaires passés — la
  // signature affichée est lue à chaque requête, pas figée à l'écriture. Le nom
  // demandé attend ici jusqu'à ce que le code prouve qu'on tient la boîte.
  `
  ALTER TABLE commenters ADD COLUMN pending_display_name TEXT;
  `,

  // 7 — annoter une journée, et nommer le lieu que les photos portent déjà.
  //
  // Deux colonnes distinctes pour le lieu, et c'est tout l'intérêt de cette
  // migration : `cells` est déduit de l'EXIF, `place` est saisi à la main.
  // L'agrégation des positions est déterministe et hors réseau, le géocodage
  // est lent et faillible. Les séparer permet de recalculer les journées à
  // chaque passage sans rappeler Nominatim, et fait que les libellés
  // s'allument tout seuls quand ils finissent par arriver.
  `
  CREATE TABLE album_days (
    album_id    TEXT NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
    -- 'YYYY-MM-DD' en UTC, exactement la clé que dayKey() calcule côté front.
    -- Un jour local ferait basculer de section une photo de 23 h 30.
    day         TEXT NOT NULL,
    description TEXT,
    -- Lieu saisi à la main. Prime sur cells : c'est une correction, et une
    -- correction que le recalcul écraserait ne servirait à rien.
    place       TEXT,
    -- JSON string[] de clés geo_places, dans l'ordre chronologique des
    -- grappes. Réécrit à chaque passage ; description et place, jamais.
    cells       TEXT,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (album_id, day)
  );

  -- Cache de géocodage inverse, partagé par tous les albums : deux séjours au
  -- même endroit ne comptent qu'un appel à Nominatim, dont la politique
  -- plafonne à une requête par seconde.
  CREATE TABLE geo_places (
    -- 'lat,lng' arrondis à 2 décimales, soit ~1,1 km — la maille en deçà de
    -- laquelle deux photos portent de toute façon le même nom de lieu.
    cell       TEXT PRIMARY KEY,
    -- NULL : le géocodage a abouti sans résultat exploitable. La ligne existe
    -- quand même, c'est ce qui empêche de redemander éternellement. Un échec
    -- réseau, lui, n'écrit aucune ligne et sera retenté au passage suivant.
    label      TEXT,
    fetched_at TEXT NOT NULL
  );

  -- Découpage par défaut de la grille. Il vivait uniquement dans l'URL, donc
  -- nulle part : un album de vacances se lit par jour, un album « les enfants »
  -- couvrant dix ans se lit par mois, et personne n'a à le redemander à chaque
  -- ouverture.
  ALTER TABLE albums ADD COLUMN group_by TEXT NOT NULL DEFAULT 'month'
    CHECK (group_by IN ('month', 'day'));
  `,

  // 8 — la couverture d'un album se choisit, au lieu d'être toujours sa photo
  // la plus récente. NULL vaut « automatique », et reste le repli permanent.
  //
  // Aucune clé étrangère vers media, pour la même raison que comments.media_id :
  // deleteStale retire une photo dès qu'une synchronisation ne la revoit pas —
  // corbeille Drive le temps d'un retour en arrière, dossier renommé, sync
  // interrompue. Une cascade effacerait le choix sur un contretemps
  // d'indexation, alors que l'identifiant Drive est stable : la photo revenue
  // redevient la couverture, et l'album montre la plus récente entre-temps.
  `
  ALTER TABLE albums ADD COLUMN cover_media_id TEXT;
  `,

  // 9 — une description par photo. L'album dit où l'on était, la journée ce
  // qu'on y a fait ; ce qui se passe sur une image précise ne se déduit ni du
  // nom de fichier, ni de l'EXIF, ni de la note du jour.
  `
  CREATE TABLE media_notes (
    -- Le texte appartient au couple (album, média), jamais au seul média : le
    -- même fichier Drive indexé sous deux albums porte deux descriptions,
    -- exactement comme il porte deux fils de commentaires. Les confondre
    -- montrerait à un visiteur ce qui a été écrit dans un album auquel il n'a
    -- pas accès, ce qui contredirait le cloisonnement décidé en D12.
    album_id    TEXT NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
    -- Aucune clé étrangère vers media, pour la raison de comments.media_id et
    -- d'albums.cover_media_id : deleteStale retire une photo dès qu'une
    -- synchronisation ne la revoit pas — corbeille Drive le temps d'un retour
    -- en arrière, dossier renommé, sync interrompue. Une cascade détruirait sur
    -- un contretemps d'indexation un texte écrit à la main, que rien ne
    -- régénère. L'identifiant Drive est stable : la photo revenue retrouve sa
    -- description (D83).
    media_id    TEXT NOT NULL,
    description TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (album_id, media_id)
  );
  `,

  // 10 — Drive dit s'il a produit un aperçu du fichier. C'est ce qui permet à
  // une vidéo d'avoir une vignette de grille sans qu'un seul octet de vidéo
  // soit décodé ici (D92).
  //
  // Le défaut à 0 est délibéré : les lignes déjà indexées n'affichent pas
  // d'aperçu tant que la synchronisation suivante n'a pas rempli la colonne. Un
  // manque passager vaut mieux qu'une rafale de requêtes vouées au 415, une par
  // vidéo et par chargement de grille, sur une information que seule la sync
  // peut donner.
  `
  ALTER TABLE media ADD COLUMN has_thumbnail INTEGER NOT NULL DEFAULT 0;
  `,

  // 11 — index de recherche : quatre tables FTS5 **à contenu externe**, tenues
  // par des déclencheurs.
  //
  // Le coût d'une recherche ici n'est pas la requête — quelques milliers de
  // lignes, moins d'une milliseconde — mais de tenir l'index à jour. Ces textes
  // s'écrivent depuis six endroits (ConfigRepo.saveAlbum, AlbumDayRepo.upsertNote
  // et .replaceCells, Geocoder, MediaRepo.setDescription, et les suppressions en
  // cascade d'un album). Réindexer depuis le code demanderait de n'en oublier
  // aucun, aujourd'hui et dans tout chemin d'écriture écrit plus tard — et un
  // index périmé ne se voit pas : il rend simplement moins de résultats.
  //
  // `content='<table>'` : la table FTS ne stocke que l'index, jamais une copie du
  // texte. Le contrat de cette forme est que chaque écriture soit répercutée,
  // d'où les trois déclencheurs par table — la suppression passe par la commande
  // 'delete' avec les **anciennes** valeurs, seule façon pour FTS5 de retrouver
  // les termes à retirer sans relire la ligne, qui n'existe plus.
  //
  // Le tokenizer replie les diacritiques : « ete » trouve « été », « nim »
  // trouve « Nîmes », sans colonne normalisée à tenir à la main.
  //
  // Le `rebuild` final indexe ce qui est déjà là : sans lui, une instance en
  // service ne deviendrait interrogeable qu'au fil des écritures suivantes,
  // c'est-à-dire jamais pour un album qu'on ne retouche plus (D96).
  `
  CREATE VIRTUAL TABLE albums_fts USING fts5(
    title, description,
    content='albums', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER albums_ai AFTER INSERT ON albums BEGIN
    INSERT INTO albums_fts (rowid, title, description)
      VALUES (new.rowid, new.title, new.description);
  END;
  CREATE TRIGGER albums_ad AFTER DELETE ON albums BEGIN
    INSERT INTO albums_fts (albums_fts, rowid, title, description)
      VALUES ('delete', old.rowid, old.title, old.description);
  END;
  CREATE TRIGGER albums_au AFTER UPDATE ON albums BEGIN
    INSERT INTO albums_fts (albums_fts, rowid, title, description)
      VALUES ('delete', old.rowid, old.title, old.description);
    INSERT INTO albums_fts (rowid, title, description)
      VALUES (new.rowid, new.title, new.description);
  END;

  CREATE VIRTUAL TABLE album_days_fts USING fts5(
    description, place,
    content='album_days', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER album_days_ai AFTER INSERT ON album_days BEGIN
    INSERT INTO album_days_fts (rowid, description, place)
      VALUES (new.rowid, new.description, new.place);
  END;
  CREATE TRIGGER album_days_ad AFTER DELETE ON album_days BEGIN
    INSERT INTO album_days_fts (album_days_fts, rowid, description, place)
      VALUES ('delete', old.rowid, old.description, old.place);
  END;
  CREATE TRIGGER album_days_au AFTER UPDATE ON album_days BEGIN
    INSERT INTO album_days_fts (album_days_fts, rowid, description, place)
      VALUES ('delete', old.rowid, old.description, old.place);
    INSERT INTO album_days_fts (rowid, description, place)
      VALUES (new.rowid, new.description, new.place);
  END;

  CREATE VIRTUAL TABLE media_notes_fts USING fts5(
    description,
    content='media_notes', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER media_notes_ai AFTER INSERT ON media_notes BEGIN
    INSERT INTO media_notes_fts (rowid, description) VALUES (new.rowid, new.description);
  END;
  CREATE TRIGGER media_notes_ad AFTER DELETE ON media_notes BEGIN
    INSERT INTO media_notes_fts (media_notes_fts, rowid, description)
      VALUES ('delete', old.rowid, old.description);
  END;
  CREATE TRIGGER media_notes_au AFTER UPDATE ON media_notes BEGIN
    INSERT INTO media_notes_fts (media_notes_fts, rowid, description)
      VALUES ('delete', old.rowid, old.description);
    INSERT INTO media_notes_fts (rowid, description) VALUES (new.rowid, new.description);
  END;

  CREATE VIRTUAL TABLE geo_places_fts USING fts5(
    label,
    content='geo_places', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER geo_places_ai AFTER INSERT ON geo_places BEGIN
    INSERT INTO geo_places_fts (rowid, label) VALUES (new.rowid, new.label);
  END;
  CREATE TRIGGER geo_places_ad AFTER DELETE ON geo_places BEGIN
    INSERT INTO geo_places_fts (geo_places_fts, rowid, label)
      VALUES ('delete', old.rowid, old.label);
  END;
  CREATE TRIGGER geo_places_au AFTER UPDATE ON geo_places BEGIN
    INSERT INTO geo_places_fts (geo_places_fts, rowid, label)
      VALUES ('delete', old.rowid, old.label);
    INSERT INTO geo_places_fts (rowid, label) VALUES (new.rowid, new.label);
  END;

  INSERT INTO albums_fts (albums_fts) VALUES ('rebuild');
  INSERT INTO album_days_fts (album_days_fts) VALUES ('rebuild');
  INSERT INTO media_notes_fts (media_notes_fts) VALUES ('rebuild');
  INSERT INTO geo_places_fts (geo_places_fts) VALUES ('rebuild');
  `,

  // 12 — sens de lecture par défaut de la grille, à côté du découpage. Il vivait
  // dans une constante globale, donc identique pour tous les albums, et
  // uniquement dans l'URL : on découvrait un séjour par sa dernière journée, et
  // le sens rebasculé était perdu en quittant la page.
  //
  // `DEFAULT 'asc'` fait basculer les albums déjà en service, et c'est voulu :
  // le sens sortant n'a jamais été choisi par personne, c'était le seul
  // disponible (D99).
  `
  ALTER TABLE albums ADD COLUMN sort_order TEXT NOT NULL DEFAULT 'asc'
    CHECK (sort_order IN ('desc', 'asc'));
  `,

  // 13 — appairer un écran sans clavier, au lieu d'y taper un mot de passe.
  //
  // Table de passage : une ligne y vit cinq minutes au plus, et disparaît dès
  // que l'écran demandeur a relevé sa session. Elle n'ouvre aucun accès
  // nouveau — l'appairage délègue une clé existante, et celui qui approuve doit
  // déjà être connecté (D260809c).
  `
  CREATE TABLE device_pairings (
    -- Les huit caractères affichés sur l'écran et repris dans le QR. En clair,
    -- et c'est délibéré : ils s'affichent dans un salon, les hacher ne
    -- protégerait rien de ce que la pièce voit déjà.
    user_code    TEXT PRIMARY KEY,
    -- HMAC du deviceCode de 32 octets rendu au seul demandeur. C'est LUI qui
    -- autorise à relever la session, jamais le code affiché : sans cette
    -- séparation, une photo du téléviseur suffirait à prendre sa place. Haché
    -- pour la raison de commenters.code_hash — un dump de la base ne doit pas
    -- livrer de quoi se substituer à un écran en attente.
    device_hash  TEXT NOT NULL UNIQUE,
    -- Le compte de celui qui a approuvé, NULL tant que personne ne l'a fait.
    -- CASCADE : une demande approuvée par un compte supprimé entre-temps ne
    -- doit pas pouvoir devenir une session.
    username     TEXT COLLATE NOCASE REFERENCES users (username) ON DELETE CASCADE,
    approved_at  TEXT,
    created_at   TEXT NOT NULL,
    -- Cinq minutes. Au-delà, un code approuvable traînerait sur un écran allumé.
    expires_at   TEXT NOT NULL
  );

  -- Sert la purge horaire, et la borne du nombre de demandes en attente.
  CREATE INDEX idx_device_pairings_expires ON device_pairings (expires_at);
  `,

  // 14 — le codec réellement contenu dans la piste image d'une vidéo, lu dans le
  // `moov` au même passage de fenêtres que sa date. C'est lui qui décide de ce
  // qui est transcodé, et de la source que le client demande (D260809b).
  //
  // Trois valeurs, et la distinction compte :
  //
  //   NULL          le fichier n'a jamais été examiné — ligne d'avant cette
  //                 migration, ou en-tête que Drive n'a pas rendu. La sync le
  //                 rouvrira.
  //   ''            en-tête lu, aucune piste image reconnue. Le rouvrir à chaque
  //                 passage relirait quelques centaines de Ko pour rien.
  //   'hvc1', …     le code à quatre lettres tel qu'il est écrit dans le `stsd`.
  //
  // Sans le troisième état, un conteneur exotique serait relu à chaque
  // synchronisation, indéfiniment.
  `
  ALTER TABLE media ADD COLUMN video_codec TEXT;
  `,
];

export function openDb(dataDir: string): Db {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, 'gdv.db'));

  // WAL : les lectures de la grille ne bloquent pas la sync qui écrit en fond.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  // Une écriture concurrente attend au lieu de renvoyer SQLITE_BUSY.
  db.pragma('busy_timeout = 5000');

  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let version = current; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version]!;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.pragma(`user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Échec de la migration ${version + 1} : ${(error as Error).message}`);
    }
  }
}
