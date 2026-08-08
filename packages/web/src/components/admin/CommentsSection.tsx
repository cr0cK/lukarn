import type { AdminAlbum, AdminComment, ModerationFilter } from '@gdv/shared';
import { type ReactElement, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorText } from '../../api/client';
import {
  useAdminAlbums,
  useAdminComments,
  useModerateComment,
  useModerateCommenter,
} from '../../api/hooks';
import { formatLocalDateTime, formatRelative } from '../../lib/format';
import { groupByDayAndPhoto, type PhotoGroup } from '../../lib/commentGroups';
import { Spinner } from '../Spinner';
import { ConfirmDialog } from './ConfirmDialog';
import { Button, FormError, ROW_ACTIONS_CLASS, ROW_CLASS, Section, type Notify } from './ui';

/**
 * Une page tient dans un écran une fois les journées et les photos regroupées.
 * Cinquante lignes — le défaut du serveur — en faisaient de nouveau une liste
 * qu'on fait défiler sans en voir la fin.
 */
const PAGE_SIZE = 25;

/** Une frappe ne vaut pas une requête : on attend que la saisie se pose. */
const SEARCH_DELAY_MS = 300;

const FILTER_LABELS: Record<ModerationFilter, string> = {
  all: 'Tous',
  visible: 'Visibles',
  hidden: 'Masqués',
};

/**
 * File de modération : une liste de travail, pas un flux (D67).
 *
 * Masquer plutôt que supprimer : un commentaire retiré par erreur se rétablit,
 * et l'administrateur n'a pas à trancher définitivement dans l'instant. La
 * suppression reste possible depuis la galerie, où l'on voit la photo.
 */
