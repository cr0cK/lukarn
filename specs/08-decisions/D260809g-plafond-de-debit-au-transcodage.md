# D260809g — Un dérivé ne peut plus être plus lourd que la vidéo dont il vient

**Contexte.** [D260809b](./D260809b-transcodage-video.md) prévoyait un dérivé
1,5 fois plus léger que sa source, et le premier passage en production a bien
donné ce chiffre : 1234 Mo d'originaux pour 818 Mo de sortie sur vingt vidéos.
La moyenne cachait un cas que personne n'avait envisagé — **trois de ces vingt
dérivés étaient plus gros que leur original** :

| Source         | Dérivé H.264 |
| -------------- | ------------ |
| 30,3 Mo — 12 s | 35,5 Mo      |
| 34,0 Mo — 13 s | 37,5 Mo      |
| 50,1 Mo — 20 s | **66,8 Mo**  |

C'est le comportement normal de `-crf` : un débit **variable**, sans borne
haute. Sur une scène chargée — du feuillage tenu à la main, le pire cas déjà
identifié par D260809b — x264 dépense ce qu'il faut pour tenir la qualité
demandée, et un HEVC de téléphone déjà bien encodé le laisse loin derrière. Le
magasin garde alors un fichier qui coûte du disque **et** de la bande passante
sans rien rendre en échange.

**Choix.** Le débit image est borné par celui de la source, calculé sur le
fichier réellement téléchargé : `-maxrate` à la place laissée par le son et par
le conteneur, `-bufsize` au double. Le CRF 23 reste : ensemble, ils font ce que
x264 appelle un CRF contraint — viser la qualité, et n'écrêter que si elle coûte
plus que le plafond.

Le plafond ne mord donc que sur les cas pathologiques. Les dix-sept autres
vidéos du même passage sortaient très en dessous de leur source, et sont
encodées exactement comme avant.

**Le plafond vaut 0,95 / 1,15 du débit de la source, pas 1.** Deux corrections
s'y empilent, et chacune est mesurée :

- **5 % pour le conteneur** — l'en-tête MP4 et l'index que `+faststart` remonte
  en tête. Viser le débit de la source à l'octet près produirait un fichier
  légèrement plus gros qu'elle.
- **15 % pour le débordement de x264** — et c'est la correction qui manquait à
  la première version de cette décision. `-maxrate` n'est pas un plafond sur la
  moyenne : c'est une contrainte VBV sur la fenêtre de `-bufsize`, que
  l'encodeur déborde quand la source est trop dure pour le débit accordé.
  Mesuré sur ffmpeg 7.1 en `veryfast` : **+9 à +10 %** sur une source réaliste,
  **+14 %** sur du bruit pur, le pire cas théorique.

Sans la seconde, la marge de conteneur seule laissait le dérivé repasser
au-dessus de sa source — le plafond aurait échoué exactement dans le cas pour
lequel il existe. Sur les 50,1 Mo du tableau, 5 % seuls autorisaient 52,3 Mo de
sortie ; les deux ensemble la bornent à 47,5 Mo dans le pire cas, et à environ
44 Mo au débordement réellement observé.

**La durée vient de l'index, le poids du disque.** `durationMs` traverse
l'interface `Transcoder` parce que c'est la seule des deux grandeurs que le
producteur ne peut pas obtenir sans un `ffprobe` de plus. Le poids, lui, est
mesuré sur le fichier reçu et non lu dans l'index : c'est ce que ffmpeg va
réellement encoder, et Drive déclare parfois une taille absente ou périmée.

**Écarté — jeter le dérivé plus lourd que sa source.** C'était la réaction
naturelle, et elle se retourne contre la fonctionnalité : la vidéo redevient
illisible, avec le seul bouton Télécharger de
[D79](./D79-une-video-illisible-le-dit-et-se-laisse-telecharger-au-lieu.md).
Or ce qu'on achète est la lisibilité, pas le poids — D260809b le dit déjà. Il
aurait fallu en plus une marque persistante en base, donc une migration, sans
quoi le passage horaire aurait refait l'encodage à chaque tour pour le jeter à
chaque fois.

**Écarté — monter le CRF, ou descendre à `-preset medium`.** Les deux gagnent de
la place partout, y compris sur les dix-sept vidéos qui n'ont aucun problème :
l'un dégrade une image qui allait bien, l'autre double le temps processeur. Le
défaut est local à trois fichiers, le remède doit l'être aussi.

**Conséquences.** Sur une scène très chargée d'une source à haut débit, l'image
est un peu moins bonne qu'avant ce changement — c'est le prix, et il ne se paie
que là où le dérivé aurait dépassé sa source. Le plafond à 0,83 du débit source
mord un peu plus large que les trois cas du tableau : les deux vidéos du même
passage qui sortaient à 86 % et 98 % de leur original y passent aussi. C'est
voulu — un dérivé à 98 % de sa source ne vaut pas mieux que ceux qu'on corrige.

En dessous de 500 kbit/s, aucun plafond n'est posé : une source très courte ou
à la durée mal déclarée donnerait un plafond absurde, et un 1080p bridé si bas
serait inregardable. Mieux vaut un dérivé un peu lourd qu'un dérivé qu'on ne
peut pas regarder. Une vidéo dont l'index n'a pas la durée est dans le même cas,
et retombe sur le CRF seul, c'est-à-dire sur le comportement d'avant.

**Les trois dérivés déjà produits ne sont pas repris.** Leur clé de magasin ne
dépend que du fichier et de son empreinte, pas des arguments d'encodage : ils
restent servis tels quels jusqu'à une éviction ou un remplacement du contenu sur
Drive. Les reprendre supposerait de savoir avec quels arguments chacun a été
produit, une information qu'on ne stocke pas — pour trois fichiers et 40 Mo,
c'est une colonne de trop.
