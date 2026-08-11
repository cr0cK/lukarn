import { ALL_ALBUMS, type AdminAlbum } from '@nonni/shared';
import { type ReactElement, useId, useState } from 'react';

interface AlbumAccessPickerProps {
  albums: AdminAlbum[];
  /** Liste d'ids, ou `['*']`. */
  value: string[];
  onChange: (albums: string[]) => void;
  disabled?: boolean;
}

/**
 * Attribution des albums à un compte.
 *
 * Le joker et une sélection exhaustive donnent aujourd'hui le même accès, et
 * demain non : le joker suivra les albums créés plus tard. Les deux sont donc
 * deux choix distincts et pas une case « tout cocher » — cocher les douze
 * albums existants n'est jamais une manière d'exprimer « tous les albums ».
 */
export function AlbumAccessPicker({
  albums,
  value,
  onChange,
  disabled = false,
}: AlbumAccessPickerProps): ReactElement {
  const groupId = useId();
  const wildcard = value.includes(ALL_ALBUMS);

  // La sélection explicite survit à un aller-retour vers le joker : revenir sur
  // « une sélection » après l'avoir quittée ne doit pas tout faire recocher.
  const [remembered, setRemembered] = useState<string[]>(wildcard ? [] : value);
  const selected = wildcard ? remembered : value;

  const select = (next: string[]): void => {
    setRemembered(next);
    onChange(next);
  };

  const toggle = (albumId: string, checked: boolean): void => {
    select(checked ? [...selected, albumId] : selected.filter((id) => id !== albumId));
  };

  // Un album supprimé peut subsister dans la liste d'un compte : il reste
  // affiché, sans quoi il serait impossible de l'en retirer.
  const orphans = selected.filter((id) => !albums.some((album) => album.id === id));
  const allChecked = albums.length > 0 && albums.every((album) => selected.includes(album.id));

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-1.5 text-sm text-ink-300">Albums accessibles</legend>

      <div className="space-y-2">
        <Choice
          name={groupId}
          id={`${groupId}-all`}
          checked={wildcard}
          onSelect={() => onChange([ALL_ALBUMS])}
          label="Tous les albums"
          hint={
            <>
              Y compris ceux créés plus tard. Enregistré sous la forme du joker{' '}
              <code className="text-ink-300">{ALL_ALBUMS}</code>.
            </>
          }
        />

        <Choice
          name={groupId}
          id={`${groupId}-pick`}
          checked={!wildcard}
          onSelect={() => select(remembered)}
          label="Une sélection d'albums"
          hint="Seulement les albums cochés. Un album créé plus tard devra être attribué à la main."
        />
      </div>

      {!wildcard && (
        <div className="mt-3">
          {albums.length === 0 && orphans.length === 0 ? (
            <p className="rounded-lg border border-dashed border-ink-700 px-3 py-4 text-xs text-ink-400">
              Aucun album n'existe encore. Crée-en un dans la section Albums, ou donne le joker.
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
                  detail={`${album.id} · ${album.itemCount.toLocaleString('fr-FR')} éléments`}
                />
              ))}

              {orphans.map((albumId) => (
                <AlbumCheckbox
                  key={albumId}
                  id={`${groupId}-orphan-${albumId}`}
                  checked
                  onChange={() => toggle(albumId, false)}
                  title={albumId}
                  detail="album inconnu — décoche pour le retirer"
                />
              ))}
            </div>
          )}

          {allChecked && (
            <p className="mt-2 text-xs text-amber-300">
              Tous les albums actuels sont cochés, ce qui n'est pas la même chose que « Tous les
              albums » : les prochains ne seront pas attribués automatiquement.
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}

function Choice({
  name,
  id,
  checked,
  onSelect,
  label,
  hint,
}: {
  name: string;
  id: string;
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint: ReactElement | string;
}): ReactElement {
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
        checked ? 'border-accent-dim bg-accent/5' : 'border-ink-700 hover:bg-white/5'
      }`}
    >
      <input
        id={id}
        name={name}
        type="radio"
        checked={checked}
        onChange={onSelect}
        aria-describedby={`${id}-hint`}
        className="mt-0.5 size-4 shrink-0 accent-accent"
      />
      <span className="min-w-0">
        <span className="block text-sm text-ink-100">{label}</span>
        <span id={`${id}-hint`} className="block text-xs text-ink-400">
          {hint}
        </span>
      </span>
    </label>
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
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-white/5"
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
