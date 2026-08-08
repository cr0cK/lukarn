# D260809b — Le transcodage vidéo, écarté par D6, devient possible avec des chiffres

**Contexte.** [D6](../08-decisions.md#d6--pas-de-transcodage-vidéo) écartait le transcodage sur
trois objections, formulées sans mesure : « le CPU d'un VPS modeste ne suit pas,
il faudrait stocker les versions transcodées, et gérer une file de travaux ».
Elle n'avait pas tort ; elle n'avait simplement aucun ordre de grandeur.

L'album qui a motivé cette décision les donne : **25 fichiers sur 38 sont en
HEVC**, tous sortis d'un même téléphone. Sur un ordinateur, deux vidéos sur trois
ne s'ouvrent pas — [D79](../08-decisions.md#d79--une-vidéo-illisible-le-dit-et-se-laisse-télécharger-au-lieu-de-charger-indéfiniment)
et [D98](../08-decisions.md#d98--un-décodage-qui-échoue-sans-erreur-et-un-tourniquet-de-trop) les
ont rendues honnêtes, pas lisibles. Les trois objections ont maintenant chacune
une réponse chiffrée :

| Objection de D6           | Ce que le terrain dit                                                                                                                                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le processeur ne suit pas | Tout est en 1080p, jamais en 4K. En `libx264 -preset veryfast -threads 1`, un 1080p tourne **autour du temps réel** sur un cœur, mesuré : les dix minutes de film à convertir font une dizaine de minutes de processeur, **une fois**, en fond, à priorité basse. |
| Il faut stocker           | Mesuré sur vingt de ces vidéos : 1177 Mo d'original pour 780 Mo de sortie, soit **1,5 fois plus léger** et environ 95 Mo par minute de 1080p. Le magasin est borné et purgeable comme le cache d'images — 5 Go par défaut, c'est-à-dire une heure de film.        |
| Il faut une file          | Une boucle de plus à côté du préchauffage, dont elle reprend les gardes à l'identique.                                                                                                                                                                            |

**Choix.** Une version H.264 est préparée **à l'avance, une à la fois, en fond**,
et **seulement pour les codecs qu'aucun navigateur courant ne décode** — `hvc1`
et `hev1`. La règle porte sur le codec, jamais sur un poids ou un nombre de
fichiers : transcoder un `avc1` dépenserait des minutes de processeur à dégrader
une image que tout le monde lit déjà.

Quatre points portent cette décision.

**Le codec est lu dans le fichier, au même passage que la date.**
`readVideoCodec` descend `moov → trak → mdia → minf → stbl → stsd` et retient la
première piste dont le `hdlr` vaut `vide` — une vidéo de téléphone porte au moins
une piste son, souvent placée avant l'image, et prendre le premier `stsd` venu
rendrait `mp4a` un fichier sur deux. La lecture partage la fenêtre `Range` de
[D97](../08-decisions.md#d97--la-date-dune-vidéo-vient-du-fichier-pas-de-sa-date-de-téléversement) :
les séparer doublerait le nombre de requêtes pour relire les mêmes octets. La
colonne `video_codec` a trois états — jamais examiné, examiné sans résultat, et
le codec lui-même — et c'est le premier qui la peuple sans reprise de données,
les lignes écrites par D97 étant relues exactement une fois.

**Un magasin distinct, avec son propre budget.** `CACHE_DIR/video`, une seconde
instance de `MediaCache` : inventaire, LRU, éviction et ménage des `.tmp` au
démarrage étaient déjà écrits. Ce qui ne pouvait pas être partagé, c'est le
budget — une vignette se refait en quelques secondes, une vidéo en plusieurs
minutes de processeur, et un LRU commun laisserait une navigation dans la grille
évincer une heure de travail. Chaque `MediaCache` n'inventorie et ne vide que ses
propres rayons, sans quoi celui de `CACHE_DIR` compterait le magasin vidéo comme
sien, et « vider le cache » depuis /admin emporterait les deux.

**C'est le client qui choisit sa source.** Le serveur ne décide pas : il expose
`videoCodec` avec l'item, et le navigateur interroge `canPlayType` sur le codec
réel. D98 avait écarté `canPlayType` — à juste titre, sur `video/mp4` seul, qui
répond `maybe` partout et n'apprend rien. Avec le codec, la réponse est franche.
Conséquence directe et voulue : **Safari et un iPhone gardent l'original en
pleine qualité**, ils n'ont rien à gagner à une version réencodée. Le transcodage
n'est un repli que là où il n'y avait rien.

**La lenteur est le mécanisme, pas un défaut.** Une seule tâche à la fois,
`ffmpeg` reniçé à 15 et sur un seul fil, arrêt sur le budget du magasin, sur le
réglage décoché et à l'extinction — le processus est alors tué, sinon un encodage
de dix minutes survivrait au conteneur qui l'a lancé. Le serveur doit rester
servi pendant ce temps : c'est la condition sans laquelle D6 aurait encore
raison.

**Écarté.** Le transcodage **à la demande**, sur la première requête : une
réponse HTTP tenue ouverte dix minutes, et autant de `ffmpeg` simultanés que de
curieux. Le 404 `not_ready` dit « pas encore » à la place, et la visionneuse en
fait un message d'attente à côté du bouton Télécharger de D79.

Écarté aussi : **remplacer l'original**. Il reste servi, transcodage ou non — la
version préparée est un dérivé de plus, jamais une substitution.

Écarté enfin : la **qualité adaptative**, ou HLS. Un seul rendu, 1080p, CRF 23.
Découper en segments et publier plusieurs débits demanderait un manifeste, un
lecteur JavaScript et autant de fois le stockage, pour une galerie familiale dont
les vidéos durent une minute.

**Conséquences.** L'image du conteneur grossit d'environ **250 Mo** : c'est
`ffmpeg`, c'est le prix d'entrée, et il est annoncé tel quel dans
[06](../06-configuration-et-deploiement.md). Sans lui, le serveur démarre en le
signalant, et les vidéos concernées gardent le message de D79.

Une vidéo qui vient d'arriver n'est pas lisible tout de suite — elle le dit, et
**elle se met à jouer d'elle-même** quand sa version arrive : la visionneuse
redemande le premier octet toutes les vingt secondes tant qu'elle attend. Sans
ce guet, le 404 aurait été un cul-de-sac pour qui est resté devant, et le seul
moyen d'en sortir aurait été de rouvrir la photo — que rien n'invitait à faire.

**Ce qu'on achète est la lisibilité, pas le poids.** Le premier passage réel le
mesure sans ambiguïté : 1,5× seulement, là où l'estimation de départ tablait sur
cinq. Du 1080p à 30 images par seconde, tenu à la main, sur du feuillage, est à
peu près le pire cas pour un encodeur, et `veryfast` ne l'aide pas — c'est le
préréglage qui tient le temps réel sur un cœur, et c'est lui qui rend le
transcodage acceptable sur un petit serveur. Descendre à `medium` ou monter le
CRF gagnerait de la place au prix du budget processeur ou de l'image ; ce n'est
pas ce qu'on cherchait ici.

Et ce que cette décision ne fait pas : elle n'améliore aucune vidéo déjà lisible,
et n'allège aucun flux. Un `avc1` de 200 Mo reste un `avc1` de 200 Mo.

**D6 n'est pas réécrite.** Son constat de départ tient toujours — le format
d'origine est servi tel quel, avec `Range` relayé et seek natif ; c'est encore ce
qui se passe pour tout ce que le navigateur sait lire.
