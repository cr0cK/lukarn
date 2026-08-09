# D97 — La date d'une vidéo vient du fichier, pas de sa date de téléversement

**Contexte.** Un import de quarante vidéos s'est rangé en entier sous
« Aujourd'hui ». Drive n'expose aucune date de prise de vue pour une vidéo —
`videoMediaMetadata` se limite à `{width, height, durationMillis}`, là où
`imageMediaMetadata` porte l'EXIF complet d'une photo. `toUpsert` retombait
donc sur `modifiedTime`, c'est-à-dire l'heure du téléversement : quarante
lignes à `taken_at_from_exif = 0` et à la même seconde, pour des fichiers
tournés sur huit jours. La grille par journée, qui est la vue par défaut,
devenait fausse pour tout un voyage.

**Ce qui n'était pas réutilisable.** Le transcodage de Drive : l'API v3 n'expose
aucun flux transcodé, et `https://drive.google.com/file/d/<id>/preview` répond
401 sans session Google — l'embarquer supposerait de partager les fichiers
publiquement. Le `thumbnailLink`, lui, ne porte pas de métadonnée.

**Choix.** Le fichier est la source, et on le lit sans le télécharger. Le début
du conteneur est parcouru par requêtes `Range` : `drive/mp4.ts` suit la chaîne
des boîtes de premier niveau depuis l'offset 0 jusqu'au `moov`, dont le `mvhd`
porte la date d'enregistrement. Quatre fenêtres de 64 Ko au plus, 2,3 en moyenne
sur les quarante fichiers réels, 40/40 résolus.

`resolveVideoTakenAt` (`drive/metadata.ts`) tranche ensuite entre les sources,
par ordre de confiance :

1. **Le nom horodaté, corroboré par le conteneur** — un `YYYYMMDD_HHMMSS` à
   moins de 26 h du `creation_time` lu dans le fichier. Il porte l'heure locale
   de l'appareil au début de l'enregistrement, exactement la convention de
   l'EXIF d'une photo.
2. **Le conteneur seul**, moins la durée : son en-tête est écrit à l'arrêt de
   l'enregistrement, pas à son déclenchement.
3. **Le nom seul**, pour un conteneur qu'on ne sait pas ouvrir.
4. **`modifiedTime`**, seul cas qui laisse `taken_at_from_exif` à 0 — le panneau
   écrit alors « Modifié le », qui est exactement ce qu'on sait.

**Rien n'y est propre à un fuseau ni à un format.** Aucun décalage n'est supposé,
calculé ni stocké : la règle choisit entre deux sources, elle n'en corrige
aucune. C'est nécessaire parce que `creation_time` n'est pas écrit dans la même
horloge selon l'appareil — heure locale sur les uns, UTC sur les autres — et que
le conteneur ne dit pas laquelle. La tolérance de 26 h n'est pas une constante
horaire : elle dépasse le plus grand décalage réel sur Terre (±14 h) augmenté
d'un tournage, et ne sert qu'à écarter un nom sans rapport avec le fichier. Un
`.webm` ou un `.avi` renommé à la main tombe en 3 ou en 4 sans traitement à part.

**Écarté.** Balayer les octets à la recherche de la signature `moov`, qui aurait
évité de suivre les tailles. Il échoue sur les fichiers réels : treize des
quarante portent un ancien `moov` neutralisé en `free`, qui contient encore un
`mvhd` complet et daté de plusieurs mois plus tôt, le vrai `moov` étant ailleurs.
Le parcours de la chaîne depuis l'offset 0 est la seule frontière sûre.

Écarté aussi : réécrire les dates par une migration. La synchronisation
ré-upserte chaque fichier, donc une resync suffit — et une migration aurait dû
deviner ce qu'aucune colonne ne contient.

**Conséquences.** Une vidéo déjà datée depuis son fichier et dont le `md5` n'a
pas bougé garde sa date sans qu'un octet soit relu (`MediaRepo.fileTakenAt`) :
une resync d'album ne coûte rien de plus qu'avant. Une vidéo restée sur
`modifiedTime` — en-tête illisible, Drive momentanément indisponible — est
réessayée au passage suivant, puisque c'est `taken_at_from_exif` qui commande le
court-circuit. Un échec de lecture ne fait jamais échouer la sync ; seule une
autorisation révoquée remonte, parce qu'elle ferait dater tout un album sur la
mauvaise source avant qu'on s'en aperçoive.

Le `moov` porte aussi le GPS (`udta/©xyz`) et le modèle de l'appareil : rien n'en
est fait pour l'instant, la porte est ouverte.
