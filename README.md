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

## How to — lancer en local

Pour développer, ou pour voir tourner l'application sans VPS, sans nom de
domaine et sans compte Google. Node ≥ 22 et pnpm suffisent.

```bash
pnpm install
pnpm --filter @gdv/shared build   # avant tout le reste — voir ci-dessous
```

**Le build de `shared` n'est pas optionnel.** `@gdv/shared` s'expose par son
`dist/`, pas par ses sources : sur un clone neuf, `pnpm dev` et
`pnpm create-admin` échouent tous les deux sur
`ERR_MODULE_NOT_FOUND … @gdv/shared/dist/index.js` tant qu'il n'a pas été
construit. C'est la même raison qui impose l'ordre `shared` → `web` → `server`
au `pnpm build` complet.

Ensuite le `.env`, obligatoire même en local :

```bash
cp .env.example .env
openssl rand -hex 32   # → SESSION_SECRET
openssl rand -hex 32   # → TOKEN_KEY
```

Le serveur refuse de démarrer sans ces deux secrets. Le reste du fichier peut
rester tel quel : le `PUBLIC_URL` par défaut (`http://localhost:8080`) convient
au développement, et sans identifiants Google l'application démarre en annonçant
simplement que Drive n'est pas configuré.

```bash
pnpm create-admin alexis   # premier compte, mot de passe demandé
pnpm dev                   # API sur :8080, front sur :5173 (proxy /api)
```

**Sans compte Drive**, un jeu de données de démonstration remplit l'index et le
cache avec des médias générés localement :

```bash
pnpm --filter @gdv/server seed-demo 300
```

Redémarre le serveur ensuite : le cache disque n'est inventorié qu'au démarrage,
les vignettes que `seed-demo` vient d'écrire lui sont invisibles jusque-là.

Avant de proposer un changement :

```bash
pnpm verify   # typecheck, lint, tests, et contrôle des specs
```

## How to — déployer sur un VPS

Il faut un VPS Debian ou Ubuntu et un nom de domaine dont l'enregistrement `A`
— et `AAAA` si le VPS a une IPv6 — pointe déjà sur son adresse. Le certificat
TLS est obtenu automatiquement à partir de ce nom : sans DNS en place, l'étape 5
échoue.

**Le gabarit : 2 vCPU, 4 Go de RAM, 60 Go de disque.** Ce n'est pas une machine
de démonstration, et deux postes expliquent l'écart :

- **Le build tourne sur la machine.** `docker compose up --build` lance vite,
  `tsc` et, si aucun binaire prébuilt ne convient, la compilation de
  `better-sqlite3`, `argon2` et `sharp`. Avec 1 Go, le build est tué par l'OOM
  killer avant la fin. On peut construire ailleurs et pousser l'image, mais ce
  n'est plus la procédure décrite ici.
- **Le cache disque vise 20 Go par défaut** (`cache.maxSizeGB`, réglable dans
  `/admin`), auxquels s'ajoutent l'image Docker et le système. 60 Go laisse de
  la marge ; 20 Go de disque font tourner l'éviction LRU en permanence.

### 0. Sur le poste d'administration

Une clé et un client VPN, à mettre en place **avant** de créer quoi que ce soit.

```bash
# 1. Une clé ed25519, celle que le cloud-init installera sur le serveur.
ssh-keygen -t ed25519

# 2. Tailscale — sur le poste AUSSI, pas seulement sur le serveur.
curl -fsSL https://tailscale.com/install.sh | sh
sudo systemctl enable --now tailscaled
sudo tailscale up          # ouvre une URL : c'est là que le compte se crée
```

**Tailscale des deux côtés, sinon l'étape 2 ne peut pas aboutir.** C'est un VPN
maillé : chaque machine qui s'y connecte rejoint le même réseau privé, y reçoit
une adresse `100.x.y.z` stable et un nom (`galerie.<tailnet>.ts.net`). Le
`ssh deploy@<nom-tailnet>` qui sert de porte d'administration ne fonctionne que
si **les deux** machines sont sur ce réseau — un serveur seul dessus ne se joint
de nulle part. Rien à ouvrir en entrée pour autant : Tailscale sort en UDP 41641
et se rabat sur un relais DERP si le NAT l'en empêche.

