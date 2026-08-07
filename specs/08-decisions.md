# 08 — Journal des décisions

Une entrée par décision : le contexte, le choix, ce qui a été écarté et pourquoi.
Ajouter une entrée à la fin plutôt que réécrire une entrée existante — une
décision revenue sur elle-même reste une information utile.

---

## D1 — SQLite plutôt que PostgreSQL

**Contexte.** Il faut un index consultable des médias, avec tri chronologique et
pagination, sur un VPS modeste.

**Choix.** better-sqlite3, fichier unique dans `DATA_DIR`, en process, WAL activé.

**Écarté.** PostgreSQL — un service de plus dans le compose, de la RAM, une
sauvegarde à orchestrer, un pool de connexions, pour un volume qui reste dans la
dizaine de milliers de lignes et un seul écrivain. Aucune fonctionnalité de
Postgres n'est nécessaire ici. Écarté aussi : un simple fichier JSON, qui ne
tient pas la pagination par curseur ni les mises à jour partielles pendant une
synchronisation.

**Conséquences.** L'API de better-sqlite3 est synchrone, ce qui bloque la boucle
d'événements — acceptable puisque toutes les requêtes sont indexées et rendent
quelques centaines de lignes au plus. `busy_timeout` et WAL couvrent la
concurrence lecture/sync.

---

## D2 — Index local plutôt qu'appels Drive à la volée

**Contexte.** La grille doit paginer 10 000 photos et trier sur la date de prise
de vue.

**Choix.** Un parcours de dossiers remplit une table `media` ; la grille ne lit
que SQLite.

**Écarté.** Interroger `files.list` à chaque page de grille : latence réseau à
chaque défilement, quota API consommé par la navigation, et impossibilité de
trier sur la date EXIF (Drive ne trie que sur `name`, `modifiedTime`,
`createdTime`…).

**Conséquences.** L'index peut être en retard sur Drive — c'est le rôle de
`sync.intervalMinutes`. En contrepartie, l'application reste consultable même
quand Drive est injoignable ou l'autorisation révoquée : seuls les rendus non
encore en cache échouent.

---

## D3 — Indexation sans téléchargement

**Contexte.** Indexer des milliers de photos ne doit ni prendre des heures ni
saturer le quota.

**Choix.** `files.list` avec
`fields: id, name, mimeType, size, modifiedTime, md5Checksum, imageMediaMetadata,
videoMediaMetadata` — dimensions, date EXIF et données d'appareil arrivent dans
la réponse de listage. Aucun octet de photo n'est téléchargé pendant une
synchronisation.

**Écarté.** Télécharger chaque fichier pour en extraire l'EXIF avec `exifr` ou
sharp : des gigaoctets de transfert pour des métadonnées que Drive fournit déjà.

**Conséquences.** On dépend de la qualité de l'EXIF vu par Drive. Quand il
manque, `takenAt` retombe sur `modifiedTime` et `takenAtFromExif` vaut `false`,
ce que le panneau d'informations affiche honnêtement (« Modifié le » plutôt que
« Prise de vue »).

---

## D4 — Proxy média plutôt que liens Google signés

**Contexte.** Il faut afficher des images stockées dans Drive à des visiteurs qui
n'ont pas de compte Google.

**Choix.** Toutes les images passent par `/api/media/...`. Aucune URL Google
n'atteint le navigateur.

**Écarté.** Renvoyer les `webContentLink` / `thumbnailLink` de Drive, ou une
redirection 302 vers une URL signée. Trois problèmes : un lien signé qui fuit
échappe définitivement au contrôle d'accès ; il expire, donc casse le cache
navigateur et l'`ETag` ; et il exposerait indirectement l'arborescence du Drive
du propriétaire.

**Conséquences.** Toute la bande passante transite par le VPS. C'est le coût
accepté — atténué par le cache disque et par des dérivés WebP nettement plus
légers que les originaux.

---

## D5 — `@googleapis/drive` plutôt que `googleapis`

**Contexte.** Il faut un client Drive v3 et un client OAuth2.

**Choix.** Les paquets ciblés `@googleapis/drive` et `@googleapis/oauth2`.

**Écarté.** Le méta-paquet `googleapis`, qui embarque toutes les API Google —
environ **114 Mo** installés, contre **2,5 Mo** pour les deux paquets ciblés.
Sur une image Docker reconstruite à chaque déploiement, la différence se paie en
temps de build, en taille d'image et en surface de dépendances.

**Conséquences.** `google-auth-library` n'est pas une dépendance directe : le
type `OAuth2Client` est dérivé de `InstanceType<typeof auth.OAuth2>`
(`drive/service.ts`).

---

## D6 — Pas de transcodage vidéo

**Contexte.** Les vidéos du Drive sont en MP4 et MOV, parfois volumineuses.

**Choix.** `GET /api/media/:id/original` relaie le header `Range` tel quel vers
Drive et recopie `Content-Length` / `Content-Range` de la réponse. Le navigateur
lit le format d'origine, avec seek natif.

**Écarté.** ffmpeg à la demande ou en tâche de fond : le CPU d'un VPS modeste ne
suit pas, il faudrait stocker les versions transcodées, et gérer une file de
travaux. Écarté aussi : réécrire le `Range` côté serveur, ce qui obligerait à
recomposer les réponses `multipart/byteranges`.

**Conséquences.** Un format que le navigateur ne sait pas lire n'est pas lisible
du tout — pas de repli. `media/range.ts` refuse donc les plages multiples et les
unités autres que `bytes` : un `Range` non conforme est **ignoré** et le fichier
entier est servi, comme le recommande la RFC 9110.

---

## D7 — Cache LRU sur disque avec déduplication des rendus concurrents

**Contexte.** Ouvrir un album déclenche des dizaines de requêtes de vignettes en
même temps ; produire une vignette coûte un téléchargement Drive plus un décodage
sharp.

**Choix.** Un fichier par entrée sous `CACHE_DIR`, clé
`sha256("<fileId>:<variante>")` répartie sur 256 sous-dossiers, inventaire des
tailles et des derniers accès **en mémoire**, éviction LRU jusqu'à 90 % de la
limite. `MediaRenderer.inFlight` mémorise les rendus en cours par clé : dix
requêtes simultanées sur la même vignette ne déclenchent qu'un téléchargement.

**Écarté.** Se fier à `atime` du système de fichiers pour l'ordre LRU : sur un
montage `relatime` — le défaut de la plupart des VPS — il n'est pas mis à jour de
façon exploitable. Écarté aussi : évincer pile à la limite, ce qui déclencherait
une éviction à chaque écriture suivante ; d'où le seuil à 90 %.

**Conséquences.** L'inventaire est reconstruit au démarrage par
`MediaCache.load()`, qui nettoie au passage les `.tmp` d'écritures interrompues.
**Un fichier déposé dans le cache pendant que le serveur tourne est invisible
jusqu'au redémarrage** — c'est le piège documenté de `seed-demo`. Les écritures
passent par un fichier temporaire puis un `rename` atomique : un lecteur
concurrent ne voit jamais un fichier partiel.

Aucune invalidation n'est prévue : la clé contient l'id du fichier Drive.

---

## D8 — Repli sur la vignette Drive quand sharp ne décode pas

**Contexte.** La libvips embarquée avec sharp ne décode pas tous les HEIC ni les
RAW propriétaires.

**Choix.** En cas d'échec de `transform()`, `MediaRenderer` demande le
`thumbnailLink` généré par Google, en remplaçant son suffixe `=s220` par la
taille voulue, et relance la transformation sur cet aperçu JPEG.

**Écarté.** Renvoyer une erreur ou une image « format non supporté » : le fichier
est visible dans Drive, il doit l'être ici aussi. Écarté aussi : embarquer un
décodeur RAW dans l'image Docker.

**Conséquences.** Un aperçu Drive est de qualité inférieure à un rendu depuis
l'original ; c'est mieux qu'une case vide. Le repli est journalisé en `warn`.

---

## D9 — `wildcard: true` sur `@fastify/static`

**Contexte.** Servir les bundles Vite dont les noms portent un hash qui change à
chaque build.

**Choix.** Une route générique.

**Écarté.** Le comportement par défaut de `@fastify/static`, qui **énumère les
fichiers au démarrage et déclare une route par fichier**. La liste est figée à
l'instant du démarrage : après un redéploiement à chaud, un bundle au nom inconnu
retomberait sur le gestionnaire 404, donc sur `index.html`, et le navigateur
recevrait du HTML là où il attend du JavaScript — erreur de type MIME opaque.

**Conséquences.** La route générique fait aussi correspondre `/` au répertoire
racine et refuse de le servir (403). Une route exacte `GET /`, prioritaire sur la
générique, rend `index.html` (`app.ts`).

---

## D10 — En-têtes de cache séparés entre `/assets/` et `index.html`

**Contexte.** Les deux sont servis par le même plugin statique.

**Choix.** `setHeaders` distingue sur la présence de `/assets/` dans le chemin :
`public, max-age=31536000, immutable` pour les bundles hachés,
**`no-cache` pour `index.html`**.

**Écarté.** Un `Cache-Control` unique. Long, il figerait l'application sur une
version passée après chaque déploiement, puisque `index.html` garde la même URL
tout en référençant les bundles du jour. Court, il rechargerait des bundles
immuables à chaque visite.

**Conséquences liées.** Un fichier manquant sous `/assets/` répond **404 JSON**
et non `index.html` : c'est le signe d'un déploiement incomplet, et répondre du
HTML donnerait une erreur de type MIME qui masquerait le vrai problème.
`packages/server/test/static.test.ts` verrouille les trois comportements.

---

## D11 — Sessions en base plutôt que JWT

**Contexte.** Il faut authentifier les visiteurs entre deux requêtes.

**Choix.** Un identifiant opaque de 32 octets aléatoires, une ligne dans
`sessions`, un cookie `httpOnly` signé.

**Écarté.** Un JWT stateless. Il reste valide jusqu'à son expiration où qu'il se
trouve : couper l'accès à quelqu'un — déconnexion, retrait de la config —
suppose une liste de révocation, c'est-à-dire une table en base, donc exactement
ce que le JWT prétendait éviter. Ici la session **est** la ligne, et la supprimer
suffit.

**Conséquences.** Une lecture SQLite par requête, négligeable en process. En
prime, le hook `onRequest` revérifie à chaque fois que le compte existe encore
et relit son rôle : la configuration fait autorité, pas le cookie. C'est ce qui
permet à un retrait de droits de prendre effet sans attendre l'expiration de la
session — la configuration vivait alors dans `albums.yaml`, elle est depuis
passée en base (voir D24), mais le raisonnement est inchangé.

---

## D12 — 404 et jamais 403 sur les albums et les médias

**Contexte.** Plusieurs utilisateurs partagent une instance et ne doivent pas
apprendre l'existence des albums des autres.

**Choix.** Un album ou un média auquel l'utilisateur n'a pas droit répond
**404**, indistinguable d'un identifiant inexistant.

**Écarté.** Un 403, plus honnête sémantiquement, mais qui confirme l'existence de
la ressource et rend la structure des albums d'autrui observable par sondage
d'URL.

**Exception assumée.** `/api/admin/*` répond 403 : l'existence de l'espace
d'administration n'est pas un secret. `packages/server/test/access.test.ts`
verrouille les deux comportements.

---

## D13 — Throttle de connexion en mémoire

**Contexte.** Freiner les attaques par dictionnaire sans gêner une erreur de
frappe.

**Choix.** Une `Map` en mémoire, clé `<ip>:<username>`, cinq tentatives libres
puis doublement du délai jusqu'à 15 minutes, oubli après une heure sans échec.

**Écarté.** Un compteur en base ou dans Redis. L'application est mono-process et
compte quelques utilisateurs : la persistance n'apporterait qu'une dépendance de
plus. Écarté aussi : un délai fixe, qui gêne les vrais utilisateurs sans
décourager un attaquant patient.

**Conséquences.** Les compteurs sont perdus au redémarrage — un attaquant qui
provoquerait un redémarrage remettrait le compteur à zéro, ce qui est un scénario
bien plus coûteux pour lui que d'attendre. La clé combine IP et identifiant :
une attaque distribuée sur un seul compte n'est pas ralentie globalement.

---

## D14 — Refresh token chiffré au repos

**Contexte.** Le jeton donne la lecture de tout le Drive du propriétaire et vit
dans un fichier SQLite sur un VPS.

**Choix.** AES-256-GCM, clé dérivée par scrypt d'un sel tiré à chaque
chiffrement, `TOKEN_KEY` fournie par l'environnement et jamais écrite en base.

**Écarté.** Stocker le jeton en clair — un dump de la base suffirait alors. Le
sel aléatoire par chiffrement écarte aussi la variante « clé dérivée une fois au
démarrage », qui rendrait deux chiffrements du même jeton identiques et
révélerait qu'il n'a pas changé.

**Conséquences.** Sauvegarder `gdv-data` sans le `.env` ne sert à rien : le jeton
serait indéchiffrable. Si `TOKEN_KEY` change, le tag GCM échoue, le jeton est
supprimé et `/admin` affiche « non connecté » plutôt que de boucler sur une
erreur.

---

## D15 — Le jeton révoqué est conservé, pas supprimé

**Contexte.** Google peut refuser le refresh token (`invalid_grant`) sans
prévenir : accès retiré, six mois d'inactivité, application repassée en « Test ».

**Choix.** `DriveService.guard()` détecte l'erreur, date `revoked_at` et lève une
`DriveRevokedError` typée. La ligne `oauth_token` reste, avec son compte.

**Écarté.** Supprimer la ligne. Une table vide se lit comme une installation
neuve, alors qu'il faut dire à l'administrateur _quel_ compte a perdu son
autorisation et qu'il s'agit de reconnecter, pas de connecter.

**Conséquences.** `authorizedClient()` échoue immédiatement une fois révoqué,
sans rappeler Google. `syncAll` interrompt sa boucle sur cette erreur : les
albums suivants échoueraient de la même façon. Les routes média traduisent en
`503 drive_revoked`. Une erreur réseau ou un 500 de Google ne déclenche **pas**
la révocation — `packages/server/test/revocation.test.ts` le vérifie.

---

## D16 — Pagination par curseur plutôt que par OFFSET

Voir [03](./03-modele-de-donnees.md) pour le mécanisme.

**Écarté.** `LIMIT … OFFSET …` : une synchronisation qui insère des médias
pendant que l'utilisateur défile décalerait la fenêtre, et le lecteur reverrait
ou sauterait des photos. Le curseur désigne une position dans l'ordre de tri, pas
un rang.

---

## D17 — Les dimensions dans l'index, corrigées de la rotation

**Contexte.** La grille justifiée a besoin des proportions de chaque image avant
de pouvoir se dessiner.

**Choix.** `width` et `height` sont stockés en base, **déjà inversés** quand
`imageMediaMetadata.rotation` est impair (5 à 8 en EXIF).

**Écarté.** Mesurer les images au chargement côté client, ce qui produirait un
reflow à chaque vignette qui arrive — exactement le défaut que la disposition
justifiée est censée éviter.

**Conséquences.** C'est la décision dont dépend tout le frontend : mise en page
stable, barre de défilement correcte dès le premier rendu, virtualisation
possible. Voir [07](./07-frontend.md).

---

## D18 — Le sens de tri vit dans l'URL et dans la clé de requête

**Contexte.** L'album peut être parcouru du plus récent au plus ancien ou
l'inverse.

**Choix.** `?order=asc` dans l'URL (le défaut `desc` n'y est pas écrit), `order`
dans la clé TanStack Query `['items', id, order]`, et un paramètre de requête
validé par une union zod fermée côté serveur.

**Écarté.** Un état React local : un lien partagé ne restituerait pas la vue, et
le retour navigateur ne ferait rien. Écarté aussi : ramener silencieusement une
valeur inconnue au défaut **côté serveur** — l'API répond 400, pour qu'un client
qui se trompe l'apprenne ; c'est le front qui absorbe une URL bricolée à la main.

**Conséquences.** Sans `order` dans la clé de requête, TanStack resservirait les
pages déjà chargées dans l'autre sens et continuerait de paginer à l'envers.
Inverser le tri renumérote l'album : la sélection est remise à zéro et la page
remonte en haut.

---

## D19 — Trois variantes d'image, chacune pour un usage

| Variante | Côté max         | Qualité WebP | Usage                        |
| -------- | ---------------- | ------------ | ---------------------------- |
| `thumb`  | 320 / 640 / 1280 | 78           | Grille, couvertures d'albums |
| `full`   | 2560             | 82           | Visionneuse plein écran      |
| `hd`     | 4096             | 88           | Zoom                         |

**Contexte.** `full` à 2560 px remplit un écran mais ne permet pas d'examiner une
photo à sa résolution native ; servir l'original de 9 Mo pour zoomer est
disproportionné.

**Choix.** Une variante `hd` plafonnée à 4096 px, qualité plus généreuse, pesant
quelques centaines de kilo-octets. `withoutEnlargement` empêche d'inventer des
pixels : une photo de 3000 px reste à 3000 px.

**Écarté.** Servir `/original` au zoom : plusieurs mégaoctets par photo, décodés
par le navigateur, sans passer par le cache disque. Écarté aussi : `effort`
WebP plus élevé, qui coûte des centaines de millisecondes par image à la première
ouverture pour quelques pourcents de poids — d'où `effort: 4`.

**Conséquences.** L'`ETag` doit distinguer les variantes (`"<id>-full"` vs
`"<id>-hd"`), sans quoi elles partageraient la même entrée de cache navigateur et
le zoom resservirait l'image basse résolution. Côté front, `hd` n'est demandée
qu'au premier agrandissement et chargée hors écran avant d'être substituée
(`components/ZoomableImage.tsx`, voir [07](./07-frontend.md)).

---

## D20 — Zoom sur variante haute résolution plutôt que `scale()` sur le rendu d'écran

**Contexte.** L'utilisateur veut examiner le détail d'une photo dans la
visionneuse.

**Choix.** `ZoomableImage` (`packages/web/src/components/ZoomableImage.tsx`)
calcule une « échelle native » — un pixel de photo par pixel d'écran — depuis les
dimensions de l'index, et charge la variante `hd` **hors écran** au premier
agrandissement avant de substituer la source.

