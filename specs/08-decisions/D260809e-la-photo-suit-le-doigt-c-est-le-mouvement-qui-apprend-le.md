# D260809e — La photo suit le doigt : c'est le mouvement qui apprend le geste

**Contexte.** Le balayage horizontal existait dans la visionneuse depuis
`lib/useSwipe.ts`, et il fonctionnait : 50 px franchement horizontaux en moins
de 800 ms, et la photo suivante remplaçait la précédente. Mais **rien ne le
montrait**. Pendant tout le geste, l'écran restait immobile ; l'image ne
changeait qu'une fois le doigt levé, d'un coup. Trois conséquences, et les trois
ont été rapportées comme « ce n'est pas très mobile-friendly » :

- **Le geste ne se découvre pas.** Une visionneuse qui ne bouge pas sous le
  doigt n'apprend rien. Le seul changement de photo visible était la flèche de
  44 px posée sur l'image — celle que le balayage devait précisément remplacer.
- **Le geste ne se reprend pas.** Rien ne disait qu'on avait dépassé le seuil,
  ni de quel côté on allait : impossible de se raviser, puisqu'il n'y avait rien
  à voir avant le résultat.
- **Le changement est sec.** Une photo qui en remplace une autre sans transition
  se lit comme un rechargement, pas comme un feuilletage.

**Choix.** La colonne photo devient un **rail** de trois médias — la précédente,
la courante, la suivante — que le doigt déplace au pixel près, et qui rejoint sa
place au relâchement. C'est le comportement de toute visionneuse native, et il
est fait de quatre règles.

- **Le rail suit le doigt.** La voisine entre par le bord dès les premiers
  pixels : c'est ce mouvement, et lui seul, qui enseigne le geste. Un écart de
  24 px sépare deux photos, sans quoi elles se lisent comme une seule image
  coupée.
- **Le sens se décide une fois**, au dixième pixel parcouru (`DIRECTION_LOCK_PX`)
  et selon le même rapport 1,5 qu'avant. En deçà, rien ne bouge : un rail qui
  frémit sous le moindre appui rendrait le fait de poser le doigt inquiétant. Et
  un geste qui s'incurve en route ne change plus de nature.
- **Deux façons de valider**, parce qu'il y a deux gestes. Traverser 22 % de la
  largeur — on regarde ce qui vient avant de lâcher — ou lancer le rail à plus de
  0,35 px/ms sans regarder. N'en retenir qu'une rendrait l'autre inopérante ; la
  règle des 50 px seule condamnait le lancer du pouce.
- **La remise en place dure ce que le geste appelle.** Sa durée se déduit de ce
  qu'il reste à parcourir et de la vitesse du doigt, bornée à 160–320 ms. Une
  durée fixe trahit le geste : après un lancer sec le rail semble s'engluer,
  après un glissement lent presque abouti il part d'un coup.

Aux extrémités de l'album, le rail bouge encore mais ne rend que 35 % du geste :
le bord se **sent** au lieu d'être annoncé ou tu.

Deux points d'implémentation sont structurants plutôt que décoratifs :

- **La photo ne change qu'une fois le rail arrivé.** La demander plus tôt
  remonterait `ZoomableImage` au milieu de l'animation, sur une photo qui n'est
  pas encore celle que l'écran montre.
- **Le rail ne revient à zéro qu'au changement d'index**, dans un
  `useLayoutEffect`. La visionneuse ne décide pas de son index : elle le demande,
  et il lui revient par l'URL (`?photo=`). Entre les deux, le rail doit rester là
  où l'animation l'a laissé, c'est-à-dire sur la voisine déjà à l'écran — le
  remettre à zéro en même temps qu'on demande le changement ferait réapparaître
  la photo qu'on vient de quitter, le temps d'une image.

**Écarté.**

- **Une simple transition d'opacité entre les deux photos.** Trois lignes de CSS,
  et elle aurait adouci le changement — mais elle ne se déclenche qu'**après** le
  geste. Elle ne montre rien pendant, donc elle n'apprend toujours rien et ne
  laisse toujours pas se raviser. C'est le défaut qu'on corrige, pas la sécheresse
  de la coupure.
- **Un indice au premier passage** — une photo qui glisse d'elle-même, une flèche
  qui pulse. Aucune visionneuse native ne le fait, et pour une bonne raison : ce
  qu'on montre une fois s'oublie, ce qui répond au doigt s'apprend tout seul.
  C'est aussi une animation qui bouge sans qu'on l'ait demandé, sur la photo de
  quelqu'un.
- **Garder les voisines montées en permanence.** Deux images plein écran de plus
  à décoder pour chaque photo regardée, alors qu'elles ne servent qu'au moment du
  geste. Elles sont montées à la reconnaissance du balayage et démontées avec lui.
- **Animer aussi ←/→, les flèches et le clavier.** Le défaut rapporté est celui
  du doigt, et une visionneuse au clavier se parcourt vite : 250 ms d'animation
  par photo mettraient une barrière entre deux pressions de flèche. Le rail reste
  le geste tactile, et lui seul.
- **Étendre le balayage à la souris.** Inchangé : le clic sert déjà à zoomer, et
  un glissement de trois pixels ne doit pas décider entre deux actions.

**Conséquences.**

- La règle des **800 ms** disparaît. Elle protégeait d'un « doigt posé puis
  déplacé » qu'aucun retour visuel ne démentait ; le rail dit désormais en
  permanence ce qui va se passer, et un glissement lent mais franc est un geste
  légitime.
- La décision vit dans `lib/swipeTrack.ts`, hors de React, et elle est testée.
  Les seuils sont ce qui se règle : les laisser dans un gestionnaire
  d'événements les rendrait inéprouvables.
- Les voisines n'ajoutent **aucune requête** : le préchargement des voisines
  (`PRELOAD_AHEAD` / `PRELOAD_BEHIND`) a déjà mis leur rendu `full` en cache
  navigateur. Une vidéo n'a que son aperçu Drive à montrer (D92) ; sans aperçu,
  le rail glisse sur un vide, ce qui reste juste — il n'y a rien à montrer d'elle
  tant qu'elle n'est pas ouverte.
- Le balayage reste **désactivé pendant le zoom et sur une vidéo**, pour les
  mêmes raisons qu'avant, et il continue de dépendre entièrement de
  `touch-action: pinch-zoom` sur la colonne (D77).
- Le rail est **le seul à bouger** : flèches, en-tête, bandeau de légende et
  messages d'erreur restent immobiles pendant qu'on feuillette. Les emmener
  donnerait l'impression de faire glisser la visionneuse, pas les photos.
