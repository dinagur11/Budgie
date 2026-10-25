import { daysInMonth, parseDate } from "./dates";
import { parseAmount } from "./money";

// warning from this share of the limit; over the limit above 100%
export const BUDGET_WARNING_AT = 0.8;

export type BudgetTone = "ok" | "warning" | "over";

// how much of a monthly limit was spent: the whole percent shown (can pass 100), the bar's fill (0 to 1) and its tone.
// Both amounts are minor units of the same currency; limit is at least 1.
export function budgetProgress(spent: number, limit: number): { percent: number; fill: number; tone: BudgetTone } {
  const ratio = Math.max(0, spent) / limit;
  const tone: BudgetTone = ratio > 1 ? "over" : ratio >= BUDGET_WARNING_AT ? "warning" : "ok";
  return { percent: Math.round(ratio * 100), fill: Math.min(1, ratio), tone };
}

// days until the next month starts, counted from today ("YYYY-MM-DD"): 1 on the month's last day
export function daysUntilReset(today: string): number {
  const { year, month, day } = parseDate(today);
  return daysInMonth(year, month) - day + 1;
}

// the limit field's text (already checked with validateLimit) -> what to send: null for no limit, or minor units
export function limitFromInput(text: string): number | null {
  return text.trim() === "" ? null : parseAmount(text);
}
