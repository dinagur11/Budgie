import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma, as, anon, createUser, createHousehold, addMember, INVALID_IDS, MAX_ID } from "./helpers.js";

const SHAPE_KEYS = ["amount", "categoryId", "createdById", "currency", "date", "description", "id", "isRecurring", "name", "paidById"];
const FORBIDDEN = { error: "Only the payer, the creator or an owner can change this expense" };
const RECURRING_FIELDS = { error: "Only the description can be changed on a recurring expense" };
const FUTURE = { error: "Date can't be in the future" };

// fake only Date, so supertest and the database driver keep their real timers
function setNow(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
});

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

const base = (householdId: number) => `/households/${householdId}/expenses`;

type ExpenseData = {
  householdId: number; categoryId: number; paidById: number; createdById?: number;
  name?: string; amount?: number; date?: string; currency?: "USD" | "EUR"; description?: string; recurringRuleId?: number;
};

async function addExpense(d: ExpenseData) {
  return prisma.expense.create({
    data: {
      householdId: d.householdId, categoryId: d.categoryId, paidById: d.paidById, createdById: d.createdById ?? d.paidById,
      name: d.name ?? "Thing", amount: d.amount ?? 1000, currency: d.currency ?? "USD", date: new Date(d.date ?? "2026-03-01"),
      description: d.description, recurringRuleId: d.recurringRuleId,
    },
  });
}

async function addRecurringExpense(householdId: number, userId: number, categoryId: number) {
  const rule = await prisma.recurringRule.create({
    data: {
      name: "Rent", amount: 100000, currency: "USD", frequency: "MONTHLY", startDate: new Date("2026-01-01"),
      householdId, paidById: userId, createdById: userId, categoryId,
    },
  });
  const expense = await addExpense({ householdId, categoryId, paidById: userId, name: "Rent", amount: 100000, date: "2026-02-01", recurringRuleId: rule.id });
  return { rule, expense };
}

function expectShape(body: any) {
  expect(Object.keys(body).sort()).toStrictEqual(SHAPE_KEYS);
}

describe("POST /households/:id/expenses", () => {
  const body = (categoryId: number, paidById: number, extra: object = {}) =>
    ({ name: "Groceries run", amount: 4599, currency: "USD", date: "2026-03-05", categoryId, paidById, ...extra });

  it("creates the expense: 201 with the shared shape; createdById is the caller", async () => {
    const { owner, member, h, food } = await setup();
    const res = await as(member).post(base(h.id)).send(body(food.id, owner.id, { currency: "EUR", description: "  weekly  " }));
    expect(res.status).toBe(201);
    expect(res.body).toStrictEqual({
      id: expect.any(Number), name: "Groceries run", amount: 4599, currency: "EUR", date: "2026-03-05",
      categoryId: food.id, paidById: owner.id, createdById: member.id, description: "weekly", isRecurring: false,
    });
    const row = await prisma.expense.findUnique({ where: { id: res.body.id } });
    expect(row).toMatchObject({ householdId: h.id, createdById: member.id, recurringRuleId: null });
  });

  it("currency is required: missing, null or unknown is 400 'Invalid currency', with no fallback to defaultCurrency", async () => {
    const { owner, h, food } = await setup();
    await prisma.household.update({ where: { id: h.id }, data: { defaultCurrency: "ILS" } });
    for (const currency of [undefined, null, "", "XXX", "usd", 1]) {
      const res = await as(owner).post(base(h.id)).send(body(food.id, owner.id, { currency }));
      expect(res.status, String(currency)).toBe(400);
      expect(res.body).toStrictEqual({ error: "Invalid currency" });
    }
    expect(await prisma.expense.count({ where: { householdId: h.id } })).toBe(0);
  });

  it("an empty description is stored as none", async () => {
    const { owner, h, food } = await setup();
    const res = await as(owner).post(base(h.id)).send(body(food.id, owner.id, { description: "   " }));
    expect(res.status).toBe(201);
    expect(res.body.description).toBeNull();
  });

  const bad: [string, (c: number, p: number) => object][] = [
    ["missing name", (c, p) => { const { name, ...rest } = body(c, p); return rest; }],
    ["empty name", (c, p) => body(c, p, { name: "  " })],
    ["101-char name", (c, p) => body(c, p, { name: "a".repeat(101) })],
    ["missing amount", (c, p) => { const { amount, ...rest } = body(c, p); return rest; }],
    ["amount 0", (c, p) => body(c, p, { amount: 0 })],
    ["negative amount", (c, p) => body(c, p, { amount: -5 })],
    ["fractional amount", (c, p) => body(c, p, { amount: 12.5 })],
    ["string amount", (c, p) => body(c, p, { amount: "100" })],
    ["amount over 2147483647", (c, p) => body(c, p, { amount: 2147483648 })],
    ["unknown currency", (c, p) => body(c, p, { currency: "XYZ" })],
    ["missing date", (c, p) => { const { date, ...rest } = body(c, p); return rest; }],
    ["badly formatted date", (c, p) => body(c, p, { date: "05/03/2026" })],
    ["impossible date", (c, p) => body(c, p, { date: "2026-02-30" })],
    ["date before 2000", (c, p) => body(c, p, { date: "1999-12-31" })],
    ["missing categoryId", (c, p) => { const { categoryId, ...rest } = body(c, p); return rest; }],
    ["categoryId 'abc'", (c, p) => body(c, p, { categoryId: "abc" })],
    ["missing paidById", (c, p) => { const { paidById, ...rest } = body(c, p); return rest; }],
    ["paidById 0", (c, p) => body(c, p, { paidById: 0 })],
    ["numeric description", (c, p) => body(c, p, { description: 5 })],
    ["501-char description", (c, p) => body(c, p, { description: "a".repeat(501) })],
  ];
  for (const [label, make] of bad) {
    it(`returns 400 for ${label}, nothing created`, async () => {
      const { owner, h, food } = await setup();
      const res = await as(owner).post(base(h.id)).send(make(food.id, owner.id));
      expect(res.status).toBe(400);
      expect(await prisma.expense.count({ where: { householdId: h.id } })).toBe(0);
    });
  }

  it("an archived category or another household's category: 400 'Invalid category'", async () => {
    const { owner, h, old, foreign } = await setup();
    for (const c of [old.id, foreign.id, MAX_ID]) {
      const res = await as(owner).post(base(h.id)).send(body(c, owner.id));
      expect(res.status).toBe(400);
      expect(res.body).toStrictEqual({ error: "Invalid category" });
    }
    expect(await prisma.expense.count({ where: { householdId: h.id } })).toBe(0);
  });

  it("a payer who left or who isn't a member: 400 'Invalid payer id'", async () => {
    const { owner, member, h, food, otherOwner } = await setup();
    await prisma.householdMember.update({ where: { userId_householdId: { userId: member.id, householdId: h.id } }, data: { leftAt: new Date() } });
    for (const p of [member.id, otherOwner.id, MAX_ID]) {
      const res = await as(owner).post(base(h.id)).send(body(food.id, p));
      expect(res.status).toBe(400);
      expect(res.body).toStrictEqual({ error: "Invalid payer id" });
    }
  });

  it("a non-member gets 404, nothing created", async () => {
    const { owner, h, food, otherOwner } = await setup();
    expect((await as(otherOwner).post(base(h.id)).send(body(food.id, owner.id))).status).toBe(404);
    expect(await prisma.expense.count()).toBe(0);
  });

  it("401 without credentials", async () => {
    const { owner, h, food } = await setup();
    expect((await anon().post(base(h.id)).send(body(food.id, owner.id))).status).toBe(401);
  });
});

