import { describe, it, expect } from "vitest";
import { currenciesByAmount, donutSegment, foldSlices, groupSpending, lastMonths, MAX_SLICES, percentLabel } from "../src/lib/analytics";
import type { Expense } from "../src/api/types";

const expense = (id: number, amount: number, categoryId: number, paidById: number, currency: Expense["currency"] = "ILS"): Expense => ({
  id, name: "x", amount, currency, date: "2026-10-01", categoryId, paidById, createdById: paidById, description: null, isRecurring: false,
});

describe("groupSpending", () => {
  const expenses = [expense(1, 500, 1, 10), expense(2, 300, 2, 10), expense(3, 200, 1, 11), expense(4, 999, 1, 10, "EUR")];
  it("groups one currency by category or payer, largest first", () => {
    expect(groupSpending(expenses, "category", "ILS")).toEqual([{ key: 1, amount: 700 }, { key: 2, amount: 300 }]);
    expect(groupSpending(expenses, "payer", "ILS")).toEqual([{ key: 10, amount: 800 }, { key: 11, amount: 200 }]);
    expect(groupSpending(expenses, "payer", "EUR")).toEqual([{ key: 10, amount: 999 }]);
    expect(groupSpending(expenses, "payer", "USD")).toEqual([]);
  });
  it("folds everything past the top slices into Other", () => {
    const many = Array.from({ length: 9 }, (_, i) => expense(i + 1, 100 * (i + 1), i + 1, 1));
    const slices = groupSpending(many, "category", "ILS");
    expect(slices).toHaveLength(MAX_SLICES);
    expect(slices[0]).toEqual({ key: 9, amount: 900 });
    expect(slices[MAX_SLICES - 1]).toEqual({ key: null, amount: 100 + 200 + 300 + 400 });
    expect(slices.reduce((s, x) => s + x.amount, 0)).toBe(4500);
  });
});

describe("foldSlices", () => {
  it("drops zeros and sorts", () => {
    expect(foldSlices([{ key: 2, amount: 5 }, { key: 1, amount: 0 }, { key: 3, amount: 9 }])).toEqual([{ key: 3, amount: 9 }, { key: 2, amount: 5 }]);
  });
});

describe("currenciesByAmount", () => {
  it("preferred first, then by amount, zeros left out", () => {
    const totals = [{ currency: "USD" as const, amount: 50 }, { currency: "EUR" as const, amount: 900 }, { currency: "ILS" as const, amount: 10 }, { currency: "GBP" as const, amount: 0 }];
    expect(currenciesByAmount(totals, "ILS")).toEqual(["ILS", "EUR", "USD"]);
    expect(currenciesByAmount(totals, "CAD")).toEqual(["EUR", "USD", "ILS"]);
    expect(currenciesByAmount(totals)).toEqual(["EUR", "USD", "ILS"]);
  });
});

describe("lastMonths", () => {
  it("oldest first, across a year", () => {
    expect(lastMonths("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("percentLabel and donutSegment", () => {
  it("percent", () => {
    expect(percentLabel(1, 3)).toBe("33%");
    expect(percentLabel(1, 1000)).toBe("<1%");
    expect(percentLabel(0, 0)).toBe("0%");
  });
  it("a quarter segment starts at 12 o'clock and ends at 3 o'clock", () => {
    expect(donutSegment(50, 50, 50, 30, 0, Math.PI / 2)).toBe("M 50.000 0.000 A 50 50 0 0 1 100.000 50.000 L 80.000 50.000 A 30 30 0 0 0 50.000 20.000 Z");
  });
});
