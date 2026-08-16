import type { ReactElement } from 'react';
import type { S3Draft } from '../../../lib/storageDraft';
import { useT } from '../../../lib/i18n';
import { Checkbox, TextField } from '../ui';

/**
 * Where the bucket is, and what opens it.
 *
 * Five settings and a key pair, laid out in the order they are read off a provider's
 * console. The secret half is a password field for the reason every password field
 * exists here: this form is filled in on a laptop with somebody else in the room, and
 * the value is never shown again once it is stored.
 */
export function S3Fields({
  fieldId,
  draft,
  errors,
  disabled,
  keepingSecret = false,
  onChange,
}: {
  fieldId: string;
  draft: S3Draft;
  /** Only the four that are required: a region and a prefix have working defaults. */
  errors: Record<string, string | null> | null;
  disabled: boolean;
  /** Editing: the stored key pair is kept unless something is typed over it. */
  keepingSecret?: boolean;
  onChange: (next: S3Draft) => void;
}): ReactElement {
  const t = useT();

  return (
    <div className="space-y-4 border-t border-ink-850 pt-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id={`${fieldId}-endpoint`}
          label={t('storage.endpoint')}
          value={draft.endpoint}
          onChange={(endpoint) => onChange({ ...draft, endpoint })}
          placeholder="https://s3.eu-west-3.amazonaws.com"
          autoComplete="off"
          disabled={disabled}
          error={errors?.endpoint ?? null}
          hint={t('storage.endpointHint')}
        />

        <TextField
          id={`${fieldId}-region`}
          label={t('storage.region')}
          value={draft.region}
          onChange={(region) => onChange({ ...draft, region })}
          placeholder="us-east-1"
          autoComplete="off"
          disabled={disabled}
          hint={t('storage.regionHint')}
        />

        <TextField
          id={`${fieldId}-bucket`}
          label={t('storage.bucket')}
          value={draft.bucket}
          onChange={(bucket) => onChange({ ...draft, bucket })}
          autoComplete="off"
          disabled={disabled}
          error={errors?.bucket ?? null}
        />

        <TextField
          id={`${fieldId}-prefix`}
          label={t('storage.prefix')}
          value={draft.prefix}
          onChange={(prefix) => onChange({ ...draft, prefix })}
          autoComplete="off"
          disabled={disabled}
          hint={t('storage.prefixHint')}
        />

        <TextField
          id={`${fieldId}-access-key`}
          label={t('storage.accessKeyId')}
          value={draft.accessKeyId}
          onChange={(accessKeyId) => onChange({ ...draft, accessKeyId })}
          autoComplete="off"
          disabled={disabled}
          error={errors?.accessKeyId ?? null}
        />

        <TextField
          id={`${fieldId}-secret-key`}
          label={t('storage.secretAccessKey')}
          value={draft.secretAccessKey}
          onChange={(secretAccessKey) => onChange({ ...draft, secretAccessKey })}
          type="password"
          autoComplete="off"
          disabled={disabled}
          error={errors?.secretAccessKey ?? null}
          hint={t(keepingSecret ? 'storage.secretKept' : 'storage.secretAccessKeyHint')}
        />
      </div>

      <Checkbox
        id={`${fieldId}-path-style`}
        label={t('storage.pathStyle')}
        hint={t('storage.pathStyleHint')}
        checked={draft.pathStyle}
        disabled={disabled}
        onChange={(pathStyle) => onChange({ ...draft, pathStyle })}
      />
    </div>
  );
}
