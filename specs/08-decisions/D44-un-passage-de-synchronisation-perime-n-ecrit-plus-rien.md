# D44 — Un passage de synchronisation périmé n'écrit plus rien

**Contexte.** Relevé en revue croisée. Changer le dossier Drive d'un album purge
l'index immédiatement (`routes/admin.ts`), pour que l'album cesse sur-le-champ
de montrer ce que le propriétaire vient de retirer. Mais la synchronisation
déjà en vol sur l'ancien dossier, elle, continuait : ses lots suivants
réinséraient les photos abandonnées **après** la purge, et son `deleteStale` ne
les retirait pas — il ne retire que ce qu'elle n'a pas vu. Les photos
redevenaient visibles pour toute la durée du nouveau passage, et durablement si
le processus s'arrêtait entre les deux.

**Choix.** Chaque passage porte une génération, attribuée au moment où il prend
la place dans `running`. Elle est revérifiée avant chaque écriture — lots,
`deleteStale`, `sync_state`. Dès qu'une reconfiguration en a lancé un autre, le
passage périmé s'arrête et rend un `SyncResult` marqué `superseded`.

**Écarté.** Comparer les empreintes de configuration plutôt qu'un compteur :
revenir au dossier de départ pendant une sync rendrait les deux passages
indiscernables, et le premier reprendrait la main sur l'index. Écarté aussi :
annuler réellement le passage en vol — il attend une réponse Drive, et
l'interrompre demanderait de propager un `AbortSignal` jusqu'à chaque appel HTTP
pour un gain nul, ce passage ne coûtant que du quota déjà consommé.

**Conséquence.** Un passage abandonné ne touche pas non plus à `sync_state` :
écrire « erreur » afficherait un échec dans /admin alors que rien n'a échoué.
