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
