# D61 — Le préchauffage s'arrête quand Drive n'est pas connecté

**Contexte.** `CachePrewarmer` ne consultait que `prewarmCache`. Sans connexion
Drive — instance neuve, consentement révoqué, clé de compte de service absente —
le passage parcourait l'album entier en échouant photo par photo, **pause d'une
seconde comprise** puisqu'elle est hors du `try`. Sur mille photos, c'est un
quart d'heure de boucle stérile par passage horaire, et autant de lignes de
journal qui noient ce qu'on cherche vraiment.

**Choix.** La connexion entre dans le prédicat existant :
`enabled: () => this.settings.prewarmCache && this.drive.connected`. Ce prédicat
est déjà relu à l'entrée de `run()` **et** à chaque photo (D45), donc le passage
s'arrête immédiatement, et une révocation en cours de passage l'interrompt comme
le ferait un décochage du réglage.

**Écarté.** _Ajouter `drive` à `PrewarmDeps`_ : une dépendance de plus vers un
service entier, là où un booléen suffit — et `CachePrewarmer` n'a aucune autre
raison de connaître Drive. _Un `try` autour de la pause_ : cela accélérerait la
boucle stérile au lieu de l'éviter.

**Conséquences.** Le passage ne reprend qu'au déclencheur suivant — ménage
horaire, démarrage, ou fin de synchronisation (D58). Reconnecter Drive ne relance
donc pas le préchauffage dans la seconde ; en pratique le retour d'OAuth
enchaîne une synchronisation, qui le déclenche.
