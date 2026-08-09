# D34 — Un fil par couple (album, média), et non par média

**Contexte.** Un même fichier Drive apparaît dans plusieurs albums quand leurs
dossiers sont imbriqués — c'est déjà la raison de la clé primaire composite
`(album_id, id)` de `media` et de `albumsContaining()`.

**Choix.** `comments` porte `album_id` **et** `media_id`. La même photo vue
depuis deux albums montre deux conversations distinctes.

**Écarté.** Indexer sur le seul `media_id`, ce qui aurait donné une conversation
unique par fichier — plus naturel a priori, et moins de lignes. Mais le contrôle
d'accès média accorde l'accès dès qu'**un** album contenant le fichier est
visible : un visiteur de l'album « Vacances » lirait alors les propos tenus dans
« Privé » par ceux qui y ont accès. Le cloisonnement de D12 porte sur les octets
de la photo ; il n'aurait rien dit de ce qu'on en écrit.

**Conséquences.** Une photo rangée dans deux albums peut porter deux fils sans
que personne ne s'en aperçoive. C'est le prix du cloisonnement, et le cas est
rare : les albums d'une même instance se recoupent peu. Le `parentId` d'une
réponse est vérifié contre le média courant pour la même raison — sans quoi un
identifiant deviné suffirait à greffer un message dans un fil illisible.
