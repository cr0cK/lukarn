# D11 — Sessions en base plutôt que JWT

**Contexte.** Il faut authentifier les visiteurs entre deux requêtes.

**Choix.** Un identifiant opaque de 32 octets aléatoires, une ligne dans
`sessions`, un cookie `httpOnly` signé.

**Écarté.** Un JWT stateless. Il reste valide jusqu'à son expiration où qu'il se
trouve : couper l'accès à quelqu'un — déconnexion, retrait de la config —
suppose une liste de révocation, c'est-à-dire une table en base, donc exactement
ce que le JWT prétendait éviter. Ici la session **est** la ligne, et la supprimer
suffit.

**Conséquences.** Une lecture SQLite par requête, négligeable en process. En
prime, le hook `onRequest` revérifie à chaque fois que le compte existe encore
et relit son rôle : la configuration fait autorité, pas le cookie. C'est ce qui
permet à un retrait de droits de prendre effet sans attendre l'expiration de la
session — la configuration vivait alors dans `albums.yaml`, elle est depuis
passée en base (voir D24), mais le raisonnement est inchangé.
