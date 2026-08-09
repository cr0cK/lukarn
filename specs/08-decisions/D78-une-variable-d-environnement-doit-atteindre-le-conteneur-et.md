# D78 — Une variable d'environnement doit atteindre le conteneur, et c'est contrôlé

**Contexte.** `APP_NAME` (D72) et `GEOCODING_URL` étaient déclarées dans le
schéma zod d'`env.ts`, dans `.env.example`, et décrites dans `05`, `06` et `08`.
Aucune des deux n'atteignait le processus en production.

Compose ne propage pas l'environnement de l'hôte : seul ce que le bloc
`environment:` énumère parvient au conteneur. Le `.env` que Compose lit ne sert
qu'à **l'interpolation** de ce bloc — écrire une variable dedans qui n'y est
référencée nulle part n'a strictement aucun effet. Les deux variables tombaient
donc systématiquement sur leur défaut zod.

**Ce que ça démentait.** `06` affirmait qu'un redémarrage suffisait à renommer
l'instance ; c'était faux, le nom était figé sur `Photos`. `deploy/README.md`
indiquait qu'une `GEOCODING_URL` vide coupait le géocodage ; c'était faux aussi,
et il s'agit du seul réglage de confidentialité de l'application — les
coordonnées EXIF arrondies au kilomètre partaient chez un tiers sans qu'aucune
manipulation documentée puisse l'empêcher.

Le défaut est de ceux qui ne se voient pas : rien n'échoue, rien n'est journalisé,
et la variable paraît réglable partout où on la lit. `check:specs` ne pouvait pas
l'attraper — il vérifiait qu'une variable est **mentionnée dans les specs**, pas
qu'elle est **câblée jusqu'au conteneur**. Deux propriétés distinctes, et c'est
la seconde qui décide de ce que l'exploitant peut réellement changer.

**Décision.** Les deux variables sont ajoutées au bloc `environment:`, et
`check:specs` compare désormais le schéma zod à `docker-compose.yml` et au
`Dockerfile` : toute variable lue par le serveur sans être transmise par l'un ou
fixée par l'autre fait échouer la CI. Le contrôle porte sur la forme
`NOM: ${NOM…}` et non sur la simple présence du nom — une variable citée dans un
commentaire n'est pas un câblage.

**La nuance qui porte tout le sens : `-` et non `:-`.** `${VAR:-défaut}`
substitue le défaut à une valeur absente **ou vide**. Or vide veut dire quelque
chose : pour `GEOCODING_URL`, « n'appelle aucun service » — avec `:-`, la
désactivation resterait impossible, et le correctif n'aurait corrigé que la
moitié du défaut. `${VAR-défaut}` ne substitue que si la variable est absente.
Retenu pour les deux, y compris `APP_NAME`, dont une valeur vide doit remonter
jusqu'à zod pour être refusée plutôt que silencieusement remplacée.

**Conséquences.** Le défaut de Compose duplique celui de zod pour ces deux
variables — deux endroits à tenir en phase. C'est le prix de la substitution sur
variable absente, que la forme `map` de Compose ne sait pas rendre autrement :
elle ne permet pas d'omettre une clé conditionnellement. Le contrôle ne compare
pas ces défauts entre eux ; il vérifie le câblage, qui est la classe de défaut
observée.

**Écarté.** La forme `environment: - NOM`, qui laisse passer la variable telle
quelle et évite la duplication du défaut. Elle interdit de mélanger les deux
écritures dans un même bloc, ce qui aurait imposé de convertir les onze entrées
existantes — dont trois portent un `:?` qui refuse le démarrage avec un message,
et que la forme liste ne sait pas exprimer.
