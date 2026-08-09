# D82 — Un fil d'activité, parce qu'une conversation ne se découvre pas

**Contexte.** Les commentaires étaient invisibles tant qu'on n'ouvrait pas la
photo qui les portait. La pastille de la visionneuse ne se voit qu'une fois la
photo atteinte, et sur un album de milliers de vues dont dix portent un message,
personne ne tombe dessus. Une discussion pouvait donc vivre et s'éteindre sans
qu'aucun de ceux à qui elle s'adressait ne la voie — un message écrit sans
lecteur est un message perdu, et c'est le contraire de ce que des commentaires
sous des photos de famille sont censés produire.

L'administration avait déjà sa vue globale, la file de modération. Elle n'était
d'aucun secours ici : elle répond 403 hors `/api/admin`, montre les adresses
email des auteurs, et sert à trier ce qu'on retire — pas à lire ce qui s'écrit.

**Choix.** Une route `GET /api/comments/feed`, et un tiroir ouvert depuis la
barre supérieure des deux pages de galerie.

**La portée vient de `albumsFor()`, jamais de la requête.** C'est la première
route qui rend, en une réponse, des messages venus d'albums différents : une
erreur de portée n'y produit pas une page vide mais une fuite, et rien dans
l'affichage ne la signalerait — la conversation d'un album qu'on n'a pas s'y lit
comme les autres. `?album=` ne fait que restreindre ; un album qu'on ne voit pas
répond 404 comme partout (D12). Une session sans album rend une page vide, cas
qu'un test couvre en premier parce que c'est celui qu'un `IN ()` oublié
transformerait en corpus entier.

**Aucun index, aucune migration.** `ORDER BY c.id DESC` est l'ordre de la clé
primaire : SQLite parcourt la table à rebours et s'arrête au `LIMIT`. Un index
`(album_id, id DESC)` ne ferait pas mieux, SQLite ne sachant pas fusionner
l'ordre de plusieurs tranches d'un `IN`. Le cas défavorable est assumé, dans la
continuité de D67 : un compte qui ne voit qu'un album sur cinquante fait
traverser les commentaires des quarante-neuf autres avant de réunir sa page. Le
corpus reste borné par ce que des humains écrivent.

**Le paramètre `?panel=comments` est la moitié utile de l'entrée.** L'onglet du
panneau latéral était un état local de `Lightbox` : un lien vers `?photo=` ouvrait
l'image en laissant les messages fermés. Le tiroir aurait donc mené à la photo
sans mener à la conversation, c'est-à-dire nulle part. L'onglet vit maintenant
dans l'URL, comme `photo`, `order` et `group`, et les emails de notification en
profitent — un message annoncé par email menait jusque-là à une image muette.

**La pastille compte des identifiants, pas des messages.** Le repère de lecture
du fil, `gdv:comments-feed-seen`, est le plus grand id vu. Le fil est paginé et
sans total : compter ce qu'on a lu supposerait de le parcourir en entier, alors
qu'`AUTOINCREMENT` fait de l'id un jalon exact. Le repère reste dans le
navigateur pour la raison de D55 — une clé d'accès est partagée par tout un
foyer, une table côté serveur ferait effacer la pastille des autres par le
premier qui lit.

**Écarté : une notification par email de plus.** L'instance en envoie déjà pour
les réponses et les nouveautés d'album (D39, D41). Un troisième motif d'écrire
aurait fait payer à la boîte aux lettres ce qui manquait à l'interface, et se
serait heurté au fait qu'une identité n'est rattachée à aucun album — on ne sait
pas à qui écrire pour un message qui ne répond à personne.

**Écarté : une page `/activite`.** Une route de plus, et surtout on quitte la
grille pour y aller. Le tiroir laisse la galerie derrière lui : on referme et on
est encore au même endroit.

**Écarté : une icône par journée ou par mois dans les en-têtes de section.**
Filtrer sur une plage de `taken_at` demandait une jointure sur `media` — les
messages des photos disparues seraient sortis du résultat — et un bouton de plus
dans un en-tête dont toutes les hauteurs sont déclarées au pixel. La bascule
« tous les albums / cet album » couvre le besoin réel, qui est de savoir où ça
parle.

**Conséquences.** Une requête de plus au chargement de chaque page de galerie,
du même ordre que celle des compteurs d'album. Publier un commentaire invalide
les deux portées du fil, donc recharge les pages déjà parcourues du tiroir — le
tiroir est presque toujours fermé au moment où l'on écrit.

`lib/moderation.ts` devient `lib/commentGroups.ts`, et son rangement par journée
puis par photo devient générique : la file de modération et le tiroir posent la
même question, et n'ont pas à y répondre deux fois. Le tiroir s'en écarte sur un
point, assumé : les messages d'un bloc s'y lisent du plus ancien au plus récent,
parce qu'on y lit une conversation et non une file de travail.

Enfin, un album dont l'identifiant Drive serait `feed` n'obtiendrait jamais ses
compteurs, la précédence des segments littéraux de Fastify jouant ici comme pour
`unsubscribe`. Même arbitrage : la route générale prime sur un identifiant que
son créateur peut renommer.
