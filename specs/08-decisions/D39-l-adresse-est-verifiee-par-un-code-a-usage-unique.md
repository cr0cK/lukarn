# D39 — L'adresse est vérifiée par un code à usage unique

**Contexte.** L'identité de D38 est déclarative : derrière un mot de passe
partagé, n'importe qui peut se dire « Mamie ». Et déclarer l'adresse d'un tiers
lui ferait recevoir les notifications d'une galerie où il n'a rien demandé.

**Choix.** Un code à six chiffres envoyé à l'adresse, à saisir pour que
l'identité soit rattachée à la session. Quinze minutes de validité, cinq essais,
un envoi par minute au plus. Seul un HMAC du code est stocké.

**Écarté.** Faire confiance à la déclaration, au motif que le cercle est déjà
protégé par un mot de passe. Un mot de passe partagé circule justement plus
largement que prévu, et c'est bon marché de s'en prémunir. Écarté aussi : un lien
de confirmation cliquable plutôt qu'un code — il ouvre une seconde session dans
le navigateur par défaut, alors qu'un code se recopie dans l'onglet resté ouvert.
Écarté enfin : hacher le code en argon2, disproportionné pour un secret qui vit
quinze minutes, là où un HMAC coûte moins qu'une requête SQL.

**Conséquences.** **Sans SMTP configuré, personne ne peut commenter** : aucun
code ne peut partir. C'est cohérent — sans serveur d'envoi, les notifications ne
partiraient pas davantage —, et l'interface l'annonce au lieu d'offrir un
formulaire condamné à échouer. Le plafond de cinq essais est ce qui rend six
chiffres suffisants ; sans lui, un million de tentatives en viendraient à bout.
