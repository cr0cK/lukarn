# D98 — Un décodage qui échoue sans erreur, et un tourniquet de trop

**Contexte.** Sur les mêmes quarante vidéos, vingt-sept sont en HEVC (`hvc1`).
Chromium en décode la piste AAC et ignore la piste vidéo : le son sort, l'image
n'arrive jamais, `videoWidth` reste à 0, `totalVideoFrames` à 0 — et **aucun
`MediaError` n'est émis**, puisque le conteneur et la piste audio sont valides.
Le repli de [D79](./D79-une-video-illisible-le-dit-et-se-laisse-telecharger-au-lieu.md)
écoute `error` : il ne se déclenchait donc pas. Le `poster` restait affiché sous
les contrôles, ce qui se lit comme une image gelée — pire que l'écran noir que
D79 venait de corriger, parce que rien n'y signale un échec.

Au même endroit, deux tourniquets se superposaient à l'ouverture : celui de la
visionneuse et celui, natif, des contrôles du navigateur, tous deux centrés sur
le lecteur.

**Choix.** L'échec se constate sur ce qui est arrivé, pas sur une erreur qui ne
viendra pas : `loadeddata` et `playing` marquent la vidéo comme illisible quand
`videoWidth === 0`. À ces deux moments, une piste vidéo décodable a forcément
livré une image ; une largeur nulle ne peut donc dire qu'une chose. Le message
et le bouton **Télécharger** de D79 s'affichent alors, inchangés.

Et le tourniquet de la visionneuse disparaît : le `poster` occupe l'attente, les
contrôles natifs portent leur propre indicateur. La vidéo n'ayant plus qu'un état
binaire, elle ne passe plus par `previewOverlay`, qui redevient la règle de la
seule photo.

**Écarté.** Sonder `canPlayType` avant d'afficher — ce que D79 écartait déjà, et
pour un motif que ce défaut confirme : la réponse `maybe` de tous les navigateurs
sur `video/mp4` n'apprend rien du codec réellement contenu. La détection retenue
ne coûte aucun sondage et constate le cas exact, HEVC ou non.

Écarté aussi : n'écouter que `playing`. Une vidéo dont la lecture automatique est
refusée par le navigateur n'émet jamais cet événement, et l'échec resterait
invisible jusqu'au premier clic sur Lire.

**Conséquences.** Cette PR ne rend pas les HEVC lisibles — elle les fait dire
qu'ils ne le sont pas. Le transcodage reste à faire, et la reconnaissance du
codec qu'il suppose est désormais en place.
