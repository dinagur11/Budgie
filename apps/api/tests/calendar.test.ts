import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma, as, anon, createUser, createHousehold, addMember } from "./helpers.js";

const EXPENSE_KEYS = ["amount", "categoryId", "createdById", "currency", "date", "description", "id", "isRecurring", "name", "paidById"];
const PROJECTED_KEYS = ["amount", "categoryId", "currency", "date", "isProjected", "name", "paidById", "ruleId"];
const INVALID_MONTH = { error: "Invalid month" };

// fake only Date, so supertest and the database driver keep their real timers
function setNow(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
});

// owner (OWNER) and member (MEMBER) in household h with category food; a second household h2 with its own owner and category
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

const calendar = (user: { id: number }, householdId: number, month: string) =>
  as(user).get(`/households/${householdId}/calendar?month=${month}`);

async function addRule(user: { id: number }, householdId: number, categoryId: number, extra: object) {
  const res = await as(user).post(`/households/${householdId}/rules`).send({
    name: "Rule", amount: 1000, currency: "USD", frequency: "MONTHLY", startDate: "2026-10-01", categoryId, paidById: user.id, ...extra,
  });
  expect(res.status).toBe(201);
  return res.body;
}

async function addExpense(householdId: number, categoryId: number, paidById: number, date: string, name = "Manual") {
  return prisma.expense.create({
    data: { householdId, categoryId, paidById, createdById: paidById, name, amount: 500, currency: "EUR", date: new Date(date) },
  });
}

const projectedDates = (body: any) => body.projected.map((p: any) => p.date);

