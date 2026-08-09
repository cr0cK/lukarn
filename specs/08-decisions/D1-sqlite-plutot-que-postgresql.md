# D1 — SQLite plutôt que PostgreSQL

**Contexte.** Il faut un index consultable des médias, avec tri chronologique et
pagination, sur un VPS modeste.

**Choix.** better-sqlite3, fichier unique dans `DATA_DIR`, en process, WAL activé.

**Écarté.** PostgreSQL — un service de plus dans le compose, de la RAM, une
sauvegarde à orchestrer, un pool de connexions, pour un volume qui reste dans la
dizaine de milliers de lignes et un seul écrivain. Aucune fonctionnalité de
Postgres n'est nécessaire ici. Écarté aussi : un simple fichier JSON, qui ne
tient pas la pagination par curseur ni les mises à jour partielles pendant une
synchronisation.

**Conséquences.** L'API de better-sqlite3 est synchrone, ce qui bloque la boucle
d'événements — acceptable puisque toutes les requêtes sont indexées et rendent
quelques centaines de lignes au plus. `busy_timeout` et WAL couvrent la
concurrence lecture/sync.
