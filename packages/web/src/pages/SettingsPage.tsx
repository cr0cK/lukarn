import { DISPLAY_NAME_MAX_LENGTH, isLocale, type CommenterIdentity } from '@lukarn/shared';
import { type FormEvent, type ReactElement, useEffect, useState } from 'react';
import { errorText } from '../api/client';
import { useMe, useUpdateProfile } from '../api/hooks';
import { BottomTabs } from '../components/BottomTabs';
import { CommentsFeed, useActivityFeed } from '../components/CommentsFeed';
import { TopBar } from '../components/TopBar';
import {
  Button,
  Checkbox,
  Section,
  SelectField,
  TextField,
  localeOptions,
  type Notice,
  type SelectOption,
} from '../components/admin/ui';
import { isProfileDirty, validateDisplayName } from '../lib/adminForm';
import { useLocale, useT } from '../lib/i18n';
import { THEMES, isTheme, readStoredTheme, setTheme, useTheme, type Theme } from '../lib/theme';

/**
 * Member identity and notification preferences.
 *
 * Shown only when the active session is bound to a verified commenter identity.
 * Shared household accounts without an individual identity do not see this section.
 */
function ProfileSection({
  identity,
  updateProfile,
}: {
  identity: CommenterIdentity;
  updateProfile: ReturnType<typeof useUpdateProfile>;
}): ReactElement {
  const t = useT();
  const [displayName, setDisplayName] = useState(identity.displayName);
  const [notify, setNotify] = useState(identity.notify);
  const [touched, setTouched] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Synchronize local form state if identity data changes from the server
  useEffect(() => {
    setDisplayName(identity.displayName);
    setNotify(identity.notify);
  }, [identity.displayName, identity.notify]);

  const nameError = touched ? validateDisplayName(displayName, t) : null;
  const isValid = validateDisplayName(displayName, t) === null;
  const isDirty = isProfileDirty(displayName, notify, identity);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setTouched(true);
    const trimmed = displayName.trim();
    if (!isValid || !isDirty || updateProfile.isPending) return;

    updateProfile.mutate(
      { displayName: trimmed, notify },
      {
        onSuccess: () => {
          setNotice({ tone: 'ok', text: t('prefs.profileSaved') });
          setTouched(false);
        },
        onError: (err) => {
          setNotice({ tone: 'error', text: errorText(err, t('common.saveFailed')) });
        },
      },
    );
  };

  return (
    <Section title={t('prefs.profileSection')} description={t('prefs.profileScope')}>
      <form onSubmit={submit} className="space-y-4 px-4 py-4">
        {notice && (
          <p
            role="status"
            className={`rounded-lg px-4 py-3 text-sm ${
              notice.tone === 'ok'
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-red-500/15 text-red-300'
            }`}
          >
            {notice.text}
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="ml-3 text-xs underline underline-offset-2 opacity-70 hover:opacity-100"
            >
              {t('common.hide')}
            </button>
          </p>
        )}

        <TextField
          id="prefs-email"
          label={t('prefs.email')}
          value={identity.email}
          onChange={() => {}}
          readOnly
          hint={t('prefs.emailHint')}
        />

        <TextField
          id="prefs-display-name"
          label={t('prefs.displayName')}
          value={displayName}
          onChange={(val) => {
            setDisplayName(val.slice(0, DISPLAY_NAME_MAX_LENGTH));
            setTouched(true);
          }}
          placeholder={t('identity.namePlaceholder')}
          hint={t('prefs.displayNameHint')}
          error={nameError}
          disabled={updateProfile.isPending}
        />

        <Checkbox
          id="prefs-notify"
          label={t('prefs.notify')}
          hint={t('prefs.notifyHint')}
          checked={notify}
          onChange={(val) => {
            setNotify(val);
            setTouched(true);
          }}
          disabled={updateProfile.isPending}
        />

        <div className="pt-2">
          <Button
            type="submit"
            variant="primary"
            disabled={!isDirty || !isValid || updateProfile.isPending}
          >
            {updateProfile.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

/**
 * What the reader decides for themselves, at `/settings`.
 *
 * Not administration: nothing here touches the instance, so an account without
 * the administrator flag reaches it. It exists because the language used to live
 * in the account menu, beside "Sign out" and "Install" — a setting among
 * actions, with nowhere to put the second one.
 *
 * It borrows administration's shape rather than inventing a second one: the same
 * top bar, the same `Section` boxes, the same rows on a phone. What it does not
 * borrow is the sidebar — two settings do not need a column naming the screen
 * they are already on. Sections can be split out the day there are enough of
 * them, without moving the address.
 */
export default function SettingsPage(): ReactElement {
  const t = useT();
  const { data: user } = useMe();
  const updateProfile = useUpdateProfile();
  const { locale, setLocale } = useLocale();
  const theme = useTheme();
  // Administration carries the tab bar on a phone and so does this screen: a tab
  // that goes missing on one page is exactly the irregularity the bar removes.
  const activity = useActivityFeed();

  const themes: SelectOption[] = THEMES.map((name: Theme) => ({
    value: name,
    label: t(name === 'dark' ? 'prefs.themeDark' : 'prefs.themeLight'),
  }));

  return (
    <div className="min-h-full">
      <TopBar title={t('prefs.title')} back backTo="/" />

      {/* 48 rem rather than administration's 90: that width exists for album rows
          and a moderation queue, and a column three times the length of a
          dropdown would leave each setting alone at the end of an empty line. */}
      {/* The tab bar is `fixed` and therefore outside the flow: the page reserves
          its height itself, or the last setting would end underneath it. */}
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 pb-[calc(5rem_+_env(safe-area-inset-bottom))] sm:px-6 md:pb-6">
        {user?.identity && (
          <ProfileSection identity={user.identity} updateProfile={updateProfile} />
        )}

        {/* One box rather than one per setting: they are all answers to the same
            question — how this browser shows the gallery — and the description
            states once, for both, where the answer is kept. */}
        <Section title={t('prefs.section')} description={t('prefs.scope')}>
          <div className="space-y-4 px-4 py-4">
            <SelectField
              id="prefs-language"
              label={t('prefs.language')}
              value={locale}
              options={localeOptions()}
              // Guarded rather than cast: a `select` hands back a string, and
              // the one place that decides what counts as a language is the
              // predicate `lib/i18n/locale.ts` already reads storage with.
              onChange={(value) => isLocale(value) && setLocale(value)}
            />

            {/* Until somebody opens this row, the device answers for them — which
                is why the hint says so rather than leaving a value nobody chose
                looking like one they did. Choosing here settles it for good on
                this browser: a phone that turns dark at night must not undo a
                reader's decision every evening. */}
            <SelectField
              id="prefs-theme"
              label={t('prefs.theme')}
              value={theme}
              options={themes}
              // Guarded rather than cast, as above: a `select` hands back a
              // string, and `lib/theme.ts` owns what counts as a theme.
              onChange={(value) => isTheme(value) && setTheme(value)}
              hint={readStoredTheme() ? undefined : t('prefs.themeHint')}
            />
          </div>
        </Section>
      </main>

      <BottomTabs current={null} activity={activity} />

      {activity.isOpen && (
        <CommentsFeed albumId={null} albumTitle={null} onClose={activity.close} />
      )}
    </div>
  );
}
