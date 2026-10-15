import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma, as, anon, createUser, createHousehold, addMember } from "./helpers.js";

const TOTAL_KEYS = ["currency", "projected", "spent"];
const INVALID_MONTH = { error: "Invalid month" };

// fake only Date, so supertest and the database driver keep their real timers
function setNow(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
});

// owner (OWNER) and member (MEMBER) in household h (default USD) with category food; a second household h2 with its own owner and category
async function setup(timeZone = "UTC") {
  const owner = await createUser("Owner");
  const member = await createUser("Member");
  const h = await createHousehold("Home", owner);
  await prisma.household.update({ where: { id: h.id }, data: { timeZone } });
  await addMember(h.id, member.id);
  const food = await prisma.category.create({ data: { householdId: h.id, name: "Food" } });
  const otherOwner = await createUser("Other owner");
  const h2 = await createHousehold("Elsewhere", otherOwner);
  const foreign = await prisma.category.create({ data: { householdId: h2.id, name: "Foreign" } });
  return { owner, member, h, food, otherOwner, h2, foreign };
}

const summary = (user: { id: number }, householdId: number, month: string) =>
  as(user).get(`/households/${householdId}/summary?month=${month}`);
const calendar = (user: { id: number }, householdId: number, month: string) =>
  as(user).get(`/households/${householdId}/calendar?month=${month}`);

async function addRule(user: { id: number }, householdId: number, categoryId: number, extra: object) {
  const res = await as(user).post(`/households/${householdId}/rules`).send({
    name: "Rule", amount: 1000, currency: "USD", frequency: "MONTHLY", startDate: "2026-10-01", categoryId, paidById: user.id, ...extra,
  });
  expect(res.status).toBe(201);
  return res.body;
}

// inserted directly, so a test can place any date and amount
async function addExpense(householdId: number, categoryId: number, paidById: number, date: string, amount: number, currency = "USD") {
  return prisma.expense.create({
    data: { householdId, categoryId, paidById, createdById: paidById, name: "Manual", amount, currency: currency as any, date: new Date(date) },
  });
}

// per-currency sums of the calendar's projected list
function sumProjected(calendarBody: any) {
  const sums: Record<string, number> = {};
  for (const p of calendarBody.projected) sums[p.currency] = (sums[p.currency] ?? 0) + p.amount;
  return sums;
}

