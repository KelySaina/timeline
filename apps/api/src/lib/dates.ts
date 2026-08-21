/** Calendar-date helpers. Everything here works on 'YYYY-MM-DD' strings, never Date-with-timezone. */

export const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const todayIso = (): string => isoDate(new Date());

export function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Next occurrence of a (month, day) on or after `from`. Feb 29 lands on Feb 28 in common years. */
export function nextOccurrence(month: number, day: number, from = todayIso()): string {
  const base = parseIsoDate(from)!;
  const clamp = (year: number) => Math.min(day, daysInMonth(year, month));
  const thisYear = `${base.year}-${String(month).padStart(2, '0')}-${String(clamp(base.year)).padStart(2, '0')}`;
  if (thisYear >= from) return thisYear;
  const year = base.year + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(clamp(year)).padStart(2, '0')}`;
}

export function daysUntil(target: string, from = todayIso()): number {
  const a = parseIsoDate(from)!;
  const b = parseIsoDate(target)!;
  const ms = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86_400_000);
}

/** Calendar difference, the way people say it: "3 years, 2 months, 11 days". */
export function elapsed(fromIso: string, toIso = todayIso()) {
  const from = parseIsoDate(fromIso)!;
  const to = parseIsoDate(toIso)!;
  let years = to.year - from.year;
  let months = to.month - from.month;
  let days = to.day - from.day;
  if (days < 0) {
    months -= 1;
    days += daysInMonth(to.month === 1 ? to.year - 1 : to.year, to.month === 1 ? 12 : to.month - 1);
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days, totalDays: daysUntil(toIso, fromIso) };
}