**Écarté.** Un `transform: scale()` sur le rendu `full` : il n'agrandit que des
pixels déjà rasterisés à 2560 px, donc il ne révèle aucun détail. Écarté aussi :
charger `hd` d'emblée, qui alourdirait chaque ouverture de photo pour un geste
que la plupart des visiteurs ne feront pas ; et rebasculer sur `full` en revenant
au cadre, qui ferait clignoter l'image à chaque aller-retour.

**Conséquences.** Le zoom d'une photo dont l'index ignore les dimensions retombe
sur celles du rendu reçu — plus limité, mais présent. Un indicateur
`chargement HD…` est affiché tant que la variante n'est pas prête, plutôt que de
bloquer le geste.

---

## D21 — Préchargement asymétrique dans la visionneuse

**Contexte.** Chaque photo absente du cache serveur coûte un téléchargement
d'original depuis Drive ; précharger large sature la file et ralentit la photo
qu'on regarde.

**Choix.** Quatre photos dans le sens de navigation, une seule dans l'autre, les
plus proches demandées en premier. Le sens est déduit du dernier déplacement. Le
nettoyage de l'effet annule (`image.src = ''`) les téléchargements devenus
inutiles quand on enchaîne vite.

**Écarté.** Un rayon symétrique (l'ancienne version en chargeait deux de chaque
côté) : à nombre de requêtes égal, il dépense la moitié de son budget dans une
direction que l'utilisateur vient de quitter.

---

## D22 — Un objet `AppContext` traversant

**Contexte.** Routes, synchronisation et pipeline média ont besoin des mêmes
services.

**Choix.** Une classe `AppContext` construite une fois dans `buildApp`, portant
config, base, repos, sessions, Drive, cache, renderer et syncer. Les fabriques de
routes la reçoivent en paramètre et n'instancient rien.

