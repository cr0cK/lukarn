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
  /**
   * Le **contenu** d'un `<svg viewBox="0 0 24 24">` — des `path`, des `rect` —,
   * pas la balise. C'est la barre qui l'enveloppe, et elle seule sait à quelle
   * taille : 20 px alignée sur les autres icônes de la rangée, 16 px dans le
   * menu où toutes les entrées de l'application s'accordent. Une page qui
   * livrerait le `<svg>` tout fait imposerait la même aux deux, et c'est
   * l'écart de quatre pixels qu'on voyait dans la barre.
   *
   * Même convention que les actions de `Lightbox`.
   */
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
   * Champ de recherche, **centré** dans la barre : le titre et les contrôles du
   * compte se partagent le reste à parts égales de part et d'autre.
   *
   * Un `ReactNode` et non un descripteur à la `TopBarAction` : le champ n'a
   * qu'un seul rendu — il ne se replie pas en entrée de menu —, et son état
   * appartient à la page qui le monte, pas à la barre qui l'héberge.
   */
  search?: ReactNode;
  /**
   * Ouverture du tiroir d'activité, avec le nombre de messages arrivés depuis
   * le dernier passage. Absent sur les pages où le fil n'a pas de sens.
   */
  feed?: { unread: number; onOpen: () => void };
}

/**
 * Un contrôle de vue : une icône, rien d'autre.
 *
 * Boîte carrée de 36 px — le retrait compense les 16 px du tracé pour retomber
 * sur celle du fil d'activité, qui en fait 20. Sans le libellé qui les
 * allongeait, deux cibles de 28 px voisinaient avec une de 36 dans la même
 * rangée, et l'écart devenait le seul irrégulier d'un alignement par ailleurs
 * régulier.
 */
const CLASSE_BOUTON =
  'flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-white/5 hover:text-ink-100';

const CLASSE_PASTILLE =
  'flex size-8 shrink-0 items-center justify-center rounded-full bg-ink-700 text-sm font-medium text-ink-200 transition-colors hover:bg-ink-600 hover:text-ink-100';

/**
 * L'initiale du compte, faute d'une photo à afficher.
 *
 * `Array.from` plutôt que `[0]` : un identifiant peut commencer hors du plan de
 * base — un emoji, un idéogramme —, dont l'accès indexé ne rendrait que la
 * moitié, soit un caractère de remplacement à l'écran.
 */
const initiale = (username: string): string => Array.from(username)[0]?.toUpperCase() ?? '?';

/**
 * Barre supérieure collante, commune à toutes les pages authentifiées.
 *
 * Une seule rangée, quelle que soit la largeur, et deux familles qui ne se
 * mélangent pas : **ce que fait cette page** — les contrôles de vue — puis, tout
 * à droite, **qui la regarde** — la pastille du compte, qui ne s'ouvre que si on
 * le demande. Admin, Déconnexion et Installer n'ont plus à tenir dans la barre,
 * ce qui rend au titre la largeur qu'ils lui prenaient.
 *
 * Sous `sm`, les contrôles de vue passent à leur tour dans un menu : cinq
 * contrôles alignés sur 393 px réduisaient le titre d'album à une initiale et
 * les repoussaient sur une rangée à eux seuls, soit 101 px d'en-tête sur une
 * application où ce qui doit ressortir, ce sont les photos.
 *
 * Entre `sm` et `lg`, ils reviennent dans la barre mais gardent leurs seules
 * icônes. Mesuré — à 768 px, afficher les libellés ramenait le titre de 456 à
 * 144 px et tronquait le sous-titre, soit exactement le défaut qu'on corrige.
 */
