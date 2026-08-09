# D73 — La barre supérieure tient sur une rangée, et déclare ses contrôles au lieu de les rendre

**Contexte.** Sur un téléphone, la barre montait à **101 px** — deux rangées. La
première alignait le retour, le titre, « Admin » et « Déconnexion », soit 169 px
de boutons texte qui ramenaient le titre d'album à `D.` et le sous-titre à
`120 éléments · févri…`. La seconde ne portait que les deux bascules de vue,
réduites à des icônes muettes occupant 80 px sur 393. Sur une application dont
le principe est que le chrome ne doit pas concurrencer les photos, 12 % de la
hauteur d'écran.

**Choix.** Une rangée à toutes les largeurs (65 px). Sous `sm`, tout ce qui n'est
ni le retour ni le titre passe dans un menu où chaque entrée porte enfin un
libellé — « Regrouper par jour » plutôt qu'une icône de calendrier. De `sm` à
`lg`, les contrôles reviennent dans la barre en icônes seules. À partir de `lg`,
les libellés reparaissent.

Pour que le même contrôle sache se rendre des deux façons, `TopBar` cesse de
prendre des `children` et prend un tableau d'`actions` — `label`, `action`,
`icon`, `onSelect`.

**Écarté.** Ne mettre que les actions de compte dans le menu et laisser les
bascules de vue en icônes dans la barre : cela gardait un tap pour inverser le
tri, mais laissait les deux icônes sans nom au toucher, où aucune infobulle ne
s'affiche — c'était l'autre moitié du problème.

Écarté aussi : le kebab à toutes les largeurs. Il aurait donné un seul
comportement à écrire et à documenter, mais un écran large n'a aucune raison de
cacher cinq contrôles derrière un tap.

Écarté enfin : faire apparaître les libellés dès `md`. Mesuré à 768 px, les cinq
libellés ramenaient le titre de 456 à 144 px et tronquaient le sous-titre — le
défaut même qu'on corrigeait. `lg` est le premier seuil où les deux tiennent.

**Conséquences.** Le libellé d'une entrée de menu est l'`action`, pas le `label` :
une ligne de menu dit ce qu'elle fait, un bouton de barre dit où l'on en est.
Les deux textes existaient déjà, ils ne servaient simplement pas au même endroit.

`InstallButton` disparaît. Son état passe dans `useInstallPrompt`, parce que la
proposition s'affiche désormais à deux endroits selon la largeur et qu'un état
dupliqué aurait divergé — le bouton disparaissant après `appinstalled`, la ligne
de menu non. Le mode d'emploi iOS devient `InstallInstructions`.

**Installer se place en dernier, après « Déconnexion »**, contre l'habitude qui
met la déconnexion en fin de menu. La raison : c'est la seule entrée qui
apparaît et disparaît toute seule, selon le navigateur et selon qu'on a déjà
installé. Ailleurs, elle décalerait les contrôles permanents d'une visite à
l'autre.
