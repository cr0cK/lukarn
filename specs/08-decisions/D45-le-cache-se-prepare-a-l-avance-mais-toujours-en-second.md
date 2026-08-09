# D45 — Le cache se prépare à l'avance, mais toujours en second

> **Deux points de cette entrée ont été revus par D58** : le passage prépare
> désormais les **vignettes** et non la variante `full`, et il **est** branché
> sur la fin de chaque synchronisation. Les trois garde-fous ci-dessous **restent
> en vigueur** — ce sont eux la décision — mais deux de leurs justifications ont
> vieilli. Lire D58 avant d'appliquer ce qui suit.
>
> **Garde-fou n° 1.** Le limiteur de rendu n'a pas quatre places fixes mais
> `max(2, min(4, cœurs - 2))` (`renderConcurrencyFor`), soit **deux** sur le VPS
> à deux cœurs visé par ce projet. Le raisonnement n'en dépend pas : le
> préchauffage n'en occupe jamais qu'une, quel que soit le total.
>
> **Garde-fou n° 2.** Le motif invoqué — des rendus pleine page qui évinceraient
> les vignettes de la grille — **ne peut plus se produire** : le passage ne
> produit que des vignettes. Le seuil de 70 % reste utile, mais il protège
> désormais autre chose : les vignettes des albums qu'on consulte, contre celles
> des albums qu'on prépare.

**Contexte.** Mesuré sur une instance en service, album de 471 photos de reflex
(~8 Mo pièce) : ouvrir une photo jamais rendue coûte **~3,5 s** — environ deux
secondes de téléchargement Drive, une et demie de décodage et d'encodage WebP —
contre **5 ms** une fois le dérivé en cache. Le préchargement des voisines dans
la visionneuse couvre déjà le feuilletage ; il ne couvre pas le retour à la
grille puis l'ouverture d'une photo au hasard, qui est l'usage courant.

**Choix.** Un passage de fond rend la variante `full`, des photos les plus
récentes aux plus anciennes, branché sur le ménage horaire et sur le démarrage.
Trois garde-fous, et ce sont eux la décision — le principe, lui, est évident :

1. **Une photo à la fois, avec une seconde de pause.** Le limiteur de rendu a
   quatre places ; en n'en occupant jamais plus d'une, le préchauffage laisse
   toujours passer quelqu'un qui navigue. Remplir 471 photos prend alors une
   demi-heure, ce qui est le comportement voulu : il n'y a rien à gagner à aller
   vite, personne n'attend.
2. **Il s'arrête à 70 % du cache.** L'éviction est LRU **globale**, pas par
   album : sans cette part réservée, des rendus pleine page (~1 Mo) évinceraient
   les vignettes de la grille (~15 Ko) — ce qu'on regarde le plus — pour des
   photos que personne n'a demandées. Le reste du cache appartient à ce qui est
   réellement consulté.
3. **Le réglage est relu à chaque photo.** On décoche `prewarmCache` parce qu'on
   vient de constater que ça gêne ; un interrupteur qui n'agit qu'au passage
   suivant ne répond pas à cette demande-là.

**Écarté.** Le brancher sur la fin d'une synchronisation, ce qui semblait
naturel : la sync automatique peut être désactivée — elle l'est sur une instance
dont le Drive bouge peu — et le cache attendrait alors un clic pour se remplir,
c'est-à-dire exactement ce qu'on cherche à supprimer. Écarté aussi : préchauffer
`hd`, qui coûte le double et ne sert qu'à ceux qui zooment. Écarté enfin :
préchauffer tout le Drive d'un coup au premier démarrage — 471 photos font
3,7 Go téléchargés, un volume qu'on préfère étaler.

**Sur le quota.** Le préchauffage ne consomme pas _plus_ de quota Drive : ces
téléchargements auraient lieu de toute façon, au premier clic. Il les concentre,
ce qui rend le réessai indispensable — d'où le repli exponentiel ajouté à
`fetchAuthorized` en même temps. Sans lui, chaque `403 rateLimitExceeded`
laisserait un trou dans le cache que rien ne viendrait combler, et une vignette
cassée là où la seconde d'après serait passée.
