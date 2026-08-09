# D59 — Une vignette démontée ne s'annule pas toute seule

**Contexte.** Le symptôme rapporté était trompeur : un compte non-administrateur
restait sur « Chargement des photos » là où le compte administrateur affichait
l'album. Tout accusait le contrôle d'accès. Ce n'en était pas : les requêtes
n'échouaient pas, elles **attendaient** — et finissaient par aboutir.

Retirer un `<img>` du DOM n'annule pas son téléchargement. La virtualisation de
la grille démonte les vignettes sorties de la fenêtre, mais le navigateur mène
leurs requêtes à terme, et chacune continue d'occuper l'une des **six**
connexions que HTTP/1.1 accorde à une origine. Quelques dizaines de vignettes
froides suffisent à saturer ce plafond ; tout ce qui part ensuite attend son
tour, y compris le `GET /items` dont dépend l'affichage. D'où l'écart entre les
deux comptes, qui n'avait rien à voir avec les droits : l'un avait toutes ses
vignettes en cache navigateur, l'autre ouvrait une session neuve.

Le cas le plus net est le **changement de sens de tri** : il relance `/items`
derrière la volée de vignettes de l'ordre précédent, devenues inutiles mais
toujours en cours. L'écran reste alors sur « Chargement des photos » le temps
qu'elles se vident — plusieurs dizaines de secondes sur un album froid. Le
mécanisme est certain ; la durée exacte dépend du débit vers Drive et n'a pas été
rejouée en conditions contrôlées.

**Choix.** `Thumb` efface son `src` au démontage. C'est le seul geste qui coupe
réellement une requête d'image en cours.

Le contrôle sur `isConnected` est indispensable et n'a rien d'une précaution de
style : `StrictMode` rejoue montage et démontage **sans toucher au DOM**, si bien
que sans lui les vignettes du premier écran perdaient leur `src` à l'instant où
elles s'affichaient — React ne le réécrit pas, sa vue du DOM le croyant inchangé.
Le nœud est capté à l'exécution de l'effet, React ayant déjà remis la ref à
`null` au moment du nettoyage.

**Écarté.** _Un `AbortController` et un `fetch` par vignette_ : il faudrait gérer
soi-même les `blob:` URLs, leur révocation, et le cache HTTP qu'on perdrait au
passage — beaucoup d'appareillage pour ce qu'un attribut retiré obtient.
_Réduire l'`OVERSCAN_PX`_ : cela diminue le nombre de requêtes orphelines sans
supprimer la fuite, et dégrade le défilement rapide.

**Conséquences.** Le diagnostic initial — « bug multi-utilisateur » — était une
fausse piste complète, et c'est la leçon la plus utile de cette entrée : deux
comptes qui se comportent différemment sur la même donnée peuvent ne rien devoir
aux droits, et tout à l'état de leur cache navigateur. La mesure qui a tranché
est l'opposition entre le chronométrage serveur, qui répondait vite, et le
chronométrage navigateur, qui attendait.
