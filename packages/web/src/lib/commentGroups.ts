import type { Comment } from '@nonni/shared';
import { dayLabel, localDayKey } from './justify';

/**
 * Ce qu'un commentaire doit porter pour être rangé ici : lui-même, et de quoi
 * le situer. `AdminComment` et `FeedComment` le satisfont tous deux — la file
 * de modération et le tiroir d'activité posent la même question, « qu'est-ce
 * qui a été écrit, et où », et n'ont pas à y répondre deux fois.
 */
export interface SituatedComment extends Comment {
  albumId: string;
  albumTitle: string;
  mediaId: string;
  /** `null` si la photo a disparu de l'index : le message, lui, reste. */
  mediaName: string | null;
}

/** Les commentaires d'une même photo, dans l'ordre où la liste les a rendus. */
export interface PhotoGroup<T extends SituatedComment = SituatedComment> {
  /** Identifie le groupe parmi ses frères — `key` de React comme clé de `Map`. */
  key: string;
  albumId: string;
  albumTitle: string;
  mediaId: string;
  /** `null` si la photo a disparu de l'index : le fil reste lisible et modérable. */
  mediaName: string | null;
  comments: T[];
}

/** Une journée de la liste, et les photos commentées ce jour-là. */
export interface DayGroup<T extends SituatedComment = SituatedComment> {
  /** `YYYY-MM-DD` sur l'horloge du lecteur. */
  key: string;
  /** « Aujourd'hui », « Hier », ou la date complète. */
  label: string;
  photos: PhotoGroup<T>[];
}

/**
 * Range une page de commentaires par journée, puis par photo.
 *
 * Deux répétitions disparaissent d'un coup : la date, qui n'a pas à figurer sur
 * chaque ligne quand vingt messages se suivent le même jour, et le couple
 * photo / album, réécrit à l'identique sous chaque commentaire d'un même fil.
 *
 * **La journée est celle du lecteur, pas UTC** — à l'inverse de la grille. La
 * raison est écrite dans `format.ts` : `taken_at` est une heure murale sans
 * fuseau, alors que la date d'un commentaire est l'instant où quelqu'un a appuyé
 * sur « Publier ». Grouper en UTC rangerait sous la veille un message écrit à
 * 23 h 30 à Paris.
 *
 * **Le rangement ne porte que sur la page reçue**, pas sur le corpus : une photo
 * dont les commentaires enjambent une frontière de page apparaît en bas de l'une
 * et en haut de l'autre. C'est le prix d'un regroupement fait après coup, et il
 * est moindre que celui d'un serveur qui devrait paginer des groupes entiers —
 * une page ne contiendrait plus un nombre connu de lignes.
 *
 * L'ordre d'entrée est préservé partout : les journées comme les photos
 * apparaissent dans l'ordre de leur premier commentaire, et les commentaires
 * d'une photo gardent le leur. La liste arrive antéchronologique, elle le reste.
 */
export function groupByDayAndPhoto<T extends SituatedComment>(comments: T[]): DayGroup<T>[] {
  const days = new Map<string, Map<string, PhotoGroup<T>>>();

  for (const comment of comments) {
    const dayKey = localDayKey(new Date(comment.createdAt));
    let photos = days.get(dayKey);
    if (!photos) {
      photos = new Map();
      days.set(dayKey, photos);
    }

    // La photo, pas le seul média : le même fichier Drive indexé sous deux
    // albums porte deux conversations séparées (D12), qu'on ne mélange pas ici
    // non plus.
    //
    // La clé passe par `JSON.stringify` plutôt que par une concaténation à
    // séparateur : le tableau encodé échappe lui-même ce qu'il contient, donc
    // aucun couple ne peut en imiter un autre, quelle que soit la forme des
    // identifiants Drive. Le dépôt sépare ailleurs par l'octet nul (curseur
    // des médias), mais celui-ci ne s'écrit qu'échappé — littéral, il fait
    // classer le fichier comme binaire par git, qui cesse d'en afficher les
    // diffs.
    const photoKey = JSON.stringify([comment.albumId, comment.mediaId]);
    const existing = photos.get(photoKey);
    if (existing) {
      existing.comments.push(comment);
    } else {
      photos.set(photoKey, {
        key: photoKey,
        albumId: comment.albumId,
        albumTitle: comment.albumTitle,
        mediaId: comment.mediaId,
        mediaName: comment.mediaName,
        comments: [comment],
      });
    }
  }

  return [...days].map(([key, photos]) => ({
    key,
    label: dayLabel(key),
    photos: [...photos.values()],
  }));
}
