# D42 — Un renommage attend la preuve, il ne la précède pas

**Contexte.** Relevé en revue croisée. `requestCode` écrivait `display_name` dès
la demande, avec ce commentaire pour justification : « il est de toute façon
revalidé par le code qui suit ». C'était faux dans l'ordre des opérations —
l'écriture précédait la validation, et rien ne la défaisait si le code n'était
jamais saisi.

La conséquence dépassait le nom lui-même. La signature d'un commentaire n'est
pas figée à l'écriture : le fil la lit par jointure sur `commenters`. Il
suffisait donc de connaître l'adresse de quelqu'un — et derrière une clé d'accès
partagée par un foyer, on la connaît — pour renommer d'un coup **tous ses
messages passés**, sans posséder sa boîte.

**Choix.** Le nom demandé pour une identité **déjà vérifiée** attend dans
`pending_display_name` ; `verify` l'applique, et lui seul. Une identité pas
encore vérifiée continue de s'écrire directement : rien n'est signé d'elle, il
n'y a rien à détourner.

**Écarté.** Figer le nom sur la ligne du commentaire à l'écriture, qui
résoudrait aussi le détournement. Écarté parce que se renommer cesserait alors
de valoir pour l'historique : « Mamie » devenue « Grand-mère » traînerait deux
signatures pour une même personne, et la spec promet l'inverse. Écarté aussi :
refuser la demande quand l'adresse appartient à une identité vérifiée — c'est
précisément le chemin qu'emprunte celui qui se ré-identifie depuis un nouvel
appareil, de loin le cas le plus fréquent.

**Conséquences.** Une demande abandonnée laisse un nom en attente, sans effet
visible ; la demande suivante l'écrase. Le renommage, lui, reste global et
rétroactif — c'est le comportement voulu, l'identité étant l'adresse et le nom
son étiquette courante.