Tailscale n'est pas une dépendance de l'application : c'est le choix de ce
dépôt pour l'accès d'administration, parce qu'il ferme le port 22 sans rien
ouvrir en échange. WireGuard nu, un bastion, ou un port 22 filtré par IP source
rendent le même service — l'étape 2 est alors à adapter, le reste ne bouge pas.

Enfin, **recopier la clé publique dans `deploy/cloud-init.yaml`**, à la place de
la ligne `ssh-ed25519 AAAA_REMPLACER…` :

```bash
cat ~/.ssh/id_ed25519.pub
```

Laissée telle quelle, le compte `deploy` du serveur n'acceptera aucune
connexion.

### 1. Créer la machine

N'importe quel hébergeur convient, du moment qu'il propose une image **Debian 12+
ou Ubuntu LTS** et accepte un **cloud-init** — appelé « user data » ou
« cloud-config » selon les interfaces. C'est un format standard, pas une
particularité d'un fournisseur.

Trois choses à obtenir, quelle que soit la console utilisée :

| À faire                                                                   | Pourquoi                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Passer `deploy/cloud-init.yaml` en « user data »                          | C'est lui qui fait toute l'étape 2 : compte, pare-feu, Docker, Tailscale |
| Ouvrir **80/tcp, 443/tcp, 443/udp**, et **22/tcp le temps de l'amorçage** | 80 sert au défi ACME, 443/udp à HTTP/3. Le 22 se referme à l'étape 2     |
| Relever l'IP publique et **poser l'enregistrement `A` tout de suite**     | Let's Encrypt vérifie le nom au premier démarrage, pas plus tard         |

Le fichier est lu **depuis un clone local** du dépôt, pas depuis le serveur, qui
n'existe pas encore :

```bash
git clone <ce-dépôt> && cd googledrive-viewer
```

<details>
<summary>Exemple avec un CLI d'hébergeur</summary>

Aucun de ces fournisseurs n'est requis ni recommandé — ce sont des illustrations
de la même opération. Les gammes, les tarifs et les noms d'images bougent :
les vérifier au moment de provisionner.

**Hetzner** (`hcloud`) :

```bash
hcloud server create --name galerie --type cx22 --image debian-12 \
  --ssh-key <nom-de-la-cle> --user-data-from-file deploy/cloud-init.yaml
hcloud firewall create --name galerie
# puis ouvrir 22, 80, 443/tcp et 443/udp sur ce pare-feu
```

**DigitalOcean** (`doctl`) :

```bash
doctl compute droplet create galerie --image debian-12-x64 --size s-2vcpu-4gb \
  --ssh-keys <empreinte> --user-data-file deploy/cloud-init.yaml
```

**Scaleway** (`scw`) :

```bash
scw instance security-group create name=galerie zone=fr-par-2 \
  inbound-default-policy=drop outbound-default-policy=accept
SG=$(scw instance security-group list name=galerie zone=fr-par-2 -o json | jq -r '.[0].id')
for p in 22 80 443; do
  scw instance security-group create-rule security-group-id=$SG zone=fr-par-2 \
    direction=inbound action=accept protocol=TCP dest-port-from=$p
done
scw instance security-group create-rule security-group-id=$SG zone=fr-par-2 \
  direction=inbound action=accept protocol=UDP dest-port-from=443   # HTTP/3

scw instance server create name=galerie zone=fr-par-2 \
  type=PLAY2-NANO image=debian_bookworm \
  root-volume=b_ssd:60G ip=new security-group-id=$SG \
  cloud-init=@deploy/cloud-init.yaml
```

Une console web fait la même chose : le champ « user data » ou « cloud-config »
attend le contenu de `deploy/cloud-init.yaml`, et le pare-feu se règle à côté.

</details>

### 2. Rejoindre le tailnet, puis fermer SSH

