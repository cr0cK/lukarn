# D72 — Le nom de l'instance vit dans le `.env`, et le serveur le pose dans la coquille

**Contexte.** Une fois installée, l'application s'appelait « Photos » sous
l'icône, quelle que soit l'instance. C'est le nom qui compte le plus dans tout
le projet : il est le seul que voie quelqu'un qui ne l'a pas installée
lui-même, et deux galeries posées sur le même téléphone porteraient le même.
Le nom apparaît à quatre endroits — le `<title>`, `apple-mobile-web-app-title`,
`application-name`, et `name`/`short_name` du manifeste.

**Choix.** `APP_NAME`, avec `Photos` pour défaut. `index.html` et
`manifest.webmanifest` gardent ce défaut en dur, et le serveur y substitue la
valeur configurée **au démarrage**, une fois, en mémoire (`shell.ts`). Les deux
fichiers deviennent des routes exactes, prioritaires sur `@fastify/static`. Le
front relit le nom dans la balise `application-name` du DOM.

**Écarté.** Une constante de build (`import.meta.env`) : une seule image sert
toutes les installations, et reconstruire un conteneur pour renommer sa galerie
est hors de proportion. Écarté aussi : un réglage en base, à côté des comptes et
des albums — il faudrait qu'il vaille avant qu'aucun compte n'existe, puisque la
première page servie est justement l'écran de connexion, et `ConfigRepo` ne
répond pas à cette question-là. Écarté enfin : exposer le nom dans une réponse
d'API que le front lirait au démarrage. Cela ajoutait un champ au contrat, un
état de chargement, et surtout un instant où la page s'affiche sans son nom —
alors que le serveur peut simplement l'avoir déjà écrit dans l'HTML qu'il rend.

Écarté également : remplacer la chaîne « Photos » partout dans le fichier. La
substitution vise trois emplacements nommés, parce qu'un remplacement global
renommerait aussi un commentaire ou un futur texte d'interface qui contiendrait
le mot.

**Conséquences.** Substituer dans du HTML par expression régulière n'est
défendable que parce que le gabarit appartient au dépôt : ce n'est pas de
l'analyse de HTML, c'est un gabarit dont on connaît les trous. Le risque réel
est silencieux — ajouter un attribut à la balise `<title>`, intervertir `name`
et `content` dans une `<meta>`, et le motif ne correspond plus sans que rien ne
casse : le serveur démarre, la page s'affiche, elle porte le mauvais nom.
`test/shell.test.ts` fait donc tourner la substitution sur le **vrai**
`index.html`, pas sur une chaîne d'exemple.

Le nom est échappé avant d'entrer dans l'HTML. Il vient du `.env` de
l'exploitant et non d'un visiteur, mais un `"` suffit à sortir d'un attribut, et
personne ne relit son `.env` en se demandant s'il est du HTML valide.

L'icône, elle, **n'est pas** configurable : ce serait un fichier à monter dans
le conteneur, donc un volume de plus dans le compose et une procédure dans
`deploy/README.md`, pour un besoin que personne n'a encore exprimé. Le jour où
il se pose, `WEB_DIR` est déjà surchargeable.
