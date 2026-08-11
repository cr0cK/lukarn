import {
  ALBUM_DAY_DESCRIPTION_MAX_LENGTH,
  ALBUM_DAY_PLACE_MAX_LENGTH,
  type AlbumDay,
} from '@nonni/shared';
import { type FormEvent, type ReactElement, useState } from 'react';
import { errorText } from '../api/client';
import { useUpdateAlbumDay } from '../api/hooks';
import { GRID_HEADER_NOTE_CLASS, placeLabelOf } from '../lib/useGridLayout';
import type { LayoutSection } from '../lib/justify';

/**
 * En-tête d'une section de la grille : la date, le nombre d'éléments, le lieu
 * si les photos le portent, la note si quelqu'un en a écrit une.
 *
 * **Sa hauteur ne se mesure pas ici, elle lui est donnée.** `computeLayout` a
 * déjà placé toutes les photos quand ce composant se monte ; s'il débordait de
 * la boîte que le layout lui a réservée, il passerait sous les vignettes. D'où
 * l'interligne fixé (`leading-5`) : chaque ligne vaut exactement
 * `GRID_HEADER_LINE_HEIGHT`, et c'est l'interligne qui tient le contrat, pas la
 * taille de police, qu'on peut donc remonter sans toucher à la constante.
 *
 * Le lieu tient sur une ligne tronquée ; la note s'étend sur autant de lignes
 * qu'il lui en faut, mais **celles que le layout a comptées** —
 * `descriptionLines` vient de la même mesure que la hauteur réservée, et borne
 * la boîte pour que les deux ne puissent pas diverger (D93).
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
  /** Lignes réservées à la note par le layout. `0` quand il n'y en a pas. */
  descriptionLines: number;
  /** Replie ou déplie cette section. */
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
      // Aligné **en haut** : le titre se cale sur `GRID_HEADER_PAD_TOP` quoi
      // qu'il arrive, et c'est la place restante en bas qui absorbe la
      // variation de hauteur. Aligné en bas, replier une section la raccourcit
      // et fait donc remonter son titre — il sautait de 20 px à chaque clic.
      className="group/section absolute left-0 flex w-full flex-col pt-5"
      style={{ top: section.y, height: section.headerHeight }}
    >
      {/* Hauteur déclarée et centrage simple : cette rangée-ci ne porte que le
          titre et le crayon. L'alignement par ligne de base ne vaut qu'entre le
          titre et son compte, un cran plus bas — appliqué ici, il décalait la
          rangée entière de deux pixels. */}
      <div className="flex h-6 items-center gap-0.5">
        {/* Le bouton dans le titre, et non l'inverse : `h2` est du contenu de
            flux, qu'un `button` n'a pas le droit de contenir. C'est aussi le
            motif d'accordéon attendu par les lecteurs d'écran. */}
        <h2 className="min-w-0">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!section.collapsed}
            aria-label={`${section.label}, ${section.count} ${unit}`}
            title={section.collapsed ? 'Expand' : 'Collapse'}
            // `h-6` explicite : aligner sur la ligne de base décale la boîte du
            // compte (12 px) par rapport à celle du titre (16 px), ce qui
            // grandit la rangée de deux pixels. Sur une section repliée, dont
            // la boîte vaut exactement `PAD_TOP + TITLE_HEIGHT`, ces deux
            // pixels débordent. La hauteur est déclarée, comme tout le reste.
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
            {/* L'unité tombe sous `sm` faute de place ; le nombre, lui, reste —
                c'est lui qui dit ce qu'une section repliée contient. Le nom
                accessible du bouton la porte de toute façon en entier. */}
            {/* `leading-none` : c'est le titre qui donne sa hauteur à la
                rangée. Un interligne de 24 px ici donne au compte une boîte
                aussi haute, que l'alignement sur la ligne de base descend de
                deux pixels — et elle pendait sous l'en-tête. */}
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
            // « la journée du Aujourd'hui » : les libellés relatifs de
            // `dayLabel` ne se laissent pas introduire par un article.
            aria-label={`Annotate ${section.label}`}
            // Discret à la souris : un crayon par journée, tous visibles à la
            // fois, transformeraient la grille en formulaire. Mais le masquage
            // est réservé au **pointeur fin**, seul endroit où le survol peut
            // le révéler — en Tailwind v4 `hover:` est déjà borné à
            // `(hover: hover)`, si bien qu'un `opacity-0` sec laissait le
            // crayon définitivement hors d'atteinte au doigt : un
            // administrateur sur téléphone ne pouvait annoter aucune journée.
            // `self-center` : sans texte, sa ligne de base est son bord bas, et
            // il pendrait sous le titre dans un conteneur `items-baseline`.
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

      {/* `pl-[22px]` = chevron (16) + gouttière (6) : le lieu et la note se calent
          sur le **texte** du titre, pas sur le bord du bouton. Sans ça, les
          trois lignes de l'en-tête partaient de deux abscisses différentes. Le
          chevron reste seul dans sa gouttière, comme la flèche d'une
          arborescence. La note le tient de `GRID_HEADER_NOTE_CLASS`, qui doit
          décrire sa géométrie entière pour que la sonde mesure la bonne. */}
      {place && (
        <p className="truncate pl-[22px] text-sm leading-5 text-ink-300" title={place}>
          {place}
        </p>
      )}

      {day?.description && (
        <p
          className={`${GRID_HEADER_NOTE_CLASS} text-ink-200`}
          // Le nombre de lignes est mesuré, pas estimé : la boîte devrait tomber
          // juste sans qu'on la borne. Le `line-clamp` est là pour le jour où
          // elle ne tomberait pas juste — une ellipse coûte moins cher que des
          // vignettes recouvertes, et c'est le seul rattrapage possible dans un
          // layout calculé sans DOM.
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
