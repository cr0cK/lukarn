# D96 — L'index de recherche est tenu par le schéma, pas par le code

**Contexte.** Passé une vingtaine d'albums, la page d'accueil ne répond plus à
« où sont les photos de Marseille ». L'information existe pourtant déjà en base :
les albums portent un titre et une description, les journées une note et un lieu
— saisi ou géocodé par la passe `places` (D48) —, les photos une description
depuis D83. Rien ne la rend interrogeable : il faut ouvrir les albums un par un.

Le coût d'une recherche ici n'est pas la requête. Quelques milliers de lignes se
parcourent en moins d'une milliseconde, et un `LIKE '%…%'` suffirait longtemps.
Le coût est de **tenir l'index à jour**. Ces textes s'écrivent depuis six
endroits : `ConfigRepo.saveAlbum`, `AlbumDayRepo.upsertNote`,
`AlbumDayRepo.replaceCells`, `Geocoder`, `MediaRepo.setDescription`, et les
suppressions en cascade d'un album. Une réindexation appelée depuis le code
demanderait de n'en oublier aucun — aujourd'hui, et dans tout chemin d'écriture
écrit plus tard. Or un index périmé ne se voit pas : il ne casse rien, il rend
simplement moins de résultats, et le manque ne se remarque que le jour où l'on
cherche précisément ce qui n'y est pas.

**Choix.** Quatre tables FTS5 **à contenu externe** (`content='<table>'`,
`content_rowid='rowid'`), tenues par **des déclencheurs SQL** — trois par table,
la forme documentée de FTS5. La cohérence devient une propriété du schéma et non
une discipline d'appel : tout chemin d'écriture met l'index à jour, y compris
ceux que personne n'a encore écrits, y compris ceux qui ne passent pas par le
code — une cascade `ON DELETE`, une correction en `sqlite3`.

Le contenu externe évite la duplication du texte : la table FTS ne stocke que
l'index et se joint à sa table d'origine par `rowid`. Le tokenizer est
`unicode61 remove_diacritics 2` — « ete » trouve « été », « nim » trouve
« Nîmes », sans colonne normalisée à tenir à la main, c'est-à-dire sans un
second endroit où l'oubli est possible.

Vérifié sur `better-sqlite3@12.11.1` (SQLite 3.53.2) avant de s'y engager : les
déclencheurs `AFTER DELETE` se déclenchent bien sur les suppressions en cascade,
et l'`integrity-check` de FTS5 reste vert ensuite. Ces deux points-là sont
exactement ce qui rendrait la décision fausse s'ils ne tenaient pas.

**Ce qui n'est pas indexé, et pourquoi.** `media.name` : `IMG_1234.jpg` est du
bruit, et l'indexer noierait les vrais libellés sous des noms que personne n'a
choisis. `camera_make` et `camera_model` : chercher « iPhone » rendrait la
moitié de la bibliothèque, c'est-à-dire rien. Les **commentaires** : chercher
dans ce que d'autres ont écrit est une autre fonctionnalité — la modération
masque des messages, le fil appartient au couple (album, média), et une
recherche devrait rejouer ces règles-là plutôt que les emprunter.

**Ce qui est rendu est une entité navigable, pas un extrait.** « Marseille »
ouvre la journée à Marseille ; il n'affiche pas la ligne où le mot apparaît. Ce
choix décide de tout l'affichage : trois groupes courts — Albums, Journées et
lieux, Photos —, cinq entrées chacun, et aucun score comparé d'un type à
l'autre. Le `bm25` d'un titre de trois mots et celui d'une note de trois lignes
ne veulent pas dire la même chose ; l'affichage étant groupé, la question ne se
pose pas et aucune normalisation n'est nécessaire.

**Écarté.** Une colonne `search_text` dénormalisée par table, remplie par le
code : c'est précisément la discipline qu'on cherche à ne pas devoir tenir.
Un moteur externe (SQLite reste le seul état de l'instance, D9). Et le `LIKE
'%…%'` : il ignore les accents, ne sait pas chercher par préfixe de mot, et
scanne — il aurait tenu, puis cessé de tenir sans qu'on sache dire quand.

**Conséquences.** Migration 11, non rejouable comme toutes les autres. Elle se
termine par un `rebuild` par table, sans lequel une instance en service
resterait muette sur tout ce qu'elle contient déjà : les déclencheurs
n'indexeraient que les écritures suivantes, c'est-à-dire jamais pour un album
qu'on ne retouche plus. `SearchRepo` (`search.ts`) filtre en plus sur deux
points qui ne sont pas décoratifs — une description dont le média a quitté
l'index (D83) ne rend rien, sans quoi le résultat ouvrirait une visionneuse
vide, et une journée qui correspond à la fois par sa note et par son lieu
n'apparaît qu'une fois.
