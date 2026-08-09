# D37 — Les notifications partent hors du chemin de la requête, et n'échouent jamais

**Contexte.** Un commentaire doit prévenir le propriétaire de l'instance, et
l'auteur d'un fil quand on lui répond. L'application n'avait jusque-là aucune dépendance
d'envoi d'email — « pas de courriel à envoyer » figurait même dans le hors
périmètre de [01](../01-vision-et-perimetre.md), à propos de l'inscription.

**Choix.** `nodemailer` derrière `SMTP_URL` et `MAIL_FROM`. `POST` répond dès que
la ligne est écrite ; les messages sont mis dans une file sérialisée et partent
après. Un échec est **journalisé et abandonné**, sans réessai. Sans configuration
SMTP, le `Mailer` est inerte plutôt qu'absent : aucun appelant n'a à savoir si
l'instance envoie des emails.

**Écarté.** Envoyer dans le handler : un relais SMTP lent ferait attendre
plusieurs secondes après un clic sur « Publier », pour un travail qui ne
concerne pas celui qui attend. Écarté aussi : une file persistante avec
réessais — c'est un mécanisme à surveiller, alors qu'une notification manquée
est un désagrément et que le commentaire, lui, est bien enregistré. Écarté
enfin : écrire un client SMTP maison pour éviter la dépendance ; `nodemailer`
n'a aucune dépendance runtime, ce qui rejoint le raisonnement de D5.

**Conséquences.** Le `drain()` de l'arrêt gracieux est indispensable : sans lui,
un commentaire posté juste avant un redéploiement serait enregistré sans que
personne n'en soit prévenu. Le lien de désabonnement est un HMAC sans expiration
et sans session (voir [04](../04-securite-et-acces.md)) — un email se rouvre des
mois plus tard, et demander de se connecter pour cesser d'être dérangé serait une
façon de ne pas répondre. `PUBLIC_URL` devient structurante une fois de plus :
mal renseignée, elle produit des notifications qui ne mènent nulle part.
