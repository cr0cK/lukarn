# D64 — La procédure de déploiement vit à côté des scripts, pas dans le README racine

**Contexte.** À force d'y ajouter ce qui manquait — durcissement (D47), scripts
et cloud-init (D52), neutralité vis-à-vis de l'hébergeur (D63) —, le `README.md`
de la racine avait atteint sept cents lignes, dont plus des trois quarts ne
concernaient que l'installation d'un serveur. Quelqu'un qui découvre le projet
devait traverser une procédure Let's Encrypt, une console Google Cloud et une
restauration de volume pour trouver `pnpm dev`.

**Choix.** Le `README.md` de la racine dit ce qu'est l'application, ce qu'elle
fait, comment la lancer en local, et rien d'autre — plus trois liens. Toute la
procédure serveur, l'exploitation et la sauvegarde partent dans
`deploy/README.md`, dans le répertoire des scripts qu'elle décrit. Trois
documents, trois lecteurs : celui qui découvre, celui qui exploite, celui qui
reprend le code (`specs/`).

**Écarté.** Garder un seul fichier et se contenter d'une table des matières : le
problème n'est pas la navigation mais le poids — un README long se lit comme un
projet compliqué, quelle que soit sa table des matières. Écarté aussi un
répertoire `docs/` : il éloigne la procédure des scripts qu'elle décrit, alors
que le point de `deploy/README.md` est justement d'être lu en même temps que
`cloud-init.yaml` et `backup.sh`, et mis à jour dans le même geste.

**Conséquences.** La règle de mise à jour du `CLAUDE.md` change de cible : une
modification de `deploy/` met à jour `specs/06` **et `deploy/README.md`**, plus
la racine. Les renvois de `deploy/cloud-init.yaml` et de `specs/06` pointent
désormais vers `deploy/README.md`. `tools/check-specs.mjs` n'est pas concerné :
il ne lit aucun README, il compare le code aux specs.

Le coût annoncé de la scission était qu'un lien mort ne serait signalé par rien.
Il ne l'est plus : `tools/check-links.mjs` résout chaque lien relatif et chaque
ancre des trois documents, et tourne dans `pnpm verify` comme sur `pre-push`.
Les renvois restent néanmoins peu nombreux et tous relatifs — un contrôle qui
attrape les liens cassés ne rend pas souhaitable d'en écrire davantage.
