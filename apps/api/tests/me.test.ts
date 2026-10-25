import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma, as, anon, createUser, createHousehold, addMember, expectNoSensitiveFields } from "./helpers.js";

describe("GET /me", () => {
  it("returns id, name and email only", async () => {
    const user = await createUser("Dana");
    const res = await as(user).get("/me");
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ id: user.id, name: "Dana", email: user.email, isPremium: false });
  });

  it("returns isPremium true for a premium user", async () => {
    const user = await createUser("Dana");
    await prisma.user.update({ where: { id: user.id }, data: { isPremium: true } });
    const res = await as(user).get("/me");
    expect(res.body).toStrictEqual({ id: user.id, name: "Dana", email: user.email, isPremium: true });
  });
});

describe("GET /me/households", () => {
  it("lists only active households with the caller's role, ordered by joinedAt", async () => {
    const user = await createUser();
    const other = await createUser();
    const h1 = await createHousehold("First", other);
    const h2 = await createHousehold("Second");
    const h3 = await createHousehold("Left");
    await createHousehold("Not mine", other);
    await addMember(h2.id, user.id, "OWNER", { joinedAt: new Date("2026-02-01") });
    await addMember(h1.id, user.id, "MEMBER", { joinedAt: new Date("2026-01-01") });
    await addMember(h3.id, user.id, "OWNER", { joinedAt: new Date("2025-12-01"), leftAt: new Date() });

    const res = await as(user).get("/me/households");
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual([
      { householdId: h1.id, name: "First", role: "MEMBER" },
      { householdId: h2.id, name: "Second", role: "OWNER" },
    ]);
  });

  it("returns an empty array when the user has no households", async () => {
    const user = await createUser();
    const res = await as(user).get("/me/households");
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual([]);
  });

  it("drops a household after the user leaves it", async () => {
    const owner = await createUser();
    const user = await createUser();
    const h = await createHousehold("Home", owner);
    await addMember(h.id, user.id);
    expect((await as(user).get("/me/households")).body).toHaveLength(1);
    await as(user).delete(`/households/${h.id}/members/me`);
    expect((await as(user).get("/me/households")).body).toStrictEqual([]);
  });
});

describe("PATCH /me", () => {
  it("renames the user, trims the name, and does not change the email", async () => {
    const user = await createUser("Old");
    const res = await as(user).patch("/me").send({ name: "  New Name  ", email: "hacker@evil.com" });
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ id: user.id, name: "New Name", email: user.email, isPremium: false });
    const db = await prisma.user.findUnique({ where: { id: user.id } });
    expect(db).toMatchObject({ name: "New Name", email: user.email, cognitoId: user.cognitoId });
  });

  it("the new name shows up in the members list", async () => {
    const user = await createUser("Old");
    const h = await createHousehold("Home", user);
    await as(user).patch("/me").send({ name: "Renamed" });
    const list = await as(user).get(`/households/${h.id}/members`);
    expect(list.body).toStrictEqual([{ userId: user.id, name: "Renamed", role: "OWNER", joinedAt: expect.any(String), isActive: true }]);
  });

  const bad: [string, object | undefined][] = [
    ["empty body", {}],
    ["no body", undefined],
    ["empty name", { name: "" }],
    ["whitespace name", { name: "   " }],
    ["101-char name", { name: "a".repeat(101) }],
    ["numeric name", { name: 42 }],
    ["null name", { name: null }],
    ["array name", { name: ["a"] }],
    ["email only", { email: "x@example.com" }],
  ];
  for (const [label, body] of bad) {
    it(`returns 400 for ${label} and changes nothing`, async () => {
      const user = await createUser("Keep");
      const req = as(user).patch("/me");
      const res = body === undefined ? await req : await req.send(body);
      expect(res.status).toBe(400);
      expect(res.body).toStrictEqual({ error: expect.any(String) });
      const db = await prisma.user.findUnique({ where: { id: user.id } });
      expect(db).toMatchObject({ name: "Keep", email: user.email, isPremium: false });
    });
  }
});

