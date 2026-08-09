# D30 — Un 401 de Drive renouvelle le jeton et retente une fois

**Contexte.** Le téléchargement d'un fichier passe par `fetch` avec un access
token porté en en-tête. Quand le propriétaire retire l'accès, Google cesse
d'accepter cet access token **avant** son expiration : Drive répond 401, mais
rien ne remonte comme `invalid_grant`, donc `guard()` ne voyait rien. Le jeton en
cache restait utilisé jusqu'à une heure, /admin affichait « connecté », et chaque
vignette échouait sur un message technique.

**Choix.** `DriveService.fetchAuthorized()` traite le 401 : il jette le client
OAuth en cache pour forcer un nouvel échange du refresh token, puis retente
**une seule fois**. L'échange passe par `guard()`, donc un refresh token refusé
est reconnu et la révocation enregistrée. Un second 401 reste une erreur — ce
n'est plus une question de jeton.

**Choix lié.** `guard()` photographie le chiffré du jeton en place au lancement
de l'appel, et `markRevoked()` n'écrit que si c'est toujours celui qui est
stocké. Une requête partie avant une reconnexion OAuth, qui échoue après
l'enregistrement du nouveau jeton, marquait sinon ce jeton tout neuf comme
révoqué — et /admin réclamait une reconnexion qui venait d'être faite. Chaque
`completeAuth` produisant un chiffré différent (sel et IV tirés à chaque fois),
la comparaison suffit à reconnaître qu'une reconnexion est passée entre-temps.

**Écarté.** Retenter en boucle : sur une grille de 200 vignettes, un 401
persistant ferait tourner le serveur à vide. Écarté aussi : marquer la révocation
dès le premier 401 — un 401 peut venir d'une permission propre au fichier, et
imposer un nouveau consentement pour cela serait disproportionné.

**Conséquences.** `accessToken()` est `protected` et non `private` : c'est le
seul point de contact réseau du service, et les tests s'en servent comme couture
pour ne pas appeler Google (`packages/server/test/revocation.test.ts`).
