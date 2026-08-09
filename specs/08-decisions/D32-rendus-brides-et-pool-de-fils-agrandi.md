# D32 — Rendus bridés et pool de fils agrandi

**Contexte.** Ouvrir une grille dont les vignettes ne sont pas encore en cache
déclenche un rendu par photo visible. Chacun charge l'original entier en
mémoire — neuf mégaoctets pour une photo d'appareil courante — puis le décode et
le ré-encode. La question posée était : le serveur reste-t-il disponible pour les
autres visiteurs pendant ce travail ?

**Mesures.** Banc sur huit cœurs, vingt-quatre rendus simultanés d'une photo
4000 × 3000 de 9 Mo, en interrogeant en parallèle une vignette **déjà en cache** —
le chemin d'un visiteur qui ne fait que regarder.

| Configuration                     | p95 de la requête servie depuis le cache | Mémoire du processus |
| --------------------------------- | ---------------------------------------- | -------------------- |
| Pool 4 (défaut Node), sans limite | 2 124 ms                                 | +336 Mo              |
| Pool 4, avec limite               | 2 344 ms                                 | +117 Mo              |
| Pool 16, avec limite              | **0,25 ms**                              | **+117 Mo**          |

Le débit total des rendus est identique dans les trois cas : ces réglages ne
font pas travailler plus vite, ils empêchent un traitement long de confisquer
les ressources aux requêtes courtes.

**Choix.** Deux corrections, qui traitent deux problèmes distincts.

- **Un limiteur de rendus simultanés** (`media/semaphore.ts`), dimensionné à
  `cpus - 2`, borné entre 2 et 4. La place est prise **avant** le
  téléchargement : attendre son tour avec l'original déjà en mémoire ne
  limiterait rien. C'est ce qui divise la mémoire par trois.
- **Un pool de fils de 16** (`threadpool.ts`). Le décodage d'images, les lectures
  de fichiers et argon2 partagent le pool de libuv, dont la taille par défaut est
  de quatre : quelques rendus le remplissent et une simple lecture de vignette
  attend derrière. C'est ce qui ramène la latence de deux secondes à un quart de
  milliseconde.

**Écarté.** Sortir le traitement dans des processus séparés (`worker_threads`,
file externe) : sharp travaille déjà hors du fil principal — le retard de la
boucle d'événements est resté sous 2 ms dans toutes les mesures —, donc le
problème n'était pas le blocage mais le partage des ressources. Un pool de
processus ajouterait de la sérialisation, de la mémoire et une supervision, pour
un gain que la mesure ne montre pas.

Écarté aussi : régler le pool depuis le point d'entrée après les imports. Node
lit la variable au premier usage du pool ; en ESM, tous les imports sont évalués
avant le corps du module, et il suffirait qu'un seul ouvre un fichier pour figer
la valeur. D'où un module dédié, importé en premier, qui agit à son chargement.

**Conséquences.** Le `Dockerfile` pose aussi `UV_THREADPOOL_SIZE=16` — redondant
avec le module, mais visible à l'exploitation et robuste si l'ordre des imports
change un jour. Une valeur déjà présente dans l'environnement fait autorité.

Sur une grille entièrement à froid, le temps total pour afficher toutes les
vignettes reste le même ; ce sont les visiteurs qui regardent autre chose qui ne
le paient plus.
