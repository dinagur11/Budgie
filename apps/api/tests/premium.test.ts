import { describe, it, expect } from "vitest";
import { prisma, as, createUser, createHousehold } from "./helpers.js";
import { isPremiumActive, nextRenewal } from "../src/lib/premium.js";
import { expirePremium } from "../src/services/premiumService.js";

const DAY = 864e5;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const later = (days: number) => new Date(Date.now() + days * DAY);
const iso = (s: string) => new Date(s);

async function premiumUser(data: { premiumStartedAt?: Date | null; premiumEndsAt?: Date | null } = {}) {
  const user = await createUser("Dana");
  return prisma.user.update({ where: { id: user.id }, data: { isPremium: true, premiumStartedAt: ago(10), ...data } });
}

describe("nextRenewal", () => {
  it("is the next monthly anniversary after now, at the start's time of day", () => {
    const start = iso("2026-01-15T10:30:00.000Z");
    expect(nextRenewal(start, iso("2026-01-15T10:30:00.000Z"))).toEqual(iso("2026-02-15T10:30:00.000Z"));
    expect(nextRenewal(start, iso("2026-02-15T10:29:59.999Z"))).toEqual(iso("2026-02-15T10:30:00.000Z"));
    expect(nextRenewal(start, iso("2026-02-15T10:30:00.000Z"))).toEqual(iso("2026-03-15T10:30:00.000Z"));
    expect(nextRenewal(start, iso("2026-10-29T08:00:00.000Z"))).toEqual(iso("2026-11-15T10:30:00.000Z"));
    expect(nextRenewal(start, iso("2027-12-20T00:00:00.000Z"))).toEqual(iso("2028-01-15T10:30:00.000Z"));
  });

  it("clamps against the start's day in short months", () => {
    const start = iso("2026-01-31T00:00:00.000Z");
    expect(nextRenewal(start, iso("2026-02-01T00:00:00.000Z"))).toEqual(iso("2026-02-28T00:00:00.000Z"));
    expect(nextRenewal(start, iso("2026-03-01T00:00:00.000Z"))).toEqual(iso("2026-03-31T00:00:00.000Z"));
    expect(nextRenewal(start, iso("2028-02-02T00:00:00.000Z"))).toEqual(iso("2028-02-29T00:00:00.000Z"));
  });
});

describe("isPremiumActive", () => {
  const now = iso("2026-10-29T12:00:00.000Z");
  it("is true while renewing or before the end date, false otherwise", () => {
    expect(isPremiumActive({ isPremium: true, premiumEndsAt: null }, now)).toBe(true);
    expect(isPremiumActive({ isPremium: true, premiumEndsAt: iso("2026-10-29T12:00:00.001Z") }, now)).toBe(true);
    expect(isPremiumActive({ isPremium: true, premiumEndsAt: now }, now)).toBe(false);
    expect(isPremiumActive({ isPremium: false, premiumEndsAt: null }, now)).toBe(false);
  });
});

describe("GET /me premium fields", () => {
  it("a renewing subscription has premiumRenewsAt and no end date", async () => {
    const start = ago(40);
    const user = await premiumUser({ premiumStartedAt: start });
    const res = await as(user).get("/me");
    expect(res.body).toMatchObject({
      isPremium: true, premiumStartedAt: start.toISOString(), premiumEndsAt: null,
      premiumRenewsAt: nextRenewal(start).toISOString(),
    });
  });

  it("an ended subscription reads as not premium before the cleanup runs", async () => {
    const user = await premiumUser({ premiumEndsAt: ago(1) });
    const res = await as(user).get("/me");
    expect(res.body).toMatchObject({ isPremium: false, premiumStartedAt: null, premiumEndsAt: null, premiumRenewsAt: null });
  });
});

