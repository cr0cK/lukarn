# D56 — Le panneau latéral prend une colonne, il ne recouvre plus la photo

**Contexte.** Le panneau était posé en surimpression sur le bord droit, à
l'endroit exact de la flèche « Suivant ». Lire un fil puis passer à la photo
suivante demandait de refermer le panneau, cliquer, le rouvrir — à chaque photo.
Le laisser ouvert était impossible, alors que c'est l'usage naturel quand on
parcourt un album commenté.

**Choix.** À partir de `md`, la visionneuse est une rangée : colonne photo
`flex-1 min-w-0`, colonne panneau `md:relative md:w-80 lg:w-96 md:shrink-0` —
le préfixe `md:` porte sur **toutes** ces classes, sans quoi elles
s'appliqueraient aussi à la surimpression `w-full` du téléphone. La zone photo
rétrécit, les flèches restent atteignables, le panneau peut rester ouvert. En
dessous de `md`, la surimpression est conservée — 320 px prélevés sur un écran de
téléphone ne laisseraient rien à voir.

Rien du calcul de zoom n'a bougé. `ZoomableImage` mesure son conteneur par
`ResizeObserver` : l'échelle d'ajustement, le « 100 % » et le bornage du cadrage
se recalculent seuls quand la colonne change de largeur. C'est ce qui a rendu la
correction possible sans toucher à `lib/zoom.ts`.

**Écarté.** _Décaler les flèches vers l'intérieur quand le panneau est ouvert_ :
une classe à changer, mais la photo reste à moitié cachée derrière le panneau, ce
qui est le vrai problème. _Une transition de largeur_ : le `ResizeObserver`
émettrait un rendu par image de l'animation, pour un mouvement qu'on ne regarde
pas.

**Conséquences.** Entre `md` et `lg`, la zone photo tombe à environ 450 px de
large : une photo affichée plus petite, mais navigable. C'est le compromis
assumé, l'alternative étant de repasser en surimpression sur cette plage, donc de
réintroduire le défaut d'origine sur les écrans d'ordinateur portable les plus
courants.
