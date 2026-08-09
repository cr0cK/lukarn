# D66 — L'administration se navigue par rubriques, une par URL

**Contexte.** `/admin` empilait six sections dans une seule colonne. Tant que la
file de modération tenait dans un écran, la page se parcourait ; depuis qu'elle
est paginée, la page n'a plus de fin, et « Réglages » comme « Maintenance » se
retrouvent derrière des dizaines de commentaires. Le bandeau de message était
déjà collé sous la barre supérieure précisément parce qu'on ne l'aurait plus vu
autrement — un symptôme traité, pas la cause.

**Choix.** Quatre rubriques, chacune à son URL : `/admin/albums`,
`/admin/comptes`, `/admin/commentaires`, `/admin/serveur`. Une colonne de
navigation à gauche à partir de `md`, collante pour rester sous les yeux pendant
qu'on modère ; en dessous, une rangée qui défile horizontalement. `AdminNav`
expose `ADMIN_TABS`, que `AdminPage` réutilise pour valider le paramètre `:tab`,
et chaque rubrique ne monte que les attentes qui la concernent — la file de
modération n'affiche plus le chargement des albums.

Les trois sections du serveur — connexion Drive, réglages, maintenance —
restent groupées : elles répondent toutes à « comment tourne cette instance »,
et les séparer aurait donné trois pages d'une section chacune.

**Écarté.** Des onglets en état local, sans toucher aux URL : un rechargement
perd la rubrique, le retour du navigateur quitte l'administration au lieu de
revenir à la rubrique précédente, et surtout le retour de consentement Google
n'a plus de destination à nommer — il revient sur la page, pas sur la rubrique
d'où l'on est parti. Écarté aussi un accordéon, qui garde une page unique et
n'enlève rien au défilement dès qu'une section est ouverte. Écartée enfin une
entrée de navigation par section, six pour six : cela reproduit dans la marge la
liste qu'on cherche justement à raccourcir.

**Conséquences.** `/admin` redirige vers `/admin/albums` : les signets et le
bouton de la barre supérieure restent valides. Le callback OAuth redirige
désormais vers `/admin/serveur?oauth=<raison>`, la rubrique qui porte le bouton
de connexion. La section « Utilisateurs » devient « Comptes », pour s'aligner
sur « Nouveau compte » et sur le libellé de la rubrique. Une rubrique ajoutée
plus tard s'écrit dans `ADMIN_TABS` et nulle part ailleurs ; en revanche, une
section déplacée d'une rubrique à l'autre change une URL que quelqu'un a pu
mettre en signet — c'est le prix de la rubrique dans l'URL, et il est faible
devant ce qu'elle rend possible.
