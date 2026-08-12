import type { AppSettings, UpdateSettingsRequest } from '@lukarn/shared';
import { type FormEvent, type ReactElement, useState } from 'react';
import { errorText } from '../../api/client';
import { useAdminStatus, useSettings, useUpdateSettings } from '../../api/hooks';
import { parseNumber, validateCacheSizeGB, validateIntervalMinutes } from '../../lib/adminForm';
import { Spinner } from '../Spinner';
import { Button, Checkbox, FormError, Section, TextField, type Notify } from './ui';

/** "Settings" section: sync frequency and cache size. */
export function SettingsSection({ notify }: { notify: Notify }): ReactElement {
  const { data: settings, isPending, error } = useSettings();

  return (
    <Section title="Settings" description="How often it syncs, and how much disk it takes.">
      {isPending && (
        <div className="px-4 py-6">
          <Spinner label="Loading settings" />
        </div>
      )}

      {error && (
        <div className="px-4 py-4">
          <FormError message={errorText(error, 'Cannot load the settings.')} />
        </div>
      )}

      {settings && <SettingsForm settings={settings} notify={notify} />}
    </Section>
  );
}

/**
 * Mounted only after settings load: form state is initialised from the server
 * and therefore cannot start from invented values.
 */
function SettingsForm({
  settings,
  notify,
}: {
  settings: AppSettings;
  notify: Notify;
}): ReactElement {
  const save = useUpdateSettings();
  // Already loaded by the dashboard, so this read uses the cache. Without SMTP,
  // no verification code is sent and nobody can comment — the setting must say
  // so rather than promising emails.
  const { data: status } = useAdminStatus();
  const mailConfigured = status?.mailConfigured !== false;

  const [minutes, setMinutes] = useState(String(settings.syncIntervalMinutes));
  const [onStartup, setOnStartup] = useState(settings.syncOnStartup);
  const [prewarm, setPrewarm] = useState(settings.prewarmCache);
  const [cacheSize, setCacheSize] = useState(String(settings.cacheMaxSizeGB));
  const [transcode, setTranscode] = useState(settings.transcodeVideos);
  const [videoCacheSize, setVideoCacheSize] = useState(String(settings.videoCacheMaxSizeGB));
  const [moderationEmail, setModerationEmail] = useState(settings.moderationEmail ?? '');
  const [touched, setTouched] = useState(false);

  const intervalError = validateIntervalMinutes(minutes);
  const cacheError = validateCacheSizeGB(cacheSize);
  const videoCacheError = validateCacheSizeGB(videoCacheSize);

  const parsedInterval = parseNumber(minutes);
  const parsedCache = parseNumber(cacheSize);
  const parsedVideoCache = parseNumber(videoCacheSize);
  const dirty =
    parsedInterval !== settings.syncIntervalMinutes ||
    onStartup !== settings.syncOnStartup ||
    prewarm !== settings.prewarmCache ||
    parsedCache !== settings.cacheMaxSizeGB ||
    transcode !== settings.transcodeVideos ||
    parsedVideoCache !== settings.videoCacheMaxSizeGB ||
    moderationEmail.trim() !== (settings.moderationEmail ?? '');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setTouched(true);
    if (intervalError || cacheError || videoCacheError) return;
    if (parsedInterval === null || parsedCache === null || parsedVideoCache === null) return;

    // Send only changed settings to avoid rewriting the others.
    const body: UpdateSettingsRequest = {};
    if (parsedInterval !== settings.syncIntervalMinutes) body.syncIntervalMinutes = parsedInterval;
    if (onStartup !== settings.syncOnStartup) body.syncOnStartup = onStartup;
    if (prewarm !== settings.prewarmCache) body.prewarmCache = prewarm;
    if (parsedCache !== settings.cacheMaxSizeGB) body.cacheMaxSizeGB = parsedCache;
    if (transcode !== settings.transcodeVideos) body.transcodeVideos = transcode;
    if (parsedVideoCache !== settings.videoCacheMaxSizeGB) {
      body.videoCacheMaxSizeGB = parsedVideoCache;
    }
    if (moderationEmail.trim() !== (settings.moderationEmail ?? '')) {
      body.moderationEmail = moderationEmail.trim();
    }
    if (Object.keys(body).length === 0) return;

    save.mutate(body, {
      onSuccess: () => notify({ tone: 'ok', text: 'Settings saved.' }),
    });
  };

  const reset = (): void => {
    setMinutes(String(settings.syncIntervalMinutes));
    setOnStartup(settings.syncOnStartup);
    setPrewarm(settings.prewarmCache);
    setCacheSize(String(settings.cacheMaxSizeGB));
    setTranscode(settings.transcodeVideos);
    setVideoCacheSize(String(settings.videoCacheMaxSizeGB));
    setModerationEmail(settings.moderationEmail ?? '');
    setTouched(false);
  };

  return (
    <form onSubmit={submit} className="space-y-4 px-4 py-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="settings-interval"
          label="Sync interval (minutes)"
          value={minutes}
          onChange={setMinutes}
          inputMode="numeric"
          disabled={save.isPending}
          error={touched ? intervalError : null}
          hint="0 disables automatic syncing; a manual resync stays available."
        />

        <TextField
          id="settings-cache"
          label="Maximum cache size (GB)"
          value={cacheSize}
          onChange={setCacheSize}
          inputMode="decimal"
          disabled={save.isPending}
          error={touched ? cacheError : null}
          hint="Thumbnails and renders. Past it, the oldest entries are evicted."
        />

        <TextField
          id="settings-video-cache"
          label="Maximum size of prepared videos (GB)"
          value={videoCacheSize}
          onChange={setVideoCacheSize}
          inputMode="decimal"
          disabled={save.isPending}
          error={touched ? videoCacheError : null}
          hint="A budget of its own, separate from thumbnails: a video costs minutes of CPU, a thumbnail a few seconds. Reckon about 95 MB per minute of 1080p footage."
        />
      </div>

      <TextField
        id="settings-moderation-email"
        label="Address told about new comments"
        type="email"
        value={moderationEmail}
        onChange={setModerationEmail}
        disabled={save.isPending}
        hint={
          mailConfigured
            ? 'Gets an email for every comment posted. Empty: no moderation alert.'
            : 'No SMTP server configured: filled in, it will receive nothing — and nobody can comment for as long as verification codes cannot be sent.'
        }
      />

      <Checkbox
        id="settings-startup"
        label="Sync when the server starts"
        checked={onStartup}
        onChange={setOnStartup}
        disabled={save.isPending}
        hint="Useful after a restart; avoid it if startup has to be immediate."
      />

      <Checkbox
        id="settings-prewarm"
        label="Prepare photos in advance"
        checked={prewarm}
        onChange={setPrewarm}
        disabled={save.isPending}
        hint="Renders photos in the background, one at a time, newest to oldest: the first opening goes from a few seconds to instant. Untick it if the bandwidth of the server is metered."
      />

      <Checkbox
        id="settings-transcode"
        label="Prepare the videos the browser cannot play"
        checked={transcode}
        onChange={setTranscode}
        disabled={save.isPending}
        hint="Converts HEVC videos in the background, one at a time and at low priority: reckon about a minute of CPU per minute of footage. Without it, they stay downloadable only."
      />

      <FormError message={save.error ? errorText(save.error, 'Saving failed.') : null} />

      <div className="flex justify-end gap-2">
        <Button onClick={reset} disabled={!dirty || save.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!dirty || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