export function TopBar({
  title,
  subtitle,
  back = false,
  actions = [],
  search,
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
    { label: 'Sign out', icon: <IconeDeconnexion />, onSelect: seDeconnecter },
    ...(install.disponible
      ? [{ label: 'Installer', icon: <IconeInstaller />, onSelect: proposerInstallation }]
      : []),
  ];

  return (
    // `ink-800` sur un corps en `ink-900` : la barre est une surface, pas une
    // portion de page. Aux deux mêmes valeurs, elle ne tenait que par son filet
    // d'un pixel, et ce qui s'y trouve isolé — la pastille, à l'autre bout d'un
    // écran large — paraissait posé sur le vide. Le filet monte d'autant, sans
    // quoi il disparaîtrait dans le fond qu'il est censé délimiter.
    <header className="sticky top-0 z-30 border-b border-ink-700 bg-ink-800/85 backdrop-blur-md">
      {/* `min-h-16` : la hauteur est **réservée**, jamais déduite du contenu.
          Une page sans sous-titre — la liste des albums — donnait sinon une
          barre de 57 px là où une page d'album en fait 65, et tout ce qui y est
          centré sautait de 8 px d'une navigation à l'autre. La pastille, seule à
          son extrémité, est ce qui le montrait le mieux. */}
      <div className="mx-auto flex min-h-16 max-w-[2000px] items-center gap-x-2 px-4 py-3 sm:gap-x-3 sm:px-6">
        {back && (
          <Link
            to="/"
            className="-ml-1 rounded-full p-2 text-ink-300 transition-colors hover:bg-white/5 hover:text-ink-100"
            aria-label="Back to the albums"
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

        {/* Le titre s'efface sous `sm` quand la page porte un champ de
            recherche : la rangée reste unique à toutes les largeurs, et sur la
            racine « Albums » ne dit rien que l'URL ne dise déjà. Le champ, lui,
            ne se replie nulle part — un menu ne se cherche pas dedans. */}
        <div className={`min-w-0 flex-1 ${search ? 'hidden sm:block' : ''}`}>
          <h1 className="truncate text-base font-medium tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-xs text-ink-400">{subtitle}</p>}
        </div>

        {/* Centré, et c'est ce qui fixe la largeur : à partir de `sm` le champ
            ne s'étire plus, il tient 20 rem et ce sont les deux côtés qui se
            partagent le reste à parts égales — d'où le `flex-1` symétrique sur
            le titre et sur le groupe de droite. Étiré, il collait aux contrôles
            du compte et la barre paraissait pencher de ce côté.

            Sous `sm` il reprend toute la ligne : le titre s'efface, et 20 rem
            fixes y laisseraient un blanc au milieu d'un écran de 393 px. */}
        {search && <div className="min-w-0 flex-1 sm:flex-none sm:basis-80">{search}</div>}

        <div
          className={`flex shrink-0 items-center gap-x-2 sm:gap-x-3 ${
            search ? 'sm:flex-1 sm:justify-end' : ''
          }`}
        >
          {/* L'activité reste **en ligne à toutes les largeurs**, contrairement
            aux contrôles de vue : son icône porte la pastille des non-lus, et
            c'est le seul signe qu'une conversation a bougé quelque part.
            Rangée dans le menu sous `sm`, elle ne signalerait plus rien — même
            raison que le bouton « Commentaires » de la visionneuse. */}
          {feed && (
            <button
              type="button"
              onClick={feed.onOpen}
              title="Recent activity"
              aria-label={feedLabel(feed.unread)}
              className={`relative flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-white/5 hover:text-ink-100`}
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

          {/* À partir de `sm` : les contrôles de vue dans la barre, **en icônes
            seules à toutes les largeurs**. Le libellé y revenait au-delà de
            `lg`, et « Plus récentes d'abord » y tenait à lui seul plus de place
            que le sous-titre de l'album : deux réglages qu'on touche une fois
            par visite pesaient en permanence autant que ce qu'ils règlent. Ils
            se nomment au survol, comme le reste des icônes de cette interface.

            L'infobulle dit l'état **et** l'effet du clic, la même phrase que le
            nom accessible : une icône seule ne dit ni l'un ni l'autre, et
            n'annoncer que l'effet laisserait deviner d'où l'on part. */}
          <div className="hidden shrink-0 items-center gap-1 sm:flex lg:gap-2">
            {actions.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={item.onSelect}
                title={`${item.label} — ${item.action}`}
                aria-label={`${item.label}. ${item.action}.`}
                className={CLASSE_BOUTON}
              >
                <IconeAction taille="size-5">{item.icon}</IconeAction>
              </button>
            ))}
          </div>

          {/* Sous `sm` seulement, et seulement s'il y a quelque chose à y mettre :
            un menu vide n'offrirait qu'une cible qui ne fait rien. */}
          {actions.length > 0 && (
            <div className="sm:hidden">
              <ActionMenu
                label="View"
                groupes={[
                  actions.map((item) => ({
                    label: item.action,
                    icon: <IconeAction taille="size-4">{item.icon}</IconeAction>,
                    onSelect: item.onSelect,
                  })),
                ]}
              />
            </div>
          )}

          {/* Le compte, à toutes les largeurs. Rendu seulement une fois la session
            connue : une pastille sans initiale le temps d'un aller-retour
            réseau, puis une lettre, ferait sursauter la barre à chaque page. */}
          {user && (
            <ActionMenu
              label="Account"
              // L'initiale de l'identifiant, pas celle du nom d'affichage : c'est
              // la première ligne du menu qu'elle abrège, et deux lettres
              // différentes de part et d'autre du clic se liraient comme un défaut.
              trigger={initiale(user.username)}
              triggerClassName={CLASSE_PASTILLE}
              // L'identifiant ouvre des albums et peut être partagé par tout un
              // foyer ; l'adresse, elle, dit qui signe les commentaires. Les deux
              // quand elles diffèrent — c'est justement là qu'on se demande sous
              // quel nom on écrit.
              entete={[user.username, ...(user.identity ? [user.identity.email] : [])]}
              groupes={[compte]}
            />
          )}
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
  if (unread === 0) return 'Recent activity';
  return `Recent activity: ${unread} unread message${unread > 1 ? 's' : ''}`;
}

/**
 * Enveloppe SVG d'un contrôle de vue. Le tracé vient de la page, la taille de
 * l'endroit où il s'affiche — c'est tout l'intérêt de ne pas recevoir la balise.
 */
function IconeAction({
  taille,
  children,
}: {
  taille: 'size-4' | 'size-5';
  children: ReactNode;
}): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className={taille}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      {children}
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
