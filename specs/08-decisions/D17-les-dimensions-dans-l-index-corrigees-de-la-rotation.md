# D17 — Les dimensions dans l'index, corrigées de la rotation

**Contexte.** La grille justifiée a besoin des proportions de chaque image avant
de pouvoir se dessiner.

**Choix.** `width` et `height` sont stockés en base, **déjà inversés** quand
`imageMediaMetadata.rotation` est impair (5 à 8 en EXIF).

**Écarté.** Mesurer les images au chargement côté client, ce qui produirait un
reflow à chaque vignette qui arrive — exactement le défaut que la disposition
justifiée est censée éviter.

**Conséquences.** C'est la décision dont dépend tout le frontend : mise en page
stable, barre de défilement correcte dès le premier rendu, virtualisation
possible. Voir [07](../07-frontend.md).
