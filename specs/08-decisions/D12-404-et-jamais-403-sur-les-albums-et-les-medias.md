# D12 — 404 et jamais 403 sur les albums et les médias

**Contexte.** Plusieurs utilisateurs partagent une instance et ne doivent pas
apprendre l'existence des albums des autres.

**Choix.** Un album ou un média auquel l'utilisateur n'a pas droit répond
**404**, indistinguable d'un identifiant inexistant.

**Écarté.** Un 403, plus honnête sémantiquement, mais qui confirme l'existence de
la ressource et rend la structure des albums d'autrui observable par sondage
d'URL.

**Exception assumée.** `/api/admin/*` répond 403 : l'existence de l'espace
d'administration n'est pas un secret. `packages/server/test/access.test.ts`
verrouille les deux comportements.
