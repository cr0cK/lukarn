import {
  ALBUM_DAY_DESCRIPTION_MAX_LENGTH,
  ALBUM_DAY_PLACE_MAX_LENGTH,
  type AlbumDay,
} from '@lukarn/shared';
import { type FormEvent, type ReactElement, useState } from 'react';
import { errorText } from '../api/client';
import { useUpdateAlbumDay } from '../api/hooks';
import { GRID_HEADER_NOTE_CLASS, placeLabelOf } from '../lib/useGridLayout';
import type { LayoutSection } from '../lib/justify';

/**
 * Grid section header: date, item count, place when carried by the photos and a
 * note when somebody has written one.
 *
 * **Its height is not measured here; it is provided.** `computeLayout` has
 * already placed every photo when this component mounts; overflowing the box
 * reserved by the layout would put it beneath thumbnails. Hence the fixed line
 * height (`leading-5`): every line is exactly `GRID_HEADER_LINE_HEIGHT`, and the
 * line height fulfils the contract, not the font size, which may change without
 * touching the constant.
 *
 * The place fits on one truncated line; the note spans as many lines as needed,
 * but only **those counted by the layout** — `descriptionLines` comes from the
 * same measurement as the reserved height and bounds the box so they cannot
 * diverge (D93).
 *
 * The editor follows the same rule: it opens as an **absolute overlay** instead
 * of pushing the flow. Growing the header on opening would shift the rest of the
 * album beneath the pointer.
 */
interface SectionHeaderProps {
  albumId: string;
  section: LayoutSection;
  /** Matching annotated day, absent when it carries nothing. */
  day: AlbumDay | undefined;
  /** Administrator when grouping by day: a note belongs to a day. */
  editable: boolean;
  /** Lines reserved for the note by the layout. `0` when there is none. */
  descriptionLines: number;
  /** Collapses or expands this section. */
  onToggle: () => void;
}

