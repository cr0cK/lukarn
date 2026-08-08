import { MEDIA_DESCRIPTION_MAX_LENGTH } from '@gdv/shared';
import { type FormEvent, type ReactElement, useState } from 'react';
import { errorText } from '../api/client';
import { useUpdateMedia } from '../api/hooks';
import { captionEntries, type CaptionEntry } from '../lib/caption';

/**
 * Bandeau de légende de la visionneuse : la description de la photo, puis la
 * note de sa journée — dans cet ordre, et à **toutes les largeurs**.
 *
 * Il vit dans son propre fichier parce que `Lightbox.tsx` en fait déjà 850, et
 * parce que ce qu'il porte n'a rien à voir avec la navigation entre photos :
 * deux textes, un dépliement, un masquage, et un éditeur pour
 * l'administrateur (D84). La description de l'album en a été retirée (D89) :
 * elle se lit en ouvrant l'album, et la répéter sur chacune de ses photos
 * coûtait une ligne de bandeau pour un texte déjà lu.
 *
 * L'éditeur est repris d'`AlbumDescription` — surimpression, compteur de
 * caractères, Annuler/Enregistrer. Deux façons de corriger un texte dans la
 * même application se remarqueraient tout de suite.
 */
interface MediaCaptionProps {
  albumId: string;
  mediaId: string;
  /** Les deux textes candidats. Une chaîne vide ou blanche vaut absence. */
  description: string | null;
  day: string | null;
  /** Administrateur : lui seul voit le crayon et l'invitation à écrire. */
  editable: boolean;
  hidden: boolean;
  onHiddenChange: (hidden: boolean) => void;
  /**
   * L'ouverture de l'éditeur est pilotée par la visionneuse : c'est elle qui
   * écoute `Échap`, et cette touche doit refermer le champ de saisie avant de
   * fermer quoi que ce soit d'autre.
   */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  /**
   * `false` sur une vidéo, seul cas où le bandeau **pousse** au lieu de
   * recouvrir : les contrôles natifs de lecture vivent au bas de la balise, et
   * sur une vidéo portrait qui remplit l'écran, un bandeau posé dessus rendrait
   * play/pause et la barre de progression intouchables.
   */
  overlay: boolean;
}

