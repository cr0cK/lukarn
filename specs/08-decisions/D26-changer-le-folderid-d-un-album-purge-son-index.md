# D26 — Changer le `folderId` d'un album purge son index

**Contexte.** Modifier le dossier Drive d'un album existant laisse en base des
médias qui appartiennent à l'ancien dossier.

**Choix.** Purge immédiate (`clearAlbum`), état de synchro remis à `never`, et
resynchronisation lancée en fond si Drive est connecté.

**Écarté.** Attendre que la synchronisation suivante fasse le ménage par
`deleteStale`. La fenêtre entre les deux est exactement celle où l'album montre
ce que le propriétaire vient de vouloir retirer — et si Drive est déconnecté ou
révoqué, cette fenêtre est sans fin. Écarté aussi : purger sans resynchroniser,
qui laisserait un album vide et un clic de plus à faire.

**Conséquences.** Une faute de frappe dans le `folderId` coûte une réindexation
complète de l'album. C'est le prix de ne jamais servir le contenu d'un dossier
qu'on vient de retirer. Les dérivés en cache disque, eux, ne sont pas touchés :
ils sont indexés par id de fichier, donc partagés entre albums, et régénérables.
