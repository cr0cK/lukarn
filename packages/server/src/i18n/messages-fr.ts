import type { Messages } from './messages-en.js';

/**
 * French catalogue for the server's own text.
 *
 * Same impersonal register as the interface (`packages/web/src/lib/i18n`): the
 * subject of a sentence is the code, the album or the message — never the person
 * reading it.
 */
export const fr: Messages = {
  /* --------------------------------------------------------- HTTP refusals */

  'error.authRequired': 'Authentification requise',
  'error.adminsOnly': 'Réservé aux administrateurs',
  'error.notSignedIn': 'Session absente',
  'error.credentialsRequired': 'Identifiant et mot de passe requis',
  'error.badCredentials': 'Identifiant ou mot de passe incorrect',
  'error.tooManyAttempts': (seconds: number) => `Trop de tentatives. Réessayer dans ${seconds} s.`,
  'error.tooManyPairings': 'Trop de demandes en cours. Réessayer dans une minute.',
  'error.deviceCodeRequired': 'Code d’appareil requis',
  'error.alreadyPaired': 'Cet écran a déjà été appairé par un autre compte.',
  'error.unknownCode': 'Ce code n’est plus valable. Relancer la connexion depuis l’écran.',

  'error.albumNotFound': 'Album introuvable',
  'error.mediaNotFound': 'Média introuvable',
  'error.commentNotFound': 'Commentaire introuvable',
  'error.accountNotFound': 'Compte introuvable',
  'error.identityNotFound': 'Identité introuvable',
  'error.invalidParameters': 'Paramètres invalides',
  'error.invalidUsername': 'Identifiant invalide',
  'error.invalidRequest': 'Requête invalide',
  'error.invalidSearch': 'Recherche invalide',
  'error.validation': (details: string) => `Requête invalide — ${details}`,

  'error.incompleteLink': 'Lien incomplet',
  'error.invalidLink': 'Lien invalide',
  'error.invalidOrExpiredLink': 'Lien invalide ou expiré',

  'error.identityRequired': 'Indiquer et vérifier une adresse email pour pouvoir commenter.',
  'error.commentLength': (max: number) => `Un commentaire doit faire entre 1 et ${max} caractères.`,
  'error.unknownParent': 'Le commentaire auquel cette réponse s’adresse n’existe plus.',
  'error.editWindowClosed': 'Le délai de correction de ce commentaire est écoulé.',

  'error.mailNotConfigured':
    'Cette galerie n’a pas de serveur mail configuré : les commentaires sont indisponibles.',
  'error.invalidIdentity': 'Adresse ou nom invalide',
  'error.codeJustSent': (seconds: number) =>
    `Un code vient d’être envoyé. Réessayer dans ${seconds} s.`,
  'error.invalidCode': 'Code invalide — six chiffres attendus.',
  'error.codeAttemptsExhausted': 'Trop de tentatives. Demander un nouveau code.',
  'error.codeWrongOrExpired': 'Code erroné ou expiré. En demander un nouveau si besoin.',
  'error.invalidEmail': 'Adresse invalide',
  'error.displayNameRequired':
    'Indiquer le nom qui signera les commentaires, puis renvoyer le code.',
  'error.identityBound':
    'Ce compte est une personne, et son adresse ne se change pas depuis cette session. Se déconnecter pour utiliser la galerie sous une autre.',

  'error.noIcon': 'Aucune icône de ce nom',
  'error.logoEmpty': 'Aucune image reçue.',
  'error.logoUnreadable':
    'Ce fichier n’a pas pu être lu comme une image. PNG, JPEG, WebP et SVG conviennent, jusqu’à 512 ko.',

  'error.noFullscreenForVideo': 'Pas de rendu plein écran pour une vidéo',
  'error.noVideoPreview': 'Aucun aperçu disponible pour cette vidéo',
  'error.unsupportedThumbSize': 'Taille de vignette non prise en charge',
  'error.videoNotReady': 'Version lisible pas encore préparée',
  'error.emptyFromStorage': 'Réponse vide du stockage',

  'error.usernameTaken': (username: string) => `L’identifiant « ${username} » est déjà pris.`,
  'error.unknownAlbum': (albumId: string) => `Album inconnu : « ${albumId} »`,
  'error.albumExists': (albumId: string) => `L’album « ${albumId} » existe déjà.`,
  'error.lastAdminRole':
    'Le rôle du dernier administrateur ne peut pas être retiré : l’instance deviendrait inadministrable. Nommer d’abord un autre administrateur.',
  'error.lastAdminDelete':
    'Le dernier administrateur ne peut pas être supprimé : l’instance deviendrait inadministrable.',
  'error.identityTaken': (username: string) =>
    `Cette adresse ouvre déjà le compte « ${username} ». Une adresse appartient à un seul compte.`,
  'error.accountAlreadyBound': (username: string) =>
    `« ${username} » est déjà une personne. Changer l’adresse d’un compte lié n’est pas proposé : le délier d’abord, ce qui lui redonne un mot de passe et ferme ses sessions.`,
  'error.noInvitationPending': (username: string) =>
    `Aucune invitation en attente pour « ${username} » : il n’y a rien à renvoyer. Indiquer l’adresse à laquelle l’inviter.`,
  'error.passwordOnBoundAccount': (username: string) =>
    `« ${username} » est lié à une personne et n’a pas de mot de passe. Le délier pour lui en donner un, ce qui ferme aussi ses sessions.`,
  'error.coverNotInAlbum': 'Cette couverture n’est pas une photo indexée dans cet album.',
  'error.serviceAccountConsent':
    'Cette instance s’authentifie avec un compte de service : il n’y a aucun consentement à donner. Partager le dossier avec son adresse depuis Google Drive.',
  'error.serviceAccountDisconnect':
    'Cette instance s’authentifie avec un compte de service : retirer GOOGLE_SERVICE_ACCOUNT_FILE, ou le partage du dossier côté Drive.',
  'error.storageNotConnected': 'Connecter un stockage avant de lancer une synchronisation.',
  'error.oauthNotConfigured':
    'Google Drive n’est pas configuré : GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET sont absents.',
  'error.storageNotFound': 'Aucune connexion de stockage avec cet identifiant.',
  'error.folderRequired':
    'Un album Google Drive nomme le dossier qu’il lit. Seul un stockage adressé par chemin peut être laissé vide pour tout lire.',
  'error.storageExists': (id: string) => `Une connexion de stockage nommée « ${id} » existe déjà.`,
  'error.storageKindUnsupported': (kind: string) =>
    `Cette version ne sait pas lire un stockage de type « ${kind} ».`,
  'error.storageInUse': (albums: string) =>
    `Ce stockage porte encore des albums (${albums}). Les déplacer ou les supprimer d’abord — ils ne pointeraient plus vers rien.`,

  /* ---------------------------------------------------------------- Emails */

  'mail.replySubject': (author: string) => `${author} a répondu à votre commentaire`,
  'mail.commentSubject': (author: string) => `${author} a commenté une photo`,
  'mail.viewPhoto': 'Voir la photo',
  'mail.unsubscribeAll': 'Ne plus recevoir aucun email de cette galerie',

  'mail.albumSubject': (count: number, album: string) =>
    `${count} nouvelle${count > 1 ? 's' : ''} photo${count > 1 ? 's' : ''} dans ${album}`,
  'mail.viewAlbum': 'Voir l’album',
  'mail.albumReason': 'Ce message arrive parce que cet album a été ouvert depuis ce compte.',
  'mail.albumUnsubscribe': (album: string) =>
    `Ne plus être prévenu des nouvelles photos de « ${album} »`,

  'mail.codeSubject': (host: string) => `Code de vérification — ${host}`,
  'mail.codeHello': (name: string) => `Bonjour ${name},`,
  'mail.codeIntro': (host: string) =>
    `Cette adresse vient d’être indiquée sur ${host} pour signer des commentaires.`,
  'mail.codeHere': 'Voici le code :',
  'mail.codeValidity':
    'À saisir dans la page restée ouverte. Il dure quinze minutes et ne fonctionne qu’une fois.',
  'mail.codeIgnore':
    'Si ce code n’a pas été demandé, ignorer ce message : tant qu’il n’est pas saisi, rien n’est rattaché à cette adresse. Ne le transmettre à personne.',

  'mail.signInSubject': (host: string) => `Code de connexion — ${host}`,
  'mail.signInIntro': (host: string) =>
    `Ce code ouvre une session sur ${host} en tant que la personne à qui appartient cette adresse.`,
  'mail.signInHere': 'Voici le code :',
  'mail.signInValidity':
    'À saisir dans la page restée ouverte. Il dure quinze minutes et ne fonctionne qu’une fois.',
  'mail.signInIgnore':
    'Si cette connexion n’a pas été demandée, ignorer ce message : le code n’ouvre rien tant qu’il n’est pas saisi. Ne le transmettre à personne — qui le saisit se connecte à votre place.',

  'mail.inviteSubject': (host: string) => `Un compte vous attend sur ${host}`,
  'mail.inviteIntro': (host: string) =>
    `Un compte vient d’être ouvert pour vous sur ${host}. Le code ci-dessous est ce qui l’ouvre, et cette adresse devient le nom qui signera vos commentaires.`,
  'mail.inviteHere': 'Voici le code :',
  'mail.inviteValidity':
    'Il dure sept jours et ne fonctionne qu’une fois. En demander un autre depuis la page de connexion s’il expire.',
  'mail.inviteLink': 'Se connecter depuis cette page, l’adresse déjà remplie :',
  'mail.inviteIgnore':
    'Si ce message est inattendu, l’ignorer : aucun compte ne s’ouvre tant que le code n’est pas saisi. Ne le transmettre à personne — qui le saisit se connecte à votre place.',

  /* ---------------------------------------------------- Unsubscribe pages */

  'page.unsubscribedTitle': 'Désinscription',
  'page.done': 'C’est fait',
  'page.backToGallery': 'Retour à la galerie',
  'page.commentsStopped': 'Plus aucun email ne sera envoyé à l’arrivée d’un nouveau commentaire.',
  'page.commentsUnknown': 'Ce compte n’existe plus : il n’y a rien à désinscrire.',
  'page.commentsRestore': 'Pour les réactiver, s’adresser à l’administrateur de cette instance.',
  'page.albumStopped': (album: string) =>
    `Plus aucun email ne sera envoyé à l’arrivée de nouvelles photos dans « ${album} ».`,
  'page.albumUnknown': 'Cet album ou ce compte n’existe plus : il n’y a rien à désinscrire.',
  'page.albumRepliesContinue':
    'Les réponses aux commentaires continuent d’arriver : elles s’arrêtent depuis le lien présent dans l’un de ces emails.',
};
