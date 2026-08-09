# D92 — L'aperçu d'une vidéo vient de Drive, pas d'un décodage local

**Contexte.** Une vidéo n'avait pas d'image. `serveRendered` répondait 415 dès
que `kind !== 'photo'`, le préchauffage la sautait, la grille affichait une tuile
grise à icône de lecture et la visionneuse ouvrait sur un rectangle noir le temps
que le flux démarre. Sur un album de vacances, où une prise sur vingt-cinq est
filmée, une tuile sur vingt-cinq ne disait rien de ce qu'elle contenait.

La justification tenait en un mot : [D6](./D6-pas-de-transcodage-video.md) — pas de
transcodage, ffmpeg consommant sur un VPS modeste le CPU qu'on n'a pas.

**Décision.** Servir comme vignette de vidéo **l'aperçu que Drive produit de sa
première seconde**, exposé par `thumbnailLink`. Rien n'est décodé localement, D6
reste intact : c'est le champ que
`MediaRenderer.downloadDriveThumbnail()` télécharge depuis l'origine pour
rattraper les HEIC que libvips ne lit pas — un chemin en service, pas un chemin
inventé pour l'occasion.

Trois pièces le rendent sûr :

- **`media.has_thumbnail`**, rempli par la sync depuis le `hasThumbnail` de
  `files.list`. Drive n'a pas toujours d'aperçu — codec exotique, fichier déposé
  il y a quelques secondes —, et sans cette colonne la grille redemanderait à
  chaque chargement de page une image vouée au 415.
- **`render(..., 'poster')`**, qui saute le téléchargement de l'original. Sans ce
  court-circuit, un MP4 de 48 Mo serait tiré puis jeté par `MAX_DECODE_BYTES` à
  chaque vignette : le coût qu'on cherchait précisément à ne pas payer.
- **Le `poster` de la visionneuse**, la vignette 1280 déjà en cache disque et
  souvent en cache navigateur. Le rectangle noir disparaît sans une requête de
  plus.

Le périmètre s'arrête là : vignette de grille et poster. Pas de lecture au
survol, pas d'extraction d'une image choisie dans le film — les deux
demanderaient de décoder.

**Conséquences.** Le préchauffage prépare aussi les vidéos qui ont un aperçu, et
une vidéo lui coûte **moins** cher qu'une photo : quelques dizaines de Ko d'aperçu
contre plusieurs Mo d'original. Les deux 415 qui restent sont précis — `full` ou
`hd` sur une vidéo, `thumb` sur une vidéo sans aperçu — et le front n'y arrive
normalement pas, `MediaItem.hasPreview` lui disant d'avance s'il y a une image à
demander.

**La couverture d'album continue de refuser une vidéo**, mais la raison change :
ce n'est plus qu'il n'y a pas de rendu, c'est que cet aperçu appartient à Drive.
Il peut manquer sur un fichier ré-encodé, et la couverture est la seule image
dont l'absence se voit depuis la page d'accueil, sans repli —
[D80](./D80-la-couverture-d-un-album-se-choisit-sur-la-photo-et-retombe.md)
ne couvre que la photo sortie de l'index.

**Écarté.** Extraire une image avec ffmpeg — c'est D6, et le coût est le même
qu'il s'agisse d'une vignette ou d'un flux : il faut décoder. Écarté aussi :
demander l'aperçu à Drive à chaque requête sans le stocker en cache disque, ce
qui ferait dépendre chaque tuile de grille d'un appel réseau, là où le cache
existant traite déjà une vignette comme n'importe quel autre dérivé WebP. Et
enfin : afficher l'aperçu sans badge de lecture, la vidéo devenant alors
indiscernable d'une photo jusqu'au clic.
