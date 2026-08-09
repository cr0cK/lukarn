# D52 — Un VPS et `docker compose`, pas un PaaS auto-hébergé

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
