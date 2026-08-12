import {
  VISIT_WINDOWS,
  type AlbumVisitRow,
  type DeviceKind,
  type VisitorRow,
} from '@lukarn/shared';
import { type ReactElement, useState } from 'react';
import { errorText } from '../../api/client';
import { useVisits } from '../../api/hooks';
import { formatDate, formatDateTime, formatRelative } from '../../lib/format';
import { useT, type Translate } from '../../lib/i18n';
import { Spinner } from '../Spinner';
import { Button, FormError, ROW_CLASS, Section } from './ui';

/**
 * The stored label is the technical term; the displayed one is ordinary usage.
 * The database keeps its French column values — a stored value is not a message,
 * and rewriting them would need a migration for a word nobody reads.
 */
const APPAREILS: Record<DeviceKind, Parameters<Translate>[0]> = {
  mobile: 'visits.mobile',
  tablette: 'visits.tablet',
  ordinateur: 'visits.computer',
  tv: 'visits.television',
};

/** A measurement and its label. Number first because that is what gets scanned. */
function Mesure({ valeur, unite }: { valeur: number; unite: string }): ReactElement {
  return (
    <span className="whitespace-nowrap text-xs text-ink-400">
      <span className="font-medium text-ink-200">{valeur}</span> {unite}
    </span>
  );
}

/**
 * A telemetry date: relative time reads at a glance, while the exact value stays
 * available on hover. Use UTC like every application date, with another reason
 * here — counts are grouped by UTC day, so showing local time beside them would
 * mix two scales in one table.
 */
function Quand({ iso }: { iso: string | null }): ReactElement {
  const t = useT();
  if (!iso) return <span className="text-xs text-ink-500">{t('visits.never')}</span>;
  return (
    <span className="text-xs text-ink-400" title={`${formatDateTime(iso, t)} UTC`}>
      {formatRelative(iso, t)}
    </span>
  );
}

function LigneVisiteur({ visiteur }: { visiteur: VisitorRow }): ReactElement {
  const t = useT();

  return (
    <div
      className={`${ROW_CLASS} border-b border-ink-850 px-4 py-3 last:border-b-0 xl:items-center`}
    >
      <div className="min-w-0 flex-1">
        {/* Same geometry as the account row: `truncate` only on the identifier,
            with following labels in `shrink-0`. */}
        <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium text-ink-100">
          <span className="truncate">{visiteur.username}</span>
          {visiteur.admin && (
            <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-normal text-accent">
              {t('visits.administrator')}
            </span>
          )}
          {visiteur.devices.map((appareil) => (
            <span
              key={appareil}
              className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-xs font-normal text-ink-300"
            >
              {t(APPAREILS[appareil])}
            </span>
          ))}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Quand iso={visiteur.lastSeenAt ?? visiteur.lastAt} />
          <span className="text-xs text-ink-600">·</span>
          <Mesure valeur={visiteur.days} unite={t('visits.unitDays', visiteur.days)} />
          <span className="text-xs text-ink-600">·</span>
          <Mesure valeur={visiteur.sessions} unite={t('visits.unitDevices', visiteur.sessions)} />
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 xl:justify-end">
        <Mesure valeur={visiteur.albums} unite={t('visits.unitAlbums', visiteur.albums)} />
        <Mesure valeur={visiteur.visits} unite={t('visits.unitVisits', visiteur.visits)} />
        <Mesure valeur={visiteur.photos} unite={t('visits.unitPhotos', visiteur.photos)} />
      </div>
    </div>
  );
}

function LigneAlbum({ album }: { album: AlbumVisitRow }): ReactElement {
  const t = useT();

  return (
    <div
      className={`${ROW_CLASS} border-b border-ink-850 px-4 py-3 last:border-b-0 xl:items-center`}
    >
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink-100">
          <span className="truncate">{album.title ?? album.albumId}</span>
          {album.title === null && (
            <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-xs font-normal text-ink-400">
              {t('visits.deleted')}
            </span>
          )}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Quand iso={album.lastAt} />
          <span className="text-xs text-ink-600">·</span>
          <Mesure valeur={album.keys} unite={t('visits.unitKeys', album.keys)} />
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 xl:justify-end">
        <Mesure valeur={album.visitors} unite={t('visits.unitVisitors', album.visitors)} />
        <Mesure valeur={album.visits} unite={t('visits.unitVisits', album.visits)} />
        <Mesure valeur={album.photos} unite={t('visits.unitPhotos', album.photos)} />
      </div>
    </div>
  );
}

/**
 * "Visits" section: who visited and what they viewed.
 *
 * Two tables and nothing else. Measurement happens server-side, aggregated on
 * write, and never reaches individual media: that would be someone's viewing
 * history (D260809h).
 */
export function VisitsSection(): ReactElement {
  const t = useT();
  const [days, setDays] = useState<number>(30);
  const { data, isPending, error } = useVisits(days);

  const fenetre = (
    <div className="flex gap-1" role="group" aria-label={t('visits.window')}>
      {VISIT_WINDOWS.map((valeur) => (
        <Button
          key={valeur}
          variant={valeur === days ? 'primary' : 'default'}
          onClick={() => setDays(valeur)}
          ariaLabel={t('visits.lastDays', valeur)}
        >
          {t('visits.days', valeur)}
        </Button>
      ))}
    </div>
  );

  if (error) {
    return (
      <Section title={t('visits.title')} action={fenetre}>
        <div className="px-4 py-4">
          <FormError message={errorText(error, t('visits.loadFailed'))} />
        </div>
      </Section>
    );
  }

  if (isPending) {
    return (
      <Section title={t('visits.title')} action={fenetre}>
        <div className="px-4 py-6">
          <Spinner label={t('visits.loading')} />
        </div>
      </Section>
    );
  }

  return (
    <>
      <Section
        title={t('visits.who')}
        description={t('visits.whoDescription', formatDate(`${data.since}T00:00:00.000Z`, t))}
        action={fenetre}
      >
        {data.visitors.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-400">{t('visits.nobody')}</p>
        ) : (
          data.visitors.map((visiteur) => (
            <LigneVisiteur key={visiteur.username} visiteur={visiteur} />
          ))
        )}
      </Section>

      <Section title={t('visits.whichAlbums')} description={t('visits.whichAlbumsDescription')}>
        {data.albums.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-400">{t('visits.noAlbum')}</p>
        ) : (
          data.albums.map((album) => <LigneAlbum key={album.albumId} album={album} />)
        )}
      </Section>
    </>
  );
}
