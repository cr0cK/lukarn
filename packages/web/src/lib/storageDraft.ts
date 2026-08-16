/**
 * A storage connection as it is being typed, before anything is stored.
 *
 * Pure functions without React or network access, beside `adminForm.ts` and for the
 * same reason: what a backend requires is a rule, and a rule tested through a rendered
 * form is a rule tested through everything else too.
 *
 * The shape is a **discriminated union** rather than a record keyed by kind. Under
 * `noUncheckedIndexedAccess` a `Record<StorageKind, unknown>` hands back `unknown`, so
 * every field access needs a cast; narrowing on `draft.kind` hands back exactly the
 * fields that kind has. Adding a backend is then a branch of one line in each function
 * below plus a fields component — never a fifth graft into a form that already carries
 * three (D260816g).
 */

import type { CreateStorageRequest, StorageKind, UpdateStorageRequest } from '@lukarn/shared';
import { extractContainer } from './adminForm';
import type { MessageKey, Translate } from './i18n';

/** What each kind is called on screen. Adding a kind adds a key, never a branch. */
export const KIND_LABELS: Record<StorageKind, MessageKey> = {
  drive: 'storage.kindDrive',
  local: 'storage.kindLocal',
  s3: 'storage.kindS3',
  webdav: 'storage.kindWebdav',
};

/** Everything a connection of one kind needs before it can be created. */
export type StorageDraft =
  | { kind: 'drive' }
  | { kind: 'local'; path: string }
  | {
      kind: 's3';
      endpoint: string;
      region: string;
      bucket: string;
      prefix: string;
      pathStyle: boolean;
      accessKeyId: string;
      secretAccessKey: string;
    }
  | { kind: 'webdav'; url: string; root: string; username: string; password: string };

/** The draft of one kind, for the component that edits it. */
export type LocalDraft = Extract<StorageDraft, { kind: 'local' }>;
export type S3Draft = Extract<StorageDraft, { kind: 's3' }>;
export type WebdavDraft = Extract<StorageDraft, { kind: 'webdav' }>;

/**
 * What is wrong with a local subpath, `null` where nothing is.
 *
 * An absolute path gets its own refusal rather than the generic one. `extractContainer`
 * strips a leading separator — legitimate normalisation for a bucket prefix, where it
 * is noise — so `/home/alexis/temp` would silently become a folder of that name **under**
 * the declared root, and the mistake would only surface as a directory that does not
 * exist. Naming it here is the difference between a typo and a puzzle (D260816d).
 */
function localPathError(value: string, t: Translate): string | null {
  const path = value.trim();
  if (path.startsWith('/')) return t('validate.storageAbsolutePath');
  if (path && extractContainer(path, 'local') === null) return t('validate.storagePath');
  return null;
}

/**
 * A blank draft of that kind.
 *
 * Called again whenever the kind changes: a bucket's keys have no meaning under
 * **WebDAV server**, and carrying them across would send half a form the backend
 * never asked for.
 */
export function emptyDraft(kind: StorageKind): StorageDraft {
  switch (kind) {
    case 'drive':
      return { kind: 'drive' };
    case 'local':
      return { kind: 'local', path: '' };
    case 's3':
      return {
        kind: 's3',
        endpoint: '',
        region: '',
        bucket: '',
        prefix: '',
        pathStyle: false,
        accessKeyId: '',
        secretAccessKey: '',
      };
    case 'webdav':
      return { kind: 'webdav', url: '', root: '', username: '', password: '' };
  }
}

/**
 * What is wrong with each field, `null` where nothing is.
 *
 * The server validates again and remains authoritative; this exists so that a missing
 * password is reported beside the field rather than as a connection that answers
 * "refused" the first time an album is synchronised. Only the fields a backend cannot
 * work without are checked: a region and a prefix have working defaults, and a local
 * subpath left empty means the root the container already declared.
 *
 * `keepingSecret` is what editing an existing connection passes: a blank credential
 * then means "leave the stored one alone" rather than "there is none", exactly as an
 * empty password field does when an account is edited.
 */
