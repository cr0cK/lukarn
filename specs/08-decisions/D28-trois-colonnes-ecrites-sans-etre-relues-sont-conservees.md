# D28 — Trois colonnes écrites sans être relues sont conservées

**Contexte.** `media.modified_time`, `oauth_token.scope` et
`sessions.created_at` sont renseignées à l'écriture et n'apparaissent dans
aucune requête de lecture.

**Choix.** Les garder, et documenter leur raison d'être dans `db.ts` pour qu'on
ne les prenne pas pour un oubli. `modified_time` est le repère chronologique dont
`taken_at` dérive quand l'EXIF manque, donc de quoi recalculer sans réindexer ;
`scope` dira, le jour où `SCOPES` évoluera, si le jeton stocké couvre encore ce
que l'application demande ; `created_at` est la seule trace de l'ancienneté d'une
session, la première chose qu'on regarde après un accès suspect.

**Écarté.** Les supprimer. SQLite ne retire une colonne qu'en recréant la table
et en recopiant les lignes — une migration destructive sur une base en service,
pour économiser quelques octets par ligne et perdre trois informations qu'on ne
saurait pas reconstituer. Le rapport bénéfice/risque est franchement mauvais.

**Conséquences.** Un audit « colonnes mortes » les retrouvera. Le commentaire de
`db.ts` et le tableau de [03](../03-modele-de-donnees.md) sont là pour lui
répondre.
