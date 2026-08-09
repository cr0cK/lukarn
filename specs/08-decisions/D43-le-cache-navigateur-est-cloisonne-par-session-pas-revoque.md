# D43 — Le cache navigateur est cloisonné par session, pas révoqué

**Contexte.** Relevé en revue croisée. Les réponses média sont servies en
`private, max-age=31536000, immutable` : le navigateur ne revalide jamais. Une
photo déjà chargée reste donc affichable depuis le cache alors que le compte
n'a plus le droit d'y accéder — `authorize()` n'est même pas appelé, aucune
requête n'atteint le serveur.

**Choix.** `Vary: Cookie` sur toutes les réponses média. Le cache privé est
alors indexé par la session, ce qui ferme le seul cas où quelqu'un voit une
photo qu'il n'a **jamais** eu le droit de voir : deux comptes qui se succèdent
dans le même profil de navigateur, l'ordinateur du salon.

**Écarté.** `private, no-cache` avec revalidation systématique, que la revue
proposait. C'est la réponse correcte sur le papier et elle coûte trop cher ici :
une grille de cinq cents vignettes ferait cinq cents requêtes conditionnelles à
chaque visite, chacune passant par `albumsContaining` — un aller-retour par
image sur un téléphone en 4G, pour la fonction la plus utilisée de
l'application. Écarté aussi : signer les URL média avec une échéance courte, qui
règle le même cas au prix d'un mécanisme de signature, d'une horloge et d'une
fenêtre de validité à choisir.

**Conséquence assumée.** Celui à qui on retire un album garde dans son cache les
photos qu'il avait déjà chargées, jusqu'à un an. Aucun en-tête n'y change quoi
que ce soit : il les a eues, elles sont sur son disque, et il aurait pu les
enregistrer. Le retrait d'accès empêche d'en voir de **nouvelles**, il n'efface
pas ce qui a déjà été montré. Passer en `no-cache` ne rendrait pas cette
propriété — il ajouterait seulement une requête à chaque affichage.
