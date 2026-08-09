# D27 — Une sync interrompue laisse un index mélangé, et c'est assumé

**Contexte.** `Syncer.run()` écrit par lots de 500, chaque lot dans sa propre
transaction, pour que l'album devienne consultable pendant la synchronisation
(voir [02](../02-architecture.md)). Si la sync échoue à mi-parcours, les lots déjà
écrits sont **validés** : l'index mélange l'ancien contenu et le nouveau. Le
commentaire du bloc `catch` affirmait le contraire — que l'index précédent
continuait d'être servi.

**Choix.** Corriger le commentaire, pas l'architecture. L'état obtenu est
cohérent : `deleteStale` n'a pas eu lieu, donc rien n'a été retiré, et tout ce
qui vient d'être écrit existe bien dans Drive. L'album est simplement incomplet,
et `sync_state` le dit — statut `error`, message, et `lastSyncAt` qui reste celui
du dernier passage **réussi**.

**Écarté.** Un index de staging : écrire la sync dans une table parallèle, puis
basculer en une transaction. Cela doublerait l'espace occupé par l'index, ferait
perdre la propriété qui justifie les lots — l'album consultable pendant la sync,
qui compte pour un premier remplissage de plusieurs minutes — et n'apporterait
qu'une atomicité dont personne n'a besoin ici : un album incomplet pendant une
heure n'est pas un problème de correction, c'est un retard que la sync suivante
rattrape. Écarté aussi : une transaction unique pour toute la sync, qui tiendrait
un verrou d'écriture SQLite pendant tout le parcours Drive.

**Conséquences.** `lastSyncAt` doit se lire comme « date du dernier passage
complet », jamais comme « date de l'état actuel de l'index ». Un échec répété
laisse un album qui grossit un peu à chaque tentative sans jamais se nettoyer :
c'est le `deleteStale` de la première sync réussie qui remet tout d'aplomb.
