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
  'error.coverNotInAlbum': 'Cette couverture n’est pas une photo indexée dans cet album.',
  'error.serviceAccountConsent':
    'Cette instance s’authentifie avec un compte de service : il n’y a aucun consentement à donner. Partager le dossier avec son adresse depuis Google Drive.',
  'error.serviceAccountDisconnect':
    'Cette instance s’authentifie avec un compte de service : retirer GOOGLE_SERVICE_ACCOUNT_FILE, ou le partage du dossier côté Drive.',
  'error.storageNotConnected': 'Connecter un stockage avant de lancer une synchronisation.',
  'error.oauthNotConfigured':
    'Google Drive n’est pas configuré : GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET sont absents.',
  'error.storageNotFound': 'Aucune connexion de stockage avec cet identifiant.',
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
