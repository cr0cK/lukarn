# D38 — Une clé d'accès n'est pas une personne

**Contexte.** D33 laissait le commentaire signé par le compte qui ouvre l'album,
avec un `display_name` et un `email` posés sur `users`. C'était une confusion :
`albums.yaml` a toujours permis de confier **un** identifiant à plusieurs
personnes — un mot de passe donné à toute une famille est l'usage prévu. Tous les
messages du foyer se seraient donc signés « famille », et l'administrateur se
serait retrouvé à saisir et à maintenir les adresses email des autres.

**Choix.** Deux niveaux séparés.

- `users` reste une **clé d'accès** : elle ouvre des albums, et rien n'interdit
  de la partager. Aucune adresse n'y est attachée.
- `commenters` est une **personne** : un nom, et une adresse email qui lui sert
  d'identité. C'est elle qui signe.

La session porte un `commenter_id` et **mémorise** l'identité sans la définir :
c'est l'adresse qui identifie, si bien que se ré-identifier depuis un autre
appareil retrouve ses commentaires et le droit de les supprimer. `comments.account`
conserve tout de même la clé d'accès employée, parce que c'est elle qu'on change
quand un mot de passe a trop circulé.

**Écarté.** Faire de l'email l'identifiant de connexion, en remplacement de
`username`. C'est la clé primaire de `users`, référencée par `user_albums` et
`comments` sans `ON UPDATE CASCADE` : il aurait fallu recréer ces tables sur une
base en service, et un changement d'adresse serait devenu un changement
d'identité. Écarté aussi : laisser l'administrateur saisir les adresses, qui ne
survit pas au premier changement d'adresse de quelqu'un d'autre.

**Conséquences.** L'adresse est obligatoire pour écrire, jamais pour lire. Elle
n'apparaît **jamais** dans un fil — seulement dans la modération, qui a besoin de
savoir qui parle derrière un nom déclaré. Les notifications destinées au
propriétaire ne peuvent plus viser « les administrateurs » : elles vont à
`settings.moderationEmail`, un réglage d'instance, puisqu'un compte administrateur
n'est plus quelqu'un de joignable.
