import { type ReactElement, type ReactNode, useEffect, useId } from 'react';
import { Link } from 'react-router-dom';
import { PHONE_QUERY, useMediaQuery } from '../../lib/useMediaQuery';
import { IconButton, KebabIcon } from './Tooltip';

/** Single navigation entry inside `SettingsShell`. */
export interface SettingsNavItem {
  /** Stable section identifier (e.g. `'albums'`, `'users'`, `'profile'`). */
  id: string;
  /** Human-readable section title. */
  label: string;
  /** Optional router destination path (e.g. `'/admin/albums'`). */
  to?: string;
  /** Optional click callback when managed via state or in addition to navigation. */
  onSelect?: () => void;
  /** Optional leading vector `<svg>` icon (`size-4`). */
  icon?: ReactNode;
  /** Optional numeric badge (e.g. album count, unread activity count). */
  badgeCount?: number;
}

/** Group of navigation items (e.g. *Account* vs *Administration*). */
export interface SettingsNavGroup {
  id: string;
  /** Optional uppercase group heading (`text-xs font-semibold tracking-wider text-ink-400`). */
  title?: string;
  items: readonly SettingsNavItem[];
}

/** Props for the mobile `[⋮]` kebab button in `AppTopBar` that toggles the `SettingsShell` menu. */
export interface SettingsMobileMenuTriggerProps {
  open: boolean;
  onToggle: () => void;
  menuId: string;
  label: string;
  badgeCount?: number;
}

/**
 * Mobile (`< md`) `36x36` `[⋮]` kebab button placed inside `AppTopBar` to toggle the
 * `SettingsShell` section navigation dropdown.
 */
export function SettingsMobileMenuTrigger({
  open,
  onToggle,
  menuId,
  label,
  badgeCount,
}: SettingsMobileMenuTriggerProps): ReactElement {
  return (
    <div className="md:hidden">
      <IconButton
        label={label}
        active={open}
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="menu"
        hideTooltip={open}
        badgeCount={badgeCount}
        onClick={onToggle}
      >
        <KebabIcon />
      </IconButton>
    </div>
  );
}

/** Props for the `SettingsShell` layout primitive. */
export interface SettingsShellProps {
  /** Grouped navigation sections (*Account* and *Administration*). */
  groups: readonly SettingsNavGroup[];
  /** Currently active section identifier. */
  activeId: string;
  /** Controlled mobile `[⋮]` menu open state. */
  mobileMenuOpen?: boolean;
  /** Updates the mobile `[⋮]` menu open state. */
  onMobileMenuOpenChange?: (open: boolean) => void;
  /** DOM `id` shared with `SettingsMobileMenuTrigger`'s `aria-controls`. */
  mobileMenuId?: string;
  /** Accessible label for the navigation landmark and mobile menu. */
  navLabel: string;
  /** Accessible label for the mobile backdrop close button. */
  closeLabel?: string;
  /** Optional sticky notice banner above the section content. */
  notice?: ReactNode;
  /** Active section content. */
  children: ReactNode;
}

/**
 * Responsive shell for `/settings` and `/admin/*`:
 * - Desktop (`>= md`): Sticky `220px` left sidebar (`w-[220px] shrink-0`) with grouped sections
 *   and `bg-accent-soft text-accent` active highlight, alongside the main content column.
 * - Mobile (`< md`): Hides the horizontal pill strip so items never clip off-screen, and
 *   renders a scroll-contained dropdown/sheet menu (`max-h-[calc(100dvh-4.5rem)]`) controlled
 *   by the `[⋮]` button in `AppTopBar`. Automatically closes on outside tap, `Escape`, section
 *   selection (scrolling to top), or when the viewport crosses `>= md`.
 */
