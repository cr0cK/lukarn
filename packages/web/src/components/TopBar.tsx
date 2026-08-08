import { type ReactElement, type ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLogout, useMe } from '../api/hooks';
import { useInstallPrompt } from '../lib/useInstallPrompt';
import { ActionMenu, type MenuEntry } from './ActionMenu';
import { InstallInstructions } from './InstallInstructions';

/**
 * Un contrôle de vue, décrit plutôt que rendu.
 *
 * La page ne fournit plus du JSX mais ce qu'il faut pour l'afficher des deux
 * façons : en icône dans la barre, en ligne libellée dans le menu. C'est la
 * seule manière d'avoir **un** nom par contrôle — passer des `children`
 * obligeait à masquer le libellé sous `sm`, et les deux icônes se retrouvaient
 * seules sur une seconde rangée sans rien pour les nommer.
 */
export interface TopBarAction {
  /** L'état courant, affiché dans la barre : « Par mois ». */
  label: string;
  /** Ce que le déclenchement fera : « Regrouper par jour ». C'est le libellé du menu. */
  action: string;
  /** Tracé SVG, rendu en `size-4`. */
  icon: ReactNode;
  onSelect: () => void;
}

interface TopBarProps {
  title: string;
  subtitle?: string | null;
  /** Affiche une flèche de retour vers la liste des albums. */
  back?: boolean;
  /** Contrôles propres à la page, à gauche de ceux du compte. */
  actions?: TopBarAction[];
  /**
   * Ouverture du tiroir d'activité, avec le nombre de messages arrivés depuis
   * le dernier passage. Absent sur les pages où le fil n'a pas de sens.
   */
  feed?: { unread: number; onOpen: () => void };
}

const CLASSE_BOUTON =
  'flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-ink-300 transition-colors hover:bg-white/5 hover:text-ink-100 lg:px-2.5';

/**
 * Barre supérieure collante, commune à toutes les pages authentifiées.
 *
 * Une seule rangée, quelle que soit la largeur. Sous `sm`, tout ce qui n'est ni
 * le retour ni le titre passe dans un menu : cinq contrôles alignés sur 393 px
 * réduisaient le titre d'album à une initiale et repoussaient les contrôles de
 * vue sur une rangée à eux seuls, soit 101 px d'en-tête sur une application où
 * ce qui doit ressortir, ce sont les photos.
 *
 * Entre `sm` et `lg`, les contrôles reviennent dans la barre mais gardent leurs
 * seules icônes : il y a la place pour cinq cibles, pas pour cinq libellés.
 * Mesuré — à 768 px, les cinq libellés ramenaient le titre de 456 à 144 px et
 * tronquaient le sous-titre, soit exactement le défaut qu'on corrige ici.
 */
