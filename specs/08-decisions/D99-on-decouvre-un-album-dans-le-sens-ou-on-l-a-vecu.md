# D99 — On découvre un album dans le sens où on l'a vécu

**Contexte.** Le sens de lecture était une constante globale — `desc`, le plus
récent d'abord — et il vivait **uniquement** dans l'URL. Deux défauts distincts,
dont le découpage (`albums.group_by`, migration 7) avait déjà réglé le premier
de son côté :

- ouvrir un séjour donnait sa dernière journée avant sa première, c'est-à-dire
  le retour avant le départ ;
- le sens rebasculé était perdu en quittant la page. Le même geste était à
  refaire à chaque visite du même album.

Ce sont deux problèmes différents et ils appellent deux réponses différentes.
Le premier est une question d'album : « Corse, juillet 2026 » se raconte du
premier jour au dernier, « Les enfants » se lit par les dernières photos. Le
second est une question de lecteur : quel que soit le réglage de l'album,
quelqu'un qui préfère l'autre sens ne doit le dire qu'une fois.

**Choix.** Un défaut **par album**, en base et réglable dans /admin
(`albums.sort_order`, migration 12, défaut `asc`), et une mémoire **par album
dans le navigateur** (`nonni:album-order:<albumId>`). Priorité **URL >
navigateur > album** :

- l'URL d'abord, parce qu'elle est une vue exacte — partagée, ou reçue par
  email — et que l'habitude du destinataire n'a pas à la contredire ;
- le navigateur ensuite, parce que c'est là que vit la préférence d'une
  personne. La clé d'accès ne conviendrait pas : elle est partagée par tout un
  foyer (D38), et le sens choisi par l'un s'imposerait aux autres — le même
  raisonnement que les repères de lecture des commentaires (D55) ;
- l'album en dernier, comme point de départ de qui ne l'a jamais ouvert.

Basculer le sens écrit **toujours** dans le navigateur, et dans l'URL seulement
si le sens contredit l'album — la règle déjà en place pour `?group=`, qui rend à
l'album son adresse d'origine quand on revient à sa préférence.

L'email de nouveautés pointe vers `?order=desc` : le message annonce ce qui vient
d'arriver, le lien doit y mener. Le paramètre ne vaut que pour cette visite et
n'écrase pas la mémoire du navigateur.

**Écarté.** _L'abonnement comme critère_ — « abonné ⇒ plus récentes d'abord »
semblait distinguer l'album qu'on découvre de celui qu'on suit. Il ne le fait
pas : l'abonnement est automatique dès la première ouverture (D41), donc vrai
dans les deux cas. Le signal réellement discriminant est « ce navigateur a déjà
ouvert cet album », c'est-à-dire la mémoire locale elle-même.

_La constante globale seule_, basculée de `desc` à `asc` — cela aurait corrigé
la découverte d'un séjour en cassant l'album courant qu'on alimente au fil de
l'eau, et laissé intact le second défaut, la préférence à redonner à chaque
visite.

_Le `localStorage` prioritaire sur l'URL_ — un lien partagé cesserait alors
d'ouvrir la vue de son expéditeur, et le lien d'annonce en `desc` n'aurait aucun
effet chez quelqu'un qui a déjà lu l'album à l'endroit.

_Rendre `order` facultatif côté API_ pour éviter la cascade — la route aurait dû
lire la préférence de l'album, donc la config, pour un tri qu'elle sait déjà
faire. Le front résout le sens, puisque c'est lui qui connaît les trois sources ;
la route ne connaît que ce qu'on lui passe.

**Conséquences.** Les albums en service **changent de sens** à la mise à jour :
la migration les pose tous en `asc`. C'est assumé — `desc` n'a jamais été choisi
par personne, c'était la seule valeur possible. Le propriétaire rebascule album
par album depuis /admin, chaque visiteur pour lui-même depuis la grille.

Un lien partagé sans `?order=` peut se lire à l'envers chez son destinataire, si
son navigateur a retenu l'autre sens pour cet album. C'est le prix de la
mémoire ; partager la vue exacte demande de basculer le sens avant de copier
l'adresse, ce que le bouton fait déjà.

Enfin, la grille **attend** que le sens soit connu avant de charger la première
page : sans cette garde, la découverte d'un album chargerait deux cents éléments
dans un sens rejeté à l'arrivée de la réponse suivante.