describe("POST /households/:id/expenses: no future dates", () => {
  const post = (u: { id: number }, householdId: number, categoryId: number, date: string) =>
    as(u).post(base(householdId)).send({ name: "Coffee", amount: 450, currency: "USD", date, categoryId, paidById: u.id });

  it("today in the household's zone is accepted", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup("UTC");
    const res = await post(owner, h.id, food.id, "2026-10-14");
    expect(res.status).toBe(201);
    expect(await prisma.expense.count({ where: { householdId: h.id, date: new Date("2026-10-14") } })).toBe(1);
  });

  it("tomorrow is rejected with 400 and nothing is created", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup("UTC");
    const res = await post(owner, h.id, food.id, "2026-10-15");
    expect(res.status).toBe(400);
    expect(res.body).toStrictEqual(FUTURE);
    expect(await prisma.expense.count({ where: { householdId: h.id } })).toBe(0);
  });

  it("a far-past date is accepted", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food } = await setup("UTC");
    expect((await post(owner, h.id, food.id, "2000-01-01")).status).toBe(201);
  });

  it("zone ahead of UTC: at 20:00 UTC it is already tomorrow in Tokyo, so that date is accepted", async () => {
    setNow("2026-10-14T20:00:00Z"); // Tokyo (UTC+9): 2026-10-15 05:00
    const { owner, h, food } = await setup("Asia/Tokyo");
    expect((await post(owner, h.id, food.id, "2026-10-15")).status).toBe(201);
    const dayAfter = await post(owner, h.id, food.id, "2026-10-16");
    expect(dayAfter.status).toBe(400);
    expect(dayAfter.body).toStrictEqual(FUTURE);
  });

  it("the same moment and date in a UTC household is still the future", async () => {
    setNow("2026-10-14T20:00:00Z");
    const { owner, h, food } = await setup("UTC");
    expect((await post(owner, h.id, food.id, "2026-10-15")).status).toBe(400);
  });

  it("zone behind UTC: at 03:00 UTC it is still yesterday in Los Angeles, so the UTC date is the future", async () => {
    setNow("2026-10-15T03:00:00Z"); // Los Angeles (UTC-7 in October): 2026-10-14 20:00
    const { owner, h, food } = await setup("America/Los_Angeles");
    expect((await post(owner, h.id, food.id, "2026-10-15")).status).toBe(400);
    expect((await post(owner, h.id, food.id, "2026-10-14")).status).toBe(201);
  });
});

