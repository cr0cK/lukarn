# D50 — La saisie vit dans l'album, la mutation reste sous `/api/admin`

**Contexte.** On ne sait quoi écrire sur une journée qu'en voyant ses photos.
Faire annoter depuis `/admin` reviendrait à demander à quelqu'un de décrire le
14 juillet de mémoire, devant une liste d'albums.

**Choix.** Le crayon est dans la grille, en face des photos ; la requête part
sur `PATCH /api/admin/albums/:id/days/:day`. La lecture, elle, est côté galerie :
`GET /api/albums/:albumId/days`.

Ce n'est pas une incohérence, c'est ce qui **préserve un invariant** : seul
`/api/admin/*` répond **403**. Partout ailleurs, un refus d'accès répond 404
pour que la liste des albums d'autrui ne soit pas devinable (D12). Une route
d'écriture montée sous `/api/albums` aurait dû choisir entre trahir cet
invariant et répondre 404 à un visiteur légitime qui n'est pas administrateur —
c'est-à-dire mentir sur l'existence de l'album qu'il est en train de regarder.

**Écarté.** _Un troisième régime de réponse_ (403 sous `/api/albums` pour cette
route seulement) : un invariant qui souffre une exception n'en est plus un, et
c'est le genre de détail qui se perd à la revue suivante. _Une section
« journées » dans `/admin`_ : elle demanderait de retrouver une date dans une
liste, sans les photos qui disent de quoi il s'agit.

**Conséquences.** Le front porte la règle « crayon visible si `me.admin` et
découpage par jour », et le serveur la revérifie — comme partout, l'interface ne
fait qu'éviter d'offrir un geste qui échouerait.
