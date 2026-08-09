# D69 — La progression de la visionneuse se compte sur l'album, pas sur la liste chargée

**Contexte.** La visionneuse affichait `index + 1 / items.length`. `items` est
la liste **paginée** : elle grandit au fil du défilement et des préchargements.
Le dénominateur montait donc en cours de route — « 40 / 50 » redevenait
« 40 / 100 » sous les yeux de qui feuillette, puis « 40 / 150 ». Le seul moment
où le compteur disait vrai était la dernière page atteinte.

**Choix.** Le dénominateur est `album.itemCount`, transmis à la visionneuse en
`total`. C'est le compte que le serveur tient pour l'album, indépendant de ce
qui est chargé, et déjà affiché en sous-titre de la page. Le rendu retient
`Math.max(total, items.length)` : une synchronisation qui ajoute des médias
pendant qu'on feuillette ne doit pas produire « 60 / 50 ».

**Écarté.** Masquer le compteur tant que la pagination n'est pas finie : c'est
précisément au milieu d'un long album qu'on veut savoir où l'on en est. Écarté
aussi de charger l'album entier à l'ouverture de la visionneuse pour rendre
`items.length` exact — des milliers de lignes pour afficher un nombre.

**Conséquences.** La progression devient une barre, doublée du rapport chiffré.
Un rapport de deux nombres demande une lecture ; une barre se voit. Elle est
collée au **bord haut** de la visionneuse, sur toute la largeur et épaisse de
deux pixels : posée plus bas, dans le flux de l'en-tête, elle barrait la photo
d'un trait de couleur. Au bord, elle se lit comme une barre de chargement et ne
dispute rien à l'image.
