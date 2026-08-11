# D31 — Le regroupement de la grille vit dans l'URL, mais « aujourd'hui » se lit sur l'horloge locale

**Contexte.** La grille découpait les photos en mois, en dur. Sur un album de
vacances — trois mille photos sur trois semaines — cela produit une ou deux
sections, c'est-à-dire aucun repère. Le découpage par jour donne des en-têtes
utiles, mais tout le front affiche ses dates en UTC (voir `CLAUDE.md`), et un
découpage par jour en heure locale ferait basculer de section les photos de fin
de soirée.

**Choix.** `GroupBy = 'month' | 'day'` dans `@nonni/shared`, `?group=day` dans
l'URL comme `?order=asc`, et `LayoutOptions.groupBy` dans `computeLayout`. Les
deux clés de section sont des tranches de la chaîne ISO (`slice(0, 7)`,
`slice(0, 10)`), donc en UTC par construction : aucun objet `Date` n'intervient
dans le découpage, et un navigateur à Auckland segmente exactement comme un
navigateur à Lisbonne.

**Choix.** `dayLabel` nomme « Aujourd'hui » et « Hier » les deux jours les plus
récents, et **compare au calendrier local du navigateur**, pas au jour UTC.
C'est la seule date du front qui ne soit pas en UTC, et c'est cohérent :
`taken_at` est l'heure qu'affichait l'appareil, donc l'horloge murale de celui
qui a pris la photo — la même que celle de celui qui la regarde. Comparer au
jour UTC refuserait « Aujourd'hui » à un après-midi encore en cours à Montréal,
et l'accorderait à Auckland avant que la journée n'ait commencé. La date
complète, elle, reste rendue par `formatDate`, en UTC.

**Écarté.** Un regroupement par année : sur l'album qui motive la fonctionnalité
il ne produit qu'une seule section. Écarté aussi : envoyer `group` au serveur et
le mettre dans la clé TanStack Query — la liste servie est identique, seule la
mise en page la segmente, et l'y mettre rechargerait tout l'album à chaque
bascule. Écarté enfin : un repère relatif au-delà de la veille (« il y a
5 jours »), qui demande un calcul mental de plus que la date elle-même.

**Conséquences.** Par jour, `layout.sections` est beaucoup plus long, et
`JustifiedGrid` le balaie à chaque événement de défilement. Mesuré sur le pire
cas — 3 000 photos, 3 000 sections — ce balayage coûte 0,02 ms, contre 0,004 ms
pour les 99 sections du même album par mois : la virtualisation tient sans
changement, et une recherche dichotomique n'apporterait rien de mesurable pour
une invariante de tri en plus. La hauteur totale, en revanche, explose (94 000 px
par mois contre 837 000 px par jour sur ce même cas) : c'est le prix d'un en-tête
et d'une dernière ligne non justifiée par section, et c'est assumé. La bascule
remet la sélection clavier à zéro et remonte la page, comme l'inversion du tri.
