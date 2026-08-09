# D260809d — Le journal devient un répertoire, et l'archive est découpée avec

**Contexte.** [D260809](./D260809-numerotation-des-decisions.md) a fait de toute
décision **nouvelle** un fichier, et laissé les quatre-vingt-dix-neuf premières
dans le journal d'origine. Ce partage tenait à une contrainte du moment : deux
branches étaient ouvertes, et déplacer quatre mille lignes les aurait mises en
conflit. Elles sont fusionnées.

Ce qui restait, une fois la contrainte levée, n'était plus un compromis mais une
incohérence, et elle coûtait de trois façons :

- **Amender une décision ancienne** — la nuancer, la marquer dépassée — c'était
  éditer un fichier de quatre mille lignes, donc reprendre exactement le conflit
  que D260809 venait de supprimer pour les ajouts. La propriété ne valait que
  pour les créations.
- **Deux façons de lire une décision** selon son âge, alors que rien ne les
  distingue à l'usage.
- **Un fichier `08-decisions.md` toujours là**, vers lequel `CLAUDE.md` envoyait
  encore écrire à deux endroits. Le contrôle refusait l'écriture ; la
  documentation la demandait.

**Choix.** Le document `08` **est** le répertoire `specs/08-decisions/`. Les
quatre-vingt-dix-neuf entrées y deviennent un fichier chacune, et le fichier
unique disparaît.

Le répertoire porte le numéro de la série plutôt qu'un nom à part : « 01 → 02 →
08 » reste vrai partout où c'était écrit, et il n'existe plus de `08` où l'on
puisse croire écrire.

**D1 à D99 gardent leur rang.** Les renommer par date traverserait les trois
cents renvois que le code leur adresse, et un identifiant qui change après coup
n'en est plus un. Deux familles cohabitent donc — le rang pour l'ancien, la date
pour le reste — et `check:specs` accepte les deux. Le répertoire n'est
chronologique qu'à l'intérieur de chaque famille : c'est le prix d'un identifiant
stable, et il est petit devant un renommage.

**Écarté.** _Zéro-padder les noms de l'archive_, le rang sur trois chiffres, pour
que le répertoire se trie d'un bout à l'autre. Le nom du fichier aurait cessé de
reprendre exactement l'identifiant du titre, c'est-à-dire la règle que
`check:specs` fait respecter, pour un ordre d'affichage que personne ne demande.

_Garder l'archive en fichier unique_, en corrigeant simplement les deux renvois
de `CLAUDE.md` devenus faux. Cela traitait le symptôme le plus visible et
laissait le premier coût entier : une décision ancienne resterait inamendable
sans conflit.

_Un `08-decisions.md` réduit à un sommaire_ pointant vers le répertoire. Un
sommaire est un index, et un index redevient le point d'insertion commun que tout
ce travail supprime.

**Conséquences.** Le déplacement porte sur 2 907 lignes, et rien ne garantissait
qu'aucune ne se perde en chemin. Le découpage a donc été fait par un script,
puis vérifié par un second, écrit séparément : il compare le multiensemble des
lignes significatives du journal d'origine à celui des fichiers produits. Les
deux comptes tombent à 2 907, aucune ligne absente.

Les liens ont suivi trois traitements distincts, tous contrôlés par
`check:links` : les ancres `#dxx--…` deviennent des liens de fichier, les renvois
vers les autres specs remontent d'un cran, et un lien intitulé « 08 » suivi d'un
numéro en texte devient un lien intitulé par ce numéro, qui désigne enfin ce
qu'il nomme.

[D260809](./D260809-numerotation-des-decisions.md) nommait le répertoire
`specs/decisions/`, et décrivait un journal séquentiel encore ouvert à la
lecture. Les deux mentions sont **corrigées chez elle**, avec un renvoi vers
cette entrée-ci : une décision garde son raisonnement, jamais un chemin faux. Un
renvoi croisé qui ment coûte plus cher que la trace d'un renommage, et rien ne le
signalait — ni le contrôle des renvois `(Dxx)`, qui porte sur les décisions, ni
`check:links`, qui ne suit que les liens markdown.

C'est ce trou que `check:specs` ferme désormais : un document de specs cité en
texte entre backticks doit désigner un fichier existant. Ce répertoire-ci en est
exclu, et ne pouvait pas ne pas l'être — un journal nomme ce qu'il a remplacé,
et l'exiger présent le rendrait inécrivable.