describe("POST /me/premium/cancel", () => {
  it("sets premiumEndsAt to the end of the paid month and keeps premium until then", async () => {
    const start = ago(40);
    const user = await premiumUser({ premiumStartedAt: start });
    const res = await as(user).post("/me/premium/cancel");
    expect(res.status).toBe(200);
    const endsAt = res.body.premiumEndsAt;
    expect(new Date(endsAt).getTime()).toBeGreaterThan(Date.now());
    expect(res.body).toStrictEqual({
      id: user.id, name: "Dana", email: user.email, isPremium: true,
      premiumStartedAt: start.toISOString(), premiumEndsAt: nextRenewal(start).toISOString(), premiumRenewsAt: null,
    });
    const db = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(db).toMatchObject({ isPremium: true, premiumStartedAt: start, premiumEndsAt: new Date(endsAt) });
    expect((await as(user).get("/me")).body).toStrictEqual(res.body);
  });

  it("a premium user without a start date starts now, ending a month later", async () => {
    const user = await premiumUser({ premiumStartedAt: null });
    const before = Date.now();
    const res = await as(user).post("/me/premium/cancel");
    expect(res.status).toBe(200);
    const start = new Date(res.body.premiumStartedAt);
    expect(start.getTime()).toBeGreaterThanOrEqual(before);
    expect(res.body.premiumEndsAt).toBe(nextRenewal(start, start).toISOString());
  });

  it("409 when already canceled", async () => {
    const user = await premiumUser({ premiumEndsAt: later(5) });
    const res = await as(user).post("/me/premium/cancel");
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Premium is already canceled" });
  });

  it("403 for a non-premium user and for an ended subscription", async () => {
    const plain = await createUser();
    expect((await as(plain).post("/me/premium/cancel")).body).toEqual({ error: "Premium required" });
    const ended = await premiumUser({ premiumEndsAt: ago(1) });
    const res = await as(ended).post("/me/premium/cancel");
    expect(res.status).toBe(403);
  });

  it("concurrent cancels: one 200, one 409", async () => {
    const user = await premiumUser();
    const statuses = (await Promise.all([as(user).post("/me/premium/cancel"), as(user).post("/me/premium/cancel")])).map((r) => r.status);
    expect(statuses.sort()).toStrictEqual([200, 409]);
  });
});

describe("POST /me/premium/resume", () => {
  it("clears the end date, so the subscription renews again", async () => {
    const start = ago(40);
    const user = await premiumUser({ premiumStartedAt: start });
    await as(user).post("/me/premium/cancel");
    const res = await as(user).post("/me/premium/resume");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      isPremium: true, premiumStartedAt: start.toISOString(), premiumEndsAt: null, premiumRenewsAt: nextRenewal(start).toISOString(),
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).premiumEndsAt).toBeNull();
  });

  it("409 when not canceled", async () => {
    const user = await premiumUser();
    const res = await as(user).post("/me/premium/resume");
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Premium is not canceled" });
  });

  it("403 after the end date and for a non-premium user", async () => {
    const ended = await premiumUser({ premiumEndsAt: ago(1) });
    expect((await as(ended).post("/me/premium/resume")).status).toBe(403);
    expect((await as(await createUser()).post("/me/premium/resume")).status).toBe(403);
  });
});

describe("premium-only features after the end date", () => {
  it("Ask AI returns 403 once a canceled subscription has ended", async () => {
    const user = await premiumUser({ premiumEndsAt: ago(1) });
    const h = await createHousehold("Home", user);
    const res = await as(user).post(`/households/${h.id}/ask`).send({ question: "How much did I spend?" });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Premium required" });
  });
});

describe("expirePremium", () => {
  it("resets ended subscriptions and keeps the rest; idempotent", async () => {
    const ended = await premiumUser({ premiumEndsAt: ago(1) });
    const canceled = await premiumUser({ premiumEndsAt: later(3) });
    const renewing = await premiumUser();
    const plain = await createUser();

    expect(await expirePremium()).toBe(1);
    expect(await expirePremium()).toBe(0);

    const rows = await prisma.user.findMany({
      where: { id: { in: [ended.id, canceled.id, renewing.id, plain.id] } },
      select: { id: true, isPremium: true, premiumStartedAt: true, premiumEndsAt: true },
      orderBy: { id: "asc" },
    });
    expect(rows).toStrictEqual([
      { id: ended.id, isPremium: false, premiumStartedAt: null, premiumEndsAt: null },
      { id: canceled.id, isPremium: true, premiumStartedAt: canceled.premiumStartedAt, premiumEndsAt: canceled.premiumEndsAt },
      { id: renewing.id, isPremium: true, premiumStartedAt: renewing.premiumStartedAt, premiumEndsAt: null },
      { id: plain.id, isPremium: false, premiumStartedAt: null, premiumEndsAt: null },
    ]);
  });
});
