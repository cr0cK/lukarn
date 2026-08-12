import { MEDIA_DESCRIPTION_MAX_LENGTH } from '@nonni/shared';
import { type FormEvent, type ReactElement, useState } from 'react';
import { errorText } from '../api/client';
import { useUpdateMedia } from '../api/hooks';
import { captionEntries, type CaptionEntry } from '../lib/caption';

/**
 * Viewer caption bar: the photo description, then its day note — in that order,
 * at **every width**.
 *
 * It lives in its own file because `Lightbox.tsx` already spans 850 lines and
 * because its contents have nothing to do with photo navigation: two texts,
 * expansion, hiding and an administrator editor (D84). The album description
 * was removed from it (D89): it is read when opening the album, and repeating it
 * on every photo cost a bar line for text already read.
 *
 * The editor follows `AlbumDescription` — overlay, character count,
 * Cancel/Save. Two ways to correct text in the same application would be
 * immediately noticeable.
 */
interface MediaCaptionProps {
  albumId: string;
  mediaId: string;
  /** The two candidate texts. An empty or whitespace-only string means absent. */
  description: string | null;
  day: string | null;
  /** Administrator: only they see the pencil and invitation to write. */
  editable: boolean;
  hidden: boolean;
  onHiddenChange: (hidden: boolean) => void;
  /**
   * The viewer controls editor opening: it listens for `Escape`, and that key
   * must close the input before closing anything else.
   */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  /**
   * `false` for a video, the only case where the bar **pushes** instead of
   * overlaying: native playback controls live at the bottom of the element, and
   * on a portrait video filling the screen, an overlaid bar would make play/pause
   * and the progress bar unreachable.
   */
  overlay: boolean;
}

export function MediaCaption({
  albumId,
  mediaId,
  description,
  day,
  editable,
  hidden,
  onHiddenChange,
  editing,
  onEditingChange,
  overlay,
}: MediaCaptionProps): ReactElement | null {
  /**
   * Expansion is **not** persisted, unlike hiding: it relates to specific text
   * and has no meaning on the next photo. The viewer remounts this component for
   * each photo (`key`), which collapses it again.
   */
  const [expanded, setExpanded] = useState(false);

  const entries = captionEntries({ description, day });

  // Nothing to say or write: not even a ghost button inviting discovery of an
  // empty bar.
  if (entries.length === 0 && !editable) return null;

  if (hidden) {
    // A hidden state without an exit is a trap: once the bar is gone, nothing
    // would reveal its existence or how to recall it.
    return (
      <div className={`${overlay ? 'absolute right-0 bottom-0 z-10' : 'flex justify-end'} p-3`}>
        <button
          type="button"
          onClick={() => onHiddenChange(false)}
          className="rounded-full bg-black/40 px-2.5 py-1 text-xs text-ink-400 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-ink-100"
        >
          Show the caption (l)
        </button>
      </div>
    );
  }

  return (
    // Mirror the header: same gradient, reversed. Without it, a light caption on
    // an overexposed area is unreadable.
    //
    // Side margins account for the notch like the header's: in landscape, it
    // cuts into precisely that edge. Apply them to the content rather than the
    // wrapper so the gradient reaches the edge of the screen.
    <div
      className={`${
        overlay ? 'absolute inset-x-0 bottom-0 z-10' : 'relative'
      } bg-gradient-to-t from-black/85 via-black/55 to-transparent pt-10`}
    >
      <div className="flex items-stretch gap-2 pb-2 pl-[calc(0.75rem_+_env(safe-area-inset-left))] pr-[calc(0.75rem_+_env(safe-area-inset-right))] sm:pb-3 sm:pl-[calc(1rem_+_env(safe-area-inset-left))] sm:pr-[calc(1rem_+_env(safe-area-inset-right))]">
        <div className="min-w-0 flex-1">
          {editable && !description && (
            <button
              type="button"
              onClick={() => onEditingChange(true)}
              className="rounded text-sm text-ink-400 transition-colors hover:text-ink-100"
            >
              + Describe this photo
            </button>
          )}

          {entries.length > 0 && (
            // Scroll the wrapper rather than the button: when expanded, a thousand
            // characters would cover the entire photo.
            <div className={expanded ? 'max-h-[50vh] overflow-y-auto' : undefined}>
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
                aria-label={expanded ? 'Collapse the caption' : 'Expand the caption'}
                className="block w-full space-y-0.5 text-left"
              >
                {entries.map((entry) => (
                  <CaptionLine key={entry.scope} entry={entry} expanded={expanded} />
                ))}
              </button>
            </div>
          )}
        </div>

        {/* Pencil at the top, chevron at the bottom: each faces the line it
            controls — the photo description and the entire bar. */}
        <div className="flex shrink-0 flex-col justify-between">
          {editable && description ? (
            <IconButton label="Edit this photo description" onClick={() => onEditingChange(true)}>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </IconButton>
          ) : (
            <span />
          )}

          <IconButton label="Hide the caption (l)" onClick={() => onHiddenChange(true)}>
            <path d="m6 9 6 6 6-6" />
          </IconButton>
        </div>
      </div>

      {editing && (
        <CaptionEditor
          albumId={albumId}
          mediaId={mediaId}
          description={description}
          onClose={() => onEditingChange(false)}
        />
      )}
    </div>
  );
}

