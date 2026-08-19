import type { Messages } from './messages-en.js';

/**
 * French catalogue for the server's own text, in two registers.
 *
 * **What appears on a screen keeps the impersonal one** the interface uses
 * (`packages/web/src/lib/i18n`): the subject of the sentence is the code, the album
 * or the request, and the reader is not addressed. Every `error.` below is read
 * beside the form that caused it, where nobody was written to.
 *
 * **What is sent to somebody addresses them**, with `vous`: the `mail.` messages, and
 * the `page.` text of the two unsubscribe pages, which are opened from a link in one
 * of those messages. This paragraph used to claim one register for the whole file,
 * and that is what produced "Ne le transmettre à personne" in a letter to a
 * grandmother. A message with a recipient is a letter, whatever else is in the file
 * around it.
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
  'mail.albumReason': 'Vous recevez ce message parce que vous avez ouvert cet album.',
  'mail.albumUnsubscribe': (album: string) =>
    `Ne plus être prévenu des nouvelles photos de « ${album} »`,

  'mail.codeSubject': (host: string) => `Code de vérification — ${host}`,
  'mail.codeHello': (name: string) => `Bonjour ${name},`,
  'mail.codeIntro': (host: string) =>
    `Vous venez d’indiquer cette adresse sur ${host} pour signer vos commentaires.`,
  'mail.codeHere': 'Voici le code :',
  'mail.codeValidity':
    'Entrez-le dans la page restée ouverte. Il est valable quinze minutes et ne fonctionne qu’une fois.',
  'mail.codeIgnore':
    'Si vous n’avez pas demandé ce code, ignorez ce message : tant qu’il n’a pas été entré, rien n’est rattaché à cette adresse. Ne le communiquez à personne.',

  'mail.signInSubject': (host: string) => `Code de connexion — ${host}`,
  'mail.signInIntro': (host: string) => `Ce code vous connecte à ${host}, en votre nom.`,
  'mail.signInHere': 'Voici le code :',
  'mail.signInValidity':
    'Entrez-le dans la page restée ouverte. Il est valable quinze minutes et ne fonctionne qu’une fois.',
  'mail.signInIgnore':
    'Si vous n’avez pas demandé à vous connecter, ignorez ce message : le code n’ouvre rien tant qu’il n’a pas été entré. Ne le communiquez à personne, celui qui l’entre se connecte à votre place.',

  'mail.inviteSubject': (host: string) => `Un compte pour vous sur ${host}`,
  'mail.inviteIntro': (host: string) =>
    `Un compte a été créé pour vous sur ${host}. Le code ci-dessous y donne accès, et c’est cette adresse qui identifiera vos commentaires.`,
  'mail.inviteOpen': 'Ouvrez cette page, votre adresse y est déjà remplie :',
  'mail.inviteThen': 'Puis entrez ce code :',
  'mail.inviteValidity':
    'Il est valable sept jours et ne fonctionne qu’une fois. S’il expire, vous pourrez en demander un autre depuis cette même page.',
  'mail.inviteIgnore':
    'Si vous n’attendiez pas ce message, ignorez-le : aucun compte ne s’ouvre tant que le code n’a pas été entré. Ne le communiquez à personne, celui qui l’entre se connecte à votre place.',

  /* ---------------------------------------------------- Unsubscribe pages */

  'page.unsubscribedTitle': 'Désinscription',
  'page.done': 'C’est fait',
  'page.backToGallery': 'Retour à la galerie',
  'page.commentsStopped': 'Vous ne recevrez plus d’email à l’arrivée d’un nouveau commentaire.',
  'page.commentsUnknown': 'Ce compte n’existe plus : il n’y a rien à désinscrire.',
  'page.commentsRestore': 'Pour les réactiver, adressez-vous à l’administrateur de cette instance.',
  'page.albumStopped': (album: string) =>
    `Vous ne recevrez plus d’email à l’arrivée de nouvelles photos dans « ${album} ».`,
  'page.albumUnknown': 'Cet album ou ce compte n’existe plus : il n’y a rien à désinscrire.',
  'page.albumRepliesContinue':
    'Les réponses à vos commentaires continuent de vous arriver : pour les arrêter, utilisez le lien présent dans l’un de ces emails.',
};
