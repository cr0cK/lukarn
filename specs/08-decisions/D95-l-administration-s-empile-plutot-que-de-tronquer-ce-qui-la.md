# D95 — L'administration s'empile plutôt que de tronquer ce qui la nomme

**Contexte.** `/admin` était borné à `max-w-5xl`, soit 64 rem. Sur un écran de
portable de 1495 px, la colonne de contenu tombait à 760 px une fois les 12 rem
d'`AdminNav` et les marges déduites, pendant qu'un tiers de la fenêtre restait
vide de chaque côté. Chaque ligne — album, compte, état du Drive — plaçait sur
une seule rangée un bloc descriptif marqué `flex-1 min-w-0` et trois à cinq
boutons marqués `whitespace-nowrap`. La rangée ne pouvant se rétracter que d'un
côté, c'était toujours le même qui payait : un album s'affichait « 2… » sur
téléphone, le badge « administrateur » d'un compte se coupait à « administ »,
et l'avertissement de `DriveSection` descendait à un mot par ligne. Le sélecteur
d'album de la file de modération, lui, réclame la largeur de sa plus longue
option et débordait du cadre de sa section.

**Choix.** Deux gestes, l'un pour la place disponible, l'autre pour son partage.

La borne passe à `max-w-[90rem]` : la colonne de contenu gagne 410 px sur un
écran de 1495 px, ce qui suffit à rendre entiers les titres et la ligne de
métadonnées qui les suit.

Et la ligne devient **empilée sous `xl`, en rangée au-delà** — `ROW_CLASS` et
`ROW_ACTIONS_CLASS` dans `ui.tsx`, employés par les quatre sections qui portent
des lignes. Le bloc descriptif prend alors toute la largeur et les actions
passent en dessous : une hauteur de bouton de plus, contre un intitulé qu'on
peut lire.

**Pourquoi `xl` et non `sm`.** Le premier essai basculait à 640 px, et la
troncature revenait dès 820 : `AdminNav` prend sa colonne de 12 rem à partir de
`md`, si bien que la bande 768–1280 px est celle où la place manque le plus,
alors même qu'elle n'a rien d'un téléphone. À 1024 px, une rangée à quatre
boutons rognait encore le titre. Le seuil est donc posé là où une rangée tient
vraiment, et les largeurs de portable courantes — 1280, 1366, 1440 — restent
au-dessus.

**Écarté.** Reléguer les actions secondaires derrière un menu « … » sur les
largeurs étroites. C'est plus compact, et c'est un composant de plus à écrire,
à rendre navigable au clavier et à documenter, pour cacher des gestes qui
tiennent sur une rangée dès qu'on cesse de les mettre en concurrence avec le
titre. Une action d'administration qu'il faut découvrir derrière un menu est
une action qu'on ne trouve pas quand elle presse.

Écarté aussi : supprimer toute borne de largeur. Sur un écran de 2560 px, les
lignes feraient 2400 px et l'œil traverserait la fenêtre entière pour aller du
titre d'un album au bouton qui le concerne. La borne existe pour que le regard
n'ait pas à voyager, pas parce que l'écran serait petit.

**Conséquences.** `truncate` reste en place sur les métadonnées, où il est le
bon comportement : elles se résument, quand un intitulé se lit ou ne se lit pas.
Dans la liste des comptes il descend du paragraphe entier au seul identifiant,
les mentions qui le suivent passant en `shrink-0` — posé plus haut, il laissait
le badge se rétracter avec le reste. L'état de synchronisation d'un album ouvre
désormais le groupe d'actions au lieu de fermer les métadonnées : c'est ce qu'on
lit avant de décider de resynchroniser, et il reste ainsi contre le bouton qu'il
appelle une fois la ligne empilée.
