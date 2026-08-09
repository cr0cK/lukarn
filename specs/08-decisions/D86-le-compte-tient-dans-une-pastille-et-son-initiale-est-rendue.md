# D86 — Le compte tient dans une pastille, et son initiale est rendue sur place

**Contexte.** La barre supérieure alignait Admin, Déconnexion et Installer, trois
boutons dont aucun ne sert au quotidien d'une visionneuse de photos ; à `lg` ils
portaient leurs libellés, soit près de 250 px pris au titre de l'album. Ailleurs,
sous « Albums », un sous-titre disait « Connecté en tant que alexis » — à
l'opposé de la barre des boutons qu'il concernait, et à l'emplacement qu'une page
d'album donne au nombre d'éléments et à la période.

**Choix.** Une pastille portant l'initiale du compte, tout à droite, à toutes les
largeurs. Elle ouvre l'`ActionMenu` déjà écrit pour les petits écrans, coiffé de
l'identifiant et — si la session porte une identité de commentateur — de son
adresse. Les contrôles de vue de la page restent seuls dans la barre, et gardent
leur propre menu sous `sm`.

Deux familles, deux emplacements : **ce que fait cette page** à gauche, **qui la
regarde** à droite. C'est ce partage qui rend la règle mémorisable ; la position
d'un contrôle cesse de dépendre de la largeur de l'écran.

L'initiale est celle de l'**identifiant**, pas du nom d'affichage, alors que la
personne est mieux décrite par le second : c'est la première ligne du menu que la
pastille abrège, et deux lettres différentes de part et d'autre du clic se
liraient comme un défaut.

**Écarté.** Gravatar, ou tout service d'avatar distant. L'adresse — ou son
empreinte, ce qui revient au même pour un annuaire d'emails — partirait chez un
tiers à chaque chargement de page, et le tiers apprendrait au passage qui
consulte quelle instance et quand. C'est cher payé pour une image décorative, sur
une application qu'on héberge précisément pour que ces données ne sortent pas.
Une lettre rendue sur place ne coûte aucune requête et ne dit rien à personne.

Écarté aussi : garder Déconnexion visible dans la barre à côté de la pastille.
Deux gestes pour la même chose, dont l'un des deux se serait fait cliquer par
erreur — c'est précisément l'action qu'on ne veut pas déclencher sans l'avoir
voulue.

**Conséquences.** Sous `sm`, une page qui déclare des contrôles de vue montre
deux cibles au lieu d'une : le menu Affichage et la pastille. Mesuré à 393 px, le
titre y perd une trentaine de pixels — c'est le prix d'un emplacement du compte
qui ne bouge plus d'une largeur à l'autre. Une page sans contrôle de vue — `/`,
`/admin` — n'affiche que la pastille : un menu vide n'offrirait qu'une cible qui
n'ouvre rien.

La pastille n'est rendue qu'une fois la session connue. Une pastille sans
initiale le temps d'un aller-retour réseau, puis une lettre, ferait sursauter la
barre à chaque changement de page.
