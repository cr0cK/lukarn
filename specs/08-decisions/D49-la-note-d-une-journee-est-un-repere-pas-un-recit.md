# D49 — La note d'une journée est un repère, pas un récit

**Contexte.** L'en-tête d'une section de la grille doit pouvoir porter un lieu
et une note. Or `computeLayout` place toutes les photos **avant** que le moindre
nœud DOM n'existe : c'est ce qui donne une barre de défilement juste au premier
rendu et rend la virtualisation possible.

**Choix.** 300 caractères, deux lignes clampées, hauteur d'en-tête déclarée par
`LayoutOptions.headerHeightFor` — `56 + 20 si lieu + 40 si note`.

La hauteur est une **donnée d'entrée du calcul**, jamais une mesure. Un en-tête
qui déciderait de sa taille une fois monté passerait sous ses propres photos, et
rien ne le rattraperait : le layout ne se recalcule qu'au changement de largeur,
de liste ou de regroupement. Les deux constantes sont donc un contrat que
`SectionHeader` doit respecter, d'où ses hauteurs de ligne fixées
explicitement (`leading-5`) plutôt que laissées à la police.

Même raison pour l'éditeur, qui s'ouvre **en survol absolu** : le faire pousser
le flux décalerait toute la suite de l'album sous le curseur au moment précis où
l'on vient de cliquer.

**Écarté.** _Une note de longueur libre_, qui obligerait à mesurer l'en-tête
rendu puis à recalculer le layout — donc à faire sauter la grille une fois par
section au chargement. _Un `ResizeObserver` sur les en-têtes_ : même problème,
avec en prime une boucle de rétroaction entre la mesure et le layout.

**Conséquences.** On décrit une journée en une phrase ou deux, pas en paragraphe.
C'est le bon format pour ce que la fonctionnalité vise — « Bonifacio, puis la
plage » —, et le texte entier reste lisible en infobulle. Le jour où une vraie
narration serait voulue, elle ne vivra pas dans l'en-tête d'une grille
virtualisée.
