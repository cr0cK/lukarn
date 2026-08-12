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
import { Spinner } from '../Spinner';
import { Button, FormError, ROW_CLASS, Section } from './ui';

/**
 * The stored label is the technical term; the displayed one is ordinary usage.
 * `tv` remains in the database because a column value is not translated.
 */
const APPAREILS: Record<DeviceKind, string> = {
  mobile: 'mobile',
  tablette: 'tablet',
  ordinateur: 'computer',
  tv: 'television',
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
  if (!iso) return <span className="text-xs text-ink-500">never</span>;
  return (
    <span className="text-xs text-ink-400" title={`${formatDateTime(iso)} UTC`}>
      {formatRelative(iso)}
    </span>
  );
}

function LigneVisiteur({ visiteur }: { visiteur: VisitorRow }): ReactElement {
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
              administrator
            </span>
          )}
          {visiteur.devices.map((appareil) => (
            <span
              key={appareil}
              className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-xs font-normal text-ink-300"
            >
              {APPAREILS[appareil]}
            </span>
          ))}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Quand iso={visiteur.lastSeenAt ?? visiteur.lastAt} />
          <span className="text-xs text-ink-600">·</span>
          <Mesure valeur={visiteur.days} unite={visiteur.days > 1 ? 'days' : 'day'} />
          <span className="text-xs text-ink-600">·</span>
          <Mesure valeur={visiteur.sessions} unite={visiteur.sessions > 1 ? 'devices' : 'device'} />
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 xl:justify-end">
        <Mesure valeur={visiteur.albums} unite={visiteur.albums > 1 ? 'albums' : 'album'} />
        <Mesure valeur={visiteur.visits} unite={visiteur.visits > 1 ? 'visits' : 'visit'} />
        <Mesure valeur={visiteur.photos} unite={visiteur.photos > 1 ? 'photos' : 'photo'} />
      </div>
    </div>
  );
}

function LigneAlbum({ album }: { album: AlbumVisitRow }): ReactElement {
  return (
    <div
      className={`${ROW_CLASS} border-b border-ink-850 px-4 py-3 last:border-b-0 xl:items-center`}
    >
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink-100">
          <span className="truncate">{album.title ?? album.albumId}</span>
          {album.title === null && (
            <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-xs font-normal text-ink-400">
              deleted
            </span>
          )}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Quand iso={album.lastAt} />
          <span className="text-xs text-ink-600">·</span>
          <Mesure valeur={album.keys} unite={album.keys > 1 ? 'keys' : 'key'} />
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 xl:justify-end">
        <Mesure valeur={album.visitors} unite={album.visitors > 1 ? 'visitors' : 'visitor'} />
        <Mesure valeur={album.visits} unite={album.visits > 1 ? 'visits' : 'visit'} />
        <Mesure valeur={album.photos} unite={album.photos > 1 ? 'photos' : 'photo'} />
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
  const [days, setDays] = useState<number>(30);
  const { data, isPending, error } = useVisits(days);

  const fenetre = (
    <div className="flex gap-1" role="group" aria-label="Measurement window">
      {VISIT_WINDOWS.map((valeur) => (
        <Button
          key={valeur}
          variant={valeur === days ? 'primary' : 'default'}
          onClick={() => setDays(valeur)}
          ariaLabel={`The last ${valeur} days`}
        >
          {valeur} d
        </Button>
      ))}
    </div>
  );

  if (error) {
    return (
      <Section title="Visits" action={fenetre}>
        <div className="px-4 py-4">
          <FormError message={errorText(error, 'Cannot load the visits.')} />
        </div>
      </Section>
    );
  }

  if (isPending) {
    return (
      <Section title="Visits" action={fenetre}>
        <div className="px-4 py-6">
          <Spinner label="Loading visits" />
        </div>
      </Section>
    );
  }

  return (
    <>
      <Section
        title="Who"
        description={`The access keys seen since ${formatDate(`${data.since}T00:00:00.000Z`)}.`}
        action={fenetre}
      >
        {data.visitors.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-400">Nobody signed in over this period.</p>
        ) : (
          data.visitors.map((visiteur) => (
            <LigneVisiteur key={visiteur.username} visiteur={visiteur} />
          ))
        )}
      </Section>

      <Section
        title="Which albums"
        description="A visitor is a session: two browsers behind the same key make two."
      >
        {data.albums.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-400">No album was opened over this period.</p>
        ) : (
          data.albums.map((album) => <LigneAlbum key={album.albumId} album={album} />)
        )}
      </Section>
    </>
  );
}
