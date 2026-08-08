import type { AlbumDay, MediaDetail } from '@gdv/shared';
import type { ReactElement } from 'react';
import { exifRows } from '../lib/exifRows';

/**
 * Contenu de l'onglet « Infos » du panneau latéral.
 *
 * Ne rend que ses lignes : l'`aside`, l'en-tête et les onglets appartiennent à
 * `SidePanel`, qui les partage avec les commentaires. Les deux onglets se
 * disputaient sinon la même largeur avec chacun son cadre. Le choix des lignes
 * vit dans `lib/exifRows`, qui se teste sans DOM.
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
      {exifRows(detail, day).map((row) => (
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
          <dd
            className={`min-w-0 text-sm break-words ${row.absent ? 'text-ink-400' : 'text-ink-100'}`}
          >
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