**Écarté.** Un conteneur d'injection de dépendances (surdimensionné pour huit
services), et les décorateurs Fastify (qui perdent le typage précis et
disséminent l'assemblage).

**Conséquences.** Les tests construisent un contexte réel sur un répertoire
temporaire et interrogent l'application par `server.inject()`, sans mock — voir
`packages/server/test/access.test.ts`. La config vit derrière un getter, ce qui
permet le rechargement à chaud sans reconstruire quoi que ce soit.

---

## D23 — Tests avec le runner natif de Node

**Contexte.** Il faut des tests, sans alourdir l'outillage.

**Choix.** `node --import tsx --test`, `node:assert/strict`, tests rédigés en
français.

**Écarté.** Vitest ou Jest : une dépendance de plus, une configuration de plus,
pour des tests qui n'ont besoin ni de mocking avancé, ni de DOM, ni de snapshots.

**Conséquences.** Les tests portent sur les invariants plutôt que sur les
implémentations : cloisonnement des albums, réversibilité des migrations,
absence de doublon en pagination, ordre LRU, tolérance du parseur de `Range`,
service du front. Ils documentent le comportement attendu autant qu'ils le
vérifient.

---

## D24 — La configuration passe en base, le YAML devient un amorçage

**Contexte.** Comptes et albums vivaient dans `config/albums.yaml`, relu au
démarrage ou par un bouton. Le propriétaire veut administrer son instance depuis
l'application, sans éditer de fichier sur le VPS ni redémarrer un conteneur.

**Choix.** Quatre tables (`users`, `albums`, `user_albums`, `settings`,
migration 3), un `ConfigRepo` qui en est le seul écrivain, et une API
d'administration sous `/api/admin`. `config/albums.yaml` n'est plus lu que tant
qu'aucun compte n'existe : il **amorce** une installation neuve, et c'est le
chemin de mise à jour des instances en service.

**Écarté.** Faire écrire le YAML par l'application : il est monté en lecture
seule dans le conteneur, il faudrait sérialiser en préservant commentaires et
ordre, et deux écritures concurrentes se perdraient. Écarté aussi : garder le
fichier comme source de vérité avec une écriture au retour, qui aurait laissé
deux vérités à réconcilier — et un redémarrage aurait pu écraser une
modification faite dans l'application.

**Conséquences.** Le volume `gdv-data` contient désormais les comptes : c'est la
seule chose à sauvegarder, et sa perte fait perdre les accès en plus de l'index.
`POST /api/admin/reload` et `AppContext.reloadConfig()` disparaissent. Une
installation neuve sans fichier a besoin de `pnpm create-admin`, sinon personne
ne peut se connecter.

---

## D25 — Instantané mémoire de la configuration

**Contexte.** `canSee()` est appelé sur chaque requête média, donc sur chaque
vignette d'une grille de plusieurs centaines de tuiles. La config en mémoire
qu'on remplaçait ne coûtait rien.

**Choix.** `ConfigRepo` tient un instantané (albums, comptes, droits, réglages),
reconstruit à la première lecture qui suit une écriture. Étant le seul écrivain
de ces tables, il ne peut pas servir un état périmé.

**Écarté.** Une requête SQL par appel : indexée et en process, elle serait
tenable, mais c'est plusieurs centaines de requêtes par ouverture d'album pour
une donnée qui change quelques fois par mois. Écarté aussi : un cache à
expiration temporelle, qui ferait survivre un accès retiré quelques secondes —
inacceptable pour une décision d'autorisation.

**Conséquences.** Toute écriture doit passer par `ConfigRepo`. Un `UPDATE` direct
sur `users` ou `albums` depuis un autre module servirait un instantané périmé
jusqu'à la prochaine écriture légitime.

---

## D26 — Changer le `folderId` d'un album purge son index

**Contexte.** Modifier le dossier Drive d'un album existant laisse en base des
médias qui appartiennent à l'ancien dossier.

**Choix.** Purge immédiate (`clearAlbum`), état de synchro remis à `never`, et
resynchronisation lancée en fond si Drive est connecté.

**Écarté.** Attendre que la synchronisation suivante fasse le ménage par
`deleteStale`. La fenêtre entre les deux est exactement celle où l'album montre
ce que le propriétaire vient de vouloir retirer — et si Drive est déconnecté ou
révoqué, cette fenêtre est sans fin. Écarté aussi : purger sans resynchroniser,
qui laisserait un album vide et un clic de plus à faire.

**Conséquences.** Une faute de frappe dans le `folderId` coûte une réindexation
complète de l'album. C'est le prix de ne jamais servir le contenu d'un dossier
qu'on vient de retirer. Les dérivés en cache disque, eux, ne sont pas touchés :
ils sont indexés par id de fichier, donc partagés entre albums, et régénérables.

---

## D27 — Une sync interrompue laisse un index mélangé, et c'est assumé

**Contexte.** `Syncer.run()` écrit par lots de 500, chaque lot dans sa propre
transaction, pour que l'album devienne consultable pendant la synchronisation
(voir [02](./02-architecture.md)). Si la sync échoue à mi-parcours, les lots déjà
écrits sont **validés** : l'index mélange l'ancien contenu et le nouveau. Le
commentaire du bloc `catch` affirmait le contraire — que l'index précédent
continuait d'être servi.

**Choix.** Corriger le commentaire, pas l'architecture. L'état obtenu est
cohérent : `deleteStale` n'a pas eu lieu, donc rien n'a été retiré, et tout ce
qui vient d'être écrit existe bien dans Drive. L'album est simplement incomplet,
et `sync_state` le dit — statut `error`, message, et `lastSyncAt` qui reste celui
du dernier passage **réussi**.

**Écarté.** Un index de staging : écrire la sync dans une table parallèle, puis
basculer en une transaction. Cela doublerait l'espace occupé par l'index, ferait
perdre la propriété qui justifie les lots — l'album consultable pendant la sync,
qui compte pour un premier remplissage de plusieurs minutes — et n'apporterait
qu'une atomicité dont personne n'a besoin ici : un album incomplet pendant une
heure n'est pas un problème de correction, c'est un retard que la sync suivante
rattrape. Écarté aussi : une transaction unique pour toute la sync, qui tiendrait
un verrou d'écriture SQLite pendant tout le parcours Drive.

**Conséquences.** `lastSyncAt` doit se lire comme « date du dernier passage
complet », jamais comme « date de l'état actuel de l'index ». Un échec répété
laisse un album qui grossit un peu à chaque tentative sans jamais se nettoyer :
c'est le `deleteStale` de la première sync réussie qui remet tout d'aplomb.

---

## D28 — Trois colonnes écrites sans être relues sont conservées

**Contexte.** `media.modified_time`, `oauth_token.scope` et
`sessions.created_at` sont renseignées à l'écriture et n'apparaissent dans
aucune requête de lecture.

**Choix.** Les garder, et documenter leur raison d'être dans `db.ts` pour qu'on
ne les prenne pas pour un oubli. `modified_time` est le repère chronologique dont
`taken_at` dérive quand l'EXIF manque, donc de quoi recalculer sans réindexer ;
`scope` dira, le jour où `SCOPES` évoluera, si le jeton stocké couvre encore ce
que l'application demande ; `created_at` est la seule trace de l'ancienneté d'une
session, la première chose qu'on regarde après un accès suspect.

**Écarté.** Les supprimer. SQLite ne retire une colonne qu'en recréant la table
et en recopiant les lignes — une migration destructive sur une base en service,
pour économiser quelques octets par ligne et perdre trois informations qu'on ne
saurait pas reconstituer. Le rapport bénéfice/risque est franchement mauvais.

**Conséquences.** Un audit « colonnes mortes » les retrouvera. Le commentaire de
`db.ts` et le tableau de [03](./03-modele-de-donnees.md) sont là pour lui
répondre.

---

## D29 — Le throttle de connexion porte sur trois axes

**Contexte.** D13 avait retenu une clé unique `<ip>:<username>`, en assumant
qu'une attaque distribuée ou un balayage d'identifiants ne seraient pas ralentis.
Cette limite est plus coûteuse qu'estimé : chaque tentative refusée déclenche une
vérification argon2, volontairement lente. Une adresse qui essaie des milliers
d'identifiants aléatoires ne crée que des compteurs à une tentative — jamais de
pénalité, autant de CPU consommé, et une `Map` qui grossit sans borne.

**Choix.** Trois compteurs par échec — couple IP/identifiant (5 essais libres),
identifiant seul (10), IP seule (20) — le blocage le plus long l'emportant. Même
barème de doublement au-delà. Table bornée à 20 000 entrées, purgée à l'heure par
le ménage de `main.ts`.

**Écarté.** Un plafond global de tentatives par minute : il transforme un
balayage en déni de service contre les visiteurs légitimes. Écarté aussi :
effacer le compteur d'IP sur une connexion réussie — un attaquant disposant d'un
compte sur l'instance s'en servirait pour remettre son budget à zéro entre deux
rafales ; seuls les compteurs `couple` et `identifiant` sont effacés.

**Conséquences.** Une IP partagée (NAT d'entreprise, sortie VPN) peut freiner
plusieurs visiteurs à la fois — d'où les 20 essais libres sur cet axe, quatre
fois le quota du couple. `trustProxy: true` devient franchement critique : sans
lui, `request.ip` vaut l'adresse du reverse-proxy et l'axe IP bloquerait toute
l'instance. Une attaque où chaque tentative change à la fois d'adresse et
d'identifiant reste hors de portée des trois axes ; ce n'est pas le modèle de
menace d'une galerie familiale auto-hébergée.

---

## D30 — Un 401 de Drive renouvelle le jeton et retente une fois

**Contexte.** Le téléchargement d'un fichier passe par `fetch` avec un access
token porté en en-tête. Quand le propriétaire retire l'accès, Google cesse
d'accepter cet access token **avant** son expiration : Drive répond 401, mais
rien ne remonte comme `invalid_grant`, donc `guard()` ne voyait rien. Le jeton en
cache restait utilisé jusqu'à une heure, /admin affichait « connecté », et chaque
vignette échouait sur un message technique.

**Choix.** `DriveService.fetchAuthorized()` traite le 401 : il jette le client
OAuth en cache pour forcer un nouvel échange du refresh token, puis retente
**une seule fois**. L'échange passe par `guard()`, donc un refresh token refusé
est reconnu et la révocation enregistrée. Un second 401 reste une erreur — ce
n'est plus une question de jeton.

**Choix lié.** `guard()` photographie le chiffré du jeton en place au lancement
de l'appel, et `markRevoked()` n'écrit que si c'est toujours celui qui est
stocké. Une requête partie avant une reconnexion OAuth, qui échoue après
l'enregistrement du nouveau jeton, marquait sinon ce jeton tout neuf comme
révoqué — et /admin réclamait une reconnexion qui venait d'être faite. Chaque
`completeAuth` produisant un chiffré différent (sel et IV tirés à chaque fois),
la comparaison suffit à reconnaître qu'une reconnexion est passée entre-temps.

**Écarté.** Retenter en boucle : sur une grille de 200 vignettes, un 401
persistant ferait tourner le serveur à vide. Écarté aussi : marquer la révocation
dès le premier 401 — un 401 peut venir d'une permission propre au fichier, et
imposer un nouveau consentement pour cela serait disproportionné.

**Conséquences.** `accessToken()` est `protected` et non `private` : c'est le
seul point de contact réseau du service, et les tests s'en servent comme couture
pour ne pas appeler Google (`packages/server/test/revocation.test.ts`).

---

## D31 — Le regroupement de la grille vit dans l'URL, mais « aujourd'hui » se lit sur l'horloge locale

**Contexte.** La grille découpait les photos en mois, en dur. Sur un album de
vacances — trois mille photos sur trois semaines — cela produit une ou deux
sections, c'est-à-dire aucun repère. Le découpage par jour donne des en-têtes
utiles, mais tout le front affiche ses dates en UTC (voir `CLAUDE.md`), et un
découpage par jour en heure locale ferait basculer de section les photos de fin
de soirée.

**Choix.** `GroupBy = 'month' | 'day'` dans `@gdv/shared`, `?group=day` dans
l'URL comme `?order=asc`, et `LayoutOptions.groupBy` dans `computeLayout`. Les
deux clés de section sont des tranches de la chaîne ISO (`slice(0, 7)`,
`slice(0, 10)`), donc en UTC par construction : aucun objet `Date` n'intervient
dans le découpage, et un navigateur à Auckland segmente exactement comme un
navigateur à Lisbonne.

**Choix.** `dayLabel` nomme « Aujourd'hui » et « Hier » les deux jours les plus
récents, et **compare au calendrier local du navigateur**, pas au jour UTC.
C'est la seule date du front qui ne soit pas en UTC, et c'est cohérent :
`taken_at` est l'heure qu'affichait l'appareil, donc l'horloge murale de celui
qui a pris la photo — la même que celle de celui qui la regarde. Comparer au
jour UTC refuserait « Aujourd'hui » à un après-midi encore en cours à Montréal,
et l'accorderait à Auckland avant que la journée n'ait commencé. La date
complète, elle, reste rendue par `formatDate`, en UTC.

**Écarté.** Un regroupement par année : sur l'album qui motive la fonctionnalité
il ne produit qu'une seule section. Écarté aussi : envoyer `group` au serveur et
le mettre dans la clé TanStack Query — la liste servie est identique, seule la
mise en page la segmente, et l'y mettre rechargerait tout l'album à chaque
bascule. Écarté enfin : un repère relatif au-delà de la veille (« il y a
5 jours »), qui demande un calcul mental de plus que la date elle-même.

**Conséquences.** Par jour, `layout.sections` est beaucoup plus long, et
`JustifiedGrid` le balaie à chaque événement de défilement. Mesuré sur le pire
cas — 3 000 photos, 3 000 sections — ce balayage coûte 0,02 ms, contre 0,004 ms
pour les 99 sections du même album par mois : la virtualisation tient sans
changement, et une recherche dichotomique n'apporterait rien de mesurable pour
une invariante de tri en plus. La hauteur totale, en revanche, explose (94 000 px
par mois contre 837 000 px par jour sur ce même cas) : c'est le prix d'un en-tête
et d'une dernière ligne non justifiée par section, et c'est assumé. La bascule
remet la sélection clavier à zéro et remonte la page, comme l'inversion du tri.

---

## D32 — Rendus bridés et pool de fils agrandi

**Contexte.** Ouvrir une grille dont les vignettes ne sont pas encore en cache
déclenche un rendu par photo visible. Chacun charge l'original entier en
mémoire — neuf mégaoctets pour une photo d'appareil courante — puis le décode et
le ré-encode. La question posée était : le serveur reste-t-il disponible pour les
autres visiteurs pendant ce travail ?

**Mesures.** Banc sur huit cœurs, vingt-quatre rendus simultanés d'une photo
4000 × 3000 de 9 Mo, en interrogeant en parallèle une vignette **déjà en cache** —
le chemin d'un visiteur qui ne fait que regarder.

| Configuration                     | p95 de la requête servie depuis le cache | Mémoire du processus |
| --------------------------------- | ---------------------------------------- | -------------------- |
| Pool 4 (défaut Node), sans limite | 2 124 ms                                 | +336 Mo              |
| Pool 4, avec limite               | 2 344 ms                                 | +117 Mo              |
| Pool 16, avec limite              | **0,25 ms**                              | **+117 Mo**          |

Le débit total des rendus est identique dans les trois cas : ces réglages ne
font pas travailler plus vite, ils empêchent un traitement long de confisquer
les ressources aux requêtes courtes.

**Choix.** Deux corrections, qui traitent deux problèmes distincts.

- **Un limiteur de rendus simultanés** (`media/semaphore.ts`), dimensionné à
  `cpus - 2`, borné entre 2 et 4. La place est prise **avant** le
  téléchargement : attendre son tour avec l'original déjà en mémoire ne
  limiterait rien. C'est ce qui divise la mémoire par trois.
- **Un pool de fils de 16** (`threadpool.ts`). Le décodage d'images, les lectures
  de fichiers et argon2 partagent le pool de libuv, dont la taille par défaut est
  de quatre : quelques rendus le remplissent et une simple lecture de vignette
  attend derrière. C'est ce qui ramène la latence de deux secondes à un quart de
  milliseconde.

**Écarté.** Sortir le traitement dans des processus séparés (`worker_threads`,
file externe) : sharp travaille déjà hors du fil principal — le retard de la
boucle d'événements est resté sous 2 ms dans toutes les mesures —, donc le
problème n'était pas le blocage mais le partage des ressources. Un pool de
processus ajouterait de la sérialisation, de la mémoire et une supervision, pour
un gain que la mesure ne montre pas.

Écarté aussi : régler le pool depuis le point d'entrée après les imports. Node
lit la variable au premier usage du pool ; en ESM, tous les imports sont évalués
avant le corps du module, et il suffirait qu'un seul ouvre un fichier pour figer
la valeur. D'où un module dédié, importé en premier, qui agit à son chargement.

**Conséquences.** Le `Dockerfile` pose aussi `UV_THREADPOOL_SIZE=16` — redondant
avec le module, mais visible à l'exploitation et robuste si l'ordre des imports
change un jour. Une valeur déjà présente dans l'environnement fait autorité.

Sur une grille entièrement à froid, le temps total pour afficher toutes les
vignettes reste le même ; ce sont les visiteurs qui regardent autre chose qui ne
le paient plus.

---

## D33 — Pas de connexion Google pour commenter

**Contexte.** Il fallait attacher une identité aux commentaires. L'hypothèse de
départ était un « connexion avec Google », comme le font les services grand
public.

**Choix.** L'identité reste interne à l'application. Voir D38 pour la forme
qu'elle a fini par prendre — ce qui compte ici est ce qu'on a écarté.

**Écarté.** Un OAuth Google pour les visiteurs. Trois raisons, dans cet ordre.

D'abord il est **sans objet** : toute route média exige déjà une session, donc au
moment où quelqu'un peut voir une photo, le serveur connaît son identité. Le
seul apport propre de Google serait une adresse email vérifiée — pour laquelle
un champ de formulaire rempli par le propriétaire fait le même travail sur une
instance de quelques comptes.

Ensuite il **ouvre un trou d'autorisation**. Les droits vivent dans
`user_albums`, attachés à `users.username`. Un compte Google qui se présente
n'existe dans aucune de ces tables : il faudrait une allowlist d'adresses par
album, c'est-à-dire réinventer les comptes déjà là, ou accepter que n'importe
quel détenteur d'un compte Google entre.

Enfin il **contredit le périmètre** : « un visiteur n'a jamais de compte Google
et ne voit jamais une URL Google » ([01](./01-vision-et-perimetre.md)), et
l'inscription publique en est exclue depuis l'origine.

**Conséquences.** Commenter suppose de pouvoir déjà ouvrir l'album. Si un jour
l'instance doit s'ouvrir à des gens sans compte, c'est le modèle d'accès entier
qu'il faudra reprendre, pas les commentaires.

---

## D34 — Un fil par couple (album, média), et non par média

**Contexte.** Un même fichier Drive apparaît dans plusieurs albums quand leurs
dossiers sont imbriqués — c'est déjà la raison de la clé primaire composite
`(album_id, id)` de `media` et de `albumsContaining()`.

**Choix.** `comments` porte `album_id` **et** `media_id`. La même photo vue
depuis deux albums montre deux conversations distinctes.

**Écarté.** Indexer sur le seul `media_id`, ce qui aurait donné une conversation
unique par fichier — plus naturel a priori, et moins de lignes. Mais le contrôle
d'accès média accorde l'accès dès qu'**un** album contenant le fichier est
visible : un visiteur de l'album « Vacances » lirait alors les propos tenus dans
« Privé » par ceux qui y ont accès. Le cloisonnement de D12 porte sur les octets
de la photo ; il n'aurait rien dit de ce qu'on en écrit.

**Conséquences.** Une photo rangée dans deux albums peut porter deux fils sans
que personne ne s'en aperçoive. C'est le prix du cloisonnement, et le cas est
rare : les albums d'une même instance se recoupent peu. Le `parentId` d'une
réponse est vérifié contre le média courant pour la même raison — sans quoi un
identifiant deviné suffirait à greffer un message dans un fil illisible.

---

## D35 — Répondre à une réponse rattache à la racine, plutôt que de refuser

**Contexte.** Le besoin était « un seul niveau de réponse ». Reste à décider ce
que fait le serveur quand `parentId` désigne une réponse.

**Choix.** Le message est rattaché à la **racine du fil**. Le front, lui,
n'affiche pas de bouton « Répondre » sous une réponse.

**Écarté.** Répondre `400`. L'utilisateur qui atteint ce cas — par un client
tiers, ou une interface qui évoluerait — a une intention parfaitement claire :
écrire dans ce fil. Lui renvoyer une erreur qu'il ne peut pas corriger n'a aucune
valeur. Écarté aussi : autoriser la profondeur et l'aplatir à l'affichage, qui
aurait laissé en base une hiérarchie dont personne ne se sert et qu'il aurait
fallu parcourir à chaque lecture.

**Conséquences.** `parent_id` ne désigne **jamais** une ligne qui a elle-même un
parent — invariant tenu par `rootOf()` à l'écriture, pas par une contrainte SQL,
que SQLite ne sait pas exprimer ici. La lecture d'un fil s'en trouve simple : une
seule passe, les racines précédant leurs réponses puisque l'ordre des id est
l'ordre d'écriture. Le corollaire est qu'une réponse dont la racine disparaît
(compte supprimé, commentaire masqué) remonte en tête de fil plutôt que de
disparaître : elle appartient à son auteur, pas à celui qu'elle cite.

---

## D36 — Modération a posteriori, par masquage réversible

**Contexte.** Il fallait un moyen pour l'administrateur de retirer un
commentaire.

**Choix.** Le commentaire est publié immédiatement et peut être **masqué** après
coup depuis `/admin`. `hidden_at` et `hidden_by` portent la décision. Un
commentaire masqué disparaît de la lecture pour tout le monde, son auteur
compris.

**Écarté.** La pré-modération, où chaque message attend une validation. Sur une
galerie familiale dont les comptes sont créés à la main par le propriétaire, elle
retarde tout le monde pour un risque qui n'existe pas : il n'y a pas d'inconnus.
Elle a de plus un coût caché — l'auteur ne voit pas son propre message
apparaître, et croit à une panne.

Écarté aussi : **laisser l'auteur voir son commentaire masqué**, comme le font
les grandes plateformes. Cela revient à lui laisser croire qu'on le lit encore.
Autant que la décision soit visible : c'est ce qui distingue une modération
assumée d'un bannissement furtif.

Écarté enfin : la suppression pure. Masquer garde la décision réversible, ce qui
compte quand elle est prise vite. La suppression définitive reste possible, par
`DELETE /api/comments/:id`.

**Conséquences.** Une réponse dont la racine est masquée remonte en tête de fil
(voir D35). `hidden_by` est affiché dans la file de modération plutôt que gardé
comme trace morte : sur une instance à plusieurs administrateurs, c'est la
question qu'on se pose en premier.

---

## D37 — Les notifications partent hors du chemin de la requête, et n'échouent jamais

**Contexte.** Un commentaire doit prévenir le propriétaire de l'instance, et
l'auteur d'un fil quand on lui répond. L'application n'avait jusque-là aucune dépendance
d'envoi d'email — « pas de courriel à envoyer » figurait même dans le hors
périmètre de [01](./01-vision-et-perimetre.md), à propos de l'inscription.

**Choix.** `nodemailer` derrière `SMTP_URL` et `MAIL_FROM`. `POST` répond dès que
la ligne est écrite ; les messages sont mis dans une file sérialisée et partent
après. Un échec est **journalisé et abandonné**, sans réessai. Sans configuration
SMTP, le `Mailer` est inerte plutôt qu'absent : aucun appelant n'a à savoir si
l'instance envoie des emails.

**Écarté.** Envoyer dans le handler : un relais SMTP lent ferait attendre
plusieurs secondes après un clic sur « Publier », pour un travail qui ne
concerne pas celui qui attend. Écarté aussi : une file persistante avec
réessais — c'est un mécanisme à surveiller, alors qu'une notification manquée
est un désagrément et que le commentaire, lui, est bien enregistré. Écarté
enfin : écrire un client SMTP maison pour éviter la dépendance ; `nodemailer`
n'a aucune dépendance runtime, ce qui rejoint le raisonnement de D5.

**Conséquences.** Le `drain()` de l'arrêt gracieux est indispensable : sans lui,
un commentaire posté juste avant un redéploiement serait enregistré sans que
personne n'en soit prévenu. Le lien de désabonnement est un HMAC sans expiration
et sans session (voir [04](./04-securite-et-acces.md)) — un email se rouvre des
mois plus tard, et demander de se connecter pour cesser d'être dérangé serait une
façon de ne pas répondre. `PUBLIC_URL` devient structurante une fois de plus :
mal renseignée, elle produit des notifications qui ne mènent nulle part.

---

## D38 — Une clé d'accès n'est pas une personne

**Contexte.** D33 laissait le commentaire signé par le compte qui ouvre l'album,
avec un `display_name` et un `email` posés sur `users`. C'était une confusion :
`albums.yaml` a toujours permis de confier **un** identifiant à plusieurs
personnes — un mot de passe donné à toute une famille est l'usage prévu. Tous les
messages du foyer se seraient donc signés « famille », et l'administrateur se
serait retrouvé à saisir et à maintenir les adresses email des autres.

**Choix.** Deux niveaux séparés.

- `users` reste une **clé d'accès** : elle ouvre des albums, et rien n'interdit
  de la partager. Aucune adresse n'y est attachée.
- `commenters` est une **personne** : un nom, et une adresse email qui lui sert
  d'identité. C'est elle qui signe.

La session porte un `commenter_id` et **mémorise** l'identité sans la définir :
c'est l'adresse qui identifie, si bien que se ré-identifier depuis un autre
appareil retrouve ses commentaires et le droit de les supprimer. `comments.account`
conserve tout de même la clé d'accès employée, parce que c'est elle qu'on change
quand un mot de passe a trop circulé.

**Écarté.** Faire de l'email l'identifiant de connexion, en remplacement de
`username`. C'est la clé primaire de `users`, référencée par `user_albums` et
`comments` sans `ON UPDATE CASCADE` : il aurait fallu recréer ces tables sur une
base en service, et un changement d'adresse serait devenu un changement
d'identité. Écarté aussi : laisser l'administrateur saisir les adresses, qui ne
survit pas au premier changement d'adresse de quelqu'un d'autre.

**Conséquences.** L'adresse est obligatoire pour écrire, jamais pour lire. Elle
n'apparaît **jamais** dans un fil — seulement dans la modération, qui a besoin de
savoir qui parle derrière un nom déclaré. Les notifications destinées au
propriétaire ne peuvent plus viser « les administrateurs » : elles vont à
`settings.moderationEmail`, un réglage d'instance, puisqu'un compte administrateur
n'est plus quelqu'un de joignable.

---

## D39 — L'adresse est vérifiée par un code à usage unique

**Contexte.** L'identité de D38 est déclarative : derrière un mot de passe
partagé, n'importe qui peut se dire « Mamie ». Et déclarer l'adresse d'un tiers
lui ferait recevoir les notifications d'une galerie où il n'a rien demandé.

**Choix.** Un code à six chiffres envoyé à l'adresse, à saisir pour que
l'identité soit rattachée à la session. Quinze minutes de validité, cinq essais,
un envoi par minute au plus. Seul un HMAC du code est stocké.

**Écarté.** Faire confiance à la déclaration, au motif que le cercle est déjà
protégé par un mot de passe. Un mot de passe partagé circule justement plus
largement que prévu, et c'est bon marché de s'en prémunir. Écarté aussi : un lien
de confirmation cliquable plutôt qu'un code — il ouvre une seconde session dans
le navigateur par défaut, alors qu'un code se recopie dans l'onglet resté ouvert.
Écarté enfin : hacher le code en argon2, disproportionné pour un secret qui vit
quinze minutes, là où un HMAC coûte moins qu'une requête SQL.

**Conséquences.** **Sans SMTP configuré, personne ne peut commenter** : aucun
code ne peut partir. C'est cohérent — sans serveur d'envoi, les notifications ne
partiraient pas davantage —, et l'interface l'annonce au lieu d'offrir un
formulaire condamné à échouer. Le plafond de cinq essais est ce qui rend six
chiffres suffisants ; sans lui, un million de tentatives en viendraient à bout.

---

## D40 — Session d'un an, prolongée à mi-vie

**Contexte.** Le TTL de 30 jours obligeait à ressaisir un mot de passe partagé
plusieurs fois par an, pour une galerie familiale consultée irrégulièrement. La
demande était « une session qui ne se termine jamais ».

**Choix.** Un an, repoussé d'un an dès que la session a passé sa mi-vie. En
pratique on ne se déconnecte jamais tant qu'on utilise la galerie.

**Écarté.** Une session sans expiration. C'est un jeton de connexion permanent —
volé une fois, valable à vie — et la table `sessions` grossirait sans que rien ne
la nettoie, la purge horaire n'ayant plus rien à purger. Écarté aussi : le
« cookie de session » au sens HTTP, sans `maxAge`, qui fait exactement l'inverse
de ce qui était demandé puisqu'il meurt à la fermeture du navigateur. Écarté
enfin : repousser l'échéance à chaque requête, soit une écriture SQLite par
vignette ; à mi-vie, c'est une écriture par visiteur et par semestre.

**Conséquences.** Une session abandonnée met jusqu'à un an à disparaître, contre
un mois auparavant. Les leviers de coupure immédiate restent les mêmes et
comptent d'autant plus : suppression du compte et changement de mot de passe
ferment les sessions, et `plugins/auth.ts` relit les droits à chaque requête.

---

## D41 — On s'abonne aux nouveautés en ouvrant l'album

**Contexte.** Personne ne revient spontanément sur une galerie auto-hébergée :
les commentaires livrés avec D38 restent vides tant que personne n'apprend qu'il
y a du nouveau. Le point dur est que **rien ne relie une personne à un album** :
l'accès vient de la clé d'accès (`users`), l'identité de l'adresse vérifiée
(`commenters`), et les deux ne se croisent jamais. On ne sait donc pas
nativement à qui écrire.

**Choix.** Ouvrir un album abonne à ses nouveautés, sur la première page de
`GET /api/albums/:albumId/items`, pour les identités **déjà vérifiées**. Ouvrir
un album est un signal d'intérêt bien meilleur qu'une case à cocher, et les gens
concernés ont fourni leur adresse en connaissance de cause (D39). L'abonnement
est un **état** (`auto` / `opted_out`) et non la simple présence d'une ligne :
sans cela, rouvrir l'album le lendemain d'un désabonnement réabonnerait.

L'annonce est branchée sur le ménage horaire de `main.ts` (`notifier.ts`) et ne
concerne que les albums dont la dernière synchronisation réussie est calme depuis
une heure. Ce qui est nouveau se compte sur `media.added_at`, écrit à l'INSERT et
jamais par le `ON CONFLICT DO UPDATE` de `upsertMany` ; `sync_state.notified_at`
retient ce qui a déjà été annoncé.

**Écarté.** L'opt-in explicite — une case « préviens-moi », que personne ne
coche, dans une galerie familiale où l'on vient trois fois par an. Écarté aussi :
le récapitulatif quotidien, qui casse le lien entre « on vient de rentrer de
vacances » et « il y a des photos », alors que la cadence réactive le garde.
Écarté aussi : annoncer à la fin de chaque synchronisation — avec une sync toutes
les demi-heures écrivant par lots de 500, verser deux cents photos enverrait une
dizaine d'emails dans la journée. Écarté enfin : compter les nouveautés sur
`seen_at`, qui est réécrit sur _tous_ les médias à chaque passage et compterait
donc l'album entier comme neuf, toutes les demi-heures — c'est le piège de cette
fonctionnalité, et il est verrouillé par un test.

**Conséquences.** L'abonnement par défaut n'est acceptable qu'à deux conditions,
tenues toutes les deux : il est **annoncé** là où la personne donne son adresse
(le formulaire d'identité, voir [07](./07-frontend.md)), et il se défait **en un
clic**, par album. Le lien porte donc un jeton du couple adresse + album, sinon
il serait rejouable d'un album à l'autre.

`commenters.notify` reste le commutateur global : il coupe les réponses aux
commentaires **et** les annonces. L'inverse n'est pas vrai — se désabonner d'un
album bavard ne fait pas perdre les réponses à ses propres messages, ce qu'il y a
de plus précieux. Un album que personne n'a encore ouvert voit tout de même sa
borne avancer : sans cela, son premier abonné recevrait pour premier email
« 3 000 nouvelles photos », pour des photos arrivées avant qu'il ne s'abonne.
Enfin, la première exécution du notifieur sur une base existante — ou sur une
instance qui vient de configurer SMTP — **pose la borne sans envoyer** : annoncer
ici, ce serait annoncer tout l'historique de la galerie d'un coup.

## D42 — Un renommage attend la preuve, il ne la précède pas

**Contexte.** Relevé en revue croisée. `requestCode` écrivait `display_name` dès
la demande, avec ce commentaire pour justification : « il est de toute façon
revalidé par le code qui suit ». C'était faux dans l'ordre des opérations —
l'écriture précédait la validation, et rien ne la défaisait si le code n'était
jamais saisi.

La conséquence dépassait le nom lui-même. La signature d'un commentaire n'est
pas figée à l'écriture : le fil la lit par jointure sur `commenters`. Il
suffisait donc de connaître l'adresse de quelqu'un — et derrière une clé d'accès
partagée par un foyer, on la connaît — pour renommer d'un coup **tous ses
messages passés**, sans posséder sa boîte.

**Choix.** Le nom demandé pour une identité **déjà vérifiée** attend dans
`pending_display_name` ; `verify` l'applique, et lui seul. Une identité pas
encore vérifiée continue de s'écrire directement : rien n'est signé d'elle, il
n'y a rien à détourner.

**Écarté.** Figer le nom sur la ligne du commentaire à l'écriture, qui
résoudrait aussi le détournement. Écarté parce que se renommer cesserait alors
de valoir pour l'historique : « Mamie » devenue « Grand-mère » traînerait deux
signatures pour une même personne, et la spec promet l'inverse. Écarté aussi :
refuser la demande quand l'adresse appartient à une identité vérifiée — c'est
précisément le chemin qu'emprunte celui qui se ré-identifie depuis un nouvel
appareil, de loin le cas le plus fréquent.

**Conséquences.** Une demande abandonnée laisse un nom en attente, sans effet
visible ; la demande suivante l'écrase. Le renommage, lui, reste global et
rétroactif — c'est le comportement voulu, l'identité étant l'adresse et le nom
son étiquette courante.

## D43 — Le cache navigateur est cloisonné par session, pas révoqué

**Contexte.** Relevé en revue croisée. Les réponses média sont servies en
`private, max-age=31536000, immutable` : le navigateur ne revalide jamais. Une
photo déjà chargée reste donc affichable depuis le cache alors que le compte
n'a plus le droit d'y accéder — `authorize()` n'est même pas appelé, aucune
requête n'atteint le serveur.

**Choix.** `Vary: Cookie` sur toutes les réponses média. Le cache privé est
alors indexé par la session, ce qui ferme le seul cas où quelqu'un voit une
photo qu'il n'a **jamais** eu le droit de voir : deux comptes qui se succèdent
dans le même profil de navigateur, l'ordinateur du salon.

**Écarté.** `private, no-cache` avec revalidation systématique, que la revue
proposait. C'est la réponse correcte sur le papier et elle coûte trop cher ici :
une grille de cinq cents vignettes ferait cinq cents requêtes conditionnelles à
chaque visite, chacune passant par `albumsContaining` — un aller-retour par
image sur un téléphone en 4G, pour la fonction la plus utilisée de
l'application. Écarté aussi : signer les URL média avec une échéance courte, qui
règle le même cas au prix d'un mécanisme de signature, d'une horloge et d'une
fenêtre de validité à choisir.

**Conséquence assumée.** Celui à qui on retire un album garde dans son cache les
photos qu'il avait déjà chargées, jusqu'à un an. Aucun en-tête n'y change quoi
que ce soit : il les a eues, elles sont sur son disque, et il aurait pu les
enregistrer. Le retrait d'accès empêche d'en voir de **nouvelles**, il n'efface
pas ce qui a déjà été montré. Passer en `no-cache` ne rendrait pas cette
propriété — il ajouterait seulement une requête à chaque affichage.

## D44 — Un passage de synchronisation périmé n'écrit plus rien

**Contexte.** Relevé en revue croisée. Changer le dossier Drive d'un album purge
l'index immédiatement (`routes/admin.ts`), pour que l'album cesse sur-le-champ
de montrer ce que le propriétaire vient de retirer. Mais la synchronisation
déjà en vol sur l'ancien dossier, elle, continuait : ses lots suivants
réinséraient les photos abandonnées **après** la purge, et son `deleteStale` ne
les retirait pas — il ne retire que ce qu'elle n'a pas vu. Les photos
redevenaient visibles pour toute la durée du nouveau passage, et durablement si
le processus s'arrêtait entre les deux.

**Choix.** Chaque passage porte une génération, attribuée au moment où il prend
la place dans `running`. Elle est revérifiée avant chaque écriture — lots,
`deleteStale`, `sync_state`. Dès qu'une reconfiguration en a lancé un autre, le
passage périmé s'arrête et rend un `SyncResult` marqué `superseded`.

**Écarté.** Comparer les empreintes de configuration plutôt qu'un compteur :
revenir au dossier de départ pendant une sync rendrait les deux passages
indiscernables, et le premier reprendrait la main sur l'index. Écarté aussi :
annuler réellement le passage en vol — il attend une réponse Drive, et
l'interrompre demanderait de propager un `AbortSignal` jusqu'à chaque appel HTTP
pour un gain nul, ce passage ne coûtant que du quota déjà consommé.

**Conséquence.** Un passage abandonné ne touche pas non plus à `sync_state` :
écrire « erreur » afficherait un échec dans /admin alors que rien n'a échoué.

## D45 — Le cache se prépare à l'avance, mais toujours en second

> **Deux points de cette entrée ont été revus par D58** : le passage prépare
> désormais les **vignettes** et non la variante `full`, et il **est** branché
> sur la fin de chaque synchronisation. Les trois garde-fous ci-dessous **restent
> en vigueur** — ce sont eux la décision — mais deux de leurs justifications ont
> vieilli. Lire D58 avant d'appliquer ce qui suit.
>
> **Garde-fou n° 1.** Le limiteur de rendu n'a pas quatre places fixes mais
> `max(2, min(4, cœurs - 2))` (`renderConcurrencyFor`), soit **deux** sur le VPS
> à deux cœurs visé par ce projet. Le raisonnement n'en dépend pas : le
> préchauffage n'en occupe jamais qu'une, quel que soit le total.
>
> **Garde-fou n° 2.** Le motif invoqué — des rendus pleine page qui évinceraient
> les vignettes de la grille — **ne peut plus se produire** : le passage ne
> produit que des vignettes. Le seuil de 70 % reste utile, mais il protège
> désormais autre chose : les vignettes des albums qu'on consulte, contre celles
> des albums qu'on prépare.

**Contexte.** Mesuré sur une instance en service, album de 471 photos de reflex
(~8 Mo pièce) : ouvrir une photo jamais rendue coûte **~3,5 s** — environ deux
secondes de téléchargement Drive, une et demie de décodage et d'encodage WebP —
contre **5 ms** une fois le dérivé en cache. Le préchargement des voisines dans
la visionneuse couvre déjà le feuilletage ; il ne couvre pas le retour à la
grille puis l'ouverture d'une photo au hasard, qui est l'usage courant.

**Choix.** Un passage de fond rend la variante `full`, des photos les plus
récentes aux plus anciennes, branché sur le ménage horaire et sur le démarrage.
Trois garde-fous, et ce sont eux la décision — le principe, lui, est évident :

1. **Une photo à la fois, avec une seconde de pause.** Le limiteur de rendu a
   quatre places ; en n'en occupant jamais plus d'une, le préchauffage laisse
   toujours passer quelqu'un qui navigue. Remplir 471 photos prend alors une
   demi-heure, ce qui est le comportement voulu : il n'y a rien à gagner à aller
   vite, personne n'attend.
2. **Il s'arrête à 70 % du cache.** L'éviction est LRU **globale**, pas par
   album : sans cette part réservée, des rendus pleine page (~1 Mo) évinceraient
   les vignettes de la grille (~15 Ko) — ce qu'on regarde le plus — pour des
   photos que personne n'a demandées. Le reste du cache appartient à ce qui est
   réellement consulté.
3. **Le réglage est relu à chaque photo.** On décoche `prewarmCache` parce qu'on
   vient de constater que ça gêne ; un interrupteur qui n'agit qu'au passage
   suivant ne répond pas à cette demande-là.

**Écarté.** Le brancher sur la fin d'une synchronisation, ce qui semblait
naturel : la sync automatique peut être désactivée — elle l'est sur une instance
dont le Drive bouge peu — et le cache attendrait alors un clic pour se remplir,
c'est-à-dire exactement ce qu'on cherche à supprimer. Écarté aussi : préchauffer
`hd`, qui coûte le double et ne sert qu'à ceux qui zooment. Écarté enfin :
préchauffer tout le Drive d'un coup au premier démarrage — 471 photos font
3,7 Go téléchargés, un volume qu'on préfère étaler.

**Sur le quota.** Le préchauffage ne consomme pas _plus_ de quota Drive : ces
téléchargements auraient lieu de toute façon, au premier clic. Il les concentre,
ce qui rend le réessai indispensable — d'où le repli exponentiel ajouté à
`fetchAuthorized` en même temps. Sans lui, chaque `403 rateLimitExceeded`
laisserait un trou dans le cache que rien ne viendrait combler, et une vignette
cassée là où la seconde d'après serait passée.

## D46 — Le compte de service, pour ne plus voir « Google n'a pas validé cette application »

**Contexte.** `drive.readonly` est un scope que Google classe **restreint** :
tant que l'application n'est pas vérifiée, chaque consentement affiche un écran
d'avertissement rouge, qui recommande de ne pas continuer et cache le vrai lien
derrière « Paramètres avancés ». Faire lever cet écran suppose une procédure de
vérification qui, pour un scope restreint, va jusqu'à l'audit de sécurité par un
tiers — sans rapport avec une galerie familiale auto-hébergée. Les autres
sorties n'en sont pas : le type « Interne » est réservé aux organisations
Workspace, et le mode « Test » garde l'écran **et** fait expirer les refresh
tokens en sept jours.

**Choix.** `GOOGLE_SERVICE_ACCOUNT_FILE` désigne la clé JSON d'un compte de
service, qui prend le pas sur OAuth quand elle est présente. Il n'y a alors plus
de consentement du tout : l'autorisation vient du **partage du dossier** côté
Drive, exactement comme on partage un dossier avec quelqu'un.

Les deux chemins coexistent plutôt que l'un remplace l'autre. Une instance déjà
en service tourne avec son jeton OAuth ; lui imposer une migration pour un
écran qu'elle ne verra plus avant six mois serait une régression pour elle.
Poser la clé suffit à basculer, la retirer suffit à revenir — et configurer les
deux est l'état transitoire normal de cette bascule, d'où la priorité donnée à
la clé.

**Écarté.** Demander `drive.file` au lieu de `drive.readonly`, qui n'est pas un
scope restreint : il ne donne accès qu'aux fichiers choisis un par un dans le
sélecteur Google, ce qui ne permet pas d'indexer un dossier entier — la
fonctionnalité même de l'application. Écarté aussi : faire vérifier
l'application, dont le coût n'a aucun rapport avec l'usage.

**Conséquences.** La portée diminue, ce qui est un gain : `drive.readonly`
donne la lecture de **tout** le Drive, un compte de service ne voit que ce
qu'on lui partage. C'est aussi une contrainte, et la seule chose à ne pas
oublier — un dossier d'album non partagé ne produit aucune erreur, seulement un
album vide. /admin affiche donc l'adresse du compte de service en évidence,
c'est elle qu'on recopie dans le partage.

La clé, elle, ne s'expire pas : elle se protège comme `TOKEN_KEY`, hors du dépôt
et montée en lecture seule. En échange, plus rien ne peut expirer ni être
révoqué — le `invalid_grant` de D20 n'existe plus dans ce mode.

## D47 — Le frontal TLS entre dans le compose, les en-têtes restent dans le code

**Contexte.** L'hébergement retenu est un VPS ordinaire (écarté : Fly.io, dont
les volumes à 0,15 $/Go/mois font payer trente fois le prix d'un Drive pour
stocker ce qu'un disque de VPS inclut — et dont la facturation à l'egress ne
récompense pas le proxy média, l'entrant étant déjà gratuit). Le `compose` ne
publiait alors qu'un port sur `127.0.0.1`, à charge pour l'installateur de poser
un reverse-proxy. Trois conséquences constatées en relisant le déploiement :
le TLS était un devoir de vacances non corrigé, aucun en-tête de sécurité
n'était posé nulle part, et `trustProxy: true` ne tenait que par la grâce du
préfixe `127.0.0.1:`.

**Choix.** Caddy devient un service du `docker-compose.yml`, et `app` ne publie
plus aucun port. Les **en-têtes de sécurité, eux, restent dans l'application**
(`plugins/headers.ts`), pas dans le `Caddyfile`.

C'est cette seconde moitié qui est la décision. Le réflexe est de poser CSP et
HSTS au frontal, là où vit déjà le TLS. Mais le frontal est la pièce la plus
susceptible d'être remplacée — un nginx déjà en place, un Traefik parce qu'on
héberge autre chose, un tunnel devant tout ça — et il est absent en
développement comme dans les tests. Des en-têtes posés là ne protègent qu'une
topologie ; posés dans l'application, ils suivent le binaire, ils sont testables
par `server.inject`, et ils survivent au `Caddyfile` que quelqu'un remplacera.
Le `Caddyfile` ne garde donc que ce qu'il est seul à pouvoir faire : terminer le
TLS, et refuser un corps trop gros avant qu'il n'occupe Node.

`trustProxy` passe de `true` à `['loopback', 'uniquelocal']` dans le même
mouvement. `true` fait confiance à tout `X-Forwarded-For`, y compris forgé : le
throttle de connexion, indexé sur l'IP, ne freinait plus personne dès lors que
le port était joignable autrement que par le proxy. La protection ne dépend plus
de la façon dont l'instance est déployée.

**Écarté.** Traefik, dont la découverte par labels est un gain quand on héberge
plusieurs services et une couche à comprendre quand on n'en héberge qu'un.
Écarté aussi : `@fastify/helmet`, une dépendance de plus pour une quinzaine de
lignes dont on veut choisir chaque valeur — le défaut de helmet pose `max-age`
à deux ans, ce que la fin de cette entrée écarte, et une CSP qu'il faudrait de
toute façon réécrire entièrement. Écarté enfin : `Permissions-Policy`, qui
n'interdirait que des API que l'application n'appelle pas et dont l'usage
demanderait de toute façon l'accord explicite du visiteur.

**Conséquences.** `PUBLIC_URL` gagne un quatrième rôle : le `Caddyfile` s'en
sert comme adresse de site (`{$PUBLIC_URL}`). C'est délibéré — le domaine servi
et le domaine déclaré à Google viennent désormais de la même ligne, ce qui
supprime la panne la plus fréquente de cette installation. En contrepartie, la
variable doit être une URL publique complète et exacte : `https://` en
production, sans `/` final.

Le volume `caddy-data` s'ajoute aux sauvegardes souhaitables sans être
irremplaçable : le perdre force une réémission de certificat, et Let's Encrypt
plafonne leur nombre par domaine et par semaine.

Enfin, `HSTS` n'est posé que si `PUBLIC_URL` est en `https` — sans quoi un
navigateur ayant ouvert une instance de développement réclamerait du HTTPS à
`localhost` pendant six mois.

## D48 — Le géocodage tourne en fond, et son cache est une cellule d'un kilomètre

**Contexte.** Les photos portent leur position dans leur EXIF, déjà indexée
(`media.lat/lng`). Personne n'en voyait rien : une grille datée ne dit ni ce
qu'on a fait ni où. Transformer un couple de coordonnées en « Bonifacio,
Corse » demande un service tiers.

**Choix.** Nominatim/OSM, appelé par un **passage de fond** branché sur le
ménage horaire et sur le démarrage, avec un cache par **cellule** `lat,lng`
arrondie à deux décimales (~1,1 km).

Le passage est coupé en deux moitiés qui n'ont pas les mêmes propriétés, et
c'est là que se joue la décision. L'**agrégation** des positions en grappes est
déterministe, instantanée et hors réseau ; le **géocodage** est lent, plafonné
par la politique d'usage à une requête par seconde, et faillible. Les mélanger
— écrire un libellé figé dans `album_days` — obligerait à choisir entre ne
jamais recalculer les journées et rappeler Nominatim à chaque passage. Séparées
(`album_days.cells` d'un côté, `geo_places` de l'autre), le recalcul est gratuit
et les libellés s'allument tout seuls quand ils arrivent.

La cellule d'un kilomètre est la maille en deçà de laquelle deux photos portent
de toute façon le même nom de lieu. Un cache par photo ferait mille appels pour
une journée, un cache par journée n'en réutiliserait rien d'un séjour à l'autre.
Il est partagé entre albums : deux séjours au même endroit ne comptent qu'un
appel.

**Écarté.** _Le géocodage au fil de la requête_ : `better-sqlite3` est
synchrone et une grille demande des dizaines de journées ; à une requête par
seconde, la page attendrait une minute. _Google Geocoding_ : une clé et une
facturation de plus, là où rien d'autre dans cette application n'en demande —
c'est précisément ce que le compte de service et Nominatim évitent.
_Réessayer indéfiniment un lieu sans résultat_ : d'où la distinction entre
« abouti sans résultat » (ligne écrite à `label = NULL`, plus jamais demandée)
et « échec réseau » (aucune ligne, retenté au passage suivant).

**Conséquences.** `GEOCODING_URL` peut être vidée : les journées gardent leurs
grappes, sans libellé. Le premier passage sur une grosse bibliothèque s'étale
sur plusieurs heures — 200 appels par passage horaire —, et l'interface doit
donc tenir sans `autoPlaces`, ce qu'elle fait : un lieu absent ne laisse pas de
trou, il ne s'affiche pas. Le `User-Agent` dérive de `PUBLIC_URL`, comme
l'exige l'instance publique.

## D49 — La note d'une journée est un repère, pas un récit

**Contexte.** L'en-tête d'une section de la grille doit pouvoir porter un lieu
et une note. Or `computeLayout` place toutes les photos **avant** que le moindre
nœud DOM n'existe : c'est ce qui donne une barre de défilement juste au premier
rendu et rend la virtualisation possible.

**Choix.** 300 caractères, deux lignes clampées, hauteur d'en-tête déclarée par
`LayoutOptions.headerHeightFor` — `56 + 20 si lieu + 40 si note`.

La hauteur est une **donnée d'entrée du calcul**, jamais une mesure. Un en-tête
qui déciderait de sa taille une fois monté passerait sous ses propres photos, et
rien ne le rattraperait : le layout ne se recalcule qu'au changement de largeur,
de liste ou de regroupement. Les deux constantes sont donc un contrat que
`SectionHeader` doit respecter, d'où ses hauteurs de ligne fixées
explicitement (`leading-5`) plutôt que laissées à la police.

Même raison pour l'éditeur, qui s'ouvre **en survol absolu** : le faire pousser
le flux décalerait toute la suite de l'album sous le curseur au moment précis où
l'on vient de cliquer.

**Écarté.** _Une note de longueur libre_, qui obligerait à mesurer l'en-tête
rendu puis à recalculer le layout — donc à faire sauter la grille une fois par
section au chargement. _Un `ResizeObserver` sur les en-têtes_ : même problème,
avec en prime une boucle de rétroaction entre la mesure et le layout.

**Conséquences.** On décrit une journée en une phrase ou deux, pas en paragraphe.
C'est le bon format pour ce que la fonctionnalité vise — « Bonifacio, puis la
plage » —, et le texte entier reste lisible en infobulle. Le jour où une vraie
narration serait voulue, elle ne vivra pas dans l'en-tête d'une grille
virtualisée.

## D50 — La saisie vit dans l'album, la mutation reste sous `/api/admin`

**Contexte.** On ne sait quoi écrire sur une journée qu'en voyant ses photos.
Faire annoter depuis `/admin` reviendrait à demander à quelqu'un de décrire le
14 juillet de mémoire, devant une liste d'albums.

**Choix.** Le crayon est dans la grille, en face des photos ; la requête part
sur `PATCH /api/admin/albums/:id/days/:day`. La lecture, elle, est côté galerie :
`GET /api/albums/:albumId/days`.

Ce n'est pas une incohérence, c'est ce qui **préserve un invariant** : seul
`/api/admin/*` répond **403**. Partout ailleurs, un refus d'accès répond 404
pour que la liste des albums d'autrui ne soit pas devinable (D12). Une route
d'écriture montée sous `/api/albums` aurait dû choisir entre trahir cet
invariant et répondre 404 à un visiteur légitime qui n'est pas administrateur —
c'est-à-dire mentir sur l'existence de l'album qu'il est en train de regarder.

**Écarté.** _Un troisième régime de réponse_ (403 sous `/api/albums` pour cette
route seulement) : un invariant qui souffre une exception n'en est plus un, et
c'est le genre de détail qui se perd à la revue suivante. _Une section
« journées » dans `/admin`_ : elle demanderait de retrouver une date dans une
liste, sans les photos qui disent de quoi il s'agit.

**Conséquences.** Le front porte la règle « crayon visible si `me.admin` et
découpage par jour », et le serveur la revérifie — comme partout, l'interface ne
fait qu'éviter d'offrir un geste qui échouerait.

## D51 — Le lieu se corrige à la journée, jamais à la photo

**Contexte.** Le géocodage inverse tombe parfois à côté : une commune limitrophe,
un lieu-dit que Nominatim ne connaît pas, une photo prise en voiture entre deux
étapes. Il faut pouvoir rectifier.

**Choix.** La correction est une colonne `place` sur `album_days`, qui prime sur
les libellés déduits. Il n'existe aucune correction par photo.

**Écarté.** _Un lieu par média._ Il ne pourrait pas vivre dans `media` :
`upsertMany` réécrit cette table intégralement à chaque synchronisation, et une
correction y serait effacée au passage suivant. Il faudrait donc une table
d'override, sa fusion partout où le GPS est lu — détail d'un média, agrégation
des journées, futur export —, et une interface pour désigner un point, c'est-à-
dire un sélecteur de carte. Pour un gain qui se confond avec celui de la
correction par journée dans l'immense majorité des cas : on corrige « on était à
Porto-Vecchio, pas à Lecci », pas la position d'une photo particulière.

**Conséquences.** Une journée dont les photos couvrent plusieurs lieux se corrige
d'un bloc ou pas du tout. C'est assumé : le champ accepte n'importe quel texte,
donc « Bonifacio, puis les Lavezzi » reste possible — simplement écrit à la main
plutôt que déduit. La correction survit aux synchronisations et aux recalculs,
puisqu'elle ne vit pas dans `media`.

## D52 — Un VPS et `docker compose`, pas un PaaS auto-hébergé

**Contexte.** Le dépôt savait construire une image et servir du HTTPS (D47),
mais rien n'y décrivait comment on arrive à une machine qui tourne. Le
`README.md` visait un VPS générique : gabarit sous-dimensionné, SSH ouvert au
monde, mise à jour par `git pull && docker compose up` sans rien vérifier
ensuite. La question ouverte était donc : qu'est-ce qui comble ce trou ?

**Choix.** Un VPS Scaleway provisionné par le CLI `scw`, amorcé par un
cloud-init versionné (`deploy/cloud-init.yaml`), et deux scripts bash —
`deploy/backup.sh`, `deploy/deploy.sh`. Rien de plus.

**Écarté.** Coolify, Dokku, CapRover et les autres PaaS auto-hébergés :
l'essentiel de ce qu'ils apportent — TLS automatique, reverse-proxy, redéploiement
au push — est déjà dans ce dépôt, et fonctionne. Les adopter, c'est remplacer un
`Caddyfile` de trente lignes qu'on lit en entier par un composant à héberger, à
mettre à jour et à dépanner, dont la panne emporte la galerie avec elle. Écarté
aussi Kamal, plus proche du besoin, mais qui suppose un registre d'images là où
l'on construit sur la machine, et dont la valeur — déploiement multi-hôtes sans
interruption — n'a pas d'objet pour une instance unique dont le redémarrage dure
quelques secondes. Écarté enfin un déploiement par GitHub Actions poussant sur
la machine : il faudrait y déposer une clé de déploiement et ouvrir un chemin
entrant, alors que l'accès d'administration se referme sur Tailscale.

**Conséquences.** Le déploiement reste une commande lancée à la main sur la
machine, et c'est assumé pour une galerie familiale : la fréquence de mise à
jour ne justifie pas d'automatiser le déclenchement. En contrepartie, `deploy.sh`
doit être fiable seul — d'où la sauvegarde systématique avant migration et
l'attente active du retour à `healthy` plutôt qu'un `up -d` qui rend la main sur
un conteneur qui redémarre en boucle.

Le gabarit annoncé passe de « 1 Go suffit » à 2 vCPU / 4 Go / 60 Go. Ce n'était
pas une marge de confort : le build tourne sur la machine (`build: .`, donc
vite, `tsc` et d'éventuels modules natifs à compiler) et le cache disque vise
20 Go par défaut. À 1 Go de RAM, le build est tué avant la fin.

## D53 — Les volumes du compose portent un nom explicite

**Contexte.** Les volumes étaient déclarés `gdv-data`, `gdv-cache`,
`caddy-data`, `caddy-config`. Compose les préfixe du nom du projet, c'est-à-dire
du répertoire de travail : ils s'appelaient en réalité
`googledrive-viewer_gdv-data`, et autre chose encore selon le nom du clone. La
procédure de sauvegarde du `README.md`, elle, écrivait
`docker run --rm -v gdv-data:/data … tar czf`.

Docker crée en silence un volume nommé qui n'existe pas. Cette commande montait
donc un volume **neuf et vide**, produisait une archive vide, et rendait 0. La
sauvegarde documentée ne sauvegardait rien, sans un message d'erreur, et on ne
s'en apercevait qu'en restaurant.

**Choix.** `name:` explicite sur les quatre volumes. Le nom cesse de dépendre du
répertoire de clonage, et toutes les commandes déjà écrites deviennent justes.
`deploy/backup.sh` vérifie en plus que l'archive contient `gdv.db` avant de la
garder.

**Écarté.** Corriger seulement le `README.md` en y écrivant
`googledrive-viewer_gdv-data` : cela suppose que tout le monde clone sous ce
nom, et laisse le piège intact pour toute commande écrite de mémoire. Écarté
aussi `COMPOSE_PROJECT_NAME` dans le `.env` — une variable de plus à ne pas
oublier, pour un résultat que quatre lignes de `docker-compose.yml` obtiennent
sans condition.

**Conséquences.** Une instance déjà en service tourne sur des volumes préfixés,
que la nouvelle déclaration **n'adopte pas** : sans migration, le premier
`docker compose up` démarre sur une base vide — comptes, albums et index
compris. La copie de `<projet>_gdv-data` vers `gdv-data`, et de
`<projet>_caddy-data` vers `caddy-data` pour éviter une réémission de
certificat, est donc une étape obligatoire, encadrée dans le `README.md`.
`gdv-cache` ne vaut pas la copie.

C'est aussi la raison pour laquelle la vérification de bout en bout de ces
scripts se fait en produisant une vraie archive et en listant son contenu :
l'erreur d'origine se lisait dans le contenu du fichier, pas dans un code de
sortie.

## D54 — Les compteurs de commentaires se demandent par album, pas par photo

**Contexte.** La visionneuse doit signaler qu'une photo porte une conversation
**avant** qu'on ouvre quoi que ce soit — c'est le seul moment où l'information
sert à quelque chose. Or `MediaDetail.commentCount` n'est chargé qu'à l'ouverture
du panneau, précisément pour éviter une requête par photo regardée.

**Choix.** `GET /api/comments/:albumId` rend `{ counts: Record<mediaId, number> }`
pour l'album entier, en une requête `GROUP BY media_id` sur `idx_comments_thread`.
Les photos sans commentaire sont omises : sur un album de milliers de vues dont
une dizaine porte une conversation, la réponse tient en quelques centaines
d'octets. `MediaDetail.commentCount` reste pour l'onglet du panneau ouvert.

**Écarté.** _Ajouter `commentCount` à `MediaItem`_, donc à chaque page de la
grille. `MediaRepo` ignore délibérément l'existence des commentaires — sans quoi
la moindre requête média devient une jointure de plus — et l'y introduire aurait
fait payer ce coût à tous les appels, y compris ceux qui n'affichent pas de
pastille. _Charger le détail de chaque photo atteinte_ : parcourir un album à la
flèche déclencherait une requête par photo traversée, pour un chiffre qui arrive
après coup.

**Conséquences.** La pastille peut être en retard sur une conversation ouverte
ailleurs, et ce retard **n'est pas borné par les 30 s de `staleTime`** — il faut
le dire, l'inverse se déduirait naturellement du réglage. `refetchOnWindowFocus`
est à `false` globalement, `useCommentCounts` ne pose aucun `refetchInterval`, et
le hook n'est appelé que depuis la visionneuse : tant qu'elle reste ouverte,
aucune requête ne repart. Le `staleTime` n'agit donc que sur le `refetchOnMount`
d'une **réouverture** de la visionneuse, et c'est ce qui borne réellement le
retard. Publier depuis le panneau, lui, invalide les compteurs immédiatement.
Un album où presque toutes
les photos seraient commentées rendrait une réponse proportionnelle au nombre de
photos ; ce n'est pas l'usage visé, et le jour où il le deviendrait, la pagination
se poserait comme elle se pose déjà pour les médias.

## D55 — Le repère de lecture vit dans le navigateur, pas en base

**Contexte.** Afficher « 3 nouveaux commentaires » demande de savoir où en était
le lecteur. Une table côté serveur serait la réponse réflexe.

**Choix.** `localStorage`, sous `gdv:comments-seen:<albumId>`, un **nombre de
commentaires vus** par photo. Le total vient du serveur, l'écart se calcule à
l'affichage (`unreadCount`).

Deux raisons, dans cet ordre. D'abord une clé d'accès n'est pas une personne
(D38) : indexer un repère de lecture par compte ferait qu'au sein d'un foyer, le
premier à ouvrir une photo effacerait la pastille de tous les autres — l'inverse
exact de ce que la fonctionnalité promet. Le navigateur, lui, est bien celui
d'une personne. Ensuite un entier suffit là où une date obligerait le serveur à
transporter l'horodatage de chaque fil pour qu'on puisse le comparer.

**Écarté.** _Une table `comment_reads(account, album_id, media_id, seen_at)`_ :
une migration, une écriture à chaque ouverture de panneau, une jointure dans les
compteurs, et le défaut de cloisonnement ci-dessus. _Un repère par identité de
commentateur_ plutôt que par compte : il aurait le bon grain, mais la plupart des
lecteurs n'ont jamais vérifié d'adresse — la pastille ne marcherait que pour ceux
qui écrivent.

**Conséquences.** Un changement d'appareil, un nettoyage du navigateur ou une
navigation privée repartent de zéro : on revoit ses propres commentaires comme
non lus **une fois**, jamais l'inverse. C'est le sens de l'erreur acceptable — la
pastille peut être bavarde, elle ne doit pas être muette. Le stockage est borné
par le nombre de photos commentées de l'album, pas par le nombre de photos
regardées, et une photo redescendue à zéro commentaire quitte la table.

## D56 — Le panneau latéral prend une colonne, il ne recouvre plus la photo

**Contexte.** Le panneau était posé en surimpression sur le bord droit, à
l'endroit exact de la flèche « Suivant ». Lire un fil puis passer à la photo
suivante demandait de refermer le panneau, cliquer, le rouvrir — à chaque photo.
Le laisser ouvert était impossible, alors que c'est l'usage naturel quand on
parcourt un album commenté.

**Choix.** À partir de `md`, la visionneuse est une rangée : colonne photo
`flex-1 min-w-0`, colonne panneau `md:relative md:w-80 lg:w-96 md:shrink-0` —
le préfixe `md:` porte sur **toutes** ces classes, sans quoi elles
s'appliqueraient aussi à la surimpression `w-full` du téléphone. La zone photo
rétrécit, les flèches restent atteignables, le panneau peut rester ouvert. En
dessous de `md`, la surimpression est conservée — 320 px prélevés sur un écran de
téléphone ne laisseraient rien à voir.

Rien du calcul de zoom n'a bougé. `ZoomableImage` mesure son conteneur par
`ResizeObserver` : l'échelle d'ajustement, le « 100 % » et le bornage du cadrage
se recalculent seuls quand la colonne change de largeur. C'est ce qui a rendu la
correction possible sans toucher à `lib/zoom.ts`.

**Écarté.** _Décaler les flèches vers l'intérieur quand le panneau est ouvert_ :
une classe à changer, mais la photo reste à moitié cachée derrière le panneau, ce
qui est le vrai problème. _Une transition de largeur_ : le `ResizeObserver`
émettrait un rendu par image de l'animation, pour un mouvement qu'on ne regarde
pas.

**Conséquences.** Entre `md` et `lg`, la zone photo tombe à environ 450 px de
large : une photo affichée plus petite, mais navigable. C'est le compromis
assumé, l'alternative étant de repasser en surimpression sur cette plage, donc de
réintroduire le défaut d'origine sur les écrans d'ordinateur portable les plus
courants.

## D57 — Trente secondes pour corriger une faute de frappe, et rien de plus

**Contexte.** On publie un commentaire d'une phrase depuis un téléphone, souvent
d'un pouce, et on voit la coquille une seconde après l'avoir envoyé. Le seul
recours était de supprimer et de réécrire — ce qui, sur une réponse, emporte
aussi le fil que d'autres y avaient accroché.

**Choix.** `PATCH /api/comments/:commentId`, réservé à l'auteur, pendant
`COMMENT_EDIT_WINDOW_MS` (30 s) après la publication. `created_at` ne bouge pas,
`parent_id` non plus. Le délai est contrôlé **par le serveur** — une règle que
seule l'interface applique n'est pas une règle — et `remainingEditMs` est
partagée pour que les deux côtés tranchent à l'identique.

Trois refus distincts, et c'est délibéré. Un commentaire qui n'est pas le sien
répond **404**, indistinguable d'un identifiant inexistant, comme partout
ailleurs. Un délai dépassé répond **409 `edit_window_closed`** : le refus porte
sur l'**état** du message et non sur un droit d'accès, son auteur l'a déjà sous
les yeux, et le lui expliquer ne révèle rien. Un corps vide répond **400**.

**L'administrateur n'a aucun privilège ici.** Il masque, il supprime, il ne
réécrit pas. Retirer un propos et mettre d'autres mots dans la bouche de
quelqu'un sous son nom sont deux pouvoirs de nature différente ; le second n'a
pas sa place dans un outil dont toute la modération repose sur la réversibilité
assumée (D36).

**Écarté.** _L'édition libre et sans limite_, qui transforme un fil en document
révisable : on répond à un message, l'auteur le réécrit, et la réponse devient
incompréhensible pour qui lit ensuite. C'est la raison pour laquelle les
messageries qui autorisent l'édition affichent toutes une mention « modifié » —
un aveu qu'on ne peut plus faire confiance à ce qu'on lit. Trente secondes
n'appellent pas cette mention : personne n'a eu le temps de lire.

_Une fenêtre plus longue_, cinq ou quinze minutes : elle rendrait la mention
« modifié » nécessaire, donc l'horodatage d'édition, donc une colonne de plus —
tout un appareillage pour un cas que la suppression couvre déjà.

_Le suivi de la fenêtre côté client seulement_, sans contrôle serveur : il aurait
suffi d'un `curl` pour réécrire un commentaire d'il y a six mois.

**Conséquences.** Le décompte est affiché sur le bouton (« Modifier (12 s) »)
parce qu'un bouton qui disparaît sans prévenir se lit comme un défaut, alors que
sa disparition est ici la règle. Le formulaire ouvert n'est pas refermé
d'autorité à l'échéance : c'est le serveur qui refuse, et son message s'affiche
— fermer le champ ferait disparaître sans prévenir un texte en cours de frappe.
`Comment.canEdit` est la première valeur du contrat qui **périme d'elle-même** ;
tout consommateur doit la recouper avec `createdAt`, ce que le type dit
explicitement.

## D58 — Le préchauffage prépare les vignettes, et suit la synchronisation

**Contexte.** D45 avait tranché : le préchauffage rend la variante `full`, et
n'est jamais branché sur la fin d'une synchronisation. Les deux points se sont
révélés faux à l'usage, et il a fallu qu'un compte de test ouvre un album de
941 photos jamais consulté pour le voir — **2 min 36 avant la première image**.

Ce qui l'explique, avec la provenance de chaque chiffre — elle compte, ils n'ont
pas tous la même solidité :

- **Un dérivé coûte ~2 s, dont la quasi-totalité en téléchargement Drive.** Repris
  de la mesure de D45, prise sur une instance en service.
- **Le rendu lui-même est négligeable devant ce téléchargement**, de l'ordre de
  quelques dizaines de millisecondes pour une vignette. Cohérent avec D45, qui
  relevait 1,5 s pour un `full` d'un reflex de 8 Mo — une vignette est sans
  commune mesure.
- **Le limiteur ne sert que 2 à 4 rendus à la fois.** Lu dans le code :
  `renderConcurrencyFor` rend `max(2, min(4, cœurs - 2))`, donc **deux** places
  sur le VPS à deux cœurs visé par ce projet, quatre sur une machine de
  développement. Le pire cas est celui de la production.
- **Une grille froide en demande plusieurs dizaines d'un coup.** Mesuré sur
  `seed-demo 941`, contexte navigateur neuf, à l'ouverture et avant tout
  défilement : **26** vignettes montées en 1280 × 720, 31 en 1920 × 1080, 36 en
  2560 × 1440, 41 en 1440 × 2400, 26 en 390 × 844. Recoupé côté serveur : 26
  requêtes `/thumb` distinctes ont bien atteint Fastify à 1280 × 720. Le compte
  est **indépendant du nombre de photos de l'album** — c'est `OVERSCAN_PX` et la
  hauteur de rangée cible qui le fixent — mais il dépend de la fenêtre et des
  formats présents ; « de l'ordre de trente » est le registre à retenir. Sur
  l'album qui a motivé cette entrée, l'attente observée était de 2 min 36.

Or D45 ne préparait pas de vignettes du tout, mais
la variante `full` — celle du clic sur une photo, pas celle de l'affichage de
l'album. Le préchauffage travaillait donc consciencieusement à supprimer une
attente d'une seconde, en laissant intacte celle de plusieurs minutes qui la
précède.

**Choix.** Le passage prépare les **trois tailles de vignette** et rien d'autre.
La taille retenue dépend de la largeur de la case et de la densité de l'écran :
les trois doivent être prêtes, faute de quoi la moitié des écrans repartirait à
zéro. `MediaRenderer.prepare` les produit en **un seul téléchargement** et sur
une seule place du limiteur — c'est l'original en mémoire qui pèse, et il est le
même pour les trois. Le rendu `full` sort du préchauffage : dix fois le poids
d'une vignette, pour une attente déjà couverte par le préchargement des voisines
dans la visionneuse.

Le passage est en outre branché sur la **fin de chaque synchronisation**
(`AppContext.syncThenPrewarm`). C'est le seul instant où l'on sait qu'il y a du
neuf, et les photos qui viennent d'arriver sont exactement celles qu'on va
ouvrir. D45 l'avait écarté au motif que la synchronisation peut être désactivée —
l'argument tient, mais il justifie de **garder** les autres déclencheurs, pas
d'écarter celui-là.

**Écarté.** _Préparer aussi le rendu `full`_ : sur 941 photos, on passe de
quelques dizaines de Mo à plusieurs Go, contre un plafond `cacheMaxSizeGB` qui se
mettrait à évincer — et l'éviction est LRU globale, donc ce sont les vignettes
des albums qu'on regarde vraiment qui partiraient. _Verrouiller un album jusqu'à
son préchauffage complet_, ou _afficher une progression_ : deux réponses au
symptôme, écartées parce que la cause était ailleurs (voir D59) et qu'une fois
celle-ci traitée, l'attente résiduelle ne justifie plus d'appareillage.

**Conséquences.** `prewarmCache` reste un réglage, à `true` par défaut : le
comportement voulu est donc celui d'une instance neuve, et le décocher reste
possible pour une bande passante comptée. Un album déjà préparé ne consomme plus
un passage entier à ne rien faire — `prepare` rend `0` quand tout est en cache,
et le passage saute alors sa pause d'une seconde au lieu de la subir par photo.

## D59 — Une vignette démontée ne s'annule pas toute seule

**Contexte.** Le symptôme rapporté était trompeur : un compte non-administrateur
restait sur « Chargement des photos » là où le compte administrateur affichait
l'album. Tout accusait le contrôle d'accès. Ce n'en était pas : les requêtes
n'échouaient pas, elles **attendaient** — et finissaient par aboutir.

Retirer un `<img>` du DOM n'annule pas son téléchargement. La virtualisation de
la grille démonte les vignettes sorties de la fenêtre, mais le navigateur mène
leurs requêtes à terme, et chacune continue d'occuper l'une des **six**
connexions que HTTP/1.1 accorde à une origine. Quelques dizaines de vignettes
froides suffisent à saturer ce plafond ; tout ce qui part ensuite attend son
tour, y compris le `GET /items` dont dépend l'affichage. D'où l'écart entre les
deux comptes, qui n'avait rien à voir avec les droits : l'un avait toutes ses
vignettes en cache navigateur, l'autre ouvrait une session neuve.

Le cas le plus net est le **changement de sens de tri** : il relance `/items`
derrière la volée de vignettes de l'ordre précédent, devenues inutiles mais
toujours en cours. L'écran reste alors sur « Chargement des photos » le temps
qu'elles se vident — plusieurs dizaines de secondes sur un album froid. Le
mécanisme est certain ; la durée exacte dépend du débit vers Drive et n'a pas été
rejouée en conditions contrôlées.

**Choix.** `Thumb` efface son `src` au démontage. C'est le seul geste qui coupe
réellement une requête d'image en cours.

Le contrôle sur `isConnected` est indispensable et n'a rien d'une précaution de
style : `StrictMode` rejoue montage et démontage **sans toucher au DOM**, si bien
que sans lui les vignettes du premier écran perdaient leur `src` à l'instant où
elles s'affichaient — React ne le réécrit pas, sa vue du DOM le croyant inchangé.
Le nœud est capté à l'exécution de l'effet, React ayant déjà remis la ref à
`null` au moment du nettoyage.

**Écarté.** _Un `AbortController` et un `fetch` par vignette_ : il faudrait gérer
soi-même les `blob:` URLs, leur révocation, et le cache HTTP qu'on perdrait au
passage — beaucoup d'appareillage pour ce qu'un attribut retiré obtient.
_Réduire l'`OVERSCAN_PX`_ : cela diminue le nombre de requêtes orphelines sans
supprimer la fuite, et dégrade le défilement rapide.

**Conséquences.** Le diagnostic initial — « bug multi-utilisateur » — était une
fausse piste complète, et c'est la leçon la plus utile de cette entrée : deux
comptes qui se comportent différemment sur la même donnée peuvent ne rien devoir
aux droits, et tout à l'état de leur cache navigateur. La mesure qui a tranché
est l'opposition entre le chronométrage serveur, qui répondait vite, et le
chronométrage navigateur, qui attendait.

## D60 — Un téléchargement Drive a une échéance, sauf quand il relaie une vidéo

**Contexte.** `DriveService.send()` appelait `fetch` sans `AbortSignal`. Node
hérite alors du défaut d'undici : **cinq minutes**. Or la place du limiteur de
rendu est prise **avant** le téléchargement — c'est voulu, l'original en mémoire
est ce qui pèse (D32). Deux téléchargements figés sur un VPS bicœur gèlent donc
tous les rendus pendant cinq minutes, ce qui, vu du navigateur, ne se distingue
pas d'un blocage définitif. C'était le diagnostic initialement posé sur la
lenteur d'un album froid, et il était faux dans ce cas précis — mais le
mécanisme, lui, existait bel et bien.

**Choix.** `AbortSignal.timeout(120_000)` sur les téléchargements de contenu,
**et sur eux seuls**. Le discriminant est déjà là : `send(url, token, range?)`.

- **Sans `range`** — téléchargement d'un original pour produire un dérivé, borné
  par `MAX_DECODE_BYTES` (80 Mo) : échéance. 120 s couvre 80 Mo sur une ligne
  lente et laisse une marge considérable au cas courant, une dizaine de
  mégaoctets.
- **Avec `range`** — relais d'une vidéo vers le navigateur, qui la consomme à son
  rythme : **aucune échéance**. `AbortSignal.timeout` est une échéance _totale_,
  pas d'inactivité ; elle couperait une lecture en cours au bout de deux minutes.

**Le repli tient en trois couches**, et c'est là qu'est la vraie décision — une
échéance seule ne fait que transformer une attente en tuile vide.

1. **L'aperçu Drive**, déjà en place : le `catch` de `build()` repart du
   `thumbnailLink`, qui pèse quelques kilooctets là où l'original en pèse huit
   millions. Sur une ligne saturée, c'est précisément ce qui a le plus de chances
   de passer.
2. **Un 503 avec `Retry-After`, jamais un 500.** `DriveUnavailableError` distingue
   le transitoire — délai dépassé, débit limité au-delà des réessais — du
   définitif, un format que la libvips ne décode pas. Un 500 dit « cassé » et
   fait renoncer ; un 503 dit « reviens ». Aucun en-tête de cache n'accompagne un
   échec : rien n'est mémorisé, donc la requête suivante retente réellement.
3. **Deux réessais côté vignette**, délai doublé et **dispersé**. Sans eux, le
   503 ne servirait à rien : un `<img>` ne réessaie pas tout seul, et la tuile
   resterait vide jusqu'au rechargement de la page. La dispersion n'est pas
   cosmétique — trente vignettes échouent ensemble sur une grille froide, et des
   réessais synchrones repartiraient saturer les six mêmes connexions (D59).

**Écarté.** _Une échéance unique pour tout le trafic Drive_ : elle couperait la
vidéo, et c'est le genre de régression qu'on ne voit qu'en production, en
regardant un film. _Un réessai côté serveur_ : il tiendrait la place du limiteur
plus longtemps, c'est-à-dire qu'il aggraverait exactement ce qu'on corrige.
_Prendre la place du limiteur après le téléchargement_ : l'original serait alors
en mémoire hors de tout comptage, ce que D32 a précisément écarté. _Un bandeau
d'erreur global_ quand beaucoup de vignettes échouent : de l'appareillage pour un
état que les réessais résorbent d'eux-mêmes.

**Conséquences.** Le pire cas devient 240 s — l'original puis l'aperçu Drive se
figeant tous deux — contre 600 s auparavant. Une seule constante gouverne les
deux, assumé : un aperçu mériterait une échéance plus courte, mais deux réglages
pour un gain de quelques secondes dans un cas déjà rare ne valent pas la
complication. Un `<img>` ne connaît pas le code de retour reçu : les deux
réessais partent donc aussi sur un 404, ce qui coûte deux requêtes inutiles pour
un média réellement disparu — c'est rare, et l'inverse coûterait bien plus.

## D61 — Le préchauffage s'arrête quand Drive n'est pas connecté

**Contexte.** `CachePrewarmer` ne consultait que `prewarmCache`. Sans connexion
Drive — instance neuve, consentement révoqué, clé de compte de service absente —
le passage parcourait l'album entier en échouant photo par photo, **pause d'une
seconde comprise** puisqu'elle est hors du `try`. Sur mille photos, c'est un
quart d'heure de boucle stérile par passage horaire, et autant de lignes de
journal qui noient ce qu'on cherche vraiment.

**Choix.** La connexion entre dans le prédicat existant :
`enabled: () => this.settings.prewarmCache && this.drive.connected`. Ce prédicat
est déjà relu à l'entrée de `run()` **et** à chaque photo (D45), donc le passage
s'arrête immédiatement, et une révocation en cours de passage l'interrompt comme
le ferait un décochage du réglage.

**Écarté.** _Ajouter `drive` à `PrewarmDeps`_ : une dépendance de plus vers un
service entier, là où un booléen suffit — et `CachePrewarmer` n'a aucune autre
raison de connaître Drive. _Un `try` autour de la pause_ : cela accélérerait la
boucle stérile au lieu de l'éviter.

**Conséquences.** Le passage ne reprend qu'au déclencheur suivant — ménage
horaire, démarrage, ou fin de synchronisation (D58). Reconnecter Drive ne relance
donc pas le préchauffage dans la seconde ; en pratique le retour d'OAuth
enchaîne une synchronisation, qui le déclenche.

## D62 — Les commandes d'administration se lancent dans le conteneur, pas sur l'hôte

**Contexte.** `deploy/cloud-init.yaml` (D52) monte une machine avec Docker,
`rclone`, Tailscale et `ufw` — et rien d'autre. Le `README.md`, lui, faisait
créer le premier administrateur par `pnpm install && pnpm create-admin alexis`
sur le serveur. Les deux ne pouvaient pas être vrais en même temps : il n'y a ni
Node ni pnpm sur cette machine, et l'installation s'arrêtait donc sur une base
sans aucun compte, à l'étape qui devait la rendre utilisable.

**Choix.** Ne rien ajouter à la machine, et documenter la forme compilée du
script, celle que `tsc` écrit dans `dist/scripts/` et que le `Dockerfile` copie
dans l'image :

```bash
docker compose exec app node packages/server/dist/scripts/create-admin.js <identifiant>
```

`docker compose run --rm app node …` rend le même service avant le premier
démarrage — utile pour créer l'administrateur sur une base qui n'existe pas
encore. `pnpm create-admin` reste la forme du développement local, où pnpm est
là par construction.

**Écarté.** Installer Node et pnpm dans le cloud-init : c'est un second runtime
à tenir à jour sur l'hôte, une divergence de version possible avec celle de
l'image, et l'obligation d'un `pnpm install` sur le serveur — pour une commande
qu'on lance deux fois dans la vie d'une instance. Écarté aussi un
`deploy/create-admin.sh` enveloppant le `docker compose exec` : il cache un
chemin qu'il faut de toute façon connaître le jour où l'on veut lancer un autre
script, et ajoute un fichier à maintenir pour économiser une ligne.

**Ce qui rend l'appel sûr.** L'écriture vient d'un **processus distinct** de
celui du serveur. L'instantané mémoire de `ConfigRepo` se reconstruit sur
`PRAGMA data_version`, qui ne bouge que pour les écritures venues d'ailleurs :
un compte créé pendant que l'application tourne est donc visible sans
redémarrage. La même commande exécutée _dans_ le processus serveur, elle,
servirait un état périmé — c'est la raison pour laquelle il n'existe pas de
route d'administration équivalente.

**Conséquences.** Toute commande de `packages/server/src/scripts/` ajoutée plus
tard hérite de cette contrainte : si elle a un sens en production, son invocation
`pnpm` ne suffit pas à la documenter. `hash-password` fait exception sans effort
— il ne sert qu'à préparer un `albums.yaml` d'amorçage, donc avant tout
déploiement.

## D63 — Le dépôt ne privilégie aucun hébergeur, et ne crée pas de compte nominatif

**Contexte.** D52 a doté le dépôt d'un cloud-init et de deux scripts, mais les a
écrits pour la machine qu'on avait sous la main : le `README.md` déroulait une
procédure Scaleway comme s'il n'y avait qu'elle, le cloud-init citait `scw` en
en-tête, la console de secours était nommée « console série Scaleway », le
remote de sauvegarde par défaut s'appelait `scaleway:`, et le compte système
portait le prénom de l'auteur. Rien de tout cela n'est faux ; tout cela devient
gênant dès que le dépôt est public, où un lecteur lit un choix par défaut là où
il n'y avait qu'une habitude.

**Choix.** Le corps de la procédure ne nomme aucun fournisseur. Il énonce ce
qu'il faut obtenir — une image Debian 12+ ou Ubuntu LTS, un cloud-init passé en
« user data », les ports 80/443 ouverts et le 22 le temps de l'amorçage, un
enregistrement DNS — et les CLI de trois hébergeurs figurent dans un bloc
`<details>`, à égalité, présentés comme des illustrations de la même opération.
Le compte système devient `deploy` : un rôle, pas une personne. Le remote de
sauvegarde par défaut devient `sauvegardes:gdv`, sans marque.

**Écarté.** Ne garder aucune commande d'hébergeur : le plus neutre, mais on perd
le chemin prêt-à-coller, y compris pour qui déploie pour la première fois — et
une documentation qu'il faut compléter ailleurs est une documentation qu'on ne
suit pas. Écarté aussi un exemple à fournisseur générique (`<provider-cli>`) :
neutre en apparence, mais inexécutable, donc jamais vérifié.

**Ce que ça n'entraîne pas.** Tailscale reste nommé, et c'est assumé : ce n'est
pas un hébergeur mais un choix d'architecture d'accès, celui qui permet de
fermer le port 22 sans rien ouvrir en échange. Le `README.md` dit explicitement
qu'un WireGuard nu, un bastion ou un filtrage par IP source rendent le même
service, et que seule l'étape 2 change alors.

**Conséquences.** Une instance déjà amorcée par la version précédente du
cloud-init tourne sous le compte `alexis` : le renommage ne vaut que pour les
machines créées ensuite, et il n'y a rien à migrer — les chemins de
`deploy/backup.sh` et de `deploy/deploy.sh` sont relatifs au dépôt, pas au
répertoire personnel. Seule la ligne de `crontab` du `README.md`, qui cite un
chemin absolu, est à lire avec le nom de compte réel de la machine.

## D64 — La procédure de déploiement vit à côté des scripts, pas dans le README racine

**Contexte.** À force d'y ajouter ce qui manquait — durcissement (D47), scripts
et cloud-init (D52), neutralité vis-à-vis de l'hébergeur (D63) —, le `README.md`
de la racine avait atteint sept cents lignes, dont plus des trois quarts ne
concernaient que l'installation d'un serveur. Quelqu'un qui découvre le projet
devait traverser une procédure Let's Encrypt, une console Google Cloud et une
restauration de volume pour trouver `pnpm dev`.

**Choix.** Le `README.md` de la racine dit ce qu'est l'application, ce qu'elle
fait, comment la lancer en local, et rien d'autre — plus trois liens. Toute la
procédure serveur, l'exploitation et la sauvegarde partent dans
`deploy/README.md`, dans le répertoire des scripts qu'elle décrit. Trois
documents, trois lecteurs : celui qui découvre, celui qui exploite, celui qui
reprend le code (`specs/`).

**Écarté.** Garder un seul fichier et se contenter d'une table des matières : le
problème n'est pas la navigation mais le poids — un README long se lit comme un
projet compliqué, quelle que soit sa table des matières. Écarté aussi un
répertoire `docs/` : il éloigne la procédure des scripts qu'elle décrit, alors
que le point de `deploy/README.md` est justement d'être lu en même temps que
`cloud-init.yaml` et `backup.sh`, et mis à jour dans le même geste.

**Conséquences.** La règle de mise à jour du `CLAUDE.md` change de cible : une
modification de `deploy/` met à jour `specs/06` **et `deploy/README.md`**, plus
la racine. Les renvois de `deploy/cloud-init.yaml` et de `specs/06` pointent
désormais vers `deploy/README.md`. `tools/check-specs.mjs` n'est pas concerné :
il ne lit aucun README, il compare le code aux specs.

Le coût annoncé de la scission était qu'un lien mort ne serait signalé par rien.
Il ne l'est plus : `tools/check-links.mjs` résout chaque lien relatif et chaque
ancre des trois documents, et tourne dans `pnpm verify` comme sur `pre-push`.
Les renvois restent néanmoins peu nombreux et tous relatifs — un contrôle qui
attrape les liens cassés ne rend pas souhaitable d'en écrire davantage.

## D65 — Le sujet du mail de code nomme l'instance, pas le code

**Contexte.** Le mail de vérification portait le code en tête de son sujet —
`864781 — code de vérification`. L'intention était pratique : sur un téléphone,
la bannière de notification suffisait à lire le code sans ouvrir sa boîte. Le
corps, lui, n'a jamais nommé l'instance en HTML, alors que la version texte le
faisait ; les deux versions avaient divergé, et c'est le HTML que la
destinataire voit.

Un sujet est la partie d'un email qui fuit le plus : il s'affiche sur un écran
verrouillé, reste en clair dans l'historique des notifications du système, tient
dans une capture d'écran envoyée à quelqu'un pour demander de l'aide, et
s'affiche par-dessus l'épaule dans une liste de messages. Le corps demande, lui,
d'ouvrir le message.

**Choix.** Le sujet devient `Code de vérification — <hôte de PUBLIC_URL>`. Le
code ne figure plus que dans le corps, dans les deux versions. Le corps rappelle
en outre le geste qui a déclenché l'envoi, nomme l'hôte, et dit que le code vaut
quinze minutes et ne sert qu'une fois — ce dernier point est exact,
`CommenterRepo.verify` efface `code_hash` au succès.

**Écarté.** Garder le code dans le sujet et se contenter d'y ajouter l'hôte :
cela allonge la ligne là où les clients tronquent, sans rien retirer aux chemins
de fuite ci-dessus. Écarté aussi : un lien de vérification cliquable, qui
supprimerait la recopie — il ouvrirait une seconde session dans un autre
navigateur, alors que la personne attend dans l'onglet où elle a demandé le
code. Écarté enfin : encadrer le code dans un bloc dessiné, et le grouper en
`123 456` — la seconde forme ne se recolle pas dans un champ que `verify` valide
à six caractères après `trim()`. L'aération reste un `letter-spacing`, qui ne
touche pas à la chaîne copiée.

**Conséquences.** Le confort de lecture depuis la bannière est perdu : il faut
ouvrir le message. C'est le prix assumé. Ce mail reste le seul des trois sans
lien cliquable, ce qui le distingue de `buildCommentMail` et
`buildAlbumUpdateMail` — une future harmonisation du gabarit ne doit pas lui en
ajouter un au passage. `PUBLIC_URL` gagne un rôle de plus : mal renseignée, elle
nomme la mauvaise instance dans le sujet, et non plus seulement des liens qui ne
mènent nulle part.

## D66 — L'administration se navigue par rubriques, une par URL

**Contexte.** `/admin` empilait six sections dans une seule colonne. Tant que la
file de modération tenait dans un écran, la page se parcourait ; depuis qu'elle
est paginée, la page n'a plus de fin, et « Réglages » comme « Maintenance » se
retrouvent derrière des dizaines de commentaires. Le bandeau de message était
déjà collé sous la barre supérieure précisément parce qu'on ne l'aurait plus vu
autrement — un symptôme traité, pas la cause.

**Choix.** Quatre rubriques, chacune à son URL : `/admin/albums`,
`/admin/comptes`, `/admin/commentaires`, `/admin/serveur`. Une colonne de
navigation à gauche à partir de `md`, collante pour rester sous les yeux pendant
qu'on modère ; en dessous, une rangée qui défile horizontalement. `AdminNav`
expose `ADMIN_TABS`, que `AdminPage` réutilise pour valider le paramètre `:tab`,
et chaque rubrique ne monte que les attentes qui la concernent — la file de
modération n'affiche plus le chargement des albums.

Les trois sections du serveur — connexion Drive, réglages, maintenance —
restent groupées : elles répondent toutes à « comment tourne cette instance »,
et les séparer aurait donné trois pages d'une section chacune.

**Écarté.** Des onglets en état local, sans toucher aux URL : un rechargement
perd la rubrique, le retour du navigateur quitte l'administration au lieu de
revenir à la rubrique précédente, et surtout le retour de consentement Google
n'a plus de destination à nommer — il revient sur la page, pas sur la rubrique
d'où l'on est parti. Écarté aussi un accordéon, qui garde une page unique et
n'enlève rien au défilement dès qu'une section est ouverte. Écartée enfin une
entrée de navigation par section, six pour six : cela reproduit dans la marge la
liste qu'on cherche justement à raccourcir.

**Conséquences.** `/admin` redirige vers `/admin/albums` : les signets et le
bouton de la barre supérieure restent valides. Le callback OAuth redirige
désormais vers `/admin/serveur?oauth=<raison>`, la rubrique qui porte le bouton
de connexion. La section « Utilisateurs » devient « Comptes », pour s'aligner
sur « Nouveau compte » et sur le libellé de la rubrique. Une rubrique ajoutée
plus tard s'écrit dans `ADMIN_TABS` et nulle part ailleurs ; en revanche, une
section déplacée d'une rubrique à l'autre change une URL que quelqu'un a pu
mettre en signet — c'est le prix de la rubrique dans l'URL, et il est faible
devant ce qu'elle rend possible.

## D67 — La file de modération est une liste de travail, pas un flux

**Contexte.** La file rendait cinquante lignes antéchronologiques, un bouton
« Charger plus » qui empilait, et deux filtres — tout, ou masqué. Trois défauts,
tous mesurables :

- chaque masquage invalidait la file, et TanStack Query recharge **toutes** les
  pages d'une requête infinie : après quatre « Charger plus », un seul clic sur
  « Masquer » redemandait deux cents lignes ;
- rien ne disait si les lignes affichées étaient tout le corpus ou le centième ;
- on ne pouvait ni chercher, ni restreindre à un album, ni voir seulement ce qui
  est encore en ligne.

Or on ne parcourt pas une file de modération, on y arrive avec une intention :
un message dont on nous a parlé, ce qui s'est dit hier, tout ce qu'a écrit une
adresse.

**Choix.** Une page à la fois, vingt-cinq lignes, avec `‹ Précédent` et
`Suivant ›` — une pile de curseurs côté client tient le chemin parcouru, seul
moyen de revenir en arrière avec une pagination par curseur. La réponse porte
`total`, compté **sans le curseur** : c'est la taille du corpus filtré, pas celle
du reste. Trois filtres qui partitionnent (`all`, `visible`, `hidden`), un filtre
d'album, et une recherche sur le corps, le nom déclaré et l'adresse. La page
affichée est rangée par journée puis par photo, côté client. Enfin, une action
groupée par identité : masquer d'un coup tous les messages d'une adresse.

La journée du regroupement est celle du **lecteur**, pas UTC — troisième
exception à la règle du dépôt, et pour la raison déjà écrite en D31 et dans
`format.ts` : `created_at` est un instant réel, pas une heure murale d'appareil.

**Écarté.** Garder le défilement infini en n'ajoutant que le total : le compte
manquant n'était qu'un des trois défauts, et le plus visible — le rechargement
complet à chaque geste serait resté. Écartées aussi les pages numérotées en
`OFFSET` : elles offrent l'accès direct à la page 5, mais leur numérotation
glisse dès qu'un commentaire arrive pendant la modération, et le dépôt a déjà
tranché contre `OFFSET` pour les médias (voir la pagination par curseur en
[03](./03-modele-de-donnees.md)). Écartée enfin une table FTS5 en `unicode61`
pour la recherche : une table virtuelle et des déclencheurs de synchronisation à
maintenir pour un corpus de quelques milliers de lignes, alors qu'un `LIKE`
échappé y répond en microsecondes.

**Conséquences.** Le regroupement ne vaut que pour la page reçue : une photo dont
les commentaires enjambent une frontière de page apparaît des deux côtés. Faire
autrement supposerait un serveur qui pagine des groupes entiers, donc des pages
de taille inconnue. La casse n'est repliée que sur l'ASCII — chercher « Éric » ne
trouve pas « éric », limite de `LIKE` en SQLite, et c'est ce que la table FTS
aurait corrigé. **Aucun index n'a été ajouté** : une recherche `LIKE '%…%'` est
un parcours qu'aucun index ne sert, et le corpus est borné par ce que des humains
écrivent ; à revoir au-delà de la dizaine de milliers de commentaires, où le
`COUNT(*)` de chaque page se paierait. L'action groupée, elle, ne bannit
personne : elle retire des messages, l'identité peut toujours écrire. Fermer la
porte reste l'affaire de la clé d'accès, que la file affiche à côté de chaque
message.

## D68 — Le repli d'une journée est une donnée du layout, et ne survit pas à la page

**Contexte.** Le découpage par jour ne se voyait pas. Un en-tête de section
suivi de deux cents vignettes, puis un autre en-tête : rien, dans le défilement,
ne dit où une journée s'arrête et où la suivante commence. Le remède demandé
était de pouvoir replier une journée pour lire l'album comme un sommaire.

Deux questions se posaient : où le repli agit, et jusqu'où il dure.

**Choix.** Le repli est une **entrée de `computeLayout`**
(`LayoutOptions.isCollapsed`), pas un masquage au rendu. Une section repliée ne
place aucune ligne : sa hauteur vaut exactement celle de son en-tête, et les
sections suivantes remontent d'autant. C'est la seule position tenable, parce
que `totalHeight` gouverne la barre de défilement et la virtualisation — un
`display: none` posé après coup laisserait la page haute de tout ce qu'elle
n'affiche plus, et la barre mentirait sur ce qui reste à parcourir.

Le repli agit **au niveau de la section**, pas de la journée. Les deux
découpages en profitent pour le même code ; le restreindre au jour aurait
demandé une condition de plus, pour rien. Les clés ne se confondent pas
(`2026-07` contre `2026-07-14`), un seul ensemble les porte donc toutes.

L'état vit dans un `useState` d'`AlbumPage`, **en mémoire seule**.

**Écarté.** L'URL, comme `?photo=` et `?order=` : une liste de jours repliés y
tiendrait mal — vingt clés de dix caractères — et rendrait illisible ce qui est
aussi ce qu'on partage. Écarté aussi `localStorage`, à la manière de
`lib/seenComments.ts` : rouvrir des mois plus tard un album dont tout est replié
sans se rappeler l'avoir fait est un défaut plus coûteux que de redéplier une
journée. Le repli sert à parcourir maintenant, pas à configurer une vue.

**Conséquences.** `LayoutSection` porte `count` et `collapsed`. `count` n'est
pas déductible de `rows` — une section repliée n'en a plus, et c'est justement
là que son en-tête doit annoncer ce qu'elle cache.

Surtout, **`moveSelection` change de repère**. Elle travaillait dans l'espace
des index de la liste d'origine, où `gauche`/`droite` valaient `± 1`. Les deux
espaces coïncidaient tant que la grille montrait tout ; une section repliée les
sépare. La navigation se fait désormais dans l'ordre des cellules réellement
placées (`layout.rows`), faute de quoi une flèche enverrait la sélection sur une
vignette absente du layout : plus rien à mettre en évidence, et
`scrollSelectionIntoView` sans cible. Le paramètre `totalItems` disparaît, le
layout portant seul cette information.

La visionneuse, elle, **ignore le repli** et continue de parcourir l'album
entier. Replier est une aide à la lecture de la grille, pas un filtre : une
flèche qui sauterait silencieusement quarante photos parce qu'une journée est
fermée ailleurs serait un piège.

## D69 — La progression de la visionneuse se compte sur l'album, pas sur la liste chargée

**Contexte.** La visionneuse affichait `index + 1 / items.length`. `items` est
la liste **paginée** : elle grandit au fil du défilement et des préchargements.
Le dénominateur montait donc en cours de route — « 40 / 50 » redevenait
« 40 / 100 » sous les yeux de qui feuillette, puis « 40 / 150 ». Le seul moment
où le compteur disait vrai était la dernière page atteinte.

**Choix.** Le dénominateur est `album.itemCount`, transmis à la visionneuse en
`total`. C'est le compte que le serveur tient pour l'album, indépendant de ce
qui est chargé, et déjà affiché en sous-titre de la page. Le rendu retient
`Math.max(total, items.length)` : une synchronisation qui ajoute des médias
pendant qu'on feuillette ne doit pas produire « 60 / 50 ».

**Écarté.** Masquer le compteur tant que la pagination n'est pas finie : c'est
précisément au milieu d'un long album qu'on veut savoir où l'on en est. Écarté
aussi de charger l'album entier à l'ouverture de la visionneuse pour rendre
`items.length` exact — des milliers de lignes pour afficher un nombre.

**Conséquences.** La progression devient une barre, doublée du rapport chiffré.
Un rapport de deux nombres demande une lecture ; une barre se voit. Elle est
collée au **bord haut** de la visionneuse, sur toute la largeur et épaisse de
deux pixels : posée plus bas, dans le flux de l'en-tête, elle barrait la photo
d'un trait de couleur. Au bord, elle se lit comme une barre de chargement et ne
dispute rien à l'image.

## D70 — La note d'une journée quitte l'en-tête de la visionneuse sur mobile

**Contexte.** La note d'une journée s'affiche à deux endroits : l'en-tête de sa
section dans la grille, et l'en-tête de la visionneuse, pour qu'ouvrir une photo
ne fasse pas perdre ce qui lui donne son sens (D68 en décrit le voisin, le
repli). Sur un téléphone, ce second emplacement empile au-dessus de l'image le
nom du fichier, la journée, son lieu, puis jusqu'à deux lignes de note — sur un
écran où la photo est déjà à l'étroit.

Deux réglages pris par ailleurs changent l'arbitrage : la grille affiche
désormais la note à **toutes** les largeurs, et le panneau « Infos » est fermé
par défaut. La note n'est donc plus une information qu'on risque de ne jamais
voir si la visionneuse ne la porte pas.

**Choix.** La note reste dans l'en-tête de la visionneuse à partir de `md`, et
en disparaît en dessous. Le seuil n'est pas choisi au jugé : `md` est la largeur
où `SidePanel` cesse d'être un tiroir en surimpression pour se docker dans le
flux — la frontière déjà établie entre « mise en page de téléphone » et le
reste.

**Écarté.** Masquer toute la ligne de contexte, lieu et date compris. Elle tient
sur une ligne courte, là où la note en prend deux, et c'est précisément ce qu'on
perd en ouvrant une photo depuis la grille : la masquer annulerait la raison
d'avoir porté ce contexte jusqu'ici. Le gain de place aurait été marginal, la
perte entière.

Écarté aussi un dépliement au toucher — un geste de plus sur l'appareil où les
gestes sont les plus rares, pour un texte que la grille montre déjà.

**Conséquences.** Sur mobile, la note n'était plus atteignable que depuis la
grille : `ExifPanel` ne listait alors que l'EXIF. Le recours annoncé ici comme
« un ajout à faire » a été fait dans la foulée — [D74](./08-decisions.md) lui
donne ses lignes « Lieu » et « Ce jour-là », sans condition de largeur. Le choix
ci-dessus est inchangé : l'en-tête reste réservé à `md` et au-delà, seul le
constat de la conséquence a cessé d'être vrai.

L'enveloppe du paragraphe porte le `hidden md:block`, et non le paragraphe
lui-même : `line-clamp-2` pose `display: -webkit-box`, et deux utilitaires de
`display` sur un même élément se départagent par l'ordre de la feuille de style,
pas par celui des classes de l'attribut.
---

## D71 — Le service worker met en cache la coquille, jamais les photos

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

---

## D72 — Le nom de l'instance vit dans le `.env`, et le serveur le pose dans la coquille

**Contexte.** Une fois installée, l'application s'appelait « Photos » sous
l'icône, quelle que soit l'instance. C'est le nom qui compte le plus dans tout
le projet : il est le seul que voie quelqu'un qui ne l'a pas installée
lui-même, et deux galeries posées sur le même téléphone porteraient le même.
Le nom apparaît à quatre endroits — le `<title>`, `apple-mobile-web-app-title`,
`application-name`, et `name`/`short_name` du manifeste.

**Choix.** `APP_NAME`, avec `Photos` pour défaut. `index.html` et
`manifest.webmanifest` gardent ce défaut en dur, et le serveur y substitue la
valeur configurée **au démarrage**, une fois, en mémoire (`shell.ts`). Les deux
fichiers deviennent des routes exactes, prioritaires sur `@fastify/static`. Le
front relit le nom dans la balise `application-name` du DOM.

**Écarté.** Une constante de build (`import.meta.env`) : une seule image sert
toutes les installations, et reconstruire un conteneur pour renommer sa galerie
est hors de proportion. Écarté aussi : un réglage en base, à côté des comptes et
des albums — il faudrait qu'il vaille avant qu'aucun compte n'existe, puisque la
première page servie est justement l'écran de connexion, et `ConfigRepo` ne
répond pas à cette question-là. Écarté enfin : exposer le nom dans une réponse
d'API que le front lirait au démarrage. Cela ajoutait un champ au contrat, un
état de chargement, et surtout un instant où la page s'affiche sans son nom —
alors que le serveur peut simplement l'avoir déjà écrit dans l'HTML qu'il rend.

Écarté également : remplacer la chaîne « Photos » partout dans le fichier. La
substitution vise trois emplacements nommés, parce qu'un remplacement global
renommerait aussi un commentaire ou un futur texte d'interface qui contiendrait
le mot.

**Conséquences.** Substituer dans du HTML par expression régulière n'est
défendable que parce que le gabarit appartient au dépôt : ce n'est pas de
l'analyse de HTML, c'est un gabarit dont on connaît les trous. Le risque réel
est silencieux — ajouter un attribut à la balise `<title>`, intervertir `name`
et `content` dans une `<meta>`, et le motif ne correspond plus sans que rien ne
casse : le serveur démarre, la page s'affiche, elle porte le mauvais nom.
`test/shell.test.ts` fait donc tourner la substitution sur le **vrai**
`index.html`, pas sur une chaîne d'exemple.

Le nom est échappé avant d'entrer dans l'HTML. Il vient du `.env` de
l'exploitant et non d'un visiteur, mais un `"` suffit à sortir d'un attribut, et
personne ne relit son `.env` en se demandant s'il est du HTML valide.

L'icône, elle, **n'est pas** configurable : ce serait un fichier à monter dans
le conteneur, donc un volume de plus dans le compose et une procédure dans
`deploy/README.md`, pour un besoin que personne n'a encore exprimé. Le jour où
il se pose, `WEB_DIR` est déjà surchargeable.

---

## D73 — La barre supérieure tient sur une rangée, et déclare ses contrôles au lieu de les rendre

**Contexte.** Sur un téléphone, la barre montait à **101 px** — deux rangées. La
première alignait le retour, le titre, « Admin » et « Déconnexion », soit 169 px
de boutons texte qui ramenaient le titre d'album à `D.` et le sous-titre à
`120 éléments · févri…`. La seconde ne portait que les deux bascules de vue,
réduites à des icônes muettes occupant 80 px sur 393. Sur une application dont
le principe est que le chrome ne doit pas concurrencer les photos, 12 % de la
hauteur d'écran.

**Choix.** Une rangée à toutes les largeurs (65 px). Sous `sm`, tout ce qui n'est
ni le retour ni le titre passe dans un menu où chaque entrée porte enfin un
libellé — « Regrouper par jour » plutôt qu'une icône de calendrier. De `sm` à
`lg`, les contrôles reviennent dans la barre en icônes seules. À partir de `lg`,
les libellés reparaissent.

Pour que le même contrôle sache se rendre des deux façons, `TopBar` cesse de
prendre des `children` et prend un tableau d'`actions` — `label`, `action`,
`icon`, `onSelect`.

**Écarté.** Ne mettre que les actions de compte dans le menu et laisser les
bascules de vue en icônes dans la barre : cela gardait un tap pour inverser le
tri, mais laissait les deux icônes sans nom au toucher, où aucune infobulle ne
s'affiche — c'était l'autre moitié du problème.

Écarté aussi : le kebab à toutes les largeurs. Il aurait donné un seul
comportement à écrire et à documenter, mais un écran large n'a aucune raison de
cacher cinq contrôles derrière un tap.

Écarté enfin : faire apparaître les libellés dès `md`. Mesuré à 768 px, les cinq
libellés ramenaient le titre de 456 à 144 px et tronquaient le sous-titre — le
défaut même qu'on corrigeait. `lg` est le premier seuil où les deux tiennent.

**Conséquences.** Le libellé d'une entrée de menu est l'`action`, pas le `label` :
une ligne de menu dit ce qu'elle fait, un bouton de barre dit où l'on en est.
Les deux textes existaient déjà, ils ne servaient simplement pas au même endroit.

`InstallButton` disparaît. Son état passe dans `useInstallPrompt`, parce que la
proposition s'affiche désormais à deux endroits selon la largeur et qu'un état
dupliqué aurait divergé — le bouton disparaissant après `appinstalled`, la ligne
de menu non. Le mode d'emploi iOS devient `InstallInstructions`.

**Installer se place en dernier, après « Déconnexion »**, contre l'habitude qui
met la déconnexion en fin de menu. La raison : c'est la seule entrée qui
apparaît et disparaît toute seule, selon le navigateur et selon qu'on a déjà
installé. Ailleurs, elle décalerait les contrôles permanents d'une visite à
l'autre.

---

## D74 — La visionneuse range ses actions, et rend à la photo la note de sa journée

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
`TopBar` ([D73](./08-decisions.md)). Ce qui compte dans ce composant n'est pas
son dessin mais ses trois règles de fermeture — clic dehors, `Échap` avec
restitution du focus, fermeture avant l'action — et elles se seraient réécrites
de travers la deuxième fois. Son écoute de `Échap` est en capture et arrête la
propagation, sans quoi un seul appui fermerait le menu **et** la photo.

---

## D75 — Le formatage et la numérotation des décisions sont contrôlés, plus laissés à la vigilance

**Contexte.** Deux dérives silencieuses se sont installées, chacune parce que
rien ne la mesurait.

Le formatage d'abord. `pnpm verify` enchaînait typecheck, lint, tests,
`check:specs` et `check:links` — pas de Prettier. `pnpm format` existait, en
écriture seule, et ne s'exécutait que si on y pensait. Cinq fichiers de `main`
s'en écartaient. Le coût réel n'est pas l'esthétique : la personne suivante qui
lance `pnpm format` reformate au passage le travail de quelqu'un d'autre, et son
diff mélange son correctif à des retouches qui ne sont pas les siennes.

La numérotation des décisions ensuite. Elle se fait à la main, et rien ne
l'arbitrait. Une entrée a été numérotée `D60` alors que le fichier allait
jusqu'à `D64` : `main` a porté deux `## D60`. Puis trois branches parallèles ont
chacune ajouté « la suivante » — toutes les trois `D65`, sans se voir, puisque
chacune partait du même dernier numéro. Le défaut le plus coûteux n'est pourtant
ni l'un ni l'autre : c'est le renvoi `(Dxx)` décalé, qui reste syntaxiquement
correct et désigne une décision qui parle d'autre chose. Il ne casse rien, se
lit sans accroc, et raconte faux.

**Choix.** `check:format` — un `prettier --check .` — entre dans `verify`, à
côté de `lint` : deux barrières de style, au même endroit. Et `check-specs.mjs`
gagne une section « Décisions » qui refuse un numéro défini deux fois, ainsi
qu'un renvoi `(Dxx)` vers une entrée absente, dans les specs **comme dans le
code** — un commentaire qui justifie une ligne par une décision est la forme la
plus utile du renvoi, et la plus facile à laisser pourrir.

**Écarté.** Un `pre-commit` qui lancerait `prettier --write` : il réécrit les
fichiers sous les doigts de qui commite, et le dépôt a déjà tranché contre
`pre-commit` au profit de `pre-push` — commiter une étape intermédiaire est
légitime, publier un état qui ment ne l'est pas.

Écarté aussi : attribuer les numéros automatiquement. Un outil qui renumérote
réécrit des entrées publiées et les renvois qui les visent, ce qui contredit la
règle « nouvelle entrée, on ne réécrit pas les anciennes ». Le contrôle constate,
il n'arbitre pas.

Écarté enfin : signaler les trous dans la suite. Un trou est sans conséquence,
et le contrôle se déclencherait sur un retrait légitime. Un contrôle bruyant
finit désactivé — c'est déjà la raison d'être de `MODULES_TOLERES`.

Le contrôle ne va pas dans `check-links.mjs`, malgré la parenté : un `(D67)` en
texte brut n'est pas un lien markdown, et un `[D67](./08-decisions.md)` désigne
le fichier, jamais l'entrée. Cet outil résout des chemins et des ancres ; celui
des décisions lit un fichier et compte.

**Conséquences.** `verify` passe de cinq étapes à six. La collision de numéros
n'est pas empêchée — deux branches parallèles peuvent toujours choisir `D65`
chacune de leur côté, et rien ne peut l'éviter tant que le numéro se choisit à
l'écriture. Elle est en revanche impossible à faire atterrir : la seconde échoue
à la fusion, là où le conflit se voit et se résout.

Un renvoi `(Dxx)` dans le code devient porteur : renuméroter une décision sans
suivre ses mentions fait échouer la CI. C'est l'effet recherché, et il vaut pour
les tests et les commentaires autant que pour les specs.

Les cinq fichiers qui avaient dérivé sont reformatés ici, sans rapport avec le
sujet de ce travail : c'est l'arriéré de la dérive, payé une fois.

---

## D76 — La sauvegarde emporte `config/`, parce que la clé du compte de service ne se retéléchargesse pas

**Contexte.** `deploy/backup.sh` prenait le volume `gdv-data` et le `.env`. Les
deux vont ensemble, D14 l'explique : le refresh token est chiffré, `TOKEN_KEY`
seul le déchiffre, une archive sans son `.env` impose un nouveau consentement.

Ce raisonnement était complet tant que Drive passait uniquement par OAuth, le
jeton vivant dans la base. L'authentification par compte de service (D50) a
déplacé l'accès à Drive dans un fichier monté depuis l'hôte,
`config/service-account.json` — ni dans le volume, ni dans le `.env`. Le script a
pourtant été écrit trois jours après elle, et ne l'a pas pris.

La spec, elle, l'avait vu : le tableau des montages de `06` porte déjà
« **Oui, si la clé y est** » sur `./config`. Ce n'est donc pas un arbitrage qu'on
révise, c'est un écart entre un script et sa propre spec.

**Ce que ça coûtait.** Une restauration rendait la base, les comptes, les albums
et les réglages — et aucun accès à Drive. Google ne délivre le JSON d'une clé
qu'à sa création. La panne n'apparaît pas à la restauration : l'application
démarre, `/admin` répond, les albums sont là. Elle apparaît à la première
synchronisation, quand plus rien ne remonte.

**Décision.** `backup.sh` archive `config/` en troisième pièce, à côté du `.env`,
sous `gdv-<horodatage>.config.tgz`.

Le répertoire entier plutôt qu'une liste de fichiers : filtrer supposerait de
tenir un motif en phase avec `.gitignore`, et l'exemple d'albums suivi par git
qui voyage avec pèse deux kilo-octets.

L'extension `.tgz` n'est pas une coquetterie. L'élagage distingue les archives
par motif, et `gdv-*.tar.gz` engloberait celle-ci : la rétention tomberait de
sept sauvegardes réelles à trois, sans un message. Un troisième `elaguer` lui est
consacré.

**Écarté.** Fondre `config/` dans l'archive du volume. Il aurait fallu préfixer
les deux arborescences pour qu'elles ne se recouvrent pas, donc changer la
disposition interne de l'archive — et la commande de restauration documentée
(`tar xzf … -C /data`) aurait cessé de convenir aux archives déjà produites. Une
sauvegarde qu'on ne sait plus restaurer avec la procédure publiée est le défaut
que ce travail corrige, pas celui qu'il introduit.

**Conséquences.** Une instance en OAuth n'a pas de `config/` à sauvegarder ; le
script le constate et n'échoue pas. Les archives antérieures à cette entrée se
restaurent inchangées, sans la clé : la reconstituer coûte trois clics dans la
console Google, et ne demande de repartager aucun album — les dossiers sont
partagés avec le compte, jamais avec l'une de ses clés.

L'archive contient désormais, pour une instance en compte de service, de quoi
lire les dossiers Drive partagés. C'était déjà le cas d'une instance en OAuth,
dont l'archive porte le jeton chiffré **et** sa clé. La différence est qu'une clé
de compte de service n'expire pas : la destination de sauvegarde doit être
traitée comme un dépôt de secrets, ce que `deploy/README.md` recommande déjà en
la chiffrant.

---

## D77 — `touch-action: pinch-zoom` sur la colonne photo, sans quoi aucun geste au doigt n'aboutit

**Contexte.** Sur téléphone, le déplacement dans une photo agrandie était décrit
comme « très très lent, quasi inutilisable », et le repère de position
« décrochait » dès qu'on bougeait. Ce n'était pas de la lenteur : le geste
mourait en route. Aucun `touch-action` n'était déclaré nulle part dans le front,
et avec la valeur par défaut `auto` le navigateur garde le droit de lire un
glissement d'un doigt comme un défilement. Il tranche en ce sens au bout d'un ou
deux `pointermove`, émet `pointercancel`, et les gestionnaires abandonnent —
seuls les quelques mouvements reçus avant l'arbitrage s'appliquent.

`setPointerCapture` ne protège pas de ça, contrairement à ce que son nom laisse
espérer : la capture garantit de recevoir la suite des événements, elle n'empêche
pas le navigateur d'annuler le geste.

La mesure a montré que **le balayage d'une photo à l'autre tombait de la même
façon** — il n'atteignait jamais son `pointerup`, donc ne changeait jamais de
photo. Deux gestes, un seul défaut.

| Geste, en émulation Pixel 10 | `pointermove` | `pointercancel` | Résultat            |
| ---------------------------- | ------------- | --------------- | ------------------- |
| Déplacement zoomé, `auto`    | 2             | 1               | 24 px sur 240       |
| Déplacement zoomé, corrigé   | 20            | 0               | 240 px sur 240      |
| Repère de position, `auto`   | 2             | 1               | atterrit à l'opposé |
| Repère de position, corrigé  | 12            | 0               | le point visé       |
| Balayage, `auto`             | 1             | 1               | aucun changement    |
| Balayage, corrigé            | 10            | 0               | photo suivante      |

**Choix.** `touch-action: pinch-zoom` sur la colonne photo de la visionneuse,
en permanence.

**`pinch-zoom` plutôt que `none`.** Les deux suppriment l'arbitrage, mais `none`
emporte aussi le pincement à deux doigts — le geste de zoom spontané sur
téléphone, que la visionneuse ne cherche pas à remplacer et dont elle guette
l'échelle pour charger la variante `hd` ([D20](./08-decisions.md)). `pinch-zoom`
ne retire que le défilement à un doigt, ce qui est exactement ce dont personne
n'a besoin là : sous la visionneuse, rien ne défile.

**Sur la colonne plutôt que sur le conteneur de `ZoomableImage`.** La règle est
la même pour tout ce qui vit dans cette colonne, et un descendant en hérite par
intersection — le repère de position, qui déclare `auto`, est protégé par la
colonne sans avoir à le dire. Une déclaration au lieu de trois, et le balayage,
qui vit dans `Lightbox`, est couvert par la même.

**En permanence plutôt que pendant le seul zoom.** Poser la valeur à
l'agrandissement aurait laissé le balayage cassé, et fait dépendre un
comportement du navigateur d'un changement de classe entre deux rendus. Le seul
geste au doigt qu'on retire hors zoom est un défilement qui n'a rien à faire
défiler.

**Écarté.** La vidéo, exclue : ses contrôles natifs de lecture ont leur propre
traitement du toucher, et le balayage y est déjà désactivé — rien ne justifiait
d'y toucher sans pouvoir l'éprouver.

**Conséquences.** Le double-tap pour zoomer, que le navigateur ajoute sous
`auto`, disparaît sur la colonne photo. C'est sans perte : un tap bref y bascule
déjà le zoom au point visé.

La vérification en automatisation s'arrête là où commence le téléphone.
L'émulation Chromium reproduit l'arbitrage — les chiffres ci-dessus en viennent —
mais pas le pincement à deux doigts, ni la sensation d'un déplacement, qui était
le défaut d'origine. Ces deux-là ne se contrôlent que sur un vrai appareil :
Playwright synthétise des pointeurs, il ne remplace pas la main.

---

## D78 — Une variable d'environnement doit atteindre le conteneur, et c'est contrôlé

**Contexte.** `APP_NAME` (D72) et `GEOCODING_URL` étaient déclarées dans le
schéma zod d'`env.ts`, dans `.env.example`, et décrites dans `05`, `06` et `08`.
Aucune des deux n'atteignait le processus en production.

Compose ne propage pas l'environnement de l'hôte : seul ce que le bloc
`environment:` énumère parvient au conteneur. Le `.env` que Compose lit ne sert
qu'à **l'interpolation** de ce bloc — écrire une variable dedans qui n'y est
référencée nulle part n'a strictement aucun effet. Les deux variables tombaient
donc systématiquement sur leur défaut zod.

**Ce que ça démentait.** `06` affirmait qu'un redémarrage suffisait à renommer
l'instance ; c'était faux, le nom était figé sur `Photos`. `deploy/README.md`
indiquait qu'une `GEOCODING_URL` vide coupait le géocodage ; c'était faux aussi,
et il s'agit du seul réglage de confidentialité de l'application — les
coordonnées EXIF arrondies au kilomètre partaient chez un tiers sans qu'aucune
manipulation documentée puisse l'empêcher.

Le défaut est de ceux qui ne se voient pas : rien n'échoue, rien n'est journalisé,
et la variable paraît réglable partout où on la lit. `check:specs` ne pouvait pas
l'attraper — il vérifiait qu'une variable est **mentionnée dans les specs**, pas
qu'elle est **câblée jusqu'au conteneur**. Deux propriétés distinctes, et c'est
la seconde qui décide de ce que l'exploitant peut réellement changer.

**Décision.** Les deux variables sont ajoutées au bloc `environment:`, et
`check:specs` compare désormais le schéma zod à `docker-compose.yml` et au
`Dockerfile` : toute variable lue par le serveur sans être transmise par l'un ou
fixée par l'autre fait échouer la CI. Le contrôle porte sur la forme
`NOM: ${NOM…}` et non sur la simple présence du nom — une variable citée dans un
commentaire n'est pas un câblage.

**La nuance qui porte tout le sens : `-` et non `:-`.** `${VAR:-défaut}`
substitue le défaut à une valeur absente **ou vide**. Or vide veut dire quelque
chose : pour `GEOCODING_URL`, « n'appelle aucun service » — avec `:-`, la
désactivation resterait impossible, et le correctif n'aurait corrigé que la
moitié du défaut. `${VAR-défaut}` ne substitue que si la variable est absente.
Retenu pour les deux, y compris `APP_NAME`, dont une valeur vide doit remonter
jusqu'à zod pour être refusée plutôt que silencieusement remplacée.

**Conséquences.** Le défaut de Compose duplique celui de zod pour ces deux
variables — deux endroits à tenir en phase. C'est le prix de la substitution sur
variable absente, que la forme `map` de Compose ne sait pas rendre autrement :
elle ne permet pas d'omettre une clé conditionnellement. Le contrôle ne compare
pas ces défauts entre eux ; il vérifie le câblage, qui est la classe de défaut
observée.

**Écarté.** La forme `environment: - NOM`, qui laisse passer la variable telle
quelle et évite la duplication du défaut. Elle interdit de mélanger les deux
écritures dans un même bloc, ce qui aurait imposé de convertir les onze entrées
existantes — dont trois portent un `:?` qui refuse le démarrage avec un message,
et que la forme liste ne sait pas exprimer.

---

## D79 — Une vidéo illisible le dit et se laisse télécharger, au lieu de charger indéfiniment

**Contexte.** [D6](#d6--pas-de-transcodage-vidéo) écarte le transcodage et en
énonce la conséquence : « un format que le navigateur ne sait pas lire n'est pas
lisible du tout — pas de repli ». La conséquence était juste ; l'interface ne la
traitait pas. La balise `<video>` de la visionneuse écoutait `loadeddata` et rien
d'autre. Un échec de lecture laissait donc `loaded` à `false` pour toujours, et
le tourniquet tournait sur un écran noir, sans un mot.

Deux causes ordinaires, vérifiées l'une et l'autre dans un navigateur :

- **Le codec.** Un iPhone filme en HEVC dès que « Haute efficacité » est actif,
  ce qui est le réglage d'usine. Chrome sur Linux et Windows ne décode pas
  HEVC : `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`. Le cas n'a rien d'exceptionnel
  pour une galerie familiale alimentée depuis des téléphones.
- **La source.** Drive indisponible, jeton révoqué, quota : `/original` répond
  503, et le lecteur s'arrête sur la même erreur silencieuse.

**Décision.** `error` sur la balise remplace le lecteur par un message et un
bouton **Télécharger**. La combinaison affichée n'est pas décidée en JSX mais par
`previewOverlay` (`lib/preview.ts`), qui servait déjà la photo — la vidéo passe
`measured: false`, n'ayant pas d'aperçu serveur à montrer. La règle est ainsi
tenue à un seul endroit, celui qui est testé sur toutes ses combinaisons.

Le message nomme le format plutôt que de dire « une erreur est survenue » : la
vidéo est presque toujours intacte, et lisible sur un autre appareil. Le
téléchargement est le seul repli que D6 laisse — c'est le fichier d'origine, que
le serveur relaie déjà.

**Écarté.** Transcoder à la volée les formats non lus : c'est exactement ce que
D6 refuse, et le motif n'a pas changé. Écarté aussi : sonder `canPlayType` avant
d'afficher, pour prévenir plutôt que constater. La réponse `maybe` de tous les
navigateurs sur `video/mp4` n'apprend rien du codec réellement contenu, et le
`mimeType` de Drive ne descend pas jusqu'au codec — le sondage se tromperait
dans les deux sens, là où `error` constate ce qui s'est réellement passé.

**Conséquences.** Le tourniquet est désormais un état borné : il s'arrête sur
une image ou sur un message. La vignette de la grille, elle, ne change pas —
une vidéo y reste une tuile sobre portant sa durée, et rien ne distingue à cet
endroit celle qui se lira de celle qui ne se lira pas ; il faudrait décoder
pour le savoir.
