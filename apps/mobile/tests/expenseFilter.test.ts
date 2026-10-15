import { describe, it, expect } from "vitest";
import { applyFilter, filterChoices, sumByCurrency } from "../src/lib/expenseFilter";
import type { Expense } from "../src/api/types";

const expense = (id: number, amount: number, categoryId: number, paidById: number, currency: Expense["currency"] = "ILS"): Expense => ({
  id, name: "x", amount, currency, date: "2026-10-01", categoryId, paidById, createdById: paidById, description: null, isRecurring: false,
});
const list = [expense(1, 100, 1, 10), expense(2, 200, 2, 11), expense(3, 300, 1, 11), expense(4, 50, 3, 10, "EUR")];

describe("expense filter", () => {
  it("no filter keeps everything", () => {
    expect(applyFilter(list, null)).toBe(list);
  });
  it("by category or payer", () => {
    expect(applyFilter(list, { by: "category", id: 1 }).map((e) => e.id)).toEqual([1, 3]);
    expect(applyFilter(list, { by: "payer", id: 11 }).map((e) => e.id)).toEqual([2, 3]);
    expect(applyFilter(list, { by: "payer", id: 99 })).toEqual([]);
  });
  it("choices: most expenses first, ties by id", () => {
    expect(filterChoices(list, "category")).toEqual([1, 2, 3]);
    expect(filterChoices(list, "payer")).toEqual([10, 11]);
  });
  it("sums per currency, never across currencies", () => {
    expect(sumByCurrency(list)).toEqual([{ amount: 600, currency: "ILS" }, { amount: 50, currency: "EUR" }]);
  });
});
