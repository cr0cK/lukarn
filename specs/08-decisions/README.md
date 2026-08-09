# 08 — Journal des décisions

Une décision par fichier : le contexte, le choix, ce qui a été écarté et
pourquoi. On ajoute une décision plutôt que de réécrire une décision existante —
une décision revenue sur elle-même reste une information utile.

Le journal a été un fichier unique jusqu'à D99. Il est devenu ce répertoire pour
que deux branches parallèles cessent de se disputer la même fin de fichier, et
pour qu'amender une décision ancienne ne touche qu'elle
([D260809](./D260809-numerotation-des-decisions.md)).

## L'identifiant

`D` suivi de la **date** où la décision est prise, au format `AAMMJJ` :
`D260809` est celle du 9 août 2026. Si le même jour en porte une seconde, elle
ajoute une lettre au même préfixe — `b`, puis `c`. Une date se connaît sans
regarder les autres branches ; un rang, non.

Les décisions **D1 à D99** gardent le rang qu'elles avaient : les renvois qui les
citent depuis le code sont trop nombreux pour qu'un renommage se justifie, et un
identifiant qui change après coup n'est plus un identifiant. Elles se trient donc
par rang, les autres par date — le répertoire n'est chronologique qu'à
l'intérieur de chaque famille.

Il n'y a pas d'index à tenir : un index redeviendrait le fichier unique que ce
répertoire remplace.

## Ajouter une décision

Le nom du fichier reprend l'identifiant du titre, suivi d'un slug :
`D<AAMMJJ>-<slug>.md`. C'est contrôlé.

```markdown
# D<AAMMJJ> — Une phrase qui énonce le choix, pas le problème

**Contexte.** Ce qui a rendu la décision nécessaire.

**Choix.** Ce qui est décidé, et ce qui le justifie.

**Écarté.** Les autres options, et la raison de ne pas les avoir prises.

**Conséquences.** Ce que ce choix impose, coûte ou rend impossible.
```

## Renvoyer à une autre décision

`(Dxx)` en texte, sans lien : c'est la forme de l'écrasante majorité des renvois
du dépôt, et la seule possible dans un commentaire de code. `check:specs` vérifie
que la décision citée existe.

Un lien cliquable reste légitime quand le renvoi porte le fil de la lecture
plutôt qu'une simple caution :

```markdown
depuis ce répertoire [D38](./D38-une-cle-d-acces-n-est-pas-une-personne.md)
depuis specs/ [D38](./08-decisions/D38-une-cle-d-acces-n-est-pas-une-personne.md)
```

Une ancre `#dxx--…` ne mène nulle part : elle date du fichier unique, où toutes
les décisions partageaient une page. `check:links` résout chaque lien et signale
celui qui ne mène plus à un fichier.

## Renvoyer à une autre spec

Ce répertoire est **un cran plus bas** que le reste des specs : un lien vers un
autre document s'écrit `[03](../03-modele-de-donnees.md)`, jamais `./`.
`check:links` l'attrape.

Le cas inverse échappe à tout contrôle : une spec qui renvoie vers une décision
en visant le mauvais fichier envoie le lecteur sur une décision qui parle d'autre
chose, et le lien résout. C'est le « paragraphe devenu faux » du `CLAUDE.md` : à
la charge de qui écrit.

## Ce qui est contrôlé

`pnpm check:specs` vérifie le format de l'identifiant, l'accord entre le titre et
le nom du fichier, l'absence de doublon, et le fait que chaque renvoi `(Dxx)` des
specs et du code mène à une décision qui existe. Ce dernier point vaut partout, y
compris dans un exemple : un identifiant écrit pour illustrer est un identifiant
que le contrôle exige de trouver. On écrit donc `D<AAMMJJ>` là où l'on ne désigne
aucune décision précise.
