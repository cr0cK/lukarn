# D83 — Une description par photo, portée par l'album

**Contexte.** Un album porte une description, une journée porte une note — mais
une photo précise n'avait rien. C'est pourtant là que le contexte manque le
plus : « Léa saute du ponton, troisième essai » ne se déduit ni du nom de
fichier, ni de l'EXIF, ni de la note du jour, qui parle de la journée entière.
Une galerie familiale se regarde des années plus tard, et ce qui n'a pas été
écrit est perdu.

**Choix.** Une table `media_notes (album_id, media_id, description, updated_at)`,
clé primaire `(album_id, media_id)`. Le texte se saisit depuis la galerie, en
voyant l'image ; la mutation passe par
`PATCH /api/admin/albums/:id/items/:mediaId`, seul préfixe qui réponde 403 (D50).
Même partage que la note de journée et la couverture, et pour la même raison.

**La portée est l'album, pas le fichier Drive.** Un fichier présent dans deux
albums — dossiers imbriqués, tous deux déclarés — y porte deux descriptions,
exactement comme il y porte deux fils de commentaires. Une description par
`media_id` seul serait plus simple à écrire et fausse à lire : elle montrerait à
un visiteur ce qui a été rédigé dans un album auquel il n'a pas accès, ce qui
contredirait le cloisonnement décidé en D12. Le prix assumé est qu'on décrit deux
fois la même photo si on tient à la voir décrite des deux côtés — un cas rare, et
qui reste un choix.

**Aucune clé étrangère vers `media`**, et c'est le cœur de l'entrée. `deleteStale`
retire une photo de l'index dès qu'une synchronisation ne la revoit pas :
corbeille Drive le temps d'un retour en arrière, dossier renommé, sync
interrompue à mi-parcours. Une cascade détruirait alors, sur un contretemps
d'indexation, un texte écrit à la main que rien ne régénère — contrairement à une
vignette. L'identifiant Drive étant stable, la photo revenue retrouve sa
description d'elle-même. Le raisonnement est celui de `comments.media_id` (D35)
et d'`albums.cover_media_id` (D80) ; il s'applique ici avec plus de force encore,
puisqu'une description perdue ne se reconstitue par aucun moyen.

Corollaire à ne pas défaire : **aucun ménage ne touche cette table.** Ni
`deleteStale`, ni `clearAlbum`, ni `pruneAlbums`, ni le `ON CONFLICT DO UPDATE`
d'`upsertMany` — même invariant que `replaceCells` dans `AlbumDayRepo`, où un
`excluded.description` glissé par mégarde effacerait tout à chaque passage
horaire. La seule suppression vient de la cascade sur `albums`.

**Transportée avec l'item, pas en appel groupé.** Les compteurs de commentaires
d'un album voyagent d'un bloc (D54), et on aurait pu faire de même. Trois raisons
de ne pas le faire ici. La visionneuse doit afficher la légende sur la photo
qu'on vient d'atteindre à la flèche, donc au même instant que l'item lui-même —
pas au retour d'une seconde requête. Le coût est une jointure `LEFT JOIN`
1-pour-1 sur une clé primaire, invisible à côté du parcours d'index que la page
fait déjà. Et un bloc « toutes les descriptions de l'album » transporterait, sur
un album largement décrit, des kilo-octets de texte pour des photos qu'on ne
regardera pas — là où un compteur tient en un entier.

**Écarté.** Une colonne `media.description`. Elle aurait évité la jointure, mais
`upsertMany` réécrit toute la ligne à chaque synchronisation : il aurait fallu
l'exclure du `DO UPDATE` — un oubli silencieux à un caractère près, sur une
requête déjà longue de vingt colonnes. Et elle aurait disparu avec la photo, ce
que toute l'entrée cherche à éviter.

Écarté aussi : refuser les vidéos, comme le fait `coverId`. Le refus s'y justifie
par le pipeline, qui ne rend pas de vignette vidéo ; ici rien ne s'y oppose, et
une vidéo mérite une légende autant qu'une photo.

**Conséquences.** `MediaItem` gagne un champ, donc `MediaDetail` aussi — le
panneau `i` en hérite sans un mot de plus. La borne est de 1000 caractères,
entre la note de journée (300, dont l'en-tête de section précalcule la hauteur
sans DOM — D49) et la description d'album (2000, un paragraphe libre) : posée sur
la photo, au-delà de mille caractères une légende cesse d'être une légende.

`SELECT *` devient `SELECT media.*` dans `listItems` et `getDetail` : les deux
tables portent une colonne `album_id`, et SQLite l'accepterait sans broncher en
laissant le lecteur suivant deviner laquelle il tient.
