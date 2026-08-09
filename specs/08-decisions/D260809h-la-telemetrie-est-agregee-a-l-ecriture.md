# D260809h — La télémétrie est mesurée en base, agrégée à l'écriture

**Contexte.** L'instance en service ne disait rien de son usage.
`sessions.created_at` était la seule trace existante, et elle ne répond qu'à
« quelqu'un s'est connecté un jour » — pas à « ai-je des visiteurs cette
semaine », ni à « qui ouvre quel album », qui est la question posée. Les
commentaires étaient le seul signal d'activité disponible, et ils sous-estiment
massivement la lecture : on regarde un album sans commenter.

**Choix.** La mesure se fait **côté serveur, en base**, dans une table agrégée à
l'écriture : une ligne par (album, clé, session, jour) portant des compteurs.

## Pourquoi pas un traceur tiers

Un Plausible, un Umami ou un Matomo verrait un **navigateur anonyme**. Or l'accès
à cette galerie est authentifié par clé : seule l'instance sait _qui_ regarde, et
c'est la moitié de la question. Un traceur y répondrait par « 42 visites », là
où l'écran d'administration répond « la clé `mamie` est venue trois jours cette
semaine, depuis un téléviseur ».

Le reste suit : un script tiers contredirait la promesse d'une galerie qui ne
laisse rien fuir (voir [04](../04-securite-et-acces.md), « Ce qui sort de
l'instance »), imposerait un domaine de plus à l'en-tête `Content-Security-Policy`,
et ferait dépendre d'un service extérieur une instance dont tout l'intérêt est de
se suffire à elle-même — le même arbitrage qu'en
[D63](./D63-le-depot-ne-privilegie-aucun-hebergeur-et-ne-cree-pas-de.md).

## Pourquoi pas un journal d'événements

La forme naturelle aurait été une ligne par requête, agrégée à la lecture. Elle
est écartée sur un ordre de grandeur : une visite d'album, c'est une requête de
grille, deux cents vignettes et quelques dizaines d'ouvertures de photo. Compter
chacune produirait la **dizaine de milliers de lignes par jour** qu'il faudrait
ensuite indexer, agréger et purger sérieusement.

Le `INSERT … ON CONFLICT DO UPDATE` sur `(album_id, username, session_id, day)`
ramène ça à une dizaine de lignes par jour, ce qui rend la purge presque
décorative — quatre cents jours de rétention tiennent dans quelques milliers de
lignes. Ce qu'on perd est réel et assumé : **l'heure exacte de chaque geste**, et
donc toute courbe intra-journalière. Personne n'a demandé à quelle heure sa mère
regarde les photos.

Deux conséquences de forme en découlent :

- **La table n'a aucune clé étrangère**, ni vers `sessions` ni vers `albums`. Une
  déconnexion détruit la session ; elle ne doit pas effacer l'historique de ce
  qui a été regardé — `session_id` n'est ici qu'un seau pour compter des
  visiteurs distincts, pas un lien. Idem pour un album supprimé : sa
  fréquentation passée reste vraie, et l'écran affiche son identifiant à la
  place de son titre.
- **`WITHOUT ROWID`** : la table est entièrement définie par sa clé primaire
  composite, l'index secondaire implicite ne servirait à rien.

## Pourquoi la classe d'appareil, et pas le user-agent

Le user-agent complet est une **empreinte** : version de navigateur, version
d'OS, modèle d'appareil, parfois la marque de l'opérateur. Le conserver
reviendrait à pouvoir distinguer deux personnes derrière une clé d'accès
partagée, ce que cette télémétrie ne cherche pas à faire.

Il est donc lu **une fois**, à la création de la session, réduit à l'une de
quatre valeurs — `mobile`, `tablette`, `ordinateur`, `tv` — puis jeté. Une classe
sur quatre ne ré-identifie personne, et répond à la seule question qui décide de
quelque chose : ce qu'on optimise. `device.ts` teste le téléviseur **en
premier**, parce qu'un webOS annonce `Mobile` et `Safari` dans son en-tête et
serait classé téléphone par un test naïf — c'est précisément l'écran qu'on ne
voit pas dans les journaux.

Le biais restant est connu : un iPad récent se déclare « Macintosh » et compte
comme un ordinateur. Le rattraper demanderait de sonder le tactile en
JavaScript, c'est-à-dire exactement le traceur qu'on vient d'écarter.

## Ce que la mesure ne descend pas

**Jamais le média.** Une ligne par photo ouverte serait l'historique de lecture
de quelqu'un, dans une application où plusieurs personnes partagent une clé. Les
compteurs s'arrêtent à « combien de photos ouvertes dans cet album ce jour-là ».

**Jamais l'adresse IP.** Elle n'ajouterait rien que la clé d'accès ne dise déjà,
et transformerait une table de compteurs en donnée personnelle à protéger.

## Le coût sur le chemin de la requête

Deux écritures s'ajoutent, et aucune lecture :

- `last_seen_at` est **une colonne de plus au SELECT** que `SessionStore.get()`
  fait déjà à chaque requête. Sa réécriture est plafonnée à une par heure et par
  session, sur le raisonnement déjà tenu pour `RENEW_AFTER_MS` : sans ce seuil,
  chaque vignette d'une grille déclencherait un UPDATE SQLite.
- L'ouverture d'un album n'est comptée que sur la **première page**, à
  l'identique de l'abonnement de [D41](./D41-on-s-abonne-aux-nouveautes-en-ouvrant-l-album.md) —
  les suivantes sont le même geste. Elle est en revanche inconditionnelle sur
  l'identité, là où l'abonnement exige un commentateur vérifié : on compte des
  visites, pas des abonnés.

Les deux compteurs sont accrochés à des requêtes que la galerie fait **déjà** :
la première page de la grille, et le détail d'un média. Aucune route de
signalement n'a été ajoutée — un « ping » de visite serait une requête de plus
par photo, et une surface d'API que rien d'autre n'utiliserait.

Le second point a demandé une correction côté front, trouvée en vérifiant la
mesure au navigateur : `useMediaDetail` n'était activée qu'à **l'ouverture du
panneau latéral**. Compter dessus aurait mesuré les panneaux ouverts en croyant
compter les photos regardées — soit, pour une visite ordinaire, zéro. La requête
part désormais dès qu'une photo est affichée, ce qui fait au passage ouvrir le
panneau « Infos » sur ses lignes déjà là plutôt que sur un indicateur d'attente.

## Les visites de l'administrateur sont montrées, pas exclues

Les retirer ferait mentir les totaux, et personne ne saurait plus si « 40
visites » compte ou non celles de la personne qui regarde l'écran. Une colonne
« administrateur » sur la ligne suffit à les lire pour ce qu'elles sont.
