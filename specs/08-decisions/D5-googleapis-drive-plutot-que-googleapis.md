# D5 — `@googleapis/drive` plutôt que `googleapis`

**Contexte.** Il faut un client Drive v3 et un client OAuth2.

**Choix.** Les paquets ciblés `@googleapis/drive` et `@googleapis/oauth2`.

**Écarté.** Le méta-paquet `googleapis`, qui embarque toutes les API Google —
environ **114 Mo** installés, contre **2,5 Mo** pour les deux paquets ciblés.
Sur une image Docker reconstruite à chaque déploiement, la différence se paie en
temps de build, en taille d'image et en surface de dépendances.

**Conséquences.** `google-auth-library` n'est pas une dépendance directe : le
type `OAuth2Client` est dérivé de `InstanceType<typeof auth.OAuth2>`
(`drive/service.ts`).
