/**
 * English catalogue for everything the server writes to a person: the messages
 * accompanying an HTTP refusal, the emails it sends and the two unsubscribe
 * pages it renders itself.
 *
 * It is the **source of the keys**, exactly as `packages/web` works:
 * `messages-fr.ts` is typed against this object, so a forgotten key fails
 * `pnpm typecheck`.
 *
 * Deliberately not `as const`: the type of this object is the contract the
 * French catalogue must satisfy, and literal types would require it to repeat
 * the English sentences word for word.
 */
export const en = {
  /* --------------------------------------------------------- HTTP refusals */

  'error.authRequired': 'Authentication required',
  'error.adminsOnly': 'Administrators only',
  'error.notSignedIn': 'Not signed in',
  'error.credentialsRequired': 'Username and password required',
  'error.badCredentials': 'Incorrect username or password',
  'error.tooManyAttempts': (seconds: number) => `Too many attempts. Try again in ${seconds} s.`,
  'error.tooManyPairings': 'Too many requests in flight. Try again in a minute.',
  'error.deviceCodeRequired': 'Device code required',
  'error.alreadyPaired': 'This screen has already been paired by another account.',
  'error.unknownCode': 'That code is no longer valid. Start the sign-in again from the screen.',

  'error.albumNotFound': 'Album not found',
  'error.mediaNotFound': 'Media not found',
  'error.commentNotFound': 'Comment not found',
  'error.accountNotFound': 'Account not found',
  'error.identityNotFound': 'Identity not found',
  'error.invalidParameters': 'Invalid parameters',
  'error.invalidUsername': 'Invalid username',
  'error.invalidRequest': 'Invalid request',
  'error.invalidSearch': 'Invalid search',
  'error.validation': (details: string) => `Invalid request — ${details}`,

  'error.incompleteLink': 'Incomplete link',
  'error.invalidLink': 'Invalid link',
  'error.invalidOrExpiredLink': 'Invalid or expired link',

  'error.identityRequired': 'Add and verify your email address in order to comment.',
  'error.commentLength': (max: number) => `A comment must be between 1 and ${max} characters.`,
  'error.unknownParent': 'The comment you are replying to no longer exists.',
  'error.editWindowClosed': 'The window for correcting this comment has closed.',

  'error.mailNotConfigured':
    'This gallery has no mail server configured: comments are unavailable.',
  'error.invalidIdentity': 'Invalid address or name',
  'error.codeJustSent': (seconds: number) =>
    `A code has just been sent. Try again in ${seconds} s.`,
  'error.invalidCode': 'Invalid code — six digits expected.',
  'error.codeAttemptsExhausted': 'Too many attempts. Ask for a new code.',
  'error.codeWrongOrExpired': 'Wrong or expired code. Ask for a new one if needed.',
  'error.invalidEmail': 'Invalid address',
  'error.displayNameRequired':
    'Give the name your comments will be signed with, then send the code again.',
  'error.identityBound':
    'This account is one person, and its address is not this session\u2019s to change. Sign out to use the gallery as somebody else.',

  'error.noIcon': 'No icon of that name',
  'error.logoEmpty': 'No image received.',
  'error.logoUnreadable':
    'That file could not be read as an image. PNG, JPEG, WebP and SVG all work, up to 512 kB.',

  'error.noFullscreenForVideo': 'No fullscreen render for a video',
  'error.noVideoPreview': 'No preview available for this video',
  'error.unsupportedThumbSize': 'Unsupported thumbnail size',
  'error.videoNotReady': 'Playable version not prepared yet',
  'error.emptyFromStorage': 'Empty response from the storage',

  'error.usernameTaken': (username: string) => `The username "${username}" is already taken.`,
  'error.unknownAlbum': (albumId: string) => `Unknown album: "${albumId}"`,
  'error.albumExists': (albumId: string) => `Album "${albumId}" already exists.`,
  'error.lastAdminRole':
    'The last administrator cannot have the role removed: the instance would become unadministrable. Appoint another administrator first.',
  'error.lastAdminDelete':
    'The last administrator cannot be deleted: the instance would become unadministrable.',
  'error.identityTaken': (username: string) =>
    `That address already signs in as "${username}". An address belongs to one account.`,
  'error.accountAlreadyBound': (username: string) =>
    `"${username}" is already one person. Changing the address of a bound account is not offered: unbind it first, which gives it a password again and closes its sessions.`,
  'error.noInvitationPending': (username: string) =>
    `"${username}" has no invitation waiting, so there is nothing to send again. Give the address to invite it at.`,
  'error.passwordOnBoundAccount': (username: string) =>
    `"${username}" is bound to a person and holds no password. Unbind it to give it one, which also closes its sessions.`,
  'error.coverNotInAlbum': 'That cover is not a photo indexed in this album.',
  'error.serviceAccountConsent':
    'This instance authenticates with a service account: there is no consent to give. Share the folder with its address from Google Drive.',
  'error.serviceAccountDisconnect':
    'This instance authenticates with a service account: remove GOOGLE_SERVICE_ACCOUNT_FILE, or the folder share on the Drive side.',
  'error.storageNotConnected': 'Connect a storage before starting a sync.',
  'error.oauthNotConfigured':
    'Google Drive is not configured: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are missing.',
  'error.storageNotFound': 'No storage connection with this identifier.',
  'error.folderRequired':
    'A Google Drive album names the folder it reads. Only a storage addressed by path can be left empty to read all of it.',
  'error.storageExists': (id: string) => `A storage connection named "${id}" already exists.`,
  'error.storageKindUnsupported': (kind: string) =>
    `This version cannot read a storage of kind "${kind}".`,
  'error.storageInUse': (albums: string) =>
    `This storage still holds albums (${albums}). Move or delete them first — they would otherwise point at nothing.`,

  /* ---------------------------------------------------------------- Emails */

  'mail.replySubject': (author: string) => `${author} replied to your comment`,
  'mail.commentSubject': (author: string) => `${author} commented on a photo`,
  'mail.viewPhoto': 'View the photo',
  'mail.unsubscribeAll': 'Stop receiving any email from this gallery',

  'mail.albumSubject': (count: number, album: string) =>
    `${count} new photo${count > 1 ? 's' : ''} in ${album}`,
  'mail.viewAlbum': 'View the album',
  'mail.albumReason': 'You are getting this because you have opened this album.',
  'mail.albumUnsubscribe': (album: string) => `Stop hearing about new photos in "${album}"`,

  'mail.codeSubject': (host: string) => `Verification code — ${host}`,
  'mail.codeHello': (name: string) => `Hello ${name},`,
  'mail.codeIntro': (host: string) =>
    `You have just given this address on ${host} to sign your comments.`,
  'mail.codeHere': 'Here is your code:',
  'mail.codeValidity':
    'Type it into the page you left open. It lasts fifteen minutes and works once.',
  'mail.codeIgnore':
    'If you did not ask for this, ignore the message: until the code is entered, nothing is tied to this address. Do not pass it on to anyone.',

  'mail.signInSubject': (host: string) => `Sign-in code \u2014 ${host}`,
  'mail.signInIntro': (host: string) =>
    `This code signs in to ${host} as the person this address belongs to.`,
  'mail.signInHere': 'Here is your code:',
  'mail.signInValidity':
    'Type it into the page you left open. It lasts fifteen minutes and works once.',
  'mail.signInIgnore':
    'If you did not ask to sign in, ignore the message: the code opens nothing until it is entered. Do not pass it on to anyone \u2014 whoever types it signs in as you.',

  'mail.inviteSubject': (host: string) => `An account for you on ${host}`,
  // The first line says what the code grants, which is the only defence against the
  // attack that remains: somebody talking its holder into reading it out.
  'mail.inviteIntro': (host: string) =>
    `An account has been opened for you on ${host}. The code in this message is what opens it, and this address becomes the name your comments are signed with.`,
  // The page before the code. Six digits handed over before anywhere to type them
  // leaves the reader holding a number and a question.
  'mail.inviteOpen': 'Open this page, which already knows the address:',
  'mail.inviteThen': 'Then enter this code:',
  'mail.inviteValidity':
    'It lasts seven days and works once. Ask for another from that page if it runs out.',
  'mail.inviteIgnore':
    'If this was not expected, ignore the message: no account is opened until the code is entered. Do not pass it on to anyone \u2014 whoever types it signs in as you.',

  /* ---------------------------------------------------- Unsubscribe pages */

  'page.unsubscribedTitle': 'Unsubscribed',
  'page.done': 'Done',
  'page.backToGallery': 'Back to the gallery',
  'page.commentsStopped': 'You will no longer get an email when a new comment arrives.',
  'page.commentsUnknown': 'That account no longer exists: there is nothing to unsubscribe from.',
  'page.commentsRestore': 'To turn them back on, ask the administrator of this instance.',
  'page.albumStopped': (album: string) =>
    `You will no longer get an email when new photos arrive in "${album}".`,
  'page.albumUnknown':
    'That album or that account no longer exists: there is nothing to unsubscribe from.',
  'page.albumRepliesContinue':
    'Replies to your comments keep arriving: those are stopped from the link in one of those emails.',
};

/**
 * The shape every catalogue must have. Declared beside the English one because
 * this object *is* the contract.
 */
export type Messages = typeof en;
