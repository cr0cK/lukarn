# D35 — Répondre à une réponse rattache à la racine, plutôt que de refuser

**Contexte.** Le besoin était « un seul niveau de réponse ». Reste à décider ce
que fait le serveur quand `parentId` désigne une réponse.

**Choix.** Le message est rattaché à la **racine du fil**. Le front, lui,
n'affiche pas de bouton « Répondre » sous une réponse.

**Écarté.** Répondre `400`. L'utilisateur qui atteint ce cas — par un client
tiers, ou une interface qui évoluerait — a une intention parfaitement claire :
écrire dans ce fil. Lui renvoyer une erreur qu'il ne peut pas corriger n'a aucune
valeur. Écarté aussi : autoriser la profondeur et l'aplatir à l'affichage, qui
aurait laissé en base une hiérarchie dont personne ne se sert et qu'il aurait
fallu parcourir à chaque lecture.

**Conséquences.** `parent_id` ne désigne **jamais** une ligne qui a elle-même un
parent — invariant tenu par `rootOf()` à l'écriture, pas par une contrainte SQL,
que SQLite ne sait pas exprimer ici. La lecture d'un fil s'en trouve simple : une
seule passe, les racines précédant leurs réponses puisque l'ordre des id est
l'ordre d'écriture. Le corollaire est qu'une réponse dont la racine disparaît
(compte supprimé, commentaire masqué) remonte en tête de fil plutôt que de
disparaître : elle appartient à son auteur, pas à celui qu'elle cite.
