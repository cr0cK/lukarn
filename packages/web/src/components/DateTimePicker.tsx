import { type ReactElement, type ReactNode, useId, useState } from 'react';
import { formatLocalDateTime } from '../lib/format';
import { useT } from '../lib/i18n';
import { COARSE_POINTER_QUERY, useMediaQuery } from '../lib/useMediaQuery';

export interface DateTimePickerProps {
  id?: string;
  label?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  hint?: ReactNode;
}

type ExpiryPreset = '7d' | '30d' | 'never' | 'custom';

function toLocalDatetimeInput(isoString: string | null): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
}

/**
 * Ergonomic expiry date and time selector:
 * - Quick duration presets: 7 days, 30 days, Never, Custom date.
 * - Desktop: Clean calendar grid and time input styled with `@theme` tokens.
 * - Mobile / touch: Native `datetime-local` input triggered on coarse pointers.
 */
export function DateTimePicker({
  id,
  label,
  value,
  onChange,
  disabled = false,
  hint,
}: DateTimePickerProps): ReactElement {
  const t = useT();
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const isCoarse = useMediaQuery(COARSE_POINTER_QUERY);

  // Determine initial preset based on value
  const [preset, setPreset] = useState<ExpiryPreset>(() => {
    if (!value) return 'never';
    return 'custom';
  });

  const selectedDate = value ? new Date(value) : new Date(Date.now() + 7 * 86_400_000);
  const [viewYear, setViewYear] = useState(() => selectedDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => selectedDate.getMonth());

  const selectPreset = (newPreset: ExpiryPreset): void => {
    if (disabled) return;
    setPreset(newPreset);
    if (newPreset === 'never') {
      onChange(null);
    } else if (newPreset === '7d') {
      const d = new Date(Date.now() + 7 * 86_400_000);
      d.setSeconds(0, 0);
      onChange(d.toISOString());
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    } else if (newPreset === '30d') {
      const d = new Date(Date.now() + 30 * 86_400_000);
      d.setSeconds(0, 0);
      onChange(d.toISOString());
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    } else if (newPreset === 'custom') {
      if (!value) {
        const d = new Date(Date.now() + 7 * 86_400_000);
        d.setSeconds(0, 0);
        onChange(d.toISOString());
        setViewYear(d.getFullYear());
        setViewMonth(d.getMonth());
      } else {
        const d = new Date(value);
        if (!isNaN(d.getTime())) {
          setViewYear(d.getFullYear());
          setViewMonth(d.getMonth());
        }
      }
    }
  };

  const handleDaySelect = (day: number): void => {
    if (disabled) return;
    const current = value ? new Date(value) : new Date(Date.now() + 7 * 86_400_000);
    const updated = new Date(
      viewYear,
      viewMonth,
      day,
      current.getHours(),
      current.getMinutes(),
      0,
      0,
    );
    onChange(updated.toISOString());
  };

  const handleTimeChange = (timeStr: string): void => {
    if (disabled || !timeStr) return;
    const [h, m] = timeStr.split(':').map((v) => parseInt(v, 10));
    if (h === undefined || m === undefined || isNaN(h) || isNaN(m)) return;
    const current = value ? new Date(value) : new Date(Date.now() + 7 * 86_400_000);
    const updated = new Date(
      current.getFullYear(),
      current.getMonth(),
      current.getDate(),
      h,
      m,
      0,
      0,
    );
    onChange(updated.toISOString());
  };

  const prevMonth = (): void => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const nextMonth = (): void => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  // Calendar calculations
  const localeCode = t.locale === 'fr' ? 'fr-FR' : 'en-GB';
  const monthTitle = new Intl.DateTimeFormat(localeCode, {
    month: 'long',
    year: 'numeric',
  }).format(new Date(viewYear, viewMonth, 1));
  const capitalizedMonthTitle = monthTitle.charAt(0).toUpperCase() + monthTitle.slice(1);

  const firstDayIndex = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7; // Mon = 0
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const prevDays = Array.from(
    { length: firstDayIndex },
    (_, i) => daysInPrevMonth - firstDayIndex + 1 + i,
  );
  const currentDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // Day names header starting from Monday
  const dayNames = [1, 2, 3, 4, 5, 6, 7].map((day) => {
    // 2026-09-07 was a Monday
    const d = new Date(2026, 8, day);
    return new Intl.DateTimeFormat(localeCode, { weekday: 'short' }).format(d);
  });

  const now = new Date();
  const isSelected = (day: number): boolean => {
    if (!value) return false;
    const d = new Date(value);
    return d.getFullYear() === viewYear && d.getMonth() === viewMonth && d.getDate() === day;
  };

  const isToday = (day: number): boolean => {
    return now.getFullYear() === viewYear && now.getMonth() === viewMonth && now.getDate() === day;
  };

  const isPast = (day: number): boolean => {
    const endOfDay = new Date(viewYear, viewMonth, day, 23, 59, 59, 999);
    return endOfDay.getTime() < now.getTime();
  };

  const timeVal = value
    ? `${String(new Date(value).getHours()).padStart(2, '0')}:${String(new Date(value).getMinutes()).padStart(2, '0')}`
    : '12:00';

  return (
    <div className="space-y-2">
      {label && (
        <label htmlFor={inputId} className="block text-xs font-medium text-ink-300">
          {label}
        </label>
      )}

      {/* Quick duration presets */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ['7d', 'shares.expiry7Days'],
            ['30d', 'shares.expiry30Days'],
            ['never', 'shares.expiryNever'],
            ['custom', 'shares.expiryCustom'],
          ] as const
        ).map(([key, labelKey]) => (
          <button
            key={key}
            type="button"
            onClick={() => selectPreset(key)}
            disabled={disabled}
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              preset === key
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-ink-700 bg-ink-800 text-ink-300 hover:border-ink-600 hover:text-ink-100'
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {/* Custom Picker view */}
      {preset === 'custom' && (
        <div className="mt-3 rounded-xl border border-ink-800 bg-ink-850 p-4">
          {isCoarse ? (
            /* Mobile touch devices fallback */
            <div>
              <label htmlFor={inputId} className="mb-1.5 block text-xs text-ink-400">
                {t('shares.expiryCustom')}
              </label>
              <input
                id={inputId}
                type="datetime-local"
                value={toLocalDatetimeInput(value)}
                onChange={(e) => {
                  const val = e.target.value ? new Date(e.target.value).toISOString() : null;
                  onChange(val);
                }}
                disabled={disabled}
                className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-ink-100 outline-none transition-colors focus:border-accent-dim disabled:opacity-60"
              />
            </div>
          ) : (
            /* Desktop custom calendar and time selector */
            <div className="space-y-4">
              {/* Calendar header navigation */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-ink-100">{capitalizedMonthTitle}</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={prevMonth}
                    disabled={disabled}
                    aria-label={t('shares.previousMonth')}
                    className="rounded-md border border-ink-700 bg-ink-800 p-1 text-ink-300 hover:bg-tint hover:text-ink-100 disabled:opacity-50"
                  >
                    <svg
                      className="size-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="m15 18-6-6 6-6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={nextMonth}
                    disabled={disabled}
                    aria-label={t('shares.nextMonth')}
                    className="rounded-md border border-ink-700 bg-ink-800 p-1 text-ink-300 hover:bg-tint hover:text-ink-100 disabled:opacity-50"
                  >
                    <svg
                      className="size-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-ink-400">
                {dayNames.map((name, i) => (
                  <div key={i} className="py-1">
                    {name}
                  </div>
                ))}
              </div>

              {/* Day cells */}
              <div className="grid grid-cols-7 gap-1 text-center text-xs">
                {prevDays.map((d) => (
                  <div key={`prev-${d}`} className="py-1.5 text-ink-600">
                    {d}
                  </div>
                ))}
                {currentDays.map((d) => {
                  const active = isSelected(d);
                  const today = isToday(d);
                  const past = isPast(d);

                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => handleDaySelect(d)}
                      disabled={disabled || past}
                      className={`rounded-lg py-1.5 font-medium transition-colors ${
                        active
                          ? 'bg-accent text-accent-ink shadow-sm'
                          : past
                            ? 'cursor-not-allowed text-ink-600'
                            : 'text-ink-200 hover:bg-tint hover:text-ink-100'
                      } ${today && !active ? 'ring-1 ring-accent-dim' : ''}`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>

              {/* Time selector and summary */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-800 pt-3">
                <div className="flex items-center gap-2">
                  <label htmlFor={`${inputId}-time`} className="text-xs text-ink-400">
                    {t('shares.time')}
                  </label>
                  <input
                    id={`${inputId}-time`}
                    type="time"
                    value={timeVal}
                    onChange={(e) => handleTimeChange(e.target.value)}
                    disabled={disabled}
                    className="rounded-lg border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-100 outline-none focus:border-accent-dim"
                  />
                </div>

                {value && (
                  <span className="text-xs text-ink-400">
                    {t('shares.expiresOn', formatLocalDateTime(value, t))}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {hint && <p className="text-xs text-ink-400">{hint}</p>}
    </div>
  );
}
