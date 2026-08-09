# D91 — Une synchronisation nomme les journées qu'elle vient de remplir

**Contexte.** [D48](./D48-le-geocodage-tourne-en-fond-et-son-cache-est-une-cellule-d.md)
a branché le passage des lieux sur le démarrage et sur le ménage horaire, en
écartant explicitement le chemin d'une synchronisation : le géocodage est
plafonné à une requête par seconde, et une sync ne devait pas l'attendre.

Le raisonnement portait sur le blocage, et le blocage a disparu depuis.
[D58](./D58-le-prechauffage-prepare-les-vignettes-et-suit-la.md)
a fait passer toute synchronisation par `AppContext.syncThenPrewarm`, appelé
détaché : `/admin/resync` répond 202 avant que quoi que ce soit ne commence. Ce
qui restait n'était plus une contrainte technique mais un délai gratuit — on
verse dans le Drive les photos d'une journée prises au téléphone, elles portent
leur position, l'instance sait la nommer, et l'en-tête reste pourtant muet
jusqu'à une heure. Le cas est celui d'un appareil sans GPS complété par un
téléphone qui en a un : c'est la sync qui apporte la seule donnée capable de
nommer la journée, et c'est elle qui ne déclenchait rien.

**Décision.** Le passage des lieux prend le même troisième déclencheur que le
préchauffage : la fin de chaque synchronisation, dans `syncThenPrewarm`, donc
aussi bien la sync périodique que celle de `/admin` et celle du retour OAuth.

Il part **détaché et avant le préchauffage**. L'ordre compte : l'agrégation des
grappes est instantanée, mais le géocodage qui la suit dure quelques minutes, et
`await` sur lui repousserait d'autant les vignettes — c'est-à-dire ce qui rend
la grille rapide. Détaché, il coûte le temps de l'agrégation et rien d'autre.

**Conséquences.** Le démarrage et la sync de démarrage s'excluent désormais pour
les lieux comme pour le préchauffage, et pour la raison que D58 avait déjà
mesurée : lancés ensemble, le passage de démarrage tient le verrou pendant que
la sync remplit l'index, et celui qui devait la suivre se fait refuser comme
passage concurrent — les photos qui viennent d'arriver attendraient exactement
le ménage horaire qu'on cherchait à éviter. `main.ts` déplace donc son appel
dans la branche « pas de sync au démarrage ».

Rien ne change côté débit vers Nominatim. Le verrou de `PlacesPass` fait d'une
resynchronisation répétée un passage unique, et le cache par cellule veut qu'un
endroit déjà nommé ne soit jamais redemandé : une sync qui n'apporte aucune
position nouvelle ne produit aucune requête.

**Écarté.** _Ne déclencher que l'agrégation à la sync_, en laissant le géocodage
au ménage horaire. C'était le découpage le plus fidèle à D48, et il ne servait à
rien : une journée dont les grappes sont calculées mais sans libellé n'affiche
toujours pas de lieu. La moitié qu'on voulait avancer était précisément la
lente. Il aurait fallu couper `run()` en deux pour un résultat visible une heure
plus tard, soit le problème qu'on corrige.
