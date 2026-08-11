# D63 — Le dépôt ne privilégie aucun hébergeur, et ne crée pas de compte nominatif

**Contexte.** D52 a doté le dépôt d'un cloud-init et de deux scripts, mais les a
écrits pour la machine qu'on avait sous la main : le `README.md` déroulait une
procédure Scaleway comme s'il n'y avait qu'elle, le cloud-init citait `scw` en
en-tête, la console de secours était nommée « console série Scaleway », le
remote de sauvegarde par défaut s'appelait `scaleway:`, et le compte système
portait le prénom de l'auteur. Rien de tout cela n'est faux ; tout cela devient
gênant dès que le dépôt est public, où un lecteur lit un choix par défaut là où
il n'y avait qu'une habitude.

**Choix.** Le corps de la procédure ne nomme aucun fournisseur. Il énonce ce
qu'il faut obtenir — une image Debian 12+ ou Ubuntu LTS, un cloud-init passé en
« user data », les ports 80/443 ouverts et le 22 le temps de l'amorçage, un
enregistrement DNS — et les CLI de trois hébergeurs figurent dans un bloc
`<details>`, à égalité, présentés comme des illustrations de la même opération.
Le compte système devient `deploy` : un rôle, pas une personne. Le remote de
sauvegarde par défaut devient `sauvegardes:nonni`, sans marque.

**Écarté.** Ne garder aucune commande d'hébergeur : le plus neutre, mais on perd
le chemin prêt-à-coller, y compris pour qui déploie pour la première fois — et
une documentation qu'il faut compléter ailleurs est une documentation qu'on ne
suit pas. Écarté aussi un exemple à fournisseur générique (`<provider-cli>`) :
neutre en apparence, mais inexécutable, donc jamais vérifié.

**Ce que ça n'entraîne pas.** Tailscale reste nommé, et c'est assumé : ce n'est
pas un hébergeur mais un choix d'architecture d'accès, celui qui permet de
fermer le port 22 sans rien ouvrir en échange. Le `README.md` dit explicitement
qu'un WireGuard nu, un bastion ou un filtrage par IP source rendent le même
service, et que seule l'étape 2 change alors.

**Conséquences.** Une instance déjà amorcée par la version précédente du
cloud-init tourne sous le compte `alexis` : le renommage ne vaut que pour les
machines créées ensuite, et il n'y a rien à migrer — les chemins de
`deploy/backup.sh` et de `deploy/deploy.sh` sont relatifs au dépôt, pas au
répertoire personnel. Seule la ligne de `crontab` du `README.md`, qui cite un
chemin absolu, est à lire avec le nom de compte réel de la machine.
