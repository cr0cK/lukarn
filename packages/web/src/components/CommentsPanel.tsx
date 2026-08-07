import { COMMENT_MAX_LENGTH, remainingEditMs, type Comment, type CommentThread } from '@gdv/shared';
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
 * Contenu de l'onglet « Commentaires » du panneau latéral.
 *
 * Volontairement pauvre en fonctions : un fil, une réponse par fil, la
 * suppression de ses propres messages, et une correction de faute de frappe
 * dans les trente secondes. Pas d'édition libre, pas de réactions, pas de
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

      {/* Le formulaire d'ouverture de fil reste en bas, hors de la zone qui
          défile : sur une photo très commentée, il faudrait sinon parcourir
          toute la conversation pour trouver où écrire.

          La marge basse s'ajoute à celle de l'appareil : posée sur l'écran
          d'accueil, l'application occupe toute la hauteur et le champ de
          saisie passerait sous la barre d'accueil de l'iPhone. */}
      <div className="border-t border-ink-800 px-5 pt-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))]">
        <Composer albumId={albumId} mediaId={mediaId} />
      </div>
    </div>
  );
}

/**
 * Ce qui occupe le bas du panneau : le champ de saisie, l'invitation à
 * s'identifier, ou l'explication d'une galerie sans serveur d'envoi.
 *
 * L'identité est demandée **ici**, au moment où l'on veut écrire — pas à la
 * connexion. C'est le seul instant où renseigner son adresse a un sens visible
 * pour celui à qui on la demande.
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
          placeholder={`Commenter en tant que ${me.identity.displayName}…`}
        />
        <p className="mt-2 text-xs text-ink-400">
          Tu commentes en tant que <span className="text-ink-200">{me.identity.displayName}</span>.{' '}
          <button
            type="button"
            onClick={() => setIdentifying(true)}
            className="underline underline-offset-2 transition-colors hover:text-ink-100"
          >
            Changer d’adresse
          </button>
        </p>
      </>
    );
  }

  // Sans serveur SMTP, aucun code ne peut partir : mieux vaut le dire que
  // d'offrir un formulaire qui échouera à la dernière étape.
  if (me && !me.commentsEnabled) {
    return (
      <p className="text-sm text-ink-400">
        Les commentaires sont indisponibles : cette galerie n’a pas de serveur d’envoi d’emails
        configuré.
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
      S’identifier pour commenter
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
  // Sans identité vérifiée, le serveur refuserait la réponse : proposer le
  // bouton mènerait droit à un message d'erreur.
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

/**
 * Secondes restantes pour corriger ce commentaire, `null` dès qu'il n'y a plus
 * rien à proposer.
 *
 * `canEdit` seul ne suffirait pas : il dit ce que le serveur pensait **au
 * moment de la réponse**, et un fil resté ouvert le porterait encore à `true`
 * une heure plus tard. Le décompte est donc rejoué ici, à partir de
 * `createdAt` et de la même fonction que le serveur.
 */
