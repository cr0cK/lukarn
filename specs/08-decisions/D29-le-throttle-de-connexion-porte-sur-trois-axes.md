# D29 — Le throttle de connexion porte sur trois axes

**Contexte.** D13 avait retenu une clé unique `<ip>:<username>`, en assumant
qu'une attaque distribuée ou un balayage d'identifiants ne seraient pas ralentis.
Cette limite est plus coûteuse qu'estimé : chaque tentative refusée déclenche une
vérification argon2, volontairement lente. Une adresse qui essaie des milliers
d'identifiants aléatoires ne crée que des compteurs à une tentative — jamais de
pénalité, autant de CPU consommé, et une `Map` qui grossit sans borne.

**Choix.** Trois compteurs par échec — couple IP/identifiant (5 essais libres),
identifiant seul (10), IP seule (20) — le blocage le plus long l'emportant. Même
barème de doublement au-delà. Table bornée à 20 000 entrées, purgée à l'heure par
le ménage de `main.ts`.

**Écarté.** Un plafond global de tentatives par minute : il transforme un
balayage en déni de service contre les visiteurs légitimes. Écarté aussi :
effacer le compteur d'IP sur une connexion réussie — un attaquant disposant d'un
compte sur l'instance s'en servirait pour remettre son budget à zéro entre deux
rafales ; seuls les compteurs `couple` et `identifiant` sont effacés.

**Conséquences.** Une IP partagée (NAT d'entreprise, sortie VPN) peut freiner
plusieurs visiteurs à la fois — d'où les 20 essais libres sur cet axe, quatre
fois le quota du couple. `trustProxy: true` devient franchement critique : sans
lui, `request.ip` vaut l'adresse du reverse-proxy et l'axe IP bloquerait toute
l'instance. Une attaque où chaque tentative change à la fois d'adresse et
d'identifiant reste hors de portée des trois axes ; ce n'est pas le modèle de
menace d'une galerie familiale auto-hébergée.
