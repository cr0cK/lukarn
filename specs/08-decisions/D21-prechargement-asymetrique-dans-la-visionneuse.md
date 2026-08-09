# D21 — Préchargement asymétrique dans la visionneuse

**Contexte.** Chaque photo absente du cache serveur coûte un téléchargement
d'original depuis Drive ; précharger large sature la file et ralentit la photo
qu'on regarde.

**Choix.** Quatre photos dans le sens de navigation, une seule dans l'autre, les
plus proches demandées en premier. Le sens est déduit du dernier déplacement. Le
nettoyage de l'effet annule (`image.src = ''`) les téléchargements devenus
inutiles quand on enchaîne vite.

**Écarté.** Un rayon symétrique (l'ancienne version en chargeait deux de chaque
côté) : à nombre de requêtes égal, il dépense la moitié de son budget dans une
direction que l'utilisateur vient de quitter.
