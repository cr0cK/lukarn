# D20 — Zoom sur variante haute résolution plutôt que `scale()` sur le rendu d'écran

**Contexte.** L'utilisateur veut examiner le détail d'une photo dans la
visionneuse.

**Choix.** `ZoomableImage` (`packages/web/src/components/ZoomableImage.tsx`)
calcule une « échelle native » — un pixel de photo par pixel d'écran — depuis les
dimensions de l'index, et charge la variante `hd` **hors écran** au premier
agrandissement avant de substituer la source.

**Écarté.** Un `transform: scale()` sur le rendu `full` : il n'agrandit que des
pixels déjà rasterisés à 2560 px, donc il ne révèle aucun détail. Écarté aussi :
charger `hd` d'emblée, qui alourdirait chaque ouverture de photo pour un geste
que la plupart des visiteurs ne feront pas ; et rebasculer sur `full` en revenant
au cadre, qui ferait clignoter l'image à chaque aller-retour.

**Conséquences.** Le zoom d'une photo dont l'index ignore les dimensions retombe
sur celles du rendu reçu — plus limité, mais présent. Un indicateur
`chargement HD…` est affiché tant que la variante n'est pas prête, plutôt que de
bloquer le geste.
