import {
  ALBUM_DAY_DESCRIPTION_MAX_LENGTH,
  ALBUM_DAY_PLACE_MAX_LENGTH,
  type AlbumDay,
} from '@gdv/shared';
import { type FormEvent, type ReactElement, useState } from 'react';
import { errorText } from '../api/client';
import { useUpdateAlbumDay } from '../api/hooks';
import { placeLabelOf } from '../lib/useGridLayout';
import type { LayoutSection } from '../lib/justify';

/**
 * En-tête d'une section de la grille : la date, le nombre d'éléments, le lieu
 * si les photos le portent, la note si quelqu'un en a écrit une.
 *
 * **Sa hauteur ne se mesure pas, elle se déclare.** `computeLayout` a déjà
 * placé toutes les photos quand ce composant se monte ; s'il débordait de la
 * boîte que le layout lui a réservée, il passerait sous les vignettes. D'où les
 * hauteurs de ligne fixées (`leading-5`, deux lignes clampées) qui totalisent
 * exactement `GRID_PLACE_HEIGHT` et `GRID_DESCRIPTION_HEIGHT` — c'est
 * l'interligne qui tient le contrat, pas la taille de police, qu'on peut donc
 * remonter sans toucher aux constantes.
 *
 * Même raison pour l'éditeur : il s'ouvre **en survol absolu** au lieu de
 * pousser le flux. Faire grandir l'en-tête à l'ouverture décalerait toute la
 * suite de l'album sous le curseur.
 */
interface SectionHeaderProps {
  albumId: string;
  section: LayoutSection;
  /** La journée annotée correspondante, absente si elle ne porte rien. */
  day: AlbumDay | undefined;
  /** Administrateur, en découpage par jour : une note appartient à une journée. */
  editable: boolean;
  /** Replie ou déplie cette section. */
  onToggle: () => void;
}

export function SectionHeader({
  albumId,
  section,
  day,
  editable,
  onToggle,
}: SectionHeaderProps): ReactElement {
  const [editing, setEditing] = useState(false);
  const place = placeLabelOf(day);
  const unit = section.count > 1 ? 'éléments' : 'élément';

  return (
    <div
      className="group/section absolute left-0 flex w-full flex-col justify-end pb-3"
      style={{ top: section.y, height: section.headerHeight }}
    >
      <div className="flex items-center gap-0.5">
        {/* Le bouton dans le titre, et non l'inverse : `h2` est du contenu de
            flux, qu'un `button` n'a pas le droit de contenir. C'est aussi le
            motif d'accordéon attendu par les lecteurs d'écran. */}
        <h2 className="min-w-0">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!section.collapsed}
            aria-label={`${section.label}, ${section.count} ${unit}`}
            title={section.collapsed ? 'Déplier' : 'Replier'}
            className="-ml-1.5 flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-left transition-colors hover:bg-white/5"
          >
            <svg
              viewBox="0 0 24 24"
              className={`size-4 shrink-0 text-ink-400 transition-transform ${
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
            <span className="truncate text-base font-semibold text-ink-100">{section.label}</span>
            {/* L'unité tombe sous `sm` faute de place ; le nombre, lui, reste —
                c'est lui qui dit ce qu'une section repliée contient. Le nom
                accessible du bouton la porte de toute façon en entier. */}
            <span aria-hidden="true" className="shrink-0 text-xs text-ink-400 tabular-nums">
              {section.count}
              <span className="hidden sm:inline"> {unit}</span>
            </span>
          </button>
        </h2>

        {editable && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title={day?.description || day?.place ? 'Modifier la note' : 'Annoter cette journée'}
            // « la journée du Aujourd'hui » : les libellés relatifs de
            // `dayLabel` ne se laissent pas introduire par un article.
            aria-label={`Annoter la journée « ${section.label} »`}
            // Discret à la souris : un crayon par journée, tous visibles à la
            // fois, transformeraient la grille en formulaire. Mais le masquage
            // est réservé au **pointeur fin**, seul endroit où le survol peut
            // le révéler — en Tailwind v4 `hover:` est déjà borné à
            // `(hover: hover)`, si bien qu'un `opacity-0` sec laissait le
            // crayon définitivement hors d'atteinte au doigt : un
            // administrateur sur téléphone ne pouvait annoter aucune journée.
            className="rounded p-1 text-ink-500 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover/section:opacity-100 hover:bg-white/5 hover:text-ink-200 focus-visible:opacity-100"
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

      {place && (
        <p className="truncate text-sm leading-5 text-ink-300" title={place}>
          {place}
        </p>
      )}

      {day?.description && (
        // `title` porte le texte entier : deux lignes clampées suffisent à se
        // repérer, mais une note tronquée doit rester lisible en entier.
        <p
          className="line-clamp-2 max-w-3xl text-sm leading-5 text-ink-200"
          title={day.description}
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
      // La chaîne vide part en `null` : c'est le seul moyen d'effacer, et le
      // serveur ramène de toute façon les deux au même.
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
      // `absolute` et `z-20` : l'éditeur recouvre les premières vignettes le
      // temps de la saisie, il ne repousse rien.
      className="absolute top-0 left-0 z-20 w-full max-w-lg space-y-2 rounded-xl border border-ink-700 bg-ink-900 p-3 shadow-xl"
    >
      <p className="text-xs text-ink-400">{label}</p>

      <input
        type="text"
        value={place}
        onChange={(event) => setPlace(event.target.value)}
        maxLength={ALBUM_DAY_PLACE_MAX_LENGTH}
        // Le placeholder montre ce que l'EXIF a déduit : on voit exactement ce
        // qu'on remplace en saisissant quelque chose.
        placeholder={day?.autoPlaces.join(' · ') || 'Lieu (facultatif)'}
        aria-label="Lieu"
        autoFocus
        className="w-full rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm outline-none placeholder:text-ink-500 focus:border-accent-dim"
      />

      <textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        maxLength={ALBUM_DAY_DESCRIPTION_MAX_LENGTH}
        rows={2}
        placeholder="Ce qu'on a fait ce jour-là"
        aria-label="Note de la journée"
        className="w-full resize-none rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm outline-none placeholder:text-ink-500 focus:border-accent-dim"
      />

      {update.error && (
        <p role="alert" className="text-xs text-red-300">
          {errorText(update.error, "L'enregistrement a échoué.")}
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
            Annuler
          </button>
          <button
            type="submit"
            disabled={update.isPending}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {update.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </form>
  );
}