describe("GET /households/:id/expenses", () => {
  it("newest first (date desc, then id desc), shared shape, no householdId or recurringRuleId", async () => {
    const { owner, h, food } = await setup();
    const a = await addExpense({ householdId: h.id, categoryId: food.id, paidById: owner.id, date: "2026-03-01" });
    const b = await addExpense({ householdId: h.id, categoryId: food.id, paidById: owner.id, date: "2026-03-05" });
    const c = await addExpense({ householdId: h.id, categoryId: food.id, paidById: owner.id, date: "2026-03-01" });
    const { expense: r } = await addRecurringExpense(h.id, owner.id, food.id);
    const res = await as(owner).get(base(h.id));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toStrictEqual(["items", "nextCursor", "totalCount"]);
    expect(res.body.totalCount).toBe(4);
    expect(res.body.items.map((e: any) => e.id)).toStrictEqual([b.id, c.id, a.id, r.id]);
    expect(res.body.nextCursor).toBeNull();
    for (const item of res.body.items) expectShape(item);
    expect(res.body.items.find((e: any) => e.id === r.id).isRecurring).toBe(true);
    expect(res.body.items.find((e: any) => e.id === a.id).isRecurring).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/householdId|recurringRuleId|email/);
  });

  it("an empty household returns { items: [], nextCursor: null, totalCount: 0 }", async () => {
    const { member, h } = await setup();
    expect((await as(member).get(base(h.id))).body).toStrictEqual({ items: [], nextCursor: null, totalCount: 0 });
  });

  it("other households' expenses never appear", async () => {
    const { owner, h, food, otherOwner, h2, foreign } = await setup();
    const mine = await addExpense({ householdId: h.id, categoryId: food.id, paidById: owner.id });
    await addExpense({ householdId: h2.id, categoryId: foreign.id, paidById: otherOwner.id });
    const res = await as(owner).get(`${base(h.id)}?categoryId=${foreign.id}`);
    expect(res.body.items).toStrictEqual([]);
    const all = await as(owner).get(base(h.id));
    expect(all.body.items.map((e: any) => e.id)).toStrictEqual([mine.id]);
  });

  it("from and to are inclusive and can be used alone or together", async () => {
    const { owner, h, food } = await setup();
    const ids: Record<string, number> = {};
    for (const d of ["2026-02-28", "2026-03-01", "2026-03-15", "2026-03-31", "2026-04-01"]) {
      ids[d] = (await addExpense({ householdId: h.id, categoryId: food.id, paidById: owner.id, date: d })).id;
    }
    const dates = async (qs: string) => (await as(owner).get(`${base(h.id)}?${qs}`)).body.items.map((e: any) => e.date);
    expect(await dates("from=2026-03-01&to=2026-03-31")).toStrictEqual(["2026-03-31", "2026-03-15", "2026-03-01"]);
    expect(await dates("from=2026-03-31")).toStrictEqual(["2026-04-01", "2026-03-31"]);
    expect(await dates("to=2026-03-01")).toStrictEqual(["2026-03-01", "2026-02-28"]);
    expect(await dates("from=2026-03-15&to=2026-03-15")).toStrictEqual(["2026-03-15"]);
  });

  it("filters by categoryId and paidById, alone and combined", async () => {
    const { owner, member, h, food, fun } = await setup();
    const e1 = await addExpense({ householdId: h.id, categoryId: food.id, paidById: owner.id });
    const e2 = await addExpense({ householdId: h.id, categoryId: fun.id, paidById: owner.id });
    const e3 = await addExpense({ householdId: h.id, categoryId: food.id, paidById: member.id });
    const ids = async (qs: string) => (await as(owner).get(`${base(h.id)}?${qs}`)).body.items.map((e: any) => e.id).sort();
    expect(await ids(`categoryId=${food.id}`)).toStrictEqual([e1.id, e3.id].sort());
    expect(await ids(`paidById=${owner.id}`)).toStrictEqual([e1.id, e2.id].sort());
    expect(await ids(`categoryId=${food.id}&paidById=${member.id}`)).toStrictEqual([e3.id]);
    expect(await ids(`categoryId=${fun.id}&paidById=${member.id}`)).toStrictEqual([]);
  });

  it("filtering by a payer who has left works", async () => {
    const { owner, member, h, food } = await setup();
    const e = await addExpense({ householdId: h.id, categoryId: food.id, paidById: member.id });
    expect((await as(member).delete(`/households/${h.id}/members/me`)).status).toBe(204);
    const res = await as(owner).get(`${base(h.id)}?paidById=${member.id}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((x: any) => x.id)).toStrictEqual([e.id]);
  });

  it("paginates across pages with same-date expenses: no gaps, no duplicates, nextCursor null on the last page", async () => {
    const { owner, h, food } = await setup();
    for (const d of ["2026-03-03", "2026-03-02", "2026-03-02", "2026-03-02", "2026-03-02", "2026-03-02", "2026-03-01"]) {
      await addExpense({ householdId: h.id, categoryId: food.id, paidById: owner.id, date: d });
    }
    const expected = (await as(owner).get(base(h.id))).body.items.map((e: any) => e.id);
    expect(expected).toHaveLength(7);

    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const qs: string = `limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await as(owner).get(`${base(h.id)}?${qs}`);
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      seen.push(...res.body.items.map((e: any) => e.id));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor !== null && pages < 10);
    expect(pages).toBe(4);
    expect(seen).toStrictEqual(expected);
  });

  it("an exactly full last page has nextCursor null", async () => {
    const { owner, h, food } = await setup();
    for (let i = 0; i < 4; i++) await addExpense({ householdId: h.id, categoryId: food.id, paidById: owner.id });
    const first = await as(owner).get(`${base(h.id)}?limit=2`);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await as(owner).get(`${base(h.id)}?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`);
    expect(second.body.items).toHaveLength(2);
    expect(second.body.nextCursor).toBeNull();
  });

  it("limit defaults to 50 and accepts 100", async () => {
    const { owner, h, food } = await setup();
    await prisma.expense.createMany({
      data: Array.from({ length: 101 }, () => ({
        householdId: h.id, categoryId: food.id, paidById: owner.id, createdById: owner.id, name: "Bulk", amount: 1, currency: "USD" as const, date: new Date("2026-03-01"),
      })),
    });
    const def = await as(owner).get(base(h.id));
    expect(def.body.items).toHaveLength(50);
    expect(def.body.nextCursor).toEqual(expect.any(String));
    const max = await as(owner).get(`${base(h.id)}?limit=100`);
    expect(max.body.items).toHaveLength(100);
    expect(max.body.nextCursor).toEqual(expect.any(String));
  });

  it("filters still apply on later pages", async () => {
    const { owner, member, h, food } = await setup();
    for (let i = 0; i < 3; i++) {
      await addExpense({ householdId: h.id, categoryId: food.id, paidById: owner.id });
      await addExpense({ householdId: h.id, categoryId: food.id, paidById: member.id });
    }
    const first = await as(owner).get(`${base(h.id)}?paidById=${member.id}&limit=2`);
    const second = await as(owner).get(`${base(h.id)}?paidById=${member.id}&limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`);
    const payers = [...first.body.items, ...second.body.items].map((e: any) => e.paidById);
    expect(payers).toStrictEqual([member.id, member.id, member.id]);
    expect(second.body.nextCursor).toBeNull();
  });

  const b64 = (s: string) => Buffer.from(s).toString("base64url");
  const badQueries = [
    "from=2026-3-1", "from=2026-02-30", "to=yesterday", "from=", "from=2026-03-02&to=2026-03-01",
    "categoryId=abc", "categoryId=0", "paidById=-1", "paidById=1.5",
    "limit=0", "limit=101", "limit=1.5", "limit=abc", "limit=", "limit=-1", "limit=05",
    "cursor=", "cursor=garbage!", `cursor=${b64("2026-03-01")}`, `cursor=${b64("2026-02-30:5")}`, `cursor=${b64("2026-03-01:0")}`,
    `cursor=${b64("2026-03-01:abc")}`, `cursor=${b64("x2026-03-01:5")}`,
    "from=2026-03-01&from=2026-03-02", "limit=2&limit=3", "categoryId=1&categoryId=2", "paidById=1&paidById=1",
    "to=2026-03-01&to=2026-03-01", `cursor=${b64("2026-03-01:5")}&cursor=${b64("2026-03-01:5")}`,
  ];
  for (const qs of badQueries) {
    it(`returns 400 for ?${qs}`, async () => {
      const { owner, h } = await setup();
      const res = await as(owner).get(`${base(h.id)}?${qs}`);
      expect(res.status).toBe(400);
      expect(res.body).toStrictEqual({ error: expect.any(String) });
    });
  }

  it("a cursor without the filter fingerprint (the old format) is 400 'Invalid cursor'", async () => {
    const { owner, h } = await setup();
    const res = await as(owner).get(`${base(h.id)}?cursor=${b64("2026-03-01:5")}`);
    expect(res.body).toStrictEqual({ error: "Invalid cursor" });
  });

  it("a non-member and a former member get 404", async () => {
    const { member, h, otherOwner } = await setup();
    await prisma.householdMember.update({ where: { userId_householdId: { userId: member.id, householdId: h.id } }, data: { leftAt: new Date() } });
    expect((await as(otherOwner).get(base(h.id))).status).toBe(404);
    expect((await as(member).get(base(h.id))).status).toBe(404);
  });

  it("401 without credentials", async () => {
    const { h } = await setup();
    expect((await anon().get(base(h.id))).status).toBe(401);
  });
});

