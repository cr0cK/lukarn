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
| `/admin`          | —            | `Navigate to="/admin/albums"`      |
| `/admin/:tab`     | `AdminPage`  | `RequireAuth admin`                |
| `*`               | —            | `Navigate to="/"`                  |

`RequireAuth` s'appuie sur `useMe()`. **Ce n'est pas un contrôle de sécurité** :
le serveur refuse déjà toute route protégée. Il évite d'afficher une page vide en
attendant le 401, et mémorise la destination dans `location.state.from` pour y
revenir après la connexion.

Le serveur rend `index.html` sur toute URL non-`/api` et non-`/assets`, donc un
rechargement direct sur `/album/vacances` fonctionne (voir [05](./05-api.md)).

### Trois paramètres de requête portent l'état de la vue

Sur `/album/:albumId` :

- `?photo=<mediaId>` — la visionneuse est ouverte sur ce média. Le bouton Retour
  la referme, et un lien partagé rouvre la même vue.
- `?order=asc` — sens chronologique. Le défaut `desc` n'est **pas** écrit dans
  l'URL, qui reste courte et revient à son adresse d'origine quand on rebascule.
  Une valeur inconnue est ramenée au défaut côté front (`isSortOrder`), pour ne
  pas laisser une URL bricolée à la main provoquer un 400.
- `?group=day` — découpage de la grille en sections. Même règle, à un défaut
  près : **c'est l'album qui le porte** (`Album.groupBy`), pas une constante.
  Le paramètre n'est écrit que s'il contredit cette préférence, sinon revenir
  dessus rendrait à l'album une adresse traînant un `?group=` qui ne dit rien de
  plus. Une valeur inconnue est ramenée à la préférence de l'album
  (`isGroupBy`). Contrairement à `order`, ce paramètre **ne part jamais au
  serveur** et n'entre pas dans la clé TanStack Query de la liste : celle-ci est
  la même, seule la mise en page la segmente autrement, donc rebasculer ne
  recharge aucune photo.

  **Piège** : `album` et `items` sont deux requêtes distinctes, et `groupBy`
  bascule sur la préférence de l'album quand la première arrive. L'effet qui
  remet la sélection à zéro et remonte la page attend donc qu'`album.isPending`
  soit retombé — sans cette garde, ouvrir un album réglé sur « jour » ferait
  sauter la page une seconde fois, après coup, sous le curseur de quelqu'un qui
  avait déjà commencé à défiler.

Les trois sont indépendants : `setParam` repart toujours des paramètres courants,
sinon ouvrir une photo effacerait le tri et le refermer le rétablirait tout seul.
Ouvrir une photo pousse une entrée d'historique ; naviguer d'une photo à l'autre
aux flèches utilise `replace`, sinon parcourir 50 photos empilerait 50 entrées et
le bouton Retour ne ramènerait plus à la grille.

`order` et `group` se pilotent depuis deux bascules de la `TopBar` (`children`),
bâties sur le même patron : **le libellé annonce l'état courant** (« Par mois »),
**l'infobulle annonce ce que le clic fera** (« Regrouper par jour »), et
l'`aria-label` réunit les deux — le libellé disparaît sous `sm` faute de place,
le nom accessible doit rester complet. Changer l'un ou l'autre remet la sélection
clavier à `-1` et remonte la page : inverser le tri renumérote l'album, changer
le regroupement recalcule toutes les hauteurs, et dans les deux cas la position
conservée désignerait autre chose.

## Gestion d'état — `api/hooks.ts`

Réglages par défaut du `QueryClient` (`main.tsx`) : `refetchOnWindowFocus: false`
— les albums ne changent qu'au rythme des synchronisations —, `staleTime` de
60 s, `retry: 1`.

