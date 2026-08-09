# D94 — Une photo sans position le dit, au lieu de laisser la ligne disparaître

**Contexte.** Le panneau d'informations n'affiche que ce qu'il a : chaque ligne
sans valeur s'efface, ce qui évite un tableau de tirets sur une capture d'écran
qui ne porte aucun EXIF. La position suivait cette règle, et elle est la seule
pour qui elle ne marche pas. Deux causes très différentes produisent le même
écran vide : la photo n'a jamais été géolocalisée, ou l'application ne l'a pas
encore traitée. La première est définitive, la seconde invite à revenir plus
tard — et rien ne les distinguait. La confusion est d'autant plus facile que le
panneau montre juste au-dessus un « Lieu » qui, lui, **dépend** du géocodage
inverse (D48) et met un passage de fond à s'allumer.

**Choix.** La ligne « Position » est toujours rendue pour une photo. Avec
coordonnées, elle donne le couple lat/lng et ouvre OpenStreetMap. Sans, elle dit
« Aucune donnée GPS », en `ink-400` — la couleur de ce qui constate au lieu
d'informer, déjà celle des libellés. Une seule des deux causes reste possible
après lecture.

Elle n'attend pas le géocodage : les coordonnées sortent de l'EXIF du fichier,
recopiées à la synchronisation, alors que le nom du lieu vient d'un appel réseau
plafonné à une requête par seconde, groupé par journée et parfois sans résultat
exploitable. Les deux lignes disent donc des choses différentes, et c'est
voulu — « Position » est ce que la photo porte, « Lieu » est ce qu'on a su en
faire.

**Réservé aux photos.** Drive ne rend de position que dans
`imageMediaMetadata` ; `videoMediaMetadata` n'en porte pas, quel que soit le
fichier. Une vidéo afficherait donc « Aucune donnée GPS » sans exception, ce qui
n'apprendrait rien de celle qu'on regarde et affirmerait quelque chose de faux :
que le fichier n'est pas géolocalisé, alors qu'on ne sait simplement pas le lire.
Sur une vidéo, la ligne reste absente.

**Écarté.** Distinguer une troisième situation — la photo a des coordonnées mais
la journée n'a pas encore de nom — par une ligne « Lieu : nom pas encore
déterminé ». C'est le cas transitoire d'une instance qui vient de synchroniser,
et il se referme tout seul en quelques minutes. Mais rien ne permet de promettre
qu'il se refermera : le géocodage peut aboutir sans résultat exploitable, et
`geo_places` retient alors une ligne à `label` nul pour ne plus redemander. Le
panneau annoncerait un nom qui n'arrivera jamais.

**Conséquences.** `buildRows` quitte `ExifPanel` pour `lib/exifRows.ts`, à côté
de `caption.ts` et pour la même raison : c'est la seule partie du panneau qui
ait des cas, et hors du composant elle se vérifie sans DOM. Les lignes portent
un champ `absent`, qui ne sert pour l'instant qu'à la position — toute autre
ligne dont l'absence mériterait d'être dite passerait par là plutôt que par une
seconde couleur écrite en dur.