/**
 * One bar row. Colour and visible line count distinguish the two scopes: the
 * broader the scope, the more the row recedes — making the photo description
 * read first without any heading saying so.
 */
const LINE_STYLES: Record<CaptionEntry['scope'], string> = {
  photo: 'line-clamp-3 text-sm leading-5 text-ink-100',
  day: 'line-clamp-2 text-xs leading-4 text-ink-300',
};

function CaptionLine({
  entry,
  expanded,
}: {
  entry: CaptionEntry;
  expanded: boolean;
}): ReactElement {
  return (
    <p
      className={`max-w-prose whitespace-pre-line ${LINE_STYLES[entry.scope]} ${
        expanded ? 'line-clamp-none' : ''
      }`}
    >
      {entry.label && <span className="text-ink-500">{entry.label} · </span>}
      {entry.text}
    </p>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded-full p-1.5 text-ink-400 transition-colors hover:bg-white/10 hover:text-white"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  );
}

function CaptionEditor({
  albumId,
  mediaId,
  description,
  onClose,
}: {
  albumId: string;
  mediaId: string;
  description: string | null;
  onClose: () => void;
}): ReactElement {
  const update = useUpdateMedia(albumId);
  const [value, setValue] = useState(description ?? '');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    update.mutate(
      // Send an empty string as `null`: it is the only way to clear the value,
      // and the server normalises both to the same result anyway.
      { mediaId, body: { description: value.trim() || null } },
      { onSuccess: onClose },
    );
  };

  return (
    <form
      onSubmit={submit}
      className="absolute inset-x-2 bottom-2 z-20 space-y-2 rounded-xl border border-ink-700 bg-ink-900 p-3 shadow-xl sm:inset-x-4 sm:bottom-3 sm:max-w-prose"
    >
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={MEDIA_DESCRIPTION_MAX_LENGTH}
        rows={3}
        placeholder="What's happening in this photo"
        aria-label="Photo description"
        autoFocus
        className="w-full resize-none rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm outline-none placeholder:text-ink-500 focus:border-accent-dim"
      />

      {update.error && (
        <p role="alert" className="text-xs text-red-300">
          {errorText(update.error, 'Saving failed.')}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-500">
          {value.length}/{MEDIA_DESCRIPTION_MAX_LENGTH}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={update.isPending}
            className="rounded-lg px-3 py-1.5 text-sm text-ink-300 transition-colors hover:bg-white/5 hover:text-ink-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={update.isPending}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </form>
  );
}
