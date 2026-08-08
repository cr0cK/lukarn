# D260809c — Un téléviseur ne tape pas un mot de passe : il l'affiche et le fait approuver

**Contexte.** Le seul chemin d'entrée était `POST /api/auth/login`, deux champs
à saisir. Sur un ordinateur ou un téléphone, un gestionnaire de mots de passe
les remplit ; sur un téléviseur il n'y a ni gestionnaire, ni clavier — chaque
caractère se compose à la télécommande sur un clavier virtuel, et le champ est
masqué. L'écran du salon, c'est-à-dire celui où une galerie familiale a le plus
de sens, est donc celui où elle est la plus pénible à ouvrir.

**Ce qu'un QR code ne peut pas être ici.** Un téléviseur n'a pas de caméra.
« Se connecter en scannant un QR code » n'existe donc pas dans ce sens : c'est
l'écran qui affiche et le téléphone qui scanne. Le QR ne transporte par
conséquent aucun identifiant — il ne fait qu'ouvrir une URL sur le téléphone.
Toute conception qui y mettrait un secret le mettrait, par construction, à
l'écran du salon, lisible par quiconque passe devant.

**Choix.** Un appairage à deux appareils, dans l'esprit du flux « device » de
RFC 8628 — celui qu'emploient les applications de télévision :

1. L'écran demande un appairage. Le serveur tire deux valeurs de natures
   opposées : un `userCode` de huit caractères, **fait pour être vu** — affiché
   en clair et repris dans le QR —, et un `deviceCode` de 32 octets, **fait pour
   ne l'être jamais**, rendu au seul demandeur.
2. Un téléphone **déjà connecté** ouvre `/pair?code=…` et approuve.
3. L'écran, qui interroge le serveur toutes les deux secondes, relève la session.

Rien de neuf du côté des droits : la session porte le compte de celui qui
approuve, donc ses albums, et `plugins/auth.ts` continue de les réévaluer à
chaque requête. Un compte étant une clé d'accès partagée et non une personne
([D38](../08-decisions.md#d38--une-clé-daccès-nest-pas-une-personne)),
déléguer cette clé à l'écran du salon ne transmet rien de nominatif.

**Ce que chaque valeur protège :**

| Valeur               | Où elle passe                           | Ce qu'elle empêche                                                                            |
| -------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `userCode` (8 car.)  | Écran, QR, URL ouverte sur le téléphone | Rien à elle seule — elle ne fait que désigner une demande en attente.                         |
| `deviceCode` (32 o.) | Réponse au demandeur, corps du sondage  | Qu'un tiers ayant lu le code à l'écran relève la session à la place de l'appareil qui attend. |

**L'identité de commentateur ne suit pas la session.** L'appareil appairé arrive
sans identité, comme après une connexion au mot de passe : elle vaut pour la
personne, pas pour la clé. Sans cette règle, approuver depuis son téléphone
laisserait le téléviseur du salon signer « Mamie » à tout le foyer — soit
exactement l'usurpation que la vérification par code de
[D39](../08-decisions.md#d39--ladresse-est-vérifiée-par-un-code-à-usage-unique) écarte.

**Le risque assumé, et pourquoi il l'est.** Le défaut connu de ce flux est
social : faire scanner à quelqu'un un QR qui n'est pas le sien, et obtenir de
lui l'accès qu'il croyait donner à son propre écran. Aucune valeur secrète n'y
change quoi que ce soit — la victime approuve volontairement. Trois choses
bornent la portée : la page d'approbation affiche le code, qui doit
correspondre à celui de l'écran qu'on regarde ; la demande expire en cinq
minutes ; et ce qui se donne est une clé d'accès déjà partagée, révocable en
changeant son mot de passe, ce qui ferme toutes ses sessions. Une instance
familiale n'a pas de quoi justifier davantage.

Écarté au passage : afficher sur le téléphone le `User-Agent` de l'appareil
demandeur pour aider à reconnaître le sien. Il est écrit par le demandeur,
donc choisi par un attaquant — un libellé rassurant qui ne garantit rien vaut
moins que pas de libellé du tout.

**Écarté.**

- **Un lien de connexion signé, généré depuis `/admin`.** Il faut le saisir sur
  le téléviseur : c'est le problème qu'on cherchait à résoudre.
- **Un code envoyé par email.** Une adresse appartient à `commenters`, jamais à
  `users` (voir [03](../03-modele-de-donnees.md)) : en donner une à une clé
  d'accès reviendrait à confondre la clé et la personne, que D38 vient de
  séparer. Et sans SMTP, l'instance perdrait sa seule entrée confortable.
- **Les passkeys (WebAuthn), dont le flux hybride affiche justement un QR.**
  Aucun navigateur de téléviseur ne l'implémente, et l'appareil qui l'implémente
  le mieux est celui qui n'en a pas besoin.
- **Créer la session à l'approbation, l'écran n'ayant plus qu'à la relever.**
  Une session d'un an naîtrait alors même pour un écran éteint entre-temps, et
  `sessions` se remplirait de lignes que personne n'a ouvertes. Elle naît donc à
  la relève, et la demande non relevée expire sans laisser de trace.

**Conséquences.** Le mot de passe reste le seul chemin d'entrée d'un **premier**
appareil : l'appairage délègue un accès existant, il n'en crée pas. Sur une
instance dont aucun appareil n'est encore connecté, on saisit encore
l'identifiant — et c'est cohérent avec l'absence de formulaire d'inscription
comme de « mot de passe oublié » ([01](../01-vision-et-perimetre.md)).

Le QR est encodé dans le navigateur (`lib/qr.ts`, au-dessus de
`qrcode-generator` — une dépendance sans dépendance). Le faire produire par un
service tiers aurait ajouté une quatrième destination de sortie à celles que
[04](../04-securite-et-acces.md) énumère, pour lui confier l'URL de l'instance :
sans commune mesure avec les quelques kilo-octets qu'économise l'appel.
