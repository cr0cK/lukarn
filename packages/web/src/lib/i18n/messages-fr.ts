import type { Messages } from './messages-en';

/**
 * French interface catalogue.
 *
 * Typed as `Messages`, the shape of `messages-en.ts`: a missing key, a spurious
 * one or a different parameter list is a compilation error rather than an
 * English word appearing in a French sentence.
 *
 * **Impersonal register throughout**: "Se déconnecter", "Aucune photo", never
 * "vous". A gallery is installed by strangers for strangers, and the choice
 * between tu and vous would have to be made five hundred times, wrongly at least
 * once.
 */
export const fr: Messages = {
  /* ------------------------------------------------------------- Everywhere */

  'common.cancel': 'Annuler',
  'common.save': 'Enregistrer',
  'common.saving': 'Enregistrement…',
  'common.sending': 'Envoi…',
  'common.close': 'Fermer',
  'common.loading': 'Chargement…',
  'common.loadingLabel': 'Chargement',
  'common.saveFailed': 'L’enregistrement a échoué.',
  'common.tryAgain': 'Réessayer',
  'common.hide': 'masquer',
  'common.menu': 'Menu',

  /* ------------------------------------------------------- Dates and units */

  'unit.byte': 'o',
  'compass.north': 'N',
  'compass.south': 'S',
  'compass.east': 'E',
  'compass.west': 'O',

  'relative.justNow': 'à l’instant',
  'relative.minutes': (minutes: number) => `il y a ${minutes} min`,
  'relative.hours': (hours: number) => `il y a ${hours} h`,
  'relative.yesterday': 'hier',
  'relative.days': (days: number) => `il y a ${days} jours`,

  'day.today': 'Aujourd’hui',
  'day.yesterday': 'Hier',

  /* ------------------------------------------------------------- Top bar */

  'topbar.back': 'Retour aux albums',
  'topbar.home': 'La liste des albums',
  'topbar.admin': 'Administration',
  'topbar.signOut': 'Se déconnecter',
  'topbar.install': 'Installer',
  'topbar.view': 'Affichage',
  'topbar.account': 'Compte',
  'topbar.activity': 'Activité récente',
  'topbar.activityUnread': (unread: number) =>
    `Activité récente : ${unread} message${unread > 1 ? 's' : ''} non lu${unread > 1 ? 's' : ''}`,
  'topbar.actionTooltip': (state: string, action: string) => `${state} — ${action}`,
  'topbar.actionLabel': (state: string, action: string) => `${state}. ${action}.`,

  /* ---------------------------------------------------- Onglets bas (téléphone) */

  'tabs.label': 'Sections principales',
  'tabs.albums': 'Albums',
  'tabs.search': 'Recherche',
  'tabs.activity': 'Activité',
  'tabs.account': 'Compte',

  /* ------------------------------------------------- Réglages du lecteur */

  'prefs.title': 'Réglages',
  'prefs.section': 'Préférences',
  'prefs.scope': 'Retenu par ce navigateur, pas par le compte.',
  'prefs.language': 'Langue',
  'prefs.theme': 'Thème',
  'prefs.themeDark': 'Sombre',
  'prefs.themeLight': 'Clair',
  'prefs.themeHint': "Suit votre appareil tant que vous n'avez pas choisi ici.",

  /* ------------------------------------------------------------ Sheets */

  'sheet.expand': 'Déplier',
  'sheet.collapse': 'Replier',

  /* --------------------------------------------------------------- Search */

  'search.label': 'Rechercher',
  'search.placeholder': 'Rechercher…',
  'search.results': 'Résultats de recherche',
  'search.albums': 'Albums',
  'search.days': 'Jours et lieux',
  'search.photos': 'Photos',
  'search.searching': 'Recherche…',
  'search.empty': 'Aucun résultat',

  /* ------------------------------------------------------------- Shortcuts */

  'shortcuts.title': 'Raccourcis clavier',
  'shortcuts.albums': 'Albums',
  'shortcuts.grid': 'Grille',
  'shortcuts.viewer': 'Visionneuse',
  'shortcuts.search': 'Rechercher un album, un lieu, une photo',
  'shortcuts.walk': 'Parcourir les suggestions',
  'shortcuts.openSuggestion': 'Ouvrir la suggestion',
  'shortcuts.escapeSearch': 'Fermer la liste, puis vider le champ',
  'shortcuts.move': 'Se déplacer entre les photos',
  'shortcuts.openFullscreen': 'Ouvrir en plein écran',
  'shortcuts.firstLast': 'Première / dernière photo',
  'shortcuts.backToAlbums': 'Retour aux albums',
  'shortcuts.prevNext': 'Photo précédente / suivante',
  'shortcuts.escapeViewer': 'Quitter le zoom, puis fermer',
  'shortcuts.fullscreen': 'Plein écran',
  'shortcuts.info': 'Informations et EXIF',
  'shortcuts.comments': 'Commentaires',
  'shortcuts.download': 'Télécharger l’original',
  'shortcuts.zoom': 'Zoom à 100 %',
  'shortcuts.caption': 'Masquer / afficher la légende',
  'shortcuts.chrome': 'Masquer l’habillage, ne garder que la photo',
  'shortcuts.wheelTrigger': 'Molette',
  'shortcuts.dragTrigger': 'Glisser',
  'shortcuts.wheel': 'Zoomer ou dézoomer',
  'shortcuts.drag': 'Se déplacer dans l’image, ou dans le repère en bas à droite',
  'shortcuts.play': 'Lecture / pause de la vidéo',

  /* ---------------------------------------------------------- Installation */

  'install.title': 'Ajouter à l’écran d’accueil',
  'install.share': 'Partager',
  'install.shareHint': 'Le carré avec une flèche, en bas de l’écran sur iPhone.',
  'install.addToHome': 'Sur l’écran d’accueil',
  'install.addToHomeHint': 'Un peu plus bas dans la liste.',
  'install.add': 'Ajouter',
  'install.addHint': 'En haut à droite. Une nouvelle connexion sera demandée, une seule fois.',

  /* -------------------------------------------------------------- Sign-in */

  'login.subtitle': 'Se connecter pour accéder aux albums.',
  'login.username': 'Identifiant',
  'login.password': 'Mot de passe',
  'login.submit': 'Se connecter',
  'login.submitting': 'Connexion…',
  'login.failed': 'Connexion impossible. Réessayer.',
  'login.noAccount': 'Aucun compte n’est encore configuré.',
  'login.createAdmin': 'Créer le premier administrateur sur le serveur :',
  'login.createAdminFromSource': 'Ou, depuis les sources :',
  'login.withPhone': 'Se connecter avec un téléphone',

  'password.show': 'Afficher le mot de passe',
  'password.hide': 'Masquer le mot de passe',

  /* ------------------------------------------------------- Screen pairing */

  'device.title': 'Se connecter avec un téléphone',
  'device.hint':
    'Scanner ce code avec un téléphone déjà connecté, puis autoriser cet écran depuis le téléphone.',
  'device.qr': (url: string) => `QR code vers ${url}`,
  'device.orGoTo': 'Ou ouvrir',
  'device.andEnter': 'et saisir',
  'device.expired': 'Ce code a expiré.',
  'device.newCode': 'Afficher un nouveau code',
  'device.waiting': 'En attente de l’autorisation…',
  'device.usePassword': 'Utiliser un identifiant et un mot de passe',

  'pair.expiredTitle': 'Ce code n’est plus valable',
  'pair.expiredBody':
    'Une demande expire au bout de cinq minutes. Relancer la connexion depuis l’écran, puis scanner le nouveau code.',
  'pair.enterAnother': 'Saisir un autre code',
  'pair.doneTitle': 'C’est fait',
  'pair.doneBody': 'L’écran s’ouvre dans quelques secondes, avec les albums de',
  'pair.doneAccount': 'ce compte',
  'pair.backToAlbums': 'Retour aux albums',
  'pair.alreadyTitle': 'Cet écran a déjà été appairé',
  'pair.alreadyBody':
    'Un compte a déjà autorisé cette demande. Si ce n’était pas le bon, relancer la connexion depuis l’écran pour obtenir un nouveau code.',
  'pair.approveTitle': 'Autoriser cet écran ?',
  'pair.approveCheck': 'Vérifier que ce code est bien celui affiché sur l’écran à appairer.',
  'pair.approveWarning':
    'L’écran accédera aux mêmes albums que ce compte, tant que son mot de passe reste inchangé. Il ne pourra pas signer de commentaires en son nom.',
  'pair.approve': 'Autoriser',
  'pair.approving': 'Autorisation…',
  'pair.formTitle': 'Appairer un écran',
  'pair.formHint': 'Saisir le code affiché sur l’écran à appairer.',
  'pair.continue': 'Continuer',

  /* ---------------------------------------------------------- Album list */

  'albums.loading': 'Chargement des albums',
  'albums.loadFailed': 'Impossible de charger les albums.',
  'albums.none': 'Aucun album n’est attribué à ce compte.',
  'albums.noneAdmin': 'Créer un album depuis /admin, puis l’attribuer à un compte.',
  'albums.noneVisitor': 'Demander à l’administrateur de cette instance d’en attribuer un.',
  'albums.neverSynced': 'Pas encore synchronisé',
  'albums.empty': 'Album vide',
  'albums.itemCount': (count: number) =>
    `${count.toLocaleString('fr-FR')} élément${count > 1 ? 's' : ''}`,

  /* --------------------------------------------------------------- Album */

  'album.title': 'Album',
  'album.loadingPhotos': 'Chargement des photos',
  'album.loadFailed': 'Impossible de charger cet album.',
  'album.empty': 'Cet album ne contient encore aucune photo.',
  'album.emptyNeverSynced': 'Lancer une synchronisation depuis la page d’administration.',
  'album.emptyCheckFolder': 'Vérifier le dossier Drive vers lequel il pointe.',
  'album.newestFirst': 'Plus récentes d’abord',
  'album.oldestFirst': 'Plus anciennes d’abord',
  'album.showNewestFirst': 'Afficher les plus récentes d’abord',
  'album.showOldestFirst': 'Afficher les plus anciennes d’abord',
  'album.byMonth': 'Par mois',
  'album.byDay': 'Par jour',
  'album.groupByDay': 'Grouper par jour',
  'album.groupByMonth': 'Grouper par mois',
  'album.describe': '+ Décrire cet album',
  'album.editDescription': 'Modifier la description de l’album',
  'album.descriptionPlaceholder': 'Ce que contient cet album',
  'album.descriptionLabel': 'Description de l’album',

  /* ------------------------------------------------------ Grid and sections */

  'section.expand': 'Déplier',
  'section.collapse': 'Replier',
  'section.unit': (count: number) => (count > 1 ? 'éléments' : 'élément'),
  'section.label': (label: string, count: number) =>
    `${label}, ${count} élément${count > 1 ? 's' : ''}`,
  'section.editNote': 'Modifier la note',
  'section.annotate': 'Annoter ce jour',
  'section.annotateDay': (label: string) => `Annoter ${label}`,
  'section.place': 'Lieu',
  'section.placePlaceholder': 'Lieu (facultatif)',
  'section.notePlaceholder': 'Ce qui s’est passé ce jour-là',
  'section.noteLabel': 'Note du jour',

  'thumb.unavailable': 'Aperçu indisponible',

  /* -------------------------------------------------------------- Viewer */

  'viewer.close': 'Fermer (Échap)',
  'viewer.progress': 'Progression dans l’album',
  'viewer.actions': 'Actions sur la photo',
  'viewer.information': 'Informations',
  'viewer.zoomIn': 'Zoomer',
  'viewer.zoomOut': 'Revenir à la taille de l’écran',
  'viewer.download': 'Télécharger l’original',
  'viewer.fullscreen': 'Plein écran',
  'viewer.hideChrome': 'Masquer l’habillage',
  'viewer.showChrome': 'Afficher l’habillage (h)',
  'viewer.cover': 'Couverture de l’album',
  'viewer.setCover': 'Définir comme couverture',
  'viewer.coverFailed': 'La couverture n’a pas pu être enregistrée.',
  'viewer.previous': 'Précédente (←)',
  'viewer.next': 'Suivante (→)',
  'viewer.shortcut': (label: string, shortcut: string) => `${label} (${shortcut})`,
  'viewer.comments': 'Commentaires (c)',
  'viewer.commentsCount': (total: number) => `Commentaires : ${total} (c)`,
  'viewer.commentsUnread': (total: number, unread: number) =>
    `Commentaires : ${total}, dont ${unread} non lu${unread > 1 ? 's' : ''} (c)`,
  'viewer.videoFailed': 'Cette vidéo n’a pas pu être lue.',
  'viewer.videoTranscoding':
    'Ce navigateur ne décode pas son format. Une version lisible est en cours de préparation sur le serveur : elle démarrera ici dès qu’elle sera prête. Le fichier original reste téléchargeable.',
  'viewer.videoUnsupported':
    'Son format n’est peut-être pas lisible par ce navigateur. Le fichier original reste téléchargeable.',
  'viewer.downloadShort': 'Télécharger',

  'zoom.loadingPhoto': 'Chargement de la photo',
  'zoom.limited': (available: number, natural: number) =>
    `rendu à ${available} px sur ${natural} px`,
  'zoom.loadingHd': 'chargement HD…',
  'zoom.failed': 'Cette image n’a pas pu être affichée.',
  'zoom.locator': 'Repère de position : cliquer ou faire glisser pour se déplacer dans la photo',

  /* -------------------------------------------------------------- Caption */

  'caption.thatDay': 'Ce jour-là',
  'caption.show': 'Afficher la légende (l)',
  'caption.hide': 'Masquer la légende (l)',
  'caption.expand': 'Déplier la légende',
  'caption.collapse': 'Replier la légende',
  'caption.describe': '+ Décrire cette photo',
  'caption.edit': 'Modifier la description de cette photo',
  'caption.placeholder': 'Ce qui se passe sur cette photo',
  'caption.label': 'Description de la photo',

  /* ---------------------------------------------------------- Side panel */

  'panel.label': 'Informations et commentaires',
  'panel.close': 'Fermer le panneau (Échap)',
  'panel.sections': 'Onglets du panneau',
  'panel.info': 'Infos',
  'panel.comments': 'Commentaires',

  /* ------------------------------------------------------------ EXIF rows */

  'exif.place': 'Lieu',
  'exif.thatDay': 'Ce jour-là',
  'exif.taken': 'Prise le',
  'exif.modified': 'Modifiée le',
  'exif.dimensions': 'Dimensions',
  'exif.size': 'Poids',
  'exif.duration': 'Durée',
  'exif.camera': 'Appareil',
  'exif.lens': 'Objectif',
  'exif.focalLength': 'Focale',
  'exif.aperture': 'Ouverture',
  'exif.shutter': 'Vitesse',
  'exif.iso': 'ISO',
  'exif.position': 'Position',
  'exif.noPosition': 'Aucune donnée GPS',

  /* ------------------------------------------------------------- Comments */

  'comments.loading': 'Chargement des commentaires',
  'comments.loadFailed': 'Les commentaires n’ont pas pu être chargés.',
  'comments.empty': 'Aucun commentaire. À écrire le premier.',
  'comments.placeholder': (name: string) => `Commenter en tant que ${name}…`,
  'comments.signedAs': 'Signé',
  'comments.changeAddress': 'Changer d’adresse',
  'comments.disabled':
    'Commentaires indisponibles : cette galerie n’a pas de serveur mail configuré.',
  'comments.signIn': 'S’identifier pour commenter',
  'comments.reply': 'Répondre',
  'comments.replyPlaceholder': (name: string) => `Répondre à ${name}…`,
  'comments.edit': (seconds: number) => `Corriger (${seconds} s)`,
  'comments.editHint': 'Corriger une faute, dans les trente secondes après publication',
  'comments.editFailed': 'La correction n’a pas pu être enregistrée.',
  'comments.delete': 'Supprimer',
  'comments.post': 'Publier',
  'comments.postFailed': 'Le commentaire n’a pas pu être publié.',
  'comments.emoji': 'Ajouter un emoji',
  'comments.emojiHint': 'Ajouter un emoji — « :) » devient 🙂',
  'comments.emojiGroup': 'Emoji',
  'comments.inReply': 'en réponse',

  /* ------------------------------------------------------- Activity drawer */

  'feed.title': 'Activité récente',
  'feed.subtitle': 'Les derniers messages, toutes photos confondues.',
  'feed.close': 'Fermer l’activité (Échap)',
  'feed.everyAlbum': 'Tous les albums',
  'feed.thisAlbum': 'Cet album',
  'feed.loading': 'Chargement de l’activité',
  'feed.loadFailed': 'L’activité n’a pas pu être chargée.',
  'feed.empty': 'Aucun commentaire pour l’instant. Ouvrir une photo pour écrire le premier.',
  'feed.older': 'Messages plus anciens',
  'feed.view': (photo: string, album: string) => `Voir ${photo} dans ${album}`,
  'feed.removedPhoto': 'photo retirée de l’index',

  /* ------------------------------------------------------------- Identity */

  'identity.intro':
    'Pour commenter, il faut dire qui écrit. L’adresse signe les messages, prévient des réponses et annonce les nouvelles photos des albums ouverts ; elle n’est montrée à personne d’autre. Chaque email porte un lien pour tout arrêter.',
  'identity.namePlaceholder': 'Le nom tel qu’il apparaîtra',
  'identity.nameLabel': 'Nom affiché',
  'identity.emailLabel': 'Adresse email',
  'identity.sendFailed': 'Le code n’a pas pu être envoyé.',
  'identity.getCode': 'Recevoir un code',
  'identity.codeSent': (length: number) =>
    `Un code à ${length} chiffres vient d’être envoyé à l’adresse`,
  'identity.codeLabel': 'Code de vérification',
  'identity.checkFailed': 'Le code n’a pas pu être vérifié.',
  'identity.fixAddress': 'Corriger l’adresse',
  'identity.checking': 'Vérification…',
  'identity.confirm': 'Confirmer',

  /* --------------------------------------------------------- Administration */

  'admin.title': 'Administration',
  'admin.sections': 'Rubriques d’administration',
  'admin.notSet': 'Non renseigné',
  'admin.groupLibrary': 'Bibliothèque',
  'admin.groupPeople': 'Personnes',
  'admin.groupInstance': 'Cette instance',
  'admin.tabAlbums': 'Albums',
  'admin.tabAccounts': 'Comptes',
  'admin.tabComments': 'Commentaires',
  'admin.tabIdentity': 'Identité',
  'admin.tabServer': 'Serveur',
  'admin.tabVisits': 'Visites',
  'admin.statusFailed': 'Impossible de charger l’état du serveur.',
  'admin.oauthConnected': 'Google Drive est connecté. La première synchronisation a démarré.',
  'admin.oauthDenied': 'Autorisation refusée du côté de Google.',
  'admin.oauthInvalid': 'Réponse incomplète de Google. Relancer la connexion.',
  'admin.oauthStateMismatch':
    'Le jeton anti-CSRF ne correspond pas. Relancer la connexion depuis cette page.',
  'admin.oauthError': 'La connexion a échoué. Consulter les journaux du serveur.',

  /* ------------------------------------------------------- Administration: albums */

  'adminAlbums.title': 'Albums',
  'adminAlbums.description':
    'Un album = un dossier Google Drive indexé. Sa couverture se choisit sur la photo, depuis l’album.',
  'adminAlbums.resyncAll': 'Tout resynchroniser',
  'adminAlbums.noStorage': 'Aucun stockage connecté.',
  'adminAlbums.new': 'Nouvel album',
  'adminAlbums.none': 'Aucun album. En créer un à partir d’un dossier du Drive.',
  'adminAlbums.syncStarted': (albums: string) => `Synchronisation lancée : ${albums}`,
  'adminAlbums.nothingToSync': 'Aucun album à synchroniser.',
  'adminAlbums.syncFailed': 'Synchronisation impossible.',
  'adminAlbums.coverCleared': (title: string) =>
    `L’album « ${title} » reprend sa photo la plus récente comme couverture.`,
  'adminAlbums.updateFailed': 'Mise à jour impossible.',
  'adminAlbums.deleted': (title: string) => `Album « ${title} » supprimé.`,
  'adminAlbums.deleteFailed': 'Suppression impossible.',
  'adminAlbums.itemCount': (count: number) => `${count.toLocaleString('fr-FR')} éléments`,
  'adminAlbums.recursive': 'sous-dossiers inclus',
  'adminAlbums.syncedAgo': (relative: string) => `synchronisé ${relative}`,
  'adminAlbums.assignedTo': (accounts: string) => `Attribué à ${accounts}`,
  'adminAlbums.assignedToNobody': 'Attribué à aucun compte nommément',
  'adminAlbums.statusNever': 'jamais synchronisé',
  'adminAlbums.statusRunning': 'synchronisation en cours',
  'adminAlbums.statusOk': 'à jour',
  'adminAlbums.statusError': 'en échec',
  'adminAlbums.resync': 'Resynchroniser',
  'adminAlbums.resyncAlbum': (title: string) => `Resynchroniser l’album ${title}`,
  'adminAlbums.automaticCover': 'Couverture automatique',
  'adminAlbums.automaticCoverHint':
    'Une photo a été choisie comme couverture. Rendre à l’album sa photo la plus récente.',
  'adminAlbums.automaticCoverLabel': (title: string) =>
    `Rendre automatique la couverture de l’album ${title}`,
  'adminAlbums.edit': 'Modifier',
  'adminAlbums.editAlbum': (title: string) => `Modifier l’album ${title}`,
  'adminAlbums.delete': 'Supprimer',
  'adminAlbums.deleteAlbum': (title: string) => `Supprimer l’album ${title}`,
  'adminAlbums.confirmTitle': (title: string) => `Supprimer l’album « ${title} » ?`,
  'adminAlbums.confirmButton': 'Supprimer l’album',
  'adminAlbums.confirmMedia': (count: number) =>
    `Les ${count.toLocaleString('fr-FR')} médias indexés disparaissent de la visionneuse, et l’album disparaît pour les comptes qui y accédaient.`,
  'adminAlbums.confirmDrive':
    'Rien n’est supprimé dans Google Drive : les fichiers restent dans le dossier',
  'adminAlbums.confirmDriveEnd': '. Recréer l’album sur le même dossier le réindexera.',

  'albumForm.titleField': 'Titre',
  'albumForm.id': 'Identifiant',
  'albumForm.idFixed': 'L’identifiant ne change pas : c’est l’adresse de l’album.',
  'albumForm.idHint': 'Apparaît dans l’URL de l’album. Proposé à partir du titre.',
  'albumForm.description': 'Description (facultative)',
  'albumForm.folder': 'Dossier Google Drive',
  'albumForm.container': 'Dossier dans le stockage',
  'albumForm.containerHint': 'Chemin relatif à la racine que ce stockage déclare.',
  'albumForm.containerPlaceholder': 'vacances/2026',
  'albumForm.storage': 'Stockage',
  'albumForm.storageHint': 'Où vivent les fichiers de cet album.',
  'albumForm.storageEditHint':
    'En changer vide l’index de l’album et le réindexe : le même chemin ailleurs, ce sont d’autres fichiers.',
  'albumForm.folderExtracted': 'Identifiant retenu :',
  'albumForm.folderHint': 'Coller l’URL du dossier : l’identifiant est le segment après /folders/.',
  'albumForm.recursive': 'Inclure les sous-dossiers',
  'albumForm.recursiveHint':
    'Décocher pour n’indexer que les fichiers placés directement dans le dossier.',
  'albumForm.byDay': 'Ouvrir la grille groupée par jour',
  'albumForm.byDayHint':
    'Le bon découpage pour un voyage. Les notes de jour n’apparaissent que par jour. Un visiteur peut toujours revenir en arrière.',
  'albumForm.newestFirst': 'Ouvrir l’album les plus récentes d’abord',
  'albumForm.newestFirstHint':
    'Décoché, l’album se lit dans l’ordre où il a été vécu. Cocher pour une bibliothèque alimentée au fil de l’eau. Un visiteur peut inverser, et son navigateur s’en souvient.',
  'albumForm.create': 'Créer l’album',
  'albumForm.created': (title: string) =>
    `Album « ${title} » créé. La synchronisation va le remplir.`,
  'albumForm.saved': (title: string) => `Album « ${title} » enregistré.`,

  /* ----------------------------------------------------- Administration: accounts */

  'adminUsers.title': 'Comptes',
  'adminUsers.description': 'Qui peut se connecter, et à quels albums.',
  'adminUsers.new': 'Nouveau compte',
  'adminUsers.loading': 'Chargement des comptes',
  'adminUsers.loadFailed': 'Impossible de charger les comptes.',
  'adminUsers.none': 'Aucun compte. En créer un pour que quelqu’un puisse se connecter.',
  'adminUsers.administrator': 'administrateur',
  'adminUsers.you': '(ce compte)',
  'adminUsers.edit': 'Modifier',
  'adminUsers.editAccount': (username: string) => `Modifier le compte ${username}`,
  'adminUsers.delete': 'Supprimer',
  'adminUsers.deleteAccount': (username: string) => `Supprimer le compte ${username}`,
  'adminUsers.cannotDeleteSelf': 'Impossible de supprimer le compte en cours d’utilisation.',
  'adminUsers.deleted': (username: string) => `Compte « ${username} » supprimé.`,
  'adminUsers.deleteFailed': 'Suppression impossible.',
  'adminUsers.confirmTitle': (username: string) => `Supprimer le compte « ${username} » ?`,
  'adminUsers.confirmButton': (username: string) => `Supprimer ${username}`,
  'adminUsers.confirmSignIn': 'Ce compte ne pourra plus se connecter.',
  'adminUsers.confirmMedia': 'Les albums et les médias indexés ne sont pas touchés.',

  'userForm.username': 'Identifiant',
  'userForm.usernameFixed':
    'L’identifiant ne change pas ; supprimer et recréer le compte si nécessaire.',
  'userForm.usernameHint': 'Lettres, chiffres, point, tiret ou tiret bas.',
  'userForm.password': 'Mot de passe',
  'userForm.newPassword': 'Nouveau mot de passe',
  'userForm.passwordKeep': 'Laisser vide pour conserver le mot de passe actuel.',
  'userForm.passwordHint': (min: number) => `${min} caractères minimum.`,
  'userForm.admin': 'Rôle administrateur',
  'userForm.adminSelf':
    'Impossible de retirer son propre rôle : cette page a besoin d’un administrateur.',
  'userForm.adminHint':
    'Donne accès à cette page. L’accès aux albums reste celui choisi ci-dessous.',
  'userForm.create': 'Créer le compte',
  'userForm.created': (username: string) => `Compte « ${username} » créé.`,
  'userForm.saved': (username: string) => `Compte « ${username} » enregistré.`,

  'access.legend': 'Albums accessibles',
  'access.every': 'Tous les albums',
  'access.everyHint': 'Y compris ceux créés plus tard. Enregistré sous la forme du joker',
  'access.selection': 'Une sélection d’albums',
  'access.selectionHint':
    'Uniquement les albums cochés. Un album créé plus tard devra être attribué à la main.',
  'access.noAlbum':
    'Aucun album n’existe encore. En créer un dans la rubrique Albums, ou accorder le joker.',
  'access.albumDetail': (id: string, count: number) =>
    `${id} · ${count.toLocaleString('fr-FR')} éléments`,
  'access.orphan': 'album inconnu — décocher pour le retirer',
  'access.allTicked':
    'Tous les albums actuels sont cochés, ce qui n’équivaut pas à « Tous les albums » : les prochains ne seront pas attribués automatiquement.',
  'access.everyPresentAndFuture': 'Tous les albums, présents et à venir',
  'access.none': 'Aucun album',
  'access.andOthers': (named: string, rest: number) =>
    `${named} et ${rest} autre${rest > 1 ? 's' : ''}`,

  /* -------------------------------------------------- Administration: form errors */

  'validate.username': 'Saisir un identifiant.',
  'validate.usernameLength': (max: number) =>
    `Un identifiant ne peut pas dépasser ${max} caractères.`,
  'validate.identifierPattern':
    'Lettres, chiffres, point, tiret ou tiret bas, en commençant par une lettre ou un chiffre.',
  'validate.albumId': 'Saisir un identifiant.',
  'validate.password': 'Saisir un mot de passe.',
  'validate.passwordLength': (min: number) =>
    `Un mot de passe doit faire au moins ${min} caractères.`,
  'validate.title': 'Saisir un titre.',
  'validate.folder': 'Indiquer le dossier Drive.',
  'validate.folderPattern':
    'Coller l’URL du dossier Drive ou son identifiant — le segment après /folders/.',
  'validate.container': 'Indiquer le dossier à lire.',
  'validate.containerPattern': 'Un chemin relatif à la racine du stockage, sans segment parent.',
  'validate.storageLabel': 'Donner un nom à ce stockage.',
  'validate.storagePath': 'Un dossier situé dans la racine, sans segment parent.',
  'validate.storageEndpoint': 'Indiquer l’adresse du service, commençant par https://.',
  'validate.storageBucket': 'Indiquer le nom du bucket.',
  'validate.storageAccessKey': 'Indiquer la clé d’accès.',
  'validate.storageSecretKey': 'Indiquer la clé secrète.',
  'validate.interval': 'Indiquer un nombre entier de minutes (0 pour désactiver).',
  'validate.cacheSize': 'Indiquer une taille en gigaoctets.',
  'validate.cacheSizePositive': 'La taille du cache doit être supérieure à 0.',
  'validate.instanceName': 'Donner un nom à cette galerie.',
  'validate.instanceNameLength': (max: number) => `Un nom ne dépasse pas ${max} caractères.`,
  'validate.color': 'Donner une couleur écrite sous la forme #rrggbb.',

  /* ---------------------------------------------------- Administration: moderation */

  'moderation.title': 'Commentaires',
  'moderation.description':
    'Les commentaires masqués disparaissent de la galerie pour tout le monde, leur auteur compris.',
  'moderation.all': 'Tous',
  'moderation.visible': 'Visibles',
  'moderation.hidden': 'Masqués',
  'moderation.searchPlaceholder': 'Rechercher un mot, un nom, une adresse',
  'moderation.searchLabel': 'Rechercher dans les commentaires',
  'moderation.filterByAlbum': 'Filtrer par album',
  'moderation.everyAlbum': 'Tous les albums',
  'moderation.loading': 'Chargement des commentaires',
  'moderation.loadFailed': 'Les commentaires n’ont pas pu être chargés.',
  'moderation.noMatch': (query: string) => `Aucun commentaire ne correspond à « ${query} ».`,
  'moderation.noneInAlbum': 'Aucun commentaire dans cet album.',
  'moderation.noneHidden': 'Aucun commentaire masqué.',
  'moderation.noneVisible': 'Aucun commentaire visible.',
  'moderation.none': 'Aucun commentaire pour l’instant.',
  'moderation.previous': '‹ Précédent',
  'moderation.next': 'Suivant ›',
  'moderation.range': (first: number, last: number, total: number) =>
    `${first}–${last} sur ${total}`,
  'moderation.removedPhoto': 'photo retirée de l’index',
  'moderation.moderateAll': (email: string) => `Modérer tous les messages de ${email}`,
  'moderation.inReply': 'en réponse',
  'moderation.via': (account: string) => `via ${account}`,
  'moderation.hiddenBadge': 'masqué',
  'moderation.hiddenBy': (username: string) => `masqué par ${username}`,
  'moderation.hide': 'Masquer',
  'moderation.makeVisible': 'Rendre visible',
  'moderation.hiddenNotice': 'Commentaire masqué.',
  'moderation.visibleNotice': 'Commentaire de nouveau visible.',
  'moderation.failed': 'La modération a échoué.',
  'moderation.bulkRestoreTitle': (email: string) =>
    `Rendre de nouveau visibles tous les messages de ${email} ?`,
  'moderation.bulkHideTitle': (email: string) => `Masquer tous les messages de ${email} ?`,
  'moderation.bulkRestoreButton': 'Tout restaurer',
  'moderation.bulkHideButton': 'Tout masquer',
  'moderation.bulkScope': 'Cette action porte sur',
  'moderation.bulkScopeStrong': 'tous les albums',
  'moderation.bulkScopeEnd': ', pas seulement celui-ci ni seulement la page affichée.',
  'moderation.bulkRestoreHint': 'Leurs messages redeviennent lisibles par tout le monde.',
  'moderation.bulkHideHint': 'Réversible : l’onglet « Masqués » restaure tout en une fois.',
  'moderation.bulkDone': (count: number, restored: boolean) =>
    `${count} message${count > 1 ? 's' : ''} ${restored ? 'restauré' : 'masqué'}${count > 1 ? 's' : ''}.`,
  'moderation.bulkFailed': 'La modération en masse a échoué.',

  /* ------------------------------------------------------ Administration: stockage */

  'storage.title': 'Stockage',
  'storage.description': 'Où vivent les albums. Une instance peut en lire plusieurs.',
  'storage.loadFailed': 'Impossible de charger les connexions de stockage.',
  'storage.add': 'Ajouter un stockage',
  'storage.create': 'Ajouter',
  'storage.created': (label: string) => `Stockage « ${label} » ajouté.`,
  'storage.label': 'Nom',
  'storage.identifier': 'Identifiant',
  'storage.identifierHint':
    'Inscrit dans chaque album qui lit ce stockage. Il ne peut plus changer.',
  'storage.kind': 'Type',
  'storage.kindHint': 'Ce à quoi cette connexion parle. Il ne peut plus changer ensuite.',
  'storage.path': 'Dossier',
  'storage.pathHint':
    'Un dossier situé dans celui confié à ce serveur, nommé relativement à lui. Laisser ' +
    'vide pour le lire en entier. STORAGE_LOCAL_ROOT décide duquel il s’agit.',
  'storage.kindDrive': 'Google Drive',
  'storage.kindLocal': 'Dossier local',
  'storage.kindS3': 'Bucket compatible S3',
  'storage.kindWebdav': 'Serveur WebDAV',
  'storage.endpoint': 'Point d’accès',
  'storage.endpointHint':
    'L’adresse du service, pas celle du bucket : https://s3.eu-west-3.amazonaws.com, ou l’adresse de votre propre serveur.',
  'storage.region': 'Région',
  'storage.regionHint':
    'Amazon exige la région du bucket. Un service auto-hébergé l’ignore, mais les deux bouts doivent tout de même s’accorder — laisser vide pour us-east-1.',
  'storage.bucket': 'Bucket',
  'storage.prefix': 'Préfixe',
  'storage.prefixHint':
    'Facultatif. Restreint cette connexion à un dossier du bucket ; chaque album nomme ensuite un chemin à l’intérieur.',
  'storage.pathStyle': 'Adresser le bucket par chemin',
  'storage.pathStyleHint':
    'Lit bucket.example.com par défaut. MinIO, et tout bucket dont le nom n’est pas un libellé de domaine valide, ont besoin de ceci à la place.',
  'storage.accessKeyId': 'Clé d’accès',
  'storage.secretAccessKey': 'Clé secrète',
  'storage.secretAccessKeyHint':
    'Stockée chiffrée et jamais réaffichée. Une clé en lecture seule suffit : rien ici n’écrit jamais dans le bucket.',
  'storage.albumCount': (count: number) =>
    count === 0
      ? 'Aucun album ne le lit pour l’instant.'
      : `${count} album${count > 1 ? 's' : ''} le lisent.`,
  'storage.serviceAccountHint':
    'Aucun consentement à donner, aucun jeton à renouveler. Chaque dossier d’album doit être partagé en lecture seule avec cette adresse depuis Google Drive — sinon il reste invisible et sa synchronisation ne trouve rien.',
  'storage.notConfigured':
    'GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET ne sont pas définis dans le fichier',
  'storage.notConfiguredEnd': '.',
  'storage.revoked': 'Autorisation révoquée',
  'storage.revokedFor': (account: string) => `pour ${account}`,
  'storage.revokedHint':
    'L’accès a été retiré côté Google, ou le jeton a expiré. Les albums restent consultables tant que les vignettes sont en cache. Reconnecter pour relancer la synchronisation.',
  'storage.connected': 'Connecté',
  'storage.notConnected': 'Non connecté. Rien ne peut en être indexé ni servi.',
  'storage.connect': 'Connecter Google Drive',
  'storage.reconnect': 'Reconnecter Google Drive',
  'storage.connectFailed': 'La connexion a échoué.',
  'storage.disconnect': 'Déconnecter',
  'storage.disconnected': (label: string) => `« ${label} » est déconnecté.`,
  'storage.disconnectFailed': 'Impossible de déconnecter ce stockage.',
  'storage.test': 'Tester',
  'storage.testing': 'Test en cours…',
  'storage.testOk': (account: string) => `Il répond — ${account}.`,
  'storage.testFailed': 'Ce stockage n’a pas répondu.',
  'storage.delete': 'Supprimer',
  'storage.deleteOne': (label: string) => `Supprimer le stockage ${label}`,
  'storage.deleted': (label: string) => `Stockage « ${label} » supprimé.`,
  'storage.deleteFailed': 'Impossible de supprimer ce stockage.',
  'storage.confirmTitle': (label: string) => `Supprimer « ${label} » ?`,
  'storage.confirmButton': 'Supprimer',
  'storage.confirmNothingDeleted':
    'Rien n’est supprimé sur le stockage lui-même : c’est la façon dont cette galerie l’atteint qui disparaît. Un album qui le lit encore doit d’abord être déplacé ou supprimé.',

  /* ----------------------------------------------------- Administration: settings */

  'settings.title': 'Réglages',
  'settings.description': 'À quelle fréquence il synchronise, et combien de disque il occupe.',
  'settings.loading': 'Chargement des réglages',
  'settings.loadFailed': 'Impossible de charger les réglages.',
  'settings.interval': 'Intervalle de synchronisation (minutes)',
  'settings.intervalHint':
    '0 désactive la synchronisation automatique ; la resynchronisation manuelle reste disponible.',
  'settings.cache': 'Taille maximale du cache (Go)',
  'settings.cacheHint':
    'Vignettes et rendus. Au-delà, les entrées les plus anciennes sont évincées.',
  'settings.videoCache': 'Taille maximale des vidéos préparées (Go)',
  'settings.videoCacheHint':
    'Un budget à part, distinct des vignettes : une vidéo coûte des minutes de processeur, une vignette quelques secondes. Compter environ 95 Mo par minute de vidéo en 1080p.',
  'settings.moderationEmail': 'Adresse prévenue des nouveaux commentaires',
  'settings.moderationEmailHint':
    'Reçoit un email à chaque commentaire publié. Vide : aucune alerte de modération.',
  'settings.moderationEmailNoMail':
    'Aucun serveur SMTP configuré : renseignée, cette adresse ne recevra rien — et personne ne peut commenter tant que les codes de vérification ne peuvent pas être envoyés.',
  'settings.onStartup': 'Synchroniser au démarrage du serveur',
  'settings.onStartupHint':
    'Utile après un redémarrage ; à éviter si le démarrage doit être immédiat.',
  'settings.prewarm': 'Préparer les photos à l’avance',
  'settings.prewarmHint':
    'Effectue le rendu des photos en arrière-plan, une à une, de la plus récente à la plus ancienne : la première ouverture passe de quelques secondes à instantanée. À décocher si la bande passante du serveur est facturée.',
  'settings.transcode': 'Préparer les vidéos que le navigateur ne sait pas lire',
  'settings.transcodeHint':
    'Convertit les vidéos HEVC en arrière-plan, une à une et en basse priorité : compter environ une minute de processeur par minute de vidéo. Sans cela, elles restent seulement téléchargeables.',
  'settings.saved': 'Réglages enregistrés.',

  /* ------------------------------------------------ Administration : identité */

  'brand.title': 'Identité',
  'brand.description':
    'Ce qu’un visiteur voit avant tout le reste : le nom, la couleur et la marque.',
  'brand.name': 'Nom de la galerie',
  'brand.nameHint':
    'Dans l’onglet du navigateur, sur l’écran de connexion et sous l’icône une fois installée. Court de préférence : un téléphone tronque au-delà d’une douzaine de caractères.',
  'brand.color': 'Couleur principale',
  'brand.colorHint':
    'Les boutons, la rubrique choisie, le contour de focus et le point de la marque. Tout le reste en découle.',
  'brand.preview': 'Aperçu',
  'brand.previewHover': 'Une ligne survolée',
  'brand.logo': 'Logo',
  'brand.logoHint':
    'PNG, JPEG, WebP ou SVG, jusqu’à 512 ko. Il est converti en PNG à l’arrivée, puis remplace la marque partout : icône d’onglet, écran de connexion, barre du haut, écran d’accueil et courriels.',
  'brand.logoChoose': 'Choisir une image',
  'brand.logoReplace': 'Remplacer',
  'brand.logoReset': 'Revenir à la marque d’origine',
  'brand.logoCustom': 'Cette galerie utilise son propre logo.',
  'brand.logoBuiltIn': 'Cette galerie utilise la marque d’origine, avec la couleur ci-dessus.',
  'brand.logoTooLarge': (kb: number) =>
    `Cette image dépasse ${kb} ko. La réduire avant de l’envoyer.`,
  'brand.logoSaved': 'Logo remplacé.',
  'brand.logoRemoved': 'Retour à la marque d’origine.',
  'brand.saved': 'Identité enregistrée.',

  /* -------------------------------------------------- Administration: maintenance */

  'maintenance.title': 'Maintenance',
  'maintenance.cache': (used: string, max: string) => `Cache : ${used} sur ${max}`,
  'maintenance.entries': (count: number) => `${count.toLocaleString('fr-FR')} vignettes générées`,
  'maintenance.clear': 'Vider le cache',
  'maintenance.cleared': 'Cache vidé. Les vignettes seront régénérées à la demande.',
  'maintenance.clearFailed': 'Impossible de vider le cache.',

  /* ----------------------------------------------------- What runs this gallery */

  'version.title': 'Version',
  'version.poweredBy': (version: string) => `Propulsé par Lukarn ${version}`,
  'version.changelog': 'Journal des modifications',
  'version.update': (version: string) => `Passer en ${version}`,

  /* ------------------------------------------------------ Administration: visits */

  'visits.title': 'Visites',
  'visits.loading': 'Chargement des visites',
  'visits.loadFailed': 'Impossible de charger les visites.',
  'visits.window': 'Fenêtre de mesure',
  'visits.days': (days: number) => `${days} j`,
  'visits.lastDays': (days: number) => `Les ${days} derniers jours`,
  'visits.who': 'Qui',
  'visits.whoDescription': (since: string) => `Les identifiants vus depuis le ${since}.`,
  'visits.nobody': 'Personne ne s’est connecté sur cette période.',
  'visits.whichAlbums': 'Quels albums',
  'visits.whichAlbumsDescription':
    'Un visiteur est une session : deux navigateurs derrière le même identifiant en font deux.',
  'visits.noAlbum': 'Aucun album n’a été ouvert sur cette période.',
  'visits.never': 'jamais',
  'visits.deleted': 'supprimé',
  'visits.administrator': 'administrateur',
  'visits.mobile': 'mobile',
  'visits.tablet': 'tablette',
  'visits.computer': 'ordinateur',
  'visits.television': 'télévision',
  'visits.unitDays': (count: number) => (count > 1 ? 'jours' : 'jour'),
  'visits.unitDevices': (count: number) => (count > 1 ? 'appareils' : 'appareil'),
  'visits.unitAlbums': (count: number) => (count > 1 ? 'albums' : 'album'),
  'visits.unitVisits': (count: number) => (count > 1 ? 'visites' : 'visite'),
  'visits.unitPhotos': (count: number) => (count > 1 ? 'photos' : 'photo'),
  'visits.unitVisitors': (count: number) => (count > 1 ? 'visiteurs' : 'visiteur'),
  'visits.unitKeys': (count: number) => (count > 1 ? 'identifiants' : 'identifiant'),

  /* ---------------------------------------------------------- Confirmation */

  'confirm.deleting': 'Suppression…',

  /* ------------------------------------------------------ Browser diagnostics */

  'diagnostic.title': 'Diagnostic du navigateur',
  'diagnostic.unknown': 'inconnue',
  'diagnostic.yes': 'OUI',
  'diagnostic.no': 'NON',
  'diagnostic.viewport': 'Viewport CSS',
  'diagnostic.screen': 'Écran',
  'diagnostic.insets': 'Encoches h/d/b/g',
  'diagnostic.finePointer': 'Pointeur fin',
  'diagnostic.hover': 'Survol disponible',
  'diagnostic.answerYes': 'oui',
  'diagnostic.answerNo': 'non',
  'diagnostic.layer': '@layer — plus nécessaire, aplati à la compilation',
  'diagnostic.measured': (property: string) => `${property} appliqué (mesuré)`,
};
