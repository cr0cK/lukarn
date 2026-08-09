# D3 — Indexation sans téléchargement

**Contexte.** Indexer des milliers de photos ne doit ni prendre des heures ni
saturer le quota.

**Choix.** `files.list` avec
`fields: id, name, mimeType, size, modifiedTime, md5Checksum, imageMediaMetadata,
videoMediaMetadata` — dimensions, date EXIF et données d'appareil arrivent dans
la réponse de listage. Aucun octet de photo n'est téléchargé pendant une
synchronisation.

**Écarté.** Télécharger chaque fichier pour en extraire l'EXIF avec `exifr` ou
sharp : des gigaoctets de transfert pour des métadonnées que Drive fournit déjà.

**Conséquences.** On dépend de la qualité de l'EXIF vu par Drive. Quand il
manque, `takenAt` retombe sur `modifiedTime` et `takenAtFromExif` vaut `false`,
ce que le panneau d'informations affiche honnêtement (« Modifié le » plutôt que
« Prise de vue »).
