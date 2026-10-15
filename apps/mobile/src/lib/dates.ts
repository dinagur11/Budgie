// Dates are "YYYY-MM-DD" strings and months "YYYY-MM" strings everywhere in the app. Nothing here goes
// through a local-time Date, which would shift days across time zones: calendar math is plain arithmetic.

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export type YMD = { year: number; month: number; day: number }; // month 1-12

export function parseDate(value: string): YMD {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw new Error(`Invalid date: ${value}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export const formatDate = ({ year, month, day }: YMD) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
export const monthOf = (date: string) => date.slice(0, 7);

export function isLeapYear(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number) {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

// 0 = Sunday ... 6 = Saturday (Sakamoto's method, Gregorian calendar)
export function dayOfWeek(year: number, month: number, day: number) {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const y = month < 3 ? year - 1 : year;
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[month - 1] + day) % 7;
}

// today in an IANA time zone as "YYYY-MM-DD" (the household's day, not the device's)
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  if (typeof fmt.formatToParts === "function") {
    const parts = fmt.formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value;
    const year = get("year"), month = get("month"), day = get("day");
    if (year && month && day) return `${year}-${month}-${day}`;
  }
  // fallback for engines without formatToParts: en-US gives "MM/DD/YYYY"
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fmt.format(now));
  if (!m) throw new Error("Can't read today's date for this time zone");
  return `${m[3]}-${m[1]}-${m[2]}`;
}

// an ISO timestamp as the calendar date it falls on in an IANA time zone, "YYYY-MM-DD"
export function dateInTimeZone(timestamp: string, timeZone: string): string {
  return todayInTimeZone(timeZone, new Date(timestamp));
}

// the device's IANA time zone (used where there is no household, such as the user's own month)
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// "2026-10" -> "October 2026"
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// "2026-10" -> "October"
export function monthName(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1];
}

// "2026-10-05" -> "Oct 5"
export function shortDateLabel(date: string): string {
  const { month, day } = parseDate(date);
  return `${MONTH_NAMES[month - 1].slice(0, 3)} ${day}`;
}

// "2026-03-01", -1 -> "2026-02-28" (plain arithmetic, no local Date)
export function addDays(date: string, days: number): string {
  let { year, month, day } = parseDate(date);
  day += days;
  while (day < 1) {
    month -= 1;
    if (month < 1) { month = 12; year -= 1; }
    day += daysInMonth(year, month);
  }
  while (day > daysInMonth(year, month)) {
    day -= daysInMonth(year, month);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return formatDate({ year, month, day });
}

// "2026-01", -1 -> "2025-12"
export function addMonths(month: string, months: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}`;
}

// "2026-10-05" -> "Oct 5, 2026"
export function longDateLabel(date: string): string {
  return `${shortDateLabel(date)}, ${parseDate(date).year}`;
}

export type GridCell = { date: string; day: number; inMonth: boolean };

// a Sunday-first month grid: whole weeks, padded with the neighbouring months' days
export function monthGrid(month: string): GridCell[] {
  const [year, m] = month.split("-").map(Number);
  const lead = dayOfWeek(year, m, 1);
  const count = daysInMonth(year, m);
  const prev = m === 1 ? { year: year - 1, month: 12 } : { year, month: m - 1 };
  const next = m === 12 ? { year: year + 1, month: 1 } : { year, month: m + 1 };
  const prevCount = daysInMonth(prev.year, prev.month);

  const cells: GridCell[] = [];
  for (let i = lead - 1; i >= 0; i--) {
    const day = prevCount - i;
    cells.push({ date: formatDate({ ...prev, day }), day, inMonth: false });
  }
  for (let day = 1; day <= count; day++) cells.push({ date: formatDate({ year, month: m, day }), day, inMonth: true });
  for (let day = 1; cells.length % 7 !== 0; day++) cells.push({ date: formatDate({ ...next, day }), day, inMonth: false });
  return cells;
}
