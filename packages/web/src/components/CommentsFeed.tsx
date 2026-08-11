import type { FeedComment } from '@nonni/shared';
import { type ReactElement, type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorText, mediaUrl } from '../api/client';
import { useCommentsFeed } from '../api/hooks';
import { groupByDayAndPhoto, type PhotoGroup } from '../lib/commentGroups';
import { emojify } from '../lib/emoji';
import { formatLocalDateTime, formatRelative } from '../lib/format';
import { unreadFeedCount, useSeenFeed } from '../lib/seenComments';
import { Spinner } from './Spinner';

/** Portée du tiroir : tout ce qu'on a le droit de voir, ou le seul album ouvert. */
type Scope = 'all' | 'album';

export interface ActivityFeed {
  /** Messages arrivés depuis le dernier passage, plafonnage d'affichage exclu. */
  unread: number;
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

/**
 * Ce que les pages de la galerie branchent sur leur barre supérieure : la
 * pastille, et l'ouverture du tiroir.
 *
 * La portée du décompte est **toujours** la globale, y compris depuis un album.
 * La pastille répond à « y a-t-il du nouveau quelque part » — la restreindre à
 * l'album ouvert la ferait s'éteindre en changeant de page, sans que rien n'ait
 * été lu.
 */
export function useActivityFeed(): ActivityFeed {
  const [isOpen, setIsOpen] = useState(false);
  const { comments, isSuccess } = useCommentsFeed(null);
  const { seenId, markFeedSeen } = useSeenFeed();

  const newest = comments[0]?.id ?? 0;
  const unread = unreadFeedCount(
    comments.map((comment) => comment.id),
    seenId,
  );

  useEffect(() => {
    // Rien tant que la première page n'est pas là : le fil vaut alors zéro, et
    // marquer ici effacerait le repère pour le reconstituer faux à l'arrivée
    // des vrais identifiants. Même piège que la pastille de la visionneuse.
    if (!isSuccess) return;

    // Le tiroir ouvert vaut lecture. Et un fil dont la tête est passée **sous**
    // le repère — suppression, masquage — doit le faire redescendre, sinon le
    // message suivant resterait invisible jusqu'à combler l'écart.
    if (isOpen || newest < seenId) markFeedSeen(newest);
  }, [isOpen, isSuccess, newest, seenId, markFeedSeen]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return { unread, isOpen, open, close };
}

/**
 * Tiroir d'activité : les derniers commentaires, toutes photos et tous albums
 * confondus.
 *
 * **Il existe parce qu'une conversation ne se découvre pas.** La pastille d'une
 * photo suppose qu'on ait déjà ouvert la bonne, et sur un album de milliers de
 * vues dont dix portent un message, personne ne tombe dessus. Un message écrit
 * sans lecteur est un message perdu — le tiroir est le seul endroit d'où l'on
 * voit qu'il a été écrit.
 *
 * Le rangement — journée, puis photo — est celui de la file de modération,
 * `lib/commentGroups.ts`, et pour les mêmes raisons : la date n'a pas à figurer
 * sur chaque ligne, ni le couple album / photo sous chaque message d'un même
 * fil.
 */
export function CommentsFeed({
  albumId,
  albumTitle,
  onClose,
}: {
  /** Album ouvert, `null` depuis la liste des albums : la bascule n'a alors pas lieu d'être. */
  albumId: string | null;
  albumTitle: string | null;
  onClose: () => void;
}): ReactElement {
  // La portée globale par défaut, y compris dans un album. C'est ce que la
  // pastille compte, et ouvrir sur une liste plus étroite que ce qu'elle
  // annonce ferait chercher des messages qui ne s'y trouvent pas.
  const [scope, setScope] = useState<Scope>('all');
  const active = scope === 'album' ? albumId : null;

  const { comments, isPending, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useCommentsFeed(active);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const days = groupByDayAndPhoto(comments);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Recent activity"
      className="fixed inset-0 z-40 flex justify-end bg-black/60"
      onClick={onClose}
    >
      <aside
        // Pleine largeur sur téléphone, colonne à partir de `sm` : 384 px
        // prélevés sur un écran de 393 ne laisseraient rien de la grille
        // derrière, et le tiroir vaudrait alors une page.
        className="flex h-full w-full flex-col border-l border-ink-700 bg-ink-850 sm:w-96"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-ink-800 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-ink-100">Recent activity</h2>
            <p className="mt-0.5 text-xs text-ink-400">
              Les derniers messages, toutes photos confondues.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-ink-400 transition-colors hover:text-ink-100"
            aria-label="Close activity (Esc)"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* La bascule n'apparaît que dans un album : ailleurs, « cet album » ne
            désigne rien. */}
        {albumId && (
          <div className="flex gap-1 border-b border-ink-800 px-5 py-2.5">
            <ScopeTab active={scope === 'all'} onSelect={() => setScope('all')}>
              Every album
            </ScopeTab>
            <ScopeTab active={scope === 'album'} onSelect={() => setScope('album')}>
              {albumTitle ?? 'Cet album'}
            </ScopeTab>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isPending && (
            <div className="flex justify-center py-8">
              <Spinner label="Loading activity" />
            </div>
          )}

          {error && (
            <p role="alert" className="px-5 py-4 text-sm text-ink-400">
              {errorText(error, 'Activity could not be loaded.')}
            </p>
          )}

          {!isPending && !error && days.length === 0 && (
            <p className="px-5 py-6 text-sm text-ink-400">
              No comments yet. Open a photo to write the first one.
            </p>
          )}

          {days.map((day) => (
            <section key={day.key}>
              <h3 className="sticky top-0 border-b border-ink-800 bg-ink-850/95 px-5 py-1.5 text-xs font-medium text-ink-300 backdrop-blur-sm">
                {day.label}
              </h3>
              {day.photos.map((photo) => (
                <PhotoBlock
                  key={photo.key}
                  photo={photo}
                  // Filtré sur un album, le rappeler sous chaque photo répète ce
                  // que la bascule affiche déjà en haut du tiroir.
                  showAlbum={scope === 'all'}
                  onNavigate={onClose}
                />
              ))}
            </section>
          ))}

          {hasNextPage && (
            <div className="px-5 py-4">
              {/* Un bouton et non un défilement infini : le tiroir sert à voir
                  ce qui vient d'arriver, pas à remonter une archive, et un
                  observateur de défilement chargerait des pages entières sous
                  un pouce qui ne fait que parcourir. */}
              <button
                type="button"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
                className="w-full rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-300 transition-colors hover:bg-white/5 hover:text-ink-100 disabled:opacity-60"
              >
                {isFetchingNextPage ? 'Loading…' : 'Older messages'}
              </button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function ScopeTab({
  active,
  onSelect,
  children,
}: {
  active: boolean;
  onSelect: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`min-w-0 truncate rounded-lg px-2.5 py-1 text-xs transition-colors ${
        active ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:bg-white/5 hover:text-ink-200'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Une photo et les messages écrits dessous.
 *
 * Le bloc entier est un lien vers la photo, **panneau des commentaires ouvert** :
 * arriver sur l'image sans la conversation obligerait à la rouvrir à la main, et
 * c'est précisément ce détour que ce tiroir existe pour supprimer.
 */
function PhotoBlock({
  photo,
  showAlbum,
  onNavigate,
}: {
  photo: PhotoGroup<FeedComment>;
  showAlbum: boolean;
  onNavigate: () => void;
}): ReactElement {
  // La version vient du premier message : tous ceux d'un même groupe désignent
  // la même photo, donc la même empreinte.
  const version = photo.comments[0]?.mediaVersion ?? null;
  const target = `/album/${encodeURIComponent(photo.albumId)}?photo=${encodeURIComponent(photo.mediaId)}&panel=comments`;

  return (
    <article className="border-b border-ink-800 px-5 py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        {/* La vignette d'abord : c'est elle qui fait reconnaître la
            conversation, bien avant le nom du fichier. Une photo retirée de
            l'index n'en a plus, et le bloc n'est alors plus cliquable — le lien
            mènerait à une visionneuse qui se refermerait aussitôt. */}
        {photo.mediaName ? (
          <Link
            to={target}
            onClick={onNavigate}
            className="group shrink-0"
            aria-label={`View ${photo.mediaName} in ${photo.albumTitle}`}
          >
            <img
              src={mediaUrl.thumb(photo.mediaId, 320, version)}
              alt=""
              loading="lazy"
              decoding="async"
              className="size-14 rounded-lg bg-ink-800 object-cover transition-opacity group-hover:opacity-80"
            />
          </Link>
        ) : (
          <div className="size-14 shrink-0 rounded-lg bg-ink-800" aria-hidden="true" />
        )}

        <div className="min-w-0 flex-1">
          <p className="min-w-0 truncate text-xs text-ink-400">
            {photo.mediaName ? (
              <Link
                to={target}
                onClick={onNavigate}
                className="text-accent underline-offset-2 hover:underline"
              >
                {photo.mediaName}
              </Link>
            ) : (
              <span className="italic">photo removed from the index</span>
            )}
            {showAlbum && <span> · {photo.albumTitle}</span>}
          </p>

          {/* Chronologique **à l'intérieur** du bloc, alors que la liste des
              blocs reste antéchronologique — c'est là que le tiroir s'écarte de
              la file de modération, qui triage du plus récent au plus ancien de
              bout en bout. Ici on lit une conversation : la réponse au-dessus
              de la question se lit à l'envers. La place du bloc dans la
              journée, elle, se décide toujours sur son message le plus récent. */}
          <ul className="mt-1.5 space-y-1.5">
            {[...photo.comments].reverse().map((comment) => (
              <li key={comment.id}>
                <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-400">
                  <span className="text-sm font-medium text-ink-100">
                    {comment.author.displayName}
                  </span>
                  <time dateTime={comment.createdAt} title={formatLocalDateTime(comment.createdAt)}>
                    {formatRelative(comment.createdAt)}
                  </time>
                  {comment.parentId !== null && <span>· in reply</span>}
                </p>
                {/* Trois lignes au plus : le tiroir est un survol de ce qui a
                    été dit, pas la conversation — celle-ci s'ouvre sous la
                    photo, avec de quoi y répondre. `emojify` rend du texte pur,
                    jamais une balise. */}
                <p className="mt-0.5 line-clamp-3 text-sm break-words whitespace-pre-wrap text-ink-200">
                  {emojify(comment.body)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  );
}