Le cloud-init passé à la création a déjà tout posé : le compte `deploy` (sudo,
par clé, sans mot de passe), les mises à jour de sécurité automatiques, Docker,
`rclone`, Tailscale, et un `ufw` qui ne laisse passer que 22, 80 et 443. Il
n'installe **ni Node ni pnpm** — tout ce qui tourne sur cette machine tourne en
conteneur, et les commandes d'administration passent par `docker compose`.

**Reste à authentifier Tailscale, puis à fermer SSH sur l'interface publique.**
Le cloud-init installe Tailscale mais ne l'authentifie pas — cela demande de
valider une URL dans un navigateur, c'est une action humaine. Tant que ce n'est
pas fait, il n'y a qu'un chemin vers la machine, et le fermer la rend
inatteignable. L'ordre :

```bash
ssh deploy@<ip-publique>
sudo tailscale up                      # ouvre une URL à valider

# Dans un SECOND terminal, sans fermer le premier. Suppose le poste sur le
# tailnet (§ 0) : sinon ce nom ne résout nulle part.
ssh deploy@<nom-tailnet>               # doit fonctionner

# Alors seulement, dans le premier :
sudo ufw delete allow OpenSSH
sudo sed -i 's/^PermitRootLogin .*/PermitRootLogin no/' \
  /etc/ssh/sshd_config.d/99-durcissement.conf
sudo systemctl reload ssh
```

Puis retirer la règle 22 du pare-feu de l'hébergeur, s'il en propose un en amont
de la machine — c'est le cas de la plupart, sous le nom de groupe de sécurité,
de firewall ou de network rules. `ufw` seul suffit à bloquer le port ; la règle
en amont évite simplement que le paquet arrive jusque-là.

> **Ne pas fermer la porte par laquelle on est entré avant d'avoir franchi
> l'autre**, depuis un terminal distinct. C'est le seul moment de cette
> installation où une faute de frappe coûte une réinstallation. Filet de
> secours : la console hors-réseau de l'hébergeur — console série, KVM ou VNC
> selon les cas. **Vérifier qu'elle existe et qu'elle s'ouvre avant de fermer
> quoi que ce soit** : tous n'en fournissent pas.

Tailscale ne demande **aucune ouverture entrante** : il sort en UDP 41641 et se
rabat sur un relais DERP si le NAT l'en empêche. Le pare-feu de l'hébergeur et
`ufw` peuvent rester en « tout fermé sauf 80 et 443 ».

<details>
<summary>Sans cloud-init — un autre hébergeur, ou une machine déjà créée</summary>

Le même contenu, à la main, en root à la première connexion.

**Un compte à soi, une clé, et plus de mot de passe.** Un serveur exposé reçoit
des tentatives de connexion SSH en continu, quelques milliers par jour. Elles
sont sans objet dès qu'aucun mot de passe n'est accepté.

```bash
adduser deploy && adduser deploy sudo
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # reprend la clé
```

```bash
# /etc/ssh/sshd_config
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
```

```bash
systemctl restart ssh
```

> **Garde la session root ouverte** et vérifie dans un **second** terminal que
> `ssh deploy@…` fonctionne avant de la fermer.

**Le pare-feu.** Trois ports ouverts, rien d'autre. L'application n'écoute sur
aucune interface publique — seul Caddy est joignable — mais un pare-feu couvre
aussi ce qu'on installera plus tard sans y penser.

```bash
apt install ufw
ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw enable
```

`443/udp` sert à HTTP/3 ; l'omettre ne casse rien, les navigateurs retombent sur
TCP.

**Les mises à jour de sécurité, sans y penser.** C'est la mesure la plus
rentable des cinq : les intrusions opportunistes visent des failles publiées
depuis des mois.

```bash
apt install unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

**Docker.**

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy   # se déconnecter/reconnecter pour que ça prenne
```

Ajouter `deploy` au groupe `docker` équivaut à lui donner root sur la machine —
c'est déjà le cas, il est `sudo`. Sur un serveur partagé avec quelqu'un qui ne
doit pas l'être, préférer `sudo docker`.

</details>

La suite se fait avec le compte `deploy`.

### 3. Donner au serveur l'accès à ton Drive

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

### 4. Configuration

**Sur le serveur**, avec le compte `deploy` — le clone de l'étape 1 était sur le
poste d'administration, pour le cloud-init.

