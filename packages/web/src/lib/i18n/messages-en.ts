/**
 * English interface catalogue — **the source of the keys**.
 *
 * `messages-fr.ts` is typed against this object: a key missing there, or one
 * whose parameters differ, fails `pnpm typecheck`. Add a message here first.
 *
 * A message is a sentence, or a function of what varies within it. Never
 * assemble one from fragments at the call site: "3" + "items" cannot be
 * translated into a language that agrees the noun differently, and the fragments
 * arrive in the catalogue without the sentence that explains them.
 *
 * Deliberately **not** `as const`: the type of this object is the contract the
 * French catalogue must satisfy, and literal types would require it to repeat
 * the English sentences word for word.
 */
export const en = {
  /* ------------------------------------------------------------- Everywhere */

  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.saving': 'Saving…',
  'common.sending': 'Sending…',
  'common.close': 'Close',
  'common.loading': 'Loading…',
  'common.loadingLabel': 'Loading',
  'common.saveFailed': 'Saving failed.',
  'common.tryAgain': 'Try again',
  'common.hide': 'hide',
  'common.menu': 'Menu',

  /* ------------------------------------------------------- Dates and units */

  // Byte symbol. Multiples are built from it — kB, MB — because the prefix is
  // the same everywhere and only the unit changes language.
  'unit.byte': 'B',
  'compass.north': 'N',
  'compass.south': 'S',
  'compass.east': 'E',
  'compass.west': 'W',

  'relative.justNow': 'just now',
  'relative.minutes': (minutes: number) => `${minutes} min ago`,
  'relative.hours': (hours: number) => `${hours} h ago`,
  'relative.yesterday': 'yesterday',
  'relative.days': (days: number) => `${days} days ago`,

  // Relative markers for the two most recent days: read at a glance, where a
  // full date has to be deciphered among twenty similar headings.
  'day.today': 'Today',
  'day.yesterday': 'Yesterday',

  /* ------------------------------------------------------------- Top bar */

  'topbar.back': 'Back to the albums',
  'topbar.home': 'The album list',
  'topbar.admin': 'Administration',
  'topbar.signOut': 'Sign out',
  'topbar.install': 'Install',
  'topbar.view': 'View',
  'topbar.account': 'Account',
  'topbar.activity': 'Recent activity',
  'topbar.activityUnread': (unread: number) =>
    `Recent activity: ${unread} unread message${unread > 1 ? 's' : ''}`,
  // The state and the effect of a click, joined for a tooltip: an icon alone
  // says neither.
  'topbar.actionTooltip': (state: string, action: string) => `${state} — ${action}`,
  'topbar.actionLabel': (state: string, action: string) => `${state}. ${action}.`,

  /* ------------------------------------------------------ Bottom tabs (phone) */

  // Deliberately shorter than the same things named in the bar: "Recent
  // activity" under an icon would wrap onto three lines in a quarter of a
  // 390 px screen. The accessible name keeps the long form, badge included.
  'tabs.label': 'Main sections',
  'tabs.albums': 'Albums',
  'tabs.search': 'Search',
  'tabs.activity': 'Activity',
  'tabs.account': 'Account',

  /* ------------------------------------------- The reader's own settings */

  // `prefs.` rather than `settings.`, which already names the server settings in
  // administration: these are the reader's, remembered by their browser, and the
  // two catalogues would otherwise collide on the shorter key.
  'prefs.title': 'Settings',
  'prefs.section': 'Preferences',
  'prefs.scope': 'Remembered by this browser, not by the account.',
  'prefs.language': 'Language',
  'prefs.theme': 'Theme',
  'prefs.themeDark': 'Dark',
  'prefs.themeLight': 'Light',
  // Shown only while nothing has been chosen — afterwards it would describe a
  // rule that no longer applies to this browser.
  'prefs.themeHint': 'Following your device until you choose here.',

  /* ------------------------------------------------------------ Sheets */

  'sheet.expand': 'Expand',
  'sheet.collapse': 'Collapse',

  /* --------------------------------------------------------------- Search */

  'search.label': 'Search',
  'search.placeholder': 'Search…',
  'search.results': 'Search results',
  'search.albums': 'Albums',
  'search.days': 'Days and places',
  'search.photos': 'Photos',
  'search.searching': 'Searching…',
  'search.empty': 'No result',

  /* ------------------------------------------------------------- Shortcuts */

  'shortcuts.title': 'Keyboard shortcuts',
  'shortcuts.albums': 'Albums',
  'shortcuts.grid': 'Grid',
  'shortcuts.viewer': 'Viewer',
  'shortcuts.search': 'Search an album, a place, a photo',
  'shortcuts.walk': 'Walk through the suggestions',
  'shortcuts.openSuggestion': 'Open the suggestion',
  'shortcuts.escapeSearch': 'Close the list, then clear the field',
  'shortcuts.move': 'Move between photos',
  'shortcuts.openFullscreen': 'Open fullscreen',
  'shortcuts.firstLast': 'First / last photo',
  'shortcuts.backToAlbums': 'Back to the albums',
  'shortcuts.prevNext': 'Previous / next photo',
  'shortcuts.escapeViewer': 'Leave the zoom, then close',
  'shortcuts.fullscreen': 'Fullscreen',
  'shortcuts.info': 'Information and EXIF',
  'shortcuts.comments': 'Comments',
  'shortcuts.download': 'Download the original',
  'shortcuts.zoom': 'Zoom to 100%',
  'shortcuts.caption': 'Hide / show the caption',
  'shortcuts.chrome': 'Hide the chrome, nothing but the photo',
  // Gestures, not keystrokes: these two are words, so they are translated.
  'shortcuts.wheelTrigger': 'Wheel',
  'shortcuts.dragTrigger': 'Drag',
  'shortcuts.wheel': 'Zoom in or out',
  'shortcuts.drag': 'Move inside the image, or inside the locator at bottom right',
  'shortcuts.play': 'Play / pause video',

  /* ---------------------------------------------------------- Installation */

  'install.title': 'Add to home screen',
  'install.share': 'Share',
  'install.shareHint': 'The square with an arrow, at the bottom of the screen on iPhone.',
  'install.addToHome': 'Add to Home Screen',
  'install.addToHomeHint': 'A little further down the list.',
  'install.add': 'Add',
  'install.addHint': 'Top right. You will be asked to sign in once more, only once.',

  /* -------------------------------------------------------------- Sign-in */

  'login.subtitle': 'Sign in to reach the albums.',
  'login.username': 'Username',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'login.submitting': 'Signing in…',
  'login.failed': 'Cannot sign in. Try again.',
  'login.noAccount': 'No account is configured yet.',
  'login.createAdmin': 'Create the first administrator on the server:',
  'login.createAdminFromSource': 'Or, running from a source checkout:',
  'login.withPhone': 'Sign in with a phone',

  'password.show': 'Show the password',
  'password.hide': 'Hide the password',

  /* ------------------------------------------------------- Screen pairing */

  'device.title': 'Sign in with a phone',
  'device.hint': 'Scan this code with a phone that is already signed in, then approve this screen.',
  'device.qr': (url: string) => `QR code to ${url}`,
  // Split around the address, which is displayed in another colour: it is the
  // part to be typed, and only it.
  'device.orGoTo': 'Or go to',
  'device.andEnter': 'and enter',
  'device.expired': 'This code has expired.',
  'device.newCode': 'Show a new code',
  'device.waiting': 'Waiting for authorisation…',
  'device.usePassword': 'Use a username and password',

  'pair.expiredTitle': 'That code is no longer valid',
  'pair.expiredBody':
    'A request expires after five minutes. Start the sign-in again from the screen, then scan the new code.',
  'pair.enterAnother': 'Enter another code',
  'pair.doneTitle': 'All set',
  'pair.doneBody': 'The screen opens in a few seconds, with the albums of',
  'pair.doneAccount': 'your account',
  'pair.backToAlbums': 'Back to the albums',
  'pair.alreadyTitle': 'This screen has already been paired',
  'pair.alreadyBody':
    'An account has already approved this request. If that was not you, start the sign-in again from the screen to get a new code.',
  'pair.approveTitle': 'Approve this screen?',
  'pair.approveCheck': 'Check that this code is the one shown on the screen you want to pair.',
  'pair.approveWarning':
    "The screen will reach the same albums as you, for as long as nobody changes the password of this account. It won't be able to sign comments in your name.",
  'pair.approve': 'Approve',
  'pair.approving': 'Approving…',
  'pair.formTitle': 'Pair a screen',
  'pair.formHint': 'Enter the code shown on the screen you want to pair.',
  'pair.continue': 'Continue',

  /* ---------------------------------------------------------- Album list */

  'albums.loading': 'Loading albums',
  'albums.loadFailed': 'Cannot load the albums.',
  'albums.none': 'No album is assigned to you.',
  'albums.noneAdmin': 'Create an album from /admin, then assign it to an account.',
  'albums.noneVisitor': 'Ask the administrator of this instance to assign you one.',
  'albums.neverSynced': 'Not synced yet',
  'albums.empty': 'Empty album',
  'albums.itemCount': (count: number) =>
    `${count.toLocaleString('en-GB')} item${count > 1 ? 's' : ''}`,

  /* --------------------------------------------------------------- Album */

  'album.title': 'Album',
  'album.loadingPhotos': 'Loading photos',
  'album.loadFailed': 'Cannot load this album.',
  'album.empty': 'This album has no photos yet.',
  'album.emptyNeverSynced': 'Start a sync from the administration page.',
  'album.emptyCheckFolder': 'Check the Drive folder it points at.',
  'album.newestFirst': 'Newest first',
  'album.oldestFirst': 'Oldest first',
  'album.showNewestFirst': 'Show newest first',
  'album.showOldestFirst': 'Show oldest first',
  'album.byMonth': 'By month',
  'album.byDay': 'By day',
  'album.groupByDay': 'Group by day',
  'album.groupByMonth': 'Group by month',
  'album.describe': '+ Describe this album',
  'album.editDescription': 'Edit the album description',
  'album.descriptionPlaceholder': 'What this album contains',
  'album.descriptionLabel': 'Album description',

  /* ------------------------------------------------------ Grid and sections */

  'section.expand': 'Expand',
  'section.collapse': 'Collapse',
  'section.unit': (count: number): string => (count > 1 ? 'items' : 'item'),
  'section.label': (label: string, count: number) =>
    `${label}, ${count} item${count > 1 ? 's' : ''}`,
  'section.editNote': 'Edit the note',
  'section.annotate': 'Annotate this day',
  // No article before the label: `dayLabel` may return "Today", which cannot be
  // introduced by one.
  'section.annotateDay': (label: string) => `Annotate ${label}`,
  'section.place': 'Place',
  'section.placePlaceholder': 'Place (optional)',
  'section.notePlaceholder': 'What happened that day',
  'section.noteLabel': 'Note for the day',

  'thumb.unavailable': 'Preview unavailable',

  /* -------------------------------------------------------------- Viewer */

  'viewer.close': 'Close (Esc)',
  'viewer.progress': 'Progress through the album',
  'viewer.actions': 'Photo actions',
  'viewer.information': 'Information',
  'viewer.zoomIn': 'Zoom in',
  'viewer.zoomOut': 'Back to screen size',
  'viewer.download': 'Download the original',
  'viewer.fullscreen': 'Fullscreen',
  'viewer.hideChrome': 'Hide the chrome',
  'viewer.showChrome': 'Show the chrome (h)',
  'viewer.cover': 'Album cover',
  'viewer.setCover': 'Set as cover',
  'viewer.coverFailed': 'The cover could not be saved.',
  'viewer.previous': 'Previous (←)',
  'viewer.next': 'Next (→)',
  'viewer.shortcut': (label: string, shortcut: string) => `${label} (${shortcut})`,
  'viewer.comments': 'Comments (c)',
  'viewer.commentsCount': (total: number) => `Comments: ${total} (c)`,
  'viewer.commentsUnread': (total: number, unread: number) =>
    `Comments: ${total}, ${unread} unread (c)`,
  'viewer.videoFailed': 'This video could not be played.',
  'viewer.videoTranscoding':
    'This browser does not decode its format. A playable version is being prepared on the server: it will start here as soon as it is ready. The original file stays downloadable.',
  'viewer.videoUnsupported':
    'Its format may not be playable by this browser. The original file stays downloadable.',
  'viewer.downloadShort': 'Download',

  'zoom.loadingPhoto': 'Loading the photo',
  'zoom.limited': (available: number, natural: number) =>
    `rendered ${available} px of ${natural} px`,
  'zoom.loadingHd': 'loading HD…',
  'zoom.failed': 'This image could not be displayed.',
  'zoom.locator': 'Position locator: click or drag to move inside the photo',

  /* -------------------------------------------------------------- Caption */

  'caption.thatDay': 'That day',
  'caption.show': 'Show the caption (l)',
  'caption.hide': 'Hide the caption (l)',
  'caption.expand': 'Expand the caption',
  'caption.collapse': 'Collapse the caption',
  'caption.describe': '+ Describe this photo',
  'caption.edit': 'Edit this photo description',
  'caption.placeholder': "What's happening in this photo",
  'caption.label': 'Photo description',

  /* ---------------------------------------------------------- Side panel */

  'panel.label': 'Information and comments',
  'panel.close': 'Close the panel (Esc)',
  'panel.sections': 'Panel sections',
  'panel.info': 'Info',
  'panel.comments': 'Comments',

  /* ------------------------------------------------------------ EXIF rows */

  'exif.place': 'Place',
  'exif.thatDay': 'That day',
  'exif.taken': 'Taken',
  'exif.modified': 'Modified',
  'exif.dimensions': 'Dimensions',
  'exif.size': 'Size',
  'exif.duration': 'Duration',
  'exif.camera': 'Camera',
  'exif.lens': 'Lens',
  'exif.focalLength': 'Focal length',
  'exif.aperture': 'Aperture',
  'exif.shutter': 'Shutter',
  'exif.iso': 'ISO',
  'exif.position': 'Position',
  'exif.noPosition': 'No GPS data',

  /* ------------------------------------------------------------- Comments */

  'comments.loading': 'Loading comments',
  'comments.loadFailed': 'Comments could not be loaded.',
  'comments.empty': 'No comments. Be the first to write one.',
  'comments.placeholder': (name: string) => `Comment as ${name}…`,
  'comments.signedAs': 'Signed',
  'comments.changeAddress': 'Change address',
  'comments.disabled': 'Comments are unavailable: this gallery has no mail server configured.',
  'comments.signIn': 'Sign in to comment',
  'comments.reply': 'Reply',
  'comments.replyPlaceholder': (name: string) => `Reply to ${name}…`,
  'comments.edit': (seconds: number) => `Edit (${seconds} s)`,
  'comments.editHint': 'Fix a typo, within thirty seconds of posting',
  'comments.editFailed': 'The correction could not be saved.',
  'comments.delete': 'Delete',
  'comments.post': 'Post',
  'comments.postFailed': 'The comment could not be posted.',
  'comments.emoji': 'Add an emoji',
  'comments.emojiHint': 'Add an emoji — ":)" becomes 🙂',
  'comments.emojiGroup': 'Emoji',
  'comments.inReply': 'in reply',

  /* ------------------------------------------------------- Activity drawer */

  'feed.title': 'Recent activity',
  'feed.subtitle': 'The latest messages, across all photos.',
  'feed.close': 'Close activity (Esc)',
  'feed.everyAlbum': 'Every album',
  'feed.thisAlbum': 'This album',
  'feed.loading': 'Loading activity',
  'feed.loadFailed': 'Activity could not be loaded.',
  'feed.empty': 'No comments yet. Open a photo to write the first one.',
  'feed.older': 'Older messages',
  'feed.view': (photo: string, album: string) => `View ${photo} in ${album}`,
  'feed.removedPhoto': 'photo removed from the index',

  /* ------------------------------------------------------------- Identity */

  'identity.intro':
    'To comment, tell us who you are. Your address signs your messages, tells you about replies, and announces new photos in the albums you open; it is never shown to anyone else. Every email carries a link to stop them.',
  'identity.namePlaceholder': 'Your name, as it will appear',
  'identity.nameLabel': 'Display name',
  'identity.emailLabel': 'Email address',
  'identity.sendFailed': 'The code could not be sent.',
  'identity.getCode': 'Get a code',
  'identity.codeSent': (length: number) => `A ${length}-digit code has just been sent to`,
  'identity.codeLabel': 'Verification code',
  'identity.checkFailed': 'The code could not be checked.',
  'identity.fixAddress': 'Change the address',
  'identity.checking': 'Checking…',
  'identity.confirm': 'Confirm',

  /* --------------------------------------------------------- Administration */

  'admin.title': 'Administration',
  'admin.sections': 'Administration sections',
  'admin.notSet': 'Not set',
  'admin.groupLibrary': 'Library',
  'admin.groupPeople': 'People',
  'admin.groupInstance': 'This instance',
  'admin.tabAlbums': 'Albums',
  'admin.tabAccounts': 'Accounts',
  'admin.tabComments': 'Comments',
  'admin.tabIdentity': 'Identity',
  'admin.tabServer': 'Server',
  'admin.tabVisits': 'Visits',
  'admin.statusFailed': 'Cannot load the server state.',
  'admin.oauthConnected': 'Google Drive is connected. The first sync has started.',
  'admin.oauthDenied': 'Authorisation refused on the Google side.',
  'admin.oauthInvalid': 'Incomplete response from Google. Start the connection again.',
  'admin.oauthStateMismatch':
    'The anti-CSRF token does not match. Start the connection again from this page.',
  'admin.oauthError': 'The connection failed. Check the server logs.',

  /* ------------------------------------------------------- Administration: albums */

  'adminAlbums.title': 'Albums',
  'adminAlbums.description':
    'One album = one indexed Google Drive folder. Its cover is chosen on the photo, from the album.',
  'adminAlbums.resyncAll': 'Resync everything',
  'adminAlbums.noStorage': 'No storage connected.',
  'adminAlbums.new': 'New album',
  'adminAlbums.none': 'No album. Create one from a folder of your Drive.',
  'adminAlbums.syncStarted': (albums: string) => `Sync started: ${albums}`,
  'adminAlbums.nothingToSync': 'No album to sync.',
  'adminAlbums.syncFailed': 'Cannot sync.',
  'adminAlbums.coverCleared': (title: string) =>
    `Album "${title}" takes its most recent photo as cover again.`,
  'adminAlbums.updateFailed': 'Cannot update.',
  'adminAlbums.deleted': (title: string) => `Album "${title}" deleted.`,
  'adminAlbums.deleteFailed': 'Cannot delete.',
  'adminAlbums.itemCount': (count: number) => `${count.toLocaleString('en-GB')} items`,
  'adminAlbums.recursive': 'subfolders included',
  'adminAlbums.syncedAgo': (relative: string) => `synced ${relative}`,
  'adminAlbums.assignedTo': (accounts: string) => `Assigned to ${accounts}`,
  'adminAlbums.assignedToNobody': 'Assigned to no account by name',
  'adminAlbums.statusNever': 'never synced',
  'adminAlbums.statusRunning': 'sync in progress',
  'adminAlbums.statusOk': 'up to date',
  'adminAlbums.statusError': 'failed',
  'adminAlbums.resync': 'Resync',
  'adminAlbums.resyncAlbum': (title: string) => `Resync album ${title}`,
  'adminAlbums.automaticCover': 'Automatic cover',
  'adminAlbums.automaticCoverHint':
    'A photo was chosen as cover. Give the album its most recent photo back.',
  'adminAlbums.automaticCoverLabel': (title: string) =>
    `Make the cover of album ${title} automatic again`,
  'adminAlbums.edit': 'Edit',
  'adminAlbums.editAlbum': (title: string) => `Edit album ${title}`,
  'adminAlbums.delete': 'Delete',
  'adminAlbums.deleteAlbum': (title: string) => `Delete album ${title}`,
  'adminAlbums.confirmTitle': (title: string) => `Delete album "${title}"?`,
  'adminAlbums.confirmButton': 'Delete the album',
  'adminAlbums.confirmMedia': (count: number) =>
    `The ${count.toLocaleString('en-GB')} indexed media are removed from the viewer, and the album disappears for the accounts that could reach it.`,
  'adminAlbums.confirmDrive': 'Nothing is deleted in Google Drive: the files stay in folder',
  'adminAlbums.confirmDriveEnd': '. Recreating the album on the same folder will reindex it.',

  'albumForm.titleField': 'Title',
  'albumForm.id': 'Identifier',
  'albumForm.idFixed': 'The identifier does not change: it is the address of the album.',
  'albumForm.idHint': 'Appears in the URL of the album. Suggested from the title.',
  'albumForm.description': 'Description (optional)',
  'albumForm.folder': 'Google Drive folder',
  'albumForm.container': 'Folder in the storage',
  'albumForm.containerHint': 'Path relative to the root this storage declares.',
  'albumForm.containerPlaceholder': 'holidays/2026',
  'albumForm.storage': 'Storage',
  'albumForm.storageHint': 'Where this album’s files live.',
  'albumForm.storageEditHint':
    'Changing it empties the album index and reindexes it: the same path elsewhere is another set of files.',
  'albumForm.folderExtracted': 'Identifier used:',
  'albumForm.folderHint': 'Paste the folder URL: the identifier is the segment after /folders/.',
  'albumForm.recursive': 'Include subfolders',
  'albumForm.recursiveHint': 'Untick to index only the files sitting directly in the folder.',
  'albumForm.byDay': 'Open the grid grouped by day',
  'albumForm.byDayHint':
    'The right split for a trip. Day notes only show up per day. A visitor can always flip it back.',
  'albumForm.newestFirst': 'Open the album newest first',
  'albumForm.newestFirstHint':
    'Unticked, the album reads in the order it was lived. Tick it for a library fed as things happen. A visitor can flip it back, and their browser remembers.',
  'albumForm.create': 'Create the album',
  'albumForm.created': (title: string) => `Album "${title}" created. Syncing will fill it.`,
  'albumForm.saved': (title: string) => `Album "${title}" saved.`,

  /* ----------------------------------------------------- Administration: accounts */

  'adminUsers.title': 'Accounts',
  'adminUsers.description': 'Who can sign in, and to which albums.',
  'adminUsers.new': 'New account',
  'adminUsers.loading': 'Loading accounts',
  'adminUsers.loadFailed': 'Cannot load the accounts.',
  'adminUsers.none': 'No account. Create one so that someone can sign in.',
  'adminUsers.administrator': 'administrator',
  'adminUsers.you': '(you)',
  'adminUsers.edit': 'Edit',
  'adminUsers.editAccount': (username: string) => `Edit account ${username}`,
  'adminUsers.delete': 'Delete',
  'adminUsers.deleteAccount': (username: string) => `Delete account ${username}`,
  'adminUsers.cannotDeleteSelf': "You can't delete your own account.",
  'adminUsers.deleted': (username: string) => `Account "${username}" deleted.`,
  'adminUsers.deleteFailed': 'Cannot delete.',
  'adminUsers.confirmTitle': (username: string) => `Delete account "${username}"?`,
  'adminUsers.confirmButton': (username: string) => `Delete ${username}`,
  'adminUsers.confirmSignIn': 'This account will no longer be able to sign in.',
  'adminUsers.confirmMedia': 'The albums and the indexed media are untouched.',

  'userForm.username': 'Username',
  'userForm.usernameFixed':
    'The username does not change; delete and recreate the account if needed.',
  'userForm.usernameHint': 'Letters, digits, dot, dash or underscore.',
  'userForm.password': 'Password',
  'userForm.newPassword': 'New password',
  'userForm.passwordKeep': 'Leave empty to keep the current password.',
  'userForm.passwordHint': (min: number) => `${min} characters minimum.`,
  'userForm.admin': 'Administrator role',
  'userForm.adminSelf': 'You cannot remove your own role: this page needs an administrator.',
  'userForm.adminHint': 'Grants access to this page. Album access stays the one chosen below.',
  'userForm.create': 'Create the account',
  'userForm.created': (username: string) => `Account "${username}" created.`,
  'userForm.saved': (username: string) => `Account "${username}" saved.`,

  'access.legend': 'Accessible albums',
  'access.every': 'Every album',
  'access.everyHint': 'Including those created later. Stored as the wildcard',
  'access.selection': 'A selection of albums',
  'access.selectionHint':
    'Only the albums ticked. An album created later has to be assigned by hand.',
  'access.noAlbum': 'No album exists yet. Create one in the Albums section, or grant the wildcard.',
  'access.albumDetail': (id: string, count: number) =>
    `${id} · ${count.toLocaleString('en-GB')} items`,
  'access.orphan': 'unknown album — untick to remove it',
  'access.allTicked':
    'Every current album is ticked, which is not the same as "Every album": the next ones will not be assigned automatically.',
  'access.everyPresentAndFuture': 'Every album, present and future',
  'access.none': 'No album',
  'access.andOthers': (named: string, rest: number) =>
    `${named} and ${rest} other${rest > 1 ? 's' : ''}`,

  /* -------------------------------------------------- Administration: form errors */

  'validate.username': 'Enter a username.',
  'validate.usernameLength': (max: number) => `A username cannot be longer than ${max} characters.`,
  'validate.identifierPattern':
    'Letters, digits, dot, dash or underscore, starting with a letter or a digit.',
  'validate.albumId': 'Enter an identifier.',
  'validate.password': 'Enter a password.',
  'validate.passwordLength': (min: number) => `A password must be at least ${min} characters.`,
  'validate.title': 'Enter a title.',
  'validate.folder': 'Enter the Drive folder.',
  'validate.folderPattern':
    'Paste the Drive folder URL or its identifier — the segment after /folders/.',
  'validate.container': 'Enter the folder to read.',
  'validate.containerPattern': 'A path relative to the storage root, without a parent segment.',
  'validate.storageLabel': 'Give this storage a name.',
  'validate.storagePath': 'A folder inside the root, without a parent segment.',
  'validate.storageEndpoint': 'Enter the address of the service, starting with https://.',
  'validate.storageBucket': 'Enter the name of the bucket.',
  'validate.storageAccessKey': 'Enter the access key.',
  'validate.storageSecretKey': 'Enter the secret key.',
  'validate.storageUrl': 'Enter the WebDAV address, starting with https://.',
  'validate.storageUsername': 'Enter the username this instance connects with.',
  'validate.storagePassword': 'Enter the app password.',
  'validate.interval': 'Give a whole number of minutes (0 to disable).',
  'validate.cacheSize': 'Give a size in gigabytes.',
  'validate.cacheSizePositive': 'The cache size must be greater than 0.',
  'validate.instanceName': 'Enter a name for this gallery.',
  'validate.instanceNameLength': (max: number) => `A name cannot be longer than ${max} characters.`,
  'validate.color': 'Give a colour written as #rrggbb.',

  /* ---------------------------------------------------- Administration: moderation */

  'moderation.title': 'Comments',
  'moderation.description':
    'Hidden comments disappear from the gallery for everyone, their author included.',
  'moderation.all': 'All',
  'moderation.visible': 'Visible',
  'moderation.hidden': 'Hidden',
  'moderation.searchPlaceholder': 'Search a word, a name, an address',
  'moderation.searchLabel': 'Search the comments',
  'moderation.filterByAlbum': 'Filter by album',
  'moderation.everyAlbum': 'Every album',
  'moderation.loading': 'Loading comments',
  'moderation.loadFailed': 'Comments could not be loaded.',
  'moderation.noMatch': (query: string) => `No comment matches "${query}".`,
  'moderation.noneInAlbum': 'No comments in this album.',
  'moderation.noneHidden': 'No hidden comment.',
  'moderation.noneVisible': 'No visible comments.',
  'moderation.none': 'No comment yet.',
  'moderation.previous': '‹ Previous',
  'moderation.next': 'Next ›',
  'moderation.range': (first: number, last: number, total: number) =>
    `${first}–${last} of ${total}`,
  'moderation.removedPhoto': 'photo removed from the index',
  'moderation.moderateAll': (email: string) => `Moderate every message from ${email}`,
  'moderation.inReply': 'in reply',
  'moderation.via': (account: string) => `via ${account}`,
  'moderation.hiddenBadge': 'hidden',
  'moderation.hiddenBy': (username: string) => `hidden by ${username}`,
  'moderation.hide': 'Hide',
  'moderation.makeVisible': 'Make visible',
  'moderation.hiddenNotice': 'Comment hidden.',
  'moderation.visibleNotice': 'Comment made visible again.',
  'moderation.failed': 'Moderation failed.',
  'moderation.bulkRestoreTitle': (email: string) =>
    `Make every message from ${email} visible again?`,
  'moderation.bulkHideTitle': (email: string) => `Hide every message from ${email}?`,
  'moderation.bulkRestoreButton': 'Restore all',
  'moderation.bulkHideButton': 'Hide all',
  'moderation.bulkScope': 'This acts on',
  'moderation.bulkScopeStrong': 'every album',
  'moderation.bulkScopeEnd': ', not only on this one and not only on the page shown.',
  'moderation.bulkRestoreHint': 'Their messages become readable by everyone again.',
  'moderation.bulkHideHint': 'Reversible: the "Hidden" tab restores everything in one go.',
  'moderation.bulkDone': (count: number, restored: boolean) =>
    `${count} message${count > 1 ? 's' : ''} ${restored ? 'restored' : 'hidden'}.`,
  'moderation.bulkFailed': 'Bulk moderation failed.',

  /* ------------------------------------------------------ Administration: storage */

  'storage.title': 'Storage',
  'storage.description': 'Where the albums live. An instance can read several.',
  'storage.loadFailed': 'Cannot load the storage connections.',
  'storage.add': 'Add a storage',
  'storage.create': 'Add',
  'storage.created': (label: string) => `Storage "${label}" added.`,
  'storage.label': 'Name',
  'storage.identifier': 'Identifier',
  'storage.identifierHint': 'Written into every album that reads this storage. It cannot change.',
  'storage.kind': 'Kind',
  'storage.kindHint': 'What this connection speaks to. It cannot change afterwards.',
  'storage.path': 'Folder',
  'storage.pathHint':
    'A folder inside the one this server was given, named relative to it. Leave empty to ' +
    'read all of it. Set STORAGE_LOCAL_ROOT to choose which folder that is.',
  'storage.kindDrive': 'Google Drive',
  'storage.kindLocal': 'Local folder',
  'storage.kindS3': 'S3-compatible bucket',
  'storage.kindWebdav': 'WebDAV server',
  'storage.endpoint': 'Endpoint',
  'storage.endpointHint':
    'The address of the service, not of the bucket: https://s3.eu-west-3.amazonaws.com, or the address of your own server.',
  'storage.region': 'Region',
  'storage.regionHint':
    'Amazon requires the bucket’s own region. Anything self-hosted ignores it, but both ends still have to agree — leave it empty for us-east-1.',
  'storage.bucket': 'Bucket',
  'storage.prefix': 'Prefix',
  'storage.prefixHint':
    'Optional. Restricts this connection to one folder of the bucket; every album then names a path inside it.',
  'storage.pathStyle': 'Address the bucket by path',
  'storage.pathStyleHint':
    'Reads bucket.example.com by default. MinIO and any bucket whose name is not a valid domain label need this instead.',
  'storage.accessKeyId': 'Access key',
  'storage.secretAccessKey': 'Secret key',
  'storage.secretAccessKeyHint':
    'Stored encrypted and never shown again. A read-only key is enough: nothing here ever writes to the bucket.',
  'storage.webdavUrl': 'WebDAV address',
  'storage.webdavUrlHint':
    'The endpoint, not the page the files are browsed on. Nextcloud and ownCloud publish theirs as https://cloud.example.com/remote.php/dav/files/<username>.',
  'storage.webdavRoot': 'Folder',
  'storage.webdavRootHint':
    'Optional. A folder under that address, which every album on this storage reads from.',
  'storage.webdavUsername': 'Username',
  'storage.webdavPassword': 'App password',
  'storage.webdavPasswordHint':
    'Create one in the account’s security settings. It grants file access alone, and revoking it costs nothing.',
  'storage.albumCount': (count: number) =>
    count === 0 ? 'No album reads it yet.' : `${count} album${count > 1 ? 's' : ''} read it.`,
  'storage.serviceAccountHint':
    'No consent to give, no token to renew. Every album folder has to be shared read-only with this address from Google Drive — otherwise it stays invisible, and its synchronisation finds nothing.',
  'storage.notConfigured': 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set in the',
  'storage.notConfiguredEnd': 'file.',
  'storage.revoked': 'Authorisation revoked',
  'storage.revokedFor': (account: string) => `for ${account}`,
  'storage.revokedHint':
    'Access was withdrawn on the Google side, or the token expired. The albums stay viewable as long as thumbnails remain cached. Reconnect to resume synchronisation.',
  'storage.connected': 'Connected',
  'storage.notConnected': 'Not connected. Nothing can be indexed or served from it.',
  'storage.connect': 'Connect Google Drive',
  'storage.reconnect': 'Reconnect Google Drive',
  'storage.connectFailed': 'Connection failed.',
  'storage.disconnect': 'Disconnect',
  'storage.disconnected': (label: string) => `“${label}” is disconnected.`,
  'storage.disconnectFailed': 'Cannot disconnect this storage.',
  'storage.test': 'Test',
  'storage.testing': 'Testing…',
  'storage.testOk': (account: string) => `It answers — ${account}.`,
  'storage.testFailed': 'This storage did not answer.',
  'storage.delete': 'Delete',
  'storage.deleteOne': (label: string) => `Delete the storage ${label}`,
  'storage.deleted': (label: string) => `Storage "${label}" deleted.`,
  'storage.deleteFailed': 'Cannot delete this storage.',
  'storage.confirmTitle': (label: string) => `Delete "${label}"?`,
  'storage.confirmButton': 'Delete',
  'storage.confirmNothingDeleted':
    'Nothing is deleted on the storage itself: this removes how this gallery reaches it. An album still reading it has to be moved or deleted first.',

  /* ----------------------------------------------------- Administration: settings */

  'settings.title': 'Settings',
  'settings.description': 'How often it syncs, and how much disk it takes.',
  'settings.loading': 'Loading settings',
  'settings.loadFailed': 'Cannot load the settings.',
  'settings.interval': 'Sync interval (minutes)',
  'settings.intervalHint': '0 disables automatic syncing; a manual resync stays available.',
  'settings.cache': 'Maximum cache size (GB)',
  'settings.cacheHint': 'Thumbnails and renders. Past it, the oldest entries are evicted.',
  'settings.videoCache': 'Maximum size of prepared videos (GB)',
  'settings.videoCacheHint':
    'A budget of its own, separate from thumbnails: a video costs minutes of CPU, a thumbnail a few seconds. Reckon about 95 MB per minute of 1080p footage.',
  'settings.moderationEmail': 'Address told about new comments',
  'settings.moderationEmailHint':
    'Gets an email for every comment posted. Empty: no moderation alert.',
  'settings.moderationEmailNoMail':
    'No SMTP server configured: filled in, it will receive nothing — and nobody can comment for as long as verification codes cannot be sent.',
  'settings.onStartup': 'Sync when the server starts',
  'settings.onStartupHint': 'Useful after a restart; avoid it if startup has to be immediate.',
  'settings.prewarm': 'Prepare photos in advance',
  'settings.prewarmHint':
    'Renders photos in the background, one at a time, newest to oldest: the first opening goes from a few seconds to instant. Untick it if the bandwidth of the server is metered.',
  'settings.transcode': 'Prepare the videos the browser cannot play',
  'settings.transcodeHint':
    'Converts HEVC videos in the background, one at a time and at low priority: reckon about a minute of CPU per minute of footage. Without it, they stay downloadable only.',
  'settings.saved': 'Settings saved.',

  /* ---------------------------------------------------- Administration: identity */

  'brand.title': 'Identity',
  'brand.description':
    'What a visitor sees before anything else: the name, the colour and the mark.',
  'brand.name': 'Gallery name',
  'brand.nameHint':
    'In the browser tab, on the sign-in screen and under the icon once installed. Keep it short: a phone truncates beyond a dozen characters.',
  'brand.color': 'Primary colour',
  'brand.colorHint':
    'Buttons, the selected section, the focus outline and the dot in the mark. Everything else is derived from it.',
  'brand.preview': 'Preview',
  'brand.previewHover': 'A hovered row',
  'brand.logo': 'Logo',
  'brand.logoHint':
    'PNG, JPEG, WebP or SVG, up to 512 kB. It is converted to a PNG on arrival and then stands in for the mark everywhere — tab icon, sign-in screen, top bar, home screen and emails.',
  'brand.logoChoose': 'Choose an image',
  'brand.logoReplace': 'Replace',
  'brand.logoReset': 'Back to the built-in mark',
  'brand.logoCustom': 'This gallery uses a logo of its own.',
  'brand.logoBuiltIn': 'This gallery uses the built-in mark, with the colour above.',
  'brand.logoTooLarge': (kb: number) => `That image is over ${kb} kB. Reduce it before sending it.`,
  'brand.logoSaved': 'Logo replaced.',
  'brand.logoRemoved': 'Back to the built-in mark.',
  'brand.saved': 'Identity saved.',

  /* -------------------------------------------------- Administration: maintenance */

  'maintenance.title': 'Maintenance',
  'maintenance.cache': (used: string, max: string) => `Cache: ${used} of ${max}`,
  'maintenance.entries': (count: number) => `${count.toLocaleString('en-GB')} thumbnails generated`,
  'maintenance.clear': 'Clear cache',
  'maintenance.cleared': 'Cache cleared. Thumbnails will be regenerated on demand.',
  'maintenance.clearFailed': 'Cannot clear cache.',

  /* ----------------------------------------------------- What runs this gallery */

  'version.title': 'Version',
  // The product's name, not the instance's: an album called "Chez nous" is not
  // what powers itself, and the name of the software is what the changelog and
  // the release this line links to are about.
  'version.poweredBy': (version: string) => `Powered by Lukarn ${version}`,
  'version.changelog': 'Changelog',
  // Names the version rather than saying "update available": the number is what
  // tells an operator whether this is the release they already read about.
  'version.update': (version: string) => `Update to ${version}`,

  /* ------------------------------------------------------ Administration: visits */

  'visits.title': 'Visits',
  'visits.loading': 'Loading visits',
  'visits.loadFailed': 'Cannot load the visits.',
  'visits.window': 'Measurement window',
  'visits.days': (days: number) => `${days} d`,
  'visits.lastDays': (days: number) => `The last ${days} days`,
  'visits.who': 'Who',
  'visits.whoDescription': (since: string) => `The access keys seen since ${since}.`,
  'visits.nobody': 'Nobody signed in over this period.',
  'visits.whichAlbums': 'Which albums',
  'visits.whichAlbumsDescription':
    'A visitor is a session: two browsers behind the same key make two.',
  'visits.noAlbum': 'No album was opened over this period.',
  'visits.never': 'never',
  'visits.deleted': 'deleted',
  'visits.administrator': 'administrator',
  'visits.mobile': 'mobile',
  'visits.tablet': 'tablet',
  'visits.computer': 'computer',
  'visits.television': 'television',
  'visits.unitDays': (count: number): string => (count > 1 ? 'days' : 'day'),
  'visits.unitDevices': (count: number): string => (count > 1 ? 'devices' : 'device'),
  'visits.unitAlbums': (count: number): string => (count > 1 ? 'albums' : 'album'),
  'visits.unitVisits': (count: number): string => (count > 1 ? 'visits' : 'visit'),
  'visits.unitPhotos': (count: number): string => (count > 1 ? 'photos' : 'photo'),
  'visits.unitVisitors': (count: number): string => (count > 1 ? 'visitors' : 'visitor'),
  'visits.unitKeys': (count: number): string => (count > 1 ? 'keys' : 'key'),

  /* ---------------------------------------------------------- Confirmation */

  'confirm.deleting': 'Deleting…',

  /* ------------------------------------------------------ Browser diagnostics */

  'diagnostic.title': 'Browser diagnostics',
  'diagnostic.unknown': 'unknown',
  'diagnostic.yes': 'YES',
  'diagnostic.no': 'NO',
  'diagnostic.viewport': 'Viewport CSS',
  'diagnostic.screen': 'Screen',
  'diagnostic.insets': 'Safe-area insets t/r/b/l',
  'diagnostic.finePointer': 'Fine pointer',
  'diagnostic.hover': 'Hover available',
  'diagnostic.answerYes': 'yes',
  'diagnostic.answerNo': 'no',
  'diagnostic.layer': '@layer — no longer required, unwrapped at build time',
  'diagnostic.measured': (property: string) => `${property} applied (measured)`,
};

/**
 * The shape every catalogue must have. Declared beside the English one because
 * this object *is* the contract: `messages-fr.ts` imports the type from here,
 * which keeps the two files free of any dependency on the React layer above them.
 */
export type Messages = typeof en;
