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

/** Panneau latéral des métadonnées, ouvert avec `i` dans la visionneuse. */
export function ExifPanel({
  detail,
  onClose,
}: {
  detail: MediaDetail | undefined;
  onClose: () => void;
}): ReactElement {
  return (
    <aside
      className="absolute inset-y-0 right-0 z-20 flex w-full max-w-sm flex-col overflow-y-auto border-l border-ink-700 bg-ink-900/95 backdrop-blur-sm"
      aria-label="Informations sur le média"
    >
      <header className="flex items-start justify-between gap-4 border-b border-ink-800 px-5 py-4">
        <h3 className="min-w-0 text-sm font-medium break-words text-ink-100">
          {detail?.name ?? 'Informations'}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-ink-400 transition-colors hover:text-ink-100"
          aria-label="Fermer le panneau"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </header>

      {!detail ? (
        <p className="px-5 py-4 text-sm text-ink-400">Chargement…</p>
      ) : (
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
      )}
    </aside>
  );
}
