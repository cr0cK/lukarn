# D260811c — Une image publiée, et la construction locale en surcharge

**Contexte.** `docker-compose.yml` portait `build: .`, donc chaque instance
compilait l'application sur sa propre machine. Le coût était invisible tant qu'il
n'y avait qu'un exploitant : c'est lui qui imposait **4 Go de mémoire** au VPS,
non pour faire tourner un serveur Fastify et un SQLite — 1 Go y suffit largement
— mais pour que `tsc`, puis la compilation de `sharp`, `argon2` et
`better-sqlite3` quand aucun binaire prébuilt ne correspond, ne finissent pas
tuées par l'OOM killer. Le message qu'il laisse ne ressemble en rien à sa cause,
et c'est la première panne qu'un nouvel exploitant rencontre.

S'ajoutait un manque de contrôle : le `Dockerfile` n'était **jamais construit par
la CI**. Une image cassée passait `verify` — types, lint, tests, specs, liens —
et ne se découvrait qu'au déploiement, sur la machine, site éteint.

**Choix.** Une image publiée sur GHCR à chaque tag `v*`,
`ghcr.io/cr0ck/nonni:<version>` et `:latest`, référencée par défaut dans le
compose. Et **la construction locale reste un chemin de premier ordre**, à un
fichier de surcharge de distance :

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
./deploy/deploy.sh --build
```

Les deux figurent côte à côte dans `deploy/README.md`, avec le dimensionnement de
chacun, parce qu'ils ne servent pas la même personne : l'image pour qui veut une
galerie qui tourne, la construction pour qui n'est pas sur `linux/amd64`, essaie
une modification, ou refuse de dépendre d'un registre tiers. **Le dépôt est la
source ; l'image est une commodité** — la formuler ainsi est la seule façon de ne
pas transformer GHCR en dépendance de fait, ce que D63 interdit pour les
hébergeurs et qui vaut tout autant pour un registre.

La CI construit désormais l'image sur chaque proposition de fusion, **et démarre
le conteneur** jusqu'à ce que son propre `HEALTHCHECK` le déclare sain. Construire
et démarrer sont deux affirmations différentes : une dépendance d'exécution
absente, un `CMD` faux, un chemin qui n'existe que dans l'étape `builder`
produisent chacun une image qui se construit et meurt au démarrage.

**Écarté.** **Publier pour `linux/arm64` aussi.** L'émulation QEMU compile les
trois modules natifs depuis leurs sources, soit environ une heure par publication,
pour une architecture que personne n'a réclamée. Un hôte ARM n'est pas laissé de
côté : la surcharge de construction est exactement sa réponse, et le README l'y
envoie. À reprendre si le besoin se manifeste, par un runner ARM natif plutôt que
par l'émulation.

**Écarté** aussi de garder `build: .` par défaut et de publier l'image en
complément. C'est le moindre geste, mais il laisse le chemin le plus coûteux comme
chemin par défaut : celui qui découvre le projet compile du natif sur un VPS avant
d'avoir vu une seule photo.

**Écarté** enfin de faire du numéro de `package.json` la source de la version. Le
tag l'est, et lui seul : rien dans `release.yml` ne lit `package.json`, donc une
publication ne peut pas annoncer une version que son tag ne porte pas. Le prix est
qu'il faut penser à tagger ; il est payé une fois par publication, contre une
divergence silencieuse à chaque oubli dans l'autre sens.

**Conséquences.** Une instance en service ne bascule pas d'elle-même : le
`docker-compose.yml` tiré par `git pull` fait référence à l'image, et
`deploy/deploy.sh` sans argument tire au lieu de construire. C'est le
comportement voulu, et il est sans surprise **à condition que la mise à jour de
D260811 ait été faite** — l'image ne change rien aux volumes.

`NONNI_VERSION` épingle une version dans le `.env`. Elle n'est pas lue par
`env.ts` : c'est une interpolation de compose, donc le contrôle de D78 ne la
surveille pas, et elle n'a pas à atteindre le conteneur.

Le `HEALTHCHECK` de l'image devient une pièce du contrôle et non plus seulement
de l'exploitation : la CI lit son verdict au lieu d'écrire le sien, pour qu'un
désaccord entre les deux soit impossible.
