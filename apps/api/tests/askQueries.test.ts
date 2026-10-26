import { describe, it, expect } from "vitest";
import { prisma, createUser, createHousehold, addMember } from "./helpers.js";
import {
  averageMonthlySpending, lastPurchase, loadHouseholdFacts, peakMonth, recurringCost, toQueryContext, topCategory, topExpenses,
  totalSpending, GROUP_ROWS,
} from "../src/services/spendingQueryService.js";
import type { Currency, Frequency } from "../generated/prisma/client.js";

// built-ins in every version of the seed
const builtin = (name: string) => prisma.category.findFirstOrThrow({ where: { householdId: null, name } });

type Exp = { name: string; amount: number; currency?: Currency; date: string; categoryId: number; paidById: number; recurringRuleId?: number };
const addExpense = (householdId: number, e: Exp) =>
  prisma.expense.create({
    data: { currency: "ILS", ...e, date: new Date(e.date), createdById: e.paidById, householdId },
  });

// Home (ILS, UTC): Dana (the caller) and Yoni (a former member); Other: someone else's household with a matching name
async function setup() {
  const dana = await createUser("Dana");
  const yoni = await createUser("Yoni");
  const outsider = await createUser("Eve");
  const h = await prisma.household.create({ data: { name: "Home", defaultCurrency: "ILS", timeZone: "UTC" } });
  await addMember(h.id, dana.id, "OWNER");
  await addMember(h.id, yoni.id, "MEMBER", { leftAt: new Date() });
  const other = await createHousehold("Other", outsider);
  const [groceries, dining] = await Promise.all(["Groceries", "Dining out"].map(builtin));
  // household categories, so the test doesn't depend on the rest of the seed
  const travel = await prisma.category.create({ data: { householdId: h.id, name: "Travel" } });
  const housing = await prisma.category.create({ data: { householdId: h.id, name: "Housing & Rent", isArchived: true } });
  const rule = await prisma.recurringRule.create({
    data: {
      name: "Rent", amount: 500000, currency: "ILS", frequency: "MONTHLY", startDate: new Date("2026-03-01"), nextOccurrence: null,
      endDate: new Date("2026-03-01"), householdId: h.id, paidById: dana.id, createdById: dana.id, categoryId: housing.id,
    },
  });

  const add = (e: Exp) => addExpense(h.id, e);
  await add({ name: "Shufersal", amount: 10000, date: "2026-01-10", categoryId: groceries.id, paidById: dana.id });
  await add({ name: "Pizza", amount: 5000, date: "2026-01-12", categoryId: dining.id, paidById: yoni.id });
  await add({ name: "Hotel", amount: 20000, currency: "EUR", date: "2026-01-20", categoryId: travel.id, paidById: dana.id });
  await add({ name: "SHUFERSAL", amount: 2000, date: "2026-02-03", categoryId: groceries.id, paidById: dana.id });
  await add({ name: "Shufersal Deal", amount: 30000, date: "2026-03-05", categoryId: groceries.id, paidById: dana.id });
  await add({ name: "100%_Natural", amount: 1500, date: "2026-03-06", categoryId: groceries.id, paidById: dana.id });
  await add({ name: "Rent", amount: 500000, date: "2026-03-01", categoryId: housing.id, paidById: dana.id, recurringRuleId: rule.id });
  // another household's data, which must never show up
  await addExpense(other.id, { name: "Shufersal", amount: 99999, date: "2026-03-05", categoryId: groceries.id, paidById: outsider.id });

  const facts = await loadHouseholdFacts(h.id, dana.id);
  return { ctx: toQueryContext(h.id, facts), facts, h, other, dana, yoni, outsider, groceries, dining, housing };
}

const money = (amount: number, currency = "ILS") => ({ amount, formatted: `${(amount / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} ${currency}` });

describe("loadHouseholdFacts", () => {
  it("lists built-in and household categories (archived too) and every member row, former ones included", async () => {
    const { facts, h, dana, yoni } = await setup();
    await prisma.category.create({ data: { householdId: h.id, name: "Kids", isArchived: true } });
    const again = await loadHouseholdFacts(h.id, dana.id);
    expect(again.categories).toContainEqual(expect.objectContaining({ name: "Kids", isArchived: true }));
    expect(again.categories).toContainEqual(expect.objectContaining({ name: "Housing & Rent", isArchived: true }));
    expect(again.categories.filter((c) => c.name === "Groceries")).toHaveLength(1);
    expect(facts.members).toEqual([
      { id: dana.id, name: "Dana", isActive: true, isYou: true },
      { id: yoni.id, name: "Yoni", isActive: false, isYou: false },
    ]);
    expect(JSON.stringify(facts)).not.toMatch(/email|cognito|example\.com/);
  });
});

