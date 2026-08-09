# D48 — Le géocodage tourne en fond, et son cache est une cellule d'un kilomètre

**Contexte.** Les photos portent leur position dans leur EXIF, déjà indexée
(`media.lat/lng`). Personne n'en voyait rien : une grille datée ne dit ni ce
qu'on a fait ni où. Transformer un couple de coordonnées en « Bonifacio,
Corse » demande un service tiers.

**Choix.** Nominatim/OSM, appelé par un **passage de fond** branché sur le
ménage horaire et sur le démarrage, avec un cache par **cellule** `lat,lng`
arrondie à deux décimales (~1,1 km).

Le passage est coupé en deux moitiés qui n'ont pas les mêmes propriétés, et
c'est là que se joue la décision. L'**agrégation** des positions en grappes est
déterministe, instantanée et hors réseau ; le **géocodage** est lent, plafonné
par la politique d'usage à une requête par seconde, et faillible. Les mélanger
— écrire un libellé figé dans `album_days` — obligerait à choisir entre ne
jamais recalculer les journées et rappeler Nominatim à chaque passage. Séparées
(`album_days.cells` d'un côté, `geo_places` de l'autre), le recalcul est gratuit
et les libellés s'allument tout seuls quand ils arrivent.

La cellule d'un kilomètre est la maille en deçà de laquelle deux photos portent
de toute façon le même nom de lieu. Un cache par photo ferait mille appels pour
une journée, un cache par journée n'en réutiliserait rien d'un séjour à l'autre.
Il est partagé entre albums : deux séjours au même endroit ne comptent qu'un
appel.

**Écarté.** _Le géocodage au fil de la requête_ : `better-sqlite3` est
synchrone et une grille demande des dizaines de journées ; à une requête par
seconde, la page attendrait une minute. _Google Geocoding_ : une clé et une
facturation de plus, là où rien d'autre dans cette application n'en demande —
c'est précisément ce que le compte de service et Nominatim évitent.
_Réessayer indéfiniment un lieu sans résultat_ : d'où la distinction entre
« abouti sans résultat » (ligne écrite à `label = NULL`, plus jamais demandée)
et « échec réseau » (aucune ligne, retenté au passage suivant).

**Conséquences.** `GEOCODING_URL` peut être vidée : les journées gardent leurs
grappes, sans libellé. Le premier passage sur une grosse bibliothèque s'étale
sur plusieurs heures — 200 appels par passage horaire —, et l'interface doit
donc tenir sans `autoPlaces`, ce qu'elle fait : un lieu absent ne laisse pas de
trou, il ne s'affiche pas. Le `User-Agent` dérive de `PUBLIC_URL`, comme
l'exige l'instance publique.
