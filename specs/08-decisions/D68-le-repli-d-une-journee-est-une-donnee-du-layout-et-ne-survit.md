# D68 — Le repli d'une journée est une donnée du layout, et ne survit pas à la page

**Contexte.** Le découpage par jour ne se voyait pas. Un en-tête de section
suivi de deux cents vignettes, puis un autre en-tête : rien, dans le défilement,
ne dit où une journée s'arrête et où la suivante commence. Le remède demandé
était de pouvoir replier une journée pour lire l'album comme un sommaire.

Deux questions se posaient : où le repli agit, et jusqu'où il dure.

**Choix.** Le repli est une **entrée de `computeLayout`**
(`LayoutOptions.isCollapsed`), pas un masquage au rendu. Une section repliée ne
place aucune ligne : sa hauteur vaut exactement celle de son en-tête, et les
sections suivantes remontent d'autant. C'est la seule position tenable, parce
que `totalHeight` gouverne la barre de défilement et la virtualisation — un
`display: none` posé après coup laisserait la page haute de tout ce qu'elle
n'affiche plus, et la barre mentirait sur ce qui reste à parcourir.

Le repli agit **au niveau de la section**, pas de la journée. Les deux
découpages en profitent pour le même code ; le restreindre au jour aurait
demandé une condition de plus, pour rien. Les clés ne se confondent pas
(`2026-07` contre `2026-07-14`), un seul ensemble les porte donc toutes.

L'état vit dans un `useState` d'`AlbumPage`, **en mémoire seule**.

**Écarté.** L'URL, comme `?photo=` et `?order=` : une liste de jours repliés y
tiendrait mal — vingt clés de dix caractères — et rendrait illisible ce qui est
aussi ce qu'on partage. Écarté aussi `localStorage`, à la manière de
`lib/seenComments.ts` : rouvrir des mois plus tard un album dont tout est replié
sans se rappeler l'avoir fait est un défaut plus coûteux que de redéplier une
journée. Le repli sert à parcourir maintenant, pas à configurer une vue.

**Conséquences.** `LayoutSection` porte `count` et `collapsed`. `count` n'est
pas déductible de `rows` — une section repliée n'en a plus, et c'est justement
là que son en-tête doit annoncer ce qu'elle cache.

Surtout, **`moveSelection` change de repère**. Elle travaillait dans l'espace
des index de la liste d'origine, où `gauche`/`droite` valaient `± 1`. Les deux
espaces coïncidaient tant que la grille montrait tout ; une section repliée les
sépare. La navigation se fait désormais dans l'ordre des cellules réellement
placées (`layout.rows`), faute de quoi une flèche enverrait la sélection sur une
vignette absente du layout : plus rien à mettre en évidence, et
`scrollSelectionIntoView` sans cible. Le paramètre `totalItems` disparaît, le
layout portant seul cette information.

La visionneuse, elle, **ignore le repli** et continue de parcourir l'album
entier. Replier est une aide à la lecture de la grille, pas un filtre : une
flèche qui sauterait silencieusement quarante photos parce qu'une journée est
fermée ailleurs serait un piège.
