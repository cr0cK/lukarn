# D67 — La file de modération est une liste de travail, pas un flux

**Contexte.** La file rendait cinquante lignes antéchronologiques, un bouton
« Charger plus » qui empilait, et deux filtres — tout, ou masqué. Trois défauts,
tous mesurables :

- chaque masquage invalidait la file, et TanStack Query recharge **toutes** les
  pages d'une requête infinie : après quatre « Charger plus », un seul clic sur
  « Masquer » redemandait deux cents lignes ;
- rien ne disait si les lignes affichées étaient tout le corpus ou le centième ;
- on ne pouvait ni chercher, ni restreindre à un album, ni voir seulement ce qui
  est encore en ligne.

Or on ne parcourt pas une file de modération, on y arrive avec une intention :
un message dont on nous a parlé, ce qui s'est dit hier, tout ce qu'a écrit une
adresse.

**Choix.** Une page à la fois, vingt-cinq lignes, avec `‹ Précédent` et
`Suivant ›` — une pile de curseurs côté client tient le chemin parcouru, seul
moyen de revenir en arrière avec une pagination par curseur. La réponse porte
`total`, compté **sans le curseur** : c'est la taille du corpus filtré, pas celle
du reste. Trois filtres qui partitionnent (`all`, `visible`, `hidden`), un filtre
d'album, et une recherche sur le corps, le nom déclaré et l'adresse. La page
affichée est rangée par journée puis par photo, côté client. Enfin, une action
groupée par identité : masquer d'un coup tous les messages d'une adresse.

La journée du regroupement est celle du **lecteur**, pas UTC — troisième
exception à la règle du dépôt, et pour la raison déjà écrite en D31 et dans
`format.ts` : `created_at` est un instant réel, pas une heure murale d'appareil.

**Écarté.** Garder le défilement infini en n'ajoutant que le total : le compte
manquant n'était qu'un des trois défauts, et le plus visible — le rechargement
complet à chaque geste serait resté. Écartées aussi les pages numérotées en
`OFFSET` : elles offrent l'accès direct à la page 5, mais leur numérotation
glisse dès qu'un commentaire arrive pendant la modération, et le dépôt a déjà
tranché contre `OFFSET` pour les médias (voir la pagination par curseur en
[03](../03-modele-de-donnees.md)). Écartée enfin une table FTS5 en `unicode61`
pour la recherche : une table virtuelle et des déclencheurs de synchronisation à
maintenir pour un corpus de quelques milliers de lignes, alors qu'un `LIKE`
échappé y répond en microsecondes.

**Conséquences.** Le regroupement ne vaut que pour la page reçue : une photo dont
les commentaires enjambent une frontière de page apparaît des deux côtés. Faire
autrement supposerait un serveur qui pagine des groupes entiers, donc des pages
de taille inconnue. La casse n'est repliée que sur l'ASCII — chercher « Éric » ne
trouve pas « éric », limite de `LIKE` en SQLite, et c'est ce que la table FTS
aurait corrigé. **Aucun index n'a été ajouté** : une recherche `LIKE '%…%'` est
un parcours qu'aucun index ne sert, et le corpus est borné par ce que des humains
écrivent ; à revoir au-delà de la dizaine de milliers de commentaires, où le
`COUNT(*)` de chaque page se paierait. L'action groupée, elle, ne bannit
personne : elle retire des messages, l'identité peut toujours écrire. Fermer la
porte reste l'affaire de la clé d'accès, que la file affiche à côté de chaque
message.
