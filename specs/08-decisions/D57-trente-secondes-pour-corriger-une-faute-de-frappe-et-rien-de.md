# D57 — Trente secondes pour corriger une faute de frappe, et rien de plus

**Contexte.** On publie un commentaire d'une phrase depuis un téléphone, souvent
d'un pouce, et on voit la coquille une seconde après l'avoir envoyé. Le seul
recours était de supprimer et de réécrire — ce qui, sur une réponse, emporte
aussi le fil que d'autres y avaient accroché.

**Choix.** `PATCH /api/comments/:commentId`, réservé à l'auteur, pendant
`COMMENT_EDIT_WINDOW_MS` (30 s) après la publication. `created_at` ne bouge pas,
`parent_id` non plus. Le délai est contrôlé **par le serveur** — une règle que
seule l'interface applique n'est pas une règle — et `remainingEditMs` est
partagée pour que les deux côtés tranchent à l'identique.

Trois refus distincts, et c'est délibéré. Un commentaire qui n'est pas le sien
répond **404**, indistinguable d'un identifiant inexistant, comme partout
ailleurs. Un délai dépassé répond **409 `edit_window_closed`** : le refus porte
sur l'**état** du message et non sur un droit d'accès, son auteur l'a déjà sous
les yeux, et le lui expliquer ne révèle rien. Un corps vide répond **400**.

**L'administrateur n'a aucun privilège ici.** Il masque, il supprime, il ne
réécrit pas. Retirer un propos et mettre d'autres mots dans la bouche de
quelqu'un sous son nom sont deux pouvoirs de nature différente ; le second n'a
pas sa place dans un outil dont toute la modération repose sur la réversibilité
assumée (D36).

**Écarté.** _L'édition libre et sans limite_, qui transforme un fil en document
révisable : on répond à un message, l'auteur le réécrit, et la réponse devient
incompréhensible pour qui lit ensuite. C'est la raison pour laquelle les
messageries qui autorisent l'édition affichent toutes une mention « modifié » —
un aveu qu'on ne peut plus faire confiance à ce qu'on lit. Trente secondes
n'appellent pas cette mention : personne n'a eu le temps de lire.

_Une fenêtre plus longue_, cinq ou quinze minutes : elle rendrait la mention
« modifié » nécessaire, donc l'horodatage d'édition, donc une colonne de plus —
tout un appareillage pour un cas que la suppression couvre déjà.

_Le suivi de la fenêtre côté client seulement_, sans contrôle serveur : il aurait
suffi d'un `curl` pour réécrire un commentaire d'il y a six mois.

**Conséquences.** Le décompte est affiché sur le bouton (« Modifier (12 s) »)
parce qu'un bouton qui disparaît sans prévenir se lit comme un défaut, alors que
sa disparition est ici la règle. Le formulaire ouvert n'est pas refermé
d'autorité à l'échéance : c'est le serveur qui refuse, et son message s'affiche
— fermer le champ ferait disparaître sans prévenir un texte en cours de frappe.
`Comment.canEdit` est la première valeur du contrat qui **périme d'elle-même** ;
tout consommateur doit la recouper avec `createdAt`, ce que le type dit
explicitement.
