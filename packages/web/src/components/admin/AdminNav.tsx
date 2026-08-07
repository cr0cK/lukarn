import type { ReactElement } from 'react';
import { NavLink } from 'react-router-dom';

/**
 * Les rubriques de l'administration, dans leur ordre d'affichage.
 *
 * Source unique : la navigation les rend, et `AdminPage` valide contre cette
 * liste le segment d'URL qu'elle reçoit. Une rubrique ajoutée ici n'a pas de
 * second endroit à mettre à jour.
 */
export const ADMIN_TABS = [
  { slug: 'albums', label: 'Albums' },
  { slug: 'comptes', label: 'Comptes' },
  { slug: 'commentaires', label: 'Commentaires' },
  { slug: 'serveur', label: 'Serveur' },
] as const;

/** Rubrique d'administration, telle qu'elle apparaît dans l'URL. */
export type AdminTab = (typeof ADMIN_TABS)[number]['slug'];

/** Vrai si le segment d'URL reçu désigne une rubrique connue. */
export function isAdminTab(valeur: string | undefined): valeur is AdminTab {
  return ADMIN_TABS.some((tab) => tab.slug === valeur);
}

/**
 * Navigation entre les rubriques de `/admin`.
 *
 * Des `NavLink` plutôt que des boutons : la rubrique vit dans l'URL, donc
 * `aria-current="page"` et l'état actif viennent du routeur au lieu d'être
 * recalculés en comparant des chemins à la main.
 */
export function AdminNav(): ReactElement {
  return (
    <nav
      aria-label="Rubriques d'administration"
      // Deux régimes selon la largeur, comme `SidePanel`. À partir de `md`, une
      // colonne collante : elle reste sous les yeux pendant qu'on fait défiler
      // la file de modération, qui est paginée et donc longue. En dessous, une
      // rangée qui défile horizontalement — 12 rem prélevées sur un écran de
      // téléphone ne laisseraient rien au contenu. Le débord négatif lui rend
      // les marges de la page, pour que ce défilement aille d'un bord à l'autre.
      className="-mx-4 flex shrink-0 gap-1 overflow-x-auto px-4 sm:-mx-6 sm:px-6 md:sticky md:top-20 md:mx-0 md:w-48 md:flex-col md:self-start md:overflow-visible md:px-0"
    >
      {ADMIN_TABS.map((tab) => (
        <NavLink
          key={tab.slug}
          to={`/admin/${tab.slug}`}
          className={({ isActive }) =>
            `shrink-0 rounded-lg px-3 py-2 text-sm transition-colors ${
              isActive
                ? 'bg-white/5 text-ink-100'
                : 'text-ink-300 hover:bg-white/5 hover:text-ink-100'
            }`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
