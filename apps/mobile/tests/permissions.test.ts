import { describe, it, expect } from "vitest";
import { canChangeExpense, canChangeRule, canChangeRulePayer } from "../src/lib/permissions";

describe("canChangeExpense", () => {
  const expense = { paidById: 2, createdById: 3 };
  it("payer, creator and owners may", () => {
    expect(canChangeExpense(expense, 2, "MEMBER")).toBe(true);
    expect(canChangeExpense(expense, 3, "MEMBER")).toBe(true);
    expect(canChangeExpense(expense, 9, "OWNER")).toBe(true);
  });
  it("other members may not", () => {
    expect(canChangeExpense(expense, 9, "MEMBER")).toBe(false);
  });
});

describe("recurring expense permissions", () => {
  const rule = { paidById: 2, createdById: 3 };
  it("payer, creator and owners may change it", () => {
    expect(canChangeRule(rule, 2, "MEMBER")).toBe(true);
    expect(canChangeRule(rule, 9, "MEMBER")).toBe(false);
  });
  it("only the creator or an owner may change the payer", () => {
    expect(canChangeRulePayer(rule, 3, "MEMBER")).toBe(true);
    expect(canChangeRulePayer(rule, 9, "OWNER")).toBe(true);
    expect(canChangeRulePayer(rule, 2, "MEMBER")).toBe(false);
  });
});
