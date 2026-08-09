# D25 — Instantané mémoire de la configuration

**Contexte.** `canSee()` est appelé sur chaque requête média, donc sur chaque
vignette d'une grille de plusieurs centaines de tuiles. La config en mémoire
qu'on remplaçait ne coûtait rien.

**Choix.** `ConfigRepo` tient un instantané (albums, comptes, droits, réglages),
reconstruit à la première lecture qui suit une écriture. Étant le seul écrivain
de ces tables, il ne peut pas servir un état périmé.

**Écarté.** Une requête SQL par appel : indexée et en process, elle serait
tenable, mais c'est plusieurs centaines de requêtes par ouverture d'album pour
une donnée qui change quelques fois par mois. Écarté aussi : un cache à
expiration temporelle, qui ferait survivre un accès retiré quelques secondes —
inacceptable pour une décision d'autorisation.

**Conséquences.** Toute écriture doit passer par `ConfigRepo`. Un `UPDATE` direct
sur `users` ou `albums` depuis un autre module servirait un instantané périmé
jusqu'à la prochaine écriture légitime.
