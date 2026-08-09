# D84 — Le contexte descend en bas de la visionneuse, à toutes les largeurs

**Contexte.** Trois textes décrivent une photo ouverte, et aucun n'était là quand
on la regardait. La description de l'album ne vit qu'en tête de grille. La note
du jour n'apparaissait dans la visionneuse qu'à partir de `md` (D70), donc jamais
sur téléphone. Et la description de la photo elle-même venait d'exister (D83)
sans avoir nulle part où s'afficher. Ouvrir une image faisait donc perdre
l'essentiel de ce qui l'explique — exactement le défaut que D68 puis D74 avaient
attaqué par petites touches, en portant un fragment de contexte dans l'en-tête.

**Choix.** Un bandeau bas dans la colonne photo (`MediaCaption`), qui empile les
trois textes par portée décroissante — la photo, la journée, l'album —, à
**toutes** les largeurs. La hiérarchie est portée par la couleur et le nombre de
lignes visibles (`ink-100`/3, `ink-300`/2, `ink-500`/1), sans aucun titre : plus
la portée est large, plus la ligne s'efface.

**Cela renverse le seuil de D70, et il faut dire pourquoi ce n'est pas se
dédire.** L'arbitrage de D70 portait sur **deux lignes empilées au-dessus de
l'image**, sur un téléphone où la photo est déjà à l'étroit : le contexte y
mangeait le cadrage par le haut, sans recours. La question posée ici n'est pas
la même. Une légende posée sous la photo, sur un dégradé, ne rogne rien du même
ordre ; elle est repliée par défaut ; et elle se masque d'un geste, ce que la
note de l'en-tête ne proposait pas. D70 écartait d'ailleurs explicitement « un
dépliement au toucher » — un geste de plus pour un texte que la grille montrait
déjà. C'est vrai de la note du jour, faux de la description d'une photo, que la
grille ne montre nulle part.

**Le masquage est persisté, le dépliement ne l'est pas.** La différence n'est pas
un oubli : masquer est un choix sur la façon de regarder ses photos — on le fait
une fois, et le redemander à chaque ouverture serait le meilleur moyen de ne
jamais l'utiliser. Déplier est une réponse à un texte précis, qui n'a aucun sens
sur la photo suivante. Le premier vit donc dans `localStorage`
(`useCaptionHidden`), le second dans l'état d'un composant remonté à chaque
photo.

Masqué, un bouton fantôme « Afficher la légende (l) » reste en bas à droite. Un
état caché sans porte de sortie est un piège : le bandeau parti, plus rien ne
dirait qu'il a existé.

**Écarté.** Laisser la description de photo dans le seul panneau `i`. Il est
fermé par défaut, et une légende qu'il faut aller chercher n'est pas une légende.

Écarté aussi : un bandeau permanent non masquable. Une galerie se regarde aussi
pour les images seules, et un texte posé sur chaque photo, sans moyen de
l'écarter, finirait par être ce qu'on reproche à l'application.

**Conséquences.** La note du jour quitte l'en-tête, qui ne garde que ce qui
identifie le fichier et situe la journée. Les lignes « Lieu » et « Ce jour-là »
d'`ExifPanel` deviennent une redite du bandeau : elles restent, parce qu'elles
sont le seul endroit qui donne le texte **entier** sans dépliement, et que les
retirer ferait perdre l'accès à la note depuis un panneau déjà ouvert. Leur
statut change, pas leur code — elles étaient le recours de D70 sous `md`, elles
sont désormais un confort.

`Échap` gagne une couche — éditeur, zoom, panneau, fermeture. La saisie de la
légende vit dans la visionneuse, et le gestionnaire de touches laisse passer
`Échap` depuis un champ de saisie (c'est la sortie de secours) : sans cette
couche, corriger une légende et appuyer sur `Échap` fermerait la visionneuse
par-dessus un texte non enregistré.

Sur une vidéo, et là seulement, le bandeau **pousse** au lieu de recouvrir. Les
contrôles natifs de lecture vivent au bas de la balise ; sur une vidéo portrait
qui remplit l'écran, un bandeau posé dessus rendrait play/pause et la barre de
progression intouchables — un défaut bien pire que la place perdue.
