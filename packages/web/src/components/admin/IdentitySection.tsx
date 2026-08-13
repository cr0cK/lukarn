import {
  LOGO_MAX_BYTES,
  derivePalette,
  paletteProperties,
  type AppSettings,
  type UpdateSettingsRequest,
} from '@lukarn/shared';
import { type CSSProperties, type FormEvent, type ReactElement, useRef, useState } from 'react';
import { errorText } from '../../api/client';
import {
  useAdminStatus,
  useResetLogo,
  useSettings,
  useUpdateSettings,
  useUploadLogo,
} from '../../api/hooks';
import { validateInstanceName, validatePrimaryColor } from '../../lib/adminForm';
import { applyPalette, logoChanged } from '../../lib/branding';
import { useT } from '../../lib/i18n';
import { Brand } from '../Brand';
import { Spinner } from '../Spinner';
import { Button, FormError, Section, TextField, type Notify } from './ui';

/**
 * "Identity": the name, the colour and the mark a visitor meets.
 *
 * Its own tab rather than a block under "Server", which is about the machine —
 * disk budgets, sync cadence, Drive consent. Nothing here changes what the
 * instance does; it changes what it looks like, and the person renaming their
 * gallery is not the person raising a cache limit.
 */
export function IdentitySection({ notify }: { notify: Notify }): ReactElement {
  const t = useT();
  const { data: settings, isPending, error } = useSettings();

  return (
    <Section title={t('brand.title')} description={t('brand.description')}>
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

      {settings && <IdentityForm settings={settings} notify={notify} />}
    </Section>
  );
}

