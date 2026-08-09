# D70 — La note d'une journée quitte l'en-tête de la visionneuse sur mobile

**Contexte.** La note d'une journée s'affiche à deux endroits : l'en-tête de sa
section dans la grille, et l'en-tête de la visionneuse, pour qu'ouvrir une photo
ne fasse pas perdre ce qui lui donne son sens (D68 en décrit le voisin, le
repli). Sur un téléphone, ce second emplacement empile au-dessus de l'image le
nom du fichier, la journée, son lieu, puis jusqu'à deux lignes de note — sur un
écran où la photo est déjà à l'étroit.

Deux réglages pris par ailleurs changent l'arbitrage : la grille affiche
désormais la note à **toutes** les largeurs, et le panneau « Infos » est fermé
par défaut. La note n'est donc plus une information qu'on risque de ne jamais
voir si la visionneuse ne la porte pas.

**Choix.** La note reste dans l'en-tête de la visionneuse à partir de `md`, et
en disparaît en dessous. Le seuil n'est pas choisi au jugé : `md` est la largeur
où `SidePanel` cesse d'être un tiroir en surimpression pour se docker dans le
flux — la frontière déjà établie entre « mise en page de téléphone » et le
reste.

**Écarté.** Masquer toute la ligne de contexte, lieu et date compris. Elle tient
sur une ligne courte, là où la note en prend deux, et c'est précisément ce qu'on
perd en ouvrant une photo depuis la grille : la masquer annulerait la raison
d'avoir porté ce contexte jusqu'ici. Le gain de place aurait été marginal, la
perte entière.

Écarté aussi un dépliement au toucher — un geste de plus sur l'appareil où les
gestes sont les plus rares, pour un texte que la grille montre déjà.

**Conséquences.** Sur mobile, la note n'était plus atteignable que depuis la
grille : `ExifPanel` ne listait alors que l'EXIF. Le recours annoncé ici comme
« un ajout à faire » a été fait dans la foulée — [D74](./D74-la-visionneuse-range-ses-actions-et-rend-a-la-photo-la-note.md) lui
donne ses lignes « Lieu » et « Ce jour-là », sans condition de largeur. Le choix
ci-dessus est inchangé : l'en-tête reste réservé à `md` et au-delà, seul le
constat de la conséquence a cessé d'être vrai.

L'enveloppe du paragraphe porte le `hidden md:block`, et non le paragraphe
lui-même : `line-clamp-2` pose `display: -webkit-box`, et deux utilitaires de
`display` sur un même élément se départagent par l'ordre de la feuille de style,
pas par celui des classes de l'attribut.
