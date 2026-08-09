# D80 — La couverture d'un album se choisit sur la photo, et retombe toute seule

**Contexte.** La couverture affichée sur la page d'accueil était toujours la
photo la plus récente de l'album. Sur un album de vacances, c'est le trajet du
retour ; sur un album « les enfants » couvrant dix ans, c'est ce qu'on a
téléversé hier. La vignette qui représente l'album ne représentait rien, et
rien ne permettait de la changer.

**Choix.** Une colonne `albums.cover_media_id` porte le choix, `NULL` valant
« automatique ». Le geste vit dans la visionneuse, réservé à l'administrateur :
on choisit une photo en la regardant en grand, pas dans une liste de noms de
fichiers.

C'est la même règle que la description d'album et la note de journée — **la
saisie est dans l'album, la mutation reste sous `/api/admin`**, seul préfixe
qui réponde 403 (D50). Le retour à l'automatique, lui, est un bouton de
`/admin` : c'est le seul écran qui sache dire si une couverture a été choisie
ou si elle est celle du défaut, et cette distinction est précisément ce que le
bouton propose de défaire.

**Le repli est permanent, et c'est le cœur de l'entrée.** La colonne ne porte
aucune clé étrangère vers `media` : `deleteStale` retire une photo dès qu'une
synchronisation ne la revoit pas — corbeille Drive le temps d'un retour en
arrière, dossier renommé, sync interrompue. Une cascade effacerait le choix sur
un contretemps d'indexation. `MediaRepo.stats(albumId, chosenId)` calcule donc
la couverture à la lecture : la photo choisie si elle est là, la plus récente
sinon, sans que le choix soit touché. L'identifiant Drive étant stable, la photo
revenue redevient la couverture d'elle-même. Le même raisonnement avait déjà
écarté la clé étrangère sur `comments.media_id`.

Deux champs homonymes en découlent, et il faut les distinguer : `Album.coverId`
est la couverture **servie**, `AdminAlbum.coverId` le **choix** — `null` pour
automatique. Les confondre ferait afficher « couverture choisie » à côté de tous
les albums.

**Écarté.** Un sélecteur en grille dans `/admin`. C'était la demande littérale,
mais il rejouerait la grille de l'album pour rien, et surtout il ne marche que
si le compte administrateur a accès à l'album : les vignettes passent par
`/api/media`, où `canSee` répond 404 à qui n'a pas l'album. Le premier
administrateur détient le joker `*`, mais rien ne l'impose, et ouvrir l'accès
média aux administrateurs pour un confort de sélection déplacerait une règle de
cloisonnement pour une raison cosmétique.

Écarté aussi : laisser la couverture vide quand la photo choisie disparaît.
Explicite, mais une case blanche sur la page d'accueil que rien n'explique est
un défaut, pas un signal.

**Conséquences.** Une vidéo ne peut pas être couverture, ni par choix ni par
repli : le pipeline n'en rend pas de vignette, et l'album resterait sans image.
La route refuse `400 unknown_cover` sur une photo hors de l'album ou sur une
vidéo, plutôt que de l'accepter et de replier en silence — le silence ferait
découvrir le problème depuis la page d'accueil, loin du geste.

L'action de la visionneuse est la seule sans raccourci clavier. On désigne une
couverture une fois par album, et l'aide-mémoire `?` s'adresse à tous les
visiteurs, pas au seul administrateur.

Changer le périmètre Drive d'un album vide son index (D50) et donc sa
couverture, le temps de la resynchronisation. Le choix survit : si la photo
est encore dans le nouveau dossier, elle redevient la couverture sans geste.
