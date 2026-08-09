# D60 — Un téléchargement Drive a une échéance, sauf quand il relaie une vidéo

**Contexte.** `DriveService.send()` appelait `fetch` sans `AbortSignal`. Node
hérite alors du défaut d'undici : **cinq minutes**. Or la place du limiteur de
rendu est prise **avant** le téléchargement — c'est voulu, l'original en mémoire
est ce qui pèse (D32). Deux téléchargements figés sur un VPS bicœur gèlent donc
tous les rendus pendant cinq minutes, ce qui, vu du navigateur, ne se distingue
pas d'un blocage définitif. C'était le diagnostic initialement posé sur la
lenteur d'un album froid, et il était faux dans ce cas précis — mais le
mécanisme, lui, existait bel et bien.

**Choix.** `AbortSignal.timeout(120_000)` sur les téléchargements de contenu,
**et sur eux seuls**. Le discriminant est déjà là : `send(url, token, range?)`.

- **Sans `range`** — téléchargement d'un original pour produire un dérivé, borné
  par `MAX_DECODE_BYTES` (80 Mo) : échéance. 120 s couvre 80 Mo sur une ligne
  lente et laisse une marge considérable au cas courant, une dizaine de
  mégaoctets.
- **Avec `range`** — relais d'une vidéo vers le navigateur, qui la consomme à son
  rythme : **aucune échéance**. `AbortSignal.timeout` est une échéance _totale_,
  pas d'inactivité ; elle couperait une lecture en cours au bout de deux minutes.

**Le repli tient en trois couches**, et c'est là qu'est la vraie décision — une
échéance seule ne fait que transformer une attente en tuile vide.

1. **L'aperçu Drive**, déjà en place : le `catch` de `build()` repart du
   `thumbnailLink`, qui pèse quelques kilooctets là où l'original en pèse huit
   millions. Sur une ligne saturée, c'est précisément ce qui a le plus de chances
   de passer.
2. **Un 503 avec `Retry-After`, jamais un 500.** `DriveUnavailableError` distingue
   le transitoire — délai dépassé, débit limité au-delà des réessais — du
   définitif, un format que la libvips ne décode pas. Un 500 dit « cassé » et
   fait renoncer ; un 503 dit « reviens ». Aucun en-tête de cache n'accompagne un
   échec : rien n'est mémorisé, donc la requête suivante retente réellement.
3. **Deux réessais côté vignette**, délai doublé et **dispersé**. Sans eux, le
   503 ne servirait à rien : un `<img>` ne réessaie pas tout seul, et la tuile
   resterait vide jusqu'au rechargement de la page. La dispersion n'est pas
   cosmétique — trente vignettes échouent ensemble sur une grille froide, et des
   réessais synchrones repartiraient saturer les six mêmes connexions (D59).

**Écarté.** _Une échéance unique pour tout le trafic Drive_ : elle couperait la
vidéo, et c'est le genre de régression qu'on ne voit qu'en production, en
regardant un film. _Un réessai côté serveur_ : il tiendrait la place du limiteur
plus longtemps, c'est-à-dire qu'il aggraverait exactement ce qu'on corrige.
_Prendre la place du limiteur après le téléchargement_ : l'original serait alors
en mémoire hors de tout comptage, ce que D32 a précisément écarté. _Un bandeau
d'erreur global_ quand beaucoup de vignettes échouent : de l'appareillage pour un
état que les réessais résorbent d'eux-mêmes.

**Conséquences.** Le pire cas devient 240 s — l'original puis l'aperçu Drive se
figeant tous deux — contre 600 s auparavant. Une seule constante gouverne les
deux, assumé : un aperçu mériterait une échéance plus courte, mais deux réglages
pour un gain de quelques secondes dans un cas déjà rare ne valent pas la
complication. Un `<img>` ne connaît pas le code de retour reçu : les deux
réessais partent donc aussi sur un 404, ce qui coûte deux requêtes inutiles pour
un média réellement disparu — c'est rare, et l'inverse coûterait bien plus.
