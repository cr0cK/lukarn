# Décisions

Une décision par fichier, nommé `D<AAMMJJ>-<slug>.md` : l'identifiant est la
**date** où la décision est prise, pas son rang. `D260809` est donc la décision
du 9 août 2026 ; si le même jour en porte une seconde, elle ajoute une lettre au
même préfixe — `b`, puis `c`.

Une date se connaît sans regarder les autres branches, et deux branches
parallèles créent deux fichiers différents : plus de collision d'identifiant, et
plus de conflit git à la fusion. C'est tout ce que cette convention cherche à
obtenir, et le raisonnement complet est dans
[`D260809`](./D260809-numerotation-des-decisions.md).

Les décisions D1 à D99 sont restées dans [`../08-decisions.md`](../08-decisions.md),
qui n'en accepte plus de nouvelle. Il n'y a pas d'index à tenir ici : le dossier
trié par nom donne l'ordre chronologique.

## Ajouter une décision

Une entrée dit le contexte, le choix, ce qui a été écarté et pourquoi, puis ce
que le choix coûte :

```markdown
# D<AAMMJJ> — Une phrase qui énonce le choix, pas le problème

**Contexte.** Ce qui a rendu la décision nécessaire.

**Choix.** Ce qui est décidé, et ce qui le justifie.

**Écarté.** Les autres options, et la raison de ne pas les avoir prises.

**Conséquences.** Ce que ce choix impose, coûte ou rend impossible.
```

On ajoute une décision plutôt que de réécrire une décision existante : une
décision revenue sur elle-même reste une information utile.

## Renvoyer à une autre décision

`(Dxx)` en texte, sans lien : c'est la forme de l'écrasante majorité des renvois
du dépôt, et la seule possible dans un commentaire de code. `check:specs` vérifie
que la décision citée existe.

Un lien cliquable reste légitime quand le renvoi porte le fil de la lecture
plutôt qu'une simple caution. Il s'écrit alors depuis ce répertoire :

- vers l'ancien journal, `[D38](../08-decisions.md#d38--une-clé-daccès-nest-pas-une-personne)` ;
- vers une décision d'ici, `[D260809](./D260809-numerotation-des-decisions.md)`.

`check:links` résout les deux, ancre comprise, et signale un titre qui aurait
changé de libellé depuis. Une ancre `#dxx--…` seule, en revanche, ne mène nulle
part depuis ce répertoire : elle est cherchée dans le fichier courant.

## Renvoyer à une autre spec

Ce répertoire est **un cran plus bas** que le reste des specs : un lien vers un
autre document s'écrit `[03](../03-modele-de-donnees.md)`, jamais `./`. C'est le
piège du déménagement, et il vaut pour toute décision écrite ici, pas seulement
pour celles qui viennent de l'ancien journal. `check:links` l'attrape.

Il y a le cas inverse, que rien ne peut attraper : une autre spec qui renvoyait
vers `08-decisions.md` pour une décision **qui n'y est plus**. Le lien résout
toujours, le fichier existe — il envoie simplement le lecteur sur un journal qui
ne contient pas ce qu'on lui a promis. Depuis `specs/`, un renvoi vers une
décision d'ici s'écrit donc en visant le fichier :

```markdown
le raisonnement complet est en [D260809](./decisions/D260809-numerotation-des-decisions.md)
```

C'est le « paragraphe devenu faux » du `CLAUDE.md` : à la charge de qui écrit.

`pnpm check:specs` contrôle le format de l'identifiant, l'accord entre le titre
et le nom du fichier, l'absence de doublon, et le fait que chaque renvoi `(Dxx)`
des specs et du code mène à une décision qui existe. Ce dernier point vaut
partout, y compris dans un exemple : un identifiant écrit pour illustrer est un
identifiant que le contrôle exige de trouver. On écrit donc `D<AAMMJJ>` là où
l'on ne désigne aucune décision précise.
