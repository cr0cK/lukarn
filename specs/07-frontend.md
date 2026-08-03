# 07 — Frontend

React 19, Vite 6, Tailwind 4, TanStack Query 5, React Router 7. Aucun état
global maison : ce qui vient du serveur vit dans TanStack Query, ce qui décrit la
vue vit dans l'URL, le reste est du `useState` local.

## Routage

`App.tsx`, quatre routes plus un fourre-tout.

| Chemin            | Page         | Garde                              |
| ----------------- | ------------ | ---------------------------------- |
| `/login`          | `LoginPage`  | aucune (redirige si déjà connecté) |
| `/`               | `AlbumsPage` | `RequireAuth`                      |
| `/album/:albumId` | `AlbumPage`  | `RequireAuth`                      |
| `/admin`          | `AdminPage`  | `RequireAuth admin`                |
| `*`               | —            | `Navigate to="/"`                  |

`RequireAuth` s'appuie sur `useMe()`. **Ce n'est pas un contrôle de sécurité** :
le serveur refuse déjà toute route protégée. Il évite d'afficher une page vide en
attendant le 401, et mémorise la destination dans `location.state.from` pour y
revenir après la connexion.

Le serveur rend `index.html` sur toute URL non-`/api` et non-`/assets`, donc un
rechargement direct sur `/album/vacances` fonctionne (voir [05](./05-api.md)).

### Deux paramètres de requête portent l'état de la vue

Sur `/album/:albumId` :

- `?photo=<mediaId>` — la visionneuse est ouverte sur ce média. Le bouton Retour
  la referme, et un lien partagé rouvre la même vue.
- `?order=asc` — sens chronologique. Le défaut `desc` n'est **pas** écrit dans
  l'URL, qui reste courte et revient à son adresse d'origine quand on rebascule.
  Une valeur inconnue est ramenée au défaut côté front (`isSortOrder`), pour ne
  pas laisser une URL bricolée à la main provoquer un 400.

Les deux sont indépendants : `setParam` repart toujours des paramètres courants,
sinon ouvrir une photo effacerait le tri et le refermer le rétablirait tout seul.
Ouvrir une photo pousse une entrée d'historique ; naviguer d'une photo à l'autre
aux flèches utilise `replace`, sinon parcourir 50 photos empilerait 50 entrées et
le bouton Retour ne ramènerait plus à la grille.

## Gestion d'état — `api/hooks.ts`

Réglages par défaut du `QueryClient` (`main.tsx`) : `refetchOnWindowFocus: false`
— les albums ne changent qu'au rythme des synchronisations —, `staleTime` de
60 s, `retry: 1`.

| Hook             | Clé                       | Particularité                                                                                                                                                                        |
| ---------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `useMe`          | `['me']`                  | `staleTime` 5 min. Ne **réessaie pas** sur 401 : c'est la réponse normale d'un visiteur non connecté, pas un incident.                                                               |
| `useLogin`       | —                         | Écrit `me` dans le cache et invalide `albums`.                                                                                                                                       |
| `useLogout`      | —                         | `queryClient.clear()` : le cache contient les albums et médias de l'ancienne session.                                                                                                |
| `useAlbums`      | `['albums']`              |                                                                                                                                                                                      |
| `useAlbum`       | `['album', id]`           |                                                                                                                                                                                      |
| `useAlbumItems`  | `['items', id, order]`    | `useInfiniteQuery`, curseur serveur. **`order` fait partie de la clé** : sans lui, TanStack resservirait les pages chargées dans l'autre sens et continuerait de paginer à l'envers. |
| `useMediaDetail` | `['detail', albumId, id]` | `staleTime: Infinity`, activée seulement quand le panneau EXIF est ouvert.                                                                                                           |
| `useAdminStatus` | `['admin','status']`      | `refetchInterval` de 2 s tant qu'un album est `running`, sinon aucun sondage.                                                                                                        |
| `useAdminUsers`  | `['admin','users']`       | Liste d'administration des comptes.                                                                                                                                                  |
| `useAdminAlbums` | `['admin','albums']`      | Même sondage conditionnel que `useAdminStatus` : la page d'administration lit les albums ici, pas dans le statut.                                                                    |
| `useSettings`    | `['admin','settings']`    |                                                                                                                                                                                      |