export function draftErrors(
  draft: StorageDraft,
  t: Translate,
  keepingSecret = false,
): Record<string, string | null> {
  switch (draft.kind) {
    // A consent is not typed: there is nothing here to be wrong.
    case 'drive':
      return {};
    case 'local':
      return { path: localPathError(draft.path, t) };
    // A bucket is unusable without all four: the connection would be created, every
    // album on it would stay empty, and Test would be the only thing saying so.
    case 's3':
      return {
        endpoint: draft.endpoint.trim() ? null : t('validate.storageEndpoint'),
        bucket: draft.bucket.trim() ? null : t('validate.storageBucket'),
        accessKeyId:
          keepingSecret || draft.accessKeyId.trim() ? null : t('validate.storageAccessKey'),
        secretAccessKey:
          keepingSecret || draft.secretAccessKey.trim() ? null : t('validate.storageSecretKey'),
      };
    case 'webdav':
      return {
        url: /^https?:\/\/\S+$/i.test(draft.url.trim()) ? null : t('validate.storageUrl'),
        username: keepingSecret || draft.username.trim() ? null : t('validate.storageUsername'),
        password: keepingSecret || draft.password ? null : t('validate.storagePassword'),
      };
  }
}

/**
 * The draft as the API takes it: settings in the clear, the credentials as the one secret.
 *
 * A connection stores exactly **one** encrypted string, so a backend needing two values
 * — a bucket's key pair, a WebDAV username and password — puts JSON in it. Assembling
 * that here rather than server-side keeps the secret in a single field all the way
 * through: nothing between this form and `TOKEN_KEY` ever sees the two halves
 * separately. What sits in `settings` is stored in the clear and deliberately so:
 * neither an endpoint nor a folder gives access to anything on its own.
 */
export function draftPayload(draft: StorageDraft): Partial<CreateStorageRequest> {
  switch (draft.kind) {
    case 'drive':
      return {};
    case 'local':
      return { settings: { path: extractContainer(draft.path, 'local') ?? '' } };
    case 's3':
      return {
        settings: {
          endpoint: draft.endpoint.trim(),
          region: draft.region.trim(),
          bucket: draft.bucket.trim(),
          prefix: draft.prefix.trim(),
          pathStyle: String(draft.pathStyle),
        },
        secret: JSON.stringify({
          accessKeyId: draft.accessKeyId.trim(),
          secretAccessKey: draft.secretAccessKey.trim(),
        }),
      };
    case 'webdav':
      return {
        settings: { url: draft.url.trim(), root: draft.root.trim() },
        secret: JSON.stringify({ username: draft.username.trim(), password: draft.password }),
      };
  }
}

/**
 * The same payload for an edit, with the secret dropped when nothing was retyped.
 *
 * `UpdateStorageRequest` distinguishes three answers, and only two of them can be
 * expressed by a field: a value replaces the stored secret, and **absent** leaves it
 * alone. The third — `null`, forget it — is a deliberate act and gets its own control,
 * because a form that forgot a key every time somebody corrected a bucket name would
 * disconnect a storage by accident.
 */
export function draftUpdate(draft: StorageDraft, secretTyped: boolean): UpdateStorageRequest {
  const { settings, secret } = draftPayload(draft);
  return { settings, ...(secretTyped ? { secret } : {}) };
}

/**
 * The draft an existing connection is edited from.
 *
 * Reads what `StorageConnectionStatus` carries, which is the settings and never the
 * secret: the credential fields therefore start empty and mean "unchanged". Missing
 * keys fall back to a blank draft rather than throwing — a connection stored before a
 * setting existed is older than the field, not broken.
 */
export function draftFromSettings(
  kind: StorageKind,
  settings: Record<string, string>,
): StorageDraft {
  switch (kind) {
    case 'drive':
      return { kind: 'drive' };
    case 'local':
      return { kind: 'local', path: settings.path ?? '' };
    case 's3':
      return {
        kind: 's3',
        endpoint: settings.endpoint ?? '',
        region: settings.region ?? '',
        bucket: settings.bucket ?? '',
        prefix: settings.prefix ?? '',
        pathStyle: settings.pathStyle === 'true',
        accessKeyId: '',
        secretAccessKey: '',
      };
    case 'webdav':
      return {
        kind: 'webdav',
        url: settings.url ?? '',
        root: settings.root ?? '',
        username: '',
        password: '',
      };
  }
}

/** Whether a credential was typed into this draft, and therefore replaces the stored one. */
export function secretTyped(draft: StorageDraft): boolean {
  if (draft.kind === 's3') return Boolean(draft.accessKeyId.trim() || draft.secretAccessKey.trim());
  if (draft.kind === 'webdav') return Boolean(draft.username.trim() || draft.password);
  return false;
}
