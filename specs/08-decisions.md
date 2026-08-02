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
prime, le hook `onRequest` revérifie à chaque fois que l'utilisateur existe
encore dans `albums.yaml` : la config fait autorité, pas le cookie.

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
