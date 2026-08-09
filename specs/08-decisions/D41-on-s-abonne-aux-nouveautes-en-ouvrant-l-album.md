# D41 — On s'abonne aux nouveautés en ouvrant l'album

**Contexte.** Personne ne revient spontanément sur une galerie auto-hébergée :
les commentaires livrés avec D38 restent vides tant que personne n'apprend qu'il
y a du nouveau. Le point dur est que **rien ne relie une personne à un album** :
l'accès vient de la clé d'accès (`users`), l'identité de l'adresse vérifiée
(`commenters`), et les deux ne se croisent jamais. On ne sait donc pas
nativement à qui écrire.

**Choix.** Ouvrir un album abonne à ses nouveautés, sur la première page de
`GET /api/albums/:albumId/items`, pour les identités **déjà vérifiées**. Ouvrir
un album est un signal d'intérêt bien meilleur qu'une case à cocher, et les gens
concernés ont fourni leur adresse en connaissance de cause (D39). L'abonnement
est un **état** (`auto` / `opted_out`) et non la simple présence d'une ligne :
sans cela, rouvrir l'album le lendemain d'un désabonnement réabonnerait.

L'annonce est branchée sur le ménage horaire de `main.ts` (`notifier.ts`) et ne
concerne que les albums dont la dernière synchronisation réussie est calme depuis
une heure. Ce qui est nouveau se compte sur `media.added_at`, écrit à l'INSERT et
jamais par le `ON CONFLICT DO UPDATE` de `upsertMany` ; `sync_state.notified_at`
retient ce qui a déjà été annoncé.

**Écarté.** L'opt-in explicite — une case « préviens-moi », que personne ne
coche, dans une galerie familiale où l'on vient trois fois par an. Écarté aussi :
le récapitulatif quotidien, qui casse le lien entre « on vient de rentrer de
vacances » et « il y a des photos », alors que la cadence réactive le garde.
Écarté aussi : annoncer à la fin de chaque synchronisation — avec une sync toutes
les demi-heures écrivant par lots de 500, verser deux cents photos enverrait une
dizaine d'emails dans la journée. Écarté enfin : compter les nouveautés sur
`seen_at`, qui est réécrit sur _tous_ les médias à chaque passage et compterait
donc l'album entier comme neuf, toutes les demi-heures — c'est le piège de cette
fonctionnalité, et il est verrouillé par un test.

**Conséquences.** L'abonnement par défaut n'est acceptable qu'à deux conditions,
tenues toutes les deux : il est **annoncé** là où la personne donne son adresse
(le formulaire d'identité, voir [07](../07-frontend.md)), et il se défait **en un
clic**, par album. Le lien porte donc un jeton du couple adresse + album, sinon
il serait rejouable d'un album à l'autre.

`commenters.notify` reste le commutateur global : il coupe les réponses aux
commentaires **et** les annonces. L'inverse n'est pas vrai — se désabonner d'un
album bavard ne fait pas perdre les réponses à ses propres messages, ce qu'il y a
de plus précieux. Un album que personne n'a encore ouvert voit tout de même sa
borne avancer : sans cela, son premier abonné recevrait pour premier email
« 3 000 nouvelles photos », pour des photos arrivées avant qu'il ne s'abonne.
Enfin, la première exécution du notifieur sur une base existante — ou sur une
instance qui vient de configurer SMTP — **pose la borne sans envoyer** : annoncer
ici, ce serait annoncer tout l'historique de la galerie d'un coup.
