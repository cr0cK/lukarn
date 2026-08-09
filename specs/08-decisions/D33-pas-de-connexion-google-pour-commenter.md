# D33 — Pas de connexion Google pour commenter

**Contexte.** Il fallait attacher une identité aux commentaires. L'hypothèse de
départ était un « connexion avec Google », comme le font les services grand
public.

**Choix.** L'identité reste interne à l'application. Voir D38 pour la forme
qu'elle a fini par prendre — ce qui compte ici est ce qu'on a écarté.

**Écarté.** Un OAuth Google pour les visiteurs. Trois raisons, dans cet ordre.

D'abord il est **sans objet** : toute route média exige déjà une session, donc au
moment où quelqu'un peut voir une photo, le serveur connaît son identité. Le
seul apport propre de Google serait une adresse email vérifiée — pour laquelle
un champ de formulaire rempli par le propriétaire fait le même travail sur une
instance de quelques comptes.

Ensuite il **ouvre un trou d'autorisation**. Les droits vivent dans
`user_albums`, attachés à `users.username`. Un compte Google qui se présente
n'existe dans aucune de ces tables : il faudrait une allowlist d'adresses par
album, c'est-à-dire réinventer les comptes déjà là, ou accepter que n'importe
quel détenteur d'un compte Google entre.

Enfin il **contredit le périmètre** : « un visiteur n'a jamais de compte Google
et ne voit jamais une URL Google » ([01](../01-vision-et-perimetre.md)), et
l'inscription publique en est exclue depuis l'origine.

**Conséquences.** Commenter suppose de pouvoir déjà ouvrir l'album. Si un jour
l'instance doit s'ouvrir à des gens sans compte, c'est le modèle d'accès entier
qu'il faudra reprendre, pas les commentaires.
