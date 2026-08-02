# Visionneuse photos Google Drive

Une galerie auto-hébergée pour parcourir les photos et vidéos d'un compte Google
Drive, en remplacement de la prévisualisation native : grille justifiée groupée
par mois, visionneuse plein écran pilotable au clavier, thème sombre.

L'accès se fait par identifiant et mot de passe. Un fichier YAML déclare quels
dossiers Drive deviennent des albums et quels utilisateurs y ont accès — de quoi
partager un album précis sans exposer le reste du Drive.

## Ce que ça fait

- **Connexion OAuth à Google Drive**, autorisée une fois depuis `/admin`. Le
  refresh token est chiffré au repos.
- **Albums déclarés en YAML**, avec droits par utilisateur. Aucune inscription,
  aucun écran de gestion de comptes.
- **Photos et vidéos** : JPEG, PNG, WebP, HEIC, MP4, MOV. Vidéos lues en
  streaming avec seek natif, sans transcodage.
- **EXIF** : date de prise de vue, appareil, objectif, ouverture, vitesse, ISO,
  géolocalisation. Tri chronologique sur la date de prise de vue réelle.
- **Téléchargement de l'original** pleine résolution.
- **Tout passe par le serveur** : aucune URL Google n'est exposée au navigateur.
  Les vignettes sont générées en WebP et mises en cache sur disque.

## Raccourcis clavier

|                 |                                                 |
| --------------- | ----------------------------------------------- |
| `← ↑ ↓ →`       | Se déplacer dans la grille                      |
| `Entrée`        | Ouvrir en plein écran                           |
| `Début` / `Fin` | Première / dernière photo                       |
| `←` `→`         | Photo précédente / suivante dans la visionneuse |
| `Échap`         | Fermer                                          |
| `F`             | Plein écran                                     |
| `I`             | Informations et EXIF                            |
| `D`             | Télécharger l'original                          |
| `Z`             | Zoom                                            |
| `Espace`        | Lecture / pause vidéo                           |
| `?`             | Afficher cette liste                            |

## Installation sur un VPS

### 1. Identifiants OAuth Google

Dans la [console Google Cloud](https://console.cloud.google.com/) :

1. Créer un projet, puis activer **Google Drive API**.
2. **API et services → Écran de consentement OAuth** : type « Externe », ajouter
   ton adresse Google dans les utilisateurs de test. Publier l'application n'est
   pas nécessaire pour un usage personnel.
3. **Identifiants → Créer → ID client OAuth**, type **Application Web**.
4. Dans « URI de redirection autorisés », ajouter exactement :
   `https://photos.exemple.fr/api/oauth/callback`

### 2. Configuration

```bash
git clone <ce-dépôt> && cd googledrive-viewer

cp .env.example .env
# Générer les deux secrets et les coller dans .env
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # TOKEN_KEY
# Renseigner aussi PUBLIC_URL, GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET

cp config/albums.example.yaml config/albums.yaml
pnpm install
pnpm hash-password        # à répéter pour chaque utilisateur
```

Renseigner `config/albums.yaml` avec les hashs obtenus et les identifiants des
dossiers Drive. Le `folderId` est le segment après `/folders/` dans l'URL du
dossier :

```
https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz
                                       ^--------- folderId ------^
```

Un chemin (`/Vacances/photos/2026-07-Allemagne`) ne convient pas : l'API Drive
ne manipule que des identifiants. Ouvre le dossier voulu — le plus profond si tu
veux un album par voyage, puisque `recursive: true` embarque tous les
sous-dossiers — et copie le segment de son URL. Cet identifiant survit aux
renommages et aux déplacements.

### 3. Démarrage

```bash
docker compose up -d --build
```

L'application écoute sur `127.0.0.1:8080`. Un reverse-proxy assure le TLS ;
avec Caddy, deux lignes suffisent :

```
photos.exemple.fr {
	reverse_proxy 127.0.0.1:8080
}
```

### 4. Première connexion

Ouvrir `https://photos.exemple.fr`, se connecter avec un compte administrateur,
aller sur **/admin** et cliquer sur **Connecter Google Drive**. La première
synchronisation démarre automatiquement à la fin du consentement.

## Exploitation

| Action                             | Comment                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------- |
| Ajouter un album ou un utilisateur | Éditer `config/albums.yaml`, puis **Recharger albums.yaml** dans `/admin` |
| Forcer une synchronisation         | **Resynchroniser** dans `/admin`                                          |
| Voir l'état des synchronisations   | `/admin`                                                                  |
| Mettre à jour                      | `git pull && docker compose up -d --build`                                |
| Sauvegarder                        | Le volume `gdv-data` (index + token). `gdv-cache` est régénérable         |
| Consulter les logs                 | `docker compose logs -f`                                                  |

Les albums sont resynchronisés automatiquement selon `sync.intervalMinutes`.
Rien n'est jamais écrit dans Drive : la portée demandée est en lecture seule.

## Développement

```bash
pnpm install
pnpm --filter @gdv/server dev    # API sur :8080
pnpm --filter @gdv/web dev       # front sur :5173, proxy /api vers :8080
```

Pour travailler sur l'interface sans compte Drive, un jeu de données de
démonstration génère des médias et les images correspondantes :

```bash
pnpm --filter @gdv/server seed-demo 300
```

Vérifications :

```bash
pnpm typecheck && pnpm lint && pnpm test
```

## Architecture

Monorepo pnpm, un seul conteneur en production — le serveur Fastify sert l'API
et le front buildé.

```
packages/
├─ shared/   Types partagés entre l'API et le front
├─ server/   Fastify · SQLite · Google Drive · cache d'images
└─ web/      React · Vite · Tailwind
```

Quelques choix qui expliquent le reste :

- **L'index vit dans SQLite**, alimenté par un parcours des dossiers Drive. La
  grille se lit donc en local, sans latence réseau ni consommation de quota.
- **Rien n'est téléchargé pendant l'indexation** : `files.list` renvoie déjà les
  dimensions et les données EXIF, ce qui rend la synchronisation d'un album de
  plusieurs milliers de photos quasi instantanée.
- **Les dimensions étant connues d'avance**, la grille calcule sa mise en page
  avant tout chargement d'image : pas de décalage, et la virtualisation garde
  quelques dizaines de nœuds DOM même sur un album de 10 000 photos.
- **Les vignettes sont mises en cache sur disque** avec éviction LRU. Les rendus
  concurrents de la même image sont dédupliqués, si bien qu'une grille qui
  s'ouvre ne déclenche qu'un téléchargement par fichier.
- **Les vidéos ne sont pas transcodées** : les requêtes `Range` sont relayées
  telles quelles vers Drive, ce qui donne le seek natif à coût CPU nul.

## Sécurité

- Mots de passe hachés en argon2id ; tentatives de connexion limitées avec
  backoff progressif.
- Sessions en base, révocables immédiatement, cookie `httpOnly` signé.
- Chaque accès à un média vérifie que l'utilisateur a droit à un album qui le
  contient. Un album interdit répond 404, jamais 403 : son existence n'est pas
  observable.
- Refresh token Google chiffré en AES-256-GCM avec une clé dérivée de
  `TOKEN_KEY`, absente de la base.
- Consentement OAuth protégé par un `state` anti-CSRF et réservé aux
  administrateurs.
- `noindex` sur toutes les pages.
