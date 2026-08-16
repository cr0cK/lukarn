import type { ReactElement } from 'react';
import type { WebdavDraft } from '../../../lib/storageDraft';
import { useT } from '../../../lib/i18n';
import { TextField } from '../ui';

/**
 * The address, the folder and the credentials of a WebDAV server.
 *
 * The address is the whole difficulty for whoever fills this in: Nextcloud's WebDAV
 * endpoint is not the URL they browse the files at, and getting it wrong produces a
 * 405 rather than anything readable — which is why the hint names the shape instead of
 * describing it, and why "Test" reports what the server actually said.
 */
export function WebdavFields({
  fieldId,
  draft,
  errors,
  disabled,
  keepingSecret = false,
  onChange,
}: {
  fieldId: string;
  draft: WebdavDraft;
  errors: Record<string, string | null> | null;
  disabled: boolean;
  /** Editing: the stored credentials are kept unless something is typed over them. */
  keepingSecret?: boolean;
  onChange: (next: WebdavDraft) => void;
}): ReactElement {
  const t = useT();

  return (
    <div className="space-y-4">
      <TextField
        id={`${fieldId}-webdav-url`}
        label={t('storage.webdavUrl')}
        value={draft.url}
        onChange={(url) => onChange({ ...draft, url })}
        autoComplete="off"
        disabled={disabled}
        error={errors?.url ?? null}
        hint={t('storage.webdavUrlHint')}
      />

      <TextField
        id={`${fieldId}-webdav-root`}
        label={t('storage.webdavRoot')}
        value={draft.root}
        onChange={(root) => onChange({ ...draft, root })}
        autoComplete="off"
        disabled={disabled}
        hint={t('storage.webdavRootHint')}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id={`${fieldId}-webdav-username`}
          label={t('storage.webdavUsername')}
          value={draft.username}
          onChange={(username) => onChange({ ...draft, username })}
          autoComplete="off"
          disabled={disabled}
          error={errors?.username ?? null}
        />

        <TextField
          id={`${fieldId}-webdav-password`}
          label={t('storage.webdavPassword')}
          value={draft.password}
          onChange={(password) => onChange({ ...draft, password })}
          type="password"
          autoComplete="new-password"
          disabled={disabled}
          error={errors?.password ?? null}
          hint={t(keepingSecret ? 'storage.secretKept' : 'storage.webdavPasswordHint')}
        />
      </div>
    </div>
  );
}
