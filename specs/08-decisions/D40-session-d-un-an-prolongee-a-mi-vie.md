# D40 — Session d'un an, prolongée à mi-vie

**Contexte.** Le TTL de 30 jours obligeait à ressaisir un mot de passe partagé
plusieurs fois par an, pour une galerie familiale consultée irrégulièrement. La
demande était « une session qui ne se termine jamais ».

**Choix.** Un an, repoussé d'un an dès que la session a passé sa mi-vie. En
pratique on ne se déconnecte jamais tant qu'on utilise la galerie.

**Écarté.** Une session sans expiration. C'est un jeton de connexion permanent —
volé une fois, valable à vie — et la table `sessions` grossirait sans que rien ne
la nettoie, la purge horaire n'ayant plus rien à purger. Écarté aussi : le
« cookie de session » au sens HTTP, sans `maxAge`, qui fait exactement l'inverse
de ce qui était demandé puisqu'il meurt à la fermeture du navigateur. Écarté
enfin : repousser l'échéance à chaque requête, soit une écriture SQLite par
vignette ; à mi-vie, c'est une écriture par visiteur et par semestre.

**Conséquences.** Une session abandonnée met jusqu'à un an à disparaître, contre
un mois auparavant. Les leviers de coupure immédiate restent les mêmes et
comptent d'autant plus : suppression du compte et changement de mot de passe
ferment les sessions, et `plugins/auth.ts` relit les droits à chaque requête.
