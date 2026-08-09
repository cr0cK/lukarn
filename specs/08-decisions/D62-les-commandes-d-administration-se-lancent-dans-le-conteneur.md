# D62 — Les commandes d'administration se lancent dans le conteneur, pas sur l'hôte

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