Une mutation par opération d'administration — `useCreateUser`, `useUpdateUser`,
`useDeleteUser`, `useCreateAlbum`, `useUpdateAlbum`, `useDeleteAlbum`,
`useResync`, `useUpdateSettings` — chacune invalidant ce qu'elle périme. Deux
règles d'invalidation valent d'être notées : **écrire un compte périme aussi la
liste des albums**, parce que `AdminAlbum.members` décrit la même attribution
vue de l'autre côté ; et **écrire un album périme `['albums']`**, la liste que
la session courante consulte. Supprimer un album retire en plus ses médias du
cache client (`['album', id]`, `['items', id]`), qui viennent de disparaître de
l'index.

`api/client.ts` est la seule couche réseau : `credentials: 'same-origin'`, et une
classe `ApiError` qui porte le statut HTTP pour distinguer un 401 d'une vraie
panne. `mediaUrl` construit les URL de vignette, de rendu plein écran, d'original
et de téléchargement.

## Layout justifié — `lib/justify.ts`

`computeLayout(items, options)` produit des lignes de hauteur variable dont les
images gardent leur proportion et remplissent exactement la largeur — la
disposition de Google Photos.

Principe : les médias arrivent triés, on les découpe en mois consécutifs
(`monthKey` = les 7 premiers caractères de l'ISO, donc en UTC), puis on remplit
ligne par ligne. Une ligne est bouclée dès que la hauteur nécessaire pour la
remplir passe sous `targetRowHeight`. La hauteur exacte vaut
`(largeur − gaps) / somme des ratios`.

Détails qui ont une raison :

- **La dernière ligne d'un mois n'est pas justifiée.** L'étirer donnerait des
  vignettes démesurées pour deux photos ; elle reste à `targetRowHeight`.
- **Le dernier élément d'une ligne justifiée absorbe l'arrondi cumulé**
  (`containerWidth - x`), pour que la ligne finisse pile au bord droit sans
  liseré d'un pixel.
- **Les ratios sont bornés** entre 0,4 et 3,5. Un panorama 20:1 écraserait toute
  sa ligne. Un média sans dimensions retombe sur 4/3.
- **`targetRowHeightFor(width)`** échelonne de 110 px sous 480 px de large à
  225 px au-delà de 1920 : sur mobile, des lignes hautes donneraient une photo
  par ligne.

`packages/web/test/justify.test.ts` verrouille : chaque média placé une fois et
une seule, les lignes justifiées finissant exactement au bord, la dernière ligne
non étirée, l'empilement des sections sans chevauchement.

### La règle qui explique tout le reste

**Les dimensions viennent de l'index, donc la mise en page est calculée avant
tout chargement d'image.** La grille connaît la position et la taille de chaque
vignette avant qu'un seul octet d'image n'arrive. Conséquences :

- aucun décalage de mise en page pendant le chargement — chaque `<img>` a déjà sa
  case réservée et se contente de la remplir (`object-cover`) ;
- la barre de défilement a la bonne longueur dès le premier rendu ;
- la virtualisation est possible, puisqu'on sait ce qui tombe dans le viewport
  sans avoir rien mesuré.

C'est aussi pourquoi `drive/sync.ts` corrige les dimensions selon la rotation
EXIF avant de les écrire : une photo portrait stockée en paysage donnerait une
case mal proportionnée que l'image ne remplirait pas.

## Virtualisation — `lib/useGridLayout.ts` et `components/JustifiedGrid.tsx`

`useGridLayout(items)` mesure le conteneur (`ResizeObserver` + `resize`), suit le
défilement (`scroll` passif) et mémoïse `computeLayout` sur `[items, width]`. Il
expose une fenêtre `[visibleFrom, visibleTo]` élargie de `OVERSCAN_PX = 900` de
chaque côté, pour qu'un défilement rapide reste plein.

Le `ref` est une **callback ref** et non un `useRef` : le conteneur n'est monté
qu'une fois les médias chargés, donc un effet à dépendances vides s'exécuterait
alors que `ref.current` vaut encore `null` et n'observerait jamais rien.

`JustifiedGrid` rend un conteneur de hauteur `layout.totalHeight`, puis
positionne en absolu **uniquement** les sections et lignes qui croisent la
fenêtre. Un album de 10 000 photos tient ainsi dans quelques dizaines de nœuds
DOM. Le chargement de la page suivante se déclenche quand `visibleTo + 1500 px`
dépasse la hauteur totale.

`Thumb` choisit la variante par `pickThumbSize(displayWidth)` : la plus petite
des tailles 320/640/1280 qui couvre la largeur d'affichage multipliée par le DPR
(plafonné à 2). Demander systématiquement du 1280 saturerait la bande passante
sur une grille de 200 vignettes. Les vignettes du premier écran sont en
`loading="eager"`, le reste en `lazy`. Les vidéos n'ont pas de rendu serveur : une
tuile sobre avec l'icône de lecture et la durée.

## Navigation clavier

Deux gestionnaires distincts, jamais actifs ensemble : celui de la grille se
désactive quand la visionneuse ou l'aide sont ouvertes.

| Contexte    | Touche          | Effet                                                                 |
| ----------- | --------------- | --------------------------------------------------------------------- |
| Grille      | `← ↑ ↓ →`       | `moveSelection` sur le layout réel                                    |
| Grille      | `Début` / `Fin` | Premier / dernier média                                               |
| Grille      | `Entrée`        | Ouvrir la visionneuse                                                 |
| Grille      | `Échap`         | Revenir à la liste des albums                                         |
| Visionneuse | `← →`           | Média précédent / suivant                                             |
| Visionneuse | `Début` / `Fin` | Premier / dernier                                                     |
| Visionneuse | `Échap`         | Défait une couche à la fois : zoom, puis panneau EXIF, puis fermeture |
| Visionneuse | `I` `F` `D`     | Infos · plein écran · télécharger l'original                          |
| Visionneuse | `Z`             | Zoom à 100 % (un pixel du rendu disponible = un pixel d'écran)        |
| Visionneuse | `Espace`        | Lecture / pause vidéo (sinon la page défilerait)                      |
| Partout     | `?`             | Aide-mémoire des raccourcis                                           |

À la souris dans la visionneuse : molette pour un zoom progressif centré sur le
curseur, clic pour basculer au niveau natif à l'endroit visé, glisser pour se
déplacer dans l'image agrandie.

`moveSelection` (`useGridLayout.ts`) est le point délicat : les déplacements
verticaux suivent les **lignes réelles** du layout, dont le nombre de vignettes
varie, et visent la photo dont le centre horizontal est le plus proche. Un
décalage d'index fixe ferait dériver le curseur vers la gauche à chaque ligne.

`scrollSelectionIntoView` ne défile que si la cellule sort du viewport, avec une
marge de 24 px, et respecte `prefers-reduced-motion`.

Les vignettes sont `tabIndex={-1}` : la navigation se fait aux flèches, les
inclure dans l'ordre de tabulation doublerait le parcours clavier.
`useShortcut` ignore les raccourcis à une touche quand un champ de saisie a le
focus ou qu'un modificateur est enfoncé.

## Visionneuse — `components/Lightbox.tsx`

- Gèle `document.body.style.overflow` à l'ouverture, sinon la molette ferait
  défiler la grille sous l'image.
- Prend le focus à l'ouverture et le **rend à l'élément précédent** à la
  fermeture.
- Vidéos : `<video controls autoPlay playsInline>` sur `/original`, seek natif
  par `Range`. Photos : `ZoomableImage`, remonté à chaque photo (`key={item.id}`)
  pour réinitialiser zoom et cadrage sans les remettre à zéro à la main.
- Le téléchargement passe par une ancre synthétique plutôt que `window.open` :
  pas de blocage de popup, et le navigateur gère sa barre de téléchargement.
- `ExifPanel` n'est monté qu'à l'ouverture du panneau, et la position EXIF est
  liée vers OpenStreetMap.
- Les flèches de navigation sont masquées pendant le zoom : le glisser sert alors
  à se déplacer dans l'image, et elles tomberaient sous le curseur.
- **`goTo` ignore l'index déjà affiché.** `Début` sur le premier média, `Fin` sur
  le dernier, une flèche à une extrémité : la cible est l'index courant, aucun
  élément n'est remonté, donc aucun `loadeddata` n'est émis. Remettre `loaded` à
  `false` dans ce cas laisserait le tourniquet de chargement d'une vidéo tourner
  indéfiniment.

### Préchargement asymétrique

`PRELOAD_AHEAD = 4`, `PRELOAD_BEHIND = 1`, orientés par le sens du dernier
déplacement : quelqu'un qui avance continue presque toujours d'avancer, donc à
nombre de requêtes égal, pousser plus loin devant rend le parcours nettement plus
fluide. Les requêtes partent **des plus proches aux plus lointaines**, pour que
la photo immédiatement suivante ne soit pas mise en file derrière des voisines
inutiles. Le nettoyage de l'effet remet `image.src = ''` : une navigation rapide
abandonne les téléchargements devenus inutiles et libère les connexions.

Le total reste modeste parce que chaque rendu absent du cache serveur coûte le
téléchargement de l'original depuis Drive.

### Zoom — `components/ZoomableImage.tsx`

Le zoom sert à **examiner** une photo, pas à grossir ce qui est déjà affiché : un
`scale()` sur le rendu `full` (2560 px) ne ferait qu'étirer des pixels déjà
rasterisés. Au premier agrandissement, le composant charge la variante `hd`
(4096 px) hors écran et ne bascule qu'une fois l'image prête — puis la garde,
parce que rebasculer sur `full` en revenant au cadre ferait clignoter l'image à
chaque aller-retour.

Deux échelles à ne pas confondre : l'**échelle 1** est l'image ajustée au cadre ;
l'**échelle 100 %** (`pixelScale`) est celle où un pixel **du rendu disponible**
occupe un pixel d'écran. C'est la cible de `Z` et du clic, le premier cran utile
et souvent le seul voulu. Plafond `MAX_SCALE = 8` : au-delà, on n'observe plus
que le grain du capteur.

#### « 100 % », c'est la résolution servie, pas celle du fichier

Le serveur plafonne le plus grand côté du rendu `hd` à 4096 px
(`HD_MAX_EDGE`, `media/renderer.ts`). Une photo de 6000 px n'est donc jamais
servie en 6000 px, et caler le 100 % sur les dimensions de l'index — ce que
faisait `nativeScale` — annonçait des pixels natifs tout en en interpolant un
sur trois. **100 % signifie désormais « un pixel du rendu par pixel d'écran »**,
c'est-à-dire la limite au-delà de laquelle le navigateur invente.

Le calcul vit dans `lib/zoom.ts` (`computeZoomScale`, `zoomPercent`), en
fonctions pures testées par `test/zoom.test.ts` : une échelle fausse de 40 %
ressemble à une image un peu molle, pas à un bug, et ne se voit pas à l'œil.

- La **mesure fait autorité** : `naturalWidth` de l'`<img>` donne la largeur du
  rendu réellement chargé, relevée à l'`onLoad` du rendu visible et à celui du
  préchargement `hd` hors écran.
- Avant ce chargement, la résolution `hd` est **anticipée** par une constante
  `HD_MAX_EDGE` en miroir du serveur, appliquée au plus grand côté (un portrait
  4000 × 6000 donne 2731 px de large, pas 4000). Sans cette anticipation, `Z`
  ne pourrait viser que la résolution du rendu `full` déjà chargé. Une
  divergence avec le serveur se corrige d'elle-même dès que `hd` est mesuré.
- Le **pourcentage se calcule depuis `availableWidth`**, pas depuis
  `pixelScale`, qui est plafonné par `MAX_SCALE` : sur une photo qui demanderait
  plus que ce plafond, le rapporter à `pixelScale` afficherait 100 % là où le
  zoom maximal ne montre encore qu'une partie des pixels.
- Quand le rendu disponible est plus petit que le fichier, l'indicateur le dit
  (`100 % · rendu 4096 px sur 6000 px`) : c'est l'information que masquait
  l'ancien affichage.
- Si l'index ne connaît pas les dimensions, elles sont reprises du rendu reçu à
  son `onLoad` : le zoom part de la résolution mesurée, plus limité mais présent,
  et remonte quand `hd` est chargé.

Trois détails qui ont une raison :

- **`clampOffset`** borne le déplacement pour que le cadre ne déborde jamais de
  l'image.
- **Le zoom est centré sur le point visé** (molette ou clic) : le pixel sous le
  curseur ne doit pas se dérober pendant l'agrandissement.
- **`scaleRef`** permet à l'effet qui écoute `zoomed` de lire l'échelle courante
  sans en dépendre — sinon chaque cran de molette relancerait l'effet, qui
  ramènerait aussitôt l'image au niveau natif.

Deux repères visuels : un **placeholder** (la vignette 320, déjà en cache
navigateur puisqu'elle vient d'être affichée dans la grille) flouté à la taille
exacte du rendu final, le temps que celui-ci arrive ; et un **repère de
position** pendant le zoom, avec le cadre de la zone visible — sans lui on perd
tout sens de l'orientation dès qu'on se déplace dans une image agrandie.
L'indicateur signale en plus `chargement HD…` tant que la variante `hd` n'est
pas prête : le pourcentage repose alors sur la résolution anticipée, pas sur une
mesure.

Le repère est **manipulable** : y cliquer ou y glisser amène le point visé au
centre de la fenêtre. Il montrait où l'on se trouvait sans permettre d'y agir,
ce qui invite au geste puis le refuse. Les conversions vivent dans
`lib/zoom.ts` — `viewCenter` pour l'afficher, `offsetForCenter` pour le
commander — et leur réciprocité est testée : ce que le repère montre et ce
qu'il commande doivent désigner la même chose, faute de quoi le cadre sauterait
sous le curseur. Le `pointerdown` interrompt sa propagation, sans quoi le
conteneur démarrerait en plus son propre déplacement et l'image partirait dans
le sens du glissement pendant que le repère la ramène ailleurs.

## Administration — `pages/AdminPage.tsx` et `components/admin/`

Les comptes, les albums et les réglages s'administrent depuis `/admin` :
`config/albums.yaml` ne sert plus qu'à amorcer une installation neuve. Le bouton
« Recharger albums.yaml » a donc disparu avec la route `POST /api/admin/reload`.

`AdminPage` ne fait qu'assembler cinq sections — Connexion Google Drive,
Utilisateurs, Albums, Réglages, Maintenance — et porter le bandeau de message,
collé sous la barre supérieure : la page est longue, un message affiché tout en
haut passerait inaperçu depuis le bas. Chaque section vit dans
`components/admin/` avec ses propres mutations ; `ui.tsx` réunit les primitives
(bouton, champ, case à cocher, encadré de section) pour que les formulaires ne
réinventent ni les classes ni le lien `label` / `aria-describedby`.

### L'attribution des albums est un choix entre deux régimes

`AlbumAccessPicker` propose deux options exclusives : **tous les albums** — le
joker `ALL_ALBUMS`, qui suivra les albums créés plus tard — ou **une sélection**
d'identifiants. Cocher les douze albums existants n'est jamais une manière
d'exprimer « tous les albums », et la différence n'apparaît qu'au treizième :
c'est pourquoi le joker n'est pas rendu comme une case « tout cocher », et
qu'une sélection devenue exhaustive affiche un avertissement. La sélection
explicite est mémorisée pendant un aller-retour vers le joker, sinon revenir en
arrière obligerait à tout recocher. Un album supprimé qui subsiste dans la liste
d'un compte reste affiché, sans quoi il serait impossible de l'en retirer.

`formatAlbumAccess` (`lib/adminForm.ts`) résume l'attribution dans la liste des
comptes en nommant le joker comme tel, jamais en énumérant les albums qu'il
couvre aujourd'hui.

### Ce que le formulaire corrige avant d'appeler le serveur

`lib/adminForm.ts` ne contient que des fonctions pures, testées dans
`test/admin-form.test.ts` — le paquet de tests tourne sans DOM. Elles ne
remplacent pas la validation du serveur, qui reste seul juge ; elles évitent un
aller-retour pour dire ce qui cloche, en appliquant les mêmes constantes
partagées (`USERNAME_PATTERN`, `ALBUM_ID_PATTERN`, `PASSWORD_MIN_LENGTH`,
`USERNAME_MAX_LENGTH`).

- **`extractFolderId`** accepte l'URL complète d'un dossier Drive, un lien de
  partage, un vieux lien `open?id=` ou l'identifiant nu. La valeur est
  normalisée à la sortie du champ, pour que ce qui reste affiché soit exactement
  ce qui partira. Un chemin lisible (« Mon Drive/Photos ») est refusé : Drive
  n'expose que l'identifiant opaque, et le serveur répondrait par une erreur bien
  moins parlante.
- **`slugifyAlbumId`** propose un identifiant d'après le titre tant que le champ
  n'a pas été touché — cet identifiant se retrouve dans l'URL de l'album.
- Les formulaires de modification n'envoient **que les champs modifiés** : un
  champ absent laisse la valeur en place, donc réémettre tout le formulaire
  écraserait une modification faite ailleurs entre-temps. Un mot de passe vide
  signifie « ne pas changer ».

### Suppressions

`ConfirmDialog` remplace `window.confirm` : le texte cite l'objet concerné et
décrit la conséquence, y compris ce qui n'est **pas** touché — supprimer un album
retire ses médias de l'index mais ne supprime rien dans Google Drive. Le bouton
dangereux ne prend pas le focus à l'ouverture, un `Entrée` réflexe suffirait à
supprimer ; c'est le panneau qui le reçoit, et le focus revient à l'élément
déclencheur à la fermeture.

Deux garde-fous évitent de se verrouiller dehors : on ne supprime pas son propre
compte, et on ne retire pas son propre rôle administrateur. Le serveur reste
libre de les refuser aussi — ces règles ne sont ici que pour ne pas proposer un
geste qui se retourne contre l'utilisateur.

## Dates : tout en UTC

`lib/format.ts` construit tous ses `Intl.DateTimeFormat` avec
`timeZone: 'UTC'`, et `monthLabel` fait de même.

La raison : `taken_at` est l'heure qu'affichait l'appareil au déclenchement,
lue d'un EXIF sans fuseau et interprétée en UTC par `parseExifTime`. Réafficher
cette valeur dans le fuseau du navigateur décalerait la photo — une photo prise à
14 h s'afficherait à 16 h pour un navigateur en Europe/Paris, et le regroupement
par mois basculerait pour les prises de vue de fin de mois. **Toute nouvelle
date affichée doit passer par `lib/format.ts`.**

## Thème sombre — `styles.css`

Tailwind 4 sans fichier de configuration : les tokens sont déclarés dans un bloc
`@theme` et deviennent des utilitaires (`--color-ink-850` → `bg-ink-850`).

L'échelle `ink-950 → ink-100` est neutre, légèrement froide, et **volontairement
peu contrastée entre les niveaux de fond** : ce qui doit ressortir, ce sont les
photos, pas le chrome. Deux accents seulement, `--color-accent` et
`--color-accent-dim`.

Il n'y a **pas** de thème clair ni de bascule : `index.html` porte
`class="dark"` et `<meta name="color-scheme" content="dark">` en dur. Ajouter un
thème clair suppose de doubler l'échelle `ink-*`, pas d'inverser une variable.

Le reste de `styles.css` : hauteur pleine sur `html/body/#root`, barres de
défilement discrètes, anneau de focus `:focus-visible` uniquement (l'app se
pilote aux flèches, la cible active doit rester repérable), et deux animations —
`fade-in` des vignettes décodées, `lightbox-enter` — toutes deux neutralisées
sous `prefers-reduced-motion: reduce`.

## Build

`vite.config.ts` : sourcemaps activées, et un chunk `vendor` séparé
(`react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`) qui change
rarement et reste en cache navigateur d'un déploiement à l'autre.

En développement, Vite sert le front sur `:5173` et proxie `/api` vers
`:8080` **sans** `changeOrigin` : les cookies de session et le callback OAuth
restent sur une seule origine.