/** Mounted only once settings load, like `SettingsForm`: no invented starting values. */
function IdentityForm({
  settings,
  notify,
}: {
  settings: AppSettings;
  notify: Notify;
}): ReactElement {
  const t = useT();
  const save = useUpdateSettings();
  const upload = useUploadLogo();
  const reset = useResetLogo();
  const { data: status } = useAdminStatus();
  const fileInput = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(settings.instanceName);
  const [color, setColor] = useState(settings.primaryColor);
  const [touched, setTouched] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const nameError = validateInstanceName(name, t);
  const colorError = validatePrimaryColor(color, t);
  const dirty = name.trim() !== settings.instanceName || color !== settings.primaryColor;
  const busy = save.isPending || upload.isPending || reset.isPending;

  // The preview is computed from the same shared function the server uses, so what
  // it shows is what a reload would show — not an approximation of it.
  const preview = paletteProperties(derivePalette(colorError ? settings.primaryColor : color));

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setTouched(true);
    if (nameError || colorError) return;

    const body: UpdateSettingsRequest = {};
    if (name.trim() !== settings.instanceName) body.instanceName = name.trim();
    if (color !== settings.primaryColor) body.primaryColor = color;
    if (Object.keys(body).length === 0) return;

    save.mutate(body, {
      onSuccess: (saved) => {
        // The page already open keeps the palette the server wrote at load time.
        // Pushing the saved one onto `<html>` is what makes the top bar, the tab
        // borders and every button follow without a reload.
        applyPalette(saved.primaryColor);
        // The mark's dot carries that colour too, and the mark is an image: CSS
        // does not reach it, and the browser makes no request for something
        // already on screen. Without this, every button turns and the logo beside
        // them stays the old colour — the one place the change is most visible.
        if (body.primaryColor) logoChanged();
        notify({ tone: 'ok', text: t('brand.saved') });
      },
    });
  };

  const chooseFile = (): void => {
    setFileError(null);
    fileInput.current?.click();
  };

  const send = (file: File | undefined): void => {
    if (!file) return;
    // Checked here as well as on the route: a 512 kB body refused by Fastify comes
    // back as a bare 413, after the whole file has crossed the network.
    if (file.size > LOGO_MAX_BYTES) {
      setFileError(t('brand.logoTooLarge', Math.round(LOGO_MAX_BYTES / 1024)));
      return;
    }
    setFileError(null);
    upload.mutate(file, { onSuccess: () => notify({ tone: 'ok', text: t('brand.logoSaved') }) });
  };

  const revert = (): void => {
    setName(settings.instanceName);
    setColor(settings.primaryColor);
    setTouched(false);
  };

  return (
    <form onSubmit={submit} className="space-y-5 px-4 py-4">
      <TextField
        id="brand-name"
        label={t('brand.name')}
        value={name}
        onChange={setName}
        disabled={busy}
        error={touched ? nameError : null}
        hint={t('brand.nameHint')}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          {/* The swatch and the text field edit the same value from either end:
              the picker for choosing, the text for pasting a colour a brand
              already has. Neither is the authority — `color` is.

              The field comes **first** so its label starts at the section's left
              edge like every other one; leading with the swatch indented the word
              "Primary colour" by the swatch's width, and it was the only label in
              the form that did not line up. */}
          <div className="flex items-end gap-3">
            <div className="min-w-0 flex-1">
              <TextField
                id="brand-color"
                label={t('brand.color')}
                value={color}
                onChange={(value) => setColor(value.trim().toLowerCase())}
                disabled={busy}
                error={touched ? colorError : null}
              />
            </div>
            <input
              type="color"
              aria-label={t('brand.color')}
              value={colorError ? settings.primaryColor : color}
              disabled={busy}
              onChange={(event) => setColor(event.target.value)}
              className="mb-px size-10 shrink-0 cursor-pointer rounded-lg border border-ink-700 bg-ink-850 p-1"
            />
          </div>
          <p className="mt-1 text-xs text-ink-400">{t('brand.colorHint')}</p>
        </div>

        <div>
          <p className="mb-1.5 text-sm text-ink-300">{t('brand.preview')}</p>
          <div
            style={preview as CSSProperties}
            className="flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5"
          >
            <span className="size-5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            <span className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink">
              {t('common.save')}
            </span>
            <span className="min-w-0 truncate rounded-lg bg-accent-soft px-3 py-1.5 text-sm text-ink-200">
              {t('brand.previewHover')}
            </span>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-sm text-ink-300">{t('brand.logo')}</p>
        {/* Stacked below `sm`, a row above it — the same rule as `ROW_CLASS`, for
            the same reason: side by side on a 393 px screen only the sentence can
            shrink, and it came out four words tall between the mark and a button
            that refuses to wrap. */}
        <div className="flex flex-col gap-3 rounded-lg border border-ink-700 bg-ink-850 px-3 py-3 sm:flex-row sm:items-center sm:gap-4">
          <Brand />
          <p className="min-w-0 flex-1 text-xs text-ink-400">
            {t(status?.logoCustom ? 'brand.logoCustom' : 'brand.logoBuiltIn')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={chooseFile} disabled={busy}>
              {t(status?.logoCustom ? 'brand.logoReplace' : 'brand.logoChoose')}
            </Button>
            {status?.logoCustom && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  reset.mutate(undefined, {
                    onSuccess: () => notify({ tone: 'ok', text: t('brand.logoRemoved') }),
                  })
                }
              >
                {t('brand.logoReset')}
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1 text-xs text-ink-400">{t('brand.logoHint')}</p>
        {/* Hidden rather than styled: a file input cannot be made to match the
            other buttons, and every browser draws its own. `value` is cleared on
            each change so choosing the same file twice still fires. */}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            send(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <FormError message={fileError} />
        <FormError
          message={
            upload.error || reset.error
              ? errorText(upload.error ?? reset.error, t('common.saveFailed'))
              : null
          }
        />
      </div>

      <FormError message={save.error ? errorText(save.error, t('common.saveFailed')) : null} />

      <div className="flex justify-end gap-2">
        <Button onClick={revert} disabled={!dirty || busy}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={!dirty || busy}>
          {t(save.isPending ? 'common.saving' : 'common.save')}
        </Button>
      </div>
    </form>
  );
}
