# D8 — Repli sur la vignette Drive quand sharp ne décode pas

**Contexte.** La libvips embarquée avec sharp ne décode pas tous les HEIC ni les
RAW propriétaires.

**Choix.** En cas d'échec de `transform()`, `MediaRenderer` demande le
`thumbnailLink` généré par Google, en remplaçant son suffixe `=s220` par la
taille voulue, et relance la transformation sur cet aperçu JPEG.

**Écarté.** Renvoyer une erreur ou une image « format non supporté » : le fichier
est visible dans Drive, il doit l'être ici aussi. Écarté aussi : embarquer un
décodeur RAW dans l'image Docker.

**Conséquences.** Un aperçu Drive est de qualité inférieure à un rendu depuis
l'original ; c'est mieux qu'une case vide. Le repli est journalisé en `warn`.
