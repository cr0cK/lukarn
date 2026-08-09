# D89 — La description de l'album quitte la légende : on l'a lue en entrant

**Contexte.** [D84](./D84-le-contexte-descend-en-bas-de-la-visionneuse-a-toutes-les.md)
a rassemblé trois textes en bas de la visionneuse, du plus précis au plus
général : la photo, la journée, l'album. Le raisonnement tenait pour les deux
premiers — ils sont propres à ce qu'on regarde. Il tenait moins pour le
troisième, et l'usage l'a montré : la description d'album est **la même sur
toutes les photos de l'album**, et on vient de la lire en tête de grille. Une
ligne de bandeau par photo pour un texte identique neuf cents fois, sur une
zone dont le défaut est justement de manger le cadrage.

**Décision.** La portée `album` disparaît de `captionEntries` — du type, du
composant, et de la plomberie qui descendait `albumDescription` depuis
`AlbumPage`. Le bandeau porte deux lignes : la photo, puis la journée.

Ce que la visionneuse doit à l'album, c'est de dire **lequel**, pas de le
raconter. Son titre est passé en tête de l'en-tête au même moment
([D88](./D88-la-photo-ouverte-dit-d-ou-elle-vient-et-s-en-debarrasse-d.md)),
et c'est ce qui rend ce retrait sans perte : quelqu'un qui arrive par un lien
partagé sait toujours où il est, en un mot au lieu d'un paragraphe.

**Écarté.** Garder la ligne en la repliant par défaut : le bandeau se déplie
d'un bloc, un troisième texte replié restait une ligne de plus à l'écran et un
clic de plus à comprendre. Écarté aussi : ne l'afficher que sur la première
photo ouverte d'une session. Un affichage qui dépend de l'ordre des gestes ne
s'explique pas, et il n'y a rien à expliquer ici — le texte est ailleurs, à un
endroit qu'on a traversé.

**Conséquences.** La description d'album n'a plus qu'un seul lieu, la tête de
grille — où elle prend désormais toute la largeur (D88). Un lien partagé qui
ouvre directement une photo ne la montre donc pas ; refermer la visionneuse la
donne, et c'est le geste qu'on fait de toute façon pour voir le reste de
l'album.
