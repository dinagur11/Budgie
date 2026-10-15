import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma, as, createUser, createHousehold, addMember, INVALID_IDS } from "./helpers.js";

const SHAPE_KEYS = ["amount", "categoryId", "createdById", "currency", "endDate", "expenseCount", "frequency", "id", "name", "nearingLimit", "nextOccurrence", "paidById", "startDate"];
const FORBIDDEN = { error: "Only the payer, the creator or an owner can change this rule" };
const TOO_MANY = { error: "Rule would create too many expenses" };
const NOT_FOUND = { error: "Rule not found" };

// fake only Date, so supertest and the database driver keep their real timers
function setNow(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
});

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// owner (OWNER), member and third (MEMBER) in household h with categories food, fun and old (archived);
// a second household h2 with its own owner and category
async function setup(timeZone = "UTC") {
  const owner = await createUser("Owner");
  const member = await createUser("Member");
  const third = await createUser("Third");
  const h = await createHousehold("Home", owner);
  await prisma.household.update({ where: { id: h.id }, data: { timeZone } });
  await addMember(h.id, member.id);
  await addMember(h.id, third.id);
  const food = await prisma.category.create({ data: { householdId: h.id, name: "Food" } });
  const fun = await prisma.category.create({ data: { householdId: h.id, name: "Fun" } });
  const old = await prisma.category.create({ data: { householdId: h.id, name: "Old", isArchived: true } });
  const otherOwner = await createUser("Other owner");
  const h2 = await createHousehold("Elsewhere", otherOwner);
  const foreign = await prisma.category.create({ data: { householdId: h2.id, name: "Foreign" } });
  return { owner, member, third, h, food, fun, old, otherOwner, h2, foreign };
}

const base = (householdId: number) => `/households/${householdId}/rules`;

const body = (categoryId: number, paidById: number, extra: object = {}) =>
  ({ name: "Rent", amount: 100000, currency: "USD", frequency: "MONTHLY", startDate: "2026-01-31", categoryId, paidById, ...extra });

async function create(user: { id: number }, householdId: number, data: object) {
  return as(user).post(base(householdId)).send(data);
}

async function ruleDates(ruleId: number) {
  const rows = await prisma.expense.findMany({ where: { recurringRuleId: ruleId }, orderBy: { date: "asc" }, select: { date: true } });
  return rows.map((r) => r.date.toISOString().slice(0, 10));
}

function expectShape(rule: any) {
  expect(Object.keys(rule).sort()).toStrictEqual(SHAPE_KEYS);
}