```bash
git clone <ce-dépôt> && cd googledrive-viewer

cp .env.example .env
# Générer les deux secrets et les coller dans .env
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # TOKEN_KEY
# Renseigner aussi PUBLIC_URL, puis selon l'option retenue à l'étape 3 :
#   GOOGLE_SERVICE_ACCOUNT_FILE  (compte de service)
#   GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET  (OAuth)
# SMTP_URL et MAIL_FROM : nécessaires aux commentaires — voir l'étape 6
```

Il n'y a **pas de `pnpm install` ici** : la machine n'a ni Node ni pnpm, et n'en
a pas besoin. Le `docker compose up --build` de l'étape suivante construit tout
dans l'image, et le premier administrateur se crée depuis le conteneur.

Les comptes, les albums et les réglages s'administrent ensuite **depuis
`/admin`**, sans éditer de fichier ni redémarrer.

`config/albums.example.yaml` reste utilisable pour **amorcer** une installation
neuve d'un coup : copié en `config/albums.yaml` (avec des empreintes produites
par `pnpm hash-password`, **depuis un poste de développement** — la commande
demande pnpm), il est repris en base au premier démarrage, puis plus jamais
relu. Inutile si tu passes par `create-admin`.

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

### 5. Démarrage et premier administrateur

```bash
docker compose up -d --build
```

Deux conteneurs démarrent : l'application, et **Caddy** qui assure le TLS. Le
certificat Let's Encrypt est demandé au premier démarrage et renouvelé seul —
il n'y a ni tâche planifiée à écrire, ni certificat à surveiller.

L'application **ne publie aucun port** : elle n'est joignable que par Caddy, sur
le réseau interne du compose. Le seul réglage est `PUBLIC_URL`, qui donne à
Caddy le domaine à servir en même temps qu'il construit l'URI de redirection
OAuth — les deux ne peuvent donc pas diverger. Elle doit valoir exactement
`https://photos.exemple.fr`, sans `/` final.

```bash
docker compose logs -f caddy    # « certificate obtained successfully »
```

Si le certificat n'arrive pas, c'est presque toujours le DNS : le nom doit
pointer sur l'IP du VPS **avant** le premier démarrage, et le port 80 doit être
ouvert (Let's Encrypt s'en sert pour la vérification).

Un proxy tourne déjà sur la machine — nginx, Traefik, une autre application en
443 ? Supprimer le service `caddy` du `docker-compose.yml` et rendre à `app` sa
publication locale — `ports: ['127.0.0.1:8080:8080']` —, puis proxifier vers
elle. Les en-têtes de sécurité sont posés par l'application, ils suivent quel
que soit le frontal.

**Le premier administrateur**, une fois les conteneurs debout. La commande
`pnpm create-admin` du développement local n'a pas d'équivalent ici : il n'y a
pas de pnpm sur la machine. Le script vit dans l'image, compilé, et se lance
dans le conteneur :

```bash
docker compose exec app node packages/server/dist/scripts/create-admin.js alexis
```

Le mot de passe est demandé sans être affiché. Le passer en argument
(`… create-admin.js alexis monSecret`) marche aussi mais le laisse dans
l'historique du shell.

Écrire en base pendant que l'application tourne est sans danger : `ConfigRepo`
surveille `PRAGMA data_version` et reconstruit son instantané dès qu'une
écriture vient d'ailleurs. C'est vrai des processus **distincts** seulement —
ce que `docker compose exec` garantit.

Si tu préfères créer le compte avant même le premier démarrage, `run` fait la
même chose sans que `app` tourne :

```bash
docker compose run --rm app node packages/server/dist/scripts/create-admin.js alexis
```

### 6. Emails — facultatif, mais nécessaire aux commentaires

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
- **Un mot de passe contenant `/`, `?` ou `#` coupe l'URL** au milieu des
  identifiants. Le serveur refuse alors de démarrer, en le disant : encoder ces
  caractères (`%2F`, `%3F`, `%23`), comme le `@` en `%40`. Les mots de passe
  d'application Google n'en contiennent pas. `+`, `:` et l'espace passent sans
  rien encoder.

