# D4 — Proxy média plutôt que liens Google signés

**Contexte.** Il faut afficher des images stockées dans Drive à des visiteurs qui
n'ont pas de compte Google.

**Choix.** Toutes les images passent par `/api/media/...`. Aucune URL Google
n'atteint le navigateur.

**Écarté.** Renvoyer les `webContentLink` / `thumbnailLink` de Drive, ou une
redirection 302 vers une URL signée. Trois problèmes : un lien signé qui fuit
échappe définitivement au contrôle d'accès ; il expire, donc casse le cache
navigateur et l'`ETag` ; et il exposerait indirectement l'arborescence du Drive
du propriétaire.

**Conséquences.** Toute la bande passante transite par le VPS. C'est le coût
accepté — atténué par le cache disque et par des dérivés WebP nettement plus
légers que les originaux.
