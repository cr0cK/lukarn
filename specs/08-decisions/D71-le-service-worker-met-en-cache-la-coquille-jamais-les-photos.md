# D71 — Le service worker met en cache la coquille, jamais les photos

**Contexte.** L'application se consulte dans un onglet : il faut retenir l'URL,
la retaper, et la barre du navigateur mange une bande d'un écran de téléphone.
On veut qu'un proche pose l'icône sur son écran d'accueil et ouvre les photos
comme n'importe quelle autre application. Rendre installable oblige à déclarer
un service worker — et un service worker, une fois là, invite à mettre les
albums hors-ligne.

**Choix.** Il met en cache l'HTML, le JS et le CSS, et **rien d'autre**.
`/api/…`, les requêtes non-GET et les autres origines passent au réseau sans
qu'il les intercepte. Les photos restent servies par le réseau, avec le cache
HTTP privé que le serveur pose déjà sur les dérivés
(`private, max-age=31536000, immutable`).

**Écarté.** Mettre les albums hors-ligne. Trois raisons, dans cet ordre. Le
cloisonnement d'abord : un cache applicatif n'est indexé par rien — ni par la
session, ni par le cookie — là où le cache HTTP l'est par la valeur du cookie.
Sur le téléphone d'un foyer où deux comptes se succèdent, le second rouvrirait
une photo d'un album qu'il n'a jamais eu le droit de voir, sans qu'aucune
requête n'atteigne `authorize()`. Le quota ensuite : un album de vacances pèse
plus que ce qu'un navigateur mobile accorde à une origine. L'éviction enfin :
quand le quota est atteint, le navigateur vide le cache **en entier**, coquille
comprise — l'application deviendrait moins fiable hors-ligne à mesure qu'on lui
demanderait d'en faire plus.

Écarté aussi : Workbox. Trois règles tiennent en quatre-vingts lignes lisibles,
là où un générateur ajouterait une dépendance de build, un fichier généré à ne
pas relire, et une couche à comprendre pour le prochain qui reprend le code.
Ce dépôt écrit déjà lui-même son dotenv et son throttle.

Écarté enfin : `skipWaiting()`. Remplacer le service worker à chaud fait
demander à un onglet ouvert des bundles que le déploiement vient de supprimer,
en pleine session. La nouvelle version prend la main au lancement suivant, ce
qui est très exactement le comportement qu'on attend d'une application posée sur
un écran d'accueil.

**Conséquences.** Hors-ligne, l'application s'ouvre et affiche sa coquille ;
les albums, eux, ne chargent pas. C'est assumé : le repli utile n'est pas de
consulter ses photos dans le métro, c'est que l'icône ne mène pas à une page
d'erreur du navigateur quand le réseau vacille.

Concrètement, ce qui s'affiche alors est **l'écran de connexion** : `RequireAuth`
ne distingue pas un `useMe()` en échec réseau d'une session absente, et redirige
vers `/login` dans les deux cas. Ce n'est pas satisfaisant, mais c'est le
comportement existant et il ne dépend pas du service worker — le corriger
demanderait de séparer « pas connecté » de « serveur injoignable » dans toute
l'application, ce qui n'est pas le sujet ici.

Le cache d'assets réclame une purge à l'activation, sans quoi il grossit d'un
build à chaque déploiement, indéfiniment — les noms portent un hash, rien
n'écrase jamais rien.

**Le piège iOS**, qui n'a rien à voir avec le cache et qu'on découvrira
autrement à l'usage : une application posée sur l'écran d'accueil a son
**propre** stockage de cookies, séparé de celui de Safari. Le premier
lancement redemande donc une connexion, même si l'on venait de se connecter
dans le navigateur. Une fois, pour l'année que dure la session — mais il faut
le savoir pour ne pas le prendre pour une régression.
