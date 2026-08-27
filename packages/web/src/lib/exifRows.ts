import type { AlbumDay, ShareDetail } from '@lukarn/shared';
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
import type { Translate } from './i18n/translate';

/** A row in the "Info" tab: a label, its value and status. */
export interface ExifRow {
  label: string;
  value: string;
  /** Optional link (geolocation). */
  href?: string;
  /** Row reporting absence rather than data; rendered as secondary. */
  absent?: boolean;
}

/**
 * Rows in a media information panel.
 *
 * Outside the component like `captionEntries`: this is the only panel part with
 * cases — data present, absent, or absent and stated — and the only one verifiable
 * without the DOM.
 */
export function exifRows(detail: ShareDetail, day: AlbumDay | undefined, t: Translate): ExifRow[] {
  const rows: ExifRow[] = [];
  const push = (label: string, value: string | null | undefined, href?: string): void => {
    if (value) rows.push(href ? { label, value, href } : { label, value });
  };

  // Day first: this is the only human-written text on the photo, saying what
  // neither the filename nor EXIF ever will.
  //
  // **These two lines have no width condition, deliberately.** The viewer header
  // shows day context only from `md` (D70): below that, they are the only access
  // to the note from an open photo. Conditioning them would remove information
  // on phones without visibly breaking anything.
  //
  // `place` takes precedence over `autoPlaces` — it is a manual correction, and
  // a correction overwritten by geocoding would serve no purpose (D51).
  push(t('exif.place'), day?.place ?? day?.autoPlaces.join(' · '));
  push(t('exif.thatDay'), day?.description);

  push(
    t(detail.takenAtFromExif ? 'exif.taken' : 'exif.modified'),
    formatDateTime(detail.takenAt, t),
  );
  push(
    t('exif.dimensions'),
    detail.width && detail.height ? `${detail.width} × ${detail.height}` : null,
  );
  push(t('exif.size'), formatBytes(detail.size, t));
  push(t('exif.duration'), formatDuration(detail.durationMs));
  push(t('exif.camera'), formatCamera(detail.exif.cameraMake, detail.exif.cameraModel));
  push(t('exif.lens'), detail.exif.lens);
  push(t('exif.focalLength'), formatFocalLength(detail.exif.focalLength));
  push(t('exif.aperture'), formatAperture(detail.exif.aperture));
  push(t('exif.shutter'), formatExposure(detail.exif.exposureTime));
  push(t('exif.iso'), detail.exif.isoSpeed ? String(detail.exif.isoSpeed) : null);

  // Position comes from **this** photo's EXIF and owes nothing to reverse
  // geocoding: display it whether "Place" has a name or not (D94).
  //
  // State its absence where every other row disappears silently. It is the only
  // missing row that leaves doubt between no photo data and unfinished work —
  // the first is final, the second invites a later return, and the screen did not
  // distinguish them.
  //
  // Photos only: Drive returns position in `imageMediaMetadata`, never for video.
  // The row would say "none" for every file, revealing nothing about the viewed
  // one and implying geolocation had been removed from a video.
  const coordinates = formatCoordinates(detail.exif.latitude, detail.exif.longitude, t);
  if (coordinates) {
    rows.push({
      label: t('exif.position'),
      value: coordinates,
      href: `https://www.openstreetmap.org/?mlat=${detail.exif.latitude}&mlon=${detail.exif.longitude}#map=15/${detail.exif.latitude}/${detail.exif.longitude}`,
    });
  } else if (detail.kind === 'photo') {
    rows.push({ label: t('exif.position'), value: t('exif.noPosition'), absent: true });
  }

  return rows;
}
