import {
  COMMENT_MAX_LENGTH,
  remainingEditMs,
  type Comment,
  type CommentThread,
} from '@nonni/shared';
import { type FormEvent, type ReactElement, useEffect, useRef, useState } from 'react';
import { errorText } from '../api/client';
import {
  useComments,
  useCreateComment,
  useDeleteComment,
  useMe,
  useUpdateComment,
} from '../api/hooks';
import { PICKER_EMOJI, emojify, insertEmoji } from '../lib/emoji';
import { formatLocalDateTime, formatRelative } from '../lib/format';
import { IdentityForm } from './IdentityForm';
import { Spinner } from './Spinner';

/**
 * Contents of the side panel's "Comments" tab.
 *
 * Deliberately limited: one thread, one reply per thread, deletion of one's own
 * messages and correction of a typo within thirty seconds. No unrestricted
 * editing, reactions or mentions — that separates a conversation beneath a
 * photo from a forum and keeps everything readable at a glance.
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
        <Spinner label="Loading comments" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="px-5 py-4 text-sm text-ink-400">
        {errorText(error, 'Comments could not be loaded.')}
      </p>
    );
  }

  const threads = data?.threads ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-400">No comments. Be the first to write one.</p>
        ) : (
          <ul className="divide-y divide-ink-800">
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

      {/* Keep the new-thread form at the bottom, outside the scrolling area:
          otherwise a heavily commented photo would require scrolling through
          the entire conversation to find where to write.

          The bottom margin adds to the device inset: from the home screen, the
          application occupies the full height and the input would otherwise
          fall beneath the iPhone home bar. */}
      <div className="border-t border-ink-800 px-5 pt-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))]">
        <Composer albumId={albumId} mediaId={mediaId} />
      </div>
    </div>
  );
}

/**
 * What occupies the bottom of the panel: the input, the invitation to identify,
 * or the explanation for a gallery without an outbound mail server.
 *
 * Identity is requested **here**, when someone wants to write — not at sign-in.
 * This is the only time providing an address has an obvious purpose for the
 * person being asked.
 */
