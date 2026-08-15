import type { ReactElement } from 'react';
import { useVersion } from '../api/hooks';
import { useT } from '../lib/i18n';

/**
 * What runs this gallery, which version of it, and where to read what changed.
 *
 * Two surfaces mount it, both behind a session: the foot of the account menu,
 * reachable from every page on both shapes of the interface, and the Server
 * section of administration, where whoever operates the instance already is. One
 * component rather than two, for the reason `AccountMenu` gives about its own
 * entries — a second copy drifts the day the line gains something.
 *
 * It renders **nothing at all** until the answer arrives, and nothing ever if it
 * fails: the line is a footnote, and a footnote that shows an error or a skeleton
 * is worth less than an absent one.
 */
export function PoweredBy({ className = '' }: { className?: string }): ReactElement | null {
  const t = useT();
  const { data } = useVersion();

  if (!data) return null;

  // A released version reads `v1.2.3`; anything else reads as it is. `dev` with a
  // `v` in front would look like a version somebody could go and download.
  const version = /^\d+\.\d+\.\d+$/.test(data.version) ? `v${data.version}` : data.version;

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${className}`}>
      <p className="text-xs text-ink-400">{t('version.poweredBy', version)}</p>

      <a
        href={data.changelogUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="text-xs text-ink-300 underline underline-offset-2 hover:text-ink-100"
      >
        {t('version.changelog')}
      </a>

      {/* Only ever present for an administrator — the server decides that. The
          badge is a link to the release, not a button that updates anything:
          moving an instance from one image to another stays a decision taken on
          the machine, with a backup taken first (D260815). */}
      {data.update && (
        <a
          href={data.update.url}
          target="_blank"
          rel="noreferrer noopener"
          className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          {t('version.update', data.update.version)}
        </a>
      )}
    </div>
  );
}