export function MediaCaption({
  albumId,
  mediaId,
  description,
  day,
  editable,
  hidden,
  onHiddenChange,
  editing,
  onEditingChange,
  overlay,
}: MediaCaptionProps): ReactElement | null {
  /**
   * Le dépliement n'est **pas** persisté, contrairement au masquage : il répond
   * à un texte précis, et n'a pas de sens sur la photo suivante. La visionneuse
   * remonte ce composant à chaque photo (`key`), ce qui le remet à plat.
   */
  const [expanded, setExpanded] = useState(false);

  const entries = captionEntries({ description, day });

  // Rien à dire et rien à écrire : pas même un bouton fantôme, qui inviterait à
  // découvrir un bandeau vide.
  if (entries.length === 0 && !editable) return null;

  if (hidden) {
    // Un état masqué sans porte de sortie est un piège : le bandeau reparti,
    // plus rien ne dirait qu'il existe, ni comment le rappeler.
    return (
      <div className={`${overlay ? 'absolute right-0 bottom-0 z-10' : 'flex justify-end'} p-3`}>
        <button
          type="button"
          onClick={() => onHiddenChange(false)}
          className="rounded-full bg-black/40 px-2.5 py-1 text-xs text-ink-400 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-ink-100"
        >
          Afficher la légende (l)
        </button>
      </div>
    );
  }

  return (
    // Symétrique de l'en-tête : même dégradé, retourné. Sans voile, une légende
    // claire posée sur une plage surexposée est illisible.
    //
    // Les marges latérales tiennent compte de l'encoche, comme celles de
    // l'en-tête : en paysage, elle mord exactement sur ce bord-là. Elles sont
    // posées sur le contenu et non sur l'enveloppe, pour que le dégradé aille
    // jusqu'au bord de l'écran.
    <div
      className={`${
        overlay ? 'absolute inset-x-0 bottom-0 z-10' : 'relative'
      } bg-gradient-to-t from-black/85 via-black/55 to-transparent pt-10`}
    >
      <div className="flex items-stretch gap-2 pb-2 pl-[calc(0.75rem_+_env(safe-area-inset-left))] pr-[calc(0.75rem_+_env(safe-area-inset-right))] sm:pb-3 sm:pl-[calc(1rem_+_env(safe-area-inset-left))] sm:pr-[calc(1rem_+_env(safe-area-inset-right))]">
        <div className="min-w-0 flex-1">
          {editable && !description && (
            <button
              type="button"
              onClick={() => onEditingChange(true)}
              className="rounded text-sm text-ink-400 transition-colors hover:text-ink-100"
            >
              + Décrire cette photo
            </button>
          )}

          {entries.length > 0 && (
            // Le défilement est sur l'enveloppe et non sur le bouton : déplié,
            // un texte de mille caractères couvrirait la photo entière.
            <div className={expanded ? 'max-h-[50vh] overflow-y-auto' : undefined}>
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
                aria-label={expanded ? 'Replier la légende' : 'Déplier la légende'}
                className="block w-full space-y-0.5 text-left"
              >
                {entries.map((entry) => (
                  <CaptionLine key={entry.scope} entry={entry} expanded={expanded} />
                ))}
              </button>
            </div>
          )}
        </div>

        {/* Le crayon en haut, le chevron en bas : chacun en face de la ligne
            qu'il commande — la description de la photo, et le bandeau entier. */}
        <div className="flex shrink-0 flex-col justify-between">
          {editable && description ? (
            <IconButton
              label="Modifier la description de cette photo"
              onClick={() => onEditingChange(true)}
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </IconButton>
          ) : (
            <span />
          )}

          <IconButton label="Masquer la légende (l)" onClick={() => onHiddenChange(true)}>
            <path d="m6 9 6 6 6-6" />
          </IconButton>
        </div>
      </div>

      {editing && (
        <CaptionEditor
          albumId={albumId}
          mediaId={mediaId}
          description={description}
          onClose={() => onEditingChange(false)}
        />
      )}
    </div>
  );
}

/**
 * Une ligne du bandeau. Les deux portées se distinguent par la couleur et le
 * nombre de lignes visibles : plus la portée est large, plus la ligne
 * s'efface — c'est ce qui fait lire la description de la photo en premier sans
 * qu'aucun titre ne le dise.
 */
const LINE_STYLES: Record<CaptionEntry['scope'], string> = {
  photo: 'line-clamp-3 text-sm leading-5 text-ink-100',
  day: 'line-clamp-2 text-xs leading-4 text-ink-300',
};

function CaptionLine({
  entry,
  expanded,
}: {
  entry: CaptionEntry;
  expanded: boolean;
}): ReactElement {
  return (
    <p
      className={`max-w-prose whitespace-pre-line ${LINE_STYLES[entry.scope]} ${
        expanded ? 'line-clamp-none' : ''
      }`}
    >
      {entry.label && <span className="text-ink-500">{entry.label} · </span>}
      {entry.text}
    </p>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded-full p-1.5 text-ink-400 transition-colors hover:bg-white/10 hover:text-white"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  );
}

function CaptionEditor({
  albumId,
  mediaId,
  description,
  onClose,
}: {
  albumId: string;
  mediaId: string;
  description: string | null;
  onClose: () => void;
}): ReactElement {
  const update = useUpdateMedia(albumId);
  const [value, setValue] = useState(description ?? '');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    update.mutate(
      // La chaîne vide part en `null` : c'est le seul moyen d'effacer, et le
      // serveur ramène de toute façon les deux au même.
      { mediaId, body: { description: value.trim() || null } },
      { onSuccess: onClose },
    );
  };

  return (
    <form
      onSubmit={submit}
      className="absolute inset-x-2 bottom-2 z-20 space-y-2 rounded-xl border border-ink-700 bg-ink-900 p-3 shadow-xl sm:inset-x-4 sm:bottom-3 sm:max-w-prose"
    >
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={MEDIA_DESCRIPTION_MAX_LENGTH}
        rows={3}
        placeholder="Ce qui se passe sur cette photo"
        aria-label="Description de la photo"
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
          {value.length}/{MEDIA_DESCRIPTION_MAX_LENGTH}
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
