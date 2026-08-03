import type { AppSettings, UpdateSettingsRequest } from '@gdv/shared';
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
    <Section
      title="Réglages"
      description="Rythme des synchronisations et place occupée sur disque."
    >
      {isPending && (
        <div className="px-4 py-6">
          <Spinner label="Chargement des réglages" />
        </div>
      )}

      {error && (
        <div className="px-4 py-4">
          <FormError message={errorText(error, 'Impossible de charger les réglages.')} />
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
  const [cacheSize, setCacheSize] = useState(String(settings.cacheMaxSizeGB));
  const [moderationEmail, setModerationEmail] = useState(settings.moderationEmail ?? '');
  const [touched, setTouched] = useState(false);

  const intervalError = validateIntervalMinutes(minutes);
  const cacheError = validateCacheSizeGB(cacheSize);

  const parsedInterval = parseNumber(minutes);
  const parsedCache = parseNumber(cacheSize);
  const dirty =
    parsedInterval !== settings.syncIntervalMinutes ||
    onStartup !== settings.syncOnStartup ||
    parsedCache !== settings.cacheMaxSizeGB ||
    moderationEmail.trim() !== (settings.moderationEmail ?? '');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setTouched(true);
    if (intervalError || cacheError || parsedInterval === null || parsedCache === null) return;

    // Seuls les réglages modifiés partent, pour ne pas réécrire les autres.
    const body: UpdateSettingsRequest = {};
    if (parsedInterval !== settings.syncIntervalMinutes) body.syncIntervalMinutes = parsedInterval;
    if (onStartup !== settings.syncOnStartup) body.syncOnStartup = onStartup;
    if (parsedCache !== settings.cacheMaxSizeGB) body.cacheMaxSizeGB = parsedCache;
    if (moderationEmail.trim() !== (settings.moderationEmail ?? '')) {
      body.moderationEmail = moderationEmail.trim();
    }
    if (Object.keys(body).length === 0) return;

    save.mutate(body, {
      onSuccess: () => notify({ tone: 'ok', text: 'Réglages enregistrés.' }),
    });
  };

  const reset = (): void => {
    setMinutes(String(settings.syncIntervalMinutes));
    setOnStartup(settings.syncOnStartup);
    setCacheSize(String(settings.cacheMaxSizeGB));
    setModerationEmail(settings.moderationEmail ?? '');
    setTouched(false);
  };

  return (
    <form onSubmit={submit} className="space-y-4 px-4 py-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="settings-interval"
          label="Intervalle de synchronisation (minutes)"
          value={minutes}
          onChange={setMinutes}
          inputMode="numeric"
          disabled={save.isPending}
          error={touched ? intervalError : null}
          hint="0 désactive la synchronisation automatique ; la resynchronisation manuelle reste possible."
        />

        <TextField
          id="settings-cache"
          label="Taille maximale du cache (Go)"
          value={cacheSize}
          onChange={setCacheSize}
          inputMode="decimal"
          disabled={save.isPending}
          error={touched ? cacheError : null}
          hint="Vignettes et rendus. Au-delà, les entrées les plus anciennes sont évincées."
        />
      </div>

      <TextField
        id="settings-moderation-email"
        label="Adresse prévenue des nouveaux commentaires"
        type="email"
        value={moderationEmail}
        onChange={setModerationEmail}
        disabled={save.isPending}
        hint={
          mailConfigured
            ? 'Reçoit un email à chaque commentaire posté. Vide : aucune alerte de modération.'
            : 'Aucun serveur SMTP configuré : renseignée, elle ne recevra rien — et personne ne peut commenter tant que les codes de vérification ne peuvent pas partir.'
        }
      />

      <Checkbox
        id="settings-startup"
        label="Synchroniser au démarrage du serveur"
        checked={onStartup}
        onChange={setOnStartup}
        disabled={save.isPending}
        hint="Utile après un redémarrage ; à éviter si le démarrage doit être immédiat."
      />

      <FormError
        message={save.error ? errorText(save.error, "L'enregistrement a échoué.") : null}
      />

      <div className="flex justify-end gap-2">
        <Button onClick={reset} disabled={!dirty || save.isPending}>
          Annuler
        </Button>
        <Button type="submit" variant="primary" disabled={!dirty || save.isPending}>
          {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </form>
  );
}