| Hook             | Clé                       | Particularité                                                                                                                                                                                                                                                                       |
| ---------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useMe`          | `['me']`                  | `staleTime` 5 min. Ne **réessaie pas** sur 401 : c'est la réponse normale d'un visiteur non connecté, pas un incident.                                                                                                                                                              |
| `useLogin`       | —                         | Écrit `me` dans le cache et invalide `albums`.                                                                                                                                                                                                                                      |
| `useLogout`      | —                         | `queryClient.clear()` : le cache contient les albums et médias de l'ancienne session.                                                                                                                                                                                               |
| `useAlbums`      | `['albums']`              |                                                                                                                                                                                                                                                                                     |
| `useAlbum`       | `['album', id]`           |                                                                                                                                                                                                                                                                                     |
| `useAlbumItems`  | `['items', id, order]`    | `useInfiniteQuery`, curseur serveur. **`order` fait partie de la clé** : sans lui, TanStack resservirait les pages chargées dans l'autre sens et continuerait de paginer à l'envers.                                                                                                |
| `useAlbumDays`   | `['days', id]`            | Activée **seulement en découpage par jour** : par mois, les notes sont masquées et la requête ne servirait à rien. Pas d'`order` dans la clé — les journées sont les mêmes dans les deux sens. Rend aussi une `Map` mémoïsée par clé de jour, dont dépend la mémoïsation du layout. |
| `useMediaDetail` | `['detail', albumId, id]` | `staleTime: Infinity`, activée dès qu'un onglet du panneau latéral est ouvert — pas seulement « Infos » : `MediaDetail.commentCount` alimente la pastille de l'onglet « Commentaires ».                                                                                             |
| `useAdminStatus` | `['admin','status']`      | `refetchInterval` de 2 s tant qu'un album est `running`, sinon aucun sondage.                                                                                                                                                                                                       |
| `useAdminUsers`  | `['admin','users']`       | Liste d'administration des comptes.                                                                                                                                                                                                                                                 |
| `useAdminAlbums` | `['admin','albums']`      | Même sondage conditionnel que `useAdminStatus` : la page d'administration lit les albums ici, pas dans le statut.                                                                                                                                                                   |
| `useSettings`    | `['admin','settings']`    |                                                                                                                                                                                                                                                                                     |

Une mutation par opération d'administration — `useCreateUser`, `useUpdateUser`,
`useDeleteUser`, `useCreateAlbum`, `useUpdateAlbum`, `useDeleteAlbum`,
`useResync`, `useUpdateSettings` — chacune invalidant ce qu'elle périme.
`useUpdateAlbumDay` fait exception : elle **écrit la réponse dans le cache** au
lieu d'invalider. La hauteur de l'en-tête dépend de la note, donc une
invalidation ferait sauter la grille une seconde fois, le temps d'un aller-retour
réseau de plus. Elle rejoue au passage la règle du serveur — une journée vidée
de sa note et de son lieu ne reste dans la liste que si l'EXIF lui donne un lieu. Deux
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

Principe : les médias arrivent triés, on les découpe en sections consécutives
(`sectionKeyOf`, voir plus bas), puis on remplit ligne par ligne. Une ligne est
bouclée dès que la hauteur nécessaire pour la remplir passe sous
`targetRowHeight`. La hauteur exacte vaut `(largeur − gaps) / somme des ratios`.

Détails qui ont une raison :

- **La dernière ligne d'une section n'est pas justifiée.** L'étirer donnerait des
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
non étirée, l'empilement des sections sans chevauchement — par mois comme par
jour.

### Une hauteur d'en-tête par section

`LayoutOptions.headerHeightFor?: (key) => number` donne à une section l'en-tête
dont elle a besoin ; omise, ou rendant zéro, c'est `headerHeight` qui
s'applique. Chaque `LayoutSection` porte la sienne, pour que le composant y
dimensionne sa boîte.

**La hauteur est une donnée d'entrée du calcul, jamais une mesure**, et c'est le
seul point délicat de toute la fonctionnalité. Toute la grille est positionnée
avant qu'un nœud DOM n'existe — c'est ce qui rend possibles la virtualisation et
l'absence de décalage. Un en-tête qui déciderait de sa taille une fois monté
passerait sous ses propres photos, et il n'y aurait rien pour le rattraper.

`useGridLayout(items, groupBy, days)` construit la fonction :
`GRID_HEADER_HEIGHT + (lieu ? 20 : 0) + (note ? 40 : 0)`. Elle rend `undefined`
en découpage par mois — une note appartient à une journée, et il n'y aurait pas
d'en-tête à qui l'accrocher parmi les trente. Le layout reste pur et testable
sans DOM, ce qui est l'invariant de `justify.test.ts`.

Ces deux constantes sont un **contrat avec `SectionHeader`**, qui doit tenir
dedans : d'où les hauteurs de ligne fixées explicitement (`leading-5`) et la
note clampée à deux lignes. C'est l'**interligne** qui tient le contrat, jamais
la taille de police : remonter le lieu et la note de 13 à 14 px ne touche à
aucune des deux constantes tant que `leading-5` reste.

### Sections repliées

`LayoutOptions.isCollapsed?: (key) => boolean` replie une section : elle garde
son en-tête, ne place aucune ligne, et sa hauteur vaut exactement
`headerHeight` — le retrait du dernier `gap`, qui n'a de sens qu'après une
ligne, est sauté. Les sections suivantes remontent d'autant.

Le repli passe par le calcul et non par un `display: none` au rendu, pour la
même raison que les hauteurs d'en-tête : `totalHeight` gouverne la barre de
défilement et la virtualisation. Masquer les vignettes après coup laisserait la
page haute de tout ce qu'elle n'affiche plus (D65).

`LayoutSection` porte donc deux champs de plus :

- **`count`**, le nombre de médias de la section. Il n'est pas déductible de
  `rows` — repliée, la section n'en a plus, et c'est justement là que son
  en-tête doit annoncer ce qu'elle cache.
- **`collapsed`**, pour que l'en-tête oriente son chevron.

Les cellules d'une section repliée **n'apparaissent nulle part**, ni dans ses
`rows` ni dans `layout.rows`. C'est l'invariant dont dépend tout ce qui parcourt
la grille : la virtualisation n'a rien à monter, et `moveSelection` rien à
viser. `justify.test.ts` le verrouille, avec la remontée des sections suivantes
et la conservation de `count`.

Le repli vaut pour les deux découpages, mois compris : le restreindre au jour
aurait demandé une condition de plus pour rien, et les clés ne se confondent
pas (`2026-07` contre `2026-07-14`). `useGridLayout(items, groupBy, days,
collapsedKeys)` le reçoit sous forme d'ensemble de clés, tenu en mémoire par
`AlbumPage` — ni URL ni `localStorage` (D65).

**Une section repliée change aussi de hauteur de base**
(`GRID_COLLAPSED_HEADER_HEIGHT`, 36 px contre 56). Les 20 px que
`GRID_HEADER_HEIGHT` réserve au-dessus du titre servent à le décoller des
photos de la section précédente ; repliée, il n'y a plus de photos, et cette
respiration devient un vide. Sans cet ajustement, sept journées repliées
d'affilée s'étiraient sur des blancs — exactement ce que le repli venait
supprimer. Le lieu et la note gardent leur coût, eux, puisqu'ils restent
affichés : c'est tout l'intérêt d'une journée repliée.

### Par mois ou par jour — `GroupBy`

`LayoutOptions.groupBy` choisit le découpage ; omis, c'est `DEFAULT_GROUP_BY`,
donc le mois. Le type vient de `@gdv/shared` bien qu'aucune route ne le
transporte : c'est une valeur d'interface, pas de payload, et la dupliquer côté
front pour la seule raison qu'elle ne traverse pas le réseau ferait deux
sources pour un même vocabulaire.

| `groupBy` | Clé (`sectionKeyOf`)    | En-tête (`sectionLabelOf`)                        |
| --------- | ----------------------- | ------------------------------------------------- |
| `month`   | `monthKey` → `2026-07`  | `monthLabel` → « Juillet 2026 »                   |
| `day`     | `dayKey` → `2026-07-14` | `dayLabel` → « 14 juillet 2026 », « Aujourd'hui » |

Pas de regroupement par année : sur un album de vacances il ne produirait qu'une
seule section, c'est-à-dire aucun repère.

Ce qui a une raison :

- **Les deux clés sont des tranches de la chaîne ISO**, jamais un `getMonth()`
  ou un `getDate()` : ceux-là lisent le fuseau du navigateur et feraient
  basculer de section une photo de 23 h 30 (voir « Dates : tout en UTC »).
  C'est aussi ce qui rend `dayKey` insensible au sens de tri.
- **Le découpage reste un parcours linéaire**, sans tri ni table de hachage :
  la suite reçue est déjà ordonnée, et regrouper par clé la réordonnerait — le
  tri ascendant afficherait des en-têtes à l'envers.
- **Une clé de jour porte le mois**, donc le 30 mars et le 30 avril ne peuvent
  pas se retrouver dans la même section.
- **`dayLabel` nomme les deux jours les plus récents** « Aujourd'hui » et
  « Hier ». Vingt en-têtes qui ne diffèrent que par le quantième obligent à lire
  chaque chiffre ; au-delà de la veille, un repère relatif (« il y a 5 jours »)
  demanderait un calcul mental de plus que la date. La date complète passe par
  `formatDate` (`lib/format.ts`), donc en UTC.
- **La comparaison à « aujourd'hui » est la seule date en heure locale de tout
  le front** — voir [D31](./08-decisions.md).
- **Par jour, la grille est beaucoup plus haute** : chaque section coûte un
  en-tête (56 px), une marge (28 px) et une dernière ligne non justifiée. Sur un
  album pathologique de 3 000 photos toutes de jours différents, 94 000 px par
  mois deviennent 837 000 px par jour. C'est la conséquence assumée du
  découpage, pas un défaut de calcul.

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

`useGridLayout(items, groupBy, days)` mesure le conteneur (`ResizeObserver` +
`resize`), suit le défilement (`scroll` passif) et mémoïse `computeLayout` sur
`[items, width, groupBy, headerHeightFor]` — cette dernière dépendance étant
dérivée de `days`. Ce n'est pas un détail : c'est elle qui fait recalculer la mise
en page quand une note de journée change de hauteur, l'invariant même que
`useUpdateAlbumDay` protège en écrivant dans le cache plutôt qu'en invalidant. Il
expose une fenêtre `[visibleFrom, visibleTo]`
élargie de `OVERSCAN_PX = 900` de chaque côté, pour qu'un défilement rapide reste
plein.

Le `ref` est une **callback ref** et non un `useRef` : le conteneur n'est monté
qu'une fois les médias chargés, donc un effet à dépendances vides s'exécuterait
alors que `ref.current` vaut encore `null` et n'observerait jamais rien.

`JustifiedGrid` rend un conteneur de hauteur `layout.totalHeight`, puis
positionne en absolu **uniquement** les sections et lignes qui croisent la
fenêtre. Un album de 10 000 photos tient ainsi dans quelques dizaines de nœuds
DOM. Le chargement de la page suivante se déclenche quand `visibleTo + 1500 px`
dépasse la hauteur totale.

**Démonter une vignette n'annule pas sa requête** — et c'est le piège qui a
coûté le plus cher ici. Retirer un `<img>` du DOM laisse le navigateur mener son
téléchargement à terme : une vignette que plus personne ne regarde continue
d'occuper l'une des **six** connexions que HTTP/1.1 accorde à une origine. Une
grille froide en met plusieurs dizaines en file, et tout ce qui part ensuite
passe derrière — y compris le `GET /items` dont dépend l'affichage. Le cas le
plus net est l'inversion du tri, qui relance `/items` derrière les vignettes de
l'ordre précédent, devenues inutiles mais toujours en cours : l'album reste sur
« Chargement des photos » le temps qu'elles se vident. C'est ce qui faisait
passer une première ouverture à froid pour un blocage.

**Une vignette en échec réessaie deux fois** avant de laisser la tuile sobre. Le
serveur distingue le transitoire — délai Drive dépassé, débit limité — par un
**503**, sans en-tête de cache, donc rien n'est mémorisé et la requête suivante
repart réellement (D60). Un `<img>` ne réessaie pas tout seul : sans ce
mécanisme, une saturation passagère laisserait une tuile vide jusqu'au prochain
rechargement de page. Le délai double et **une part aléatoire le disperse** —
trente vignettes échouent ensemble sur une grille froide, et des réessais
synchrones repartiraient saturer les six mêmes connexions. Le réessai remonte
l'`<img>` par sa `key` : l'URL ne change pas, c'est le remontage qui relance la
requête.

`Thumb` efface donc son `src` au démontage (`releaseIfDetached`), seul geste qui
coupe réellement la requête. Le contrôle sur `isConnected` n'est pas une
précaution de style : `StrictMode` rejoue montage et démontage **sans toucher au
DOM**, et sans lui les vignettes du premier écran perdaient leur `src` à
l'instant où elles s'affichaient — React ne le réécrit pas, sa vue du DOM le
croyant inchangé.

Le filtrage des sections est un balayage linéaire de `layout.sections`, refait à
chaque événement de défilement. Le découpage par jour multiplie ce tableau, ce
qui pose la question : mesuré sur le pire cas imaginable — 3 000 photos toutes
de jours différents, donc 3 000 sections —, ce balayage coûte **0,02 ms** par
défilement, contre 0,004 ms pour les 99 sections du même album par mois. Le
budget d'une frame en absorbe cinquante. Une recherche dichotomique sur `y`
n'apporterait rien de mesurable et ferait porter au composant une invariante de
tri qu'il n'a pas aujourd'hui. `computeLayout` lui-même prend 17 ms sur ce pire
cas, mais il est mémoïsé : il ne rejoue qu'au changement de largeur, de liste ou
de regroupement, jamais au défilement.

### En-têtes de section — `components/SectionHeader.tsx`

Chaque section rend un `SectionHeader` : la date, le nombre d'éléments, le lieu
si les photos le portent, la note si quelqu'un en a écrit une, et le crayon
d'édition pour un administrateur en découpage par jour.

- **Le titre est un bouton de repli**, `aria-expanded` à l'appui, précédé d'un
  chevron qui pivote. Le `button` est **dans** le `h2` et non l'inverse : un
  `h2` est du contenu de flux, qu'un `button` n'a pas le droit de contenir, et
  c'est le motif d'accordéon attendu par les lecteurs d'écran.
- **Le compte s'affiche dans les deux états.** C'est lui qui rend le découpage
  lisible déplié, et lui qui dit ce qu'une section repliée contient. L'unité
  (« éléments ») tombe sous `sm` faute de place ; le nombre reste, et le nom
  accessible du bouton porte l'ensemble.
- **Le lieu affiché** est `place ?? autoPlaces.join(' · ')` — la saisie prime sur
  la déduction. Le calcul vit dans `placeLabelOf`, partagé avec le calcul de
  hauteur **et avec la visionneuse** : un lieu compté d'un côté et pas affiché
  de l'autre laisserait un blanc, l'inverse ferait déborder l'en-tête sur les
  photos.
- **La note est clampée à deux lignes**, son texte entier restant dans `title`.
  Une hauteur libre rendrait le layout dépendant d'une mesure DOM (D49).
- **L'éditeur s'ouvre en survol absolu**, jamais en poussant le flux : faire
  grandir l'en-tête à l'ouverture décalerait toute la suite de l'album sous le
  curseur. Le champ « lieu » prend `autoPlaces` en `placeholder` — on voit
  exactement ce qu'on remplace.
- **Le crayon ne s'efface que sous un pointeur fin** (`pointer-fine:opacity-0`).
  Un crayon par journée, tous visibles à la fois, transformerait la grille en
  formulaire — mais en Tailwind v4 `hover:` est déjà borné à
  `@media (hover: hover)`, si bien qu'un `opacity-0` sec le rendait
  **définitivement** hors d'atteinte au doigt : un administrateur sur téléphone
  ne pouvait annoter aucune journée. Le masquage est donc réservé au seul
  endroit où le survol peut le révéler, et le crayon reste visible sur tactile.

  Le variant natif `pointer-fine:` plutôt qu'un `[@media(hover:hover)]:`
  arbitraire, qui **n'était pas généré** : Tailwind n'extrayait pas le candidat,
  la règle n'existait nulle part dans la feuille, et le correctif n'en était pas
  un — il avait l'air juste dans le source et ne changeait rien à l'écran.

La description de l'album, elle, s'affiche en tête de `<main>` en `max-w-prose`
— elle était saisie depuis `/admin` sans être montrée nulle part. Sur
`AlbumsPage`, elle est clampée à deux lignes sous le titre : la carte ne peut pas
changer de hauteur selon l'album sans trouer la grille.

`Thumb` choisit la variante par `pickThumbSize(displayWidth)` : la plus petite
des tailles 320/640/1280 qui couvre la largeur d'affichage multipliée par le DPR
(plafonné à 2). Demander systématiquement du 1280 saturerait la bande passante
sur une grille de 200 vignettes. Les vignettes du premier écran sont en
`loading="eager"`, le reste en `lazy`. Les vidéos n'ont pas de rendu serveur : une
tuile sobre avec l'icône de lecture et la durée.

## Navigation clavier

Deux gestionnaires distincts, jamais actifs ensemble : celui de la grille se
désactive quand la visionneuse ou l'aide sont ouvertes.

| Contexte    | Touche          | Effet                                                                   |
| ----------- | --------------- | ----------------------------------------------------------------------- |
| Grille      | `← ↑ ↓ →`       | `moveSelection` sur le layout réel                                      |
| Grille      | `Début` / `Fin` | Premier / dernier média                                                 |
| Grille      | `Entrée`        | Ouvrir la visionneuse                                                   |
| Grille      | `Échap`         | Revenir à la liste des albums                                           |
| Visionneuse | `← →`           | Média précédent / suivant                                               |
| Visionneuse | `Début` / `Fin` | Premier / dernier                                                       |
| Visionneuse | `Échap`         | Défait une couche à la fois : zoom, puis panneau, puis fermeture        |
| Visionneuse | `I` `C`         | Ouvre le panneau sur l'onglet Infos · Commentaires (referme si déjà là) |
| Visionneuse | `F` `D`         | Plein écran · télécharger l'original                                    |
| Visionneuse | `Z`             | Zoom à 100 % (un pixel du rendu disponible = un pixel d'écran)          |
| Visionneuse | `Espace`        | Lecture / pause vidéo (sinon la page défilerait)                        |
| Partout     | `?`             | Aide-mémoire des raccourcis                                             |

À la souris dans la visionneuse : molette pour un zoom progressif centré sur le
curseur, **clic bref** pour basculer au niveau natif à l'endroit visé — et pour
en revenir —, glisser pour se déplacer dans l'image agrandie. « Bref » veut dire
moins de `TAP_SLOP_PX` (5 px) de déplacement entre l'appui et le relâchement :
au-delà, c'est un glisser, et il ne bascule rien. Voir la section Zoom.

**Au doigt** (`lib/useSwipe.ts`) : un balayage horizontal passe à la photo
suivante ou précédente. Trois conditions, chacune pour une raison :

- **Tactile et stylet seulement.** À la souris, le clic sert déjà à zoomer ;
  y ajouter un changement de photo rendrait le clic imprévisible selon qu'on a
  bougé de trois pixels ou non.
- **Franchement horizontal** (50 px, et 1,5 fois plus que la composante
  verticale) : sans ce rapport, un défilement vertical un peu oblique — le geste
  le plus courant sur un téléphone — ferait sauter une photo.
- **Désactivé pendant le zoom et sur les vidéos**, où le doigt sert
  respectivement à se déplacer dans l'image et à atteindre les contrôles natifs
  de lecture.

`moveSelection` (`useGridLayout.ts`) est le point délicat : les déplacements
verticaux suivent les **lignes réelles** du layout, dont le nombre de vignettes
varie, et visent la photo dont le centre horizontal est le plus proche. Un
décalage d'index fixe ferait dériver le curseur vers la gauche à chaque ligne.

Elle travaille **entièrement dans l'espace des cellules placées**, jamais dans
celui des index de la liste d'origine — y compris `gauche`, `droite`, `Début` et
`Fin`, qui valaient autrefois un simple `± 1`. Les deux espaces coïncidaient
tant que la grille montrait tout ; une section repliée les sépare, et un
`currentIndex + 1` enverrait la sélection sur une vignette absente du layout :
plus rien à mettre en évidence, et `scrollSelectionIntoView` sans cible (D65).
Une sélection introuvable — la journée qu'on vient de replier sous le curseur —
repart de la première vignette encore visible.

`scrollSelectionIntoView` ne défile que si la cellule sort du viewport, avec une
marge de 24 px, et respecte `prefers-reduced-motion`.

Les vignettes sont `tabIndex={-1}` : la navigation se fait aux flèches, les
inclure dans l'ordre de tabulation doublerait le parcours clavier.
`useShortcut` ignore les raccourcis à une touche quand un champ de saisie a le
focus ou qu'un modificateur est enfoncé.

## Visionneuse — `components/Lightbox.tsx`

- **L'en-tête porte le contexte de la journée, pas le nom du fichier** : la
  date, le lieu, la note. Ouvrir une photo faisait jusque-là perdre ce que son
  en-tête de section disait, alors que c'est lui qui donne son sens à l'image.
  Le nom du fichier et l'horodatage exact n'ont pas disparu — ils sont à une
  touche, dans le panneau `i`, où ils vivaient déjà.

  Les libellés viennent de `dayKey`, `dayLabel` et `placeLabelOf`, **les mêmes
  fonctions que la grille**. Une visionneuse qui calculerait sa date de son côté
  finirait par annoncer autre chose que l'en-tête d'où l'on vient de cliquer.
  `AlbumPage` active donc `useAlbumDays` dès qu'une photo est ouverte, et plus
  seulement en découpage par jour ; la `queryKey` étant la même, un album déjà
  par jour ne relance aucune requête.

- **La progression est une barre, doublée du rapport chiffré**, comptée sur
  `album.itemCount` et non sur la liste paginée, qui grandit en cours de
  parcours (D66). Elle vit sous les icônes : c'est la première ligne qui manque
  de place sur un téléphone, où cinq icônes plus la croix ne laissaient qu'une
  quarantaine de pixels à la date.

- Gèle `document.body.style.overflow` à l'ouverture, sinon la molette ferait
  défiler la grille sous l'image.
- Prend le focus à l'ouverture et le **rend à l'élément précédent** à la
  fermeture.
- Vidéos : `<video controls autoPlay playsInline>` sur `/original`, seek natif
  par `Range`. Photos : `ZoomableImage`, remonté à chaque photo (`key={item.id}`)
  pour réinitialiser zoom et cadrage sans les remettre à zéro à la main.
- Le téléchargement passe par une ancre synthétique plutôt que `window.open` :
  pas de blocage de popup, et le navigateur gère sa barre de téléchargement.
- `SidePanel` n'est monté qu'à l'ouverture, et la position EXIF est liée vers
  OpenStreetMap.
- **Le gestionnaire de touches de la visionneuse écoute la fenêtre, et le
  panneau des commentaires contient un champ de saisie.** Sans garde, écrire
  « info » ferait défiler les photos et ouvrirait le panneau sous les doigts :
  les touches venant d'un `input`, d'un `textarea` ou d'un élément éditable sont
  donc ignorées — **sauf `Échap`**, qui doit rester la sortie de secours y
  compris depuis le champ. Le garde vit dans la visionneuse, à l'unique endroit
  qui écoute, plutôt qu'en `stopPropagation` dispersé dans les formulaires.
- Les flèches de navigation sont masquées pendant le zoom : le glisser sert alors
  à se déplacer dans l'image, et elles tomberaient sous le curseur.
- **La visionneuse est une rangée, pas une colonne.** La photo occupe une colonne
  `flex-1 min-w-0`, le panneau latéral la suivante à partir de `md`. `min-w-0`
  n'est pas décoratif : sans lui, l'image impose sa largeur et c'est le panneau
  qui déborde de l'écran. L'en-tête vit **dans** la colonne photo, sinon il
  passerait sous le panneau.
- **`goTo` ignore l'index déjà affiché.** `Début` sur le premier média, `Fin` sur
  le dernier, une flèche à une extrémité : la cible est l'index courant, aucun
  élément n'est remonté, donc aucun `loadeddata` n'est émis. Remettre `loaded` à
  `false` dans ce cas laisserait le tourniquet de chargement d'une vidéo tourner
  indéfiniment.
- **Un clic dans la zone photo referme le panneau ouvert**, comme n'importe quel
  tiroir. Le gestionnaire est posé en **capture** et non en bulle : le zoom se
  décide au relâchement du pointeur dans `ZoomableImage`, plus bas dans l'arbre,
  et en bulle les deux gestes partiraient ensemble — le panneau se fermerait _et_
  la photo zoomerait. Interrompre à la descente laisse le premier clic à la
  fermeture, le suivant zoome normalement.

  Les `button` de cette zone sont **exclus** : les flèches de navigation y vivent,
  et les compter comme un « dehors » refermerait le panneau à chaque photo —
  exactement le défaut que sa mise en colonne venait de corriger. Le repère de
  position du zoom (`role="img"`) est exclu de même : une capture s'exécutant
  avant sa cible, son `stopPropagation` ne peut pas le protéger.

  **Le balayage tactile est avalé de la même façon**, et c'est une conséquence
  qu'il faut connaître : `useSwipe` pose son `onPointerDown` en phase bulle sur
  ce même nœud, or un `stopPropagation()` émis en capture interrompt toute la
  file de dispatch, gestionnaires de bulle du même élément compris. Sur une
  tablette au-delà de `md`, panneau ouvert, le premier balayage referme donc le
  panneau sans changer de photo ; le suivant navigue. C'est cohérent avec « le
  premier geste ferme, le suivant agit », mais ce n'est pas gratuit.

  Sous `md` la question ne se pose pas — le panneau occupe tout l'écran, il n'y a
  pas de dehors.

### Pastille des commentaires — `lib/seenComments.ts`

Le bouton « Commentaires » de l'en-tête porte deux états visuels distincts, parce
qu'ils répondent à deux questions différentes : un **point sobre** dit qu'une
conversation existe ici, un **chiffre en couleur** dit qu'elle a bougé depuis le
dernier passage. Les confondre reviendrait à réclamer l'attention pour une photo
dont on a déjà tout lu. Le chiffre est plafonné à « 9+ » : au-delà il déborde de
l'icône, et savoir s'il y en a douze ou dix-sept ne change aucun geste.

La pastille est `aria-hidden` ; ce qu'elle dit est porté par l'`aria-label` du
bouton, sinon un lecteur d'écran annoncerait un chiffre nu.

**Le total vient du serveur, le repère de lecture du navigateur.** Le premier est
`GET /api/comments/:albumId`, chargé une fois pour l'album. Le second est un
nombre de commentaires vus par photo, dans `localStorage` sous
`gdv:comments-seen:<albumId>` — un nombre et non une date : comparer deux entiers
suffit à répondre à « y a-t-il du nouveau ? », là où une date obligerait le
serveur à transporter l'horodatage de chaque fil. Le choix du navigateur plutôt
que de la base est motivé en [08](./08-decisions.md), D55.

Trois bords que le calcul doit tenir :

- `unreadCount` a un **plancher à zéro**. Une suppression ou un masquage fait
  retomber le total sous le repère, et un « -2 » s'afficherait tel quel.
- Le repère **redescend** quand le total passe sous lui, sans quoi le message
  suivant resterait invisible tant qu'il n'aurait pas comblé l'écart.
- Rien n'est marqué tant que les compteurs ne sont pas chargés : marquer à ce
  moment effacerait le repère pour le reconstituer faux à l'arrivée des vrais
  totaux.

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

**Le pincement natif de la page compte aussi comme un agrandissement.** Sur
téléphone, personne n'utilise le zoom de l'application : on pince l'écran à deux
doigts, et c'est le bon geste — l'intercepter par un gestionnaire maison
entrerait en conflit avec le balayage de navigation, pour refaire moins bien ce
que le système fait déjà. Mais le navigateur re-rasterise alors à partir du rendu
`full` (2560 px), qui devient mou au-delà de ~2×. Un effet surveille donc
`window.visualViewport` et déclenche le chargement de `hd` dès que
`viewport.scale > 1` : l'échelle est lue une première fois à l'ouverture (la page
peut déjà être pincée), puis sur `resize` **et** `scroll`, les moteurs ne
signalant pas le pincement de la même façon. Rien n'est téléchargé tant qu'on n'a
pas pincé — `hd` est lourd, et sur données mobiles le coût est réel.

**Clic et glisser se départagent au relâchement**, dans `onPointerUp` du
conteneur, et non par un `onClick` sur l'image. La raison est mécanique : dès que
l'image est agrandie, le conteneur capture le pointeur pour suivre le
déplacement, et le navigateur adresse alors le `click` au capteur et non à
l'image — le gestionnaire n'était jamais atteint, si bien qu'il fallait `Échap`
pour revenir au cadrage. `isTap` (`lib/zoom.ts`) tranche sur la **distance**
parcourue, `TAP_SLOP_PX = 5` : zéro ne conviendrait pas, un pointeur fin bouge
toujours d'un pixel ou deux. La durée n'entre pas en compte — un glisser lent et
court reste un glisser, un doigt posé longuement sans bouger reste un clic.

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

Deux repères visuels : un **aperçu d'attente** (la vignette 320, déjà en cache
navigateur puisqu'elle vient d'être affichée dans la grille) flouté à la taille
exacte du rendu final, le temps que celui-ci arrive ; et un **repère de
position** pendant le zoom, avec le cadre de la zone visible — sans lui on perd
tout sens de l'orientation dès qu'on se déplace dans une image agrandie.
L'indicateur signale en plus `chargement HD…` tant que la variante `hd` n'est
pas prête : le pourcentage repose alors sur la résolution anticipée, pas sur une
mesure.

### L'aperçu flou ne va jamais sans indicateur

`lib/preview.ts` décide ensemble ce qui s'affiche pendant l'attente : aperçu,
indicateur d'activité, message d'échec. La combinaison est isolée en fonction
pure parce qu'une erreur y est silencieuse — elle ne casse rien, elle produit un
écran trompeur, qu'aucun typage ni test d'intégration ne signale.

Le cas s'est déjà produit : l'aperçu flou avait été introduit alors que
l'indicateur restait conditionné aux seules vidéos. L'ouverture d'une photo
donnait donc une image intégralement floue, sans rien qui dise qu'un rendu était
en cours — et le défaut disparaissait dès que le rendu était en cache, ce qui le
faisait passer pour aléatoire. Sur des fichiers de 9 Mo, l'attente dure plusieurs
secondes : le temps que le serveur télécharge l'original depuis Drive et le
ré-encode.

Les invariants sont vérifiés sur toutes les combinaisons
(`packages/web/test/preview.test.ts`) : un aperçu n'est jamais montré sans
indicateur, un échec exclut les deux, et l'indicateur apparaît même sans aperçu à
montrer — dimensions inconnues, un écran noir muet serait pire.

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

L'administration se navigue par **rubriques, une par URL** (D66) :

| Rubrique       | URL                   | Contenu                                                  |
| -------------- | --------------------- | -------------------------------------------------------- |
| Albums         | `/admin/albums`       | `AlbumsSection`                                          |
| Comptes        | `/admin/comptes`      | `UsersSection`                                           |
| Commentaires   | `/admin/commentaires` | `CommentsSection`                                        |
| Serveur        | `/admin/serveur`      | `DriveSection`, `SettingsSection`, `MaintenanceSection`  |

`ADMIN_TABS`, dans `AdminNav`, est la source unique : la navigation la rend, et
`AdminPage` valide contre elle le paramètre `:tab`. Une rubrique inconnue
redirige vers Albums plutôt que d'afficher une page vide, et `/admin` sans
rubrique reste un lien valide — c'est encore ce que vise la barre supérieure.

**La rubrique vit dans l'URL, pas dans un état local.** Un lien vers la file de
modération se partage, le retour du navigateur revient à la rubrique
précédente, un rechargement ne ramène pas à la première, et le retour de
consentement Google a une destination à nommer : le serveur redirige vers
`/admin/serveur`, la rubrique qui porte le bouton de connexion (voir
[05](./05-api.md)).

`AdminPage` monte la rubrique demandée **et les seules attentes qui la
concernent** : la file de modération n'affiche ni le chargement des albums ni
une erreur sur l'état du serveur, qui ne changeraient rien à ce qu'elle montre.
Son sélecteur d'album lit bien la même liste, mais ne la fait pas attendre — il
se remplit quand elle arrive. Les requêtes, elles, restent lancées en tête du
composant — la règle des hooks ne permet pas de les conditionner, et TanStack
Query les partage de toute façon d'une rubrique à l'autre.

Le bandeau de message reste dans la colonne de contenu, collé sous la barre
supérieure : la rubrique des commentaires défile toujours, et un message affiché
tout en haut passerait inaperçu depuis le bas de la file.

| Composant                     | Rôle                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `AdminNav`                    | Navigation entre les quatre rubriques, en `NavLink`                                     |
| `DriveSection`                | État de la connexion OAuth, consentement, déconnexion                                   |
| `UsersSection` / `UserForm`   | Liste des comptes, création, modification, suppression confirmée                        |
| `AlbumsSection` / `AlbumForm` | Liste des albums, état de synchronisation, découpage par défaut, création, modification |
| `SettingsSection`             | Intervalle de synchronisation, synchronisation au démarrage, cache                      |
| `MaintenanceSection`          | Occupation du cache et purge                                                            |
| `AlbumAccessPicker`           | Attribution des albums à un compte (voir plus bas)                                      |
| `ConfirmDialog`               | Confirmation nommée, en remplacement de `window.confirm`                                |
| `ui.tsx`                      | Primitives partagées : bouton, champ, case à cocher, encadré de section                 |

Chaque section porte ses propres mutations, et `ui.tsx` existe pour que les
formulaires ne réinventent ni les classes ni le lien `label` /
`aria-describedby`.

`AdminNav` a **deux régimes selon la largeur**, comme `SidePanel` : à partir de
`md`, une colonne collante de 12 rem, qui reste sous les yeux pendant qu'on fait
défiler la file de modération ; en dessous, une rangée qui défile
horizontalement, en débord des marges de la page — les mêmes 12 rem prélevées
sur un écran de téléphone ne laisseraient rien au contenu. L'état actif vient du
routeur : `NavLink` pose `aria-current="page"` et passe `isActive` à sa classe,
plutôt que de comparer des chemins à la main.

**Les notes de journée ne s'administrent pas ici.** Elles se saisissent dans
l'album, en face des photos qu'elles décrivent — c'est le seul endroit où l'on
sait quoi écrire (D50). `AlbumForm` ne porte que la préférence de découpage,
sous forme de case à cocher : `GroupBy` n'a que deux valeurs et l'absence de
regroupement par année est un choix documenté, un sélecteur n'apporterait qu'un
composant de plus.

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

### Panneau latéral — `components/SidePanel.tsx`

Un seul `aside` à droite, deux onglets : « Infos » (`ExifPanel`) et
« Commentaires » (`CommentsPanel`). Deux panneaux distincts se seraient disputé
la même place, chacun avec son en-tête et son bouton de fermeture, et basculer de
l'un à l'autre aurait décalé l'image deux fois. `ExifPanel` ne rend donc plus que
ses lignes ; le cadre appartient à `SidePanel`.

L'état est un `PanelTab | null` — `null` valant « fermé ». `i` et `c` ouvrent
l'onglet correspondant et le referment s'il est déjà affiché.

**Deux régimes de position selon la largeur.** À partir de `md`, le panneau est
un élément du flux (`md:relative md:w-80 lg:w-96 md:shrink-0`) : la zone photo
rétrécit d'autant, et c'est ce qui permet de le laisser ouvert d'une photo à
l'autre. En surimpression, il recouvrait la flèche « Suivant », ce qui obligeait
à l'ouvrir et le refermer sans arrêt. En dessous de `md` il reprend la
surimpression — 320 px prélevés sur un écran de téléphone ne laisseraient rien à
voir — et retrouve alors son `backdrop-blur`, inutile dès qu'il est opaque.

Le zoom n'a rien à savoir de ce rétrécissement : `ZoomableImage` mesure son
conteneur par `ResizeObserver`, donc l'échelle d'ajustement et le bornage du
cadrage se recalculent seuls. C'est ce qui a permis de régler le recouvrement
sans toucher au calcul du zoom.

Le compteur de la pastille vient de `MediaDetail.commentCount`, déjà chargé avec
le détail : afficher « 3 » avant même d'ouvrir l'onglet est ce qui donne envie de
le lire, et le fil lui-même n'est demandé qu'à l'ouverture — la plupart des
photos sont regardées sans qu'on lise les commentaires.

### Commentaires — `components/CommentsPanel.tsx`

Volontairement pauvre en fonctions : un fil, une réponse par fil, la suppression
de ses propres messages, et une correction de faute de frappe dans les trente
secondes. Pas d'édition **libre**, pas de réactions, pas de mentions — c'est
ce qui sépare une conversation sous une photo d'un forum.

- **L'identité se déclare au moment d'écrire**, dans le bas du panneau
  (`IdentityForm`) — pas à la connexion. C'est le seul instant où renseigner son
  adresse a un sens visible pour celui à qui on la demande. Sans identité, un
  bouton « S'identifier pour commenter » remplace le champ ; sans serveur SMTP,
  une phrase explique que les commentaires sont indisponibles plutôt que
  d'ouvrir un formulaire qui échouerait à la dernière étape.
- **Le texte du formulaire énumère tous les usages de l'adresse**, y compris
  l'abonnement automatique aux nouveautés des albums ouverts (D41). C'est le
  seul endroit où quelqu'un décide de la donner : un abonnement par défaut se
  défend dans un cercle privé à condition d'être annoncé là, et non découvert à
  la réception du premier email. Toute évolution de ce que l'application fait de
  l'adresse se répercute donc **dans ce paragraphe**, sans quoi il devient un
  engagement qu'on ne tient pas.
- **Pas de bouton « Répondre » sans identité vérifiée** : le serveur refuserait,
  et proposer le geste mènerait droit à un message d'erreur.
- **Le formulaire d'ouverture de fil est ancré en bas**, hors de la zone qui
  défile. Sur une photo très commentée, il faudrait sinon parcourir toute la
  conversation pour trouver où écrire.
- **Entrée publie, Maj+Entrée passe à la ligne.** Convention des messageries ; un
  commentaire de photo tient presque toujours en une phrase, et exiger un clic
  sur un bouton à chaque fois use.
- **Pas de bouton « Répondre » sous une réponse.** Le serveur rattacherait le
  message à la racine du fil (D35) : proposer un geste dont le résultat n'est pas
  celui qu'on montre serait trompeur.
- **Poster invalide le fil _et_ le détail du média.** Le second porte le
  compteur de l'onglet, qui resterait sinon en retard d'une unité jusqu'à la
  réouverture de la photo.
- Le corps est rendu en `whitespace-pre-wrap` : les retours à la ligne saisis
  sont conservés, et React échappe le texte — aucun HTML n'est interprété.
- **Poster invalide aussi les compteurs de l'album** (`queryKeys.commentCounts`),
  qui portent la pastille de la visionneuse. Sans ça, elle annoncerait l'état
  d'avant sur la photo qu'on a sous les yeux. Une **correction**, elle,
  n'invalide que le fil : elle ne change ni le nombre de messages, ni ce qui
  reste à lire.

#### Correction dans les trente secondes

Un bouton « Modifier (N s) » sous ses propres messages, le temps de
`COMMENT_EDIT_WINDOW_MS`. Le décompte est affiché : un bouton qui disparaît sans
prévenir se lit comme un bug, alors qu'ici la disparition est la règle. Il coûte
un rendu par seconde, sur un commentaire à la fois.

`Comment.canEdit` ne suffit pas à décider seul — c'est une valeur qui **périme
d'elle-même**, et un fil resté ouvert la porterait encore à `true` une heure plus
tard. `useEditWindow` la recoupe donc avec `createdAt` via `remainingEditMs`, la
fonction que le serveur utilise pour refuser : deux calculs séparés finiraient
par diverger d'une seconde, et c'est exactement l'écart où l'on clique sur un
bouton qui répond non.

Deux choix de comportement qui ne se devinent pas :

- Le champ de correction est prérempli avec le **texte saisi**, pas le texte
  rendu : corriger un message ne doit pas remplacer « :) » par l'emoji dans ce
  qui est stocké.
- Le formulaire **reste ouvert** si la fenêtre se referme pendant la saisie. Le
  serveur tranche et son refus s'affiche ; le fermer d'autorité ferait
  disparaître sans prévenir le texte en cours de frappe.

#### Emoji — `lib/emoji.ts`

Deux chemins, un seul stockage. Sur mobile, les gens tapent de vrais caractères
emoji au clavier système : ils traversent l'API et SQLite sans traitement, il n'y
a rien à faire pour eux. Sur clavier physique, on écrit « :) » — c'est ce
raccourci qu'`emojify` traduit, et le sélecteur de la palette qui comble le
reste.

**La traduction se fait à l'affichage, jamais à l'écriture.** Le corps stocké
reste celui qui a été saisi : une substitution faite au `POST` serait
irréversible, et la liste des raccourcis ne pourrait plus évoluer sans réécrire
les commentaires déjà publiés. La sortie est du texte pur, jamais une balise —
l'échappement de React reste l'unique rempart, au lieu d'un second qu'il faudrait
vérifier.

Un raccourci n'est reconnu qu'**isolé** : précédé du début du texte ou d'un
blanc, suivi de la fin ou d'un caractère qui n'est ni lettre ni chiffre. Les deux
bornes sont indispensables, pour des raisons différentes — sans celle de gauche
`https://exemple.fr` deviendrait `https😕/exemple.fr`, sans celle de droite
« :pizza » deviendrait « 😛izza ». La borne gauche est un groupe capturant et non
un `lookbehind` : Safari ne l'a implémenté qu'en 16.4.

