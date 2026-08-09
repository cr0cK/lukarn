# D85 — Une ligne par texte dans l'en-tête de section, parce qu'une hauteur réservée doit être exacte

**Contexte.** Le layout de la grille est calculé sans DOM : `useGridLayout`
déclare la hauteur de chaque en-tête, et `SectionHeader` doit tenir dedans
(D49). La note d'une journée s'y réservait **deux** lignes — 40 px — alors
qu'une note de journée est le plus souvent courte et n'en occupe qu'une. Les
20 px de trop tombaient sous le texte, et l'écart avant les vignettes passait de
12 px à 32 px d'une section à l'autre, selon la longueur d'une note. Le défaut
se voit sur deux sections voisines, et n'a aucune explication visible.

**Choix.** Une seule ligne, tronquée, pour le lieu **comme** pour la note, et
une seule constante — `GRID_HEADER_LINE_HEIGHT` — pour les deux. La réservation
devient exacte par construction : ce que le layout compte est exactement ce que
le composant rend, quelle que soit la longueur du texte.

**Ce que la note perd, et où elle le retrouve.** Une note de 300 caractères se
lisait sur deux lignes dans la grille ; elle s'y lit maintenant sur une, avec
une ellipse. Son texte entier reste dans l'attribut `title`, dans le panneau
`i`, et surtout dans le **bandeau de la visionneuse** (D84), qui la montre à
toutes les largeurs et la déplie au clic. C'est cette dernière porte qui rend
l'arbitrage tenable : quand D49 fixait deux lignes, la grille était le seul
endroit qui montrât la note.

**Écarté.** Estimer le nombre de lignes à partir de la longueur du texte et de
la largeur disponible, en majorant la largeur d'un glyphe pour ne jamais
sous-réserver. Cela marche, et cela gardait deux lignes aux notes longues. Mais
c'est une constante de plus à faire suivre la taille de police, et une
estimation juste « presque toujours » : le jour où elle se trompe vers le bas,
les vignettes passent sous le texte, sans rien pour le rattraper. Un contrat
exact vaut mieux qu'une estimation prudente.

Écarté aussi : réserver 40 px et forcer la boîte à deux lignes même vide. La
hauteur redevenait cohérente, mais l'espace blanc restait — c'est lui qu'on
voulait supprimer, pas son irrégularité.

**Conséquences.** `GRID_PLACE_HEIGHT` et `GRID_DESCRIPTION_HEIGHT` fusionnent en
`GRID_HEADER_LINE_HEIGHT`. L'écart entre un en-tête et ses vignettes vaut
désormais `GRID_HEADER_PAD_BOTTOM` (12 px) dans **tous** les cas : sans note,
avec un lieu seul, avec une note courte, avec une note longue.

`ALBUM_DAY_DESCRIPTION_MAX_LENGTH` reste à 300. La borne ne servait pas à tenir
dans deux lignes — elle dit qu'une note de journée est un repère, pas un récit,
et cela n'a pas changé.
