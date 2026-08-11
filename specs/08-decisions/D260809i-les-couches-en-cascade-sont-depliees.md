# D260809i — Les couches en cascade sont dépliées à la construction

**Contexte.** [D260809f](./D260809f-abaissement-css-pour-vieux-moteurs.md)
abaisse la feuille produite au niveau du Chromium 79 relevé sur un téléviseur, et
laisse une réserve : `@layer` n'existe pas avant Chromium 99, Tailwind v4 y
enferme toute sa sortie, et si l'application s'affichait quand même, c'est que ce
parseur-là avalait l'at-rule inconnue en gardant les règles internes. La
conclusion d'alors — « aucun abaissement ne peut le remplacer, les couches
n'étant pas simulables » — s'est révélée fausse, et le relevé qui l'a montré
vient d'un second téléviseur.

**Ce que dit ce second relevé.** Sur un LG plus récent — Chromium 87, webOS 22 —
`/diagnostic` répond **NON** à la même sonde, là où le 79 répondait OUI. Aucun
des deux ne connaît les couches ; ce qui les sépare est ce qu'ils font d'une
at-rule inconnue :

| Moteur                 | Bloc `@layer` inconnu  | Comportement                     |
| ---------------------- | ---------------------- | -------------------------------- |
| Chromium 79 (webOS 6)  | contenu conservé       | laxisme du parseur               |
| Chromium 87 (webOS 22) | **jeté avec son bloc** | ce que la spécification prescrit |

Ce n'est donc pas une régression de support entre les deux versions, c'est un
parseur qui se met en conformité. Le moteur le plus favorable était le plus
ancien, et rien ne garantissait qu'un troisième appareil ressemble au premier.

**Ce que ça coûtait.** 47 329 des 51 899 octets de la feuille produite — **91 %**
— vivent dans une couche. Sur le 87, ils disparaissent au parsing : l'application
n'est pas mal mise en page, elle est **sans style**. Simulé en injectant la
feuille amputée de ce que ce moteur jette, l'album se réduit à la flèche de
retour en SVG, dessinée pleine page.

**Choix.** Une quatrième passe du greffon, `flattenLayers`, retire les couches en
laissant leur contenu en place, et `findUnloweredDeclarations` fait échouer la
construction s'il en reste une. Le dépliage vient **en dernier**, après
`replaceIndependentTransforms` qui pose lui-même une couche.

**Pourquoi c'est sans effet sur un moteur récent.** Une couche ne change l'issue
d'un conflit que par rapport à l'ordre du texte et à la spécificité. Or :

- Tailwind **déclare ses couches dans l'ordre où il les émet** — `properties`,
  `theme`, `base`, `components`, `utilities` — donc l'ordre du texte rend déjà le
  même verdict.
- **Rien hors couche n'est une règle de style** : ce qui reste à la racine de la
  feuille, ce sont des `@property` et des `@keyframes`, que la cascade n'arbitre
  pas. Personne ne perd donc la préséance que le hors-couche donnait.

Vérifié plutôt que supposé : galerie et visionneuse capturées en Chromium
moderne, avec la feuille en couches puis dépliée, **0 pixel d'écart sur
1 314 816**. La même feuille dépliée, amputée de ce qu'un moteur d'avant
Chromium 99 conforme jette, donne également 0 pixel d'écart — c'est-à-dire que
ce moteur voit désormais la page entière.

**Ce que le dépliage fait perdre**, et qu'il faut savoir : les couches
protégeaient les utilitaires d'une règle de base plus spécifique qu'eux. Sans
elles, `main p { color: … }` battrait `.text-white`. Aucune règle de ce dépôt ni
de Tailwind n'est dans ce cas aujourd'hui — la base n'utilise que des sélecteurs
d'élément —, et le jour où ça arriverait, le défaut se verrait partout, pas
seulement sur un téléviseur. C'est le compromis : un risque uniforme et visible
contre un risque invisible chez quelqu'un d'autre.

**La sonde `/diagnostic` reste, avec son libellé corrigé.** Elle mesure « les
règles internes s'appliquent-elles », pas « les couches sont-elles supportées » :
un OUI ne prouve toujours rien d'un moteur (D260809f), et un NON ne condamne plus
l'application. Le relevé garde son intérêt pour la version du moteur et le reste
des capacités.

**Conséquences.**

- La feuille perd 101 octets — les couches ne portaient que leur propre syntaxe.
- `packages/web/src/styles.css` continue d'écrire ses `@layer base` et
  `@layer utilities` : la source ne change pas, seule la sortie est dépliée. Rien
  de nouveau à retenir pour qui écrit un composant, c'est la même règle que pour
  le reste de l'abaissement.
- Le dépliage saute les chaînes CSS en cherchant l'accolade fermante. Une
  accolade tenue par un `content` existe dans la sortie de Tailwind, et la
  compter découperait la feuille en plein milieu sans que rien ne le signale.
