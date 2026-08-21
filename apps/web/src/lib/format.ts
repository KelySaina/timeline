import type { DatePrecision, TimelineEvent } from '@/api/types';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const parts = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number);
  return { year: year ?? 1970, month: month ?? 1, day: day ?? 1 };
};

/** "today" as a calendar date in the reader's own timezone. */
export const todayIso = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

export const isFuture = (iso: string) => iso > todayIso();

export const monthName = (month: number, short = false) => {
  const name = MONTHS[month - 1] ?? '';
  return short ? name.slice(0, 3) : name;
};

/** Renders only as precisely as the memory is actually known. */
export function formatEventDate(iso: string, precision: DatePrecision = 'day', short = false): string {
  const { year, month, day } = parts(iso);
  if (precision === 'year') return String(year);
  if (precision === 'month') return `${monthName(month, short)} ${year}`;
  return `${monthName(month, short)} ${day}, ${year}`;
}

export function formatDateRange(event: Pick<TimelineEvent, 'eventDate' | 'endDate' | 'datePrecision'>): string {
  const start = formatEventDate(event.eventDate, event.datePrecision);
  if (!event.endDate || event.endDate === event.eventDate) return start;
  const a = parts(event.eventDate);
  const b = parts(event.endDate);
  if (a.year === b.year && a.month === b.month) return `${monthName(a.month)} ${a.day}–${b.day}, ${a.year}`;
  if (a.year === b.year) return `${monthName(a.month, true)} ${a.day} – ${monthName(b.month, true)} ${b.day}, ${a.year}`;
  return `${start} – ${formatEventDate(event.endDate, event.datePrecision)}`;
}

export const dayLabel = (iso: string) => String(parts(iso).day);
export const monthLabel = (iso: string) => monthName(parts(iso).month, true);

export function daysBetween(fromIso: string, toIso: string): number {
  const a = parts(fromIso);
  const b = parts(toIso);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

/** "in 12 days", "tomorrow", "today" — the phrasing an anniversary card needs. */
export function countdownLabel(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 0) return `${Math.abs(days)} days ago`;
  if (days < 30) return `in ${days} days`;
  const months = Math.round(days / 30.44);
  if (days < 365) return `in ${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(days / 365.25);
  return `in ${years} year${years === 1 ? '' : 's'}`;
}

export function relativeTime(isoTimestamp: string): string {
  const then = new Date(isoTimestamp).getTime();
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(isoTimestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export const ordinal = (n: number): string => {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

export const possessive = (name: string) => (name.endsWith('s') ? `${name}'` : `${name}'s`);

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
