import { ALL_ALBUMS, type AdminAlbum } from '@lukarn/shared';
import { type ReactElement, useId, useState } from 'react';
import { useT } from '../../lib/i18n';
import { Choice } from './ui';

interface AlbumAccessPickerProps {
  albums: AdminAlbum[];
  /** List of IDs, or `['*']`. */
  value: string[];
  onChange: (albums: string[]) => void;
  disabled?: boolean;
}

/**
 * Assigns albums to an account.
 *
 * The wildcard and an exhaustive selection grant the same access today, but not
 * tomorrow: the wildcard follows albums created later. They are therefore two
 * separate choices, not a "select all" checkbox — selecting twelve existing
 * albums never means "all albums".
 */
export function AlbumAccessPicker({
  albums,
  value,
  onChange,
  disabled = false,
}: AlbumAccessPickerProps): ReactElement {
  const t = useT();
  const groupId = useId();
  const wildcard = value.includes(ALL_ALBUMS);

  // Preserve the explicit selection through a round trip to the wildcard:
  // returning to "a selection" must not select everything again.
  const [remembered, setRemembered] = useState<string[]>(wildcard ? [] : value);
  const selected = wildcard ? remembered : value;

  const select = (next: string[]): void => {
    setRemembered(next);
    onChange(next);
  };

  const toggle = (albumId: string, checked: boolean): void => {
    select(checked ? [...selected, albumId] : selected.filter((id) => id !== albumId));
  };

  // A deleted album may remain in an account's list: keep it visible or it
  // would be impossible to remove.
  const orphans = selected.filter((id) => !albums.some((album) => album.id === id));
  const allChecked = albums.length > 0 && albums.every((album) => selected.includes(album.id));

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-1.5 text-sm text-ink-300">{t('access.legend')}</legend>

      <div className="space-y-2">
        <Choice
          name={groupId}
          id={`${groupId}-all`}
          checked={wildcard}
          onSelect={() => onChange([ALL_ALBUMS])}
          label={t('access.every')}
          hint={
            <>
              {t('access.everyHint')} <code className="text-ink-300">{ALL_ALBUMS}</code>.
            </>
          }
        />

        <Choice
          name={groupId}
          id={`${groupId}-pick`}
          checked={!wildcard}
          onSelect={() => select(remembered)}
          label={t('access.selection')}
          hint={t('access.selectionHint')}
        />
      </div>

      {!wildcard && (
        <div className="mt-3">
          {albums.length === 0 && orphans.length === 0 ? (
            <p className="rounded-lg border border-dashed border-ink-700 px-3 py-4 text-xs text-ink-400">
              {t('access.noAlbum')}
            </p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-ink-700 p-2">
              {albums.map((album) => (
                <AlbumCheckbox
                  key={album.id}
                  id={`${groupId}-${album.id}`}
                  checked={selected.includes(album.id)}
                  onChange={(checked) => toggle(album.id, checked)}
                  title={album.title}
                  detail={t('access.albumDetail', album.id, album.itemCount)}
                />
              ))}

              {orphans.map((albumId) => (
                <AlbumCheckbox
                  key={albumId}
                  id={`${groupId}-orphan-${albumId}`}
                  checked
                  onChange={() => toggle(albumId, false)}
                  title={albumId}
                  detail={t('access.orphan')}
                />
              ))}
            </div>
          )}

          {allChecked && <p className="mt-2 text-xs text-amber-300">{t('access.allTicked')}</p>}
        </div>
      )}
    </fieldset>
  );
}

function AlbumCheckbox({
  id,
  checked,
  onChange,
  title,
  detail,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  detail: string;
}): ReactElement {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-tint"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 shrink-0 accent-accent"
      />
      <span className="min-w-0">
        <span className="block truncate text-sm text-ink-200">{title}</span>
        <span className="block truncate text-xs text-ink-400">{detail}</span>
      </span>
    </label>
  );
}
