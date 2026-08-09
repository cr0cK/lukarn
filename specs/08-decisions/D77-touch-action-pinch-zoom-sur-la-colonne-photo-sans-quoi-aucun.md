# D77 — `touch-action: pinch-zoom` sur la colonne photo, sans quoi aucun geste au doigt n'aboutit

**Contexte.** Sur téléphone, le déplacement dans une photo agrandie était décrit
comme « très très lent, quasi inutilisable », et le repère de position
« décrochait » dès qu'on bougeait. Ce n'était pas de la lenteur : le geste
mourait en route. Aucun `touch-action` n'était déclaré nulle part dans le front,
et avec la valeur par défaut `auto` le navigateur garde le droit de lire un
glissement d'un doigt comme un défilement. Il tranche en ce sens au bout d'un ou
deux `pointermove`, émet `pointercancel`, et les gestionnaires abandonnent —
seuls les quelques mouvements reçus avant l'arbitrage s'appliquent.

`setPointerCapture` ne protège pas de ça, contrairement à ce que son nom laisse
espérer : la capture garantit de recevoir la suite des événements, elle n'empêche
pas le navigateur d'annuler le geste.

La mesure a montré que **le balayage d'une photo à l'autre tombait de la même
façon** — il n'atteignait jamais son `pointerup`, donc ne changeait jamais de
photo. Deux gestes, un seul défaut.

| Geste, en émulation Pixel 10 | `pointermove` | `pointercancel` | Résultat            |
| ---------------------------- | ------------- | --------------- | ------------------- |
| Déplacement zoomé, `auto`    | 2             | 1               | 24 px sur 240       |
| Déplacement zoomé, corrigé   | 20            | 0               | 240 px sur 240      |
| Repère de position, `auto`   | 2             | 1               | atterrit à l'opposé |
| Repère de position, corrigé  | 12            | 0               | le point visé       |
| Balayage, `auto`             | 1             | 1               | aucun changement    |
| Balayage, corrigé            | 10            | 0               | photo suivante      |

**Choix.** `touch-action: pinch-zoom` sur la colonne photo de la visionneuse,
en permanence.

**`pinch-zoom` plutôt que `none`.** Les deux suppriment l'arbitrage, mais `none`
emporte aussi le pincement à deux doigts — le geste de zoom spontané sur
téléphone, que la visionneuse ne cherche pas à remplacer et dont elle guette
l'échelle pour charger la variante `hd` ([D20](./D20-zoom-sur-variante-haute-resolution-plutot-que-scale-sur-le-d.md)). `pinch-zoom`
ne retire que le défilement à un doigt, ce qui est exactement ce dont personne
n'a besoin là : sous la visionneuse, rien ne défile.

**Sur la colonne plutôt que sur le conteneur de `ZoomableImage`.** La règle est
la même pour tout ce qui vit dans cette colonne, et un descendant en hérite par
intersection — le repère de position, qui déclare `auto`, est protégé par la
colonne sans avoir à le dire. Une déclaration au lieu de trois, et le balayage,
qui vit dans `Lightbox`, est couvert par la même.

**En permanence plutôt que pendant le seul zoom.** Poser la valeur à
l'agrandissement aurait laissé le balayage cassé, et fait dépendre un
comportement du navigateur d'un changement de classe entre deux rendus. Le seul
geste au doigt qu'on retire hors zoom est un défilement qui n'a rien à faire
défiler.

**Écarté.** La vidéo, exclue : ses contrôles natifs de lecture ont leur propre
traitement du toucher, et le balayage y est déjà désactivé — rien ne justifiait
d'y toucher sans pouvoir l'éprouver.

**Conséquences.** Le double-tap pour zoomer, que le navigateur ajoute sous
`auto`, disparaît sur la colonne photo. C'est sans perte : un tap bref y bascule
déjà le zoom au point visé.

La vérification en automatisation s'arrête là où commence le téléphone.
L'émulation Chromium reproduit l'arbitrage — les chiffres ci-dessus en viennent —
mais pas le pincement à deux doigts, ni la sensation d'un déplacement, qui était
le défaut d'origine. Ces deux-là ne se contrôlent que sur un vrai appareil :
Playwright synthétise des pointeurs, il ne remplace pas la main.
