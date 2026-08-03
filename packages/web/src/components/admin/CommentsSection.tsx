import type { AdminComment, ModerationFilter } from '@gdv/shared';
import { type ReactElement, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorText } from '../../api/client';
import { useAdminComments, useModerateComment } from '../../api/hooks';
import { formatLocalDateTime, formatRelative } from '../../lib/format';
import { Spinner } from '../Spinner';
import { Button, FormError, Section, type Notify } from './ui';

/**
 * Modération des commentaires, a posteriori.
 *
 * Masquer plutôt que supprimer : un commentaire retiré par erreur se rétablit,
 * et l'administrateur n'a pas à trancher définitivement dans l'instant. La
 * suppression reste possible depuis la galerie, où l'on voit la photo.
 */
export function CommentsSection({ notify }: { notify: Notify }): ReactElement {
  const [filter, setFilter] = useState<ModerationFilter>('all');
  const { data, isPending, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useAdminComments(filter);

  const comments = data?.pages.flatMap((page) => page.comments) ?? [];

  return (
    <Section
      title="Commentaires"
      description="Les commentaires masqués disparaissent de la galerie pour tout le monde, leur auteur compris."
      action={
        <div className="flex gap-1 rounded-lg border border-ink-700 p-0.5">
          <FilterTab active={filter === 'all'} onClick={() => setFilter('all')}>
            Tous
          </FilterTab>
          <FilterTab active={filter === 'hidden'} onClick={() => setFilter('hidden')}>
            Masqués
          </FilterTab>
        </div>
      }
    >
      {isPending ? (
        <div className="flex justify-center py-8">
          <Spinner label="Chargement des commentaires" />
        </div>
      ) : error ? (
        <div className="px-4 py-4">
          <FormError message={errorText(error, 'Les commentaires n’ont pas pu être chargés.')} />
        </div>
      ) : comments.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-400">
          {filter === 'hidden' ? 'Aucun commentaire masqué.' : 'Aucun commentaire pour l’instant.'}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-ink-850">
            {comments.map((comment) => (
              <CommentRow key={comment.id} comment={comment} notify={notify} />
            ))}
          </ul>

          {hasNextPage && (
            <div className="flex justify-center border-t border-ink-850 px-4 py-3">
              <Button onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
                {isFetchingNextPage ? 'Chargement…' : 'Charger plus'}
              </Button>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function CommentRow({ comment, notify }: { comment: AdminComment; notify: Notify }): ReactElement {
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
    <li className={`px-4 py-3 ${hidden ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-ink-400">
        <span className="text-sm font-medium text-ink-100">{comment.author.displayName}</span>
        {/* L'adresse vérifiée n'apparaît que dans la modération : elle dit qui
            parle derrière un nom déclaré, ce que le fil n'a pas à révéler. */}
        <span className="text-ink-400">{comment.authorEmail}</span>
        <time dateTime={comment.createdAt} title={formatLocalDateTime(comment.createdAt)}>
          {formatRelative(comment.createdAt)}
        </time>
        {comment.parentId !== null && <span>· en réponse</span>}
        {hidden && (
          <span className="rounded bg-ink-700 px-1.5 py-0.5 text-ink-200">
            masqué{comment.hiddenBy ? ` par ${comment.hiddenBy}` : ''}
          </span>
        )}
      </div>

      <p className="mt-1 text-sm break-words whitespace-pre-wrap text-ink-200">{comment.body}</p>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-xs text-ink-400">
          {/* Lien vers la photo commentée : modérer sans voir l'image qui a
              suscité le message revient à juger un propos hors contexte. Le
              média peut avoir disparu de l'index — le lien n'est alors pas rendu. */}
          {comment.mediaName ? (
            <Link
              to={`/album/${encodeURIComponent(comment.albumId)}?photo=${encodeURIComponent(comment.mediaId)}`}
              className="text-accent underline-offset-2 hover:underline"
            >
              {comment.mediaName}
            </Link>
          ) : (
            <span className="italic">photo retirée de l’index</span>
          )}
          <span> — {comment.albumTitle}</span>
          {/* La clé d'accès employée pour écrire : c'est elle qu'on change quand
              un mot de passe partagé a trop circulé. */}
          {comment.account && <span> · via {comment.account}</span>}
        </p>

        <Button
          onClick={toggle}
          disabled={moderate.isPending}
          variant={hidden ? 'default' : 'danger'}
        >
          {hidden ? 'Rendre visible' : 'Masquer'}
        </Button>
      </div>
    </li>
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
