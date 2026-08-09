# D16 — Pagination par curseur plutôt que par OFFSET

Voir [03](../03-modele-de-donnees.md) pour le mécanisme.

**Écarté.** `LIMIT … OFFSET …` : une synchronisation qui insère des médias
pendant que l'utilisateur défile décalerait la fenêtre, et le lecteur reverrait
ou sauterait des photos. Le curseur désigne une position dans l'ordre de tri, pas
un rang.
