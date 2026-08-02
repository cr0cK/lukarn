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

| Rôle            | Combien              | Ce qu'il fait                                                                        |
| --------------- | -------------------- | ------------------------------------------------------------------------------------ |
| Le propriétaire | Un seul par instance | Connecte son Drive une fois en OAuth, édite `config/albums.yaml`, surveille `/admin` |
| Les visiteurs   | Quelques comptes     | Se connectent avec un identifiant/mot de passe et consultent leurs albums            |

Un visiteur n'a jamais de compte Google et ne voit jamais une URL Google. Tout
le contenu transite par le serveur, qui l'obtient avec l'unique jeton du
propriétaire.

## Hors périmètre — délibérément

Ces absences ne sont pas des manques à combler, ce sont des choix qui tiennent
le projet à sa taille.

| Absent                                      | Pourquoi                                                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Toute écriture dans Drive                   | Le scope demandé est `drive.readonly` (`packages/server/src/drive/service.ts`). Aucun bug de l'app ne peut détruire les originaux. |
| Édition, retouche, rotation persistée       | Les originaux appartiennent à Drive ; l'app n'en produit que des dérivés jetables.                                                 |
| Inscription, écran de gestion des comptes   | Les comptes vivent dans `config/albums.yaml`. Pas de formulaire, pas de mot de passe oublié, pas de courriel à envoyer.            |
| Partage public par lien                     | Toute route média exige une session. Un lien copié à un tiers ne lui donne rien.                                                   |
| Reconnaissance faciale, recherche, tags     | Demanderait un traitement du contenu — donc de télécharger tous les originaux, ce que l'indexation évite précisément.              |
| Transcodage vidéo                           | ffmpeg sur un VPS modeste consomme le CPU qu'on n'a pas. Les `Range` sont relayées telles quelles à Drive.                         |
| Albums construits par requête (dates, tags) | Un album = un dossier Drive, point. Le mapping reste vérifiable à l'œil dans le YAML.                                              |
| Multi-tenant, plusieurs Drive               | La table `oauth_token` a une contrainte `CHECK (id = 1)` : une instance, un Drive.                                                 |

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

- Grille justifiée groupée par mois, virtualisée, sens chronologique
  basculable.
- Visionneuse plein écran pilotable au clavier, avec EXIF et téléchargement de
  l'original.
- Photos (JPEG, PNG, WebP, HEIC…) et vidéos (MP4, MOV) — tout ce que
  `classify()` reconnaît comme `image/*` ou `video/*`.
- Vignettes WebP générées à la demande, mises en cache sur disque avec éviction
  LRU.
