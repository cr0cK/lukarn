import type { Locale } from '@lukarn/shared';
import { type ReactElement, type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogout, useMe } from '../api/hooks';
import { AVAILABLE_LOCALES, LOCALE_NAMES, useLocale, useT } from '../lib/i18n';
import { useInstallPrompt } from '../lib/useInstallPrompt';
import { ActionMenu, type MenuEntry } from './ActionMenu';
import { InstallInstructions } from './InstallInstructions';
import { PoweredBy } from './PoweredBy';

/**
 * Account initial when there is no photo to display.
 *
 * Use `Array.from` rather than `[0]`: an identifier may start outside the Basic
 * Multilingual Plane — an emoji or ideogram — where indexed access would return
 * only half and display a replacement character.
 */
export function accountInitial(username: string): string {
  return Array.from(username)[0]?.toUpperCase() ?? '?';
}

interface AccountMenuProps {
  /** Button content: the bar draws an initial, the tab bar an icon and a name. */
  trigger: ReactNode;
  triggerClassName: string;
}

/**
 * Everything the session can do, behind one target.
 *
 * It exists as its own component because **two** surfaces open it: the top bar's
 * badge above `md`, and the Account tab below it. The entries — identifier and
 * signing address, Administration, Sign out, Install, then the languages — are
 * written once; a second copy would drift the day a language or an action is
 * added, and the divergence would be visible only on one of the two screens.
 */
export function AccountMenu({ trigger, triggerClassName }: AccountMenuProps): ReactElement {
  const { data: user } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const install = useInstallPrompt();
  const t = useT();
  const { locale, setLocale } = useLocale();
  const [modeEmploi, setModeEmploi] = useState(false);

  const seDeconnecter = (): void => {
    logout.mutate(undefined, { onSuccess: () => void navigate('/login', { replace: true }) });
  };
  const proposerInstallation = (): void => {
    if (install.manuel) setModeEmploi(true);
    else install.installer();
  };

  // Installation is **last**, even after "Sign out": it appears and disappears
  // by browser and installation status, and placing it elsewhere would shift
  // permanent controls between visits.
  const compte: MenuEntry[] = [
    ...(user?.admin
      ? [
          {
            label: t('topbar.admin'),
            icon: <IconeAdmin />,
            onSelect: () => void navigate('/admin'),
          },
        ]
      : []),
    { label: t('topbar.signOut'), icon: <IconeDeconnexion />, onSelect: seDeconnecter },
    ...(install.disponible
      ? [{ label: t('topbar.install'), icon: <IconeInstaller />, onSelect: proposerInstallation }]
      : []),
  ];

  // Its own group, below the account actions: changing language is a setting,
  // not an action on the session, and the rule separating them says so without a
  // heading. Every language is listed with a tick on the current one rather than
  // one entry toggling between two — a third language would otherwise have
  // nowhere to go, and a toggle never says what it will switch to.
  const langues: MenuEntry[] = AVAILABLE_LOCALES.map((code: Locale) => ({
    label: LOCALE_NAMES[code],
    icon: code === locale ? <IconeCoche /> : <span className="block size-4" aria-hidden="true" />,
    checked: code === locale,
    onSelect: () => setLocale(code),
  }));

  return (
    <>
      <ActionMenu
        label={t('topbar.account')}
        trigger={trigger}
        triggerClassName={triggerClassName}
        // The identifier opens albums and may be shared by a household; the
        // address says who signs comments. Show both when they differ — precisely
        // when someone wonders which name they write under.
        entete={user ? [user.username, ...(user.identity ? [user.identity.email] : [])] : undefined}
        groupes={[compte, langues]}
        // The one place reachable from every page, on both shapes of the
        // interface: what runs this gallery belongs at the bottom of it, under
        // everything somebody opened the menu to do.
        pied={<PoweredBy />}
      />

      {modeEmploi && <InstallInstructions onClose={() => setModeEmploi(false)} />}
    </>
  );
}

/** Tick beside the active language. Purely visual: `aria-checked` says it. */
function IconeCoche(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 13 4 4 10-10" />
    </svg>
  );
}

function IconeAdmin(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
    </svg>
  );
}

function IconeDeconnexion(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

function IconeInstaller(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}
