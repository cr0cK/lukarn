# D260809f — La feuille de styles est abaissée à la construction, pas écrite deux fois

**Contexte.** L'application s'affichait mal sur le navigateur d'un téléviseur LG :
rembourrages absents, en-tête de la visionneuse recroquevillé, libellés du
panneau collés au bord. Le relevé pris sur l'appareil par
[`/diagnostic`](../07-frontend.md#relevé-du-navigateur--pagesdiagnosticpagetsx)
donne **Chromium 79** (webOS 6.x), viewport 1536 × 856, `devicePixelRatio` 1.25.

Tailwind v4 n'annonce Chromium 111 et au-delà. Trente-deux versions séparent les
deux, et deux d'entre elles font tout le dégât :

- **Les raccourcis logiques n'existent pas avant Chromium 87.** Tailwind v4 émet
  `px-*` en `padding-inline` et `py-*` en `padding-block` : sur ce moteur, **plus
  aucun rembourrage intérieur de l'application ne s'applique**. Même chose pour
  `inset-x-*` et `inset-y-*`, d'où l'en-tête de la visionneuse qui se réduit à sa
  propre largeur de contenu. `inset-0` y échappe, Tailwind l'émettant en
  propriétés physiques.
- **`oklch()` n'existe pas avant Chromium 111.** Les couleurs de la palette par
  défaut — `red`, `amber`, `emerald` — deviennent invalides, et les bandeaux
  d'erreur ou de succès perdent fond et couleur de texte.
- **Les propriétés de transformation indépendantes — `translate`, `rotate`,
  `scale` — n'existent pas avant Chromium 104**, et Tailwind v4 les émet pour
  tous ses utilitaires de transformation. `-translate-y-1/2` ne recentre donc
  plus rien : c'est ce qui posait la loupe du champ de recherche sous son texte.

**Choix.** Un greffon Vite, `tools/legacy-css.ts`, retravaille la CSS **produite**
avant qu'elle ne soit écrite : Lightning CSS ciblé Chromium 79, un doublage des
raccourcis logiques que celui-ci refuse, et un `transform` composé à la place des
trois propriétés indépendantes.

Il agit sur la sortie, jamais sur les sources. C'est ce qui décide : la
correction ne demande rien à qui écrit un composant, n'interdit aucune classe
Tailwind, et couvre le code qui n'est pas encore écrit. L'autre voie —
remplacer les classes fautives à la main — supposait soixante-dix-huit
modifications, une convention à retenir, et une régression au premier `px-4`
distraitement écrit.

**Le raccourci logique reste posé en dernier**, après son équivalent physique.
C'est tout le mécanisme : un moteur qui le connaît applique la dernière
déclaration et continue de respecter le sens d'écriture ; un moteur qui l'ignore
laisse tomber celle-là et garde les deux physiques. Inverser l'ordre ferait
gagner la version physique partout, et sacrifierait le RTL pour tout le monde.

**Les transformations, elles, sont remplacées et non doublées.** Poser un repli
`transform` à côté de `translate` ferait déplacer **deux fois** sur un moteur
récent, qui appliquerait les deux. On passe donc par `transform` partout, au
prix d'une propriété moins moderne pour un rendu identique partout.

Le `transform` composé passe par trois emplacements — `--gdv-translate`,
`--gdv-rotate`, `--gdv-scale` — plutôt que d'écrire la fonction directement.
Sans eux, `rotate-90` et `-translate-y-1/2` sur le même élément se disputeraient
`transform`, et le dernier effacerait le premier ; avec eux ils se composent,
dans l'ordre prescrit. Deux pièges se sont présentés là :

- **Le reset des emplacements vit dans `@layer properties`.** Posé hors couche,
  il l'emportait sur l'utilitaire qu'il devait seulement précéder — une règle
  hors couche bat tout ce qui est en couche — et plus rien ne se transformait.
- **Chaque variable porte sa valeur neutre en repli.** Tailwind initialise ses
  `--tw-translate-*` par `@property` et n'en assure le repli que sous un
  `@supports` écrit pour Safari et Firefox. S'y fier, c'était risquer qu'une
  variable non initialisée invalide tout le `transform`, et que l'élément ne
  bouge plus du tout.

**Pourquoi ce doublage n'est pas confié à Lightning CSS.** Il sait le faire, mais
**refuse dès que la valeur contient `var()`** : il ne peut pas savoir en combien
de composantes elle se développera. Or c'est exactement la forme que Tailwind
émet pour son barème d'espacement, `calc(var(--spacing) * 5)` — c'est-à-dire
tous les `px-*` et `py-*`. Une valeur à deux composantes, elle, dépend
réellement du sens d'écriture : le greffon la laisse intacte plutôt que
d'inverser un rembourrage en arabe.

**`color-mix()` n'a rien demandé**, contrairement à ce qu'on croyait en ouvrant
le sujet. Tailwind accompagne chaque modificateur d'opacité d'un repli en hex à
huit chiffres — `.bg-white/10` porte déjà `#ffffff1a` hors du bloc `@supports`.
Trente-cinq des trente-six déclarations concernées sont couvertes ; la
trente-sixième mixe `currentcolor` sur `::placeholder`, qui reste un ton trop
clair sur ces moteurs. Ce n'est pas ce qui produisait les bandes noires de la
visionneuse : c'était le fond de la visionneuse elle-même, découvert par une
image que l'absence de rembourrage ne plaçait plus.

**`@layer` reste un coup de chance, et il faut le savoir.** Cette règle n'existe
pas avant Chromium 99, et Tailwind v4 enferme toute sa sortie dedans : l'app
devrait être entièrement sans style sur ce téléviseur. Elle ne l'est pas, parce
que ce parseur avale l'at-rule inconnue et applique quand même les règles
internes. Rien ici ne repose sur ce comportement — on ne peut pas l'obtenir — et
aucun abaissement ne peut le remplacer, les couches n'étant pas simulables. C'est
la limite réelle du support : un moteur d'avant Chromium 99 qui suivrait la
spécification à la lettre n'afficherait rien du tout.

**Conséquences.**

- La cible JS descend à `chrome79` elle aussi : sans quoi esbuild laisse passer
  `?.` et `??`, absents avant Chromium 80, et la page reste blanche au lieu de
  mal s'afficher. Coût mesuré : 1,6 ko sur 450.
- `Array.prototype.at` (Chromium 92) est remplacé par un indice explicite dans
  `components/admin/CommentsSection.tsx`. Une API manquante jette, là où une
  propriété CSS manquante se contente de ne rien faire.
- La CSS passe de 47,6 à 51,2 ko, 8,80 à 9,35 ko une fois compressée.
- Le greffon **ne tourne qu'à la construction**. Sous `pnpm dev`, un vieux
  navigateur voit encore la feuille non abaissée : sans conséquence en
  production, où le serveur ne sert que `dist`, mais à savoir avant de conclure
  qu'un correctif n'a pas pris.
- Le greffon vérifie son propre travail et fait échouer la construction s'il
  reste un `oklch()` ou un raccourci logique sans repli. Une montée de version de
  Tailwind qui changerait la forme de sa sortie s'arrêterait là plutôt que sur
  l'écran de quelqu'un.
