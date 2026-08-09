# D65 — Le sujet du mail de code nomme l'instance, pas le code

**Contexte.** Le mail de vérification portait le code en tête de son sujet —
`864781 — code de vérification`. L'intention était pratique : sur un téléphone,
la bannière de notification suffisait à lire le code sans ouvrir sa boîte. Le
corps, lui, n'a jamais nommé l'instance en HTML, alors que la version texte le
faisait ; les deux versions avaient divergé, et c'est le HTML que la
destinataire voit.

Un sujet est la partie d'un email qui fuit le plus : il s'affiche sur un écran
verrouillé, reste en clair dans l'historique des notifications du système, tient
dans une capture d'écran envoyée à quelqu'un pour demander de l'aide, et
s'affiche par-dessus l'épaule dans une liste de messages. Le corps demande, lui,
d'ouvrir le message.

**Choix.** Le sujet devient `Code de vérification — <hôte de PUBLIC_URL>`. Le
code ne figure plus que dans le corps, dans les deux versions. Le corps rappelle
en outre le geste qui a déclenché l'envoi, nomme l'hôte, et dit que le code vaut
quinze minutes et ne sert qu'une fois — ce dernier point est exact,
`CommenterRepo.verify` efface `code_hash` au succès.

**Écarté.** Garder le code dans le sujet et se contenter d'y ajouter l'hôte :
cela allonge la ligne là où les clients tronquent, sans rien retirer aux chemins
de fuite ci-dessus. Écarté aussi : un lien de vérification cliquable, qui
supprimerait la recopie — il ouvrirait une seconde session dans un autre
navigateur, alors que la personne attend dans l'onglet où elle a demandé le
code. Écarté enfin : encadrer le code dans un bloc dessiné, et le grouper en
`123 456` — la seconde forme ne se recolle pas dans un champ que `verify` valide
à six caractères après `trim()`. L'aération reste un `letter-spacing`, qui ne
touche pas à la chaîne copiée.

**Conséquences.** Le confort de lecture depuis la bannière est perdu : il faut
ouvrir le message. C'est le prix assumé. Ce mail reste le seul des trois sans
lien cliquable, ce qui le distingue de `buildCommentMail` et
`buildAlbumUpdateMail` — une future harmonisation du gabarit ne doit pas lui en
ajouter un au passage. `PUBLIC_URL` gagne un rôle de plus : mal renseignée, elle
nomme la mauvaise instance dans le sujet, et non plus seulement des liens qui ne
mènent nulle part.