describe("POST /households/:id/rules", () => {
  it("creates the rule and backfills up to today, clamped to the anchor day (Jan 31 -> Feb 28 -> Mar 31)", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, member, h, food } = await setup();
    const res = await create(member, h.id, body(food.id, owner.id));
    expect(res.status).toBe(201);
    expect(res.body).toStrictEqual({
      id: expect.any(Number), name: "Rent", amount: 100000, currency: "USD", frequency: "MONTHLY",
      startDate: "2026-01-31", endDate: null, nextOccurrence: "2026-10-31",
      paidById: owner.id, createdById: member.id, categoryId: food.id, expenseCount: 9, nearingLimit: false,
    });
    expect(await ruleDates(res.body.id)).toStrictEqual([
      "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30",
    ]);
    const expenses = await prisma.expense.findMany({ where: { recurringRuleId: res.body.id } });
    for (const e of expenses)
      expect(e).toMatchObject({ householdId: h.id, name: "Rent", amount: 100000, currency: "USD", categoryId: food.id, paidById: owner.id, createdById: member.id, description: null });
    expect(JSON.stringify(res.body)).not.toMatch(/householdId|createdAt|updatedAt/);
  });

  it("generated expenses show up in the expense list with isRecurring true", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    await create(owner, h.id, body(food.id, owner.id, { frequency: "WEEKLY", startDate: "2026-10-01" }));
    const res = await as(owner).get(`/households/${h.id}/expenses`);
    expect(res.body.items.map((e: any) => e.date)).toStrictEqual(["2026-10-08", "2026-10-01"]);
    expect(res.body.items.every((e: any) => e.isRecurring)).toBe(true);
  });

  it("leap day anchors: monthly from Jan 31 2024 hits Feb 29; yearly from Feb 29 clamps to Feb 28", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    const monthly = await create(owner, h.id, body(food.id, owner.id, { startDate: "2024-01-31", endDate: "2024-04-30" }));
    expect(await ruleDates(monthly.body.id)).toStrictEqual(["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30"]);
    expect(monthly.body).toMatchObject({ endDate: "2024-04-30", nextOccurrence: null, expenseCount: 4 });
    const yearly = await create(owner, h.id, body(food.id, owner.id, { frequency: "YEARLY", startDate: "2024-02-29" }));
    expect(await ruleDates(yearly.body.id)).toStrictEqual(["2024-02-29", "2025-02-28", "2026-02-28"]);
    expect(yearly.body.nextOccurrence).toBe("2027-02-28");
  });

  it("daily and biweekly schedules; an end date in the future keeps the rule active", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    const daily = await create(owner, h.id, body(food.id, owner.id, { frequency: "DAILY", startDate: "2026-10-12", endDate: "2026-12-31" }));
    expect(await ruleDates(daily.body.id)).toStrictEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
    expect(daily.body).toMatchObject({ endDate: "2026-12-31", nextOccurrence: "2026-10-15" });
    const biweekly = await create(owner, h.id, body(food.id, owner.id, { frequency: "BIWEEKLY", startDate: "2026-09-01" }));
    expect(await ruleDates(biweekly.body.id)).toStrictEqual(["2026-09-01", "2026-09-15", "2026-09-29", "2026-10-13"]);
  });

  it("validation: missing or wrong-typed fields, end before start: 400, nothing created", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    const ok = body(food.id, owner.id);
    const cases: [object, string][] = [
      [{ ...ok, name: "" }, "Name must be 1-100 characters"],
      [{ ...ok, amount: 0 }, "Amount must be a positive whole number"],
      [{ ...ok, amount: "100" }, "Amount must be a positive whole number"],
      [{ ...ok, currency: undefined }, "Invalid currency"],
      [{ ...ok, currency: "XXX" }, "Invalid currency"],
      [{ ...ok, frequency: undefined }, "Invalid frequency"],
      [{ ...ok, frequency: "HOURLY" }, "Invalid frequency"],
      [{ ...ok, startDate: undefined }, "Date must be in YYYY-MM-DD format"],
      [{ ...ok, endDate: "2026-02-30" }, "Date is not a valid calendar date"],
      [{ ...ok, endDate: "2026-01-30" }, "End date must be on or after start date"],
      [{ ...ok, categoryId: "abc" }, "Invalid id"],
      [{ ...ok, paidById: undefined }, "Invalid id"],
    ];
    for (const [data, error] of cases) {
      const res = await create(owner, h.id, data);
      expect(res.status, JSON.stringify(data)).toBe(400);
      expect(res.body).toStrictEqual({ error });
    }
    expect(await prisma.recurringRule.count({ where: { householdId: h.id } })).toBe(0);
  });

  it("end date equal to start date: one expense, ended", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    const res = await create(owner, h.id, body(food.id, owner.id, { endDate: "2026-01-31" }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ expenseCount: 1, nextOccurrence: null });
  });

  it("a start date in the future (household time zone): 400", async () => {
    setNow("2026-10-14T23:30:00Z"); // already 2026-10-15 in Jerusalem
    const { owner, h, food } = await setup("Asia/Jerusalem");
    const future = await create(owner, h.id, body(food.id, owner.id, { startDate: "2026-10-16" }));
    expect(future.status).toBe(400);
    expect(future.body).toStrictEqual({ error: "Date can't be in the future" });
    const today = await create(owner, h.id, body(food.id, owner.id, { startDate: "2026-10-15" }));
    expect(today.status).toBe(201);
    expect(today.body.expenseCount).toBe(1);
  });

  it("invalid category (archived, another household's, missing) and invalid payer: 400; category is checked first", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, old, foreign, food, otherOwner } = await setup();
    for (const categoryId of [old.id, foreign.id, 2147483647]) {
      const res = await create(owner, h.id, body(categoryId, owner.id));
      expect(res.status).toBe(400);
      expect(res.body).toStrictEqual({ error: "Invalid category" });
    }
    const payer = await create(owner, h.id, body(food.id, otherOwner.id));
    expect(payer.body).toStrictEqual({ error: "Invalid payer id" });
    expect((await create(owner, h.id, body(old.id, otherOwner.id))).body).toStrictEqual({ error: "Invalid category" });
  });

  it("a payer who left is not accepted", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, member, h, food } = await setup();
    await prisma.householdMember.update({ where: { userId_householdId: { userId: member.id, householdId: h.id } }, data: { leftAt: new Date() } });
    expect((await create(owner, h.id, body(food.id, member.id))).body).toStrictEqual({ error: "Invalid payer id" });
  });

  it("at most 20 rules per household, ended ones included: 409", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    for (let i = 0; i < 20; i++) {
      const res = await create(owner, h.id, body(food.id, owner.id, { startDate: "2026-10-01", endDate: "2026-10-01" }));
      expect(res.status).toBe(201);
    }
    const res = await create(owner, h.id, body(food.id, owner.id));
    expect(res.status).toBe(409);
    expect(res.body).toStrictEqual({ error: "Rule limit reached" });
  });

  it("more than 600 occurrences: 400 (open-ended counts up to today, bounded up to the end date); exactly 600 is fine", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    const openEnded = await create(owner, h.id, body(food.id, owner.id, { frequency: "DAILY", startDate: addDays("2026-10-14", -600) }));
    expect(openEnded.status).toBe(400);
    expect(openEnded.body).toStrictEqual(TOO_MANY);
    const bounded = await create(owner, h.id, body(food.id, owner.id, { frequency: "DAILY", startDate: "2026-10-14", endDate: addDays("2026-10-14", 600) }));
    expect(bounded.body).toStrictEqual(TOO_MANY);
    expect(await prisma.recurringRule.count({ where: { householdId: h.id } })).toBe(0);
    const exact = await create(owner, h.id, body(food.id, owner.id, { frequency: "DAILY", startDate: "2026-10-14", endDate: addDays("2026-10-14", 599) }));
    expect(exact.status).toBe(201);
    const backfill = await create(owner, h.id, body(food.id, owner.id, { frequency: "DAILY", startDate: addDays("2026-10-14", -599) }));
    expect(backfill.status).toBe(201);
    expect(backfill.body).toMatchObject({ expenseCount: 600, nearingLimit: false, nextOccurrence: null, endDate: "2026-10-14" });
  });

  it("non-member and former member get 404; invalid household id 400", async () => {
    const { owner, h, food, otherOwner, member } = await setup();
    expect((await create(otherOwner, h.id, body(food.id, owner.id))).status).toBe(404);
    await prisma.householdMember.update({ where: { userId_householdId: { userId: member.id, householdId: h.id } }, data: { leftAt: new Date() } });
    expect((await create(member, h.id, body(food.id, owner.id))).status).toBe(404);
    expect((await create(owner, 0, body(food.id, owner.id))).status).toBe(400);
  });
});

