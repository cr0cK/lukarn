import { COMMENT_MAX_LENGTH, type Comment, type CommentThread } from '@gdv/shared';
import { type FormEvent, type ReactElement, useState } from 'react';
import { errorText } from '../api/client';
import { useComments, useCreateComment, useDeleteComment } from '../api/hooks';
import { formatLocalDateTime, formatRelative } from '../lib/format';
import { Spinner } from './Spinner';

/**
 * Contenu de l'onglet « Commentaires » du panneau latéral.
 *
 * Volontairement pauvre en fonctions : un fil, une réponse par fil, la
 * suppression de ses propres messages. Pas d'édition, pas de réactions, pas de
 * mentions — c'est ce qui sépare une conversation sous une photo d'un forum, et
 * ce qui permet de tout lire d'un coup d'œil.
 */
export function CommentsPanel({
  albumId,
  mediaId,
}: {
  albumId: string;
  mediaId: string;
}): ReactElement {
  const { data, isPending, error } = useComments(albumId, mediaId, true);
  const [replyTo, setReplyTo] = useState<number | null>(null);

  if (isPending) {
    return (
      <div className="flex justify-center py-8">
        <Spinner label="Chargement des commentaires" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="px-5 py-4 text-sm text-ink-400">
        {errorText(error, 'Les commentaires n’ont pas pu être chargés.')}
      </p>
    );
  }

  const threads = data?.threads ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-400">
            Aucun commentaire. Sois le premier à en écrire un.
          </p>
        ) : (
          <ul className="divide-y divide-ink-850">
            {threads.map((thread) => (
              <ThreadView
                key={thread.root.id}
                thread={thread}
                albumId={albumId}
                mediaId={mediaId}
                replyTo={replyTo}
                onReplyTo={setReplyTo}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Le formulaire d'ouverture de fil reste en bas, hors de la zone qui
          défile : sur une photo très commentée, il faudrait sinon parcourir
          toute la conversation pour trouver où écrire. */}
      <div className="border-t border-ink-800 px-5 py-4">
        <CommentForm
          albumId={albumId}
          mediaId={mediaId}
          parentId={null}
          placeholder="Écrire un commentaire…"
        />
      </div>
    </div>
  );
}

function ThreadView({
  thread,
  albumId,
  mediaId,
  replyTo,
  onReplyTo,
}: {
  thread: CommentThread;
  albumId: string;
  mediaId: string;
  replyTo: number | null;
  onReplyTo: (id: number | null) => void;
}): ReactElement {
  const open = replyTo === thread.root.id;

  return (
    <li className="px-5 py-4">
      <CommentView
        comment={thread.root}
        albumId={albumId}
        mediaId={mediaId}
        onReply={() => onReplyTo(open ? null : thread.root.id)}
      />

      {thread.replies.length > 0 && (
        <ul className="mt-3 space-y-3 border-l border-ink-800 pl-4">
          {thread.replies.map((reply) => (
            <li key={reply.id}>
              {/* Pas de bouton « Répondre » sur une réponse : le serveur
                  rattacherait le message à la racine, et proposer un geste dont
                  le résultat n'est pas celui qu'on montre serait trompeur. */}
              <CommentView comment={reply} albumId={albumId} mediaId={mediaId} />
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="mt-3 border-l border-ink-800 pl-4">
          <CommentForm
            albumId={albumId}
            mediaId={mediaId}
            parentId={thread.root.id}
            placeholder={`Répondre à ${thread.root.author.displayName}…`}
            autoFocus
            onDone={() => onReplyTo(null)}
          />
        </div>
      )}
    </li>
  );
}

function CommentView({
  comment,
  albumId,
  mediaId,
  onReply,
}: {
  comment: Comment;
  albumId: string;
  mediaId: string;
  onReply?: () => void;
}): ReactElement {
  const remove = useDeleteComment(albumId, mediaId);

  return (
    <article className="group">
      <header className="flex items-baseline gap-2">
        <span className="text-sm font-medium text-ink-100">{comment.author.displayName}</span>
        <time
          dateTime={comment.createdAt}
          title={formatLocalDateTime(comment.createdAt)}
          className="text-xs text-ink-400"
        >
          {formatRelative(comment.createdAt)}
        </time>
      </header>

      {/* `whitespace-pre-wrap` : les retours à la ligne saisis sont conservés,
          sans qu'aucun HTML ne soit interprété — React échappe le texte. */}
      <p className="mt-1 text-sm break-words whitespace-pre-wrap text-ink-200">{comment.body}</p>

      <div className="mt-1.5 flex gap-3 text-xs text-ink-400">
        {onReply && (
          <button type="button" onClick={onReply} className="transition-colors hover:text-ink-100">
            Répondre
          </button>
        )}
        {comment.canDelete && (
          <button
            type="button"
            onClick={() => remove.mutate(comment.id)}
            disabled={remove.isPending}
            // Visible au survol du commentaire seulement : la suppression n'a
            // pas à peser autant que « Répondre » dans la lecture d'un fil.
            className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-red-400 disabled:opacity-50"
          >
            Supprimer
          </button>
        )}
      </div>
    </article>
  );
}

function CommentForm({
  albumId,
  mediaId,
  parentId,
  placeholder,
  autoFocus = false,
  onDone,
}: {
  albumId: string;
  mediaId: string;
  parentId: number | null;
  placeholder: string;
  autoFocus?: boolean;
  onDone?: () => void;
}): ReactElement {
  const [body, setBody] = useState('');
  const create = useCreateComment(albumId, mediaId);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || create.isPending) return;

    create.mutate(
      { body: trimmed, parentId },
      {
        onSuccess: () => {
          setBody('');
          onDone?.();
        },
      },
    );
  };

  return (
    <form onSubmit={submit}>
      <textarea
        value={body}
        autoFocus={autoFocus}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          // Entrée publie, Maj+Entrée passe à la ligne. C'est la convention des
          // messageries, et un commentaire de photo tient presque toujours en
          // une phrase — exiger un clic sur un bouton à chaque fois use.
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit(event);
          }
        }}
        rows={parentId === null ? 2 : 1}
        maxLength={COMMENT_MAX_LENGTH}
        placeholder={placeholder}
        className="w-full resize-none rounded border border-ink-700 bg-ink-850 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-400 focus:border-accent focus:outline-none"
      />

      {create.isError && (
        <p className="mt-1 text-xs text-red-400">
          {errorText(create.error, 'Le commentaire n’a pas pu être publié.')}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-ink-400">Entrée pour publier</span>
        <div className="flex gap-2">
          {onDone && (
            <button
              type="button"
              onClick={onDone}
              className="rounded px-2 py-1 text-xs text-ink-400 transition-colors hover:text-ink-100"
            >
              Annuler
            </button>
          )}
          <button
            type="submit"
            disabled={!body.trim() || create.isPending}
            className="rounded bg-accent px-3 py-1 text-xs font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {create.isPending ? 'Envoi…' : 'Publier'}
          </button>
        </div>
      </div>
    </form>
  );
}