export function SettingsShell({
  groups,
  activeId,
  mobileMenuOpen = false,
  onMobileMenuOpenChange,
  mobileMenuId,
  navLabel,
  closeLabel = 'Close',
  notice,
  children,
}: SettingsShellProps): ReactElement {
  const generatedId = useId();
  const menuId = mobileMenuId ?? generatedId;
  const phone = useMediaQuery(PHONE_QUERY);

  // Auto-close the mobile navigation menu when the viewport crosses `>= md`.
  useEffect(() => {
    if (!phone && mobileMenuOpen && onMobileMenuOpenChange) {
      onMobileMenuOpenChange(false);
    }
  }, [phone, mobileMenuOpen, onMobileMenuOpenChange]);

  // Close on `Escape` and lock body scroll while the mobile navigation menu is open.
  useEffect(() => {
    if (!phone || !mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onMobileMenuOpenChange?.(false);
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [phone, mobileMenuOpen, onMobileMenuOpenChange]);

  const handleSelectItem = (item: SettingsNavItem): void => {
    item.onSelect?.();
    if (mobileMenuOpen) {
      onMobileMenuOpenChange?.(false);
    }
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  };

  const renderItem = (item: SettingsNavItem, inMobileMenu: boolean): ReactElement => {
    const isActive = item.id === activeId;
    const itemClass = `flex w-full items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors ${
      isActive ? 'bg-accent-soft text-accent' : 'text-ink-300 hover:bg-tint hover:text-ink-100'
    }`;

    const content = (
      <>
        <span className="flex min-w-0 items-center gap-2.5">
          {item.icon && <span className="shrink-0">{item.icon}</span>}
          <span className="truncate">{item.label}</span>
        </span>
        {typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
          <span
            className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-medium ${
              isActive
                ? 'bg-accent text-accent-ink'
                : 'bg-zinc-800 text-ink-300 light:bg-zinc-200 light:text-zinc-700'
            }`}
          >
            {item.badgeCount}
          </span>
        )}
      </>
    );

    if (item.to) {
      return (
        <Link
          key={item.id}
          to={item.to}
          role={inMobileMenu ? 'menuitem' : undefined}
          aria-current={isActive ? 'page' : undefined}
          onClick={() => handleSelectItem(item)}
          className={itemClass}
        >
          {content}
        </Link>
      );
    }

    return (
      <button
        key={item.id}
        type="button"
        role={inMobileMenu ? 'menuitem' : undefined}
        aria-current={isActive ? 'page' : undefined}
        onClick={() => handleSelectItem(item)}
        className={itemClass}
      >
        {content}
      </button>
    );
  };

  return (
    <div className="relative mx-auto flex w-full max-w-[90rem] flex-col gap-6 px-4 py-6 sm:px-6 md:flex-row md:items-start md:gap-8">
      {/* Desktop (`>= md`) sticky 220px left sidebar */}
      <aside className="hidden md:sticky md:top-20 md:block md:w-[220px] md:shrink-0">
        <nav aria-label={navLabel} className="space-y-6">
          {groups.map((group) => (
            <div key={group.id} className="space-y-1">
              {group.title && (
                <div className="px-3 pb-1 text-xs font-semibold tracking-wider text-ink-400 uppercase">
                  {group.title}
                </div>
              )}
              {group.items.map((item) => renderItem(item, false))}
            </div>
          ))}
        </nav>
      </aside>

      {/* Mobile (`< md`) `[⋮]` navigation dropdown with backdrop and scroll containment */}
      {phone && mobileMenuOpen && (
        <>
          <button
            type="button"
            aria-label={closeLabel}
            tabIndex={-1}
            onClick={() => onMobileMenuOpenChange?.(false)}
            className="fixed inset-0 z-40 cursor-default bg-black/40 md:hidden"
          />
          <div
            id={menuId}
            role="menu"
            aria-label={navLabel}
            className="fixed top-16 right-3 left-3 z-50 max-h-[calc(100dvh-4.5rem)] overflow-y-auto overscroll-contain rounded-2xl border border-zinc-800 bg-ink-850 p-2 shadow-2xl md:hidden light:border-zinc-200 light:bg-white"
          >
            {groups.map((group, groupIndex) => (
              <div
                key={group.id}
                className={
                  groupIndex > 0 ? 'mt-2 border-t border-zinc-800 pt-2 light:border-zinc-200' : ''
                }
              >
                {group.title && (
                  <div className="px-3 py-1.5 text-xs font-semibold tracking-wider text-ink-400 uppercase">
                    {group.title}
                  </div>
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => renderItem(item, true))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Main section column */}
      <div className="min-w-0 flex-1 space-y-5">
        {notice}
        {children}
      </div>
    </div>
  );
}