describe("GET /households/:id/rules", () => {
  it("all rules newest first, ended included, exact shape; ?activeOnly", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, member, h, food, h2, otherOwner, foreign } = await setup();
    const a = (await create(owner, h.id, body(food.id, owner.id))).body;
    const ended = (await create(member, h.id, body(food.id, member.id, { endDate: "2026-02-15" }))).body;
    const c = (await create(owner, h.id, body(food.id, owner.id, { frequency: "WEEKLY" }))).body;
    await create(otherOwner, h2.id, body(foreign.id, otherOwner.id));

    const all = await as(member).get(base(h.id));
    expect(all.status).toBe(200);
    expect(all.body).toStrictEqual([c, ended, a]);
    for (const rule of all.body) expectShape(rule);
    expect(ended.nextOccurrence).toBeNull();

    expect((await as(member).get(`${base(h.id)}?activeOnly=true`)).body.map((r: any) => r.id)).toStrictEqual([c.id, a.id]);
    expect((await as(member).get(`${base(h.id)}?activeOnly=false`)).body).toHaveLength(3);
  });

  it("activeOnly: anything but true or false, or repeated: 400", async () => {
    const { owner, h } = await setup();
    for (const q of ["activeOnly=yes", "activeOnly=1", "activeOnly=", "activeOnly=true&activeOnly=true"]) {
      const res = await as(owner).get(`${base(h.id)}?${q}`);
      expect(res.status, q).toBe(400);
      expect(res.body).toStrictEqual({ error: "activeOnly must be true or false" });
    }
  });

  it("an empty household returns []; a non-member gets 404", async () => {
    const { owner, h, otherOwner } = await setup();
    expect((await as(owner).get(base(h.id))).body).toStrictEqual([]);
    expect((await as(otherOwner).get(base(h.id))).status).toBe(404);
  });

  it("lazy catch-up: reading later creates the due expenses, idempotently; an end date reached ends the rule", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    const rule = (await create(owner, h.id, body(food.id, owner.id, { frequency: "WEEKLY", startDate: "2026-10-14", endDate: "2026-11-04" }))).body;
    expect(rule.expenseCount).toBe(1);

    setNow("2026-10-28T12:00:00Z");
    for (let i = 0; i < 2; i++) {
      const [listed] = (await as(owner).get(base(h.id))).body;
      expect(listed).toMatchObject({ expenseCount: 3, nextOccurrence: "2026-11-04" });
    }
    expect(await ruleDates(rule.id)).toStrictEqual(["2026-10-14", "2026-10-21", "2026-10-28"]);
    expect((await as(owner).get(`${base(h.id)}?activeOnly=true`)).body).toHaveLength(1);

    setNow("2027-03-01T12:00:00Z");
    expect((await as(owner).get(`${base(h.id)}/${rule.id}`)).body).toMatchObject({ expenseCount: 4, nextOccurrence: null });
    expect((await as(owner).get(`${base(h.id)}?activeOnly=true`)).body).toStrictEqual([]);
  });

  it("the expense list runs the catch-up too", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    await create(owner, h.id, body(food.id, owner.id, { frequency: "DAILY", startDate: "2026-10-14" }));
    setNow("2026-10-16T12:00:00Z");
    expect((await as(owner).get(`/households/${h.id}/expenses`)).body.totalCount).toBe(3);
  });

  it("an open-ended rule that reaches 600 expenses is ended at its last expense; nearingLimit from 540", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    const rule = (await create(owner, h.id, body(food.id, owner.id, { frequency: "DAILY", startDate: addDays("2026-10-14", -539) }))).body;
    expect(rule).toMatchObject({ expenseCount: 540, nearingLimit: true, endDate: null });
    expect((await create(owner, h.id, body(food.id, owner.id, { frequency: "DAILY", startDate: addDays("2026-10-14", -538) }))).body.nearingLimit).toBe(false);

    // nobody looks for 100 days: generation stops at 600, not at today
    setNow(`${addDays("2026-10-14", 100)}T12:00:00Z`);
    const got = (await as(owner).get(`${base(h.id)}/${rule.id}`)).body;
    const last = addDays("2026-10-14", 60);
    expect(got).toMatchObject({ expenseCount: 600, nearingLimit: false, endDate: last, nextOccurrence: null });
    expect((await ruleDates(rule.id)).at(-1)).toBe(last);

    // an ended-at-the-limit rule is an ordinary ended rule: a plain edit works, extending is capped
    expect((await as(owner).patch(`${base(h.id)}/${rule.id}`).send({ name: "Coffee" })).status).toBe(200);
    expect((await as(owner).patch(`${base(h.id)}/${rule.id}`).send({ endDate: null })).body).toStrictEqual(TOO_MANY);
  });
});