function Composer({ albumId, mediaId }: { albumId: string; mediaId: string }): ReactElement {
  const { data: me } = useMe();
  const [identifying, setIdentifying] = useState(false);

  if (me?.identity && !identifying) {
    return (
      <>
        <CommentForm
          albumId={albumId}
          mediaId={mediaId}
          parentId={null}
          placeholder={`Comment as ${me.identity.displayName}…`}
        />
        <p className="mt-2 text-xs text-ink-400">
          You're commenting as <span className="text-ink-200">{me.identity.displayName}</span>.{' '}
          <button
            type="button"
            onClick={() => setIdentifying(true)}
            className="underline underline-offset-2 transition-colors hover:text-ink-100"
          >
            Change address
          </button>
        </p>
      </>
    );
  }

  // Without an SMTP server, no code can be sent: explaining that is better than
  // offering a form that fails at the final step.
  if (me && !me.commentsEnabled) {
    return (
      <p className="text-sm text-ink-400">
        Comments are unavailable: this gallery has no mail server configured.
      </p>
    );
  }

  if (identifying) return <IdentityForm onDone={() => setIdentifying(false)} />;

  return (
    <button
      type="button"
      onClick={() => setIdentifying(true)}
      className="w-full rounded border border-ink-700 px-3 py-2 text-sm text-ink-300 transition-colors hover:border-ink-600 hover:text-ink-100"
    >
      Sign in to comment
    </button>
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
  const { data: me } = useMe();
  // Without a verified identity, the server would reject the reply: offering
  // the button would lead straight to an error message.
  const canReply = Boolean(me?.identity);
  const open = replyTo === thread.root.id;

  return (
    <li className="px-5 py-4">
      <CommentView
        comment={thread.root}
        albumId={albumId}
        mediaId={mediaId}
        onReply={canReply ? () => onReplyTo(open ? null : thread.root.id) : undefined}
      />

      {thread.replies.length > 0 && (
        <ul className="mt-3 space-y-3 border-l border-ink-800 pl-4">
          {thread.replies.map((reply) => (
            <li key={reply.id}>
              {/* No "Reply" button on a reply: the server would attach the
                  message to the root, and offering an action whose result does
                  not match what is shown would be misleading. */}
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
            placeholder={`Reply to ${thread.root.author.displayName}…`}
            autoFocus
            onDone={() => onReplyTo(null)}
          />
        </div>
      )}
    </li>
  );
}

/**
 * Seconds remaining to correct this comment, `null` once there is nothing left
 * to offer.
 *
 * `canEdit` alone is insufficient: it says what the server thought **when it
 * responded**, and a thread left open would still carry `true` an hour later.
 * Recompute the countdown here from `createdAt`, using the same function as the
 * server.
 */
function useEditWindow(comment: Comment): number | null {
  const [remaining, setRemaining] = useState(() =>
    comment.canEdit ? remainingEditMs(comment.createdAt, Date.now()) : 0,
  );

  useEffect(() => {
    if (!comment.canEdit) return;
    // One render per second, for one comment at a time and for thirty seconds:
    // the cost of a button that announces its disappearance instead of
    // surprising. The interval stops itself at the deadline.
    const timer = setInterval(() => {
      const left = remainingEditMs(comment.createdAt, Date.now());
      setRemaining(left);
      if (left <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [comment.canEdit, comment.createdAt]);

  if (!comment.canEdit || remaining <= 0) return null;
  return Math.ceil(remaining / 1000);
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
  const update = useUpdateComment(albumId, mediaId);
  const [editing, setEditing] = useState(false);
  const secondsLeft = useEditWindow(comment);

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

      {editing ? (
        <EditForm
          // Use entered text, not rendered text: correcting ":)" must not replace
          // the shortcut with the emoji in stored content.
          initial={comment.body}
          pending={update.isPending}
          error={
            update.isError ? errorText(update.error, 'The correction could not be saved.') : null
          }
          onCancel={() => {
            update.reset();
            setEditing(false);
          }}
          onSubmit={(body) =>
            update.mutate({ commentId: comment.id, body }, { onSuccess: () => setEditing(false) })
          }
        />
      ) : (
        /* `whitespace-pre-wrap`: preserve entered line breaks without interpreting
           HTML — React escapes the text. `emojify` returns plain text, so the
           guarantee still holds. */
        <p className="mt-1 text-sm break-words whitespace-pre-wrap text-ink-200">
          {emojify(comment.body)}
        </p>
      )}

      <div className="mt-1.5 flex gap-3 text-xs text-ink-400">
        {onReply && !editing && (
          <button type="button" onClick={onReply} className="transition-colors hover:text-ink-100">
            Reply
          </button>
        )}
        {secondsLeft !== null && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Fix a typo, within thirty seconds of posting"
            className="tabular-nums transition-colors hover:text-ink-100"
          >
            Edit ({secondsLeft} s)
          </button>
        )}
        {comment.canDelete && !editing && (
          <button
            type="button"
            onClick={() => remove.mutate(comment.id)}
            disabled={remove.isPending}
            // Show only while hovering the comment: deletion should not carry as
            // much visual weight as "Reply" while reading a thread.
            className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-red-400 disabled:opacity-50"
          >
            Delete
          </button>
        )}
      </div>
    </article>
  );
}

/**
 * In-place correction of a published comment.
 *
 * The form **stays open** if the window closes while typing: the server decides,
 * and its refusal appears here. Closing it forcibly would discard text being
 * entered without warning.
 */
function EditForm({
  initial,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  initial: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (body: string) => void;
}): ReactElement {
  const [body, setBody] = useState(initial);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || pending) return;
    onSubmit(trimmed);
  };

  return (
    <form onSubmit={submit} className="mt-1">
      <textarea
        value={body}
        autoFocus
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit(event);
          }
        }}
        rows={2}
        maxLength={COMMENT_MAX_LENGTH}
        className="w-full resize-none rounded border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 focus:border-accent focus:outline-none"
      />

      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}

      <div className="mt-1.5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1 text-xs text-ink-400 transition-colors hover:text-ink-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!body.trim() || pending}
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {pending ? 'Sending…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

/**
 * Form emoji palette.
 *
 * It exists for physical keyboards: mobile system keyboards already provide
 * emoji, and those characters pass through the application unchanged.
 * Thirty-two entries and no search — see `lib/emoji.ts`.
 */
function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }): ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /**
   * Closes on an outside click. Use `pointerdown`, not `click`: the latter arrives
   * only on release, so a drag starting outside the palette would leave it open
   * beneath the finger.
   */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative"
      // Escape closes the palette and **stops there**. Without interception, the
      // key would reach the viewer listening on the window: focus is on a button,
      // not a field, so its "typing area" guard does not apply and it would close
      // the whole panel — including the comment being written.
      onKeyDown={(event) => {
        if (!open || event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Add an emoji"
        aria-expanded={open}
        // The form no longer has a caption: the tooltip is the last place where
        // shortcut substitution can still be discovered.
        title='Add an emoji — ":)" becomes 🙂'
        className={`rounded p-1 text-base transition-colors hover:bg-white/10 ${
          open ? 'bg-white/10' : ''
        }`}
      >
        <span aria-hidden="true">🙂</span>
      </button>

      {open && (
        // Open upwards because the form is anchored at the bottom of the panel,
        // and anchor right because the button is too: left-aligned, its 16 rem
        // would overflow the panel.
        <div
          role="group"
          aria-label="Emoji"
          className="absolute right-0 bottom-full z-10 mb-2 grid w-64 grid-cols-8 gap-0.5 rounded border border-ink-700 bg-ink-900 p-2 shadow-lg"
        >
          {PICKER_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onPick(emoji);
                setOpen(false);
              }}
              aria-label={emoji}
              className="rounded p-1 text-base transition-colors hover:bg-white/10"
            >
              <span aria-hidden="true">{emoji}</span>
            </button>
          ))}
        </div>
      )}
    </div>
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
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Inserts the emoji in place of the selection, then restores focus to the field.
   *
   * Restoring the cursor is deferred by one frame: React rewrites the `textarea`
   * value on the next render, which would move the cursor to the end and insert
   * the second selected emoji in the wrong place.
   */
  const addEmoji = (emoji: string): void => {
    const field = fieldRef.current;
    const { value, caret } = insertEmoji(
      body,
      field?.selectionStart ?? body.length,
      field?.selectionEnd ?? body.length,
      emoji,
    );
    setBody(value);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(caret, caret);
    });
  };

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
        ref={fieldRef}
        value={body}
        autoFocus={autoFocus}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          // Enter posts, Shift+Enter inserts a line break. This is the messaging
          // convention, and a photo comment almost always fits in one sentence —
          // requiring a button click every time becomes tiresome.
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit(event);
          }
        }}
        rows={parentId === null ? 2 : 1}
        maxLength={COMMENT_MAX_LENGTH}
        placeholder={placeholder}
        className="w-full resize-none rounded border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-400 focus:border-accent focus:outline-none"
      />

      {create.isError && (
        <p className="mt-1 text-xs text-red-400">
          {errorText(create.error, 'The comment could not be posted.')}
        </p>
      )}

      {/* A single right-aligned row. The form no longer has a caption: beneath a
          photo, it takes space from the conversation, and "Enter to post" is
          discovered by pressing Enter. What still needs saying — that ":)"
          becomes an emoji — fits in the relevant button's tooltip. */}
      <div className="mt-2 flex items-center justify-end gap-2">
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="rounded px-2 py-1 text-xs text-ink-400 transition-colors hover:text-ink-100"
          >
            Cancel
          </button>
        )}
        <EmojiPicker onPick={addEmoji} />
        <button
          type="submit"
          disabled={!body.trim() || create.isPending}
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {create.isPending ? 'Sending…' : 'Post'}
        </button>
      </div>
    </form>
  );
}
