import { describe, it, expect } from "vitest";
import { formatMoney, joinAmounts, projectedLine, spentEntries, spentLine } from "../src/lib/money";

describe("formatMoney", () => {
  it("formats minor units with 2 decimals, thousands separators and the code", () => {
    expect(formatMoney(0, "USD")).toBe("0.00 USD");
    expect(formatMoney(5, "USD")).toBe("0.05 USD");
    expect(formatMoney(14250, "USD")).toBe("142.50 USD");
    expect(formatMoney(400000, "ILS")).toBe("4,000.00 ILS");
    expect(formatMoney(123456789, "EUR")).toBe("1,234,567.89 EUR");
  });

  it("handles negatives and sums past the 32-bit range", () => {
    expect(formatMoney(-14250, "USD")).toBe("-142.50 USD");
    expect(formatMoney(-5, "GBP")).toBe("-0.05 GBP");
    expect(formatMoney(6442450941, "USD")).toBe("64,424,509.41 USD");
  });
});

describe("summary lines", () => {
  const totals = [
    { currency: "ILS" as const, spent: 400000, projected: 0 },
    { currency: "EUR" as const, spent: 22000, projected: 5000 },
    { currency: "USD" as const, spent: 0, projected: 1000 },
  ];

  it("joins with ' and ' in the given order", () => {
    expect(joinAmounts([{ amount: 100, currency: "ILS" }, { amount: 200, currency: "EUR" }])).toBe("1.00 ILS and 2.00 EUR");
  });

  it("spent skips zero entries, keeping the API order", () => {
    expect(spentLine(totals)).toBe("4,000.00 ILS and 220.00 EUR");
  });

  it("spent shows the default currency's zero when everything is zero", () => {
    expect(spentLine([{ currency: "ILS", spent: 0, projected: 0 }, { currency: "EUR", spent: 0, projected: 300 }])).toBe("0.00 ILS");
  });

  it("projected lists only positive entries, or null", () => {
    expect(projectedLine(totals)).toBe("50.00 EUR and 10.00 USD");
    expect(projectedLine([{ currency: "ILS", spent: 5, projected: 0 }])).toBeNull();
  });

  it("spentEntries keeps the non-zero currencies in order, or the first zero", () => {
    expect(spentEntries([{ currency: "ILS", spent: 400000, projected: 0 }, { currency: "EUR", spent: 0, projected: 5 }, { currency: "USD", spent: 99, projected: 0 }]))
      .toEqual([{ amount: 400000, currency: "ILS" }, { amount: 99, currency: "USD" }]);
    expect(spentEntries([{ currency: "EUR", spent: 0, projected: 0 }])).toEqual([{ amount: 0, currency: "EUR" }]);
  });
});
