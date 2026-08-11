import type { AlbumDay, MediaDetail } from '@nonni/shared';
import {
  formatAperture,
  formatBytes,
  formatCamera,
  formatCoordinates,
  formatDateTime,
  formatDuration,
  formatExposure,
  formatFocalLength,
} from './format';

/** Une ligne de l'onglet « Infos » : un libellé, sa valeur, et son statut. */
export interface ExifRow {
  label: string;
  value: string;
  /** Lien optionnel (géolocalisation). */
  href?: string;
  /** Ligne qui constate une absence, et non une donnée : rendue en retrait. */
  absent?: boolean;
}

/**
 * Les lignes du panneau d'informations d'un média.
 *
 * Hors du composant, comme `captionEntries` : c'est la seule partie du panneau
 * qui ait des cas — une donnée présente, absente, ou absente et dite — et la
 * seule qui se vérifie sans DOM.
 */
export function exifRows(detail: MediaDetail, day: AlbumDay | undefined): ExifRow[] {
  const rows: ExifRow[] = [];
  const push = (label: string, value: string | null | undefined, href?: string): void => {
    if (value) rows.push(href ? { label, value, href } : { label, value });
  };

  // La journée d'abord : c'est le seul texte écrit par un humain sur cette
  // photo, et il dit ce que ni le nom de fichier ni l'EXIF ne diront jamais.
  //
  // **Ces deux lignes sont sans condition de largeur, et c'est délibéré.**
  // L'en-tête de la visionneuse ne montre le contexte du jour qu'à partir de
  // `md` (D70) : sous ce seuil, elles sont le seul accès à la note depuis une
  // photo ouverte. Les conditionner ferait disparaître l'information sur
  // téléphone sans rien casser de visible.
  //
  // `place` prime sur `autoPlaces` — c'est une correction saisie à la main, et
  // une correction que le géocodage écraserait ne servirait à rien (D51).
  push('Lieu', day?.place ?? day?.autoPlaces.join(' · '));
  push('That day', day?.description);

  push(detail.takenAtFromExif ? 'Taken' : 'Modified', formatDateTime(detail.takenAt));
  push('Dimensions', detail.width && detail.height ? `${detail.width} × ${detail.height}` : null);
  push('Size', formatBytes(detail.size));
  push('Duration', formatDuration(detail.durationMs));
  push('Camera', formatCamera(detail.exif.cameraMake, detail.exif.cameraModel));
  push('Lens', detail.exif.lens);
  push('Focal length', formatFocalLength(detail.exif.focalLength));
  push('Aperture', formatAperture(detail.exif.aperture));
  push('Shutter', formatExposure(detail.exif.exposureTime));
  push('ISO', detail.exif.isoSpeed ? String(detail.exif.isoSpeed) : null);

  // La position sort de l'EXIF de **cette** photo, et ne doit donc rien au
  // géocodage inverse : elle s'affiche que « Lieu » ait un nom ou pas (D94).
  //
  // Son absence se dit, là où toutes les autres lignes s'effacent en silence.
  // C'est la seule dont on se demande, en ne la voyant pas, si la photo n'a
  // rien à donner ou si l'application n'a pas fini son travail — la première
  // réponse est définitive, la seconde invite à revenir plus tard, et rien à
  // l'écran ne les distinguait.
  //
  // Réservé aux photos : Drive ne rend de position que dans
  // `imageMediaMetadata`, jamais pour une vidéo. La ligne y vaudrait « aucune »
  // sur la totalité des fichiers, ce qui n'apprendrait rien de celui qu'on
  // regarde et laisserait croire à une vidéo dégéolocalisée.
  const coordinates = formatCoordinates(detail.exif.latitude, detail.exif.longitude);
  if (coordinates) {
    rows.push({
      label: 'Position',
      value: coordinates,
      href: `https://www.openstreetmap.org/?mlat=${detail.exif.latitude}&mlon=${detail.exif.longitude}#map=15/${detail.exif.latitude}/${detail.exif.longitude}`,
    });
  } else if (detail.kind === 'photo') {
    rows.push({ label: 'Position', value: 'No GPS data', absent: true });
  }

  return rows;
}
