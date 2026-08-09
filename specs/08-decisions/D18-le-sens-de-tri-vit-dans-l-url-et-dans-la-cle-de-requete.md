# D18 — Le sens de tri vit dans l'URL et dans la clé de requête

**Contexte.** L'album peut être parcouru du plus récent au plus ancien ou
l'inverse.

**Choix.** `?order=asc` dans l'URL (le défaut `desc` n'y est pas écrit), `order`
dans la clé TanStack Query `['items', id, order]`, et un paramètre de requête
validé par une union zod fermée côté serveur.

**Écarté.** Un état React local : un lien partagé ne restituerait pas la vue, et
le retour navigateur ne ferait rien. Écarté aussi : ramener silencieusement une
valeur inconnue au défaut **côté serveur** — l'API répond 400, pour qu'un client
qui se trompe l'apprenne ; c'est le front qui absorbe une URL bricolée à la main.

**Conséquences.** Sans `order` dans la clé de requête, TanStack resservirait les
pages déjà chargées dans l'autre sens et continuerait de paginer à l'envers.
Inverser le tri renumérote l'album : la sélection est remise à zéro et la page
remonte en haut.
