# D24 — La configuration passe en base, le YAML devient un amorçage

**Contexte.** Comptes et albums vivaient dans `config/albums.yaml`, relu au
démarrage ou par un bouton. Le propriétaire veut administrer son instance depuis
l'application, sans éditer de fichier sur le VPS ni redémarrer un conteneur.

**Choix.** Quatre tables (`users`, `albums`, `user_albums`, `settings`,
migration 3), un `ConfigRepo` qui en est le seul écrivain, et une API
d'administration sous `/api/admin`. `config/albums.yaml` n'est plus lu que tant
qu'aucun compte n'existe : il **amorce** une installation neuve, et c'est le
chemin de mise à jour des instances en service.

**Écarté.** Faire écrire le YAML par l'application : il est monté en lecture
seule dans le conteneur, il faudrait sérialiser en préservant commentaires et
ordre, et deux écritures concurrentes se perdraient. Écarté aussi : garder le
fichier comme source de vérité avec une écriture au retour, qui aurait laissé
deux vérités à réconcilier — et un redémarrage aurait pu écraser une
modification faite dans l'application.

**Conséquences.** Le volume `gdv-data` contient désormais les comptes : c'est la
seule chose à sauvegarder, et sa perte fait perdre les accès en plus de l'index.
`POST /api/admin/reload` et `AppContext.reloadConfig()` disparaissent. Une
installation neuve sans fichier a besoin de `pnpm create-admin`, sinon personne
ne peut se connecter.
