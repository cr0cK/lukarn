# D23 — Tests avec le runner natif de Node

**Contexte.** Il faut des tests, sans alourdir l'outillage.

**Choix.** `node --import tsx --test`, `node:assert/strict`, tests rédigés en
français.

**Écarté.** Vitest ou Jest : une dépendance de plus, une configuration de plus,
pour des tests qui n'ont besoin ni de mocking avancé, ni de DOM, ni de snapshots.

**Conséquences.** Les tests portent sur les invariants plutôt que sur les
implémentations : cloisonnement des albums, réversibilité des migrations,
absence de doublon en pagination, ordre LRU, tolérance du parseur de `Range`,
service du front. Ils documentent le comportement attendu autant qu'ils le
vérifient.
