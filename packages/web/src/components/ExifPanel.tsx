import type { AlbumDay, ShareDetail } from '@lukarn/shared';
import type { ReactElement } from 'react';
import { exifRows } from '../lib/exifRows';
import { useT } from '../lib/i18n';

/**
 * Contents of the side panel's "Info" tab.
 *
 * Renders only its rows: the `aside`, header and tabs belong to `SidePanel`,
 * which shares them with comments. Otherwise both tabs competed for the same
 * width with separate frames. Row selection lives in `lib/exifRows`, which can
 * be tested without a DOM.
 */
export function ExifPanel({
  detail,
  day,
}: {
  detail: ShareDetail | undefined;
  day: AlbumDay | undefined;
}): ReactElement {
  const t = useT();
  if (!detail) return <p className="px-5 py-4 text-sm text-ink-400">{t('common.loading')}</p>;

  return (
    <dl className="divide-y divide-ink-800">
      {exifRows(detail, day, t).map((row) => (
        // `items-baseline`: the label is 12 px and its value 14 px. Aligned by the
        // top of their boxes, their baselines differ by three pixels — enough to
        // make every label seem to float above its value. The baseline aligns them
        // and remains that of the **first** line when a value takes two ("NIKON
        // CORPORATION NIKON Z 6_2").
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