export function TopBar({
  title,
  subtitle,
  back = false,
  actions = [],
  feed,
}: TopBarProps): ReactElement {
  const { data: user } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const install = useInstallPrompt();
  const [modeEmploi, setModeEmploi] = useState(false);

  const seDeconnecter = (): void => {
    logout.mutate(undefined, { onSuccess: () => void navigate('/login', { replace: true }) });
  };
  const proposerInstallation = (): void => {
    if (install.manuel) setModeEmploi(true);
    else install.installer();
  };

  // L'installation est **la dernière**, y compris après « Déconnexion » : elle
  // apparaît et disparaît selon le navigateur et selon qu'on a déjà installé,
  // et la mettre ailleurs ferait bouger la position des contrôles permanents
  // d'une visite à l'autre.
  const compte: MenuEntry[] = [
    ...(user?.admin
      ? [{ label: 'Administration', icon: <IconeAdmin />, onSelect: () => void navigate('/admin') }]
      : []),
    { label: 'Déconnexion', icon: <IconeDeconnexion />, onSelect: seDeconnecter },
    ...(install.disponible
      ? [{ label: 'Installer', icon: <IconeInstaller />, onSelect: proposerInstallation }]
      : []),
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-ink-850 bg-ink-900/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[2000px] items-center gap-x-2 px-4 py-3 sm:gap-x-3 sm:px-6">
        {back && (
          <Link
            to="/"
            className="-ml-1 rounded-full p-2 text-ink-300 transition-colors hover:bg-white/5 hover:text-ink-100"
            aria-label="Retour aux albums"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M15 18 9 12l6-6" />
            </svg>
          </Link>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-medium tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-xs text-ink-400">{subtitle}</p>}
        </div>

        {/* L'activité reste **en ligne à toutes les largeurs**, contrairement
            aux contrôles de vue : son icône porte la pastille des non-lus, et
            c'est le seul signe qu'une conversation a bougé quelque part.
            Rangée dans le menu sous `sm`, elle ne signalerait plus rien — même
            raison que le bouton « Commentaires » de la visionneuse. */}
        {feed && (
          <button
            type="button"
            onClick={feed.onOpen}
            title="Activité récente"
            aria-label={feedLabel(feed.unread)}
            className={`relative shrink-0 rounded-lg p-2 text-ink-300 transition-colors hover:bg-white/5 hover:text-ink-100`}
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />
            </svg>
            {feed.unread > 0 && (
              <span
                aria-hidden="true"
                // Plafonnée à « 9+ », comme celle de la visionneuse : au-delà le
                // chiffre déborde de l'icône, et savoir s'il y en a douze ou
                // dix-sept ne change aucun geste.
                className="absolute top-0.5 right-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[0.625rem] leading-4 font-semibold text-ink-950 tabular-nums"
              >
                {feed.unread > 9 ? '9+' : feed.unread}
              </span>
            )}
          </button>
        )}

        {/* À partir de `sm` : tout dans la barre. Le libellé n'apparaît qu'à
            partir de `lg` — entre les deux, cinq libellés ne tiennent pas et
            c'est le titre de l'album qui payait la place. */}
        <div className="hidden shrink-0 items-center gap-1 sm:flex lg:gap-2">
          {actions.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={item.onSelect}
              title={item.action}
              // Le nom accessible dit l'état **et** l'effet du clic : sous `lg`
              // il ne reste qu'une icône, qui ne dit ni l'un ni l'autre.
              aria-label={`${item.label}. ${item.action}.`}
              className={CLASSE_BOUTON}
            >
              {item.icon}
              <span className="hidden lg:inline">{item.label}</span>
            </button>
          ))}

          {user?.admin && (
            <Link to="/admin" className={CLASSE_BOUTON} aria-label="Administration">
              <IconeAdmin />
              <span className="hidden lg:inline">Admin</span>
            </Link>
          )}

          <button
            type="button"
            onClick={seDeconnecter}
            className={CLASSE_BOUTON}
            aria-label="Déconnexion"
          >
            <IconeDeconnexion />
            <span className="hidden lg:inline">Déconnexion</span>
          </button>

          {install.disponible && (
            <button
              type="button"
              onClick={proposerInstallation}
              title="Ajouter à l'écran d'accueil"
              className={CLASSE_BOUTON}
              aria-label="Installer"
            >
              <IconeInstaller />
              <span className="hidden lg:inline">Installer</span>
            </button>
          )}
        </div>

        {/* Sous `sm` seulement : au-dessus, tout est déjà dans la barre. */}
        <div className="sm:hidden">
          <ActionMenu
            groupes={[
              actions.map((item) => ({
                label: item.action,
                icon: item.icon,
                onSelect: item.onSelect,
              })),
              compte,
            ]}
          />
        </div>
      </div>

      {modeEmploi && <InstallInstructions onClose={() => setModeEmploi(false)} />}
    </header>
  );
}
/**
 * Nom accessible du bouton d'activité : c'est lui qui porte l'information de la
 * pastille, celle-ci étant purement visuelle.
 */
function feedLabel(unread: number): string {
  if (unread === 0) return 'Activité récente';
  return `Activité récente : ${unread} message${unread > 1 ? 's' : ''} non lu${unread > 1 ? 's' : ''}`;
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
