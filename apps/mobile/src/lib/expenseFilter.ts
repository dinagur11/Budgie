import type { Currency, Expense } from "../api/types";

// the household screen's expense list filter: everything, or one category, or one payer
export type ExpenseFilter = { by: "category" | "payer"; id: number } | null;

export function applyFilter(expenses: Expense[], filter: ExpenseFilter): Expense[] {
  if (!filter) return expenses;
  return expenses.filter((e) => (filter.by === "category" ? e.categoryId : e.paidById) === filter.id);
}

// the categories or payers that appear in these expenses, most expenses first (ties by id), for the filter's choices
export function filterChoices(expenses: Expense[], by: "category" | "payer"): number[] {
  const counts = new Map<number, number>();
  for (const e of expenses) {
    const id = by === "category" ? e.categoryId : e.paidById;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts].sort(([a, x], [b, y]) => y - x || a - b).map(([id]) => id);
}

// per-currency sums of the shown expenses, the currency with the most first, for "642.30 ILS and 20.00 EUR"
export function sumByCurrency(expenses: Expense[]): { amount: number; currency: Currency }[] {
  const sums = new Map<Currency, number>();
  for (const e of expenses) sums.set(e.currency, (sums.get(e.currency) ?? 0) + e.amount);
  return [...sums].sort(([a, x], [b, y]) => y - x || a.localeCompare(b)).map(([currency, amount]) => ({ amount, currency }));
}
