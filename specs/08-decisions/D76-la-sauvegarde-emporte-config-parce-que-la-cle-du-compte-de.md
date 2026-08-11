# D76 — La sauvegarde emporte `config/`, parce que la clé du compte de service ne se retéléchargesse pas

**Contexte.** `deploy/backup.sh` prenait le volume `nonni-data` et le `.env`. Les
deux vont ensemble, D14 l'explique : le refresh token est chiffré, `TOKEN_KEY`
seul le déchiffre, une archive sans son `.env` impose un nouveau consentement.

Ce raisonnement était complet tant que Drive passait uniquement par OAuth, le
jeton vivant dans la base. L'authentification par compte de service (D50) a
déplacé l'accès à Drive dans un fichier monté depuis l'hôte,
`config/service-account.json` — ni dans le volume, ni dans le `.env`. Le script a
pourtant été écrit trois jours après elle, et ne l'a pas pris.

La spec, elle, l'avait vu : le tableau des montages de `06` porte déjà
« **Oui, si la clé y est** » sur `./config`. Ce n'est donc pas un arbitrage qu'on
révise, c'est un écart entre un script et sa propre spec.

**Ce que ça coûtait.** Une restauration rendait la base, les comptes, les albums
et les réglages — et aucun accès à Drive. Google ne délivre le JSON d'une clé
qu'à sa création. La panne n'apparaît pas à la restauration : l'application
démarre, `/admin` répond, les albums sont là. Elle apparaît à la première
synchronisation, quand plus rien ne remonte.

**Décision.** `backup.sh` archive `config/` en troisième pièce, à côté du `.env`,
sous `nonni-<horodatage>.config.tgz`.

Le répertoire entier plutôt qu'une liste de fichiers : filtrer supposerait de
tenir un motif en phase avec `.gitignore`, et l'exemple d'albums suivi par git
qui voyage avec pèse deux kilo-octets.

L'extension `.tgz` n'est pas une coquetterie. L'élagage distingue les archives
par motif, et `nonni-*.tar.gz` engloberait celle-ci : la rétention tomberait de
sept sauvegardes réelles à trois, sans un message. Un troisième `elaguer` lui est
consacré.

**Écarté.** Fondre `config/` dans l'archive du volume. Il aurait fallu préfixer
les deux arborescences pour qu'elles ne se recouvrent pas, donc changer la
disposition interne de l'archive — et la commande de restauration documentée
(`tar xzf … -C /data`) aurait cessé de convenir aux archives déjà produites. Une
sauvegarde qu'on ne sait plus restaurer avec la procédure publiée est le défaut
que ce travail corrige, pas celui qu'il introduit.

**Conséquences.** Une instance en OAuth n'a pas de `config/` à sauvegarder ; le
script le constate et n'échoue pas. Les archives antérieures à cette entrée se
restaurent inchangées, sans la clé : la reconstituer coûte trois clics dans la
console Google, et ne demande de repartager aucun album — les dossiers sont
partagés avec le compte, jamais avec l'une de ses clés.

L'archive contient désormais, pour une instance en compte de service, de quoi
lire les dossiers Drive partagés. C'était déjà le cas d'une instance en OAuth,
dont l'archive porte le jeton chiffré **et** sa clé. La différence est qu'une clé
de compte de service n'expire pas : la destination de sauvegarde doit être
traitée comme un dépôt de secrets, ce que `deploy/README.md` recommande déjà en
la chiffrant.
