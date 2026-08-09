# 07 — Frontend

React 19, Vite 6, Tailwind 4, TanStack Query 5, React Router 7. Aucun état
global maison : ce qui vient du serveur vit dans TanStack Query, ce qui décrit la
vue vit dans l'URL, le reste est du `useState` local.

## Routage

`App.tsx`, cinq routes plus un fourre-tout.

| Chemin            | Page         | Garde                              |
| ----------------- | ------------ | ---------------------------------- |
| `/login`          | `LoginPage`  | aucune (redirige si déjà connecté) |
| `/pair`           | `PairPage`   | `RequireAuth`                      |
| `/`               | `AlbumsPage` | `RequireAuth`                      |
| `/album/:albumId` | `AlbumPage`  | `RequireAuth`                      |
| `/admin`          | —            | `Navigate to="/admin/albums"`      |
| `/admin/:tab`     | `AdminPage`  | `RequireAuth admin`                |
| `*`               | —            | `Navigate to="/"`                  |

`RequireAuth` s'appuie sur `useMe()`. **Ce n'est pas un contrôle de sécurité** :
le serveur refuse déjà toute route protégée. Il évite d'afficher une page vide en
attendant le 401, et mémorise la destination dans `location.state.from` pour y
revenir après la connexion.

Le retour après connexion emporte `pathname` **et** `search`. C'est
indispensable depuis `/pair?code=…` : le code de l'appairage vit dans la
recherche, et un retour au seul chemin ramènerait sur une page qui ne sait plus
quoi approuver.

Le serveur rend `index.html` sur toute URL non-`/api` et non-`/assets`, donc un
rechargement direct sur `/album/vacances` fonctionne (voir [05](./05-api.md)).

### Cinq paramètres de requête portent l'état de la vue

Sur `/album/:albumId` :

- `?photo=<mediaId>` — la visionneuse est ouverte sur ce média. Le bouton Retour
  la referme, et un lien partagé rouvre la même vue.
- `?panel=comments` (ou `info`) — l'onglet ouvert du panneau latéral. C'est ce
  qui permet d'arriver sur la **conversation** et pas seulement sur l'image : le
  tiroir d'activité et les emails de notification renvoient tous deux vers
  `?photo=…&panel=comments`. Sans ce paramètre, ils ouvraient la photo en
  laissant les messages fermés, c'est-à-dire invisibles — un email annonçant un
  message menait à une image muette. Une valeur inconnue vaut « panneau fermé »
  (`isPanelTab`). Le panneau n'est donc plus un état local de `Lightbox`, qui le
  reçoit désormais en propriété.
- `?order=desc` — sens chronologique. **C'est l'album qui porte le défaut**
  (`Album.sortOrder`), pas une constante : un séjour se raconte du premier jour
  au dernier, une bibliothèque qu'on alimente au fil de l'eau se lit par la fin.
  Le paramètre n'est écrit que s'il contredit cette préférence — même règle que
  `?group=`. Une valeur inconnue est ramenée au sens résolu (`isSortOrder`),
  pour ne pas laisser une URL bricolée à la main provoquer un 400.

  S'y ajoute une **mémoire par album dans le navigateur**, que le découpage n'a
  pas : `gdv:album-order:<albumId>` (voir `lib/albumOrder.ts`). La priorité est
  **URL > navigateur > album**. L'URL d'abord parce qu'elle est une vue exacte,
  partagée ou reçue par email, et que la mémoire locale du destinataire n'a pas
  à la contredire ; le navigateur ensuite, parce que rebasculer le même album à
  chaque visite est précisément le geste qu'une mémoire évite. Basculer le sens
  écrit **toujours** dans le navigateur, et dans l'URL seulement si le sens
  contredit l'album.

  Tant qu'aucune des trois sources n'a répondu — album pas encore chargé, rien
  en mémoire, pas de paramètre —, `resolveOrder` rend `null` et `useAlbumItems`
  reste **désactivée**. Sans cette garde, la découverte d'un album chargerait
  deux cents éléments dans un sens rejeté à la réponse suivante. La requête
  restant `pending`, le `Spinner` de la grille couvre l'attente.

- `?group=day` — découpage de la grille en sections. Même règle de défaut porté
  par l'album (`Album.groupBy`), sans la mémoire par navigateur : le découpage
  est une lecture de l'album, pas une habitude de lecteur. Une valeur inconnue
  est ramenée à la préférence de l'album (`isGroupBy`). Contrairement à `order`,
  ce paramètre **ne part jamais au serveur** et n'entre pas dans la clé TanStack
  Query de la liste : celle-ci est la même, seule la mise en page la segmente
  autrement, donc rebasculer ne recharge aucune photo.

  **Piège** : `album` et `items` sont deux requêtes distinctes, et `groupBy`
  comme `order` basculent sur la préférence de l'album quand la première arrive.
  L'effet qui remet la sélection à zéro et remonte la page attend donc
  qu'`album.isPending` soit retombé — sans cette garde, ouvrir un album réglé
  sur « jour » ferait sauter la page une seconde fois, après coup, sous le
  curseur de quelqu'un qui avait déjà commencé à défiler.

- `?day=YYYY-MM-DD` — **le seul paramètre éphémère**, et c'est ce qui le
  distingue des quatre autres : il ne décrit pas un état de la vue mais une
  destination. Un résultat de recherche l'écrit, la page défile jusqu'à la
  section correspondante, puis l'efface en `replace`. Gardé, il ramènerait la
  page sur cette journée à chaque recalcul du layout, et le bouton Retour
  rejouerait le saut au lieu de revenir.

  Il n'est honoré qu'en découpage par jour — d'où le `?group=day` que la
  recherche écrit avec lui. En découpage par mois, les clés de section valent
  `2026-07` : la journée n'y existe pas, et l'effet paginerait l'album entier à
  la recherche d'une section qui ne viendra jamais.

  Tant que la section n'est pas dans `grid.layout.sections` et qu'il reste des
  pages, `fetchNextPage()` — exactement le motif déjà en place pour `?photo=`.
  Si l'album s'épuise sans l'avoir trouvée, le paramètre est effacé plutôt que
  laissé à repaginer indéfiniment. L'effet dépend de l'**ordonnée** de la
  section et non de la section elle-même : `grid` est un objet neuf à chaque
  rendu, et en dépendance l'effet se rejouerait en plein défilement.

Les cinq sont indépendants : `setParams` repart toujours des paramètres
courants, sinon ouvrir une photo effacerait le tri et le refermer le rétablirait
tout seul. Il accepte **plusieurs clés d'un coup** pour les gestes qui en
touchent deux : fermer la visionneuse retire la photo _et_ son panneau, et deux
écritures successives laisseraient une entrée d'historique intermédiaire où
l'une est partie sans l'autre. Le panneau resté seul dans l'URL rouvrirait
d'ailleurs la photo suivante sur un onglet que personne n'a redemandé.

Ouvrir une photo pousse une entrée d'historique ; naviguer d'une photo à l'autre
aux flèches utilise `replace`, sinon parcourir 50 photos empilerait 50 entrées et
le bouton Retour ne ramènerait plus à la grille. Ouvrir et refermer le panneau
suit la même règle, pour la même raison.

`order` et `group` se pilotent depuis deux bascules de la `TopBar`, déclarées en
`actions` (voir « Barre supérieure » plus bas) et bâties sur le même patron :
**le libellé annonce l'état courant** (« Par mois »), **l'action annonce ce que
le clic fera** (« Regrouper par jour »), et l'`aria-label` réunit les deux — le
libellé disparaît sous `lg` faute de place, le nom accessible doit rester
complet. Changer l'un ou l'autre remet la sélection
clavier à `-1` et remonte la page : inverser le tri renumérote l'album, changer
le regroupement recalcule toutes les hauteurs, et dans les deux cas la position
conservée désignerait autre chose.

## Connexion — `pages/LoginPage.tsx`

Deux champs, et un second chemin sous eux : **« Connecter avec un téléphone »**.
Il est là pour l'écran qui n'a pas de clavier — un téléviseur, où chaque
caractère se compose à la télécommande (D260809c).

**L'identifiant est replié avant l'envoi**, et le serveur le replie aussi
(`05-api.md`) : `USERNAME_PATTERN` n'admet aucun espace, donc aucun compte n'en
porte, et une espace de bord ne vient que d'une autocomplétion mobile ou d'un
copier-coller. Sans ce repli, la saisie est juste à l'écran et le refus arrive
avec le message d'un mot de passe faux — le pire diagnostic possible, puisqu'il
désigne l'autre champ. Le mot de passe, lui, part tel quel : il a le droit d'en
contenir aux deux bouts.

### `components/PasswordInput.tsx`

Le champ masqué et son **œil**, qui en montre les caractères. Une faute de
frappe à l'aveugle ne se distingue pas d'un mot de passe oublié : sans ce
bouton, le seul recours est d'effacer et de recommencer, au clavier mobile où
la faute est justement la plus probable. Le composant sert aussi au `TextField`
de `components/admin/ui.tsx` dès que son `type` vaut `password` — un seul geste
pour la connexion et pour la création de compte.

L'état repart **masqué à chaque montage** : on ne laisse pas un secret en clair
derrière soi sur un écran qu'on quitte.

Le panneau d'appairage vit dans `components/DeviceLogin.tsx`, et il ne demande
rien tant qu'on ne l'ouvre pas : une demande d'appairage par affichage de la
page de connexion remplirait la table pour rien. Une fois ouvert, il montre le
QR, le code en clair sous lui, et sonde le serveur toutes les deux secondes
jusqu'à ce que la session arrive.

**La demande naît du clic, dans `LoginPage`, et pas d'un effet de montage du
panneau.** Ce n'est pas une préférence de style : sous `StrictMode`, le
démontage simulé détache l'observateur de la mutation en cours — le
`MutationObserver` de TanStack Query ne se rattache pas au remontage —, si bien
que la requête aboutit sans que son résultat n'atteigne personne et que l'écran
tourne indéfiniment. Le panneau reçoit donc la demande en propriété, avec de
quoi la rouvrir. C'est aussi la règle générale : une mutation appartient à un
geste, jamais à un montage.

- **Le QR ne contient que l'URL** `<origine>/pair?code=…`, jamais un secret : il
  s'affiche dans un salon. C'est le `deviceCode`, gardé par le seul navigateur
  qui a fait la demande, qui relève la session.
- **L'origine vient de `window.location`**, pas de `PUBLIC_URL` : l'adresse à
  ouvrir sur le téléphone est celle par laquelle cet écran-là est joignable.
- **Le code est affiché en toutes lettres** sous le QR, groupé par quatre. Il
  sert à deux choses : entrer l'appairage sans caméra, et surtout **vérifier**
  sur le téléphone qu'on approuve bien l'écran qu'on regarde.
- **Une demande expirée le dit et se relance** d'un bouton, plutôt que de laisser
  un QR mort à l'écran.
- Le sondage s'arrête dès que la page perd son panneau ou que la session arrive.
  Le composant est monté dans un écran qui reste allumé des heures : une boucle
  qui survivrait à sa fermeture n'aurait aucune raison de s'arrêter.

### `lib/qr.ts`

Encode l'URL en QR et rend un `path` SVG unique — un rectangle par module,
concaténés en une seule commande de tracé. Un `<svg>` inline plutôt qu'une image
en `data:` : la CSP n'autorise `data:` que pour les images inlinées par Vite
(voir [04](./04-securite-et-acces.md)), et un tracé se redimensionne sans
crénelage sur un écran de deux mètres.

