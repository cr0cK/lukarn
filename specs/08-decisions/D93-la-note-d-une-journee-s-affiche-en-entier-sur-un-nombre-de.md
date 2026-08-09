# D93 — La note d'une journée s'affiche en entier, sur un nombre de lignes mesuré et non estimé

**Contexte.** D85 avait réduit la note d'une journée à **une ligne tronquée**
dans l'en-tête de section, pour que la hauteur réservée par `useGridLayout` vaille
exactement la hauteur rendue par `SectionHeader` (D49 : le layout est calculé
sans DOM). Le contrat était exact, mais le prix se voyait : une note de deux
phrases — le cas courant, un itinéraire de journée — s'arrêtait sur une ellipse
au tiers du premier point d'intérêt. Le texte entier restait accessible, mais
dans trois endroits qu'il faut ouvrir : l'infobulle, le panneau `i`, le bandeau
de la visionneuse. Une note qu'on écrit pour être lue en parcourant la grille
n'était plus lue.

**Choix.** La note s'affiche sur autant de lignes qu'il lui en faut, et le
nombre de lignes est **mesuré par le moteur de rendu** avant que le layout ne
soit calculé. `lib/measureLines.ts` tient une sonde `<p>` hors écran, lui pose
les mêmes classes que le paragraphe réel (`GRID_HEADER_NOTE_CLASS`) et la même
largeur de conteneur, puis divise la hauteur obtenue par `GRID_HEADER_LINE_HEIGHT`.

Ce nombre sert ensuite **deux fois, depuis la même source** : `useGridLayout` le
met dans `descriptionLines`, s'en sert pour réserver la hauteur, et le passe au
composant, qui le pose en `line-clamp` sur le paragraphe. La réservation et la
boîte rendue ne peuvent donc pas diverger — pas parce qu'on a recalculé pareil
des deux côtés, mais parce qu'il n'y a qu'un calcul.

**Pourquoi une sonde DOM et pas `canvas.measureText`.** Le canvas mesure des
glyphes, pas une mise en page : il ignore la règle de césure appliquée, le
`text-rendering: optimizeLegibility` posé sur le corps de page, et l'interligne
réel. Ses métriques sont _presque_ les bonnes, et « presque » est exactement ce
que D85 refusait. La sonde, elle, est mesurée par le même moteur, avec les mêmes
classes, à la même largeur : elle est juste par construction. Le coût est un
calcul de style forcé, payé une fois par largeur et par note — le résultat est
mémorisé, et le cache vidé au changement de largeur, ce qui le borne au nombre de
journées annotées.

**Ce qui rend l'arbitrage de D85 caduc.** D85 écartait « estimer le nombre de
lignes d'après la longueur du texte et une largeur de glyphe moyenne », et cet
écart-là reste valable : une estimation se trompe, et se tromper vers le bas fait
passer les vignettes sous le texte. Mesurer n'est pas estimer. La conclusion de
D85 — _une hauteur réservée doit être exacte_ — est conservée telle quelle ; ce
qui change, c'est qu'on sait maintenant l'obtenir exacte sans se limiter à une
ligne.

**Écarté.** Borner l'affichage à trois ou quatre lignes, au-delà desquelles
l'ellipse reviendrait. Cela garderait les en-têtes compacts sur mobile, où une
note de 300 caractères occupe cinq à sept lignes. Mais `ALBUM_DAY_DESCRIPTION_MAX_LENGTH`
borne déjà la note à 300 caractères précisément pour qu'elle reste un repère et
non un récit : poser une seconde borne, dépendant cette fois de la largeur de
l'écran, ferait réapparaître la troncature là où elle gêne le plus.

Écarté aussi : mesurer les en-têtes montés et réinjecter leur hauteur dans le
layout. C'est la solution évidente, et elle est incompatible avec la
virtualisation — un en-tête hors viewport n'est pas monté, donc pas mesurable,
et la barre de défilement serait fausse tant qu'on n'a pas tout parcouru.

**Les retours à la ligne saisis sont conservés** (`whitespace-pre-line`), ce qui
n'était vrai nulle part dans la grille : une note écrite en trois lignes s'y
affichait en une seule phrase, alors que le bandeau de la visionneuse
(`MediaCaption`) et la description d'album gardaient déjà les siens. Le même
texte se lisait donc autrement selon l'endroit où on l'ouvrait. Comme la sonde
porte la même classe que le paragraphe, ces retours entrent d'eux-mêmes dans la
hauteur réservée — c'est le bénéfice d'avoir fait de `GRID_HEADER_NOTE_CLASS` la
définition unique de la géométrie plutôt qu'une liste de classes recopiée.

**Conséquences.** Le lieu, lui, reste sur une ligne tronquée : il est court par
nature, et le déplier multiplierait les cas sans rien montrer de plus. L'écart
entre un en-tête et ses vignettes vaut toujours `GRID_HEADER_PAD_BOTTOM` (12 px)
dans tous les cas, ce que D85 avait obtenu et qu'il fallait garder.
`GridLayout` porte un champ de plus, `descriptionLines`, et `SectionHeader` une
propriété de plus. L'attribut `title` disparaît de la note — il ne redit plus
rien que le texte visible ne dise déjà.