describe("totalSpending", () => {
  it("totals per currency, the default currency first, never mixing currencies or households", async () => {
    const { ctx } = await setup();
    const res = await totalSpending(ctx, {});
    expect(res).toEqual({
      filter: {},
      groupBy: "none",
      noData: false,
      currencies: [
        { currency: "ILS", total: money(548500), count: 6 },
        { currency: "EUR", total: money(20000, "EUR"), count: 1 },
      ],
    });
    expect(() => JSON.stringify(res)).not.toThrow(); // no BigInt
  });

  it("groups by category with names, and by payer marking former members", async () => {
    const { ctx } = await setup();
    const byCategory = await totalSpending(ctx, { currency: "ILS" }, "category");
    expect(byCategory.currencies).toHaveLength(1);
    expect(byCategory.currencies[0].groups).toEqual([
      { name: "Housing & Rent", total: money(500000), count: 1 },
      { name: "Groceries", total: money(43500), count: 4 },
      { name: "Dining out", total: money(5000), count: 1 },
    ]);
    expect(byCategory.currencies[0].truncated).toBe(false);
    expect(byCategory.filter).toEqual({ currency: "ILS" });

    const byPayer = await totalSpending(ctx, {}, "payer");
    expect(byPayer.currencies[0].groups.map((g) => g.name)).toEqual(["Dana", "Yoni (former member)"]);
    expect(byPayer.currencies[1]).toMatchObject({ currency: "EUR", groups: [{ name: "Dana", total: money(20000, "EUR"), count: 1 }] });
  });

  it("groups names case-insensitively", async () => {
    const { ctx } = await setup();
    const res = await totalSpending(ctx, { nameContains: "shufersal" }, "name");
    const groups = res.currencies[0].groups;
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ name: "Shufersal Deal", total: money(30000), count: 1 });
    expect(groups[1]).toMatchObject({ total: money(12000), count: 2 });
    expect(["Shufersal", "SHUFERSAL"]).toContain(groups[1].name);
  });

  it("filters by name (case-insensitive), payer (a former member), category, currency and dates", async () => {
    const { ctx, yoni, groceries } = await setup();
    expect((await totalSpending(ctx, { nameContains: "ShUfErSaL" })).currencies).toEqual([{ currency: "ILS", total: money(42000), count: 3 }]);
    expect((await totalSpending(ctx, { paidById: yoni.id })).currencies).toEqual([{ currency: "ILS", total: money(5000), count: 1 }]);
    expect((await totalSpending(ctx, { categoryId: groceries.id, from: "2026-03-01", to: "2026-03-31" })).currencies)
      .toEqual([{ currency: "ILS", total: money(31500), count: 2 }]);
    expect((await totalSpending(ctx, { currency: "EUR" })).currencies).toEqual([{ currency: "EUR", total: money(20000, "EUR"), count: 1 }]);
    const f = await totalSpending(ctx, { paidById: yoni.id, categoryId: groceries.id });
    expect(f.filter).toEqual({ paidBy: "Yoni (former member)", category: "Groceries" });
  });

  it("treats % and _ in nameContains as plain characters, not wildcards", async () => {
    const { ctx } = await setup();
    for (const text of ["%", "_", "0%_n"]) {
      expect((await totalSpending(ctx, { nameContains: text })).currencies).toEqual([{ currency: "ILS", total: money(1500), count: 1 }]);
    }
    expect((await totalSpending(ctx, { nameContains: "s%l" })).noData).toBe(true);
    expect((await totalSpending(ctx, { nameContains: "\\" })).noData).toBe(true);
  });

  it("an empty result has noData and no currencies", async () => {
    const { ctx } = await setup();
    expect(await totalSpending(ctx, { from: "2025-01-01", to: "2025-01-31" }, "category"))
      .toEqual({ filter: { from: "2025-01-01", to: "2025-01-31" }, groupBy: "category", noData: true, currencies: [] });
  });

  it("lists the top 20 groups and folds the rest into one 'other' row with the right total", async () => {
    const user = await createUser("Many");
    const h = await createHousehold("Many", user);
    const groceries = await builtin("Groceries");
    for (let i = 1; i <= GROUP_ROWS + 2; i++)
      await addExpense(h.id, { name: `Shop ${i}`, amount: i * 100, currency: "USD", date: "2026-01-01", categoryId: groceries.id, paidById: user.id });
    const ctx = toQueryContext(h.id, await loadHouseholdFacts(h.id, user.id));
    const res = await totalSpending(ctx, {}, "name");
    const usd = res.currencies[0];
    expect(usd.groups).toHaveLength(21);
    expect(usd.groups[0]).toMatchObject({ name: "Shop 22", total: money(2200, "USD") });
    expect(usd.groups[20]).toEqual({ name: "Other (2 more)", total: money(300, "USD"), count: 2, isOther: true });
    expect(usd.truncated).toBe(true);
    expect(usd.total.amount).toBe((22 * 23 / 2) * 100);
    expect(usd.count).toBe(22);
  });
});