describe("GET /households/:id/rules/:ruleId", () => {
  it("returns the rule shape; 404 for another household's rule or a missing id; 400 for invalid ids", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, member, h, food, h2, otherOwner, foreign } = await setup();
    const rule = (await create(owner, h.id, body(food.id, owner.id))).body;
    const res = await as(member).get(`${base(h.id)}/${rule.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual(rule);
    const other = (await create(otherOwner, h2.id, body(foreign.id, otherOwner.id))).body;
    for (const id of [other.id, 2147483647]) {
      const r = await as(owner).get(`${base(h.id)}/${id}`);
      expect(r.status).toBe(404);
      expect(r.body).toStrictEqual(NOT_FOUND);
    }
    for (const id of INVALID_IDS)
      expect((await as(owner).get(`${base(h.id)}/${id}`)).body).toStrictEqual({ error: "Invalid id" });
    expect((await as(otherOwner).get(`${base(h.id)}/${rule.id}`)).status).toBe(404);
  });
});

describe("PATCH /households/:id/rules/:ruleId", () => {
  async function withRule(extra: object = {}) {
    setNow("2026-10-14T12:00:00Z");
    const s = await setup();
    const rule = (await create(s.member, s.h.id, body(s.food.id, s.member.id, extra))).body;
    return { ...s, rule, url: `${base(s.h.id)}/${rule.id}` };
  }

  it("name, amount, currency and category apply to every expense of the rule; descriptions are kept", async () => {
    const { owner, member, rule, url, fun } = await withRule();
    const first = await prisma.expense.findFirstOrThrow({ where: { recurringRuleId: rule.id }, orderBy: { date: "asc" } });
    await as(member).patch(`/households/${first.householdId}/expenses/${first.id}`).send({ description: "paid late" });
    const res = await as(owner).patch(url).send({ name: "Big rent", amount: 120000, currency: "EUR", categoryId: fun.id });
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ ...rule, name: "Big rent", amount: 120000, currency: "EUR", categoryId: fun.id });
    const expenses = await prisma.expense.findMany({ where: { recurringRuleId: rule.id } });
    expect(expenses).toHaveLength(9);
    for (const e of expenses) expect(e).toMatchObject({ name: "Big rent", amount: 120000, currency: "EUR", categoryId: fun.id });
    expect(expenses.find((e) => e.id === first.id)!.description).toBe("paid late");
  });

  it("the payer and the creator can edit; another member gets 403; a non-member 404", async () => {
    const { owner, member, third, h, food, otherOwner } = await withRule();
    // created by member, paid by owner
    const rule = (await create(member, h.id, body(food.id, owner.id))).body;
    const url = `${base(h.id)}/${rule.id}`;
    expect((await as(owner).patch(url).send({ amount: 2 })).status).toBe(200);
    expect((await as(member).patch(url).send({ amount: 3 })).status).toBe(200);
    const res = await as(third).patch(url).send({ amount: 4 });
    expect(res.status).toBe(403);
    expect(res.body).toStrictEqual(FORBIDDEN);
    expect((await as(otherOwner).patch(url).send({ amount: 4 })).status).toBe(404);
  });

  it("changing the payer: only the creator or an owner; the new payer must be active; changes every expense", async () => {
    const { owner, member, third, h, food } = await withRule();
    // created by third, paid by member
    const rule = (await create(third, h.id, body(food.id, member.id))).body;
    const url = `${base(h.id)}/${rule.id}`;
    const byPayer = await as(member).patch(url).send({ paidById: owner.id });
    expect(byPayer.status).toBe(403);
    expect(byPayer.body).toStrictEqual({ error: "Only the creator or an owner can change the payer" });
    // the payer may send their own id unchanged
    expect((await as(member).patch(url).send({ paidById: member.id, amount: 5 })).status).toBe(200);

    // the payer leaves; the rule keeps naming them, and the creator fixes it
    await prisma.householdMember.update({ where: { userId_householdId: { userId: member.id, householdId: h.id } }, data: { leftAt: new Date() } });
    expect((await as(third).patch(url).send({ paidById: member.id })).body).toMatchObject({ paidById: member.id });
    const invalid = await as(owner).patch(url).send({ paidById: 2147483647 });
    expect(invalid.body).toStrictEqual({ error: "Invalid payer id" });
    expect((await as(third).patch(url).send({ paidById: owner.id })).body.paidById).toBe(owner.id);
    const paidBy = await prisma.expense.findMany({ where: { recurringRuleId: rule.id }, select: { paidById: true } });
    expect(paidBy.every((e) => e.paidById === owner.id)).toBe(true);
  });

  it("an archived or foreign category: 400; an unchanged archived category is not rechecked", async () => {
    const { owner, url, rule, old, foreign, food } = await withRule();
    for (const categoryId of [old.id, foreign.id])
      expect((await as(owner).patch(url).send({ categoryId })).body).toStrictEqual({ error: "Invalid category" });
    await prisma.category.update({ where: { id: food.id }, data: { isArchived: true } });
    expect(rule.categoryId).toBe(food.id);
    expect((await as(owner).patch(url).send({ categoryId: food.id, amount: 7 })).status).toBe(200);
  });

  it("changing the start date regenerates every expense (descriptions are lost)", async () => {
    const { owner, rule, url } = await withRule();
    await prisma.expense.updateMany({ where: { recurringRuleId: rule.id }, data: { description: "note" } });
    const res = await as(owner).patch(url).send({ startDate: "2026-07-15" });
    expect(res.body).toMatchObject({ startDate: "2026-07-15", expenseCount: 3, nextOccurrence: "2026-10-15" });
    expect(await ruleDates(rule.id)).toStrictEqual(["2026-07-15", "2026-08-15", "2026-09-15"]);
    expect(await prisma.expense.count({ where: { recurringRuleId: rule.id, description: { not: null } } })).toBe(0);
  });

  it("changing the frequency regenerates every expense", async () => {
    const { owner, rule, url } = await withRule({ startDate: "2026-09-30" });
    const res = await as(owner).patch(url).send({ frequency: "WEEKLY" });
    expect(res.body).toMatchObject({ frequency: "WEEKLY", expenseCount: 3, nextOccurrence: "2026-10-21" });
    expect(await ruleDates(rule.id)).toStrictEqual(["2026-09-30", "2026-10-07", "2026-10-14"]);
  });

  it("shortening the end date deletes later expenses and ends the rule; extending or clearing it continues", async () => {
    const { owner, rule, url } = await withRule();
    const shorter = await as(owner).patch(url).send({ endDate: "2026-04-15" });
    expect(shorter.body).toMatchObject({ endDate: "2026-04-15", nextOccurrence: null, expenseCount: 3 });
    expect(await ruleDates(rule.id)).toStrictEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    const longer = await as(owner).patch(url).send({ endDate: "2026-06-30" });
    expect(longer.body).toMatchObject({ endDate: "2026-06-30", nextOccurrence: null, expenseCount: 6 });
    expect((await ruleDates(rule.id)).at(-1)).toBe("2026-06-30");
    const cleared = await as(owner).patch(url).send({ endDate: null });
    expect(cleared.body).toMatchObject({ endDate: null, nextOccurrence: "2026-10-31", expenseCount: 9 });
    const future = await as(owner).patch(url).send({ endDate: "2027-01-01" });
    expect(future.body).toMatchObject({ endDate: "2027-01-01", nextOccurrence: "2026-10-31", expenseCount: 9 });
  });

  it("start date in the future, end before start, too many occurrences: 400, nothing changes", async () => {
    const { owner, rule, url } = await withRule();
    expect((await as(owner).patch(url).send({ startDate: "2026-10-15" })).body).toStrictEqual({ error: "Date can't be in the future" });
    expect((await as(owner).patch(url).send({ endDate: "2026-01-30" })).body).toStrictEqual({ error: "End date must be on or after start date" });
    expect((await as(owner).patch(url).send({ startDate: "2026-06-01", endDate: "2026-05-31" })).status).toBe(400);
    expect((await as(owner).patch(url).send({ frequency: "DAILY", startDate: "2024-01-01" })).body).toStrictEqual(TOO_MANY);
    expect((await as(owner).patch(url).send({ frequency: "DAILY", endDate: "2028-01-01" })).body).toStrictEqual(TOO_MANY);
    expect((await as(owner).get(url)).body).toStrictEqual(rule);
    expect(await prisma.expense.count({ where: { recurringRuleId: rule.id } })).toBe(9);
  });

  it("validation: empty body, unknown fields only, invalid values and ids: 400", async () => {
    const { owner, url, h } = await withRule();
    for (const data of [{}, { foo: 1 }, { householdId: 1, createdById: 1 }])
      expect((await as(owner).patch(url).send(data)).body).toStrictEqual({ error: "Nothing to update" });
    for (const data of [{ name: "" }, { amount: -1 }, { currency: null }, { frequency: "x" }, { startDate: null }, { endDate: "nope" }, { paidById: 0 }, { categoryId: "1.5" }])
      expect((await as(owner).patch(url).send(data)).status, JSON.stringify(data)).toBe(400);
    for (const id of INVALID_IDS)
      expect((await as(owner).patch(`${base(h.id)}/${id}`).send({ amount: 1 })).body).toStrictEqual({ error: "Invalid id" });
  });

  it("404 for another household's rule (not 403), before the permission check", async () => {
    const { third, h, h2, otherOwner, foreign } = await withRule();
    const other = (await create(otherOwner, h2.id, body(foreign.id, otherOwner.id))).body;
    const res = await as(third).patch(`${base(h.id)}/${other.id}`).send({ amount: 1 });
    expect(res.status).toBe(404);
    expect(res.body).toStrictEqual(NOT_FOUND);
  });
});

describe("DELETE /households/:id/rules/:ruleId", () => {
  it("by default keeps the expenses, which become normal expenses", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, member, h, food } = await setup();
    const rule = (await create(member, h.id, body(food.id, member.id))).body;
    const res = await as(member).delete(`${base(h.id)}/${rule.id}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect(await prisma.recurringRule.count({ where: { id: rule.id } })).toBe(0);
    const list = (await as(owner).get(`/households/${h.id}/expenses`)).body;
    expect(list.totalCount).toBe(9);
    expect(list.items.every((e: any) => e.isRecurring === false)).toBe(true);
    expect((await as(owner).delete(`/households/${h.id}/expenses/${list.items[0].id}`)).status).toBe(204);
  });

  it("?deleteExpenses=true deletes the rule's expenses and nothing else; false keeps them", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    const a = (await create(owner, h.id, body(food.id, owner.id))).body;
    const b = (await create(owner, h.id, body(food.id, owner.id, { frequency: "WEEKLY", startDate: "2026-10-01" }))).body;
    expect((await as(owner).delete(`${base(h.id)}/${a.id}?deleteExpenses=true`)).status).toBe(204);
    expect(await prisma.expense.count({ where: { householdId: h.id } })).toBe(2);
    expect((await as(owner).delete(`${base(h.id)}/${b.id}?deleteExpenses=false`)).status).toBe(204);
    expect(await prisma.expense.count({ where: { householdId: h.id, recurringRuleId: null } })).toBe(2);
  });

  it("deleteExpenses: anything but true or false, or repeated: 400, nothing deleted", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup();
    const rule = (await create(owner, h.id, body(food.id, owner.id))).body;
    for (const q of ["deleteExpenses=1", "deleteExpenses=TRUE", "deleteExpenses=", "deleteExpenses=true&deleteExpenses=true"]) {
      const res = await as(owner).delete(`${base(h.id)}/${rule.id}?${q}`);
      expect(res.status, q).toBe(400);
      expect(res.body).toStrictEqual({ error: "deleteExpenses must be true or false" });
    }
    expect(await prisma.expense.count({ where: { recurringRuleId: rule.id } })).toBe(9);
  });

  it("403 for a member who isn't payer, creator or owner; 404 for another household's or a missing rule", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, third, h, food, h2, otherOwner, foreign } = await setup();
    const rule = (await create(owner, h.id, body(food.id, owner.id))).body;
    const res = await as(third).delete(`${base(h.id)}/${rule.id}?deleteExpenses=true`);
    expect(res.status).toBe(403);
    expect(res.body).toStrictEqual(FORBIDDEN);
    const other = (await create(otherOwner, h2.id, body(foreign.id, otherOwner.id))).body;
    for (const id of [other.id, 2147483647])
      expect((await as(owner).delete(`${base(h.id)}/${id}`)).body).toStrictEqual(NOT_FOUND);
    expect(await prisma.expense.count({ where: { householdId: { in: [h.id, h2.id] } } })).toBe(18);
    expect((await as(owner).delete(`${base(h.id)}/abc`)).body).toStrictEqual({ error: "Invalid id" });
  });
});