export function SectionHeader({
  albumId,
  section,
  day,
  editable,
  descriptionLines,
  onToggle,
}: SectionHeaderProps): ReactElement {
  const [editing, setEditing] = useState(false);
  const place = placeLabelOf(day);
  const unit = section.count > 1 ? 'items' : 'item';

  return (
    <div
      // Align **at the top**: the title stays on `GRID_HEADER_PAD_TOP` regardless,
      // and remaining space below absorbs height variations. Bottom alignment
      // makes collapsing a section shorten it and lift its title — it jumped by
      // 20 px on every click.
      className="group/section absolute left-0 flex w-full flex-col pt-5"
      style={{ top: section.y, height: section.headerHeight }}
    >
      {/* Declared height and simple centring: this row contains only the title
          and pencil. Baseline alignment matters only between the title and its
          count one level below — used here, it shifted the entire row by two pixels. */}
      <div className="flex h-6 items-center gap-0.5">
        {/* Put the button inside the heading, not the reverse: `h2` is flow
            content that a `button` may not contain. This is also the accordion
            pattern expected by screen readers. */}
        <h2 className="min-w-0">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!section.collapsed}
            aria-label={`${section.label}, ${section.count} ${unit}`}
            title={section.collapsed ? 'Expand' : 'Collapse'}
            // Explicit `h-6`: baseline alignment offsets the count's 12 px box
            // from the title's 16 px box, growing the row by two pixels. On a
            // collapsed section whose box is exactly `PAD_TOP + TITLE_HEIGHT`,
            // those two pixels overflow. Declare the height like everything else.
            className="-ml-1.5 flex h-6 min-w-0 items-baseline gap-1.5 rounded-lg px-1.5 text-left transition-colors hover:bg-white/5"
          >
            <svg
              viewBox="0 0 24 24"
              className={`size-4 shrink-0 self-center text-ink-400 transition-transform ${
                section.collapsed ? '' : 'rotate-90'
              }`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
            <span className="truncate text-base leading-6 font-semibold text-ink-100">
              {section.label}
            </span>
            {/* Drop the unit below `sm` for lack of space; keep the number —
                it says what a collapsed section contains. The accessible button
                name carries the full wording regardless. */}
            {/* `leading-none`: the title determines row height. A 24 px line
                height gives the count an equally tall box, which baseline
                alignment lowers by two pixels — leaving it below the header. */}
            <span
              aria-hidden="true"
              className="shrink-0 text-xs leading-none text-ink-400 tabular-nums"
            >
              {section.count}
              <span className="hidden sm:inline"> {unit}</span>
            </span>
          </button>
        </h2>

        {editable && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title={day?.description || day?.place ? 'Edit the note' : 'Annotate this day'}
            // "the day of Today": relative labels from `dayLabel` cannot be
            // introduced by an article.
            aria-label={`Annotate ${section.label}`}
            // Keep it discreet with a mouse: one visible pencil per day would
            // turn the grid into a form. But hide it only for a **fine pointer**,
            // where hover can reveal it — in Tailwind v4 `hover:` is already
            // restricted to `(hover: hover)`, so plain `opacity-0` left the pencil
            // permanently unreachable by touch: an administrator on a phone
            // could annotate no day. `self-center`: without text, its baseline
            // is its bottom edge and it would hang below the title in an
            // `items-baseline` container.
            className="self-center rounded p-1 text-ink-500 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover/section:opacity-100 hover:bg-white/5 hover:text-ink-200 focus-visible:opacity-100"
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
        )}
      </div>

      {/* `pl-[22px]` = chevron (16) + gutter (6): align the place and note with
          the title **text**, not the button edge. Without this, the header's
          three lines started at two different positions. The chevron remains
          alone in its gutter like a tree arrow. The note gets this from
          `GRID_HEADER_NOTE_CLASS`, which must describe its whole geometry for
          the probe to measure the right one. */}
      {place && (
        <p className="truncate pl-[22px] text-sm leading-5 text-ink-300" title={place}>
          {place}
        </p>
      )}

      {day?.description && (
        <p
          className={`${GRID_HEADER_NOTE_CLASS} text-ink-200`}
          // Line count is measured, not estimated: the box should fit without a
          // bound. `line-clamp` covers the day it does not — an ellipsis costs
          // less than covered thumbnails and is the only possible safeguard in
          // a layout computed without the DOM.
          style={{
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: descriptionLines,
            overflow: 'hidden',
          }}
        >
          {day.description}
        </p>
      )}

      {editing && (
        <DayEditor
          albumId={albumId}
          dayKey={section.key}
          label={section.label}
          day={day}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

interface DayEditorProps {
  albumId: string;
  dayKey: string;
  label: string;
  day: AlbumDay | undefined;
  onClose: () => void;
}

function DayEditor({ albumId, dayKey, label, day, onClose }: DayEditorProps): ReactElement {
  const update = useUpdateAlbumDay(albumId);
  const [description, setDescription] = useState(day?.description ?? '');
  const [place, setPlace] = useState(day?.place ?? '');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    update.mutate(
      // Send an empty string as `null`: it is the only way to clear the value,
      // and the server normalises both to the same result anyway.
      {
        day: dayKey,
        body: { description: description.trim() || null, place: place.trim() || null },
      },
      { onSuccess: onClose },
    );
  };

  return (
    <form
      onSubmit={submit}
      // `absolute` and `z-20`: the editor covers the first thumbnails while
      // typing and pushes nothing away.
      className="absolute top-0 left-0 z-20 w-full max-w-lg space-y-2 rounded-xl border border-ink-700 bg-ink-900 p-3 shadow-xl"
    >
      <p className="text-xs text-ink-400">{label}</p>

      <input
        type="text"
        value={place}
        onChange={(event) => setPlace(event.target.value)}
        maxLength={ALBUM_DAY_PLACE_MAX_LENGTH}
        // The placeholder shows what EXIF inferred, making the value replaced by
        // new input explicit.
        placeholder={day?.autoPlaces.join(' · ') || 'Place (optional)'}
        aria-label="Place"
        autoFocus
        className="w-full rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm outline-none placeholder:text-ink-500 focus:border-accent-dim"
      />

      <textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        maxLength={ALBUM_DAY_DESCRIPTION_MAX_LENGTH}
        rows={2}
        placeholder="What happened that day"
        aria-label="Note for the day"
        className="w-full resize-none rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm outline-none placeholder:text-ink-500 focus:border-accent-dim"
      />

      {update.error && (
        <p role="alert" className="text-xs text-red-300">
          {errorText(update.error, 'Saving failed.')}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-500">
          {description.length}/{ALBUM_DAY_DESCRIPTION_MAX_LENGTH}
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
