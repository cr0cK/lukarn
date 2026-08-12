import type { AppSettings, UpdateSettingsRequest } from '@lukarn/shared';
import { type FormEvent, type ReactElement, useState } from 'react';
import { errorText } from '../../api/client';
import { useAdminStatus, useSettings, useUpdateSettings } from '../../api/hooks';
import { parseNumber, validateCacheSizeGB, validateIntervalMinutes } from '../../lib/adminForm';
import { useT } from '../../lib/i18n';
import { Spinner } from '../Spinner';
import { Button, Checkbox, FormError, Section, TextField, type Notify } from './ui';

/** "Settings" section: sync frequency and cache size. */
export function SettingsSection({ notify }: { notify: Notify }): ReactElement {
  const t = useT();
  const { data: settings, isPending, error } = useSettings();

  return (
    <Section title={t('settings.title')} description={t('settings.description')}>
      {isPending && (
        <div className="px-4 py-6">
          <Spinner label={t('settings.loading')} />
        </div>
      )}

      {error && (
        <div className="px-4 py-4">
          <FormError message={errorText(error, t('settings.loadFailed'))} />
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
  const t = useT();
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

  const intervalError = validateIntervalMinutes(minutes, t);
  const cacheError = validateCacheSizeGB(cacheSize, t);
  const videoCacheError = validateCacheSizeGB(videoCacheSize, t);

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
      onSuccess: () => notify({ tone: 'ok', text: t('settings.saved') }),
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
          label={t('settings.interval')}
          value={minutes}
          onChange={setMinutes}
          inputMode="numeric"
          disabled={save.isPending}
          error={touched ? intervalError : null}
          hint={t('settings.intervalHint')}
        />

        <TextField
          id="settings-cache"
          label={t('settings.cache')}
          value={cacheSize}
          onChange={setCacheSize}
          inputMode="decimal"
          disabled={save.isPending}
          error={touched ? cacheError : null}
          hint={t('settings.cacheHint')}
        />

        <TextField
          id="settings-video-cache"
          label={t('settings.videoCache')}
          value={videoCacheSize}
          onChange={setVideoCacheSize}
          inputMode="decimal"
          disabled={save.isPending}
          error={touched ? videoCacheError : null}
          hint={t('settings.videoCacheHint')}
        />
      </div>

      <TextField
        id="settings-moderation-email"
        label={t('settings.moderationEmail')}
        type="email"
        value={moderationEmail}
        onChange={setModerationEmail}
        disabled={save.isPending}
        hint={t(mailConfigured ? 'settings.moderationEmailHint' : 'settings.moderationEmailNoMail')}
      />

      <Checkbox
        id="settings-startup"
        label={t('settings.onStartup')}
        checked={onStartup}
        onChange={setOnStartup}
        disabled={save.isPending}
        hint={t('settings.onStartupHint')}
      />

      <Checkbox
        id="settings-prewarm"
        label={t('settings.prewarm')}
        checked={prewarm}
        onChange={setPrewarm}
        disabled={save.isPending}
        hint={t('settings.prewarmHint')}
      />

      <Checkbox
        id="settings-transcode"
        label={t('settings.transcode')}
        checked={transcode}
        onChange={setTranscode}
        disabled={save.isPending}
        hint={t('settings.transcodeHint')}
      />

      <FormError message={save.error ? errorText(save.error, t('common.saveFailed')) : null} />

      <div className="flex justify-end gap-2">
        <Button onClick={reset} disabled={!dirty || save.isPending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={!dirty || save.isPending}>
          {t(save.isPending ? 'common.saving' : 'common.save')}
        </Button>
      </div>
    </form>
  );
}
