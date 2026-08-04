# Visionneuse photos Google Drive

Une galerie auto-hébergée pour parcourir les photos et vidéos d'un compte Google
Drive, en remplacement de la prévisualisation native : grille justifiée groupée
par mois, visionneuse plein écran pilotable au clavier, thème sombre.

L'accès se fait par identifiant et mot de passe, qu'on peut confier à plusieurs
personnes ; chacune déclare ensuite son nom et son adresse pour commenter. Depuis `/admin`, le
propriétaire déclare quels dossiers Drive deviennent des albums et qui y a accès
— de quoi partager un album précis sans exposer le reste du Drive.

## Deux authentifications à ne pas confondre

|                                | Qui             | Quand                      | Ce que ça ouvre                   |
| ------------------------------ | --------------- | -------------------------- | --------------------------------- |
| **OAuth Google**               | Le propriétaire | Une fois, à l'installation | L'accès en lecture à _son_ Drive  |
| **Identifiant / mot de passe** | Chaque visiteur | À chaque session           | Les albums qui lui sont attribués |

Les visiteurs ne voient jamais Google et n'ont besoin d'aucun compte Google.
L'application détient un seul jeton — celui du propriétaire — et sert les photos
à travers lui.

## Ce que ça fait

- **Connexion OAuth à Google Drive**, autorisée une fois depuis `/admin`. Le
  refresh token est chiffré au repos et renouvelé automatiquement ensuite.
- **Comptes et albums administrés depuis l'application**, avec droits par
  utilisateur, sans redémarrage ni fichier à éditer. Aucune inscription : c'est
  le propriétaire qui crée les comptes.
- **Photos et vidéos** : JPEG, PNG, WebP, HEIC, MP4, MOV. Vidéos lues en
  streaming avec seek natif, sans transcodage.
- **EXIF** : date de prise de vue, appareil, objectif, ouverture, vitesse, ISO,
  géolocalisation. Tri chronologique sur la date de prise de vue réelle.
- **Commentaires par photo**, dans un panneau latéral, avec un niveau de réponse.
  Chacun signe de son nom : l'identifiant peut être partagé par tout un foyer, on
  déclare donc son nom et son adresse au moment d'écrire, et un code reçu par
  email confirme l'adresse. L'administrateur peut masquer un commentaire depuis
  `/admin`, et le rendre visible à nouveau.
- **Notifications par email** : l'adresse de modération réglée dans `/admin` est
  prévenue des nouveaux commentaires, l'auteur d'un fil des réponses qu'il
  reçoit. Chaque message porte un lien de désabonnement.
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
| `C`             | Commentaires                                    |
| `D`             | Télécharger l'original                          |
| `Z`             | Zoom                                            |
| `Espace`        | Lecture / pause vidéo                           |
| Balayage        | Photo précédente / suivante, au doigt           |
| `?`             | Afficher cette liste                            |

## Installation sur un VPS

### 1. Donner au serveur l'accès à ton Drive

Deux façons, au choix. La seconde évite l'écran d'avertissement de Google et
n'a rien à renouveler : c'est celle à préférer pour une installation neuve.

|                                                   | Compte de service            | OAuth                                     |
| ------------------------------------------------- | ---------------------------- | ----------------------------------------- |
| Écran « Google n'a pas validé cette application » | Jamais                       | À chaque consentement                     |
| À renouveler                                      | Rien                         | Le jeton expire après six mois sans usage |
| Ce que le serveur peut lire                       | Les dossiers que tu partages | **Tout** ton Drive                        |
| À faire pour chaque nouvel album                  | Partager son dossier         | Rien                                      |

#### Option A — compte de service (recommandé)