describe("averageMonthlySpending", () => {
  it("over a window, months without spending count as 0", async () => {
    const { ctx } = await setup();
    const res = await averageMonthlySpending(ctx, { nameContains: "shufersal", from: "2026-01-01", to: "2026-04-30" });
    expect(res).toMatchObject({
      basis: "window",
      window: { fromMonth: "2026-01", toMonth: "2026-04", months: 4 },
      currencies: [{ currency: "ILS", monthlyAverage: money(10500), total: money(42000), count: 3 }],
    });
  });

  it("without a window, over the months that have matching spending", async () => {
    const { ctx } = await setup();
    const res = await averageMonthlySpending(ctx, { nameContains: "shufersal" });
    expect(res).toMatchObject({
      basis: "months_with_data",
      currencies: [{ currency: "ILS", monthlyAverage: money(14000), total: money(42000), months: 3, count: 3 }],
    });
  });

  it("with only `to`, the window starts at the first matching expense; with only `from`, it ends today", async () => {
    const { ctx } = await setup();
    const onlyTo = await averageMonthlySpending(ctx, { nameContains: "shufersal", to: "2026-03-31" });
    expect(onlyTo).toMatchObject({ basis: "window", window: { fromMonth: "2026-01", toMonth: "2026-03", months: 3 } });
    const onlyFrom = await averageMonthlySpending(ctx, { from: "2026-01-01" });
    expect(onlyFrom).toMatchObject({ basis: "window", window: { toMonth: ctx.today.slice(0, 7) }, includesCurrentMonth: true });
  });

  it("splits currencies and reports no data", async () => {
    const { ctx } = await setup();
    const res = await averageMonthlySpending(ctx, {});
    expect(res.currencies.map((c) => c.currency)).toEqual(["ILS", "EUR"]);
    expect((await averageMonthlySpending(ctx, { nameContains: "nothing here" })).noData).toBe(true);
    expect((await averageMonthlySpending(ctx, { nameContains: "nothing here", from: "2026-01-01", to: "2026-02-28" })).noData).toBe(true);
  });
});

describe("topExpenses", () => {
  it("the most expensive expenses per currency, with names instead of ids", async () => {
    const { ctx } = await setup();
    const res = await topExpenses(ctx, {}, 2);
    expect(res).toEqual({
      filter: {},
      noData: false,
      truncated: false,
      currencies: [
        {
          currency: "ILS",
          expenses: [
            { rank: 1, name: "Rent", amount: money(500000), date: "2026-03-01", category: "Housing & Rent", paidBy: "Dana", isRecurring: true },
            { rank: 2, name: "Shufersal Deal", amount: money(30000), date: "2026-03-05", category: "Groceries", paidBy: "Dana", isRecurring: false },
          ],
        },
        { currency: "EUR", expenses: [{ rank: 1, name: "Hotel", amount: money(20000, "EUR"), date: "2026-01-20", category: "Travel", paidBy: "Dana", isRecurring: false }] },
      ],
    });
  });

  it("never lists more than 25 rows", async () => {
    const user = await createUser("Many");
    const h = await createHousehold("Many", user);
    const groceries = await builtin("Groceries");
    for (const currency of ["USD", "EUR"] as Currency[])
      for (let i = 1; i <= 15; i++)
        await addExpense(h.id, { name: `X${i}`, amount: i, currency, date: "2026-01-01", categoryId: groceries.id, paidById: user.id });
    const ctx = toQueryContext(h.id, await loadHouseholdFacts(h.id, user.id));
    const res = await topExpenses(ctx, {}, 25);
    expect(res.truncated).toBe(true);
    expect(res.currencies.flatMap((c) => c.expenses)).toHaveLength(25);
    expect(res.currencies[0].currency).toBe("USD"); // the default currency is listed first
  });
});

