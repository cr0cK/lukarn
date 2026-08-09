# D46 — Le compte de service, pour ne plus voir « Google n'a pas validé cette application »

**Contexte.** `drive.readonly` est un scope que Google classe **restreint** :
tant que l'application n'est pas vérifiée, chaque consentement affiche un écran
d'avertissement rouge, qui recommande de ne pas continuer et cache le vrai lien
derrière « Paramètres avancés ». Faire lever cet écran suppose une procédure de
vérification qui, pour un scope restreint, va jusqu'à l'audit de sécurité par un
tiers — sans rapport avec une galerie familiale auto-hébergée. Les autres
sorties n'en sont pas : le type « Interne » est réservé aux organisations
Workspace, et le mode « Test » garde l'écran **et** fait expirer les refresh
tokens en sept jours.

**Choix.** `GOOGLE_SERVICE_ACCOUNT_FILE` désigne la clé JSON d'un compte de
service, qui prend le pas sur OAuth quand elle est présente. Il n'y a alors plus
de consentement du tout : l'autorisation vient du **partage du dossier** côté
Drive, exactement comme on partage un dossier avec quelqu'un.

Les deux chemins coexistent plutôt que l'un remplace l'autre. Une instance déjà
en service tourne avec son jeton OAuth ; lui imposer une migration pour un
écran qu'elle ne verra plus avant six mois serait une régression pour elle.
Poser la clé suffit à basculer, la retirer suffit à revenir — et configurer les
deux est l'état transitoire normal de cette bascule, d'où la priorité donnée à
la clé.

**Écarté.** Demander `drive.file` au lieu de `drive.readonly`, qui n'est pas un
scope restreint : il ne donne accès qu'aux fichiers choisis un par un dans le
sélecteur Google, ce qui ne permet pas d'indexer un dossier entier — la
fonctionnalité même de l'application. Écarté aussi : faire vérifier
l'application, dont le coût n'a aucun rapport avec l'usage.

**Conséquences.** La portée diminue, ce qui est un gain : `drive.readonly`
donne la lecture de **tout** le Drive, un compte de service ne voit que ce
qu'on lui partage. C'est aussi une contrainte, et la seule chose à ne pas
oublier — un dossier d'album non partagé ne produit aucune erreur, seulement un
album vide. /admin affiche donc l'adresse du compte de service en évidence,
c'est elle qu'on recopie dans le partage.

La clé, elle, ne s'expire pas : elle se protège comme `TOKEN_KEY`, hors du dépôt
et montée en lecture seule. En échange, plus rien ne peut expirer ni être
révoqué — le `invalid_grant` de D20 n'existe plus dans ce mode.