1. Dans la [console Google Cloud](https://console.cloud.google.com/), créer un
   projet, puis **API et services → Bibliothèque** : activer **Google Drive
   API**.
2. **IAM et administration → Comptes de service → Créer**. Aucun rôle à
   accorder : ce compte ne touche à rien dans le projet, il sert seulement
   d'identité.
3. Sur le compte créé : **Clés → Ajouter une clé → Créer → JSON**. Le fichier
   se télécharge une seule fois.
4. Le déposer hors du dépôt, par exemple `./config/service-account.json`, et
   renseigner `GOOGLE_SERVICE_ACCOUNT_FILE` dans `.env`. Il contient une clé
   privée : le protéger comme un mot de passe (`chmod 600`).
5. **Partager le dossier avec le compte de service.** C'est ce qui remplace le
   consentement, et la seule manipulation à refaire pour chaque nouvel album :

   - récupérer l'adresse du compte de service — `/admin` l'affiche en haut, elle
     ressemble à `galerie@mon-projet.iam.gserviceaccount.com` ;
   - dans **Google Drive**, clic droit sur le dossier de l'album → **Partager** ;
   - coller l'adresse, laisser le rôle **Lecteur**, décocher « Envoyer une
     notification » (cette boîte n'existe pas), puis **Partager**.

   Le partage est **hérité** : un dossier partagé donne accès à tout ce qu'il
   contient, sous-dossiers compris. Un album `recursive: true` ne demande donc
   qu'un seul partage, à la racine — et une photo déposée plus tard hérite
   aussi.

   **Le piège à connaître** : un dossier oublié ne produit aucune erreur, ni
   dans `/admin`, ni dans les journaux. Seulement un album vide. Si un album
   reste à zéro élément après une synchronisation « ok », c'est le partage qu'il
   faut vérifier en premier.

`GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` deviennent inutiles, tout comme le
bouton « Connecter Google Drive » de `/admin`, qui laisse place à l'adresse à
partager.

#### Option B — OAuth

Tout se passe dans la [console Google Cloud](https://console.cloud.google.com/),
dans un **projet dédié** plutôt qu'un projet fourre-tout : l'écran de
consentement est unique par projet et porte le nom affiché, les scopes et le
statut de publication. Y loger plusieurs applications les mélange dans une même
demande d'autorisation.

1. Créer un projet, puis **API et services → Bibliothèque** : activer
   **Google Drive API**.
2. **Écran de consentement OAuth** (aussi présenté sous le nom _Google Auth
   Platform_) : type **Externe**, nom d'application et adresse d'assistance.
3. **Publier l'application.** Étape indispensable : tant qu'elle reste en statut
   « Test », Google fait **expirer le refresh token au bout de 7 jours** et il
   faut se reconnecter chaque semaine.

   Publier ne déclenche aucune procédure de vérification tant que tu ne la
   demandes pas. L'application reste « publiée, non vérifiée », plafonnée à
   100 utilisateurs. Seule conséquence : au moment du consentement, un écran
   « Google n'a pas validé cette application » — passer par **Paramètres avancés
   → Accéder à**. Une seule fois, et uniquement pour toi.

   _(Avec un compte Google Workspace, le type « Interne » évite cet écran. Il
   n'est pas proposé aux adresses `gmail.com`.)_

4. **Identifiants → Créer → ID client OAuth**, type **Application Web**.
5. Dans « URI de redirection autorisés », ajouter exactement `PUBLIC_URL` suivi
   de `/api/oauth/callback`, par exemple :
   `https://photos.exemple.fr/api/oauth/callback`

### 2. Configuration

```bash
git clone <ce-dépôt> && cd googledrive-viewer

cp .env.example .env
# Générer les deux secrets et les coller dans .env
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # TOKEN_KEY
# Renseigner aussi PUBLIC_URL, puis selon l'option retenue à l'étape 1 :
#   GOOGLE_SERVICE_ACCOUNT_FILE  (compte de service)
#   GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET  (OAuth)
# SMTP_URL et MAIL_FROM : nécessaires aux commentaires — voir l'étape 4

pnpm install
pnpm create-admin alexis  # premier administrateur, mot de passe demandé
```

Les comptes, les albums et les réglages s'administrent ensuite **depuis
`/admin`**, sans éditer de fichier ni redémarrer.

`config/albums.example.yaml` reste utilisable pour **amorcer** une installation
neuve d'un coup : copié en `config/albums.yaml` (avec des empreintes produites
par `pnpm hash-password`), il est repris en base au premier démarrage, puis plus
jamais relu. Inutile si tu passes par `create-admin`.

Chaque album pointe un dossier Drive par son `folderId` : le segment après
`/folders/` dans l'URL du dossier.

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

### 4. Emails — facultatif, mais nécessaire aux commentaires

Sans serveur d'envoi, personne ne peut commenter : le code qui vérifie une
adresse part par email. Les annonces de nouvelles photos ne partent pas non plus.
`SMTP_URL` et `MAIL_FROM` vont ensemble — n'en renseigner qu'un empêche le
démarrage.

#### Avec Gmail

Google refuse le mot de passe du compte depuis la fin de l'« accès aux
applications moins sécurisées ». Il faut un **mot de passe d'application**, qui
ne sert qu'à l'envoi et se révoque seul :

1. Activer la **validation en deux étapes** sur le compte Google — sans elle,
   l'option n'apparaît pas.
2. Aller sur [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords),
   nommer l'application (« Galerie »), valider.
3. Google affiche **16 lettres en quatre groupes** : les recopier **sans les
   espaces**.

```bash
# Le @ de l'adresse doit être encodé en %40 : sans ça, l'URL est coupée au
# mauvais endroit et l'hôte devient n'importe quoi.
SMTP_URL=smtps://prenom.nom%40gmail.com:abcdefghijklmnop@smtp.gmail.com:465
MAIL_FROM=Galerie <prenom.nom@gmail.com>
```

- `smtps://` et le port **465** : TLS dès la connexion. Le port **587** avec
  `smtp://` fonctionne aussi (STARTTLS).
- `MAIL_FROM` doit porter **l'adresse du compte** ou un alias vérifié : Gmail
  réécrit ou refuse tout autre expéditeur.
- Gmail plafonne à quelques centaines de destinataires par jour. Sans objet pour
  une galerie familiale.
- **Attention aux caractères spéciaux** dans un mot de passe : `/`, `+` ou `:`
  cassent l'URL en silence, et le serveur démarre avec une configuration
  absurde. Les mots de passe d'application Google n'en contiennent pas ; pour un
  autre relais, encoder (`/` → `%2F`, `+` → `%2B`, `:` → `%3A`).

#### Vérifier le rendu avant d'écrire à quelqu'un

Un relais bouchon local évite d'envoyer de vrais messages pendant les essais :

```bash
docker run -d --rm -p 1025:1025 -p 8025:8025 axllent/mailpit
# puis dans .env : SMTP_URL=smtp://localhost:1025
```

Mailpit accepte tout, ne relaie rien, et affiche les messages sur
`http://localhost:8025`.

### 5. Connecter le Drive

En **compte de service**, il n'y a rien à faire ici : l'accès vient du partage
du dossier (étape 1). Cette étape ne concerne que l'**option B**, et se fait une
seule fois, par le propriétaire du Drive :

1. Ouvrir `https://photos.exemple.fr` et se connecter avec un compte administrateur.
2. Aller sur **/admin** → **Connecter Google Drive**.
3. Choisir son compte Google et accepter. L'écran « Google n'a pas validé cette
   application » se passe par **Paramètres avancés → Accéder à**.

Au retour, la première synchronisation démarre seule ; les albums se remplissent
en quelques secondes. À partir de là, les visiteurs se connectent avec leur
identifiant et leur mot de passe, sans jamais passer par Google.

## Exploitation

| Action                               | Comment                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Ajouter un album ou un utilisateur   | `/admin`, prise en compte immédiate                                                                                            |
| Ajouter un album (compte de service) | `/admin`, **puis partager son dossier Drive** avec l'adresse du compte — sinon l'album reste vide, sans erreur                 |
| Changer un intervalle, une limite    | `/admin`, appliqué sans redémarrage                                                                                            |
| Forcer une synchronisation           | **Resynchroniser** dans `/admin`                                                                                               |
| Voir l'état des synchronisations     | `/admin`                                                                                                                       |
| Modérer un commentaire               | `/admin`, section **Commentaires** : masquer, ou rendre visible à nouveau                                                      |
| Activer les commentaires             | `SMTP_URL` et `MAIL_FROM` dans `.env` (voir « Emails » à l'installation) — sans serveur d'envoi, personne ne peut s'identifier |
| Être prévenu des commentaires        | Renseigner l'adresse de modération dans `/admin`                                                                               |
| Mot de passe administrateur perdu    | `pnpm reset-password <identifiant>` sur le serveur                                                                             |
| Mettre à jour                        | `git pull && docker compose up -d --build`                                                                                     |
| Sauvegarder                          | Le volume `gdv-data` (comptes, index, token). `gdv-cache` est régénérable                                                      |
| Consulter les logs                   | `docker compose logs -f`                                                                                                       |

Mise à jour d'une instance qui tournait sur `config/albums.yaml` : rien à faire.
Au premier démarrage, ses comptes, albums, droits et réglages sont repris en
base tels quels, sans réindexation ni nouveau consentement Google. Le fichier
n'est ensuite plus relu — c'est `/admin` qui fait foi.

**Le volume `gdv-data` contient désormais les comptes** : c'est lui, et lui
seul, qu'il faut sauvegarder.

Les albums sont resynchronisés automatiquement selon l'intervalle réglé dans
`/admin`.
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
