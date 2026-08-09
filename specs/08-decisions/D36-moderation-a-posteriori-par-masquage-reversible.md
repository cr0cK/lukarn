# D36 — Modération a posteriori, par masquage réversible

**Contexte.** Il fallait un moyen pour l'administrateur de retirer un
commentaire.

**Choix.** Le commentaire est publié immédiatement et peut être **masqué** après
coup depuis `/admin`. `hidden_at` et `hidden_by` portent la décision. Un
commentaire masqué disparaît de la lecture pour tout le monde, son auteur
compris.

**Écarté.** La pré-modération, où chaque message attend une validation. Sur une
galerie familiale dont les comptes sont créés à la main par le propriétaire, elle
retarde tout le monde pour un risque qui n'existe pas : il n'y a pas d'inconnus.
Elle a de plus un coût caché — l'auteur ne voit pas son propre message
apparaître, et croit à une panne.

Écarté aussi : **laisser l'auteur voir son commentaire masqué**, comme le font
les grandes plateformes. Cela revient à lui laisser croire qu'on le lit encore.
Autant que la décision soit visible : c'est ce qui distingue une modération
assumée d'un bannissement furtif.

Écarté enfin : la suppression pure. Masquer garde la décision réversible, ce qui
compte quand elle est prise vite. La suppression définitive reste possible, par
`DELETE /api/comments/:id`.

**Conséquences.** Une réponse dont la racine est masquée remonte en tête de fil
(voir D35). `hidden_by` est affiché dans la file de modération plutôt que gardé
comme trace morte : sur une instance à plusieurs administrateurs, c'est la
question qu'on se pose en premier.
