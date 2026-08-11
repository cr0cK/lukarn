import type { AppSettings, UpdateSettingsRequest } from '@nonni/shared';
import { type FormEvent, type ReactElement, useState } from 'react';
import { errorText } from '../../api/client';
import { useAdminStatus, useSettings, useUpdateSettings } from '../../api/hooks';
import { parseNumber, validateCacheSizeGB, validateIntervalMinutes } from '../../lib/adminForm';
import { Spinner } from '../Spinner';
import { Button, Checkbox, FormError, Section, TextField, type Notify } from './ui';

/** Section « Réglages » : rythme des synchronisations et taille du cache. */
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
 * Monté seulement une fois les réglages chargés : l'état du formulaire est
 * initialisé depuis le serveur, il ne peut donc pas partir de valeurs inventées.
 */
function SettingsForm({
  settings,
  notify,
}: {
  settings: AppSettings;
  notify: Notify;
}): ReactElement {
  const save = useUpdateSettings();
  // Déjà chargé par le tableau de bord : cette lecture sert le cache. Sans SMTP,
  // aucun code de vérification ne part, donc personne ne peut commenter — le
  // réglage doit le dire au lieu de laisser espérer des emails.
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

    // Seuls les réglages modifiés partent, pour ne pas réécrire les autres.
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