describe("rules: concurrency", () => {
  it("concurrent reads run the catch-up once: no duplicates, never 500", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, member, h, food } = await setup();
    const rule = (await create(owner, h.id, body(food.id, owner.id, { frequency: "DAILY", startDate: "2026-10-14" }))).body;
    setNow("2026-12-31T12:00:00Z");
    const responses = await Promise.all([
      ...Array.from({ length: 4 }, () => as(owner).get(base(h.id))),
      ...Array.from({ length: 4 }, () => as(member).get(`/households/${h.id}/expenses`)),
    ]);
    for (const r of responses) expect(r.status).toBe(200);
    const dates = await ruleDates(rule.id);
    expect(dates).toHaveLength(79);
    expect(new Set(dates).size).toBe(79);
  });

  it("an edit or delete racing the catch-up: never 500, never duplicates or orphans", async () => {
    for (let round = 0; round < 6; round++) {
      setNow("2026-10-14T12:00:00Z");
      const { owner, h, food } = await setup();
      const rule = (await create(owner, h.id, body(food.id, owner.id, { frequency: "DAILY", startDate: "2026-10-01" }))).body;
      setNow("2026-11-30T12:00:00Z");
      const change = round % 2 === 0
        ? as(owner).patch(`${base(h.id)}/${rule.id}`).send({ endDate: "2026-11-15", amount: 5 })
        : as(owner).delete(`${base(h.id)}/${rule.id}?deleteExpenses=true`);
      const [reads, changed] = await Promise.all([Promise.all([as(owner).get(base(h.id)), as(owner).get(`/households/${h.id}/expenses`)]), change]);
      for (const r of reads) expect(r.status).toBe(200);
      expect([200, 204]).toContain(changed.status);
      if (round % 2 === 0) {
        const dates = await ruleDates(rule.id);
        expect(dates).toHaveLength(46); // Oct 1 to Nov 15
        expect(new Set(dates).size).toBe(46);
        expect(await prisma.expense.count({ where: { recurringRuleId: rule.id, amount: { not: 5 } } })).toBe(0);
      } else {
        expect(await prisma.expense.count({ where: { householdId: h.id } })).toBe(0);
      }
    }
  });
});
