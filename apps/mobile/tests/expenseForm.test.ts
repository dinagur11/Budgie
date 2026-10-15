import { describe, it, expect } from "vitest";
import { amountInput, parseAmount } from "../src/lib/money";
import { addDays, addMonths } from "../src/lib/dates";
import { validateAmount, validateDescription, validateExpenseDate } from "../src/lib/validate";

describe("parseAmount", () => {
  it("reads whole and decimal amounts as minor units", () => {
    expect(parseAmount("12")).toBe(1200);
    expect(parseAmount("12.5")).toBe(1250);
    expect(parseAmount("12.50")).toBe(1250);
    expect(parseAmount(" 0.01 ")).toBe(1);
    expect(parseAmount("12.")).toBe(1200);
  });
  it("decimal comma and thousands separators", () => {
    expect(parseAmount("12,50")).toBe(1250);
    expect(parseAmount("1,234.50")).toBe(123450);
    expect(parseAmount("1,234")).toBe(123400);
    expect(parseAmount("1,234,567")).toBe(123456700);
  });
  it("rejects anything else", () => {
    for (const bad of ["", "0", "0.00", "-5", "1.234", "abc", "1e3", "12,5,0", ".5", "21474837", "1,23,4"])
      expect(parseAmount(bad)).toBeNull();
    expect(parseAmount("21474836.47")).toBe(2147483647);
  });
});

describe("amountInput", () => {
  it("round-trips through parseAmount", () => {
    for (const minor of [1, 5, 100, 1250, 123456, 2147483647]) expect(parseAmount(amountInput(minor))).toBe(minor);
    expect(amountInput(1250)).toBe("12.50");
    expect(amountInput(7)).toBe("0.07");
  });
});

describe("addDays", () => {
  it("crosses months and years", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-10-15", 0)).toBe("2026-10-15");
  });
});

describe("addMonths", () => {
  it("crosses years both ways", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-10", 0)).toBe("2026-10");
    expect(addMonths("2026-10", -22)).toBe("2024-12");
  });
});

describe("expense form validators", () => {
  it("amount", () => {
    expect(validateAmount("")).toBe("Enter an amount");
    expect(validateAmount("0")).toMatch(/such as/);
    expect(validateAmount("9.99")).toBeNull();
  });
  it("date: format, real day, range, not in the future", () => {
    const today = "2026-10-15";
    expect(validateExpenseDate("2026-10-15", today)).toBeNull();
    expect(validateExpenseDate("2026-10-14", today)).toBeNull();
    expect(validateExpenseDate("2026-10-16", today)).toMatch(/future/);
    expect(validateExpenseDate("2026-02-30", today)).toBe("Enter a real date");
    expect(validateExpenseDate("1999-12-31", today)).toBe("Enter a real date");
    expect(validateExpenseDate("15/10/2026", today)).toMatch(/YYYY-MM-DD/);
  });
  it("description", () => {
    expect(validateDescription("")).toBeNull();
    expect(validateDescription("x".repeat(500))).toBeNull();
    expect(validateDescription("x".repeat(501))).toMatch(/500/);
  });
});
