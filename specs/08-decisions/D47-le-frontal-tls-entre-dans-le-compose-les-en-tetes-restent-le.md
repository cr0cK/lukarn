# D47 — Le frontal TLS entre dans le compose, les en-têtes restent dans le code

**Contexte.** L'hébergement retenu est un VPS ordinaire (écarté : Fly.io, dont
les volumes à 0,15 $/Go/mois font payer trente fois le prix d'un Drive pour
stocker ce qu'un disque de VPS inclut — et dont la facturation à l'egress ne
récompense pas le proxy média, l'entrant étant déjà gratuit). Le `compose` ne
publiait alors qu'un port sur `127.0.0.1`, à charge pour l'installateur de poser
un reverse-proxy. Trois conséquences constatées en relisant le déploiement :
le TLS était un devoir de vacances non corrigé, aucun en-tête de sécurité
n'était posé nulle part, et `trustProxy: true` ne tenait que par la grâce du
préfixe `127.0.0.1:`.

**Choix.** Caddy devient un service du `docker-compose.yml`, et `app` ne publie
plus aucun port. Les **en-têtes de sécurité, eux, restent dans l'application**
(`plugins/headers.ts`), pas dans le `Caddyfile`.

C'est cette seconde moitié qui est la décision. Le réflexe est de poser CSP et
HSTS au frontal, là où vit déjà le TLS. Mais le frontal est la pièce la plus
susceptible d'être remplacée — un nginx déjà en place, un Traefik parce qu'on
héberge autre chose, un tunnel devant tout ça — et il est absent en
développement comme dans les tests. Des en-têtes posés là ne protègent qu'une
topologie ; posés dans l'application, ils suivent le binaire, ils sont testables
par `server.inject`, et ils survivent au `Caddyfile` que quelqu'un remplacera.
Le `Caddyfile` ne garde donc que ce qu'il est seul à pouvoir faire : terminer le
TLS, et refuser un corps trop gros avant qu'il n'occupe Node.

`trustProxy` passe de `true` à `['loopback', 'uniquelocal']` dans le même
mouvement. `true` fait confiance à tout `X-Forwarded-For`, y compris forgé : le
throttle de connexion, indexé sur l'IP, ne freinait plus personne dès lors que
le port était joignable autrement que par le proxy. La protection ne dépend plus
de la façon dont l'instance est déployée.

**Écarté.** Traefik, dont la découverte par labels est un gain quand on héberge
plusieurs services et une couche à comprendre quand on n'en héberge qu'un.
Écarté aussi : `@fastify/helmet`, une dépendance de plus pour une quinzaine de
lignes dont on veut choisir chaque valeur — le défaut de helmet pose `max-age`
à deux ans, ce que la fin de cette entrée écarte, et une CSP qu'il faudrait de
toute façon réécrire entièrement. Écarté enfin : `Permissions-Policy`, qui
n'interdirait que des API que l'application n'appelle pas et dont l'usage
demanderait de toute façon l'accord explicite du visiteur.

**Conséquences.** `PUBLIC_URL` gagne un quatrième rôle : le `Caddyfile` s'en
sert comme adresse de site (`{$PUBLIC_URL}`). C'est délibéré — le domaine servi
et le domaine déclaré à Google viennent désormais de la même ligne, ce qui
supprime la panne la plus fréquente de cette installation. En contrepartie, la
variable doit être une URL publique complète et exacte : `https://` en
production, sans `/` final.

Le volume `caddy-data` s'ajoute aux sauvegardes souhaitables sans être
irremplaçable : le perdre force une réémission de certificat, et Let's Encrypt
plafonne leur nombre par domaine et par semaine.

Enfin, `HSTS` n'est posé que si `PUBLIC_URL` est en `https` — sans quoi un
navigateur ayant ouvert une instance de développement réclamerait du HTTPS à
`localhost` pendant six mois.
