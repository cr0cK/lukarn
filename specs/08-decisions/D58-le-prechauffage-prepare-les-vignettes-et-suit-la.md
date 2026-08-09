# D58 — Le préchauffage prépare les vignettes, et suit la synchronisation

**Contexte.** D45 avait tranché : le préchauffage rend la variante `full`, et
n'est jamais branché sur la fin d'une synchronisation. Les deux points se sont
révélés faux à l'usage, et il a fallu qu'un compte de test ouvre un album de
941 photos jamais consulté pour le voir — **2 min 36 avant la première image**.

Ce qui l'explique, avec la provenance de chaque chiffre — elle compte, ils n'ont
pas tous la même solidité :

- **Un dérivé coûte ~2 s, dont la quasi-totalité en téléchargement Drive.** Repris
  de la mesure de D45, prise sur une instance en service.
- **Le rendu lui-même est négligeable devant ce téléchargement**, de l'ordre de
  quelques dizaines de millisecondes pour une vignette. Cohérent avec D45, qui
  relevait 1,5 s pour un `full` d'un reflex de 8 Mo — une vignette est sans
  commune mesure.
- **Le limiteur ne sert que 2 à 4 rendus à la fois.** Lu dans le code :
  `renderConcurrencyFor` rend `max(2, min(4, cœurs - 2))`, donc **deux** places
  sur le VPS à deux cœurs visé par ce projet, quatre sur une machine de
  développement. Le pire cas est celui de la production.
- **Une grille froide en demande plusieurs dizaines d'un coup.** Mesuré sur
  `seed-demo 941`, contexte navigateur neuf, à l'ouverture et avant tout
  défilement : **26** vignettes montées en 1280 × 720, 31 en 1920 × 1080, 36 en
  2560 × 1440, 41 en 1440 × 2400, 26 en 390 × 844. Recoupé côté serveur : 26
  requêtes `/thumb` distinctes ont bien atteint Fastify à 1280 × 720. Le compte
  est **indépendant du nombre de photos de l'album** — c'est `OVERSCAN_PX` et la
  hauteur de rangée cible qui le fixent — mais il dépend de la fenêtre et des
  formats présents ; « de l'ordre de trente » est le registre à retenir. Sur
  l'album qui a motivé cette entrée, l'attente observée était de 2 min 36.

Or D45 ne préparait pas de vignettes du tout, mais
la variante `full` — celle du clic sur une photo, pas celle de l'affichage de
l'album. Le préchauffage travaillait donc consciencieusement à supprimer une
attente d'une seconde, en laissant intacte celle de plusieurs minutes qui la
précède.

**Choix.** Le passage prépare les **trois tailles de vignette** et rien d'autre.
La taille retenue dépend de la largeur de la case et de la densité de l'écran :
les trois doivent être prêtes, faute de quoi la moitié des écrans repartirait à
zéro. `MediaRenderer.prepare` les produit en **un seul téléchargement** et sur
une seule place du limiteur — c'est l'original en mémoire qui pèse, et il est le
même pour les trois. Le rendu `full` sort du préchauffage : dix fois le poids
d'une vignette, pour une attente déjà couverte par le préchargement des voisines
dans la visionneuse.

Le passage est en outre branché sur la **fin de chaque synchronisation**
(`AppContext.syncThenPrewarm`). C'est le seul instant où l'on sait qu'il y a du
neuf, et les photos qui viennent d'arriver sont exactement celles qu'on va
ouvrir. D45 l'avait écarté au motif que la synchronisation peut être désactivée —
l'argument tient, mais il justifie de **garder** les autres déclencheurs, pas
d'écarter celui-là.

**Écarté.** _Préparer aussi le rendu `full`_ : sur 941 photos, on passe de
quelques dizaines de Mo à plusieurs Go, contre un plafond `cacheMaxSizeGB` qui se
mettrait à évincer — et l'éviction est LRU globale, donc ce sont les vignettes
des albums qu'on regarde vraiment qui partiraient. _Verrouiller un album jusqu'à
son préchauffage complet_, ou _afficher une progression_ : deux réponses au
symptôme, écartées parce que la cause était ailleurs (voir D59) et qu'une fois
celle-ci traitée, l'attente résiduelle ne justifie plus d'appareillage.

**Conséquences.** `prewarmCache` reste un réglage, à `true` par défaut : le
comportement voulu est donc celui d'une instance neuve, et le décocher reste
possible pour une bande passante comptée. Un album déjà préparé ne consomme plus
un passage entier à ne rien faire — `prepare` rend `0` quand tout est en cache,
et le passage saute alors sa pause d'une seconde au lieu de la subir par photo.
