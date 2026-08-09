# D90 — Les contrôles de vue se nomment au survol, à toutes les largeurs

**Contexte.** [D73](./D73-la-barre-superieure-tient-sur-une-rangee-et-declare-ses-au.md)
a mesuré ce que coûtaient les libellés des contrôles de vue et les a repoussés
au-delà de `lg` : à 768 px, les afficher ramenait le titre d'album de 456 à
144 px. Au-delà de ce seuil, la place ne manquant plus, ils revenaient.

Ce que la mesure ne disait pas, c'est qu'ils ne servaient pas davantage sur un
écran large. « Plus récentes d'abord » y occupait à lui seul plus de largeur que
le sous-titre de l'album — 900 éléments, la période couverte —, pour un réglage
qu'on touche une fois par visite, dans une application dont tout le propos est
que ce qui ressorte soit les photos.

**Décision.** Les libellés ne reviennent à aucune largeur. Les deux contrôles se
nomment **au survol** : l'infobulle et le nom accessible portent la même phrase,
l'état courant puis l'effet du clic — « Plus récentes d'abord — Afficher les
plus anciennes d'abord ». N'annoncer que l'effet, comme le faisait l'infobulle,
laissait deviner d'où l'on part.

L'état reste par ailleurs lisible dans le tracé, qui en dépend déjà : le sens de
la flèche pour le tri, un trait ou deux dans le calendrier pour le découpage.
Et sous `sm`, c'est le menu **Affichage** qui nomme tout en clair — là où la
place manque le moins, une liste déroulée n'ayant pas de largeur à défendre.

**Conséquences.** `TopBarAction.icon` porte désormais le **tracé** et non la
balise `<svg>`, comme les actions de la visionneuse : c'est la barre qui
l'enveloppe, à 20 px en ligne et 16 px dans le menu. Sans cela, un tracé livré
tout fait imposait la même taille aux deux, et les 16 px des contrôles de vue
juraient avec les 20 du bouton d'activité — un écart que le libellé masquait, et
que son retrait a mis au premier plan. Les boutons de la rangée sont du même
coup tous carrés de 36 px.

**Écarté.** Raccourcir les libellés plutôt que les retirer — « Récentes », « Par
jour ». La barre y gagnait la moitié, mais deux mots posés en permanence pour un
réglage rarement touché restaient deux mots de trop, et il aurait fallu inventer
un vocabulaire court là où le vocabulaire long existe déjà dans le menu.