function useEditWindow(comment: Comment): number | null {
  const [remaining, setRemaining] = useState(() =>
    comment.canEdit ? remainingEditMs(comment.createdAt, Date.now()) : 0,
  );

  useEffect(() => {
    if (!comment.canEdit) return;
    // Un rendu par seconde, sur un commentaire à la fois et pendant trente
    // secondes : c'est le prix d'un bouton dont la disparition s'annonce au
    // lieu de surprendre. L'intervalle s'arrête de lui-même à l'échéance.
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
          // Le texte saisi, pas le texte rendu : corriger « :) » ne doit pas
          // remplacer le raccourci par l'emoji dans ce qui est stocké.
          initial={comment.body}
          pending={update.isPending}
          error={
            update.isError
              ? errorText(update.error, 'La correction n’a pas pu être enregistrée.')
              : null
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
        /* `whitespace-pre-wrap` : les retours à la ligne saisis sont conservés,
           sans qu'aucun HTML ne soit interprété — React échappe le texte.
           `emojify` rend du texte pur, cette garantie tient donc encore. */
        <p className="mt-1 text-sm break-words whitespace-pre-wrap text-ink-200">
          {emojify(comment.body)}
        </p>
      )}

      <div className="mt-1.5 flex gap-3 text-xs text-ink-400">
        {onReply && !editing && (
          <button type="button" onClick={onReply} className="transition-colors hover:text-ink-100">
            Répondre
          </button>
        )}
        {secondsLeft !== null && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Corriger une faute de frappe, dans les trente secondes qui suivent la publication"
            className="tabular-nums transition-colors hover:text-ink-100"
          >
            Modifier ({secondsLeft} s)
          </button>
        )}
        {comment.canDelete && !editing && (
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

/**
 * Correction en place d'un commentaire publié.
 *
 * Le formulaire **reste ouvert** si la fenêtre se referme pendant la saisie :
 * le serveur tranche, et son refus s'affiche ici. Le fermer d'autorité ferait
 * disparaître le texte en cours de frappe sans prévenir.
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
          Annuler
        </button>
        <button
          type="submit"
          disabled={!body.trim() || pending}
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {pending ? 'Envoi…' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}

/**
 * Palette d'emoji du formulaire.
 *
 * Elle existe pour le clavier physique : sur mobile, le clavier système en
 * propose déjà, et ces caractères traversent l'application sans traitement.
 * Trente-deux entrées et aucune recherche — voir `lib/emoji.ts`.
 */
function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }): ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /**
   * Referme sur un clic à l'extérieur. `pointerdown` et non `click` : le second
   * n'arrive qu'au relâchement, si bien qu'un glisser commencé hors de la
   * palette la laisserait ouverte sous le doigt.
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
      // Échap referme la palette, et **s'arrête là**. Sans cette interception,
      // la touche remonterait jusqu'à la visionneuse, qui écoute la fenêtre : le
      // focus étant sur un bouton et non sur un champ, son garde « zone de
      // saisie » ne s'applique pas, et elle refermerait tout le panneau — donc
      // le commentaire en cours de frappe.
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
        aria-label="Ajouter un emoji"
        aria-expanded={open}
        // Le formulaire ne porte plus de légende : l'infobulle est le dernier
        // endroit où la substitution des raccourcis peut encore s'apprendre.
        title="Ajouter un emoji — « :) » devient 🙂"
        className={`rounded p-1 text-base transition-colors hover:bg-white/10 ${
          open ? 'bg-white/10' : ''
        }`}
      >
        <span aria-hidden="true">🙂</span>
      </button>

      {open && (
        // Vers le haut parce que le formulaire est ancré en bas du panneau, et
        // ancrée à droite parce que le bouton l'est aussi : alignée à gauche,
        // ses 16 rem déborderaient du panneau.
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
   * Insère l'emoji à la place de la sélection, puis rend le focus au champ.
   *
   * La remise du curseur est différée d'une image : React réécrit la valeur du
   * `textarea` au rendu suivant, ce qui replacerait le curseur à la fin du texte
   * et enverrait le deuxième emoji choisi au mauvais endroit.
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
        className="w-full resize-none rounded border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-400 focus:border-accent focus:outline-none"
      />

      {create.isError && (
        <p className="mt-1 text-xs text-red-400">
          {errorText(create.error, 'Le commentaire n’a pas pu être publié.')}
        </p>
      )}

      {/* Une seule rangée alignée à droite. Le formulaire ne porte plus de
          légende : sous une photo, la place se prend sur la conversation, et
          « Entrée pour publier » se découvre en appuyant sur Entrée. Ce qui
          restait vraiment à dire — que « :) » devient un emoji — tient dans
          l'infobulle du bouton qui en parle. */}
      <div className="mt-2 flex items-center justify-end gap-2">
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="rounded px-2 py-1 text-xs text-ink-400 transition-colors hover:text-ink-100"
          >
            Annuler
          </button>
        )}
        <EmojiPicker onPick={addEmoji} />
        <button
          type="submit"
          disabled={!body.trim() || create.isPending}
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {create.isPending ? 'Envoi…' : 'Publier'}
        </button>
      </div>
    </form>
  );
}
