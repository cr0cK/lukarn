# D88 — La photo ouverte dit d'où elle vient, et s'en débarrasse d'une touche

**Contexte.** [D84](./D84-le-contexte-descend-en-bas-de-la-visionneuse-a-toutes-les.md)
a fait descendre dans le bandeau bas tout ce qui est **écrit à la main** sur une
photo. L'en-tête, lui, a gardé la répartition d'avant : le nom du fichier en
gras et en tête ([D74](./D74-la-visionneuse-range-ses-actions-et-rend-a-la-photo-la-note.md)),
la journée et le lieu comprimés sur la ligne du dessous. Or `IMG_0004.jpg` ne
dit ni où, ni quand, ni quoi, et il occupait la place de la seule information
qui manque vraiment quand on ouvre un lien partagé : de quel album vient cette
photo.

**Décision.** Les deux zones se partagent le travail selon ce qu'elles portent —
l'en-tête **situe**, le bandeau **raconte**. En haut : **album · journée**, puis
le lieu sur sa propre ligne. En bas, inchangé : ce que quelqu'un a écrit. Le nom
du fichier descend en tête du panneau `i`, où `SidePanel` l'affichait déjà,
auprès des données techniques qu'il accompagne.

C'est le titre d'album qui se tronque, jamais la date. Sur un téléphone la ligne
ne tient pas les deux, et « Allemagne – Forêt Noire · Aujo… » sacrifierait
précisément ce qu'on cherchait à donner : la date est courte et bornée, elle
reste entière.

**`h` escamote tout l'habillage** : en-tête, flèches, bandeau de légende. Le
raccourci ne fait pas double emploi avec le `l` de D84, et les deux portées ne se
recouvrent pas — `l` range le texte du bas et laisse en place le bouton qui le
rappelle, `h` ne laisse rien d'autre que la photo. Les touches ←/→ et le
balayage continuent de fonctionner : on escamote ce qui se voit, pas ce qui se
pilote. Un unique bouton reste au coin haut-droit, sans quoi la sortie ne
tiendrait qu'au clavier, c'est-à-dire à rien pour qui touche l'écran.

L'état n'est **pas** persisté, contrairement au masquage de la légende, et
l'asymétrie est voulue : ranger la légende est un choix sur la façon de lire ses
photos, escamoter tout l'habillage est un geste qu'on fait devant une image
précise. Une visionneuse qui rouvrirait sans un seul repère laisserait qui a
oublié le raccourci devant un écran muet.

**Écarté.** Garder le nom du fichier sur une ligne de plus : l'en-tête en compte
déjà deux, et l'allonger pour l'information la moins utile du lot est l'inverse
du problème qu'on traite. Écarté aussi : faire du clic sur la photo la bascule
d'habillage. Ce geste bascule déjà le zoom, et deux sens pour un même clic se
disputeraient à chaque photo.

**Conséquences.** `Lightbox` prend un `albumTitle` — la visionneuse est une vue
à part entière, on y arrive par un lien sans avoir vu la grille. La grille, elle,
ne change pas : son en-tête de section porte déjà la journée, elle est dans un
album qu'on vient d'ouvrir, et rien n'y est posé sur une photo.
