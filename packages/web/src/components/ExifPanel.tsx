import type { AlbumDay, MediaDetail } from '@gdv/shared';
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

function buildRows(detail: MediaDetail, day: AlbumDay | undefined): Row[] {
  const rows: Row[] = [];
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
  push('Ce jour-là', day?.description);

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
export function ExifPanel({
  detail,
  day,
}: {
  detail: MediaDetail | undefined;
  day: AlbumDay | undefined;
}): ReactElement {
  if (!detail) return <p className="px-5 py-4 text-sm text-ink-400">Chargement…</p>;

  return (
    <dl className="divide-y divide-ink-800">
      {buildRows(detail, day).map((row) => (
        // `items-baseline` : le libellé est en 12 px, sa valeur en 14 px. Alignés
        // par le haut de leur boîte, leurs deux lignes de base tombent à trois
        // pixels d'écart — assez pour que chaque libellé paraisse flotter
        // au-dessus de sa valeur. La ligne de base est ce qui les accorde, et
        // elle reste celle de la **première** ligne quand une valeur en occupe
        // deux (« NIKON CORPORATION NIKON Z 6_2 »).
        <div key={row.label} className="flex items-baseline gap-4 px-5 py-3">
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