describe("GET /households/:id/expenses/:expenseId", () => {
  it("returns the household's expense in the shared shape", async () => {
    const { owner, member, h, food } = await setup();
    const e = await addExpense({ householdId: h.id, categoryId: food.id, paidById: owner.id, createdById: member.id, name: "Bread", amount: 350, date: "2026-03-07", description: "rye" });
    const res = await as(member).get(`${base(h.id)}/${e.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({
      id: e.id, name: "Bread", amount: 350, currency: "USD", date: "2026-03-07", categoryId: food.id,
      paidById: owner.id, createdById: member.id, description: "rye", isRecurring: false,
    });
  });

  it("another household's expense or a missing id: 404 'Expense not found', same body", async () => {
    const { owner, h, otherOwner, h2, foreign } = await setup();
    const theirs = await addExpense({ householdId: h2.id, categoryId: foreign.id, paidById: otherOwner.id });
    const foreignRes = await as(owner).get(`${base(h.id)}/${theirs.id}`);
    const missing = await as(owner).get(`${base(h.id)}/${MAX_ID}`);
    expect(foreignRes.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreignRes.body).toStrictEqual({ error: "Expense not found" });
    expect(missing.body).toStrictEqual(foreignRes.body);
  });

  for (const id of INVALID_IDS) {
    it(`invalid expense id ${JSON.stringify(id)} returns 400`, async () => {
      const { owner, h } = await setup();
      const res = await as(owner).get(`${base(h.id)}/${encodeURIComponent(id)}`);
      expect(res.status).toBe(400);
      expect(res.body).toStrictEqual({ error: "Invalid id" });
    });
  }

  it("a non-member gets 404", async () => {
    const { owner, h, food, otherOwner } = await setup();
    const e = await addExpense({ householdId: h.id, categoryId: food.id, paidById: owner.id });
    expect((await as(otherOwner).get(`${base(h.id)}/${e.id}`)).status).toBe(404);
  });
});

describe("expenses: who may update or delete", () => {
  // expense created by `member`, paid by `third`; `owner` is an OWNER; `extra` is another MEMBER
  async function permSetup() {
    const s = await setup();
    const extra = await createUser("Extra");
    await addMember(s.h.id, extra.id);
    const e = await addExpense({ householdId: s.h.id, categoryId: s.food.id, paidById: s.third.id, createdById: s.member.id });
    return { ...s, extra, e };
  }

  it("the payer, the creator and an owner may update", async () => {
    const { owner, member, third, h, e } = await permSetup();
    for (const [u, amount] of [[third, 101], [member, 102], [owner, 103]] as const) {
      const res = await as(u).patch(`${base(h.id)}/${e.id}`).send({ amount });
      expect(res.status).toBe(200);
      expect(res.body.amount).toBe(amount);
    }
  });

  for (const who of ["payer", "creator", "owner"] as const) {
    it(`the ${who} may delete: 204, empty body`, async () => {
      const s = await permSetup();
      const u = { payer: s.third, creator: s.member, owner: s.owner }[who];
      const res = await as(u).delete(`${base(s.h.id)}/${s.e.id}`);
      expect(res.status).toBe(204);
      expect(res.text).toBe("");
      expect(await prisma.expense.count({ where: { id: s.e.id } })).toBe(0);
    });
  }

  it("another member gets 403 on update and delete, nothing changes", async () => {
    const { extra, h, e } = await permSetup();
    const patch = await as(extra).patch(`${base(h.id)}/${e.id}`).send({ amount: 1 });
    expect(patch.status).toBe(403);
    expect(patch.body).toStrictEqual(FORBIDDEN);
    const del = await as(extra).delete(`${base(h.id)}/${e.id}`);
    expect(del.status).toBe(403);
    expect(del.body).toStrictEqual(FORBIDDEN);
    expect(await prisma.expense.findUnique({ where: { id: e.id } })).toMatchObject({ amount: 1000 });
  });

  it("after a payer change, the old payer loses the right and the new one gains it", async () => {
    const { owner, third, extra, h, e } = await permSetup();
    expect((await as(owner).patch(`${base(h.id)}/${e.id}`).send({ paidById: extra.id })).status).toBe(200);
    expect((await as(third).patch(`${base(h.id)}/${e.id}`).send({ amount: 5 })).status).toBe(403);
    expect((await as(extra).patch(`${base(h.id)}/${e.id}`).send({ amount: 6 })).status).toBe(200);
  });

  it("a non-member and a user who left get 404 on update and delete", async () => {
    const { member, h, e, otherOwner } = await permSetup();
    expect((await as(member).delete(`/households/${h.id}/members/me`)).status).toBe(204);
    for (const u of [otherOwner, member]) {
      expect((await as(u).patch(`${base(h.id)}/${e.id}`).send({ amount: 1 })).status).toBe(404);
      expect((await as(u).delete(`${base(h.id)}/${e.id}`)).status).toBe(404);
    }
    expect(await prisma.expense.findUnique({ where: { id: e.id } })).toMatchObject({ amount: 1000 });
  });

  it("another household's expense or a missing id: 404 on update and delete, even for an owner", async () => {
    const { owner, h, otherOwner, h2, foreign } = await permSetup();
    const theirs = await addExpense({ householdId: h2.id, categoryId: foreign.id, paidById: otherOwner.id });
    for (const id of [theirs.id, MAX_ID]) {
      const patch = await as(owner).patch(`${base(h.id)}/${id}`).send({ amount: 1 });
      expect(patch.status).toBe(404);
      expect(patch.body).toStrictEqual({ error: "Expense not found" });
      expect((await as(owner).delete(`${base(h.id)}/${id}`)).status).toBe(404);
    }
    expect(await prisma.expense.findUnique({ where: { id: theirs.id } })).toMatchObject({ amount: 1000 });
  });

  for (const id of INVALID_IDS) {
    it(`invalid expense id ${JSON.stringify(id)} returns 400 on update and delete`, async () => {
      const { owner, h } = await setup();
      expect((await as(owner).patch(`${base(h.id)}/${encodeURIComponent(id)}`).send({ amount: 1 })).body).toStrictEqual({ error: "Invalid id" });
      expect((await as(owner).delete(`${base(h.id)}/${encodeURIComponent(id)}`)).body).toStrictEqual({ error: "Invalid id" });
    });
  }

  it("deleting twice: the second returns 404", async () => {
    const { owner, h, e } = await permSetup();
    expect((await as(owner).delete(`${base(h.id)}/${e.id}`)).status).toBe(204);
    expect((await as(owner).delete(`${base(h.id)}/${e.id}`)).status).toBe(404);
  });

  it("401 without credentials on update and delete", async () => {
    const { h, e } = await permSetup();
    expect((await anon().patch(`${base(h.id)}/${e.id}`).send({ amount: 1 })).status).toBe(401);
    expect((await anon().delete(`${base(h.id)}/${e.id}`)).status).toBe(401);
  });
});

describe("PATCH /households/:id/expenses/:expenseId", () => {
  async function patchSetup() {
    const s = await setup();
    const e = await addExpense({ householdId: s.h.id, categoryId: s.food.id, paidById: s.owner.id, description: "note" });
    const patch = (body: object) => as(s.owner).patch(`${base(s.h.id)}/${e.id}`).send(body);
    return { ...s, e, patch };
  }

  it("updates each field; the response is the shared shape", async () => {
    const { member, fun, e, patch } = await patchSetup();
    const cases: [object, object][] = [
      [{ name: "  Dinner  " }, { name: "Dinner" }],
      [{ amount: 2500 }, { amount: 2500 }],
      [{ currency: "EUR" }, { currency: "EUR" }],
      [{ date: "2026-01-31" }, { date: "2026-01-31" }],
      [{ categoryId: fun.id }, { categoryId: fun.id }],
      [{ paidById: member.id }, { paidById: member.id }],
      [{ description: "  new note " }, { description: "new note" }],
    ];
    for (const [body, expected] of cases) {
      const res = await patch(body);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: e.id, ...expected });
      expectShape(res.body);
    }
    const row = await prisma.expense.findUnique({ where: { id: e.id } });
    expect(row).toMatchObject({ name: "Dinner", amount: 2500, currency: "EUR", categoryId: fun.id, paidById: member.id, description: "new note" });
    expect(row!.date.toISOString().slice(0, 10)).toBe("2026-01-31");
  });

  it("several fields at once", async () => {
    const { patch } = await patchSetup();
    const res = await patch({ name: "Both", amount: 7 });
    expect(res.body).toMatchObject({ name: "Both", amount: 7 });
  });

  it("description: null or an empty string clears it", async () => {
    const { e, patch } = await patchSetup();
    for (const description of [null, "", "   "]) {
      await prisma.expense.update({ where: { id: e.id }, data: { description: "note" } });
      const res = await patch({ description });
      expect(res.status).toBe(200);
      expect(res.body.description).toBeNull();
      expect((await prisma.expense.findUnique({ where: { id: e.id } }))!.description).toBeNull();
    }
  });

  it("payer: changed to an active member works; someone who left or a non-member is 400 'Invalid payer id'", async () => {
    const { member, third, h, otherOwner, e, patch } = await patchSetup();
    expect((await patch({ paidById: third.id })).status).toBe(200);
    await prisma.householdMember.update({ where: { userId_householdId: { userId: member.id, householdId: h.id } }, data: { leftAt: new Date() } });
    for (const p of [member.id, otherOwner.id, MAX_ID]) {
      const res = await patch({ paidById: p });
      expect(res.status).toBe(400);
      expect(res.body).toStrictEqual({ error: "Invalid payer id" });
    }
    expect((await prisma.expense.findUnique({ where: { id: e.id } }))!.paidById).toBe(third.id);
  });

  it("an expense whose payer has left can still be edited, and resending that payer is not rechecked", async () => {
    const { owner, member, h, food } = await setup();
    const e = await addExpense({ householdId: h.id, categoryId: food.id, paidById: member.id, createdById: owner.id });
    await prisma.householdMember.update({ where: { userId_householdId: { userId: member.id, householdId: h.id } }, data: { leftAt: new Date() } });
    expect((await as(owner).patch(`${base(h.id)}/${e.id}`).send({ amount: 9 })).status).toBe(200);
    expect((await as(owner).patch(`${base(h.id)}/${e.id}`).send({ paidById: member.id, amount: 10 })).status).toBe(200);
  });

  it("category: a valid one works; an archived one, another household's or a missing one is 400 'Invalid category'", async () => {
    const { fun, old, foreign, e, patch } = await patchSetup();
    expect((await patch({ categoryId: fun.id })).status).toBe(200);
    for (const c of [old.id, foreign.id, MAX_ID]) {
      const res = await patch({ categoryId: c });
      expect(res.status).toBe(400);
      expect(res.body).toStrictEqual({ error: "Invalid category" });
    }
    expect((await prisma.expense.findUnique({ where: { id: e.id } }))!.categoryId).toBe(fun.id);
  });

  it("an expense keeps a category archived after the fact; resending that category is not rechecked", async () => {
    const { food, e, patch } = await patchSetup();
    await prisma.category.update({ where: { id: food.id }, data: { isArchived: true } });
    const res = await patch({ categoryId: food.id, amount: 4242 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ categoryId: food.id, amount: 4242 });
    expect((await patch({ name: "Still food" })).status).toBe(200);
  });

  it("a future date (in the household's zone) is 400; today is fine", async () => {
    setNow("2026-10-14T20:00:00Z");
    const { e, patch } = await patchSetup();
    const res = await patch({ date: "2026-10-15" });
    expect(res.status).toBe(400);
    expect(res.body).toStrictEqual(FUTURE);
    expect((await patch({ date: "2026-10-14" })).status).toBe(200);
    expect((await prisma.expense.findUnique({ where: { id: e.id } }))!.date.toISOString().slice(0, 10)).toBe("2026-10-14");
  });

  it("an empty body or only unknown fields: 400 'Nothing to update'", async () => {
    const { owner, h, e, patch } = await patchSetup();
    for (const body of [{}, { foo: 1 }, { householdId: 999, recurringRuleId: 1, createdById: 1 }]) {
      const res = await patch(body);
      expect(res.status).toBe(400);
      expect(res.body).toStrictEqual({ error: "Nothing to update" });
    }
    expect((await as(owner).patch(`${base(h.id)}/${e.id}`)).status).toBe(400);
    expect(await prisma.expense.findUnique({ where: { id: e.id } })).toMatchObject({ householdId: h.id, recurringRuleId: null });
  });

  const bad: [string, object][] = [
    ["empty name", { name: "" }], ["null name", { name: null }], ["amount 0", { amount: 0 }], ["string amount", { amount: "5" }],
    ["unknown currency", { currency: "XYZ" }], ["impossible date", { date: "2026-02-30" }], ["categoryId 'abc'", { categoryId: "abc" }],
    ["paidById 0", { paidById: 0 }], ["numeric description", { description: 5 }], ["501-char description", { description: "a".repeat(501) }],
  ];
  for (const [label, body] of bad) {
    it(`returns 400 for ${label}, nothing changes`, async () => {
      const { e, patch } = await patchSetup();
      expect((await patch(body)).status).toBe(400);
      expect(await prisma.expense.findUnique({ where: { id: e.id } })).toMatchObject({ name: "Thing", amount: 1000, description: "note" });
    });
  }
});

describe("recurring expenses", () => {
  it("can't be deleted: 409, nothing deleted", async () => {
    const { owner, h, food } = await setup();
    const { expense } = await addRecurringExpense(h.id, owner.id, food.id);
    const res = await as(owner).delete(`${base(h.id)}/${expense.id}`);
    expect(res.status).toBe(409);
    expect(res.body).toStrictEqual({ error: "Recurring expenses can't be deleted; end the rule instead" });
    expect(await prisma.expense.count({ where: { id: expense.id } })).toBe(1);
  });

  it("the description can be changed and cleared", async () => {
    const { owner, h, food } = await setup();
    const { expense } = await addRecurringExpense(h.id, owner.id, food.id);
    const res = await as(owner).patch(`${base(h.id)}/${expense.id}`).send({ description: "discounted" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ amount: 100000, paidById: owner.id, description: "discounted", isRecurring: true });
    expect((await as(owner).patch(`${base(h.id)}/${expense.id}`).send({ description: null })).body.description).toBeNull();
  });

  for (const [field, value] of [["name", "Other rent"], ["amount", 99000], ["currency", "EUR"], ["date", "2026-02-02"], ["categoryId", "FUN"], ["paidById", "MEMBER"]] as const) {
    it(`changing ${field} is 409, alone or with allowed fields, nothing changes`, async () => {
      const { owner, member, h, food, fun } = await setup();
      const { expense } = await addRecurringExpense(h.id, owner.id, food.id);
      const v = value === "FUN" ? fun.id : value === "MEMBER" ? member.id : value;
      for (const body of [{ [field]: v }, { description: "x", [field]: v }]) {
        const res = await as(owner).patch(`${base(h.id)}/${expense.id}`).send(body);
        expect(res.status).toBe(409);
        expect(res.body).toStrictEqual(RECURRING_FIELDS);
      }
      expect(await prisma.expense.findUnique({ where: { id: expense.id } })).toMatchObject({ name: "Rent", amount: 100000, currency: "USD", categoryId: food.id, paidById: owner.id, description: null });
    });
  }

  it("the 409 comes before the category and date checks (archived category, future date)", async () => {
    setNow("2026-10-14T12:00:00Z");
    const { owner, h, food, old } = await setup();
    const { expense } = await addRecurringExpense(h.id, owner.id, food.id);
    expect((await as(owner).patch(`${base(h.id)}/${expense.id}`).send({ categoryId: old.id })).status).toBe(409);
    expect((await as(owner).patch(`${base(h.id)}/${expense.id}`).send({ date: "2027-01-01" })).status).toBe(409);
  });

  it("a member who isn't payer, creator or owner gets 403, not 409", async () => {
    const { owner, member, h, food } = await setup();
    const { expense } = await addRecurringExpense(h.id, owner.id, food.id);
    expect((await as(member).delete(`${base(h.id)}/${expense.id}`)).status).toBe(403);
    expect((await as(member).patch(`${base(h.id)}/${expense.id}`).send({ name: "x" })).status).toBe(403);
  });
});

describe("expenses: concurrency", () => {
  it("a category deleted while an expense is updated to use it: never 500, never a dangling category", async () => {
    const outcomes = { patched: 0, deleted: 0 };
    for (let round = 0; round < 15; round++) {
      const { owner, h, food } = await setup();
      const target = await prisma.category.create({ data: { householdId: h.id, name: `Target ${round}` } });
      const e = await addExpense({ householdId: h.id, categoryId: food.id, paidById: owner.id });
      // alternate which side starts late (0-6 ms), so both orders happen
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const delay = Math.floor(round / 2) % 7;
      const [patch, del] = await Promise.all([
        wait(round % 2 ? delay : 0).then(() => as(owner).patch(`${base(h.id)}/${e.id}`).send({ categoryId: target.id })),
        wait(round % 2 ? 0 : delay).then(() => as(owner).delete(`/households/${h.id}/categories/${target.id}`)),
      ]);
      expect([200, 400]).toContain(patch.status);
      expect([204, 409]).toContain(del.status);
      const row = await prisma.expense.findUnique({ where: { id: e.id } });
      const targetExists = (await prisma.category.count({ where: { id: target.id } })) === 1;
      if (patch.status === 200) {
        outcomes.patched++;
        expect(del.status).toBe(409);
        expect(targetExists).toBe(true);
        expect(row!.categoryId).toBe(target.id);
      } else {
        outcomes.deleted++;
        expect(patch.body).toStrictEqual({ error: "Invalid category" });
        expect(del.status).toBe(204);
        expect(targetExists).toBe(false);
        expect(row!.categoryId).toBe(food.id);
      }
    }
    console.log("patch/category-delete race outcomes:", outcomes);
    expect(outcomes.patched).toBeGreaterThan(0);
    expect(outcomes.deleted).toBeGreaterThan(0);
  });

  it("an expense deleted while it is being updated: the update is 200 or 404, never 500", async () => {
    for (let round = 0; round < 10; round++) {
      const { owner, h, food } = await setup();
      const e = await addExpense({ householdId: h.id, categoryId: food.id, paidById: owner.id });
      const [patch, del] = await Promise.all([
        as(owner).patch(`${base(h.id)}/${e.id}`).send({ amount: 77 }),
        as(owner).delete(`${base(h.id)}/${e.id}`),
      ]);
      expect(del.status).toBe(204);
      expect([200, 404]).toContain(patch.status);
      expect(await prisma.expense.count({ where: { id: e.id } })).toBe(0);
    }
  });
});

describe("GET /households/:id/expenses: cursor bound to the filters", () => {
  // 3 expenses of food paid by owner, 3 of fun paid by member, spread over March
  async function listSetup() {
    const s = await setup();
    for (const [i, d] of ["2026-03-01", "2026-03-10", "2026-03-20"].entries()) {
      await addExpense({ householdId: s.h.id, categoryId: s.food.id, paidById: s.owner.id, date: d, name: `food ${i}` });
      await addExpense({ householdId: s.h.id, categoryId: s.fun.id, paidById: s.member.id, date: d, name: `fun ${i}` });
    }
    const get = (qs: string) => as(s.owner).get(`${base(s.h.id)}?${qs}`);
    return { ...s, get };
  }

  const MISMATCH = { error: "Cursor doesn't match the filters" };

  it("a cursor reused with any filter changed, added or removed is 400", async () => {
    const { food, fun, owner, member, get } = await listSetup();
    const filtered = `from=2026-03-01&to=2026-03-31&categoryId=${food.id}&paidById=${owner.id}`;
    const first = await get(`${filtered}&limit=1`);
    const cursor = encodeURIComponent(first.body.nextCursor);
    expect((await get(`${filtered}&limit=1&cursor=${cursor}`)).status).toBe(200);
    for (const changed of [
      `from=2026-03-02&to=2026-03-31&categoryId=${food.id}&paidById=${owner.id}`,
      `from=2026-03-01&to=2026-03-30&categoryId=${food.id}&paidById=${owner.id}`,
      `from=2026-03-01&to=2026-03-31&categoryId=${fun.id}&paidById=${owner.id}`,
      `from=2026-03-01&to=2026-03-31&categoryId=${food.id}&paidById=${member.id}`,
      `to=2026-03-31&categoryId=${food.id}&paidById=${owner.id}`,
      `from=2026-03-01&to=2026-03-31&categoryId=${food.id}`,
      "",
    ]) {
      const res = await get(`${changed}&limit=1&cursor=${cursor}`);
      expect(res.status).toBe(400);
      expect(res.body).toStrictEqual(MISMATCH);
    }
  });

  it("an unfiltered cursor can't be used once a filter is added", async () => {
    const { food, get } = await listSetup();
    const first = await get("limit=2");
    const res = await get(`limit=2&categoryId=${food.id}&cursor=${encodeURIComponent(first.body.nextCursor)}`);
    expect(res.body).toStrictEqual(MISMATCH);
  });

  it("the filter order in the URL and a changed limit don't matter", async () => {
    const { food, owner, get } = await listSetup();
    const first = await get(`categoryId=${food.id}&paidById=${owner.id}&limit=1`);
    const cursor = encodeURIComponent(first.body.nextCursor);
    const res = await get(`paidById=${owner.id}&limit=5&categoryId=${food.id}&cursor=${cursor}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
  });

  it("a cursor from another household's list is 400, even with the same filters", async () => {
    const { h, owner, get } = await listSetup();
    const h3 = await createHousehold("Third", owner);
    const cat3 = await prisma.category.create({ data: { householdId: h3.id, name: "C3" } });
    await addExpense({ householdId: h3.id, categoryId: cat3.id, paidById: owner.id });
    await addExpense({ householdId: h3.id, categoryId: cat3.id, paidById: owner.id });
    for (const qs of ["", `paidById=${owner.id}`, "from=2026-01-01&to=2026-12-31"]) {
      const theirs = await as(owner).get(`${base(h3.id)}?${qs}&limit=1`);
      expect(theirs.body.nextCursor).toEqual(expect.any(String));
      const cursor = encodeURIComponent(theirs.body.nextCursor);
      // the same cursor still works on its own household
      expect((await as(owner).get(`${base(h3.id)}?${qs}&limit=1&cursor=${cursor}`)).status).toBe(200);
      const res = await get(`${qs}&limit=1&cursor=${cursor}`);
      expect(res.status).toBe(400);
      expect(res.body).toStrictEqual(MISMATCH);
    }
    expect((await as(owner).get(base(h.id))).status).toBe(200);
  });

  it("a malformed cursor is 'Invalid cursor', checked before the filters", async () => {
    const { food, get } = await listSetup();
    const res = await get(`categoryId=${food.id}&cursor=garbage`);
    expect(res.body).toStrictEqual({ error: "Invalid cursor" });
  });
});

describe("GET /households/:id/expenses: totalCount", () => {
  it("is the same on every page and counts all matching expenses, not just the page", async () => {
    const { owner, h, food } = await setup();
    for (let i = 0; i < 7; i++) await addExpense({ householdId: h.id, categoryId: food.id, paidById: owner.id, date: "2026-03-02" });
    const counts: number[] = [];
    let cursor: string | null = null;
    do {
      const res: any = await as(owner).get(`${base(h.id)}?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      counts.push(res.body.totalCount);
      cursor = res.body.nextCursor;
    } while (cursor !== null);
    expect(counts).toStrictEqual([7, 7, 7]);
  });

  it("respects every filter", async () => {
    const { owner, member, h, food, fun, otherOwner, h2, foreign } = await setup();
    await addExpense({ householdId: h.id, categoryId: food.id, paidById: owner.id, date: "2026-03-01" });
    await addExpense({ householdId: h.id, categoryId: food.id, paidById: member.id, date: "2026-03-10" });
    await addExpense({ householdId: h.id, categoryId: fun.id, paidById: owner.id, date: "2026-03-20" });
    await addExpense({ householdId: h2.id, categoryId: foreign.id, paidById: otherOwner.id, date: "2026-03-10" });
    const count = async (qs: string) => (await as(owner).get(`${base(h.id)}?${qs}`)).body.totalCount;
    expect(await count("")).toBe(3);
    expect(await count(`categoryId=${food.id}`)).toBe(2);
    expect(await count(`paidById=${owner.id}`)).toBe(2);
    expect(await count("from=2026-03-10")).toBe(2);
    expect(await count("to=2026-03-10")).toBe(2);
    expect(await count(`from=2026-03-02&to=2026-03-19&paidById=${member.id}`)).toBe(1);
    expect(await count(`categoryId=${foreign.id}`)).toBe(0);
  });

  it("an expense added between pages shows in the next page's totalCount (no snapshot across requests)", async () => {
    const { owner, h, food } = await setup();
    for (let i = 0; i < 4; i++) await addExpense({ householdId: h.id, categoryId: food.id, paidById: owner.id, date: "2026-03-02" });
    const first = await as(owner).get(`${base(h.id)}?limit=2`);
    await addExpense({ householdId: h.id, categoryId: food.id, paidById: owner.id, date: "2026-03-05" });
    const second = await as(owner).get(`${base(h.id)}?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`);
    expect(first.body.totalCount).toBe(4);
    expect(second.body.totalCount).toBe(5);
  });
});

describe("expenses: shared payer and category checks", () => {
  it("POST and PATCH give the same errors for a bad payer and a bad category", async () => {
    const { owner, member, third, h, food, old, foreign, otherOwner } = await setup();
    await prisma.householdMember.update({ where: { userId_householdId: { userId: third.id, householdId: h.id } }, data: { leftAt: new Date() } });
    const e = await addExpense({ householdId: h.id, categoryId: food.id, paidById: member.id, createdById: owner.id });
    const post = (extra: object) => as(owner).post(base(h.id)).send({ name: "X", amount: 1, currency: "USD", date: "2026-03-01", categoryId: food.id, paidById: owner.id, ...extra });
    const patch = (body: object) => as(owner).patch(`${base(h.id)}/${e.id}`).send(body);

    for (const paidById of [third.id, otherOwner.id, MAX_ID]) {
      const a = await post({ paidById });
      const b = await patch({ paidById });
      expect(a.status).toBe(400);
      expect(b.status).toBe(400);
      expect(a.body).toStrictEqual({ error: "Invalid payer id" });
      expect(b.body).toStrictEqual(a.body);
    }
    for (const categoryId of [old.id, foreign.id, MAX_ID]) {
      const a = await post({ categoryId });
      const b = await patch({ categoryId });
      expect(a.status).toBe(400);
      expect(b.status).toBe(400);
      expect(a.body).toStrictEqual({ error: "Invalid category" });
      expect(b.body).toStrictEqual(a.body);
    }
    expect(await prisma.expense.count({ where: { householdId: h.id } })).toBe(1);
    expect(await prisma.expense.findUnique({ where: { id: e.id } })).toMatchObject({ paidById: member.id, categoryId: food.id });
  });

  it("with both an archived category and a departed payer, POST and PATCH both report 'Invalid category'", async () => {
    const { owner, third, h, food, old } = await setup();
    await prisma.householdMember.update({ where: { userId_householdId: { userId: third.id, householdId: h.id } }, data: { leftAt: new Date() } });
    const e = await addExpense({ householdId: h.id, categoryId: food.id, paidById: owner.id });
    const a = await as(owner).post(base(h.id)).send({ name: "X", amount: 1, currency: "USD", date: "2026-03-01", categoryId: old.id, paidById: third.id });
    const b = await as(owner).patch(`${base(h.id)}/${e.id}`).send({ categoryId: old.id, paidById: third.id });
    expect(a.body).toStrictEqual({ error: "Invalid category" });
    expect(b.body).toStrictEqual(a.body);
  });
});
