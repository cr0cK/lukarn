# D87 — Une image qu'on quitte doit être abandonnée, sinon elle bouche la file de celles qu'on regarde

**Contexte.** Des vignettes restaient noires dans la grille — parfois une
minute, parfois assez longtemps pour qu'on les croie perdues. Ouvrir la photo
correspondante la montrait sans attendre, ce qui écartait la piste d'un rendu
serveur en échec : le fichier était là, c'est la vignette qui n'arrivait pas.

La mesure a désigné le coupable ailleurs que dans la grille. Protocole :
descendre dans un album, ouvrir une photo, parcourir vingt-cinq photos aux
flèches, refermer, puis relever les requêtes en vol. Trois secondes après la
fermeture, **89 requêtes**, en tête vingt-quatre `…/full` d'un mégaoctet
vieilles de dix secondes. Les soixante vignettes du retour à la grille étaient
derrière elles dans la file — les six connexions qu'un navigateur accorde à une
origine HTTP/1.1 —, et mettaient une minute à se remplir.

Ces `full` sont les photos **déjà quittées**. `ZoomableImage` est remonté à
chaque photo (`key={item.id}`, qui remet zoom et cadrage à zéro sans les gérer
à la main), et retirer un `<img>` du DOM **n'annule pas** son téléchargement.
C'est le piège que la grille connaissait déjà et traitait par
`releaseIfDetached` ; la visionneuse ne le traitait pas, alors qu'elle
téléchargeait des fichiers cent fois plus gros.

**Décision.** `releaseIfDetached` quitte `Thumb` pour `lib/imageRelease.ts` —
deux appelants, une seule raison — et `ZoomableImage` l'appelle au démontage,
en abandonnant du même geste le `hd` s'il était en route. Après : **dix
requêtes en vol, zéro `full` orphelin**, et la grille se remplit en cinq
secondes au lieu de soixante.

**Écarté.** Faire du préchargement le suspect : il annulait déjà correctement,
et `image.src = ''` comme `removeAttribute('src')` produisent tous deux un
`net::ERR_ABORTED` — vérifié dans le navigateur avant de toucher au code.
Écarté aussi : compter sur HTTP/2 derrière le proxy pour dissoudre la file. Le
multiplexage lève la limite de six connexions, pas celle des quatre rendus
simultanés du serveur (`media/semaphore.ts`), qui joue exactement le même rôle
sur un album dont les vignettes ne sont pas encore en cache. Le vrai correctif
est de ne pas demander ce qu'on ne regarde plus.

**Conséquences.** La règle vaut désormais pour tout `<img>` que ce front monte
puis démonte : la requête se coupe explicitement. Le contrôle sur `isConnected`
la rend sûre sous `StrictMode`, qui rejoue montage et démontage sans toucher au
DOM.
