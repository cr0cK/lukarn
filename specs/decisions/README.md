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

`pnpm check:specs` contrôle le format de l'identifiant, l'accord entre le titre
et le nom du fichier, l'absence de doublon, et le fait que chaque renvoi `(Dxx)`
des specs et du code mène à une décision qui existe. Ce dernier point vaut
partout, y compris dans un exemple : un identifiant écrit pour illustrer est un
identifiant que le contrôle exige de trouver. On écrit donc `D<AAMMJJ>` là où
l'on ne désigne aucune décision précise.
