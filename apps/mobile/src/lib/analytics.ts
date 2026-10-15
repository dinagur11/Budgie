import type { Currency, Expense } from "../api/types";
import { addMonths } from "./dates";

export type GroupBy = "category" | "payer";

// one slice of the month's spending: a category or a payer, or "Other" (key null) for everything past the top slices
export type Slice = { key: number | null; amount: number };

// most slices a pie shows before folding the rest into "Other" (more parts can't be told apart by color)
export const MAX_SLICES = 6;

// the month's expenses in one currency (amounts in different currencies are never added together), grouped by
// category or payer, largest first; past MAX_SLICES the smallest ones fold into one "Other" slice at the end
export function groupSpending(expenses: Expense[], by: GroupBy, currency: Currency): Slice[] {
  const sums = new Map<number, number>();
  for (const e of expenses) {
    if (e.currency !== currency) continue;
    const key = by === "category" ? e.categoryId : e.paidById;
    sums.set(key, (sums.get(key) ?? 0) + e.amount);
  }
  return foldSlices([...sums].map(([key, amount]) => ({ key, amount })));
}

// largest first (ties by key), zeros dropped; past MAX_SLICES the smallest fold into one "Other" slice (key null) at the end
export function foldSlices(parts: { key: number; amount: number }[]): Slice[] {
  const slices: Slice[] = parts.filter((p) => p.amount > 0).sort((a, b) => b.amount - a.amount || a.key - b.key);
  if (slices.length <= MAX_SLICES) return slices;
  const kept = slices.slice(0, MAX_SLICES - 1);
  const other = slices.slice(MAX_SLICES - 1).reduce((sum, s) => sum + s.amount, 0);
  return [...kept, { key: null, amount: other }];
}

// the currencies that have spending, the preferred one (a household's default) first, then by amount
export function currenciesByAmount(totals: { currency: Currency; amount: number }[], preferred?: Currency): Currency[] {
  const sums = new Map<Currency, number>();
  for (const t of totals) if (t.amount > 0) sums.set(t.currency, (sums.get(t.currency) ?? 0) + t.amount);
  return [...sums].sort(([a, x], [b, y]) => Number(b === preferred) - Number(a === preferred) || y - x || a.localeCompare(b)).map(([c]) => c);
}

// the last `count` months up to and including `current`, oldest first
export function lastMonths(current: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(current, i - count + 1));
}

// "12%" (rounded, but never "0%" for a part that exists)
export function percentLabel(part: number, total: number): string {
  if (total <= 0) return "0%";
  const p = Math.round((part / total) * 100);
  return `${p === 0 && part > 0 ? "<1" : p}%`;
}

// SVG path of a donut segment between two angles (radians, 0 = 12 o'clock, clockwise)
export function donutSegment(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  const point = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(3)} ${(cy - r * Math.cos(a)).toFixed(3)}`;
  const large = end - start > Math.PI ? 1 : 0;
  return [
    `M ${point(outer, start)}`,
    `A ${outer} ${outer} 0 ${large} 1 ${point(outer, end)}`,
    `L ${point(inner, end)}`,
    `A ${inner} ${inner} 0 ${large} 0 ${point(inner, start)}`,
    "Z",
  ].join(" ");
}
