# D74 — La visionneuse range ses actions, et rend à la photo la note de sa journée

**Contexte.** Deux défauts au même endroit, sur téléphone. Les six actions de
l'en-tête ne laissaient que 121 px au titre, si bien que la date restait
tronquée même après avoir resserré les icônes. Et surtout, **ouvrir une photo
faisait disparaître ce qui la décrit** : la grille affiche la note et le lieu de
la journée en tête de section, la visionneuse ne les recevait pas du tout.

Cette vue est celle qu'on utilisera le plus — on regarde des photos sur un
téléphone.

**Choix.** Sous `sm`, Informations, Zoomer, Télécharger et Plein écran passent
dans un menu kebab. Le bloc titre passe à 235 px et la date s'affiche en entier.
Le panneau Infos s'ouvre désormais sur deux lignes, « Lieu » et « Ce jour-là »,
avant l'EXIF.

**`Commentaires` est la seule action à rester en ligne**, quelle que soit la
largeur : son icône porte la pastille des non-lus, et c'est le seul signe qu'une
photo a été commentée. Rangée dans un menu, elle ne signalerait plus rien — un
indicateur qu'il faut ouvrir un menu pour voir n'est pas un indicateur.

**Écarté.** Mettre les cinq actions dans le menu : le titre y gagnait 38 px de
plus, au prix de cette pastille. Écarté aussi : garder Informations en ligne à
côté de Commentaires — le titre retombait à 197 px, et la date repassait tout
juste, sans marge pour un nom de fichier long.

Écarté surtout : **une vraie légende par photo.** C'est ce que la demande
appelait, mais elle n'existe pas dans le modèle — il faudrait une colonne, une
migration, un écran d'administration, une route et un contrat partagé. La note
de journée existe déjà, elle est saisie depuis l'album, et elle répond au même
besoin dans la quasi-totalité des cas : ce qui décrit une photo de vacances,
c'est le jour et le lieu. Le chantier de la légende par photo reste ouvert, il
n'est simplement pas dans cette PR.

Écarté enfin : afficher la note en surimpression sous la photo. Toujours
visible, sans tap — mais une bande de plus par-dessus une image déjà petite sur
un téléphone, sur une application dont le principe est que le chrome ne doit pas
concurrencer les photos.

**Conséquences.** `useAlbumDays` est appelé quel que soit le regroupement, et
non plus seulement en mode « par jour » : une requête par album, dont la réponse
ne porte que les journées ayant quelque chose à montrer. Sans cela, la note
n'apparaîtrait que dans les albums réglés par jour.

Sur grand écran, `Commentaires` passe **devant** `Informations` au lieu de la
suivre. C'est le prix de la position fixe, et le bon compromis : la seule action
à ne jamais bouger est celle qu'il faut pouvoir repérer.

Le menu kebab est extrait dans `components/ActionMenu.tsx`, partagé avec la
`TopBar` ([D73](./D73-la-barre-superieure-tient-sur-une-rangee-et-declare-ses-au.md)). Ce qui compte dans ce composant n'est pas
son dessin mais ses trois règles de fermeture — clic dehors, `Échap` avec
restitution du focus, fermeture avant l'action — et elles se seraient réécrites
de travers la deuxième fois. Son écoute de `Échap` est en capture et arrête la
propagation, sans quoi un seul appui fermerait le menu **et** la photo.
