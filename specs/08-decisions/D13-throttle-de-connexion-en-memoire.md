# D13 — Throttle de connexion en mémoire

**Contexte.** Freiner les attaques par dictionnaire sans gêner une erreur de
frappe.

**Choix.** Une `Map` en mémoire, clé `<ip>:<username>`, cinq tentatives libres
puis doublement du délai jusqu'à 15 minutes, oubli après une heure sans échec.

**Écarté.** Un compteur en base ou dans Redis. L'application est mono-process et
compte quelques utilisateurs : la persistance n'apporterait qu'une dépendance de
plus. Écarté aussi : un délai fixe, qui gêne les vrais utilisateurs sans
décourager un attaquant patient.

**Conséquences.** Les compteurs sont perdus au redémarrage — un attaquant qui
provoquerait un redémarrage remettrait le compteur à zéro, ce qui est un scénario
bien plus coûteux pour lui que d'attendre. La clé combine IP et identifiant :
une attaque distribuée sur un seul compte n'est pas ralentie globalement.