L'encodage lui-même vient de `qrcode-generator`, une dépendance sans
dépendance : Reed-Solomon et masquage ne s'écrivent pas à la main pour économiser
dix kilo-octets. Le niveau de correction est `M`, et le type est choisi
automatiquement par la bibliothèque en fonction de la longueur de l'URL.

### Approbation — `pages/PairPage.tsx`

La page qu'ouvre le téléphone. `RequireAuth` la garde : sans session, elle
renvoie vers `/login` et y revient une fois connecté, code compris.

Elle affiche le code **tel que l'écran l'affiche**, et demande une confirmation
explicite. C'est la seule vérification possible contre un QR qui ne serait pas
celui qu'on regarde — le reste est du ressort de qui approuve (D260809c). Trois états
suivent : approuvé (« l'écran va s'ouvrir »), expiré, ou déjà pris par un autre
compte.

## Barre supérieure — `components/TopBar.tsx`

Une seule rangée, à toutes les largeurs, et **65 px réservés** plutôt que déduits
du contenu (`min-h-16` sur la rangée, plus le filet). Une page sans sous-titre —
la liste des albums — donnait sinon une barre de 57 px là où une page d'album en
fait 65 : tout ce qui y est centré verticalement sautait de 8 px d'une navigation
à l'autre, et la pastille du compte, seule à son extrémité, était ce qui le
montrait le mieux.

Deux familles s'y succèdent et ne se mélangent jamais : **ce que fait cette
page** — le retour, le titre et son sous-titre, l'activité, les contrôles de vue
— puis, tout à droite, **qui la regarde** : une pastille portant l'initiale du
compte, qui ouvre Admin, Déconnexion et Installer.

| Largeur      | Ce qui est visible                                                    |
| ------------ | --------------------------------------------------------------------- |
| `< sm` (640) | Retour, titre, **Activité**, un menu **Affichage**, la pastille       |
| `≥ sm`       | Idem, les contrôles de vue dépliés dans la barre en **icônes seules** |

**`Activité` reste en ligne à toutes les largeurs**, et n'entre jamais dans un
menu. Son icône porte la pastille des non-lus, seul signe qu'une conversation a
bougé quelque part ; rangée dans le menu, elle ne signalerait plus rien.
Exactement la règle du bouton « Commentaires » de la visionneuse, pour le même
motif. Le bouton est déclaré par la propriété `feed` et non dans le tableau
`actions`, qui est précisément ce qui bascule dans le menu.

Les seuils sortent de mesures, pas d'un choix d'esthétique. À 393 px, cinq
contrôles alignés poussaient les bascules de vue sur **une seconde rangée à
elles seules** — 101 px d'en-tête, le titre d'album réduit à `D.` et le
sous-titre à `120 éléments · févri…`. Et à 768 px, afficher les cinq libellés
ramenait le titre de 456 à 144 px en tronquant le sous-titre.

**Le libellé ne revient à aucune largeur** ([D90](./08-decisions/D90-les-controles-de-vue-se-nomment-au-survol-a-toutes-les.md)). Il
réapparaissait au-delà de `lg`, où la place ne manque pourtant pas : « Plus
récentes d'abord » y tenait à lui seul plus large que le sous-titre de l'album,
pour un réglage qu'on touche une fois par visite. Les deux contrôles se nomment
au survol — infobulle et nom accessible portent l'état **et** l'effet du clic,
« Plus récentes d'abord — Afficher les plus anciennes d'abord » —, et leur état
se lit dans le tracé : le sens de la flèche, un trait ou deux dans le
calendrier. Sous `sm` c'est le menu qui les nomme en clair, où la place est
justement ce qui manque le moins.

Les boutons de la rangée sont **carrés de 36 px**, tous. Sans libellé, deux
cibles de 28 px voisinaient avec le bouton d'activité, seul à sa taille, et
l'irrégularité sautait aux yeux sur une rangée par ailleurs alignée.

Le menu **Affichage** ne se rend que si la page déclare des contrôles ; sans
cette garde, `/` et `/admin` offriraient sous `sm` une cible qui n'ouvre rien.

**La barre est une surface, pas une portion de page** : `ink-800` translucide sur
un corps en `ink-900`, filet en `ink-700`. Elle valait `ink-900/85`, soit
exactement la couleur du corps — la bande n'existait alors que par un filet d'un
pixel, et sur un écran large la pastille, seule à son extrémité, paraissait posée
sur le vide. Le filet monte du même cran, sans quoi il se dissoudrait dans le
fond qu'il délimite. C'est le raisonnement déjà tenu pour le panneau de la
visionneuse, un cran au-dessus du sien.

**Les contrôles de page sont décrits, pas rendus.** `TopBar` ne prend plus de
`children` mais un tableau d'`actions` :

```ts
interface TopBarAction {
  label: string; // l'état courant, dans l'infobulle : « Par mois »
  action: string; // ce que le clic fera, dans le menu : « Regrouper par jour »
  icon: ReactNode; // le contenu d'un <svg viewBox="0 0 24 24">, pas la balise
  onSelect: () => void;
}
```

C'est la seule forme qui permet au **même** contrôle de se rendre en icône dans
la barre et en ligne libellée dans le menu. Avec des `children`, la page
fournissait du JSX dont la barre ne savait rien : le libellé ne pouvait qu'être
masqué, et les icônes se retrouvaient anonymes.

`icon` porte le **tracé** et non la balise — des `path`, des `rect` —, comme les
actions de la visionneuse. C'est la barre qui l'enveloppe, et elle seule sait à
quelle taille : 20 px en ligne, accordée aux autres icônes de la rangée, 16 px
dans le menu, accordée à toutes les entrées de menu de l'application. Une page
qui livrerait le `<svg>` tout fait imposerait la même aux deux — c'était le cas,
et l'écart de quatre pixels avec le bouton d'activité se voyait dès que le
libellé a cessé de le masquer.

**Le compte tient dans une pastille**, à toutes les largeurs. Admin, Déconnexion
et Installer étaient auparavant trois boutons alignés dans la barre, et
l'identifiant connecté vivait dans le sous-titre de la liste des albums — à
gauche, sous « Albums », loin des boutons auxquels il se rapporte, et à
l'emplacement qu'une page d'album donne au nombre d'éléments et à la période.
Trois actions dont aucune ne sert au quotidien occupaient ainsi la place que
réclamait le titre : les replier derrière une cible unique la lui rend, et
regroupe enfin l'identité avec ce qu'on peut en faire.

