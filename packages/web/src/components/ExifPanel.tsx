import type { MediaDetail } from '@gdv/shared';
import type { ReactElement } from 'react';
import {
  formatAperture,
  formatBytes,
  formatCamera,
  formatCoordinates,
  formatDateTime,
  formatDuration,
  formatExposure,
  formatFocalLength,
} from '../lib/format';

interface Row {
  label: string;
  value: string;
  /** Lien optionnel (géolocalisation). */
  href?: string;
}

function buildRows(detail: MediaDetail): Row[] {
  const rows: Row[] = [];
  const push = (label: string, value: string | null | undefined, href?: string): void => {
    if (value) rows.push(href ? { label, value, href } : { label, value });
  };

  push(detail.takenAtFromExif ? 'Prise de vue' : 'Modifié le', formatDateTime(detail.takenAt));
  push('Dimensions', detail.width && detail.height ? `${detail.width} × ${detail.height}` : null);
  push('Taille', formatBytes(detail.size));
  push('Durée', formatDuration(detail.durationMs));
  push('Appareil', formatCamera(detail.exif.cameraMake, detail.exif.cameraModel));
  push('Objectif', detail.exif.lens);
  push('Focale', formatFocalLength(detail.exif.focalLength));
  push('Ouverture', formatAperture(detail.exif.aperture));
  push('Vitesse', formatExposure(detail.exif.exposureTime));
  push('ISO', detail.exif.isoSpeed ? String(detail.exif.isoSpeed) : null);

  const coordinates = formatCoordinates(detail.exif.latitude, detail.exif.longitude);
  if (coordinates) {
    rows.push({
      label: 'Position',
      value: coordinates,
      href: `https://www.openstreetmap.org/?mlat=${detail.exif.latitude}&mlon=${detail.exif.longitude}#map=15/${detail.exif.latitude}/${detail.exif.longitude}`,
    });
  }

  return rows;
}

/**
 * Contenu de l'onglet « Infos » du panneau latéral.
 *
 * Ne rend que ses lignes : l'`aside`, l'en-tête et les onglets appartiennent à
 * `SidePanel`, qui les partage avec les commentaires. Les deux onglets se
 * disputaient sinon la même largeur avec chacun son cadre.
 */
export function ExifPanel({ detail }: { detail: MediaDetail | undefined }): ReactElement {
  if (!detail) return <p className="px-5 py-4 text-sm text-ink-400">Chargement…</p>;

  return (
    <dl className="divide-y divide-ink-850">
      {buildRows(detail).map((row) => (
        <div key={row.label} className="flex gap-4 px-5 py-3">
          <dt className="w-28 shrink-0 text-xs tracking-wide text-ink-400 uppercase">
            {row.label}
          </dt>
          <dd className="min-w-0 text-sm break-words text-ink-100">
            {row.href ? (
              <a
                href={row.href}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent underline-offset-2 hover:underline"
              >
                {row.value}
              </a>
            ) : (
              row.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
