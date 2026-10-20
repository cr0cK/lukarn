import { type ReactElement, type ReactNode } from 'react';

/** Props for the standardized `AdminSectionHeader` layout primitive. */
export interface AdminSectionHeaderProps {
  /** Sober section heading (`<h2>`, `text-xl font-semibold tracking-tight`). */
  title: string;
  /** Concise single-line subtitle (`text-sm text-ink-400`). */
  description?: ReactNode;
  /** Optional top-right primary CTA button or action group (`shrink-0`). */
  action?: ReactNode;
  /** Additional classes on the outer `<header>`. */
  className?: string;
}

/**
 * Standardized header across all Administration and Account Settings sections.
 *
 * Renders the section title (`<h2>` at `text-xl font-semibold tracking-tight`) and its
 * `text-sm` subtitle on the left, and pins the optional primary CTA (`+ Add user`,
 * `+ New share`, `+ Add album`, `+ Add storage`) to the top-right (`shrink-0`).
 */
export function AdminSectionHeader({
  title,
  description,
  action,
  className = '',
}: AdminSectionHeaderProps): ReactElement {
  return (
    <header className={`mb-5 flex items-start justify-between gap-4 ${className}`.trim()}>
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight text-ink-100">{title}</h2>
        {description && <p className="mt-1 text-sm text-ink-400">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
