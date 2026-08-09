# D9 — `wildcard: true` sur `@fastify/static`

**Contexte.** Servir les bundles Vite dont les noms portent un hash qui change à
chaque build.

**Choix.** Une route générique.

**Écarté.** Le comportement par défaut de `@fastify/static`, qui **énumère les
fichiers au démarrage et déclare une route par fichier**. La liste est figée à
l'instant du démarrage : après un redéploiement à chaud, un bundle au nom inconnu
retomberait sur le gestionnaire 404, donc sur `index.html`, et le navigateur
recevrait du HTML là où il attend du JavaScript — erreur de type MIME opaque.

**Conséquences.** La route générique fait aussi correspondre `/` au répertoire
racine et refuse de le servir (403). Une route exacte `GET /`, prioritaire sur la
générique, rend `index.html` (`app.ts`).