export function CommentsSection({ notify }: { notify: Notify }): ReactElement {
  const [filter, setFilter] = useState<ModerationFilter>('all');
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const q = useDeferredSearch(search);

  // Une pile plutôt qu'un numéro de page : la pagination est par curseur, et
  // seul le chemin parcouru permet de revenir en arrière. `null` est la
  // première page.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors.at(-1)!;

  const [bulkTarget, setBulkTarget] = useState<AdminComment | null>(null);

  // Changer de filtre invalide le chemin : la page 4 d'une recherche n'a rien à
  // voir avec la page 4 de la suivante.
  useEffect(() => setCursors([null]), [filter, albumId, q]);

  const albums = useAdminAlbums();
  const { data, isPending, error, isFetching } = useAdminComments({
    filter,
    albumId,
    q,
    limit: PAGE_SIZE,
    cursor,
  });

  const days = groupByDayAndPhoto(data?.comments ?? []);
  const first = (cursors.length - 1) * PAGE_SIZE + 1;
  const last = first + (data?.comments.length ?? 0) - 1;

  return (
    <Section
      title="Commentaires"
      description="Les commentaires masqués disparaissent de la galerie pour tout le monde, leur auteur compris."
    >
      {/* La barre de filtres est dans le corps et non dans l'en-tête de section :
          trois onglets, un sélecteur d'album et un champ de recherche ne tiennent
          pas à côté d'un titre. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-850 px-4 py-3">
        <div className="flex gap-1 rounded-lg border border-ink-700 p-0.5">
          {(Object.keys(FILTER_LABELS) as ModerationFilter[]).map((value) => (
            <FilterTab key={value} active={filter === value} onClick={() => setFilter(value)}>
              {FILTER_LABELS[value]}
            </FilterTab>
          ))}
        </div>

        <AlbumFilter albums={albums.data} value={albumId} onChange={setAlbumId} />

        {/* `basis-64` décide de son passage à la ligne : `flex-1` seul le laissait
            prendre ce qui restait après les onglets et le sélecteur, soit une
            trentaine de pixels sur une tablette — un champ où l'on ne voit pas
            ce qu'on tape. En annonçant 16 rem, il descend d'une ligne quand
            elles ne tiennent pas, puis s'étire. */}
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Rechercher un mot, un nom, une adresse"
          aria-label="Rechercher dans les commentaires"
          maxLength={200}
          className="min-w-0 flex-1 basis-64 rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm outline-none placeholder:text-ink-500 focus:border-accent-dim"
        />
      </div>

      {isPending ? (
        <div className="flex justify-center py-8">
          <Spinner label="Chargement des commentaires" />
        </div>
      ) : error ? (
        <div className="px-4 py-4">
          <FormError message={errorText(error, 'Les commentaires n’ont pas pu être chargés.')} />
        </div>
      ) : days.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-400">{emptyMessage(filter, q, albumId)}</p>
      ) : (
        <>
          {/* `isFetching` sans `isPending` : une page déjà affichée reste à
              l'écran pendant que la suivante arrive, simplement estompée. */}
          <div className={isFetching ? 'opacity-60 transition-opacity' : undefined}>
            {days.map((day) => (
              <section key={day.key}>
                <h3 className="border-b border-ink-850 bg-ink-900/40 px-4 py-1.5 text-xs font-medium text-ink-300">
                  {day.label}
                </h3>
                {day.photos.map((photo) => (
                  <PhotoBlock
                    key={photo.key}
                    photo={photo}
                    notify={notify}
                    onBulk={setBulkTarget}
                  />
                ))}
              </section>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-850 px-4 py-3">
            <Button
              onClick={() => setCursors(cursors.slice(0, -1))}
              disabled={cursors.length === 1}
            >
              ‹ Précédent
            </Button>

            <p className="text-xs text-ink-400">
              {first}–{last} sur {data.total}
            </p>

            <Button
              onClick={() => setCursors([...cursors, data.nextCursor])}
              disabled={data.nextCursor === null}
            >
              Suivant ›
            </Button>
          </div>
        </>
      )}

      {bulkTarget && (
        <BulkDialog
          comment={bulkTarget}
          restore={filter === 'hidden'}
          notify={notify}
          onClose={() => setBulkTarget(null)}
        />
      )}
    </Section>
  );
}

/**
 * Le texte d'une file vide dit quoi faire ensuite, et ce n'est pas le même geste
 * selon qu'on n'a rien reçu ou qu'on cherche mal.
 */
function emptyMessage(filter: ModerationFilter, q: string | null, albumId: string | null): string {
  if (q) return `Aucun commentaire ne correspond à « ${q} ».`;
  if (albumId) return 'Aucun commentaire dans cet album.';
  if (filter === 'hidden') return 'Aucun commentaire masqué.';
  if (filter === 'visible') return 'Aucun commentaire visible.';
  return 'Aucun commentaire pour l’instant.';
}

/** Reporte la recherche : sans ce délai, chaque frappe partirait au serveur. */
function useDeferredSearch(search: string): string | null {
  const [deferred, setDeferred] = useState(search);

  useEffect(() => {
    const timer = setTimeout(() => setDeferred(search), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  return deferred.trim() || null;
}

/**
 * Sélecteur d'album de la file.
 *
 * Un `<select>` en clair plutôt qu'une primitive de `ui.tsx` : c'est le seul de
 * l'application, et en extraire une pour un usage unique serait spéculatif. La
 * file ne l'attend pas — elle s'affiche pendant que la liste des albums charge,
 * et le sélecteur se remplit quand elle arrive.
 */
function AlbumFilter({
  albums,
  value,
  onChange,
}: {
  albums: AdminAlbum[] | undefined;
  value: string | null;
  onChange: (albumId: string | null) => void;
}): ReactElement {
  return (
    // `min-w-0` : un `select` réclame la largeur de sa plus longue option, et
    // un titre d'album de soixante caractères le faisait dépasser du cadre de la
    // section sur un téléphone. Il occupe donc sa propre ligne en dessous de
    // `sm`, et reste borné au-delà.
    <select
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
      aria-label="Filtrer par album"
      className="w-full min-w-0 truncate rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-sm text-ink-200 outline-none focus:border-accent-dim sm:w-auto sm:max-w-64"
    >
      <option value="">Tous les albums</option>
      {albums?.map((album) => (
        <option key={album.id} value={album.id}>
          {album.title}
        </option>
      ))}
    </select>
  );
}

/**
 * Les commentaires d'une même photo, sous un seul en-tête.
 *
 * Répéter « IMG_0043 — Vacances 2025 » sous chacun des six messages d'un fil
 * noie la seule information qui change d'une ligne à l'autre : ce qui est écrit,
 * et par qui.
 */
function PhotoBlock({
  photo,
  notify,
  onBulk,
}: {
  photo: PhotoGroup<AdminComment>;
  notify: Notify;
  onBulk: (comment: AdminComment) => void;
}): ReactElement {
  return (
    <div className="border-b border-ink-850 px-4 py-3 last:border-b-0">
      <p className="min-w-0 text-xs text-ink-400">
        {/* Lien vers la photo commentée : modérer sans voir l'image qui a
            suscité le message revient à juger un propos hors contexte. Le
            média peut avoir disparu de l'index — le lien n'est alors pas rendu. */}
        {photo.mediaName ? (
          <Link
            to={`/album/${encodeURIComponent(photo.albumId)}?photo=${encodeURIComponent(photo.mediaId)}`}
            className="text-accent underline-offset-2 hover:underline"
          >
            {photo.mediaName}
          </Link>
        ) : (
          <span className="italic">photo retirée de l’index</span>
        )}
        <span> — {photo.albumTitle}</span>
      </p>

      <ul className="mt-1 divide-y divide-ink-850/60">
        {photo.comments.map((comment) => (
          <CommentRow key={comment.id} comment={comment} notify={notify} onBulk={onBulk} />
        ))}
      </ul>
    </div>
  );
}

function CommentRow({
  comment,
  notify,
  onBulk,
}: {
  comment: AdminComment;
  notify: Notify;
  onBulk: (comment: AdminComment) => void;
}): ReactElement {
  const moderate = useModerateComment();
  const hidden = comment.hiddenAt !== null;

  const toggle = (): void => {
    moderate.mutate(
      { commentId: comment.id, hide: !hidden },
      {
        onSuccess: () =>
          notify({
            tone: 'ok',
            text: hidden ? 'Commentaire rendu visible.' : 'Commentaire masqué.',
          }),
        onError: (error) =>
          notify({ tone: 'error', text: errorText(error, 'La modération a échoué.') }),
      },
    );
  };

  return (
    <li className={`py-2 ${hidden ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-ink-400">
        <span className="text-sm font-medium text-ink-100">{comment.author.displayName}</span>
        {/* L'adresse vérifiée n'apparaît que dans la modération : elle dit qui
            parle derrière un nom déclaré, ce que le fil n'a pas à révéler. Elle
            porte l'action groupée, parce que c'est elle qu'on regarde en se
            demandant « d'où vient tout ça ». */}
        <button
          type="button"
          onClick={() => onBulk(comment)}
          className="rounded text-ink-400 underline decoration-dotted underline-offset-2 transition-colors hover:text-ink-100"
          title={`Modérer tous les messages de ${comment.authorEmail}`}
        >
          {comment.authorEmail}
        </button>
        <time dateTime={comment.createdAt} title={formatLocalDateTime(comment.createdAt)}>
          {formatRelative(comment.createdAt)}
        </time>
        {comment.parentId !== null && <span>· en réponse</span>}
        {/* La clé d'accès employée pour écrire : c'est elle qu'on change quand
            un mot de passe partagé a trop circulé. */}
        {comment.account && <span>· via {comment.account}</span>}
        {hidden && (
          <span className="rounded bg-ink-700 px-1.5 py-0.5 text-ink-200">
            masqué{comment.hiddenBy ? ` par ${comment.hiddenBy}` : ''}
          </span>
        )}
      </div>

      {/* `sm:items-start` et non `sm:items-center` : un message de plusieurs
          lignes centrerait son bouton à mi-hauteur, loin de la ligne qu'on
          vient de lire. */}
      <div className={`${ROW_CLASS} mt-1 xl:items-start`}>
        <p className="min-w-0 flex-1 text-sm break-words whitespace-pre-wrap text-ink-200">
          {comment.body}
        </p>

        <div className={ROW_ACTIONS_CLASS}>
          <Button
            onClick={toggle}
            disabled={moderate.isPending}
            variant={hidden ? 'default' : 'danger'}
          >
            {hidden ? 'Rendre visible' : 'Masquer'}
          </Button>
        </div>
      </div>
    </li>
  );
}

/**
 * Confirmation d'une modération groupée.
 *
 * Monté par la section et non par la ligne : un commentaire masqué porte
 * `opacity-60`, qui teinte tout son sous-arbre et lui ouvre un contexte
 * d'empilement — une modale rendue là s'afficherait à 60 % et passerait sous le
 * reste de la page.
 *
 * **Le sens vient de l'onglet, pas de la ligne cliquée.** Adossé à l'état du
 * commentaire, la même adresse proposerait de masquer sur une ligne et de
 * démasquer sur la suivante.
 */
function BulkDialog({
  comment,
  restore,
  notify,
  onClose,
}: {
  comment: AdminComment;
  restore: boolean;
  notify: Notify;
  onClose: () => void;
}): ReactElement {
  const moderate = useModerateCommenter();

  const confirm = (): void => {
    moderate.mutate(
      { commenterId: comment.commenterId, hide: !restore },
      {
        onSuccess: ({ affected }) => {
          const accord = affected > 1 ? 's' : '';
          notify({
            tone: 'ok',
            text: `${affected} message${accord} ${restore ? 'rendu' : 'masqué'}${accord}.`,
          });
          onClose();
        },
        onError: (error) => {
          notify({ tone: 'error', text: errorText(error, 'La modération groupée a échoué.') });
          onClose();
        },
      },
    );
  };

  return (
    <ConfirmDialog
      title={
        restore
          ? `Rendre visibles tous les messages de ${comment.authorEmail} ?`
          : `Masquer tous les messages de ${comment.authorEmail} ?`
      }
      confirmLabel={restore ? 'Tout rendre visible' : 'Tout masquer'}
      busy={moderate.isPending}
      onConfirm={confirm}
      onCancel={onClose}
    >
      <p>
        L’action porte sur <strong>tous les albums</strong>, pas seulement sur celui-ci ni sur la
        page affichée.
      </p>
      <p>
        {restore
          ? 'Ses messages redeviennent lisibles pour tout le monde.'
          : 'Réversible : l’onglet « Masqués » permet de tout rétablir d’un coup.'}
      </p>
    </ConfirmDialog>
  );
}

function FilterTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
        active ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-200'
      }`}
    >
      {children}
    </button>
  );
}
