import { ALBUM_DESCRIPTION_MAX_LENGTH } from '@gdv/shared';
import { type FormEvent, type ReactElement, useState } from 'react';
import { errorText } from '../api/client';
import { useUpdateAlbum } from '../api/hooks';

/**
 * La description de l'album, en tête de la grille : lue par tout le monde,
 * modifiable sur place par un administrateur.
 *
 * Elle ne se saisissait que depuis `/admin`, alors que la note d'une journée
 * s'écrit d'un clic depuis la grille juste en dessous. Deux textes voisins,
 * deux gestes : c'est cette asymétrie que ce composant supprime.
 *
 * **Le crayon est visible en permanence**, contrairement à celui de
 * `SectionHeader` qui ne se montre qu'au survol de sa section. La règle y est
 * justifiée par le nombre — un crayon par journée, tous affichés, feraient de
 * la grille un formulaire. Ici il n'y en a qu'un pour tout l'album : le cacher
 * ne gagnerait rien et le rendrait introuvable.
 */
interface AlbumDescriptionProps {
  albumId: string;
  description: string | null;
  /** Administrateur : lui seul voit le crayon et l'invitation à écrire. */
  editable: boolean;
}

export function AlbumDescription({
  albumId,
  description,
  editable,
}: AlbumDescriptionProps): ReactElement | null {
  const [editing, setEditing] = useState(false);

  if (!description && !editable) return null;

  return (
    // `relative` : l'éditeur s'ouvre en surimpression, comme celui d'une
    // journée. Le pousser dans le flux décalerait toute la grille vers le bas —
    // et `useGridLayout` ne mesure `offsetTop` que sur redimensionnement, si
    // bien qu'un simple glissement vertical lui échapperait.
    <div className="relative mb-5">
      {description ? (
        // Aucune borne de largeur : la description prend celle de la grille
        // qu'elle coiffe. Bornée à la mesure typographique habituelle, elle
        // laissait sur un grand écran deux tiers de la ligne vides au-dessus
        // d'une grille qui, elle, va jusqu'au bord — un alinéa étroit posé sur
        // une planche large, sans que rien ne justifie la rupture.
        <p className="text-sm leading-relaxed whitespace-pre-line text-ink-300">
          {description}
          {editable && (
            <EditButton
              label="Modifier la description de l'album"
              onClick={() => setEditing(true)}
            />
          )}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-lg text-sm text-ink-500 transition-colors hover:text-ink-200"
        >
          + Décrire cet album
        </button>
      )}

      {editing && (
        <DescriptionEditor
          albumId={albumId}
          description={description}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function EditButton({ label, onClick }: { label: string; onClick: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      // `align-text-bottom` : posé à la suite du dernier mot, un bouton en
      // ligne s'assoit sinon sur la ligne de base et dépasse sous le
      // paragraphe.
      className="ml-1.5 inline-flex rounded p-1 align-text-bottom text-ink-500 transition-colors hover:bg-white/5 hover:text-ink-200"
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
  );
}

interface DescriptionEditorProps {
  albumId: string;
  description: string | null;
  onClose: () => void;
}

function DescriptionEditor({
  albumId,
  description,
  onClose,
}: DescriptionEditorProps): ReactElement {
  const update = useUpdateAlbum();
  const [value, setValue] = useState(description ?? '');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    update.mutate(
      // La chaîne vide part en `null` : c'est le seul moyen d'effacer, et le
      // serveur ramène de toute façon les deux au même.
      { albumId, body: { description: value.trim() || null } },
      { onSuccess: onClose },
    );
  };

  return (
    <form
      onSubmit={submit}
      // L'éditeur, lui, reste borné : c'est un formulaire, et un champ de
      // saisie large de deux mille pixels ne se relit pas.
      className="absolute top-0 left-0 z-20 w-full max-w-prose space-y-2 rounded-xl border border-ink-700 bg-ink-900 p-3 shadow-xl"
    >
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={ALBUM_DESCRIPTION_MAX_LENGTH}
        rows={4}
        placeholder="Ce que contient cet album"
        aria-label="Description de l'album"
        autoFocus
        className="w-full resize-none rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm outline-none placeholder:text-ink-500 focus:border-accent-dim"
      />

      {update.error && (
        <p role="alert" className="text-xs text-red-300">
          {errorText(update.error, "L'enregistrement a échoué.")}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-500">
          {value.length}/{ALBUM_DESCRIPTION_MAX_LENGTH}
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