describe("GET /households/:id/summary", () => {
  it("exact shape; the default currency is always present, with zeros when there is nothing", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { member, h, owner } = await setup();
    const res = await summary(member, h.id, "2026-10");
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ month: "2026-10", totals: [{ currency: "USD", spent: 0, projected: 0 }] });

    // a household with another default currency gets that one
    await prisma.household.update({ where: { id: h.id }, data: { defaultCurrency: "ILS" } });
    expect((await summary(owner, h.id, "2026-10")).body).toStrictEqual({ month: "2026-10", totals: [{ currency: "ILS", spent: 0, projected: 0 }] });
  });

  it("several currencies: spent and projected per currency, default first, then the others alphabetically, only when non-zero", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    await prisma.household.update({ where: { id: h.id }, data: { defaultCurrency: "ILS" } });
    await addExpense(h.id, food.id, owner.id, "2026-10-02", 700, "USD");
    await addExpense(h.id, food.id, owner.id, "2026-10-03", 300, "USD");
    await addExpense(h.id, food.id, owner.id, "2026-10-05", 4000, "GBP");
    // projected only: the Wednesdays after today, Oct 21 and 28 -> 2 * 220 EUR
    await prisma.recurringRule.create({
      data: { householdId: h.id, name: "Gym", amount: 220, currency: "EUR", frequency: "WEEKLY", startDate: new Date("2026-10-07"),
        nextOccurrence: new Date("2026-10-21"), paidById: owner.id, createdById: owner.id, categoryId: food.id },
    });
    // a CHF rule with no occurrence in October: CHF must not appear
    await prisma.recurringRule.create({
      data: { householdId: h.id, name: "Insurance", amount: 999, currency: "CHF", frequency: "YEARLY", startDate: new Date("2026-01-01"),
        nextOccurrence: new Date("2027-01-01"), paidById: owner.id, createdById: owner.id, categoryId: food.id },
    });

    const res = await summary(owner, h.id, "2026-10");
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({
      month: "2026-10",
      totals: [
        { currency: "ILS", spent: 0, projected: 0 },
        { currency: "EUR", spent: 0, projected: 440 },
        { currency: "GBP", spent: 4000, projected: 0 },
        { currency: "USD", spent: 1000, projected: 0 },
      ],
    });
    for (const t of res.body.totals) expect(Object.keys(t).sort()).toStrictEqual(TOTAL_KEYS);
  });

  it("spent includes today and the month's first and last day; excludes neighbouring months and other households", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food, h2, foreign, otherOwner } = await setup();
    // September (a past month): first and last day in, Aug 31 and Oct 1 out
    await addExpense(h.id, food.id, owner.id, "2026-08-31", 1);
    await addExpense(h.id, food.id, owner.id, "2026-09-01", 10);
    await addExpense(h.id, food.id, owner.id, "2026-09-30", 100);
    await addExpense(h.id, food.id, owner.id, "2026-10-01", 1000);
    await addExpense(h.id, food.id, owner.id, "2026-10-14", 10000);
    await addExpense(h2.id, foreign.id, otherOwner.id, "2026-09-15", 7);
    await addExpense(h2.id, foreign.id, otherOwner.id, "2026-10-14", 7);

    expect((await summary(owner, h.id, "2026-09")).body.totals).toStrictEqual([{ currency: "USD", spent: 110, projected: 0 }]);
    // the current month: Oct 1 and today
    expect((await summary(owner, h.id, "2026-10")).body.totals).toStrictEqual([{ currency: "USD", spent: 11000, projected: 0 }]);
  });

  it("projected equals the sum of the calendar's projected list (several rules, currencies, month-end clamping)", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, member, h, food } = await setup();
    await addRule(owner, h.id, food.id, { name: "Rent", amount: 100000, startDate: "2026-01-31" }); // Feb 28, Apr 30
    await addRule(owner, h.id, food.id, { name: "Gym", amount: 2500, currency: "EUR", frequency: "WEEKLY", startDate: "2026-09-30" });
    await addRule(owner, h.id, food.id, { name: "Coffee", amount: 450, currency: "ILS", frequency: "DAILY", startDate: "2026-10-10", endDate: "2027-02-10" });
    await addRule(member, h.id, food.id, { name: "Tax", amount: 7000, currency: "GBP", frequency: "YEARLY", startDate: "2024-02-29" }); // Feb 28, 2027
    await addRule(member, h.id, food.id, { name: "Pocket", amount: 300, currency: "USD", frequency: "BIWEEKLY", startDate: "2026-10-03" });

    for (const month of ["2026-10", "2026-11", "2027-02", "2027-04", "2028-02"]) {
      const cal = sumProjected((await calendar(owner, h.id, month)).body);
      const sum = (await summary(owner, h.id, month)).body;
      const projected = Object.fromEntries(sum.totals.filter((t: any) => t.projected !== 0).map((t: any) => [t.currency, t.projected]));
      expect(projected, month).toStrictEqual(cal);
      expect(Object.keys(cal).length, month).toBeGreaterThan(0);
    }
    // spot checks: February 2027 has Rent (clamped to the 28th), 4 Gym Wednesdays, 10 Coffees, Tax (clamped) and 2 Pockets
    expect((await summary(owner, h.id, "2027-02")).body.totals).toStrictEqual([
      { currency: "USD", spent: 0, projected: 100000 + 2 * 300 },
      { currency: "EUR", spent: 0, projected: 4 * 2500 },
      { currency: "GBP", spent: 0, projected: 7000 },
      { currency: "ILS", spent: 0, projected: 10 * 450 },
    ]);
  });

  it("past month: projected is 0; future month: spent is 0, projections only", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    await addRule(owner, h.id, food.id, { name: "Rent", amount: 1000, startDate: "2026-08-01" });
    expect((await summary(owner, h.id, "2026-09")).body.totals).toStrictEqual([{ currency: "USD", spent: 1000, projected: 0 }]);
    expect((await summary(owner, h.id, "2026-12")).body.totals).toStrictEqual([{ currency: "USD", spent: 0, projected: 1000 }]);
    // the current month: Oct 1 is already a real expense, nothing left to project
    expect((await summary(owner, h.id, "2026-10")).body.totals).toStrictEqual([{ currency: "USD", spent: 1000, projected: 0 }]);
  });

  it("sums above 2147483647 are returned as plain JSON numbers", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    for (const day of ["01", "02", "03"]) await addExpense(h.id, food.id, owner.id, `2026-10-${day}`, 2147483647);
    await addRule(owner, h.id, food.id, { amount: 2000000000, currency: "EUR", frequency: "DAILY", startDate: "2026-10-14" });
    const res = await summary(owner, h.id, "2026-10");
    expect(res.text).toContain("6442450941");
    expect(res.body.totals).toStrictEqual([
      { currency: "USD", spent: 3 * 2147483647, projected: 0 },
      { currency: "EUR", spent: 2000000000, projected: 17 * 2000000000 },
    ]);
  });

  it("time zone: with a household ahead of UTC, the split between spent and projected follows the household's today", async () => {
    // Oct 14 20:00 UTC is already Oct 15 in Tokyo
    setNow("2026-10-14T20:00:00Z");
    const { owner, h, food } = await setup("Asia/Tokyo");
    await addRule(owner, h.id, food.id, { amount: 100, frequency: "DAILY", startDate: "2026-10-14" });
    expect((await summary(owner, h.id, "2026-10")).body.totals).toStrictEqual([{ currency: "USD", spent: 200, projected: 1600 }]);

    // the same rule in a UTC household: only Oct 14 is real
    const { h: h3, food: food3, owner: owner3 } = await setup();
    await addRule(owner3, h3.id, food3.id, { amount: 100, frequency: "DAILY", startDate: "2026-10-14" });
    expect((await summary(owner3, h3.id, "2026-10")).body.totals).toStrictEqual([{ currency: "USD", spent: 100, projected: 1700 }]);
  });

  it("totals include the recurring expenses the catch-up just generated", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    // a rule that is behind: nothing generated since Oct 1
    await prisma.recurringRule.create({
      data: { householdId: h.id, name: "Coffee", amount: 10, currency: "USD", frequency: "DAILY", startDate: new Date("2026-10-01"),
        nextOccurrence: new Date("2026-10-01"), paidById: owner.id, createdById: owner.id, categoryId: food.id },
    });
    expect(await prisma.expense.count({ where: { householdId: h.id } })).toBe(0);
    expect((await summary(owner, h.id, "2026-10")).body.totals).toStrictEqual([{ currency: "USD", spent: 140, projected: 170 }]);
    expect(await prisma.expense.count({ where: { householdId: h.id } })).toBe(14);
  });

  it("the projection writes nothing: expense rows and rules are unchanged by summary reads", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    await addRule(owner, h.id, food.id, { frequency: "DAILY", startDate: "2026-10-01" });
    await addRule(owner, h.id, food.id, { startDate: "2026-01-31", currency: "EUR" });
    await summary(owner, h.id, "2026-10"); // the catch-up has nothing left to do after this
    const before = await prisma.expense.count();
    const rulesBefore = await prisma.recurringRule.findMany({ where: { householdId: h.id }, orderBy: { id: "asc" } });
    for (const month of ["2026-10", "2026-11", "2027-02", "2100-12"])
      expect((await summary(owner, h.id, month)).body.totals[0].projected).toBeGreaterThan(0);
    expect(await prisma.expense.count()).toBe(before);
    expect(await prisma.recurringRule.findMany({ where: { householdId: h.id }, orderBy: { id: "asc" } })).toStrictEqual(rulesBefore);
  });

  it("month: missing, repeated or malformed is 400 'Invalid month'", async () => {
    const { owner, h } = await setup();
    const queries = [
      "", "?month=", "?month=2026-13", "?month=2026-00", "?month=2026-1", "?month=abc", "?month=1999-12", "?month=2101-01",
      "?month=2026-10-01", "?month=%202026-10", "?month=2026/10", "?month=2026-10&month=2026-11", "?month[a]=2026-10",
    ];
    for (const q of queries) {
      const res = await as(owner).get(`/households/${h.id}/summary${q}`);
      expect(res.status, q).toBe(400);
      expect(res.body).toStrictEqual(INVALID_MONTH);
    }
    expect((await summary(owner, h.id, "2000-01")).status).toBe(200);
    expect((await summary(owner, h.id, "2100-12")).status).toBe(200);
  });

  it("authorization: 401 without credentials, 404 for a non-member and for a user who left, 400 for an invalid id", async () => {
    const { member, h, otherOwner } = await setup();
    expect((await anon().get(`/households/${h.id}/summary?month=2026-10`)).status).toBe(401);
    expect((await summary(otherOwner, h.id, "2026-10")).status).toBe(404);
    expect((await summary(member, h.id, "2026-10")).status).toBe(200);
    await prisma.householdMember.update({ where: { userId_householdId: { userId: member.id, householdId: h.id } }, data: { leftAt: new Date() } });
    expect((await summary(member, h.id, "2026-10")).status).toBe(404);
    expect((await summary(otherOwner, 0, "2026-10")).body).toStrictEqual({ error: "Invalid id" });
  });
});
