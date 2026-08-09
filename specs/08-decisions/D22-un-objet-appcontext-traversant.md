# D22 — Un objet `AppContext` traversant

**Contexte.** Routes, synchronisation et pipeline média ont besoin des mêmes
services.

**Choix.** Une classe `AppContext` construite une fois dans `buildApp`, portant
config, base, repos, sessions, Drive, cache, renderer et syncer. Les fabriques de
routes la reçoivent en paramètre et n'instancient rien.

**Écarté.** Un conteneur d'injection de dépendances (surdimensionné pour huit
services), et les décorateurs Fastify (qui perdent le typage précis et
disséminent l'assemblage).

**Conséquences.** Les tests construisent un contexte réel sur un répertoire
temporaire et interrogent l'application par `server.inject()`, sans mock — voir
`packages/server/test/access.test.ts`. La config vit derrière un getter, ce qui
permet le rechargement à chaud sans reconstruire quoi que ce soit.