describe("GET /me/spending", () => {
  // fake only Date, so supertest and the database driver keep their real timers
  const setNow = (iso: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
  };
  afterEach(() => {
    vi.useRealTimers();
  });

  const spending = (user: { id: number }, query: string) => as(user).get(`/me/spending${query}`);

  async function addExpense(householdId: number, categoryId: number, paidById: number, date: string, amount: number, currency = "USD") {
    return prisma.expense.create({
      data: { householdId, categoryId, paidById, createdById: paidById, name: "Manual", amount, currency: currency as any, date: new Date(date) },
    });
  }

  it("exact shape; no households or no expenses gives an empty list", async () => {
    const user = await createUser();
    const res = await spending(user, "?month=2026-10");
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ month: "2026-10", totals: [], households: [] });

    const h = await createHousehold("Home", user);
    expect((await spending(user, "?month=2026-10")).body).toStrictEqual({
      month: "2026-10", totals: [], households: [{ householdId: h.id, name: "Home", totals: [] }],
    });
    expect(h.id).toBeGreaterThan(0);
  });

  it("sums what the caller paid across active households, per currency, alphabetically; ignores other payers, months and households", async () => {
    const user = await createUser("Me");
    const other = await createUser("Other");
    const h1 = await createHousehold("One", user);
    const h2 = await createHousehold("Two", other);
    await addMember(h2.id, user.id);
    await addMember(h1.id, other.id);
    const left = await createHousehold("Left", other);
    await addMember(left.id, user.id, "MEMBER", { leftAt: new Date() });
    const notMine = await createHousehold("Not mine", other);
    const c1 = await prisma.category.create({ data: { householdId: h1.id, name: "C1" } });
    const c2 = await prisma.category.create({ data: { householdId: h2.id, name: "C2" } });
    const cl = await prisma.category.create({ data: { householdId: left.id, name: "CL" } });
    const cn = await prisma.category.create({ data: { householdId: notMine.id, name: "CN" } });

    await addExpense(h1.id, c1.id, user.id, "2026-10-01", 1000, "USD"); // first day, counted
    await addExpense(h2.id, c2.id, user.id, "2026-10-31", 250, "USD"); // last day, other household, counted
    await addExpense(h2.id, c2.id, user.id, "2026-10-15", 4000, "EUR");
    await addExpense(h1.id, c1.id, user.id, "2026-09-30", 7, "USD"); // previous month
    await addExpense(h1.id, c1.id, user.id, "2026-11-01", 7, "USD"); // next month
    await addExpense(h1.id, c1.id, other.id, "2026-10-10", 7, "USD"); // paid by someone else
    await prisma.expense.create({ // created by the caller but paid by someone else: not counted
      data: { householdId: h1.id, categoryId: c1.id, paidById: other.id, createdById: user.id, name: "For other", amount: 7, currency: "GBP", date: new Date("2026-10-10") },
    });
    await addExpense(left.id, cl.id, user.id, "2026-10-10", 7, "CHF"); // a household the caller left
    await addExpense(notMine.id, cn.id, user.id, "2026-10-10", 7, "SEK"); // not a member (data set up directly)

    const res = await spending(user, "?month=2026-10");
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({
      month: "2026-10",
      totals: [
        { currency: "EUR", spent: 4000 },
        { currency: "USD", spent: 1250 },
      ],
      // active households only, in joinedAt order, each with what the caller paid there
      households: [
        { householdId: h1.id, name: "One", totals: [{ currency: "USD", spent: 1000 }] },
        { householdId: h2.id, name: "Two", totals: [{ currency: "EUR", spent: 4000 }, { currency: "USD", spent: 250 }] },
      ],
    });
    expectNoSensitiveFields(res.body);
    // the other member sees only what they paid (including the expense the caller created for them)
    expect((await spending(other, "?month=2026-10")).body.totals).toStrictEqual([{ currency: "GBP", spent: 7 }, { currency: "USD", spent: 7 }]);
  });

  it("generates due recurring expenses first; future occurrences are not counted", async () => {
    setNow("2026-10-14T12:00:00Z");
    const user = await createUser();
    const h = await createHousehold("Home", user);
    const c = await prisma.category.create({ data: { householdId: h.id, name: "Bills" } });
    // weekly from Oct 1: Oct 1, 8 are due (not generated yet), Oct 15, 22, 29 are in the future
    await prisma.recurringRule.create({
      data: { householdId: h.id, name: "Weekly", amount: 300, currency: "ILS", frequency: "WEEKLY", startDate: new Date("2026-10-01"),
        nextOccurrence: new Date("2026-10-01"), paidById: user.id, createdById: user.id, categoryId: c.id },
    });

    const res = await spending(user, "?month=2026-10");
    expect(res.status).toBe(200);
    expect(res.body.totals).toStrictEqual([{ currency: "ILS", spent: 600 }]);
    expect(await prisma.expense.count({ where: { householdId: h.id } })).toBe(2);
  });

  it("returns sums above 2147483647 as plain numbers", async () => {
    const user = await createUser();
    const h = await createHousehold("Home", user);
    const c = await prisma.category.create({ data: { householdId: h.id, name: "Big" } });
    await addExpense(h.id, c.id, user.id, "2026-10-01", 2147483647);
    await addExpense(h.id, c.id, user.id, "2026-10-02", 2147483647);
    const body = (await spending(user, "?month=2026-10")).body;
    expect(body.totals).toStrictEqual([{ currency: "USD", spent: 4294967294 }]);
    expect(body.households[0].totals).toStrictEqual([{ currency: "USD", spent: 4294967294 }]);
  });

  it("400 for a missing, malformed or repeated month", async () => {
    const user = await createUser();
    for (const query of ["", "?month=", "?month=2026-13", "?month=2026-1", "?month=1999-12", "?month=2026-10-01", "?month=abc", "?month=2026-10&month=2026-11"]) {
      const res = await spending(user, query);
      expect(res.status, query).toBe(400);
      expect(res.body).toStrictEqual({ error: "Invalid month" });
    }
  });

  it("401 without credentials", async () => {
    expect((await anon().get("/me/spending?month=2026-10")).status).toBe(401);
  });
});
