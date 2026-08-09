# D81 — L'adresse d'expédition ne reçoit rien : un `Reply-To` récupère les réponses

**Contexte.** `MAIL_FROM` porte une adresse du domaine de l'instance, par
exemple `Galerie <galerie@exemple.fr>`. Le relais qui l'émet est
transactionnel : il envoie, il ne reçoit pas. Et le domaine d'envoi n'a pas
forcément de boîte derrière cette adresse — chez plusieurs registraires, une
simple redirection suppose désormais un abonnement de messagerie.

Une réponse à une notification de commentaire partait donc dans le vide, ou
rebondissait chez son auteur. L'instance n'en savait rien : le rejet a lieu
chez le destinataire, aucun journal du serveur ne le montre.

**Choix.** Une variable facultative, `MAIL_REPLY_TO`, pose l'en-tête `Reply-To`
sur tous les messages. L'expéditeur affiché reste celui du domaine — c'est lui
qui est aligné avec SPF et DKIM, en changer ferait tomber les messages en
indésirable — mais « Répondre » vise une adresse qui, elle, a une boîte.

Elle est **indépendante** de la paire `SMTP_URL`/`MAIL_FROM`, qui reste
indissociable. Absente, aucun en-tête n'est posé et le comportement est celui
d'avant : c'est le bon réglage pour un domaine qui reçoit son courrier, et il
n'y avait aucune raison de forcer les instances existantes à déclarer quelque
chose.

**Écarté.** Un `noreply@` explicite, qui aurait supprimé le problème en
supprimant la conversation. Ces messages annoncent des commentaires de proches
sur des photos de famille ; répondre est un usage prévisible, et un
`noreply@` demande à l'expéditeur de comprendre qu'on ne lui parle pas.

Écarté aussi : composer le `Reply-To` à partir de l'adresse du commentateur qui
a déclenché la notification. Séduisant — la réponse arriverait à la bonne
personne — mais l'annonce des nouvelles photos n'a pas de commentateur
d'origine, et surtout cela divulguerait l'adresse d'un visiteur aux autres
destinataires.

**Trois garde-fous, deux sévérités.** La ligne de partage est la même que
partout ailleurs dans `env.ts` : ce qui est **faux** arrête le démarrage, ce qui
est seulement **inopérant** est journalisé.

- **La forme de `MAIL_FROM` et de `MAIL_REPLY_TO` est contrôlée** — `Nom
<adresse>` ou adresse nue — et une valeur illisible arrête le démarrage. Le
  cas visé est celui du contrôle de `SMTP_URL` (D37 pour le transport) : un
  chevron non refermé part tel quel dans l'en-tête, le relais rejette ou
  réécrit, et l'échec survient des semaines après la mise en service sans que
  rien ne le rattache à une ligne du `.env`. Le contrôle reste permissif là où
  il n'apprendrait rien : pas de point exigé dans le domaine, `@localhost` sert
  aux essais avec un relais local.
- **`MAIL_REPLY_TO` sans relais** est signalée en `warn`, pas refusée : couper
  SMTP le temps d'une intervention est légitime, et faire tomber le démarrage
  pour une variable qui n'a rien d'invalide serait disproportionné.
- **`MAIL_REPLY_TO` égale à `MAIL_FROM`** est signalée aussi. C'est le geste
  réflexe — recopier l'expéditeur — et il est pire que ne rien mettre : la
  configuration paraît faite, tandis que les réponses continuent d'aller
  précisément là où elles n'arrivaient pas. La comparaison porte sur l'adresse
  extraite, un nom d'affichage ou une différence de casse ne masquant pas le
  doublon.

C'est aussi pourquoi `mailReplyTo` vit à la racine de `Env` et non dans `mail` :
regroupée avec `smtpUrl` et `from`, elle disparaîtrait avec eux quand aucun
relais n'est configuré — c'est-à-dire dans le cas précis qu'il s'agit de
signaler.

**Conséquences.** L'adresse configurée est visible de tous les destinataires,
comme n'importe quel en-tête. Sur une instance familiale, c'est une adresse que
les destinataires connaissent déjà ; sur une instance ouverte, mieux vaut une
vraie boîte sur le domaine, et la variable reste alors vide.
