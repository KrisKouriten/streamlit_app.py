/*
 * Working days — Monday to Friday, less the England & Wales bank holidays.
 * Pure: no imports, no DB, no clock (every function takes `today` or a date).
 *
 * Dates are 'YYYY-MM-DD' strings or Dates and are counted in UTC calendar days,
 * so a timestamp late in the evening still lands on its own day.
 *
 * The bank holidays are listed by year (gov.uk). A year that is not listed
 * counts weekdays only — it never throws — so add the next year here when the
 * dates are published.
 */

export const BANK_HOLIDAYS_EW = new Set([
  // 2025
  "2025-01-01", "2025-04-18", "2025-04-21", "2025-05-05", "2025-05-26", "2025-08-25", "2025-12-25", "2025-12-26",
  // 2026
  "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25", "2026-08-31", "2026-12-25", "2026-12-28",
  // 2027
  "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31", "2027-08-30", "2027-12-27", "2027-12-28",
  // 2028
  "2028-01-03", "2028-04-14", "2028-04-17", "2028-05-01", "2028-05-29", "2028-08-28", "2028-12-25", "2028-12-26",
]);

const DAY = 86400000;

// 'YYYY-MM-DD' from a Date or a date/timestamp string; null when unreadable.
export function dayOf(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const toUtc = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

export function isWorkingDay(v) {
  const iso = dayOf(v);
  if (!iso) return false;
  const wd = new Date(toUtc(iso)).getUTCDay();
  return wd !== 0 && wd !== 6 && !BANK_HOLIDAYS_EW.has(iso);
}

/*
 * The date `n` working days after `from` — the day itself is not counted, so
 * five working days after a Monday is the next Monday. From a weekend or bank
 * holiday the count starts on the next working day.
 */
export function addWorkingDays(from, n) {
  const iso = dayOf(from);
  if (!iso) return null;
  let ms = toUtc(iso);
  let left = Math.max(0, Math.floor(Number(n) || 0));
  while (left > 0) {
    ms += DAY;
    if (isWorkingDay(fromUtc(ms))) left--;
  }
  return fromUtc(ms);
}

// Whole working days from `from` to `to` (exclusive of `from`, inclusive of `to`).
// Zero when `to` is on or before `from`.
export function workingDaysBetween(from, to) {
  const a = dayOf(from), b = dayOf(to);
  if (!a || !b) return 0;
  let n = 0;
  for (let ms = toUtc(a) + DAY, end = toUtc(b); ms <= end; ms += DAY) if (isWorkingDay(fromUtc(ms))) n++;
  return n;
}
