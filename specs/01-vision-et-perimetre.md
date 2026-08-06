# 01 — Vision et périmètre

## Le problème

La prévisualisation native de Google Drive est un explorateur de fichiers, pas
une galerie photo : pas de grille justifiée, pas de regroupement chronologique,
pas de tri sur la date de prise de vue, navigation clavier pauvre. Partager un
dossier de photos suppose par ailleurs que le destinataire ait un compte Google,
et un lien de partage Drive donne l'accès à quiconque le récupère.

L'application remplace cette prévisualisation par une galerie auto-hébergée qui
lit le Drive du propriétaire et l'expose derrière un identifiant et un mot de
passe, album par album.

## Pour qui

Deux rôles, et seulement deux :

| Rôle            | Combien              | Ce qu'il fait                                                                      |
| --------------- | -------------------- | ---------------------------------------------------------------------------------- |
| Le propriétaire | Un seul par instance | Connecte son Drive une fois en OAuth, administre comptes et albums depuis `/admin` |
| Les visiteurs   | Quelques comptes     | Se connectent avec un identifiant/mot de passe et consultent leurs albums          |

Un **compte n'est pas une personne** : c'est une clé d'accès, et rien n'interdit
d'en confier une à tout un foyer — c'est même l'usage prévu depuis
`albums.yaml`. Quand il s'agit de signer un commentaire, chacun se déclare avec
son nom et son adresse, vérifiée par un code (voir [04](./04-securite-et-acces.md)).

Un visiteur n'a jamais de compte Google et ne voit jamais une URL Google. Tout
le contenu transite par le serveur, qui l'obtient avec l'unique jeton du
propriétaire.

## Hors périmètre — délibérément

Ces absences ne sont pas des manques à combler, ce sont des choix qui tiennent
le projet à sa taille.

| Absent                                                        | Pourquoi                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toute écriture dans Drive                                     | Le scope demandé est `drive.readonly` (`packages/server/src/drive/service.ts`). Aucun bug de l'app ne peut détruire les originaux.                                                                                         |
| Édition, retouche, rotation persistée                         | Les originaux appartiennent à Drive ; l'app n'en produit que des dérivés jetables.                                                                                                                                         |
| Inscription, mot de passe oublié                              | Les comptes sont créés par le propriétaire depuis `/admin`. Pas de formulaire public, pas de courriel à envoyer.                                                                                                           |
| Partage public par lien                                       | Toute route média exige une session. Un lien copié à un tiers ne lui donne rien.                                                                                                                                           |
| Reconnaissance faciale, recherche, tags                       | Demanderait un traitement du contenu — donc de télécharger tous les originaux, ce que l'indexation évite précisément.                                                                                                      |
| Commentaires publics, ou signés d'un compte Google            | Commenter suppose la session qui donne déjà accès à l'album. Un identifiant tiers ouvrirait une seconde population d'utilisateurs sans droits, à réconcilier avec `user_albums` (D33).                                     |
| Édition d'un commentaire, réactions, mentions, fils imbriqués | Ce qui sépare une conversation sous une photo d'un forum. Un seul niveau de réponse, et la suppression pour se corriger.                                                                                                   |
| Transcodage vidéo                                             | ffmpeg sur un VPS modeste consomme le CPU qu'on n'a pas. Les `Range` sont relayées telles quelles à Drive.                                                                                                                 |
| Albums construits par requête (dates, tags)                   | Un album = un dossier Drive, point. Le mapping reste vérifiable à l'œil dans `/admin`.                                                                                                                                     |
| Correction du lieu **d'une photo**                            | Le lieu se corrige à la journée. Par photo, il faudrait une table d'override hors de `media` — que `upsertMany` réécrit intégralement à chaque sync —, sa fusion partout où le GPS est lu, et un sélecteur de carte (D51). |
| Carte, recherche par lieu                                     | Les coordonnées servent à nommer une journée, pas à explorer. Une carte demanderait une tuile tierce dans une app qui ne fait sortir aucune requête du navigateur.                                                         |
| Multi-tenant, plusieurs Drive                                 | La table `oauth_token` a une contrainte `CHECK (id = 1)` : une instance, un Drive.                                                                                                                                         |

## Les contraintes qui ont guidé la conception

**Un VPS modeste.** Cible : un conteneur, quelques centaines de Mo de RAM,
pas de Postgres à côté, pas de Redis, pas de worker séparé. D'où SQLite en
process, un cache disque avec inventaire en mémoire, un throttle de connexion en
mémoire, une synchronisation séquentielle plutôt que parallèle. Le
`docker-compose.yml` n'a qu'un service.

**Le quota de l'API Drive.** Chaque appel compte, et une galerie qui interroge
Drive à chaque défilement le brûle vite. La parade est un index local rempli par
`files.list`, qui renvoie déjà dimensions et EXIF sans qu'aucun octet de photo
ne soit téléchargé (`packages/server/src/drive/sync.ts`). Un album de plusieurs
milliers de photos s'indexe en une poignée de requêtes.

**Un seul propriétaire de Drive.** Il n'y a qu'un refresh token, chiffré, dans
une table à une ligne. Ça simplifie tout : pas de sélection de compte, pas de
jonction utilisateur↔jeton, un seul point de panne à surveiller dans `/admin`.

**Le réseau du visiteur.** La grille doit être utilisable avant que la moindre
image n'arrive : les dimensions viennent de l'index, la mise en page est donc
calculée à vide et ne bouge plus (voir [07](./07-frontend.md)).

## Ce que ça donne

- Grille justifiée groupée par mois ou par jour, virtualisée, sens chronologique
  basculable. Le découpage par défaut appartient à l'album : un séjour se lit
  par jour, dix ans de photos d'enfants par mois.
- **Une journée peut être annotée**, et porter le lieu que ses photos indiquent.
  Un album n'était qu'une grille datée : rien n'y disait ce qu'on avait fait.
  La note se saisit dans l'album, en face des photos qu'elle décrit ; le lieu se
  déduit des coordonnées EXIF par géocodage inverse en tâche de fond, et se
  corrige à la main quand il tombe à côté. La description de l'album, elle,
  s'affiche enfin — elle était saisie depuis `/admin` sans être montrée nulle
  part.
- Visionneuse plein écran pilotable au clavier, avec EXIF et téléchargement de
  l'original.
- Photos (JPEG, PNG, WebP, HEIC…) et vidéos (MP4, MOV) — tout ce que
  `classify()` reconnaît comme `image/*` ou `video/*`.
- Vignettes WebP générées à la demande, mises en cache sur disque avec éviction
  LRU.
- Commentaires par photo, avec un niveau de réponse, modérés a posteriori depuis
  `/admin` et notifiés par email. Ils sont signés par une **identité** — un nom
  et une adresse vérifiée par code — distincte de la clé d'accès, qu'un foyer
  peut partager. Sans serveur SMTP, aucun code ne part et les commentaires
  restent indisponibles.
- **Annonce par email des nouvelles photos d'un album**, aux identités vérifiées
  qui ont ouvert cet album. Personne ne revient spontanément sur une galerie
  auto-hébergée : sans cette annonce, les photos déposées et les commentaires
  qu'elles appelleraient resteraient sans lecteur. L'abonnement est automatique
  et le désabonnement se fait par album (voir D41).
