# D19 — Trois variantes d'image, chacune pour un usage

| Variante | Côté max         | Qualité WebP | Usage                        |
| -------- | ---------------- | ------------ | ---------------------------- |
| `thumb`  | 320 / 640 / 1280 | 78           | Grille, couvertures d'albums |
| `full`   | 2560             | 82           | Visionneuse plein écran      |
| `hd`     | 4096             | 88           | Zoom                         |

**Contexte.** `full` à 2560 px remplit un écran mais ne permet pas d'examiner une
photo à sa résolution native ; servir l'original de 9 Mo pour zoomer est
disproportionné.

**Choix.** Une variante `hd` plafonnée à 4096 px, qualité plus généreuse, pesant
quelques centaines de kilo-octets. `withoutEnlargement` empêche d'inventer des
pixels : une photo de 3000 px reste à 3000 px.

**Écarté.** Servir `/original` au zoom : plusieurs mégaoctets par photo, décodés
par le navigateur, sans passer par le cache disque. Écarté aussi : `effort`
WebP plus élevé, qui coûte des centaines de millisecondes par image à la première
ouverture pour quelques pourcents de poids — d'où `effort: 4`.

**Conséquences.** L'`ETag` doit distinguer les variantes (`"<id>-full"` vs
`"<id>-hd"`), sans quoi elles partageraient la même entrée de cache navigateur et
le zoom resservirait l'image basse résolution. Côté front, `hd` n'est demandée
qu'au premier agrandissement et chargée hors écran avant d'être substituée
(`components/ZoomableImage.tsx`, voir [07](../07-frontend.md)).
