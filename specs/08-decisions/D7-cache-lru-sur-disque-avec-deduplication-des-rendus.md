# D7 — Cache LRU sur disque avec déduplication des rendus concurrents

**Contexte.** Ouvrir un album déclenche des dizaines de requêtes de vignettes en
même temps ; produire une vignette coûte un téléchargement Drive plus un décodage
sharp.

**Choix.** Un fichier par entrée sous `CACHE_DIR`, clé
`sha256("<fileId>:<variante>")` répartie sur 256 sous-dossiers, inventaire des
tailles et des derniers accès **en mémoire**, éviction LRU jusqu'à 90 % de la
limite. `MediaRenderer.inFlight` mémorise les rendus en cours par clé : dix
requêtes simultanées sur la même vignette ne déclenchent qu'un téléchargement.

**Écarté.** Se fier à `atime` du système de fichiers pour l'ordre LRU : sur un
montage `relatime` — le défaut de la plupart des VPS — il n'est pas mis à jour de
façon exploitable. Écarté aussi : évincer pile à la limite, ce qui déclencherait
une éviction à chaque écriture suivante ; d'où le seuil à 90 %.

**Conséquences.** L'inventaire est reconstruit au démarrage par
`MediaCache.load()`, qui nettoie au passage les `.tmp` d'écritures interrompues.
**Un fichier déposé dans le cache pendant que le serveur tourne est invisible
jusqu'au redémarrage** — c'est le piège documenté de `seed-demo`. Les écritures
passent par un fichier temporaire puis un `rename` atomique : un lecteur
concurrent ne voit jamais un fichier partiel.

Aucune invalidation n'est prévue : la clé contient l'id du fichier Drive.
