import { ALBUM_DESCRIPTION_MAX_LENGTH } from '@lukarn/shared';
import { type FormEvent, type ReactElement, useState } from 'react';
import { errorText } from '../api/client';
import { useUpdateAlbum } from '../api/hooks';
import { useT } from '../lib/i18n';

/**
 * Album description above the grid: readable by everyone and editable in place
 * by an administrator.
 *
 * It used to be editable only from `/admin`, while a day note is written with
 * one click in the grid just below. Two adjacent texts required two different
 * actions; this component removes that asymmetry.
 *
 * **The pencil is always visible**, unlike the one in `SectionHeader`, which
 * appears only when its section is hovered. There, quantity justifies the rule
 * — showing one pencil per day would turn the grid into a form. Here there is
 * only one for the whole album: hiding it would gain nothing and make it hard
 * to find.
 */
interface AlbumDescriptionProps {
  albumId: string;
  description: string | null;
  /** Administrator: only they see the pencil and invitation to write. */
  editable: boolean;
}

export function AlbumDescription({
  albumId,
  description,
  editable,
}: AlbumDescriptionProps): ReactElement | null {
  const t = useT();
  const [editing, setEditing] = useState(false);

  if (!description && !editable) return null;

  return (
    // `relative`: the editor opens as an overlay, like a day's editor. Putting it
    // in the flow would shift the entire grid down — and `useGridLayout` measures
    // `offsetTop` only on resize, so a simple vertical shift would escape it.
    <div className="relative mb-5">
      {description ? (
        // No width limit: the description takes the width of the grid below it.
        // Limited to the usual typographic measure, it left two-thirds of the
        // line empty on a large screen above a grid reaching the edge — a narrow
        // paragraph on a wide board without reason for the break.
        <p className="text-sm leading-relaxed whitespace-pre-line text-ink-300">
          {description}
          {editable && (
            <EditButton label={t('album.editDescription')} onClick={() => setEditing(true)} />
          )}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-lg text-sm text-ink-500 transition-colors hover:text-ink-200"
        >
          {t('album.describe')}
        </button>
      )}

      {editing && (
        <DescriptionEditor
          albumId={albumId}
          description={description}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function EditButton({ label, onClick }: { label: string; onClick: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      // `align-text-bottom`: placed after the last word, an inline button
      // otherwise sits on the baseline and extends below the paragraph.
      className="ml-1.5 inline-flex rounded p-1 align-text-bottom text-ink-500 transition-colors hover:bg-white/5 hover:text-ink-200"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </button>
  );
}

interface DescriptionEditorProps {
  albumId: string;
  description: string | null;
  onClose: () => void;
}

function DescriptionEditor({
  albumId,
  description,
  onClose,
}: DescriptionEditorProps): ReactElement {
  const t = useT();
  const update = useUpdateAlbum();
  const [value, setValue] = useState(description ?? '');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    update.mutate(
      // Send an empty string as `null`: it is the only way to clear the value,
      // and the server normalises both to the same result anyway.
      { albumId, body: { description: value.trim() || null } },
      { onSuccess: onClose },
    );
  };

  return (
    <form
      onSubmit={submit}
      // The editor remains limited: it is a form, and a two-thousand-pixel-wide
      // input field is not readable.
      className="absolute top-0 left-0 z-20 w-full max-w-prose space-y-2 rounded-xl border border-ink-700 bg-ink-900 p-3 shadow-xl"
    >
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={ALBUM_DESCRIPTION_MAX_LENGTH}
        rows={4}
        placeholder={t('album.descriptionPlaceholder')}
        aria-label={t('album.descriptionLabel')}
        autoFocus
        className="w-full resize-none rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm outline-none placeholder:text-ink-500 focus:border-accent-dim"
      />

      {update.error && (
        <p role="alert" className="text-xs text-red-300">
          {errorText(update.error, t('common.saveFailed'))}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-500">
          {value.length}/{ALBUM_DESCRIPTION_MAX_LENGTH}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={update.isPending}
            className="rounded-lg px-3 py-1.5 text-sm text-ink-300 transition-colors hover:bg-white/5 hover:text-ink-100"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={update.isPending}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {t(update.isPending ? 'common.saving' : 'common.save')}
          </button>
        </div>
      </div>
    </form>
  );
}
