# D10 — En-têtes de cache séparés entre `/assets/` et `index.html`

**Contexte.** Les deux sont servis par le même plugin statique.

**Choix.** `setHeaders` distingue sur la présence de `/assets/` dans le chemin :
`public, max-age=31536000, immutable` pour les bundles hachés,
**`no-cache` pour `index.html`**.

**Écarté.** Un `Cache-Control` unique. Long, il figerait l'application sur une
version passée après chaque déploiement, puisque `index.html` garde la même URL
tout en référençant les bundles du jour. Court, il rechargerait des bundles
immuables à chaque visite.

**Conséquences liées.** Un fichier manquant sous `/assets/` répond **404 JSON**
et non `index.html` : c'est le signe d'un déploiement incomplet, et répondre du
HTML donnerait une erreur de type MIME qui masquerait le vrai problème.
`packages/server/test/static.test.ts` verrouille les trois comportements.
