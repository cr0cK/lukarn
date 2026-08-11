# D260811b — Tout le dépôt passe à l'anglais, et la gouvernance s'écrit

**Contexte.** La règle en vigueur partageait les langues par audience : anglais
pour ce qui se lit depuis GitHub — les deux `README.md`, les commits, les PR —
français pour tout le reste, code, commentaires, tests, interface, journaux et
`specs/`. Le partage se défendait tant que le seul lecteur du code était celui
qui l'avait écrit.

La publication sous AGPL (D260811) le rend faux, et sur deux fronts. Le premier
est immédiat : ce qu'un inconnu doit **éditer** pour installer l'application
n'est pas un README, c'est `.env.example`, le bloc `environment:` du
`docker-compose.yml`, le `Caddyfile`, et il lit les sorties de `deploy/*.sh`
pendant que ça tourne. Tout cela était en français, jusqu'aux messages d'erreur
qui arrêtent le démarrage (`:?définis PUBLIC_URL dans .env`). Le second est plus
lent : 96 000 mots de `specs/` et 8 500 lignes de commentaires expliquent
pourquoi le code est ainsi, et un contributeur qui ne les lit pas refera les
erreurs qu'elles documentent. Une conception écrite dans une langue que le
lecteur ne parle pas ne protège rien.

Rien de tout cela n'était visible tant que le dépôt restait privé, et la règle
d'audience portait déjà la bonne intuition. Elle a simplement placé la frontière
là où était le lectorat d'alors.

**Choix.** Une seule langue, l'anglais, partout : code, commentaires, noms de
tests, libellés d'interface, messages d'erreur, journaux, fichiers de
configuration d'exemple, `specs/` et `CLAUDE.md` compris. La règle vaut **dès
maintenant** pour tout ce qui s'écrit, sans obligation de traduire les alentours
d'un changement — sinon la moindre correction emporterait une traduction, et
personne ne proposerait plus rien.

La traversée est ordonnée du plus lu au moins lu : la surface d'installation
d'abord, puis l'interface et les messages du serveur, puis les commentaires, les
noms de tests et les `specs/`. `CLAUDE.md` porte le tableau d'avancement, et
`CONTRIBUTING.md` prévient le contributeur qu'il croisera du français en route.

La gouvernance manquante s'écrit dans le même geste, parce qu'elle répond aux
mêmes questions qu'un arrivant se pose : `CONTRIBUTING.md` (comment travailler
ici, et ce qui sera refusé), `SECURITY.md`, `CODE_OF_CONDUCT.md` — le Contributor
Covenant 2.1, non modifié —, un gabarit de PR et deux gabarits d'issue.

**Écarté.** Une **i18n** `fr`/`en` avec catalogues et détection du navigateur : le
français resterait disponible, mais chaque chaîne nouvelle devrait alors exister
en double pour toujours, et l'application n'a qu'un seul mainteneur. La dette est
permanente là où la traduction est un coût unique. Écarté aussi de **s'arrêter à
la surface d'installation** : c'est le geste le moins cher et il rend le projet
installable, mais il laisse le code et sa conception hors d'atteinte, donc le
projet ouvert à l'usage et fermé à la contribution.

**Une adresse de signalement plutôt qu'une autre.** `SECURITY.md` envoie vers le
signalement privé de GitHub, pas vers une adresse électronique en clair dans le
dépôt. Une adresse gravée là est moissonnée en quelques jours, et un rapport
reçu dans une boîte personnelle n'a ni fil, ni historique, ni moyen d'être
publié une fois corrigé. Le `CODE_OF_CONDUCT.md`, lui, ne peut pas passer par ce
canal — il n'est pas fait pour ça — et renvoie donc à l'adresse du profil GitHub
du mainteneur, qui reste sous son contrôle.

**Conséquences.** Le dépôt vit quelque temps en deux langues, et c'est visible :
les README parlent de `photos.example.com` quand les specs disent encore
`photos.exemple.fr`. Sans conséquence, chacun étant idiomatique dans sa langue.

Trois noms qui n'étaient pas du texte mais des chemins changent avec le reste,
parce qu'un exploitant anglophone les voit passer :

- le répertoire de sauvegarde local, `sauvegardes/` → `backups/`, et le remote
  rclone par défaut, `sauvegardes:nonni` → `backups:nonni`. `NONNI_BACKUP_DIR` et
  `NONNI_BACKUP_REMOTE` permettent de garder les anciens. L'élagage ne regarde que
  le répertoire qu'on lui désigne : les archives restées dans l'ancien y
  demeurent ;
- le fichier de durcissement SSH posé par le cloud-init,
  `99-durcissement.conf` → `99-hardening.conf`. Rien à migrer, pour la raison
  qu'invoquait déjà D63 à propos du compte système : le cloud-init ne vaut que
  pour les machines créées ensuite ;
- les identifiants de `config/albums.example.yaml`, qui devient un exemple
  neutre (`alice`, `family`, `holidays-2025`). Ceux des specs et des tests, eux,
  restent tels quels : ils ne s'adressent pas à qui installe.

Les identifiants de code, eux, n'ont jamais changé de langue : ils étaient déjà en
anglais, et c'est ce qui rend la bascule mécanique plutôt que risquée. Aucun
renommage de symbole n'est en jeu, donc aucune régression silencieuse à craindre
d'une traduction — au pire une phrase maladroite.

**Ce que ça n'entraîne pas.** Les commits déjà dans `main` ne sont pas réécrits,
pour la raison déjà donnée : l'historique de la branche principale casse tous les
clones existants. Les décisions passées ne sont pas retraduites une par une hors
du lot qui les prend en charge.
