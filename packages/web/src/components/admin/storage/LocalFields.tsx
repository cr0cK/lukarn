import type { ReactElement } from 'react';
import type { LocalDraft } from '../../../lib/storageDraft';
import { useT } from '../../../lib/i18n';
import { TextField } from '../ui';

/**
 * Which folder **under `STORAGE_LOCAL_ROOT`** this connection reads.
 *
 * One field, because there is only one thing to choose: the root itself is never typed
 * here — it is the fence the container declares, and an administrator cannot move it
 * (D260816d). Left empty, the connection reads that root.
 *
 * The hint states the root rather than naming the variable alone. What this field holds
 * is measured against a value the screen otherwise never shows, and a relative path
 * whose origin is invisible is a path typed blind — which is how an absolute one gets
 * typed instead, and silently rebased under the root.
 */
export function LocalFields({
  fieldId,
  draft,
  localRoot,
  errors,
  disabled,
  onChange,
}: {
  fieldId: string;
  draft: LocalDraft;
  /** `null` when the server declared none, in which case nothing here can be read. */
  localRoot: string | null;
  errors: Record<string, string | null> | null;
  disabled: boolean;
  onChange: (next: LocalDraft) => void;
}): ReactElement {
  const t = useT();

  return (
    <TextField
      id={`${fieldId}-path`}
      label={t('storage.path')}
      value={draft.path}
      onChange={(path) => onChange({ ...draft, path })}
      autoComplete="off"
      disabled={disabled}
      error={errors?.path ?? null}
      hint={localRoot ? t('storage.pathHint', localRoot) : t('storage.pathNoRoot')}
    />
  );
}
