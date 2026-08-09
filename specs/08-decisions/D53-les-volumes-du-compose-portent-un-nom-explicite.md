# D53 — Les volumes du compose portent un nom explicite

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
