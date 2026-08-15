import { type ReactElement, type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogout, useMe } from '../api/hooks';
import { useT } from '../lib/i18n';
import { useInstallPrompt } from '../lib/useInstallPrompt';
import { ActionMenu, type MenuEntry } from './ActionMenu';
import { InstallInstructions } from './InstallInstructions';
import { PoweredBy } from './PoweredBy';

/**
 * The person the session belongs to, drawn once for the three places that show
 * them: the bar's badge, the Account tab and the identifier line in the menu.
 *
 * Size and stroke come from `className` because each of the three sits among
 * icons of its own weight — 24 px at 1.75 between the tabs, 16 px at 2 inside
 * the menu — and a glyph that ignored its neighbours would be the one thing on
 * the row that looks pasted in.
 */
export function AccountIcon({ className }: { className: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

interface AccountMenuProps {
  /** Button content: the bar draws the badge, the tab bar an icon and a name. */
  trigger: ReactNode;
  triggerClassName: string;
}

/**
 * Everything the session can do, behind one target.
 *
 * It exists as its own component because **two** surfaces open it: the top bar's
 * badge above `md`, and the Account tab below it. The entries — identifier and
 * signing address, Settings, Administration, Sign out, Install — are written
 * once; a second copy would drift the day an action is added, and the divergence
 * would be visible only on one of the two screens.
 *
 * The language used to be listed here, as a group of its own below the actions.
 * It has moved to `/settings`, where the theme and what follows it join it: a
 * menu is where you act on the session, and a setting reached by scrolling past
 * "Sign out" has nowhere to put the second one.
 */
export function AccountMenu({ trigger, triggerClassName }: AccountMenuProps): ReactElement {
  const { data: user } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const install = useInstallPrompt();
  const t = useT();
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
    // First, and offered to everybody: it is the one entry here that an account
    // without the administrator flag can act on beyond leaving.
    {
      label: t('prefs.title'),
      icon: <IconeReglages />,
      onSelect: () => void navigate('/settings'),
    },
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
        // The same person the badge and the tab draw, at the size the entries
        // below use: without it the identifier started to the left of every
        // action it applies to, and read as a stray label rather than the head
        // of the list.
        headerIcon={<AccountIcon className="size-4" />}
        groupes={[compte]}
        // The one place reachable from every page, on both shapes of the
        // interface: what runs this gallery belongs at the bottom of it, under
        // everything somebody opened the menu to do.
        pied={<PoweredBy />}
      />

      {modeEmploi && <InstallInstructions onClose={() => setModeEmploi(false)} />}
    </>
  );
}

function IconeReglages(): ReactElement {
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
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.08A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
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
