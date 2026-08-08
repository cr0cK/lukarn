# D260809 — Une décision se numérote par sa date, et vit dans son propre fichier

**Contexte.** Le journal des décisions était un fichier unique de près de quatre
mille lignes, dont chaque entrée s'ajoutait à la fin en prenant le rang suivant.
Deux branches parallèles s'y heurtaient deux fois, et le travail se mène en
worktrees, donc plusieurs branches vivent en permanence :

- **le même identifiant**, parce qu'une branche ne peut connaître que le dernier
  rang de `main` — deux branches ouvertes le même jour choisissent le même ;
- **le même point d'insertion**, en fin de fichier. Celui-là est le plus coûteux,
  parce qu'il tombe **même quand les identifiants diffèrent** : git voit deux
  ajouts à la même ligne et rend la main. La résolution porte alors sur quatre-
  vingt-dix lignes de prose, à un moment — la fusion — où l'on pensait avoir fini.

Un contrôle avait déjà été posé sur la collision d'identifiant (D75). Il la
signale, il ne l'évite pas, et il ne dit rien du second défaut.

**Choix.** L'identifiant d'une décision est **la date où elle est prise**, au
format `D<AAMMJJ>` — `D260809` pour celle-ci — suivie d'un `b`, puis d'un `c`,
si le jour en porte déjà une. Une décision est **un fichier**,
`specs/decisions/D<AAMMJJ>-<slug>.md`.

Une date se connaît sans regarder les autres branches, ce qu'un rang ne permet
pas. Un fichier par décision fait disparaître le point d'insertion commun : deux
branches créent deux fichiers, et la fusion n'a rien à arbitrer.

`08-decisions.md` reste ce qu'il est, clos à D99, et `check:specs` refuse
désormais toute entrée qui s'y ajouterait. Il contrôle aussi que l'identifiant
respecte le format, que le nom du fichier reprend le titre, qu'aucun identifiant
n'est pris deux fois, et que chaque renvoi `(Dxx)` — dans les specs comme dans le
code — mène à une décision qui existe.

**Écarté.** _Renuméroter à la fusion_, une branche posant un rang provisoire :
c'est un renommage, et un renommage traverse les trois cents renvois `(Dxx)` que
porte le code. Une décision citée dans un commentaire changerait de nom après
coup, ce qui est exactement ce qu'un identifiant ne doit jamais faire.

_Garder le rang séquentiel_ en se contentant de contrôler l'unicité : cela traite
la collision d'identifiant, jamais le conflit d'insertion, qui est le coût réel.

_Découper aussi les quatre-vingt-dix-neuf entrées existantes_ : déplacer quatre
mille lignes ferait entrer en conflit toutes les branches ouvertes, pour une
homogénéité que personne ne lit — un journal ne se parcourt pas d'un bout à
l'autre, on y cherche une entrée. La coupure est nette et se documente ; c'est le
même arbitrage que la divergence assumée entre les titres de PR et les messages
de commit des onze premières PR.

_Le numéro de la pull request comme identifiant_ : unique par construction, mais
connu seulement une fois la PR ouverte, donc renommage systématique après coup.

_Un index généré listant le dossier_ : ce fichier redeviendrait le point
d'insertion commun qu'on vient de supprimer. Le dossier trié par nom donne déjà
l'ordre chronologique.

**Conséquences.** Deux formats d'identifiant coexistent — trois chiffres au plus
pour l'ancien journal, six pour la suite — et c'est sans ambiguïté à la lecture
comme au contrôle. Aucun renvoi existant ne change.

Deux décisions prises le même jour sur deux branches qui ne se voient pas
prendront le même identifiant, sans lettre ni l'une ni l'autre. `check:specs` le
signale à la fusion et la correction est un `git mv` sur une décision qui n'a
jamais été publiée : aucun renvoi extérieur à réécrire. Le cas est rare là où la
collision de rang était certaine.

Il n'y a pas d'index à tenir, donc pas d'index à oublier.