describe("topCategory and peakMonth", () => {
  it("ranks categories by total per currency", async () => {
    const { ctx, dana } = await setup();
    const res = await topCategory(ctx, { paidById: dana.id });
    expect(res.currencies[0].groups.map((g) => g.name)).toEqual(["Housing & Rent", "Groceries"]);
    expect(res.currencies[1].groups.map((g) => g.name)).toEqual(["Travel"]);
  });

  it("finds the peak month and the runner-up", async () => {
    const { ctx, groceries } = await setup();
    expect((await peakMonth(ctx, { categoryId: groceries.id })).currencies).toEqual([
      { currency: "ILS", peak: { month: "2026-03", total: money(31500), count: 2 }, runnerUp: { month: "2026-01", total: money(10000), count: 1 }, monthsWithData: 3 },
    ]);
    const single = await peakMonth(ctx, { currency: "EUR" });
    expect(single.currencies[0]).toMatchObject({ peak: { month: "2026-01" }, runnerUp: null, monthsWithData: 1 });
  });
});

describe("lastPurchase", () => {
  it("returns the most recent matching expense, or found: false", async () => {
    const { ctx } = await setup();
    expect(await lastPurchase(ctx, { nameContains: "shufersal" })).toMatchObject({ found: true, expense: { name: "Shufersal Deal", date: "2026-03-05" } });
    expect(await lastPurchase(ctx, { nameContains: "pizza" })).toMatchObject({ found: true, expense: { paidBy: "Yoni (former member)", category: "Dining out" } });
    expect(await lastPurchase(ctx, { nameContains: "ikea" })).toEqual({ filter: { nameContains: "ikea" }, found: false });
  });
});

describe("recurringCost", () => {
  it("converts active rules to a monthly equivalent per currency and leaves out ended rules", async () => {
    const { ctx, h, dana, yoni, housing } = await setup();
    const rule = (name: string, amount: number, frequency: Frequency, paidById = dana.id, currency: Currency = "ILS", nextOccurrence: Date | null = new Date("2026-12-01")) =>
      prisma.recurringRule.create({
        data: { name, amount, currency, frequency, startDate: new Date("2026-01-01"), nextOccurrence, householdId: h.id, paidById, createdById: dana.id, categoryId: housing.id },
      });
    await rule("Coffee", 1200, "DAILY");
    await rule("Cleaner", 1200, "WEEKLY", yoni.id);
    await rule("Gym", 1200, "BIWEEKLY");
    await rule("Insurance", 12000, "YEARLY");
    await rule("Netflix", 1000, "MONTHLY", dana.id, "EUR");
    await rule("Old", 99999, "MONTHLY", dana.id, "ILS", null); // ended

    const res = await recurringCost(ctx);
    expect(res.approximate).toBe(true);
    expect(res.currencies.map((c) => c.currency)).toEqual(["ILS", "EUR"]);
    const ils = res.currencies[0];
    // 1200*365/12 + 1200*52/12 + 1200*26/12 + 12000/12 = 36500 + 5200 + 2600 + 1000
    expect(ils.monthlyTotal).toEqual(money(45300));
    expect(ils.rules.map((r) => [r.name, r.monthlyEquivalent.amount])).toEqual([
      ["Insurance", 1000], ["Coffee", 36500], ["Cleaner", 5200], ["Gym", 2600],
    ]);
    expect(ils.rules.find((r) => r.name === "Cleaner")).toMatchObject({ frequency: "WEEKLY", amount: money(1200), paidBy: "Yoni (former member)", category: "Housing & Rent" });
    expect(res.currencies[1].monthlyTotal).toEqual(money(1000, "EUR"));
    expect(JSON.stringify(res)).not.toContain("Old");

    const yonis = await recurringCost(ctx, yoni.id);
    expect(yonis).toMatchObject({ paidBy: "Yoni (former member)", currencies: [{ currency: "ILS", monthlyTotal: money(5200) }] });
  });

  it("rounds to whole minor units and reports no rules", async () => {
    const { ctx, h, dana, housing } = await setup();
    expect((await recurringCost(ctx)).noData).toBe(true);
    await prisma.recurringRule.create({
      data: { name: "Odd", amount: 1001, currency: "ILS", frequency: "WEEKLY", startDate: new Date("2026-01-01"), nextOccurrence: new Date("2026-12-01"), householdId: h.id, paidById: dana.id, createdById: dana.id, categoryId: housing.id },
    });
    expect((await recurringCost(ctx)).currencies[0].monthlyTotal.amount).toBe(Math.round(1001 * 52 / 12));
  });
});
