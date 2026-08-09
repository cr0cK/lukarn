# D51 — Le lieu se corrige à la journée, jamais à la photo

**Contexte.** Le géocodage inverse tombe parfois à côté : une commune limitrophe,
un lieu-dit que Nominatim ne connaît pas, une photo prise en voiture entre deux
étapes. Il faut pouvoir rectifier.

**Choix.** La correction est une colonne `place` sur `album_days`, qui prime sur
les libellés déduits. Il n'existe aucune correction par photo.

**Écarté.** _Un lieu par média._ Il ne pourrait pas vivre dans `media` :
`upsertMany` réécrit cette table intégralement à chaque synchronisation, et une
correction y serait effacée au passage suivant. Il faudrait donc une table
d'override, sa fusion partout où le GPS est lu — détail d'un média, agrégation
des journées, futur export —, et une interface pour désigner un point, c'est-à-
dire un sélecteur de carte. Pour un gain qui se confond avec celui de la
correction par journée dans l'immense majorité des cas : on corrige « on était à
Porto-Vecchio, pas à Lecci », pas la position d'une photo particulière.

**Conséquences.** Une journée dont les photos couvrent plusieurs lieux se corrige
d'un bloc ou pas du tout. C'est assumé : le champ accepte n'importe quel texte,
donc « Bonifacio, puis les Lavezzi » reste possible — simplement écrit à la main
plutôt que déduit. La correction survit aux synchronisations et aux recalculs,
puisqu'elle ne vit pas dans `media`.