Ce que le menu affiche en tête : l'**identifiant**, puis l'**adresse** de
l'identité de commentateur si la session en porte une. Les deux, parce qu'elles
ne disent pas la même chose — l'identifiant ouvre des albums et peut être
partagé par tout un foyer, l'adresse dit qui signe (voir
[04 — Identités](./04-securite-et-acces.md#identité-de-commentateur)). La
pastille abrège la **première ligne** : une initiale prise ailleurs se lirait
comme un défaut au moment où le menu s'ouvre.

Pas de photo, ni de service d'avatar distant : une seule lettre, rendue sur
place. Aller chercher une image chez un tiers à partir de l'adresse la lui
communiquerait à chaque chargement de page, pour un gain purement décoratif sur
une application qu'on héberge précisément pour éviter cela (D86).

**Installer est en dernier, après Déconnexion.** La proposition apparaît et
disparaît selon le navigateur et selon qu'on a déjà installé ; la placer ailleurs
ferait bouger la position des contrôles permanents d'une visite à l'autre.

Le menu lui-même vit dans `components/ActionMenu.tsx`, partagé avec la
visionneuse. Il se referme au clic dehors, à `Échap` — en rendant le focus à
son bouton — et **avant** d'exécuter l'action choisie, celle-ci pouvant naviguer
ou ouvrir un panneau. Son écoute de `Échap` est en **capture** et arrête la
propagation : dans la visionneuse, la même touche ferme aussi la photo, et un
seul appui ne doit pas faire les deux.

Un composant partagé plutôt qu'un menu par emplacement : ce sont ces trois
règles de fermeture qui se réécriraient de travers la deuxième fois.

### Recherche — `components/SearchBox.tsx` et `lib/useDebounced.ts`

**Sur la page d'accueil seulement.** La recherche porte sur toute la
bibliothèque, et c'est passé une vingtaine d'albums que « où sont les photos de
Marseille » cesse d'avoir une réponse : dans un album déjà ouvert, la question ne
se pose plus.

Elle arrive par une propriété `search?: ReactNode` de `TopBar`, rendue entre le
titre et le bouton d'activité. Un `ReactNode` et non un descripteur à la
`TopBarAction` : le champ n'a qu'**un** rendu — il ne se replie pas en entrée de
menu, on ne cherche pas dans un menu — et son état appartient à la page qui le
monte.

**Le champ est centré dans la barre**, et c'est ce qui fixe sa largeur : à
partir de `sm` il ne s'étire plus, il tient 20 rem, et le titre à gauche comme
les contrôles du compte à droite se partagent le reste à parts égales — d'où le
`flex-1` symétrique de part et d'autre. Étiré jusqu'aux contrôles, il y collait
et la barre paraissait pencher de ce côté.

**La rangée unique est préservée à toutes les largeurs.** Sous `sm`, le titre
« Albums » s'efface (`hidden sm:block`) et le champ reprend toute la ligne :
20 rem fixes y laisseraient un blanc au milieu d'un écran de 393 px. Sur la
racine, le titre ne dit rien que l'URL ne dise déjà, alors qu'une seconde rangée
coûterait 40 px d'en-tête sur une application où ce qui doit ressortir, ce sont
les photos.

**Ce qui est suggéré est navigable, pas textuel.** Trois groupes — Albums,
Journées et lieux, Photos —, cinq entrées chacun au plus, et chaque entrée mène
quelque part : `/album/:id`, `/album/:id?group=day&day=…`,
`/album/:id?photo=…`. Un groupe vide disparaît avec son titre.

**Combobox au sens ARIA** : `role="combobox"` sur le champ, `aria-expanded`,
`aria-activedescendant`, liste en `role="listbox"` et groupes en `role="group"`.
Le focus ne quitte jamais le champ — le déplacer sur les options couperait la
frappe, qui est tout l'intérêt d'une suggestion. La liste est faite de `div`
portant les rôles, et non de `ul`/`li` : un `listbox` ne possède que des `option`
et des `group`, et le rôle `list` implicite d'un `ul` imbriqué s'interposerait
entre les deux.

| Touche   | Effet                                                        |
| -------- | ------------------------------------------------------------ |
| `/`      | Focalise le champ (`useShortcut`, ignoré pendant une saisie) |
| `↑` `↓`  | Parcourt les suggestions, en boucle                          |
| `Entrée` | Ouvre la suggestion en évidence                              |
| `Échap`  | Referme la liste ; une seconde fois, vide le champ           |

Le premier résultat est mis en évidence d'emblée : taper puis appuyer sur
`Entrée` est le geste le plus fréquent, et exiger une flèche d'abord ferait d'un
raccourci une manœuvre. `Échap` en deux temps parce que fermer et effacer d'un
coup fait perdre une recherche qu'on voulait seulement masquer le temps de
regarder la page.

Le clic sur une option est pris sur `pointerdown` avec `preventDefault`, pas sur
`click` : le pointeur sortant du champ lui fait perdre le focus, et l'écouteur
« clic dehors » refermerait la liste avant que le clic n'atteigne l'option. La
liste est positionnée en `absolute` et non `fixed`, pour la raison
d'`ActionMenu` : la barre porte un `backdrop-blur`, qui en fait le bloc conteneur
d'un élément fixé.

**`lib/useDebounced.ts`** retarde la saisie de 150 ms avant qu'elle atteigne
`useSearch`. Sans lui, chaque caractère part en requête : « Marseille » en
lancerait neuf, dont huit périmées avant d'arriver. Au-delà de 150 ms la liste
paraît traîner derrière les doigts.

`useSearch` porte `placeholderData: keepPreviousData` : la liste précédente reste
affichée le temps de la requête suivante. Sans lui, chaque frappe la viderait
puis la remplirait — c'est le seul endroit de l'application où une réponse
arrive à la cadence du clavier, et une liste qui clignote sous le doigt est
illisible.

## Gestion d'état — `api/hooks.ts`

Réglages par défaut du `QueryClient` (`main.tsx`) : `refetchOnWindowFocus: false`
— les albums ne changent qu'au rythme des synchronisations —, `staleTime` de
60 s, `retry: 1`.

| Hook              | Clé                                   | Particularité                                                                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useMe`           | `['me']`                              | `staleTime` 5 min. Ne **réessaie pas** sur 401 : c'est la réponse normale d'un visiteur non connecté, pas un incident.                                                                                                                                                                    |
| `useLogin`        | —                                     | Écrit `me` dans le cache et invalide `albums`.                                                                                                                                                                                                                                            |
| `useLogout`       | —                                     | `queryClient.clear()` : le cache contient les albums et médias de l'ancienne session.                                                                                                                                                                                                     |
| `useAlbums`       | `['albums']`                          |                                                                                                                                                                                                                                                                                           |
| `useAlbum`        | `['album', id]`                       |                                                                                                                                                                                                                                                                                           |
| `useAlbumItems`   | `['items', id, order]`                | `useInfiniteQuery`, curseur serveur. **`order` fait partie de la clé** : sans lui, TanStack resservirait les pages chargées dans l'autre sens et continuerait de paginer à l'envers. Un troisième argument `enabled` la tient à l'arrêt tant que le sens n'est pas résolu.                |
| `useAlbumDays`    | `['days', id]`                        | Activée **seulement en découpage par jour** : par mois, les notes sont masquées et la requête ne servirait à rien. Pas d'`order` dans la clé — les journées sont les mêmes dans les deux sens. Rend aussi une `Map` mémoïsée par clé de jour, dont dépend la mémoïsation du layout.       |
| `useMediaDetail`  | `['detail', albumId, id]`             | `staleTime: Infinity`, activée dès qu'un onglet du panneau latéral est ouvert — pas seulement « Infos » : `MediaDetail.commentCount` alimente la pastille de l'onglet « Commentaires ».                                                                                                   |
| `useCommentsFeed` | `['comments', albumId ?? '', 'feed']` | `useInfiniteQuery`, curseur serveur, `staleTime` 30 s. Le littéral est **en dernier**, comme pour `commentCounts` : devant, il entrerait en collision avec le fil d'un album qui s'appellerait « feed ». Montée dès l'affichage d'une page de galerie — c'est elle qui porte la pastille. |
| `useAdminStatus`  | `['admin','status']`                  | `refetchInterval` de 2 s tant qu'un album est `running`, sinon aucun sondage.                                                                                                                                                                                                             |
| `useAdminUsers`   | `['admin','users']`                   | Liste d'administration des comptes.                                                                                                                                                                                                                                                       |
| `useAdminAlbums`  | `['admin','albums']`                  | Même sondage conditionnel que `useAdminStatus` : la page d'administration lit les albums ici, pas dans le statut.                                                                                                                                                                         |
| `useSettings`     | `['admin','settings']`                |                                                                                                                                                                                                                                                                                           |

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

`useGridLayout(items, groupBy, days)` construit la fonction, dont le calcul est
isolé dans `sectionHeaderHeight` — pure, exportée, et vérifiée pour elle-même :
`GRID_HEADER_HEIGHT + (lieu ? 1 : 0) + lignes de la note`, chaque ligne valant
`GRID_HEADER_LINE_HEIGHT` (20 px). Elle rend `undefined` en découpage par mois —
une note appartient à une journée, et il n'y aurait pas d'en-tête à qui
l'accrocher parmi les trente. Le layout reste pur et testable sans DOM, ce qui
est l'invariant de `justify.test.ts`.

Cette constante est un **contrat avec `SectionHeader`**, qui doit tenir dedans :
d'où l'interligne fixé explicitement (`leading-5`). C'est l'**interligne** qui
tient le contrat, jamais la taille de police : remonter le lieu et la note de 13
à 14 px n'y touche pas tant que `leading-5` reste.

**Le nombre de lignes de la note est mesuré, pas estimé** — `lib/measureLines.ts`
rend le texte dans une sonde hors écran portant les mêmes classes
(`GRID_HEADER_NOTE_CLASS`) et la même largeur, puis divise la hauteur obtenue par
l'interligne. Le résultat sert **à la fois** à réserver la hauteur et à borner la
boîte rendue (`descriptionLines`, porté par `GridLayout`), si bien que les deux
ne peuvent pas diverger. C'est ce qui permet à une note longue de s'afficher en
entier sans revenir à une hauteur libre : une estimation d'après la longueur du
texte, elle, se trompe (D85, D93).

### Sections repliées

`LayoutOptions.isCollapsed?: (key) => boolean` replie une section : elle garde
son en-tête, ne place aucune ligne, et sa hauteur vaut exactement
`headerHeight` — le retrait du dernier `gap`, qui n'a de sens qu'après une
ligne, est sauté. Les sections suivantes remontent d'autant.

Le repli passe par le calcul et non par un `display: none` au rendu, pour la
même raison que les hauteurs d'en-tête : `totalHeight` gouverne la barre de
défilement et la virtualisation. Masquer les vignettes après coup laisserait la
page haute de tout ce qu'elle n'affiche plus (D68).

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
`AlbumPage` — ni URL ni `localStorage` (D68).

**Une section repliée change aussi de hauteur de base**
(`GRID_COLLAPSED_HEADER_HEIGHT`, 44 px contre 56). La hauteur d'en-tête se
décompose en trois constantes, et c'est la dernière seule qui tombe au repli :

| Constante                  | Valeur | Rôle                                             |
| -------------------------- | ------ | ------------------------------------------------ |
| `GRID_HEADER_PAD_TOP`      | 20     | Retrait au-dessus du titre. **Invariant.**       |
| `GRID_HEADER_TITLE_HEIGHT` | 24     | La ligne du titre (`leading-6`, `h-6`).          |
| `GRID_HEADER_PAD_BOTTOM`   | 12     | Respiration avant les vignettes. Nulle au repli. |

**Le contenu de l'en-tête est aligné en haut de sa boîte, jamais en bas**, et
c'est ce qui rend le repli utilisable : le titre se cale sur
`section.y + GRID_HEADER_PAD_TOP` quel que soit l'état, et la variation de
hauteur se consomme en bas, là où il n'y a plus rien. Aligné en bas — comme il
l'était — raccourcir la boîte remontait le titre d'autant, et le libellé
sautait de 20 px sous le curseur à chaque clic. Un bouton de repli qui déplace
sa propre étiquette est inutilisable.

Le lieu et la note gardent leur coût, eux, puisqu'ils restent affichés : c'est
tout l'intérêt d'une journée repliée.

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
  le front** — voir [D31](./08-decisions/D31-le-regroupement-de-la-grille-vit-dans-l-url-mais-aujourd-hui.md).
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

`Thumb` efface donc son `src` au démontage (`releaseIfDetached`, dans
`lib/imageRelease.ts`), seul geste qui coupe réellement la requête. Le contrôle
sur `isConnected` n'est pas une précaution de style : `StrictMode` rejoue montage
et démontage **sans toucher au DOM**, et sans lui les vignettes du premier écran
perdaient leur `src` à l'instant où elles s'affichaient — React ne le réécrit
pas, sa vue du DOM le croyant inchangé.

**La visionneuse doit le même geste, et pour bien plus lourd** ([D87](./08-decisions/D87-une-image-qu-on-quitte-doit-etre-abandonnee-sinon-elle-la-de.md)).
`ZoomableImage` est remonté à chaque photo (`key={item.id}`), et son `<img>`
sortant emporte un `full` d'environ un mégaoctet que personne n'attend plus.
Mesuré en parcourant vingt-cinq photos aux flèches puis en refermant la
visionneuse : **89 requêtes en vol**, dont vingt-quatre `full` orphelins, et les
soixante vignettes de la grille derrière eux dans la file — noires pendant une
minute, ce qui se lit comme des vignettes qui ne chargeront jamais. Le même
`releaseIfDetached` au démontage, plus l'abandon du `hd` s'il était en route,
ramène la mesure à **dix requêtes en vol et zéro `full` orphelin**, et la grille
se remplit en cinq secondes. Le helper vit donc dans `lib/` et non dans `Thumb` :
deux appelants, une seule raison.

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

- **Trois détails d'alignement, chacun réglant un défaut mesuré.** Le titre
  (16 px) et le compte (12 px) sont alignés sur leur **ligne de base** : centrés
  par leurs boîtes, leurs lettres ne tombaient pas au même niveau. Le compte
  prend `leading-none`, parce qu'un interligne égal à celui du titre lui donne
  une boîte aussi haute que l'alignement descend de deux pixels — elle pendait
  sous une section repliée, dont la boîte vaut exactement
  `PAD_TOP + TITLE_HEIGHT`. Enfin le lieu et la note prennent `pl-[22px]`, la
  largeur du chevron et de sa gouttière, pour partir de la même abscisse que le
  **texte** du titre ; sans quoi les trois lignes de l'en-tête s'alignaient sur
  deux bords différents. Le chevron reste seul dans sa gouttière, comme la
  flèche d'une arborescence.
- **Le lieu affiché** est `place ?? autoPlaces.join(' · ')` — la saisie prime sur
  la déduction. Le calcul vit dans `placeLabelOf`, partagé avec le calcul de
  hauteur **et avec la visionneuse** : un lieu compté d'un côté et pas affiché
  de l'autre laisserait un blanc, l'inverse ferait déborder l'en-tête sur les
  photos.
- **Le lieu tient sur une ligne tronquée** — il est court par nature, et son
  texte entier reste dans `title`, dans le panneau `i` et dans le bandeau de la
  visionneuse. **La note s'affiche en entier**, sur autant de lignes de
  `GRID_HEADER_LINE_HEIGHT` (20 px) qu'il lui en faut : le nombre vient de la
  mesure décrite plus haut, jamais d'une hauteur libre que le layout ne saurait
  pas anticiper (D49, D85, D93). Le `line-clamp` posé sur le paragraphe reprend
  ce même nombre : il ne tronque rien tant que la mesure tombe juste, et il est
  le seul rattrapage possible le jour où elle ne tomberait pas juste.
  `whitespace-pre-line` conserve en outre les retours à la ligne saisis, comme
  le font déjà `MediaCaption` et `AlbumDescription` de la même note — la sonde
  portant la même classe, ces retours entrent d'eux-mêmes dans la hauteur
  réservée.
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

### Description de l'album — `components/AlbumDescription.tsx`

Elle s'affiche en tête de `<main>`, **sur toute la largeur de la grille**, et
**s'y modifie** pour un
administrateur. Elle ne se saisissait que depuis `/admin`, alors que la note
d'une journée s'écrit d'un clic dans la grille juste en dessous : deux textes
voisins, deux gestes. Le composant supprime cette asymétrie ; `/admin` reste le
seul endroit où changer le titre, le dossier Drive ou le découpage.

- **Le crayon est visible en permanence**, à l'inverse de celui de
  `SectionHeader`. La règle qui l'y efface tient au nombre — un crayon par
  journée, tous affichés, feraient de la grille un formulaire. Ici il n'y en a
  qu'un pour tout l'album : le cacher ne gagnerait rien et le rendrait
  introuvable. Sans description, c'est « + Décrire cet album » qui prend sa
  place, faute de texte à survoler.
- **L'éditeur s'ouvre en surimpression**, comme celui d'une journée, et pour une
  raison de plus ici : le pousser dans le flux décalerait toute la grille vers
  le bas, or `useGridLayout` ne remesure `offsetTop` que sur redimensionnement —
  un simple glissement vertical lui échapperait.
- **Le texte n'a pas de borne de largeur, l'éditeur en garde une.** La
  description coiffe la grille et prend sa largeur : bornée à la mesure
  typographique habituelle, elle laissait sur un grand écran deux tiers de la
  ligne vides au-dessus d'une grille qui, elle, va jusqu'au bord. L'éditeur est
  un formulaire, pas un texte à lire : un champ de saisie large de deux mille
  pixels ne se relit pas, il reste donc en `max-w-prose`.
- **La longueur est bornée par `ALBUM_DESCRIPTION_MAX_LENGTH`**, exporté par
  `@gdv/shared` et appliqué des deux côtés. Le serveur la bornait déjà, mais par
  un littéral que le front aurait redéclaré de son côté.

Sur `AlbumsPage`, la description est clampée à deux lignes sous le titre : la
carte ne peut pas changer de hauteur selon l'album sans trouer la grille.

`Thumb` choisit la variante par `pickThumbSize(displayWidth)` : la plus petite
des tailles 320/640/1280 qui couvre la largeur d'affichage multipliée par le DPR
(plafonné à 2). Demander systématiquement du 1280 saturerait la bande passante
sur une grille de 200 vignettes. Les vignettes du premier écran sont en
`loading="eager"`, le reste en `lazy`.

L'`<img>` s'affiche dès que `item.hasPreview`, vidéos comprises : leur aperçu
vient de Drive ([D92](./08-decisions/D92-l-apercu-d-une-video-vient-de-drive-pas-d-un-decodage-local.md)). Le badge de lecture se pose alors
**par-dessus** l'image — disque `bg-black/45`, triangle blanc, centré — parce
que c'est lui qui distingue une vidéo d'une photo au premier coup d'œil et qu'il
doit rester lisible sur un aperçu clair. Sans aperçu, ou après les réessais, la
tuile sobre reste. La durée est affichée dans les deux cas.

## Navigation clavier

Deux gestionnaires distincts, jamais actifs ensemble : celui de la grille se
désactive quand la visionneuse ou l'aide sont ouvertes.

| Contexte    | Touche          | Effet                                                                   |
| ----------- | --------------- | ----------------------------------------------------------------------- |
| Albums      | `/`             | Focalise la recherche de la barre supérieure                            |
| Recherche   | `↑ ↓` `Entrée`  | Parcourt les suggestions · ouvre celle en évidence                      |
| Recherche   | `Échap`         | Referme la liste, puis vide le champ                                    |
| Grille      | `← ↑ ↓ →`       | `moveSelection` sur le layout réel                                      |
| Grille      | `Début` / `Fin` | Premier / dernier média                                                 |
| Grille      | `Entrée`        | Ouvrir la visionneuse                                                   |
| Grille      | `Échap`         | Revenir à la liste des albums                                           |
| Visionneuse | `← →`           | Média précédent / suivant                                               |
| Visionneuse | `Début` / `Fin` | Premier / dernier                                                       |
| Visionneuse | `Échap`         | Défait une couche à la fois : éditeur, zoom, panneau, puis fermeture    |
| Visionneuse | `I` `C`         | Ouvre le panneau sur l'onglet Infos · Commentaires (referme si déjà là) |
| Visionneuse | `F` `D`         | Plein écran · télécharger l'original                                    |
| Visionneuse | `Z`             | Zoom à 100 % (un pixel du rendu disponible = un pixel d'écran)          |
| Visionneuse | `L`             | Masque ou rappelle le bandeau de légende (préférence retenue)           |
| Visionneuse | `H`             | Escamote tout l'habillage : rien que la photo                           |
| Visionneuse | `Espace`        | Lecture / pause vidéo (sinon la page défilerait)                        |
| Partout     | `?`             | Aide-mémoire des raccourcis                                             |

À la souris dans la visionneuse : molette pour un zoom progressif centré sur le
curseur, **clic bref** pour basculer au niveau natif à l'endroit visé — et pour
en revenir —, glisser pour se déplacer dans l'image agrandie. « Bref » veut dire
moins de `TAP_SLOP_PX` (5 px) de déplacement entre l'appui et le relâchement :
au-delà, c'est un glisser, et il ne bascule rien. Voir la section Zoom.

**Au doigt** (`lib/useSwipe.ts` et `lib/swipeTrack.ts`) : la colonne photo est un
**rail** de trois médias — la précédente, la courante, la suivante — que le doigt
déplace au pixel près, et qui rejoint sa place au relâchement.

Le balayage existait avant le rail, mais **rien ne le montrait** : l'écran
restait immobile pendant tout le geste et la photo changeait d'un coup, une fois
le doigt levé. Un geste qu'on ne voit pas ne se découvre pas, et ne se reprend
pas non plus. C'est le mouvement du rail, et lui seul, qui enseigne le geste
([D260809e](./08-decisions/D260809e-la-photo-suit-le-doigt-c-est-le-mouvement-qui-apprend-le.md)).

- **Tactile et stylet seulement.** À la souris, le clic sert déjà à zoomer ;
  y ajouter un changement de photo rendrait le clic imprévisible selon qu'on a
  bougé de trois pixels ou non.
- **Le sens se décide une fois**, au dixième pixel parcouru et selon le même
  rapport 1,5 qu'avant : sans lui, un défilement vertical un peu oblique — le
  geste le plus courant sur un téléphone — ferait sauter une photo. En deçà de
  ces dix pixels, rien ne bouge. Au-delà, le geste ne change plus de nature,
  même s'il s'incurve.
- **Deux façons de valider**, parce qu'il y a deux gestes : traverser 22 % de la
  largeur (`COMMIT_FRACTION`), ou lancer le rail à plus de 0,35 px/ms
  (`FLICK_VELOCITY`) sans regarder. N'en retenir qu'une rendrait l'autre
  inopérante.
- **La remise en place dure ce que le geste appelle** — 160 à 320 ms selon ce
  qu'il reste à parcourir et la vitesse du doigt. Une durée fixe s'englue après
  un lancer sec et part d'un coup après un glissement lent presque abouti.
- **Le bord se sent** : au premier et au dernier média, le rail ne rend que 35 %
  du geste au lieu de l'ignorer.
- **Désactivé pendant le zoom et sur les vidéos**, où le doigt sert
  respectivement à se déplacer dans l'image et à atteindre les contrôles natifs
  de lecture.

Deux points d'implémentation, tous deux visibles si on les prend à l'envers :

- **La photo ne change qu'une fois le rail arrivé.** La demander plus tôt
  remonterait `ZoomableImage` au milieu de l'animation, sur une photo qui n'est
  pas encore celle que l'écran montre.
- **Le rail ne revient à zéro qu'au changement d'index**, dans un
  `useLayoutEffect`. La visionneuse ne décide pas de son index, elle le demande
  et il lui revient par l'URL : entre les deux, le rail reste là où l'animation
  l'a laissé — sur la voisine, déjà à l'écran.

Les voisines sont montées à la reconnaissance du balayage et démontées avec lui,
et n'ajoutent **aucune requête** : le préchargement décrit plus bas a déjà mis
leur rendu `full` en cache navigateur. Elles sont `aria-hidden` et sans
gestionnaire — la vraie photo les remplace dans l'instant, avec son zoom et son
panneau. Le rail est le seul à bouger : flèches, en-tête et bandeau de légende
restent immobiles, sans quoi c'est la visionneuse entière qu'on croirait faire
glisser.

Les touches ←/→ et les flèches de l'écran, elles, ne l'empruntent pas : une
visionneuse au clavier se parcourt vite, et 250 ms d'animation par photo
mettraient une barrière entre deux pressions.

#### Aucun geste au doigt n'aboutit sans `touch-action`

La colonne photo de la visionneuse porte `touch-pinch-zoom`, et c'est ce qui
rend possibles ses deux gestes : le balayage d'une photo à l'autre, et le
déplacement dans une photo agrandie. Avec la valeur par défaut `auto`, le
navigateur garde le droit de lire un glissement d'un doigt comme un défilement ;
il tranche en ce sens au bout d'un ou deux `pointermove`, émet `pointercancel`,
et les gestionnaires abandonnent le geste. Le balayage n'atteignait alors jamais
son `pointerup`, et la photo agrandie s'arrêtait après une vingtaine de pixels —
ce qui se ressent comme une lenteur, pas comme une interruption.
`setPointerCapture` ne protège pas de ça : il garantit de recevoir la suite des
événements, il n'empêche pas le navigateur d'annuler le geste.

`pinch-zoom` plutôt que `none` : il ne retire que le défilement à un doigt et
laisse le pincement à deux doigts, dont la visionneuse a besoin (voir la section
Zoom). La déclaration vit sur la colonne, pas sur le conteneur de
`ZoomableImage` : la règle est la même pour tout ce qui s'y trouve, et un
descendant en hérite par intersection — le repère de position n'a donc rien à
déclarer. Une vidéo en est exclue, ses contrôles natifs de lecture ayant leur
propre traitement du toucher (D77).

`moveSelection` (`useGridLayout.ts`) est le point délicat : les déplacements
verticaux suivent les **lignes réelles** du layout, dont le nombre de vignettes
varie, et visent la photo dont le centre horizontal est le plus proche. Un
décalage d'index fixe ferait dériver le curseur vers la gauche à chaque ligne.

Elle travaille **entièrement dans l'espace des cellules placées**, jamais dans
celui des index de la liste d'origine — y compris `gauche`, `droite`, `Début` et
`Fin`, qui valaient autrefois un simple `± 1`. Les deux espaces coïncidaient
tant que la grille montrait tout ; une section repliée les sépare, et un
`currentIndex + 1` enverrait la sélection sur une vignette absente du layout :
plus rien à mettre en évidence, et `scrollSelectionIntoView` sans cible (D68).
Une sélection introuvable — la journée qu'on vient de replier sous le curseur —
repart de la première vignette encore visible.

`scrollSelectionIntoView` ne défile que si la cellule sort du viewport, avec une
marge de 24 px, et respecte `prefers-reduced-motion`.

Les vignettes sont `tabIndex={-1}` : la navigation se fait aux flèches, les
inclure dans l'ordre de tabulation doublerait le parcours clavier.

**Aucune de ces touches ne part pendant une saisie**, ni lorsqu'un modificateur
est enfoncé. Le test tient dans `lib/typing.ts` — `input`, `textarea`, `select`,
`contenteditable` — et les trois gestionnaires l'appellent : la grille, la
visionneuse, et `useShortcut` pour le `?`. Il y vit parce qu'ils en avaient
chacun leur copie, et qu'une seule suffisait à diverger : celle de la
grille ne connaissait que `input`, si bien que les flèches, `Début` et `Fin`
déplaçaient la sélection au lieu du curseur dès qu'on éditait la description d'un
album ou la note d'une journée — deux textes saisis dans un `textarea`, donc
inéditables au clavier. La visionneuse garde une exception, et une seule :
`Échap` lui parvient même depuis le champ de commentaire, c'est la sortie de
secours.

## Visionneuse — `components/Lightbox.tsx`

- **L'en-tête situe, le bandeau bas raconte.** En haut : l'album et la journée
  sur une ligne, le lieu sur la suivante — ce qui place l'image. En bas, dans
  `MediaCaption` : les textes écrits à la main. L'horodatage exact reste, lui,
  dans le panneau `i`, où il vivait déjà.

  **Le nom du fichier a quitté cette place** ([D88](./08-decisions/D88-la-photo-ouverte-dit-d-ou-elle-vient-et-s-en-debarrasse-d.md)). Il
  l'occupait en tête, en gras, alors que `IMG_0004.jpg` ne dit ni où, ni quand,
  ni quoi — et il masquait l'album, seule information qui manque vraiment quand
  on arrive par un lien partagé. Il n'est pas perdu : `SidePanel` le porte en
  tête du panneau `i`, auprès des données techniques qu'il accompagne. C'est le
  **titre d'album** qui se tronque quand la ligne est trop courte, jamais la
  date : elle est brève et bornée, et c'est elle qu'un « Allemagne – Forêt
  Noire · Aujo… » sacrifierait.

  Les libellés de journée viennent de `dayKey`, `dayLabel` et `placeLabelOf`,
  **les mêmes fonctions que la grille**. Une visionneuse qui calculerait sa date
  de son côté finirait par annoncer autre chose que l'en-tête d'où l'on vient de
  cliquer. `AlbumPage` active donc `useAlbumDays` dès qu'une photo est ouverte,
  et plus seulement en découpage par jour ; la `queryKey` étant la même, un
  album déjà par jour ne relance aucune requête.

  Tout se cale sur la **première ligne** : le retrait haut du bloc de texte
  (6 px sous `sm`, 8 px au-delà) est celui qui amène sa ligne au centre des
  boutons d'icône, hauts de 32 puis 36 px.

  **La note du jour a quitté cet en-tête**, où elle vivait en `hidden md:block`.
  D70 l'y avait réservée aux écrans larges, et l'arbitrage se tenait : deux
  lignes de plus **empilées au-dessus de l'image**, sur un téléphone où la photo
  est déjà à l'étroit. Ce n'est plus la question posée — une légende sous la
  photo ne rogne pas le cadrage de la même façon, et elle est masquable d'un
  geste. La note descend donc dans le bandeau, à toutes les largeurs, avec les
  autres textes (D84). L'en-tête ne garde que ce qui situe.

  **`h` escamote tout l'habillage** — en-tête, flèches et bandeau — pour ne
  laisser que la photo ([D88](./08-decisions/D88-la-photo-ouverte-dit-d-ou-elle-vient-et-s-en-debarrasse-d.md)). Le raccourci ne double pas le
  `L` de la légende : `L` range le texte du bas et laisse le bouton qui le
  rappelle, `h` ne laisse rien. Les touches ←/→ et le balayage continuent de
  fonctionner : on escamote ce qui se voit, pas ce qui se pilote. Un unique
  bouton reste au coin haut-droit, seule sortie possible pour qui touche
  l'écran. L'état n'est pas retenu d'une visite à l'autre, contrairement au
  masquage de la légende — rouvrir la visionneuse sans un seul repère laisserait
  qui a oublié le raccourci devant un écran muet.

- **La progression est une barre collée au bord haut**, sur toute la largeur et
  épaisse de 2 px — une barre de chargement, pas un élément de mise en page.
  Plus bas, elle traversait la photo d'un trait de couleur.

  **Le rapport chiffré est juste dessous, centré, en 11 px**, et non plus à
  l'autre bout de la rangée du titre. Deux façons de dire la même chose
  logeaient aux deux extrémités de l'écran : le trait donnait la position sans
  dire de combien, le chiffre le compte sans dire où. Réunis, chacun lit
  l'autre, et la rangée rend au titre la largeur qu'un « 900 / 900 » lui prenait
  en permanence — sur un écran de 393 px, c'est ce qui fait tenir
  « Allemagne – Forêt Noire · 4 août 2026 » en entier.

  Il est **hors du flux** (`absolute`, `top-1`), et c'est ce qui rend le
  déplacement gratuit : dans le flux, ses quinze pixels rallongeaient d'autant
  un en-tête posé sur la photo — soit exactement ce qu'on venait de lui faire
  rendre. Il tient dans la bande que le dégradé occupait déjà sans rien y
  mettre, entre le trait et la première ligne de titre : en-tête à 102 px sur
  desktop et 92 px sur mobile, les mêmes qu'avant. `pointer-events-none`, sans
  quoi il capterait un clic destiné au titre qu'il recouvre.

  Il porte `aria-hidden` : la barre déclare déjà `aria-valuenow` et
  `aria-valuemax`, et un lecteur d'écran annoncerait deux fois la même chose à
  deux mots d'intervalle.

  Elle est comptée sur `album.itemCount` et non sur la liste paginée, qui
  grandit en cours de parcours (D69).

- Gèle `document.body.style.overflow` à l'ouverture, sinon la molette ferait
  défiler la grille sous l'image.
- Prend le focus à l'ouverture et le **rend à l'élément précédent** à la
  fermeture.
- Vidéos : `<video controls autoPlay playsInline>`, seek natif par `Range`, et
  `poster` sur la vignette 1280 quand `item.hasPreview` — celle de la grille,
  donc déjà en cache disque et souvent en cache navigateur : le rectangle noir
  de l'attente disparaît sans une requête de plus (D92).
  L'attente n'a **pas** d'indicateur propre : le `poster` l'occupe, et les
  contrôles natifs portent déjà le leur — en superposer un second en faisait
  tourner deux, l'un sur l'autre ([D98](./08-decisions/D98-un-decodage-qui-echoue-sans-erreur-et-un-tourniquet-de-trop.md)). L'échec, lui,
  remplace la balise par un message et un bouton de téléchargement : le fichier
  reste lisible ailleurs même quand ce navigateur n'en décode pas le codec
  ([D79](./08-decisions/D79-une-video-illisible-le-dit-et-se-laisse-telecharger-au-lieu.md)). Il se constate de deux façons — `error`, et un
  `videoWidth` nul sur `loadeddata` ou `playing`, qui est la seule trace d'un
  décodage à moitié réussi (D98). Photos :
  `ZoomableImage`, remonté à chaque photo (`key={item.id}`) pour réinitialiser
  zoom et cadrage sans les remettre à zéro à la main.
- **La source de la vidéo est choisie par le client** — `lib/videoSource.ts`,
  fonction pure et testée à côté de `preview.ts`, et pour la même raison : une
  règle d'une ligne dont l'erreur ne se voit pas. `chooseVideoSource` interroge
  `canPlayType` sur le **codec réel** de la piste image, `video/mp4;
codecs="hvc1"`, et non sur le type nu, auquel tout le monde répond `maybe`
  (D98). Réponse vide : la balise pointe sur `/playable`, la version H.264 que
  le serveur a préparée (D260809b). Sinon — y compris quand le codec est inconnu —
  elle garde `/original`, en pleine qualité : c'est ce qui fait que Safari et un
  iPhone, qui décodent l'HEVC, ne voient jamais le transcodage. La détection de
  D98 reste le filet derrière ce choix, pour le navigateur qui annonce savoir
  lire un format sans y parvenir.
- **Le message d'échec gagne une phrase quand le codec est connu pour être
  illisible ici** : une version lisible est en préparation, et elle démarrera là
  sans rien demander. Sans elle, `/playable` en 404 donnerait le message de
  D79 — « le fichier reste téléchargeable » — à quelqu'un qui, dix minutes plus
  tard, aurait pu simplement la regarder.
- **Et la visionneuse la guette.** Tant que l'attente dure, elle redemande le
  premier octet de `/playable` toutes les vingt secondes (`Range: bytes=0-0`) ;
  à la première réponse servie, `failed` repasse à faux, la balise est remontée
  et son `autoPlay` enchaîne. Sans ce guet, le message resterait jusqu'à ce
  qu'on rouvre la photo — c'est-à-dire pour toujours du point de vue de qui est
  resté devant, et c'est précisément la personne qui voulait voir cette vidéo.

  Un octet en `Range` plutôt qu'un rechargement de la balise, qui clignoterait
  à chaque essai — poster, puis message — pour la même réponse. Le 404 se voit
  dans la console dans les deux cas, le navigateur journalisant toute requête
  refusée : c'est le seul bruit du guet. Vingt secondes parce qu'un transcodage
  dure des minutes et que la file est servie une vidéo à la fois — sonder plus
  souvent ne la ferait pas arriver plus tôt. Un sondage qui échoue ne change
  rien à l'écran : il n'y a rien de cassé, la vidéo n'est simplement pas encore
  prête.

  Le guet ne concerne que ce cas : une réponse **servie** est `immutable`, donc
  un navigateur qui a déjà obtenu la version ne redemande jamais rien.

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
- **Les flèches de navigation sont filles de la colonne, pas de la zone du
  média.** Leur `top-1/2` se calcule donc sur toute la hauteur de l'écran, la
  seule grandeur qui ne bouge pas d'un média à l'autre. Filles de la zone du
  média, elles suivaient sa hauteur, et celle-ci varie : le bandeau de légende
  entre dans le flux sur une vidéo (`overlay={false}`) et lui prend d'autant,
  puis grandit encore lorsqu'il porte une description ou une note de journée, et
  rétrécit au pli de `l`. Les flèches remontaient de quelques dizaines de pixels
  — mesuré : 428 px sur une photo, 388 px sur une vidéo légendée, 404 px la
  légende repliée, sur un écran de 856 px — si bien qu'il fallait repointer la
  souris d'un média au suivant. Le point à retenir : **tout ce qui doit rester
  sous le curseur d'un média à l'autre se positionne sur la colonne**, dont la
  hauteur est celle de l'écran ; la zone du média, elle, est un `flex-1` que ses
  voisins de flux font respirer.
- **La visionneuse est une rangée, pas une colonne.** La photo occupe une colonne
  `flex-1 min-w-0`, le panneau latéral la suivante à partir de `md`. `min-w-0`
  n'est pas décoratif : sans lui, l'image impose sa largeur et c'est le panneau
  qui déborde de l'écran. L'en-tête vit **dans** la colonne photo, sinon il
  passerait sous le panneau.
- **Les deux lignes de l'en-tête sont tronquées, et le rang passe devant la
  date.** La ligne de date, seule à ne pas porter `truncate`, s'enroulait sur
  trois lignes et l'en-tête montait à 92 px — il recouvrait le haut de la photo
  qu'il annonce. `1 / 120` précède la date parce que c'est le repère utile quand
  on parcourt un album, et donc la date qui doit être rognée la première.
- **Définir comme couverture** n'apparaît que pour un administrateur, et jamais
  sur une vidéo : son aperçu appartient à Drive (D92) et peut manquer, or la
  couverture est la seule image dont l'absence se voit depuis la page d'accueil,
  sans repli. C'est la seule action sans raccourci clavier — on la fait une fois par
  album, et l'aide-mémoire `?` s'adresse à tout le monde. Elle s'allume quand la
  photo ouverte est déjà la couverture ; la resélectionner n'est pas un clic
  perdu : elle l'était peut-être par défaut, et cela la fixe. Le retour à
  l'automatique est un bouton de `/admin`, seul endroit qui distingue les deux
  cas (D80). Un refus — session expirée, rôle retiré entre-temps — s'affiche en
  bas de la photo : sans ce message, rien ne distinguerait l'échec de l'absence
  de clic. Il part au changement de photo.
- **Sous `sm`, les actions passent dans un `ActionMenu`** — Informations,
  Zoomer, Télécharger, Plein écran, et la couverture pour un administrateur —
  avec leurs libellés en clair et sans le rappel du raccourci clavier, qui n'a
  pas de sens au toucher. À partir de `sm`
  elles s'alignent toutes dans la barre. Comme pour la `TopBar`, elles sont
  **décrites une fois** (libellé, raccourci, icône, état actif) et rendues des
  deux façons : dupliquées, une icône ou un état finirait par se désaccorder
  entre la barre et le menu.
- **`Commentaires` reste en ligne à toutes les largeurs.** Son icône porte la
  pastille des non-lus, seul signe qu'une photo a été commentée ; rangée dans le
  menu, elle ne signalerait plus rien. Conséquence assumée : sur grand écran,
  elle passe **devant** `Informations` au lieu de la suivre — la seule action à
  position fixe est celle qui doit rester repérable.
- Mesuré après : en-tête à 60 px au lieu de 92, bloc titre à 235 px au lieu de
  73, et `1 / 120 · 7 août 2026 à 17:21` affiché **en entier** sur un écran de
  393 px.
- **Le panneau Infos s'ouvre sur la journée**, avant l'EXIF : « Lieu » puis
  « Ce jour-là ». `place` prime sur `autoPlaces`, comme partout ailleurs
  ([D51](./08-decisions/D51-le-lieu-se-corrige-a-la-journee-jamais-a-la-photo.md)).

  Ces deux lignes sont désormais une **redite** du bandeau, et elles restent :
  ce sont les seules à rendre le texte **entier** sans dépliement, et les
  supprimer ferait perdre l'accès à la note depuis un panneau déjà ouvert. Ce
  qui a changé, c'est leur statut — elles étaient le recours de D70 sous `md`,
  elles sont maintenant un confort.

  `useAlbumDays` est appelé dès que la grille est par jour **ou** que la
  visionneuse est ouverte (`groupBy === 'day' || isOpen`) : la note doit être là
  quelle que soit la façon dont on est arrivé sur la photo, sans payer la
  requête pour une grille par mois qu'on se contente de faire défiler.

- **`goTo` ignore l'index déjà affiché.** `Début` sur le premier média, `Fin` sur
  le dernier, une flèche à une extrémité : la cible est l'index courant, aucun
  élément n'est remonté, donc aucun événement de lecture n'est émis. Remettre
  `failed` à `false` dans ce cas effacerait le message d'une vidéo illisible
  sans que rien ne le remplace.
- **Un clic dans la zone photo referme le panneau ouvert**, comme n'importe quel
  tiroir. Le gestionnaire est posé en **capture** et non en bulle : le zoom se
  décide au relâchement du pointeur dans `ZoomableImage`, plus bas dans l'arbre,
  et en bulle les deux gestes partiraient ensemble — le panneau se fermerait _et_
  la photo zoomerait. Interrompre à la descente laisse le premier clic à la
  fermeture, le suivant zoome normalement.

  Les `button` de cette zone sont **exclus** : agir sur le média — télécharger
  une vidéo illisible, ressortir de l'habillage escamoté — n'est pas un « dehors »,
  et le panneau se refermerait sous un clic qui ne le visait pas. Les flèches de
  navigation, elles, ne dépendent plus de cette exclusion depuis qu'elles ont
  quitté la zone du média pour la colonne : le gestionnaire ne les voit plus
  passer. Le repère de position du zoom (`role="img"`) est exclu de même : une
  capture s'exécutant avant sa cible, son `stopPropagation` ne peut pas le
  protéger.

  **Le balayage tactile est avalé de la même façon**, et c'est une conséquence
  qu'il faut connaître : `useSwipe` pose son `onPointerDown` en phase bulle sur
  ce même nœud, or un `stopPropagation()` émis en capture interrompt toute la
  file de dispatch, gestionnaires de bulle du même élément compris. Sur une
  tablette au-delà de `md`, panneau ouvert, le premier balayage referme donc le
  panneau sans changer de photo ; le suivant navigue. C'est cohérent avec « le
  premier geste ferme, le suivant agit », mais ce n'est pas gratuit.

  Sous `md` la question ne se pose pas — le panneau occupe tout l'écran, il n'y a
  pas de dehors.

### Bandeau de légende — `components/MediaCaption.tsx` et `lib/caption.ts`

Les textes écrits à la main, rassemblés en bas de la colonne photo, à **toutes**
les largeurs. Ce qui explique une image se lisait ailleurs qu'elle — la note du
jour dans l'en-tête de sa section, et rien du tout sur la photo elle-même :
ouvrir une image faisait perdre l'essentiel de ce qui l'explique (D84).

| Ligne   | Préfixe      | Style                 | Lignes visibles |
| ------- | ------------ | --------------------- | --------------- |
| Photo   | —            | `text-sm` · `ink-100` | 3               |
| Journée | `Ce jour-là` | `text-xs` · `ink-300` | 2               |

La hiérarchie est portée par la couleur et le clampage, sans aucun titre : plus
la portée est large, plus la ligne s'efface. La ligne de la photo est la seule
sans préfixe — celle du dessous parle d'autre chose que de l'image qu'on
regarde, et sans ce mot « Bonifacio, la plage » se lirait comme sa légende.

**La description de l'album n'est pas une troisième ligne**
([D89](./08-decisions/D89-la-description-de-l-album-quitte-la-legende-on-l-a-lue-en.md)). Elle l'a été, et elle coûtait une ligne de bandeau
sur chacune des neuf cents photos d'un album pour un texte lu une fois, en
ouvrant la grille — identique d'une photo à l'autre, donc invisible à force
d'être là. Ce que la visionneuse doit à l'album, c'est de dire **lequel**, pas
de le raconter : son titre est dans l'en-tête (D88), et la description reste où
on la lit, en tête de grille.

`captionEntries` (`lib/caption.ts`) décide quelles lignes exister : logique pure,
donc testable sans DOM, et c'est la seule partie qui ait des cas — texte absent,
texte blanc, tout vide, ordre des portées (`packages/web/test/caption.test.ts`).

Ce qu'il faut savoir du composant :

- **Le dégradé est celui de l'en-tête, retourné**
  (`from-black/85 via-black/55 to-transparent`), et les marges latérales
  tiennent compte de `env(safe-area-inset-*)` : en paysage, l'encoche mord sur
  ce bord-là aussi. Elles sont posées sur le contenu et non sur l'enveloppe,
  pour que le dégradé aille jusqu'au bord de l'écran.
- **Un clic sur le texte déplie** (`line-clamp-none`, `max-h-[50vh]` et
  défilement propre), avec `aria-expanded`. Le dépliement **n'est pas**
  persisté : il répond à un texte précis, pas au suivant — la visionneuse
  remonte le composant à chaque photo (`key`), ce qui le remet à plat.
- **Le chevron masque tout le bandeau**, et cette préférence-là **est** retenue
  (`localStorage`, `useCaptionHidden`) : c'est un choix sur la façon de regarder
  ses photos, qu'on ne veut pas refaire à chaque ouverture. Masqué, un bouton
  fantôme « Afficher la légende (l) » reste en bas à droite — un état caché sans
  porte de sortie est un piège. La touche `L` fait la même chose au clavier.
- **Le crayon et le « + Décrire cette photo » sont réservés à l'administrateur**,
  avec les affordances d'`AlbumDescription` : éditeur en surimpression,
  `z-20`, compteur de caractères, Annuler / Enregistrer. Deux façons de corriger
  un texte dans la même application se remarqueraient tout de suite.
- **Le bandeau est masqué pendant le zoom**, comme les flèches de navigation :
  le doigt y sert à se déplacer dans l'image.
- **Sur une vidéo, il pousse au lieu de recouvrir** (`overlay={false}`, donc dans
  le flux). C'est le seul endroit où il le fait : les contrôles natifs de
  lecture vivent au bas de la balise, et sur une vidéo portrait qui remplit
  l'écran, un bandeau posé dessus rendrait play/pause et la barre de progression
  intouchables.
- **L'ouverture de l'éditeur est pilotée par `Lightbox`**, pas par le composant :
  c'est la visionneuse qui écoute `Échap`, et cette touche doit refermer le champ
  **avant** le zoom, le panneau et la fermeture. Sans cette couche, `Échap`
  depuis la saisie fermerait la visionneuse par-dessus un texte non enregistré.
- L'alerte d'échec de couverture est remontée de `bottom-6` à `bottom-28` :
  posée plus bas, elle passait sous le bandeau qu'elle doit interrompre.

`useUpdateMedia` (`api/hooks.ts`) **corrige le cache au lieu de l'invalider** :
`setQueriesData` sur le préfixe `['items', albumId]` remplace l'item dans les
pages des **deux** sens de tri, et `setQueryData` met à jour le détail. Invalider
relancerait toutes les pages accumulées de la requête infinie — après cinq pages
de défilement, écrire une légende redemanderait mille lignes (la leçon de D67).

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
que de la base est motivé en [D55](./08-decisions/D55-le-repere-de-lecture-vit-dans-le-navigateur-pas-en-base.md).

Trois bords que le calcul doit tenir :

- `unreadCount` a un **plancher à zéro**. Une suppression ou un masquage fait
  retomber le total sous le repère, et un « -2 » s'afficherait tel quel.
- Le repère **redescend** quand le total passe sous lui, sans quoi le message
  suivant resterait invisible tant qu'il n'aurait pas comblé l'écart.
- Rien n'est marqué tant que les compteurs ne sont pas chargés : marquer à ce
  moment effacerait le repère pour le reconstituer faux à l'arrivée des vrais
  totaux.

**Le fil d'activité a son propre repère**, `gdv:comments-feed-seen`, et c'est un
**identifiant** de commentaire, pas un compte. Le fil est paginé et sans total :
compter ce qu'on a lu supposerait de le parcourir en entier, alors
qu'`AUTOINCREMENT` fait de l'id un jalon exact — tout ce qui le dépasse est
arrivé depuis, quels que soient les messages supprimés entre-temps. Les trois
bords ci-dessus valent à l'identique : `unreadFeedCount` ne compte que ce qui
dépasse le repère, le repère redescend si la tête du fil passe sous lui, et rien
n'est marqué avant l'arrivée de la première page.

Un seul repère pour toutes les portées, la globale : ouvrir le tiroir filtré sur
« Vacances » ne doit pas éteindre une pastille qui annonçait aussi des messages
sur « Corse ». Le tiroir ouvert vaut lecture, comme le panneau ouvert d'une
photo.

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

Au doigt, ce départage suppose que le geste aille jusqu'à son `pointerup` : c'est
le `touch-action` de la colonne photo qui le garantit, décrit plus haut avec le
balayage. Sans lui, le déplacement d'une photo agrandie meurt en route.

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

**La vidéo n'y passe pas.** Elle n'a que deux états — lue, ou illisible — et son
attente appartient au navigateur : le `poster` l'occupe, les contrôles natifs
l'annoncent. Elle est passée un temps par `previewOverlay` avec
`measured: false`, ce qui posait un second tourniquet par-dessus celui des
contrôles ([D98](./08-decisions/D98-un-decodage-qui-echoue-sans-erreur-et-un-tourniquet-de-trop.md)). Ce qu'elle en garde est l'invariant même :
une attente doit se terminer sur une image ou sur un message
([D79](./08-decisions/D79-une-video-illisible-le-dit-et-se-laisse-telecharger-au-lieu.md)).

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

| Rubrique     | URL                   | Contenu                                                 |
| ------------ | --------------------- | ------------------------------------------------------- |
| Albums       | `/admin/albums`       | `AlbumsSection`                                         |
| Comptes      | `/admin/comptes`      | `UsersSection`                                          |
| Commentaires | `/admin/commentaires` | `CommentsSection`                                       |
| Serveur      | `/admin/serveur`      | `DriveSection`, `SettingsSection`, `MaintenanceSection` |

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

| Composant                     | Rôle                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `AdminNav`                    | Navigation entre les quatre rubriques, en `NavLink`                                                                         |
| `DriveSection`                | État de la connexion OAuth, consentement, déconnexion                                                                       |
| `UsersSection` / `UserForm`   | Liste des comptes, création, modification, suppression confirmée                                                            |
| `AlbumsSection` / `AlbumForm` | Liste des albums, état de synchronisation, découpage par défaut, retour à la couverture automatique, création, modification |
| `SettingsSection`             | Intervalle de synchronisation, synchronisation au démarrage, cache                                                          |
| `MaintenanceSection`          | Occupation du cache et purge                                                                                                |
| `AlbumAccessPicker`           | Attribution des albums à un compte (voir plus bas)                                                                          |
| `ConfirmDialog`               | Confirmation nommée, en remplacement de `window.confirm`                                                                    |
| `ui.tsx`                      | Primitives partagées : bouton, champ, case à cocher, encadré de section, géométrie des lignes                               |

Chaque section porte ses propres mutations, et `ui.tsx` existe pour que les
formulaires ne réinventent ni les classes ni le lien `label` /
`aria-describedby`.

### Une ligne s'empile plutôt que de tronquer ce qui la nomme

La page est bornée à **`max-w-[90rem]`**, et non aux 64 rem d'origine : celles-ci
laissaient 760 px de contenu sur un écran de 1495 px, le reste étant pris par la
colonne de navigation et deux marges vides d'un tiers de fenêtre.

Toute ligne d'administration — album, compte, état du Drive, occupation du
cache, commentaire à modérer — se compose des deux mêmes blocs : ce qui décrit,
et ce qui agit. `ROW_CLASS` et `ROW_ACTIONS_CLASS` (`ui.tsx`) en tiennent la
géométrie unique : **empilée sous `xl`, en rangée au-delà** ([D95](./08-decisions/D95-l-administration-s-empile-plutot-que-de-tronquer-ce-qui-la.md)).
Côte à côte, seul le bloc descriptif peut se rétracter — les boutons portent
`whitespace-nowrap` — et il tombait à deux caractères suivis d'une ellipse.

Le seuil est `xl` et non `sm` parce que la place manque bien au-delà du
téléphone : `AdminNav` prend sa colonne de 12 rem dès `md`, ce qui fait de la
bande 768–1280 px celle où une rangée à quatre boutons rogne le plus le titre.
L'alignement vertical, lui, reste à chaque appelant — une ligne de liste centre
ses deux blocs, un commentaire de plusieurs lignes garde son bouton en haut —
parce que deux classes d'alignement concurrentes dans la même chaîne se
départageraient sur l'ordre de la feuille de style et non sur celui du code.

Deux corollaires, dans la file de modération : le sélecteur d'album porte
`min-w-0` (un `select` réclame sinon la largeur de sa plus longue option, et
débordait du cadre de sa section), et le champ de recherche porte `basis-64`
pour descendre d'une ligne quand la place manque au lieu de se réduire aux
trente pixels que `flex-1` lui laissait.

**Le bouton « Couverture automatique » d'une ligne d'album est son propre
indicateur** : il n'apparaît que si une photo a été choisie. La ligne de
métadonnées au-dessus aurait pu le dire, mais elle porte `truncate` et une
rangée à cinq boutons la réduit à quelques caractères dès que la fenêtre se
resserre — un indicateur qu'on ne voit pas n'en est pas un. Le `title` lève
l'ambiguïté du libellé, qui décrit l'état visé et non l'état courant.

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

**L'en-tête porte le nom du fichier**, seul endroit où il s'affiche : il vaut
pour les deux onglets, et le répéter dans les lignes d'`ExifPanel` en ferait un
doublon à deux centimètres de lui-même. Le bouton de fermeture annule dans le
flux (`-my-1 -mr-1`) le rembourrage qui agrandit sa cible de clic, sans le
retirer de la cible : la croix retombe alors sur la ligne du nom et sur la marge
droite de la colonne de contenu. Elle était sinon 4 px plus bas et 4 px plus à
droite que tout le reste — un décalage qu'on ne sait pas nommer en regardant.

**Le panneau est en `ink-850`, un cran au-dessus du fond.** La visionneuse est
en `ink-950` ; en `ink-900`, le panneau ouvert ne se distinguait pas d'elle —
seule sa bordure le trahissait, et on ne savait plus où l'on était. Trois
conséquences dans ce qu'il contient, sans quoi le changement en aurait effacé
une partie : les séparateurs d'`ExifPanel` et de `CommentsPanel` passent en
`ink-800`, désormais **plus clairs** que leur fond ; et les champs de saisie de
`CommentsPanel` et d'`IdentityForm` passent en `ink-900`, plus sombres que le
panneau, pour continuer de se lire comme des creux. Un champ de la couleur
exacte de son panneau n'est plus un champ.

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

### Infos — `components/ExifPanel.tsx` et `lib/exifRows.ts`

Une liste de couples libellé / valeur, dans un ordre qui va du plus humain au
plus technique : « Lieu » et « Ce jour-là », puis la date, les dimensions, la
taille, la durée, l'appareil et les réglages de prise de vue, enfin la position.
Une ligne sans valeur n'existe pas — un panneau plein de tirets sur une capture
d'écran sans EXIF n'apprendrait rien.

**Sauf la position, dont l'absence se dit** : « Aucune donnée GPS », en `ink-400`
comme tout ce qui constate plutôt qu'il n'informe. C'est la seule ligne dont on
se demande, en ne la voyant pas, si la photo n'a rien à donner ou si
l'application n'a pas fini son travail ([D94](./08-decisions/D94-une-photo-sans-position-le-dit-au-lieu-de-laisser-la-ligne.md)). Elle sort de
l'EXIF de la photo et ne doit rien au géocodage inverse : elle s'affiche que
« Lieu » ait un nom ou pas, et pointe vers OpenStreetMap. Réservée aux photos —
Drive ne rend de position que dans `imageMediaMetadata`, jamais pour une vidéo,
donc la ligne y vaudrait « aucune » sur la totalité des fichiers.

Le choix des lignes vit dans `lib/exifRows.ts` et non dans le composant, comme
`captionEntries` : c'est la seule partie du panneau qui ait des cas — présent,
absent, absent et dit — et elle se vérifie sans DOM (`test/exif-rows.test.ts`).

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

### Fil d'activité — `components/CommentsFeed.tsx`

**Une conversation ne se découvre pas.** La pastille d'une photo suppose qu'on
ait déjà ouvert la bonne, et sur un album de milliers de vues dont dix portent
un message, personne ne tombe dessus. Un message écrit sans lecteur est un
message perdu : le tiroir est le seul endroit d'où l'on voit qu'il a été écrit
(D86).

Un **tiroir** et non une page : la grille reste derrière, on referme et on est
encore au même endroit. Pleine largeur sous `sm`, colonne de 384 px au-delà —
384 px prélevés sur un écran de 393 ne laisseraient rien voir de la galerie, et
le tiroir vaudrait alors une page.

`useActivityFeed()` est ce que les deux pages de galerie branchent sur leur barre
supérieure : la pastille et l'ouverture. Il monte la requête de portée
**globale**, même depuis un album — la pastille répond à « y a-t-il du nouveau
quelque part », et la restreindre à l'album ouvert l'éteindrait en changeant de
page sans que rien n'ait été lu. Le tiroir s'ouvre donc lui aussi sur la portée
globale : ouvrir sur une liste plus étroite que ce que la pastille annonce ferait
chercher des messages absents. Dans un album, une bascule « Tous les albums /
`<titre>` » restreint après coup, et le rappel de l'album disparaît alors de
chaque bloc — il répète ce que la bascule affiche déjà.

Le rangement est celui de la modération, `lib/commentGroups.ts`, à une exception
près : **les messages d'un bloc se lisent du plus ancien au plus récent**, alors
que la liste des blocs reste antéchronologique. Ici on lit une conversation, et
la réponse au-dessus de la question se lit à l'envers. La place d'un bloc dans sa
journée, elle, se décide toujours sur son message le plus récent.

Chaque bloc renvoie vers `/album/:id?photo=<mediaId>&panel=comments` — la photo
**et** la conversation. Une vignette de 56 px ouvre le bloc : c'est elle qui fait
reconnaître le fil, bien avant le nom de fichier. Une photo retirée de l'index
n'en a plus et le bloc cesse d'être cliquable, le lien menant à une visionneuse
qui se refermerait aussitôt. Le corps est clampé à trois lignes : le tiroir est
un survol de ce qui s'est dit, la conversation entière s'ouvre sous la photo,
avec de quoi y répondre.

Un **bouton** « Messages plus anciens » plutôt qu'un défilement infini : on
vient voir ce qui vient d'arriver, pas remonter une archive, et un observateur
de défilement chargerait des pages sous un pouce qui ne fait que parcourir.

### Modération — `components/admin/CommentsSection.tsx` et `lib/commentGroups.ts`

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

`lib/commentGroups.ts` range la page **par journée, puis par photo**. Deux
répétitions disparaissent : la date, inutile sur chaque ligne quand vingt
messages se suivent le même jour, et le couple photo / album, réécrit à
l'identique sous chaque message d'un même fil. La journée est celle du lecteur
et **non UTC**, à l'inverse de la grille — la raison est plus bas, section
« Dates ». Le rangement ne porte que sur la page reçue : une photo dont les
commentaires enjambent une frontière de page apparaît des deux côtés.

`groupByDayAndPhoto` est **générique** sur le contexte album / photo : la file de
modération et le tiroir d'activité posent la même question — qu'est-ce qui a été
écrit, et où — et n'y répondent pas deux fois. Ce qui distingue `AdminComment`
de `FeedComment` — l'adresse de l'auteur, l'état de masquage — n'entre pas dans
le rangement, qui ne lit que l'album, la photo et la date.

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
  calendrier **local** du navigateur. Voir [D31](./08-decisions/D31-le-regroupement-de-la-grille-vit-dans-l-url-mais-aujourd-hui.md) — ce n'est pas
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

**`scrollbar-gutter: stable` sur `html`**, et c'est une correction, pas une
coquetterie : la visionneuse gèle `document.body.style.overflow` à l'ouverture,
donc la barre de défilement disparaît et toute la mise en page glisse de sa
largeur — en-tête compris — à chaque photo ouverte, puis revient à la fermeture.
Le même décalage se produit entre une page qui défile et une qui ne défile pas.
Réserver la gouttière fixe la largeur utile une fois pour toutes.

Le prix est une bande vide de 10 px — la largeur fixée par la règle
`::-webkit-scrollbar` — là où le système dessine ses barres en surimpression et
ne prenait rien. C'est le compromis assumé : un décalage à chaque photo ouverte
se remarque, dix pixels constants non.

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

`packages/web/public/` est recopié tel quel à la racine de `dist/` : le
manifeste, les icônes et le service worker y arrivent sans passer par Rollup,
donc **sans hash dans leur nom** — c'est indispensable, une URL de service
worker qui change à chaque build ne serait jamais reconnue comme la même. Le
`Dockerfile` copie `packages/web/dist` en entier, il n'a rien à savoir de tout
cela.

## Application installable

La visionneuse s'ajoute à l'écran d'accueil et s'ouvre sans barre d'adresse.
L'intérêt n'est pas technique : un proche retient une icône, pas une URL, et la
session dure déjà un an (`SESSION_TTL_MS`), si bien qu'ouvrir l'application ne
redemande rien. Trois pièces suffisent — un manifeste, des icônes, un service
worker.

### Le manifeste — `public/manifest.webmanifest`

`display: standalone`, `start_url` et `scope` à `/`. `background_color` et
`theme_color` valent `#0b0b0d`, c'est-à-dire `--color-ink-900` : l'écran de
démarrage prolonge le fond de l'application au lieu de clignoter en blanc avant
elle. Ces valeurs sont **reprises** de `styles.css`, pas choisies à part ; un
test les compare.

`index.html` déclare en plus ce qu'iOS ne lit pas dans le manifeste : le
`apple-touch-icon`, `apple-mobile-web-app-title`, et
`apple-mobile-web-app-status-bar-style: black`. **`black`, pas
`black-translucent`** — le second fait passer le contenu sous la barre d'état,
et l'en-tête de la visionneuse, posé en `absolute` tout en haut, s'y
retrouverait.

### Le nom de l'instance — `APP_NAME` et `shell.ts`

Le fichier statique porte `Photos`, et le serveur y substitue `APP_NAME` au
démarrage. Deux fichiers, quatre emplacements :

| Fichier                | Emplacement                  | Ce qu'il nomme                     |
| ---------------------- | ---------------------------- | ---------------------------------- |
| `index.html`           | `<title>`                    | L'onglet                           |
| `index.html`           | `apple-mobile-web-app-title` | L'icône d'accueil iOS              |
| `index.html`           | `application-name`           | Ce que le front relit (ci-dessous) |
| `manifest.webmanifest` | `name`, `short_name`         | L'icône d'accueil Android          |

Une variable d'environnement plutôt qu'une constante de build : **une seule
image sert toutes les installations**, et personne ne reconstruit un conteneur
pour appeler sa galerie autrement. Un redémarrage suffit, comme pour le reste
du `.env`. Le raisonnement complet est en [D72](./08-decisions/D72-le-nom-de-l-instance-vit-dans-le-env-et-le-serveur-le-pose.md).

Le manifeste n'est surchargé que sur ses deux champs de nom : les icônes, les
couleurs et `display` restent déclarés dans le seul fichier qui les liste, sans
quoi ils divergeraient au premier ajout de taille. Un manifeste **absent** du
front buildé ne fait qu'écrire un avertissement au démarrage — l'application
reste utilisable, elle ne s'installe simplement plus, même arbitrage que pour un
front absent. Un manifeste **présent mais illisible** arrête le démarrage : c'est
un fichier du dépôt, s'il ne parse pas le build est cassé.

`shell.ts` porte la substitution, et `test/shell.test.ts` la fait tourner sur le
**vrai** `index.html`. C'est l'invariant qui compte : ajouter un attribut à la
balise `<title>` ou intervertir `name` et `content` dans une `<meta>` ne casse
rien de visible — le serveur démarre, la page s'affiche, elle porte simplement
le mauvais nom.

### `lib/appName.ts`

Le front lit le nom dans la balise `application-name` du DOM, pas dans une
réponse d'API. Il est là dès le premier octet de JavaScript, alors qu'un appel
réseau ferait afficher un titre vide le temps de la réponse — et c'est le seul
moyen d'en disposer sur l'écran de connexion, qui s'affiche précisément quand
aucune route authentifiée ne répond.

### Les icônes — `public/icons/`

`icon.svg` est la source, et sert aussi de favicon (il n'y en avait aucune).
Six tuiles de largeurs inégales sur deux rangées, en `--color-accent` et
`--color-accent-dim` sur un fond `--color-ink-900` : **c'est la grille justifiée
que l'application rend vraiment à l'écran**, et non un pictogramme d'image
générique — le premier essai, un cadre au trait fin, disparaissait à la taille
où une icône est réellement regardée.

Deux aplats plutôt que des opacités, parce qu'une opacité se compose avec ce
qu'il y a derrière et qu'Android pose la variante masquable sur son propre
fond. Gouttières à 16 unités sur 512, soit 1,75 px sur un lanceur à 56 px : en
dessous elles se referment et les six tuiles deviennent une tache.

Les PNG sont dérivés une fois pour toutes, avec `sharp` — déjà dépendance du
serveur :

```bash
cd packages/web/public/icons && pnpm --filter @gdv/server exec node -e "
const sharp = require('sharp'); const s = () => sharp('icon.svg', { density: 384 });
Promise.all([
  s().resize(192).png().toFile('icon-192.png'),
  s().resize(512).png().toFile('icon-512.png'),
  s().resize(512).flatten({ background: '#0b0b0d' }).png().toFile('icon-maskable-512.png'),
  s().resize(180).flatten({ background: '#0b0b0d' }).png().toFile('apple-touch-icon.png'),
]);"
```

Deux détails portent tout le reste. Le `flatten` remplit les angles
transparents du fond sombre : c'est ce qui distingue la variante **masquable**,
qu'Android recadre dans la forme du système et qui doit donc déborder, de la
variante `any`, qu'il affiche telle quelle avec ses coins arrondis. Et la
mosaïque occupe 59 % de la toile en largeur, 50 % en hauteur, ce qui la laisse
dans la zone sûre — le cercle de 80 % du côté — quel que soit le masque
appliqué.

Pas de script permanent : la recette tient dans le bloc ci-dessus, et un script
de plus serait un module de plus à documenter pour quatre fichiers qui ne
changeront pas.

### Le service worker — `public/sw.js`

Trois règles, dans cet ordre :

| Requête                          | Stratégie                                        |
| -------------------------------- | ------------------------------------------------ |
| `/api/…`, non-GET, autre origine | **Ignorée** — passe au réseau, sans interception |
| Navigation (`request.mode`)      | Réseau d'abord, repli sur la coquille en cache   |
| `/assets/…`                      | Cache d'abord — noms hashés, donc immuables      |

**Il ne met en cache que la coquille** — l'HTML, le JS, le CSS. Jamais une
photo, jamais une réponse d'API. Le pourquoi est dans
[D71](./08-decisions/D71-le-service-worker-met-en-cache-la-coquille-jamais-les-photos.md) : sur un téléphone partagé, une photo mise en cache
par l'application survivrait à un changement de compte, et le cache HTTP privé
posé par le serveur les garde déjà rapides sans ce risque.

`install` met `/` en cache immédiatement, sans attendre qu'une navigation la
traverse : sinon la première ouverture hors réseau, juste après l'ajout à
l'écran d'accueil, ne trouverait rien.

`activate` refetch `/`, y relève les `/assets/…` référencés, remplace la
coquille en cache et supprime les bundles absents de la nouvelle. Sans cette
purge, le cache grossit d'un build à chaque déploiement, indéfiniment — les
noms portent un hash, rien n'écrase jamais rien. Tout est enveloppé dans un
`try` : hors réseau, on ne purge simplement pas.

**Pas de `skipWaiting()`.** Un onglet ouvert continue de tourner sur les
bundles qu'il a chargés ; la nouvelle version prend la main au lancement
suivant.

### `lib/registerServiceWorker.ts`

Enregistre `/sw.js` sur `load`, et **uniquement si `import.meta.env.PROD`** :
en développement, un service worker qui garde la coquille rendrait des fichiers
périmés à chaque rechargement, et il faudrait le désinscrire à la main pour
comprendre pourquoi une modification ne prend pas. L'échec de l'enregistrement
est avalé — l'application marche sans lui.

Appelé depuis `main.tsx`.

### `lib/useInstallPrompt.ts` et `components/InstallInstructions.tsx`

La proposition d'installation apparaît **à deux endroits selon la largeur** — un
bouton dans la barre, une ligne dans le menu. Son état vit donc dans un hook,
pas dans un composant : dupliqué entre les deux rendus, il finirait par diverger
(le bouton disparaîtrait après `appinstalled`, la ligne de menu non).

- **Android, Chrome** : `beforeinstallprompt` est capté avec `preventDefault()`
  — sans quoi le navigateur affiche sa propre bannière et l'événement n'est plus
  rejouable — puis `installer()` appelle `prompt()`.
- **iOS** : aucune API, `manuel` vaut vrai, et la `TopBar` ouvre
  `InstallInstructions` — un mode d'emploi en trois étapes, calqué sur
  `ShortcutsOverlay` pour ne pas inventer un second style de surcouche. C'est
  nécessaire parce que le chemin (Partager → Sur l'écran d'accueil) ne se devine
  pas.
- **Ailleurs** : `disponible` vaut faux et rien ne s'affiche — une invitation
  inerte vaut moins que pas de bouton. De même dès que l'application tourne en
  `display-mode: standalone`, que `navigator.standalone` le dit, ou
  qu'`appinstalled` est reçu.

**`InstallInstructions` est rendu dans `document.body`, par `createPortal`.**
L'en-tête de la `TopBar` porte un `backdrop-blur`, et un filtre fait de
l'élément le bloc conteneur de ses descendants positionnés : l'`inset-0` de la
surcouche se rapportait à la barre, et le dialogue s'y trouvait centré puis
rogné par le haut. `ShortcutsOverlay` n'a pas ce problème — il est monté depuis
une page, pas depuis la barre. Le menu, lui, **profite** de ce même mécanisme :
étant `absolute`, il s'ancre naturellement sous son bouton.

### Zones sûres

Deux endroits seulement, là où le mode standalone casse réellement quelque
chose. Ailleurs, l'application ne touche pas les bords.

- `CommentsPanel` — le formulaire ancré en bas passerait sous la barre
  d'accueil de l'iPhone : `pb-[calc(1rem_+_env(safe-area-inset-bottom))]`.
- `Lightbox` — en paysage, l'encoche recouvre exactement le bouton Fermer :
  `env(safe-area-inset-left/right)` sur les marges de l'en-tête. Le dégradé, lui,
  va bien jusqu'au bord.

`index.html` porte déjà `viewport-fit=cover`, sans quoi `env()` vaudrait zéro.