La palette compte trente-deux entrées et **aucune recherche** : ce n'est pas un
clavier de rechange mais un raccourci pour ce qu'on écrit sous une photo de
famille. Une palette exhaustive demanderait un index, donc une dépendance, pour
un panneau où l'on tape une phrase. La remise du curseur après insertion est
différée d'une image (`requestAnimationFrame`) : React réécrit la valeur du
`textarea` au rendu suivant, ce qui replacerait le curseur à la fin du texte.

Le bouton est posé **à gauche de « Publier »**, et le formulaire ne porte aucune
légende : sous une photo, la place se prend sur la conversation. Ce qui restait à
dire — que « :) » devient un emoji — tient dans l'infobulle du bouton qui en
parle, désormais le seul endroit où la substitution s'apprend. La palette
s'ouvre vers le haut et **ancrée à droite** : le formulaire est en bas du
panneau, et 16 rem alignées à gauche déborderaient de celui-ci.

### Modération — `components/admin/CommentsSection.tsx` et `lib/moderation.ts`

**Une liste de travail, pas un flux** (D67). On arrive avec une intention — un
message signalé, une journée, une adresse —, et la file répond à ces trois
entrées : une barre de filtres (onglets `Tous` / `Visibles` / `Masqués`,
sélecteur d'album, champ de recherche) et une pagination page par page.

La barre est dans le corps de la section et non dans l'`action` de son en-tête :
trois onglets, un sélecteur et un champ de saisie ne tiennent pas à côté d'un
titre. Le sélecteur d'album est un `<select>` en clair — le seul de
l'application, en extraire une primitive pour un usage unique serait spéculatif.
La file ne l'attend pas : elle s'affiche pendant que la liste des albums charge.
La recherche est reportée de 300 ms, sans quoi chaque frappe partirait au
serveur.

**Une page à la fois**, 25 lignes, et non une accumulation : chaque masquage
invalide la file, et une requête infinie rechargeait alors toutes les pages
déjà chargées. Une pile de curseurs tient le chemin parcouru — c'est le seul
moyen de revenir en arrière avec une pagination par curseur — et se vide dès
qu'un filtre change. `keepPreviousData` garde la page affichée le temps de la
suivante, faute de quoi la section se replie sous le curseur à chaque clic.
Le pied annonce `x–y sur total`, où `total` vient du serveur.

`lib/moderation.ts` range la page **par journée, puis par photo**. Deux
répétitions disparaissent : la date, inutile sur chaque ligne quand vingt
messages se suivent le même jour, et le couple photo / album, réécrit à
l'identique sous chaque message d'un même fil. La journée est celle du lecteur
et **non UTC**, à l'inverse de la grille — la raison est plus bas, section
« Dates ». Le rangement ne porte que sur la page reçue : une photo dont les
commentaires enjambent une frontière de page apparaît des deux côtés.

Chaque bloc renvoie vers la photo commentée (`/album/:id?photo=<mediaId>`) :
modérer sans voir l'image qui a suscité le message revient à juger un propos hors
contexte. Un média disparu de l'index laisse le commentaire modérable, sans lien.

L'adresse de l'auteur porte l'**action groupée** : la cliquer propose de masquer
tous ses messages d'un coup, derrière un `ConfirmDialog` qui dit ce qui est en
jeu — tous les albums, pas seulement la page affichée.

## Dates : tout en UTC

`lib/format.ts` construit tous ses `Intl.DateTimeFormat` avec
`timeZone: 'UTC'`, et `monthLabel` fait de même.

La raison : `taken_at` est l'heure qu'affichait l'appareil au déclenchement,
lue d'un EXIF sans fuseau et interprétée en UTC par `parseExifTime`. Réafficher
cette valeur dans le fuseau du navigateur décalerait la photo — une photo prise à
14 h s'afficherait à 16 h pour un navigateur en Europe/Paris, et le regroupement
par mois ou par jour basculerait pour les prises de vue de fin de mois ou de fin
de soirée. **Toute nouvelle date affichée doit passer par `lib/format.ts`.**

**Trois exceptions**, et elles portent toutes sur des instants réels, pas sur des
heures d'appareil.

- Le « aujourd'hui » auquel `dayLabel` compare une clé de jour est pris sur le
  calendrier **local** du navigateur. Voir [D31](./08-decisions.md) — ce n'est pas
  une valeur venue du serveur, c'est l'horloge murale de celui qui regarde, la
  même que celle de l'appareil qui a horodaté la photo.
- `formatLocalDateTime` rend la date d'un **commentaire** dans le fuseau du
  lecteur. Le raisonnement du fichier vaut pour `taken_at`, une heure murale sans
  fuseau qu'une conversion rendrait fausse ; `created_at` est l'inverse — un
  instant réel, celui où quelqu'un a appuyé sur « Publier ». L'afficher en UTC
  montrerait 19:14 à qui vient d'écrire à 21:14 depuis Paris. Les fils affichent
  `formatRelative` (« il y a 5 min ») et gardent la date complète en infobulle.
- **Les journées de la file de modération** se calculent sur le calendrier local,
  par `localDayKey` (`lib/justify.ts`), pour la même raison que la précédente :
  ce sont des `created_at`. Grouper en UTC rangerait sous la veille un message
  écrit à 0 h 30 à Paris.

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

**`cursor: pointer` est remis en base sur les éléments cliquables.** Tailwind 4 a
retiré la règle que sa v3 posait sur les `button`, pour s'aligner sur le défaut
du navigateur. Ici le résultat était qu'au survol, plus rien n'annonçait qu'un
élément était cliquable — cette interface est faite de boutons sans bordure posés
sur des photos, où le curseur était le seul indice. La règle vit dans
`@layer base` et non en classe sur chaque bouton, qu'on oublierait au premier
composant ajouté ; les éléments désactivés en sont exclus, leur curseur devant
dire qu'il ne se passera rien.

## Build

`vite.config.ts` : sourcemaps activées, et un chunk `vendor` séparé
(`react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`) qui change
rarement et reste en cache navigateur d'un déploiement à l'autre.

En développement, Vite sert le front sur `:5173` et proxie `/api` vers
`:8080` **sans** `changeOrigin` : les cookies de session et le callback OAuth
restent sur une seule origine.
