# D55 — Le repère de lecture vit dans le navigateur, pas en base

**Contexte.** Afficher « 3 nouveaux commentaires » demande de savoir où en était
le lecteur. Une table côté serveur serait la réponse réflexe.

**Choix.** `localStorage`, sous `gdv:comments-seen:<albumId>`, un **nombre de
commentaires vus** par photo. Le total vient du serveur, l'écart se calcule à
l'affichage (`unreadCount`).

Deux raisons, dans cet ordre. D'abord une clé d'accès n'est pas une personne
(D38) : indexer un repère de lecture par compte ferait qu'au sein d'un foyer, le
premier à ouvrir une photo effacerait la pastille de tous les autres — l'inverse
exact de ce que la fonctionnalité promet. Le navigateur, lui, est bien celui
d'une personne. Ensuite un entier suffit là où une date obligerait le serveur à
transporter l'horodatage de chaque fil pour qu'on puisse le comparer.

**Écarté.** _Une table `comment_reads(account, album_id, media_id, seen_at)`_ :
une migration, une écriture à chaque ouverture de panneau, une jointure dans les
compteurs, et le défaut de cloisonnement ci-dessus. _Un repère par identité de
commentateur_ plutôt que par compte : il aurait le bon grain, mais la plupart des
lecteurs n'ont jamais vérifié d'adresse — la pastille ne marcherait que pour ceux
qui écrivent.

**Conséquences.** Un changement d'appareil, un nettoyage du navigateur ou une
navigation privée repartent de zéro : on revoit ses propres commentaires comme
non lus **une fois**, jamais l'inverse. C'est le sens de l'erreur acceptable — la
pastille peut être bavarde, elle ne doit pas être muette. Le stockage est borné
par le nombre de photos commentées de l'album, pas par le nombre de photos
regardées, et une photo redescendue à zéro commentaire quitte la table.
