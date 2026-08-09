# D2 — Index local plutôt qu'appels Drive à la volée

**Contexte.** La grille doit paginer 10 000 photos et trier sur la date de prise
de vue.

**Choix.** Un parcours de dossiers remplit une table `media` ; la grille ne lit
que SQLite.

**Écarté.** Interroger `files.list` à chaque page de grille : latence réseau à
chaque défilement, quota API consommé par la navigation, et impossibilité de
trier sur la date EXIF (Drive ne trie que sur `name`, `modifiedTime`,
`createdTime`…).

**Conséquences.** L'index peut être en retard sur Drive — c'est le rôle de
`sync.intervalMinutes`. En contrepartie, l'application reste consultable même
quand Drive est injoignable ou l'autorisation révoquée : seuls les rendus non
encore en cache échouent.