#### Vérifier le rendu avant d'écrire à quelqu'un

Un relais bouchon local évite d'envoyer de vrais messages pendant les essais :

```bash
docker run -d --rm -p 1025:1025 -p 8025:8025 axllent/mailpit
# puis dans .env : SMTP_URL=smtp://localhost:1025
```

Mailpit accepte tout, ne relaie rien, et affiche les messages sur
`http://localhost:8025`.

### 7. Connecter le Drive

En **compte de service**, il n'y a rien à faire ici : l'accès vient du partage
du dossier (étape 3). Cette étape ne concerne que l'**option B**, et se fait une
seule fois, par le propriétaire du Drive :

1. Ouvrir `https://photos.exemple.fr` et se connecter avec un compte administrateur.
2. Aller sur **/admin** → **Connecter Google Drive**.
3. Choisir son compte Google et accepter. L'écran « Google n'a pas validé cette
   application » se passe par **Paramètres avancés → Accéder à**.

Au retour, la première synchronisation démarre seule ; les albums se remplissent
en quelques secondes. À partir de là, les visiteurs se connectent avec leur
identifiant et leur mot de passe, sans jamais passer par Google.

## Exploitation

| Action                               | Comment                                                                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ajouter un album ou un utilisateur   | `/admin`, prise en compte immédiate                                                                                                                                                         |
| Ajouter un album (compte de service) | `/admin`, **puis partager son dossier Drive** avec l'adresse du compte — sinon l'album reste vide, sans erreur                                                                              |
| Changer un intervalle, une limite    | `/admin`, appliqué sans redémarrage                                                                                                                                                         |
| Forcer une synchronisation           | **Resynchroniser** dans `/admin`                                                                                                                                                            |
| Voir l'état des synchronisations     | `/admin`                                                                                                                                                                                    |
| Modérer un commentaire               | `/admin`, section **Commentaires** : masquer, ou rendre visible à nouveau                                                                                                                   |
| Activer les commentaires             | `SMTP_URL` et `MAIL_FROM` dans `.env` (voir « Emails » à l'installation) — sans serveur d'envoi, personne ne peut s'identifier                                                              |
| Être prévenu des commentaires        | Renseigner l'adresse de modération dans `/admin`                                                                                                                                            |
| Annoter une journée                  | Ouvrir l'album **regroupé par jour**, survoler la date, cliquer le crayon. Le découpage par défaut se règle par album dans `/admin`                                                         |
| Couper le géocodage des lieux        | `GEOCODING_URL=` (vide) dans `.env`. Par défaut, des coordonnées arrondies au kilomètre partent vers Nominatim/OSM pour nommer les journées ; une instance Nominatim privée se met là aussi |
| Mot de passe administrateur perdu    | `docker compose exec app node packages/server/dist/scripts/reset-password.js <identifiant>` — ferme aussi ses sessions ouvertes                                                             |
| Mettre à jour                        | `./deploy/deploy.sh` — sauvegarde, reconstruit, et **attend** que la porte de santé repasse au vert                                                                                         |
| Sauvegarder                          | `./deploy/backup.sh` — le volume `gdv-data` **et** le `.env`, voir « Sauvegarde » plus bas. `gdv-cache` est régénérable                                                                     |
| Consulter les logs                   | `docker compose logs -f` (ou `logs -f caddy` pour le certificat)                                                                                                                            |

Mise à jour d'une instance qui tournait sur `config/albums.yaml` : rien à faire.
Au premier démarrage, ses comptes, albums, droits et réglages sont repris en
base tels quels, sans réindexation ni nouveau consentement Google. Le fichier
n'est ensuite plus relu — c'est `/admin` qui fait foi.

**Le volume `gdv-data` contient désormais les comptes** : c'est lui, et lui
seul, qu'il faut sauvegarder.

Les albums sont resynchronisés automatiquement selon l'intervalle réglé dans
`/admin`.
Rien n'est jamais écrit dans Drive : la portée demandée est en lecture seule.

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
- **En-têtes de sécurité sur toutes les réponses** : `Content-Security-Policy`
  (`script-src 'self'` — un `<script>` glissé dans un titre d'album ou un
  commentaire ne s'exécute pas), `X-Content-Type-Options`, `Referrer-Policy`,
  `frame-ancestors 'none'`, et `Strict-Transport-Security` dès que `PUBLIC_URL`
  est en `https`. Ils viennent de l'application, pas du proxy : ils valent donc
  aussi en développement et derrière un frontal qu'on n'a pas configuré.
- **Seul le frontal est joignable.** L'application ne publie aucun port sur
  l'hôte. Les `X-Forwarded-For` ne sont crus que s'ils viennent d'un réseau
  privé, sinon un client forgerait le sien à chaque tentative et ne serait
  jamais ralenti par le backoff de connexion.

### Sauvegarde

Deux choses, et elles vont ensemble : le volume `gdv-data` contient les comptes,
l'index et le refresh token **chiffré**, que `TOKEN_KEY` seul déchiffre. Une
sauvegarde du volume sans le `.env` rend un jeton illisible et impose de refaire
le consentement Google. `deploy/backup.sh` prend les deux.

```bash
./deploy/backup.sh            # archive locale, puis envoi par rclone
./deploy/backup.sh --local    # archive locale seulement
```

Le script arrête `app` le temps du `tar` — quelques secondes, le prix d'un
SQLite au repos plutôt qu'un fichier copié avec un WAL en vol —, écrit
`sauvegardes/gdv-<horodatage>.tar.gz` et le `.env` à côté, garde les **7
dernières** et supprime les plus anciennes. Il vérifie que l'archive contient
bien `gdv.db` : une archive vide passerait inaperçue jusqu'à la restauration.

**Hors de la machine.** Une sauvegarde qui vit sur la machine qu'elle protège ne
protège de rien. Sans `--local`, le script recopie l'archive par `rclone` vers
un remote configuré **hors du dépôt** :

```bash
rclone config     # n'importe quel backend : S3 et compatibles, B2, SFTP…
# Le remote par défaut est `sauvegardes:gdv`. Un autre nom ?
# GDV_BACKUP_REMOTE=mon-remote:mon-bucket ./deploy/backup.sh
```

**Automatiser.** Une ligne de `crontab -e` suffit pour une installation
personnelle — pas d'unité systemd à écrire :

```cron
# Sauvegarde quotidienne à 4 h, journal dans /home/deploy/sauvegarde.log
0 4 * * * cd /home/deploy/googledrive-viewer && ./deploy/backup.sh >> /home/deploy/sauvegarde.log 2>&1
```

`gdv-cache` n'a pas à être sauvegardé : il se régénère.

**Restaurer**, sur une machine neuve : remettre le `.env`, puis, **avant** le
premier `docker compose up` :

```bash
docker volume create gdv-data
docker run --rm -v gdv-data:/data -v "$PWD:/e" alpine \
  tar xzf /e/gdv-<horodatage>.tar.gz -C /data
```

> **Mise à jour d'une instance antérieure à ces scripts.** Les volumes portent
> désormais un nom explicite. Auparavant, compose les préfixait du nom du
> répertoire de travail : ton volume s'appelle donc `<répertoire>_gdv-data` —
> `googledrive-viewer_gdv-data` si tu as cloné sous ce nom. Le recopier vers
> `gdv-data` **avant** le premier `docker compose up` avec cette version, sans
> quoi l'application démarre sur une base vide (comptes et index compris).
>
> ```bash
> docker compose down
> docker volume create gdv-data
> docker run --rm -v googledrive-viewer_gdv-data:/ancien -v gdv-data:/neuf alpine \
>   sh -c 'cp -a /ancien/. /neuf/'
> docker run --rm -v googledrive-viewer_caddy-data:/ancien -v caddy-data:/neuf alpine \
>   sh -c 'cp -a /ancien/. /neuf/'   # évite une réémission de certificat
> docker compose up -d --build
> ```
>
> `docker volume ls` donne le nom exact. `gdv-cache` ne vaut pas la copie : il
> se régénère. Une fois l'instance vérifiée, les anciens volumes se suppriment
> par `docker volume rm`.
