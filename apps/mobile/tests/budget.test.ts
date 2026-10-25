import { describe, it, expect } from "vitest";
import { budgetProgress, daysUntilReset, limitFromInput } from "../src/lib/budget";
import { validateLimit } from "../src/lib/validate";

describe("budgetProgress", () => {
  it("is ok below 80%, warning from 80% to 100%, over above 100%", () => {
    expect(budgetProgress(1550, 3000)).toEqual({ percent: 52, fill: 1550 / 3000, tone: "ok" });
    expect(budgetProgress(2400, 3000)).toEqual({ percent: 80, fill: 0.8, tone: "warning" });
    expect(budgetProgress(3000, 3000)).toEqual({ percent: 100, fill: 1, tone: "warning" });
    expect(budgetProgress(3360, 3000)).toEqual({ percent: 112, fill: 1, tone: "over" });
  });

  it("starts empty with nothing spent", () => {
    expect(budgetProgress(0, 3000)).toEqual({ percent: 0, fill: 0, tone: "ok" });
  });

  it("handles sums past the 32-bit range", () => {
    expect(budgetProgress(4_000_000_000, 2_000_000_000)).toEqual({ percent: 200, fill: 1, tone: "over" });
  });
});

describe("daysUntilReset", () => {
  it("counts to the first of next month", () => {
    expect(daysUntilReset("2026-05-15")).toBe(17);
    expect(daysUntilReset("2026-10-31")).toBe(1);
    expect(daysUntilReset("2026-02-01")).toBe(28);
    expect(daysUntilReset("2028-02-28")).toBe(2);
  });
});

describe("validateLimit and limitFromInput", () => {
  it("empty means no limit", () => {
    expect(validateLimit("")).toBeNull();
    expect(validateLimit("  ")).toBeNull();
    expect(limitFromInput(" ")).toBeNull();
  });

  it("parses amounts like the expense form", () => {
    expect(validateLimit("3000")).toBeNull();
    expect(limitFromInput("3000")).toBe(300000);
    expect(limitFromInput("1,234.50")).toBe(123450);
  });

  it("rejects what isn't an amount", () => {
    for (const v of ["0", "abc", "-5", "1.234"]) expect(validateLimit(v)).toBe("Enter an amount such as 3000, or leave it empty");
  });
});