describe("GET /households/:id/calendar", () => {
  it("current month: real expenses (manual and caught-up) plus projections after today, exact shapes", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, member, h, food, h2, foreign, otherOwner } = await setup();
    const weekly = await addRule(owner, h.id, food.id, { name: "Gym", amount: 2500, frequency: "WEEKLY", startDate: "2026-09-30" });
    const monthly = await addRule(owner, h.id, food.id, { name: "Rent", amount: 100000, startDate: "2026-01-31" });
    const manual = await addExpense(h.id, food.id, member.id, "2026-10-05");
    await addExpense(h.id, food.id, member.id, "2026-09-30", "September");
    await addExpense(h.id, food.id, member.id, "2026-11-01", "November");
    await addExpense(h2.id, foreign.id, otherOwner.id, "2026-10-10", "Foreign");

    const res = await calendar(member, h.id, "2026-10");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toStrictEqual(["expenses", "month", "projected"]);
    expect(res.body.month).toBe("2026-10");

    expect(res.body.expenses.map((e: any) => [e.date, e.name])).toStrictEqual([
      ["2026-10-05", "Manual"], ["2026-10-07", "Gym"], ["2026-10-14", "Gym"],
    ]);
    for (const e of res.body.expenses) expect(Object.keys(e).sort()).toStrictEqual(EXPENSE_KEYS);
    expect(res.body.expenses[0]).toStrictEqual({
      id: manual.id, name: "Manual", amount: 500, currency: "EUR", date: "2026-10-05", categoryId: food.id,
      paidById: member.id, createdById: member.id, description: null, isRecurring: false,
    });
    expect(res.body.expenses[2].isRecurring).toBe(true);

    expect(res.body.projected).toStrictEqual([
      { ruleId: weekly.id, name: "Gym", amount: 2500, currency: "USD", date: "2026-10-21", categoryId: food.id, paidById: owner.id, isProjected: true },
      { ruleId: weekly.id, name: "Gym", amount: 2500, currency: "USD", date: "2026-10-28", categoryId: food.id, paidById: owner.id, isProjected: true },
      { ruleId: monthly.id, name: "Rent", amount: 100000, currency: "USD", date: "2026-10-31", categoryId: food.id, paidById: owner.id, isProjected: true },
    ]);
    for (const p of res.body.projected) expect(Object.keys(p).sort()).toStrictEqual(PROJECTED_KEYS);
    expect(JSON.stringify(res.body)).not.toMatch(/householdId|email|cognitoId|recurringRuleId/);
  });

  it("same date: expenses by id, projections by ruleId", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    const a = await addExpense(h.id, food.id, owner.id, "2026-10-03");
    const b = await addExpense(h.id, food.id, owner.id, "2026-10-03");
    const r1 = await addRule(owner, h.id, food.id, { startDate: "2026-09-20" });
    const r2 = await addRule(owner, h.id, food.id, { startDate: "2026-08-20" });
    const res = await calendar(owner, h.id, "2026-10");
    expect(res.body.expenses.filter((e: any) => e.date === "2026-10-03").map((e: any) => e.id)).toStrictEqual([a.id, b.id]);
    expect(res.body.projected.map((p: any) => [p.date, p.ruleId])).toStrictEqual([["2026-10-20", r1.id], ["2026-10-20", r2.id]]);
  });

  it("the catch-up runs first: days that passed since the last read become real expenses", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    await addRule(owner, h.id, food.id, { frequency: "DAILY", startDate: "2026-10-13" });
    setNow("2026-10-16T12:00:00Z");
    const res = await calendar(owner, h.id, "2026-10");
    expect(res.body.expenses.map((e: any) => e.date)).toStrictEqual(["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(projectedDates(res.body)[0]).toBe("2026-10-17");
    expect(projectedDates(res.body)).toHaveLength(15);
  });

  it("past month: real expenses only, projected is empty", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    await addRule(owner, h.id, food.id, { frequency: "WEEKLY", startDate: "2026-09-02" });
    const res = await calendar(owner, h.id, "2026-09");
    expect(res.body.expenses.map((e: any) => e.date)).toStrictEqual(["2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30"]);
    expect(res.body.projected).toStrictEqual([]);
  });

  it("future month: no expenses, projections only; an empty household gets empty lists", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    expect((await calendar(owner, h.id, "2026-12")).body).toStrictEqual({ month: "2026-12", expenses: [], projected: [] });
    await addRule(owner, h.id, food.id, { frequency: "WEEKLY", startDate: "2026-10-01" });
    const res = await calendar(owner, h.id, "2026-12");
    expect(res.body.expenses).toStrictEqual([]);
    expect(projectedDates(res.body)).toStrictEqual(["2026-12-03", "2026-12-10", "2026-12-17", "2026-12-24", "2026-12-31"]);
  });

  it("a monthly rule on the 31st is clamped to each month's last day, against the anchor", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    await addRule(owner, h.id, food.id, { startDate: "2026-01-31" });
    expect(projectedDates((await calendar(owner, h.id, "2026-11")).body)).toStrictEqual(["2026-11-30"]);
    expect(projectedDates((await calendar(owner, h.id, "2027-02")).body)).toStrictEqual(["2027-02-28"]);
    expect(projectedDates((await calendar(owner, h.id, "2027-03")).body)).toStrictEqual(["2027-03-31"]);
    expect(projectedDates((await calendar(owner, h.id, "2028-02")).body)).toStrictEqual(["2028-02-29"]);
  });

  it("a yearly rule on Feb 29 projects Feb 28 in common years and Feb 29 in leap years", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    await addRule(owner, h.id, food.id, { frequency: "YEARLY", startDate: "2024-02-29" });
    expect(projectedDates((await calendar(owner, h.id, "2027-02")).body)).toStrictEqual(["2027-02-28"]);
    expect(projectedDates((await calendar(owner, h.id, "2028-02")).body)).toStrictEqual(["2028-02-29"]);
    expect(projectedDates((await calendar(owner, h.id, "2027-03")).body)).toStrictEqual([]);
  });

  it("weekly and biweekly rules", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    const weekly = await addRule(owner, h.id, food.id, { frequency: "WEEKLY", startDate: "2026-10-02" });
    const biweekly = await addRule(owner, h.id, food.id, { frequency: "BIWEEKLY", startDate: "2026-10-13" });
    const res = await calendar(owner, h.id, "2026-11");
    const of = (id: number) => res.body.projected.filter((p: any) => p.ruleId === id).map((p: any) => p.date);
    expect(of(weekly.id)).toStrictEqual(["2026-11-06", "2026-11-13", "2026-11-20", "2026-11-27"]);
    expect(of(biweekly.id)).toStrictEqual(["2026-11-10", "2026-11-24"]);
  });

  it("a rule ending mid-month projects nothing after its end date (an occurrence on the end date is included)", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    await addRule(owner, h.id, food.id, { frequency: "WEEKLY", startDate: "2026-10-01", endDate: "2026-11-12" });
    await addRule(owner, h.id, food.id, { frequency: "WEEKLY", startDate: "2026-10-02", endDate: "2026-11-10" });
    expect(projectedDates((await calendar(owner, h.id, "2026-11")).body)).toStrictEqual(["2026-11-05", "2026-11-06", "2026-11-12"]);
    expect(projectedDates((await calendar(owner, h.id, "2026-12")).body)).toStrictEqual([]);
  });

  it("ended rules project nothing: one that started and ended in the past, and one ended by an edit", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    const past = await addRule(owner, h.id, food.id, { frequency: "WEEKLY", startDate: "2026-06-01", endDate: "2026-07-01" });
    expect(past.nextOccurrence).toBeNull();
    const ended = await addRule(owner, h.id, food.id, { frequency: "DAILY", startDate: "2026-10-01" });
    await as(owner).patch(`/households/${h.id}/rules/${ended.id}`).send({ endDate: "2026-10-14" });
    for (const month of ["2026-10", "2026-11", "2027-06"])
      expect((await calendar(owner, h.id, month)).body.projected).toStrictEqual([]);
  });

  it("time zone: 'today' follows the household, not the server's UTC date", async () => {
    setNow("2026-10-14T20:00:00Z"); // Tokyo (UTC+9): 2026-10-15 05:00
    const { owner, h, food } = await setup("Asia/Tokyo");
    await addRule(owner, h.id, food.id, { frequency: "DAILY", startDate: "2026-10-14" });
    const res = await calendar(owner, h.id, "2026-10");
    expect(res.body.expenses.map((e: any) => e.date)).toStrictEqual(["2026-10-14", "2026-10-15"]);
    expect(projectedDates(res.body)[0]).toBe("2026-10-16");
    expect(projectedDates(res.body)).not.toContain("2026-10-15");
  });

  it("projections never write: expense rows and rules are unchanged by calendar reads", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    await addRule(owner, h.id, food.id, { frequency: "DAILY", startDate: "2026-10-01" });
    await addRule(owner, h.id, food.id, { startDate: "2026-01-31" });
    await calendar(owner, h.id, "2026-10"); // the catch-up has nothing left to do after this
    const before = await prisma.expense.count();
    const rulesBefore = await prisma.recurringRule.findMany({ where: { householdId: h.id }, orderBy: { id: "asc" } });
    for (const month of ["2026-10", "2026-11", "2027-02", "2100-12"])
      expect((await calendar(owner, h.id, month)).body.projected.length).toBeGreaterThan(0);
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
      const res = await as(owner).get(`/households/${h.id}/calendar${q}`);
      expect(res.status, q).toBe(400);
      expect(res.body).toStrictEqual(INVALID_MONTH);
    }
    expect((await calendar(owner, h.id, "2000-01")).status).toBe(200);
    expect((await calendar(owner, h.id, "2100-12")).status).toBe(200);
  });

  it("authorization: 401 without credentials, 404 for a non-member and for a user who left, 400 for an invalid id", async () => {
    const { member, h, otherOwner } = await setup();
    expect((await anon().get(`/households/${h.id}/calendar?month=2026-10`)).status).toBe(401);
    expect((await calendar(otherOwner, h.id, "2026-10")).status).toBe(404);
    expect((await calendar(member, h.id, "2026-10")).status).toBe(200);
    await prisma.householdMember.update({ where: { userId_householdId: { userId: member.id, householdId: h.id } }, data: { leftAt: new Date() } });
    expect((await calendar(member, h.id, "2026-10")).status).toBe(404);
    expect((await calendar(otherOwner, 0, "2026-10")).body).toStrictEqual({ error: "Invalid id" });
  });
});
