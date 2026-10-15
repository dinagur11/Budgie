import { describe, it, expect } from "vitest";
import {
  prisma, as, createUser, createHousehold, addMember, addHouseholdData, countHouseholdData,
  INVALID_IDS, MAX_ID, expectNoSensitiveFields,
} from "./helpers.js";

const valid = { name: "Our flat", defaultCurrency: "ILS", timeZone: "Asia/Jerusalem" };

describe("POST /households", () => {
  it("creates the household and an OWNER membership", async () => {
    const user = await createUser();
    const res = await as(user).post("/households").send(valid);
    expect(res.status).toBe(201);
    expect(res.body).toStrictEqual({
      id: expect.any(Number), name: "Our flat", defaultCurrency: "ILS", timeZone: "Asia/Jerusalem", role: "OWNER",
    });
    const m = await prisma.householdMember.findUnique({
      where: { userId_householdId: { userId: user.id, householdId: res.body.id } },
    });
    expect(m?.role).toBe("OWNER");
    expect(m?.leftAt).toBeNull();
  });

  it("trims the name and normalizes the time zone", async () => {
    const user = await createUser();
    const res = await as(user).post("/households").send({ ...valid, name: "  Home  ", timeZone: "asia/jerusalem" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Home");
    expect(res.body.timeZone).toBe("Asia/Jerusalem");
  });

  it("accepts a 100-character name", async () => {
    const user = await createUser();
    const res = await as(user).post("/households").send({ ...valid, name: "a".repeat(100) });
    expect(res.status).toBe(201);
  });

  const badBodies: [string, unknown][] = [
    ["empty body", {}],
    ["missing name", { defaultCurrency: "USD", timeZone: "UTC" }],
    ["missing currency", { name: "X", timeZone: "UTC" }],
    ["missing time zone", { name: "X", defaultCurrency: "USD" }],
    ["numeric name", { ...valid, name: 123 }],
    ["null name", { ...valid, name: null }],
    ["empty name", { ...valid, name: "" }],
    ["whitespace name", { ...valid, name: "   " }],
    ["101-char name", { ...valid, name: "a".repeat(101) }],
    ["unknown currency", { ...valid, defaultCurrency: "XXX" }],
    ["lowercase currency", { ...valid, defaultCurrency: "usd" }],
    ["numeric currency", { ...valid, defaultCurrency: 1 }],
    ["invalid time zone", { ...valid, timeZone: "Mars/Olympus" }],
    ["numeric time zone", { ...valid, timeZone: 5 }],
    ["empty time zone", { ...valid, timeZone: "" }],
  ];
  for (const [label, body] of badBodies) {
    it(`returns 400 for ${label}`, async () => {
      const user = await createUser();
      const res = await as(user).post("/households").send(body as object);
      expect(res.status).toBe(400);
      expect(res.body).toStrictEqual({ error: expect.any(String) });
      expect(await prisma.household.count()).toBe(0);
    });
  }

  it("returns 400 with no body at all", async () => {
    const user = await createUser();
    const res = await as(user).post("/households");
    expect(res.status).toBe(400);
  });
});

describe("GET /households/:id", () => {
  it("returns the household with the caller's role", async () => {
    const owner = await createUser();
    const member = await createUser();
    const h = await createHousehold("Home", owner);
    await addMember(h.id, member.id);

    const res = await as(owner).get(`/households/${h.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ id: h.id, name: "Home", defaultCurrency: "USD", timeZone: "UTC", role: "OWNER" });

    const res2 = await as(member).get(`/households/${h.id}`);
    expect(res2.body).toStrictEqual({ id: h.id, name: "Home", defaultCurrency: "USD", timeZone: "UTC", role: "MEMBER" });
  });

  it("returns 404 for a non-member, a former member and a missing household", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const former = await createUser();
    const h = await createHousehold("Home", owner);
    await addMember(h.id, former.id, "MEMBER", { leftAt: new Date() });

    expect((await as(outsider).get(`/households/${h.id}`)).status).toBe(404);
    expect((await as(former).get(`/households/${h.id}`)).status).toBe(404);
    expect((await as(owner).get(`/households/${h.id + 1000}`)).status).toBe(404);
  });
});

describe("PATCH /households/:id", () => {
  async function setup() {
    const owner = await createUser("Owner");
    const member = await createUser("Member");
    const h = await createHousehold("Home", owner);
    await addMember(h.id, member.id);
    return { owner, member, h };
  }

  it("updates each field individually", async () => {
    const { owner, h } = await setup();
    let res = await as(owner).patch(`/households/${h.id}`).send({ name: " New " });
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ id: h.id, name: "New", defaultCurrency: "USD", timeZone: "UTC", role: "OWNER" });

    res = await as(owner).patch(`/households/${h.id}`).send({ defaultCurrency: "EUR" });
    expect(res.body).toStrictEqual({ id: h.id, name: "New", defaultCurrency: "EUR", timeZone: "UTC", role: "OWNER" });

    res = await as(owner).patch(`/households/${h.id}`).send({ timeZone: "Europe/Berlin" });
    expect(res.body).toStrictEqual({ id: h.id, name: "New", defaultCurrency: "EUR", timeZone: "Europe/Berlin", role: "OWNER" });

    const db = await prisma.household.findUnique({ where: { id: h.id } });
    expect(db).toMatchObject({ name: "New", defaultCurrency: "EUR", timeZone: "Europe/Berlin" });
  });

  it("updates all fields at once", async () => {
    const { owner, h } = await setup();
    const res = await as(owner).patch(`/households/${h.id}`).send(valid);
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ id: h.id, ...valid, role: "OWNER" });
  });

  it("returns 400 'Nothing to update' for an empty body or only unknown fields", async () => {
    const { owner, h } = await setup();
    for (const body of [{}, { foo: 1 }, { id: 99 }]) {
      const res = await as(owner).patch(`/households/${h.id}`).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toStrictEqual({ error: "Nothing to update" });
    }
    const res = await as(owner).patch(`/households/${h.id}`);
    expect(res.status).toBe(400);
  });

  const bad: [string, object][] = [
    ["empty name", { name: "" }],
    ["null name", { name: null }],
    ["101-char name", { name: "a".repeat(101) }],
    ["numeric name", { name: 5 }],
    ["unknown currency", { defaultCurrency: "XYZ" }],
    ["null currency", { defaultCurrency: null }],
    ["invalid time zone", { timeZone: "Not/AZone" }],
    ["valid name but invalid currency", { name: "Ok", defaultCurrency: "nope" }],
  ];
  for (const [label, body] of bad) {
    it(`returns 400 for ${label} and changes nothing`, async () => {
      const { owner, h } = await setup();
      const res = await as(owner).patch(`/households/${h.id}`).send(body);
      expect(res.status).toBe(400);
      const db = await prisma.household.findUnique({ where: { id: h.id } });
      expect(db).toMatchObject({ name: "Home", defaultCurrency: "USD", timeZone: "UTC" });
    });
  }

  it("returns 403 for a MEMBER, 404 for a non-member and a former member", async () => {
    const { member, h } = await setup();
    const outsider = await createUser();
    const former = await createUser();
    await addMember(h.id, former.id, "OWNER", { leftAt: new Date() });
    expect((await as(member).patch(`/households/${h.id}`).send({ name: "X" })).status).toBe(403);
    expect((await as(outsider).patch(`/households/${h.id}`).send({ name: "X" })).status).toBe(404);
    expect((await as(former).patch(`/households/${h.id}`).send({ name: "X" })).status).toBe(404);
    expect((await prisma.household.findUnique({ where: { id: h.id } }))?.name).toBe("Home");
  });
});

describe("GET /households/:id/members", () => {
  it("lists active members only, ordered by joinedAt, without emails", async () => {
    const owner = await createUser("Olga");
    const a = await createUser("Avi");
    const b = await createUser("Bea");
    const gone = await createUser("Gone");
    const h = await prisma.household.create({ data: { name: "Home" } });
    await addMember(h.id, b.id, "MEMBER", { joinedAt: new Date("2026-03-01") });
    await addMember(h.id, owner.id, "OWNER", { joinedAt: new Date("2026-01-01") });
    await addMember(h.id, gone.id, "MEMBER", { joinedAt: new Date("2026-01-15"), leftAt: new Date() });
    await addMember(h.id, a.id, "MEMBER", { joinedAt: new Date("2026-02-01") });

    const res = await as(a).get(`/households/${h.id}/members`);
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual([
      { userId: owner.id, name: "Olga", role: "OWNER", joinedAt: expect.any(String), isActive: true },
      { userId: a.id, name: "Avi", role: "MEMBER", joinedAt: expect.any(String), isActive: true },
      { userId: b.id, name: "Bea", role: "MEMBER", joinedAt: expect.any(String), isActive: true },
    ]);
    expectNoSensitiveFields(res.body, ["joinedAt"]);
    expect(JSON.stringify(res.body)).not.toContain("@example.com");
  });

  it("does not include members of other households", async () => {
    const owner = await createUser();
    const other = await createUser();
    const h = await createHousehold("A", owner);
    await createHousehold("B", other);
    const res = await as(owner).get(`/households/${h.id}/members`);
    expect(res.body).toHaveLength(1);
  });

  it("returns 404 for a non-member and a former member", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const former = await createUser();
    const h = await createHousehold("Home", owner);
    await addMember(h.id, former.id, "MEMBER", { leftAt: new Date() });
    expect((await as(outsider).get(`/households/${h.id}/members`)).status).toBe(404);
    expect((await as(former).get(`/households/${h.id}/members`)).status).toBe(404);
  });
});

describe("DELETE /households/:id", () => {
  it("deletes the household with its expenses, rules, members, categories and invites", async () => {
    const owner = await createUser();
    const member = await createUser();
    const h = await createHousehold("Home", owner);
    await addMember(h.id, member.id);
    await addHouseholdData(h.id, owner.id);

    const otherOwner = await createUser();
    const other = await createHousehold("Other", otherOwner);
    await addHouseholdData(other.id, otherOwner.id);
    const builtIns = await prisma.category.count({ where: { householdId: null } });

    const res = await as(owner).delete(`/households/${h.id}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect(res.body).toStrictEqual({});

    expect(await countHouseholdData(h.id)).toStrictEqual({
      households: 0, members: 0, expenses: 0, rules: 0, categories: 0, invites: 0,
    });
    expect(await countHouseholdData(other.id)).toStrictEqual({
      households: 1, members: 1, expenses: 2, rules: 1, categories: 1, invites: 1,
    });
    expect(await prisma.category.count({ where: { householdId: null } })).toBe(builtIns);
    // users themselves remain
    expect(await prisma.user.count({ where: { id: { in: [owner.id, member.id] } } })).toBe(2);
    expect((await as(member).get(`/households/${h.id}`)).status).toBe(404);
  });

  it("returns 403 for a MEMBER and 404 for a non-member or former member", async () => {
    const owner = await createUser();
    const member = await createUser();
    const outsider = await createUser();
    const former = await createUser();
    const h = await createHousehold("Home", owner);
    await addMember(h.id, member.id);
    await addMember(h.id, former.id, "OWNER", { leftAt: new Date() });
    expect((await as(member).delete(`/households/${h.id}`)).status).toBe(403);
    expect((await as(outsider).delete(`/households/${h.id}`)).status).toBe(404);
    expect((await as(former).delete(`/households/${h.id}`)).status).toBe(404);
    expect(await prisma.household.count({ where: { id: h.id } })).toBe(1);
  });
});

describe("household id validation on every /households/:id route", () => {
  const routes: [string, (u: { id: number }, id: string) => Promise<{ status: number; body: unknown }>][] = [
    ["GET /:id", (u, id) => as(u).get(`/households/${id}`)],
    ["PATCH /:id", (u, id) => as(u).patch(`/households/${id}`).send({ name: "X" })],
    ["GET /:id/members", (u, id) => as(u).get(`/households/${id}/members`)],
    ["DELETE /:id/members/me", (u, id) => as(u).delete(`/households/${id}/members/me`)],
    ["DELETE /:id/members/:userId", (u, id) => as(u).delete(`/households/${id}/members/${u.id + 1}`)],
    ["DELETE /:id", (u, id) => as(u).delete(`/households/${id}`)],
  ];

  for (const [label, call] of routes) {
    for (const id of INVALID_IDS) {
      it(`${label} returns 400 "Invalid id" for ${JSON.stringify(id)}`, async () => {
        const user = await createUser();
        const res = await call(user, encodeURIComponent(id));
        expect(res.status).toBe(400);
        expect(res.body).toStrictEqual({ error: "Invalid id" });
      });
    }

    it(`${label} returns 404 for ${MAX_ID} (valid id, no such household)`, async () => {
      const user = await createUser();
      const res = await call(user, String(MAX_ID));
      expect(res.status).toBe(404);
    });
  }
});

describe("request body errors", () => {
  it("malformed JSON returns 400 with a fixed message that does not echo the input", async () => {
    const user = await createUser();
    const res = await as(user).post("/households").set("Content-Type", "application/json").send('{"name": SECRET_INPUT');
    expect(res.status).toBe(400);
    expect(res.body).toStrictEqual({ error: "Invalid request body" });
    expect(res.text).not.toContain("SECRET_INPUT");
  });

  it("an oversized body returns 413 \"Request body too large\"", async () => {
    const user = await createUser();
    const res = await as(user).post("/households").send({ ...valid, name: "a".repeat(200_000) });
    expect(res.status).toBe(413);
    expect(res.body).toStrictEqual({ error: "Request body too large" });
    expect(await prisma.household.count()).toBe(0);
  });

  it("JSON with a non-UTF charset returns 415 \"Unsupported content type\"", async () => {
    const user = await createUser();
    const res = await as(user).post("/households")
      .set("Content-Type", "application/json; charset=latin1")
      .send(JSON.stringify(valid));
    expect(res.status).toBe(415);
    expect(res.body).toStrictEqual({ error: "Unsupported content type" });
    expect(await prisma.household.count()).toBe(0);
  });

  it("an unsupported Content-Encoding returns 415", async () => {
    const user = await createUser();
    const res = await as(user).post("/households")
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "compress")
      .send(JSON.stringify(valid));
    expect(res.status).toBe(415);
    expect(res.body).toStrictEqual({ error: "Unsupported content type" });
  });

  it("a non-JSON content type is not parsed (no 415): the empty body fails validation with 400", async () => {
    const user = await createUser();
    const res = await as(user).post("/households").set("Content-Type", "text/plain").send(JSON.stringify(valid));
    expect(res.status).toBe(400);
    expect(res.body).toStrictEqual({ error: "Name must be a string" });
  });

  it("malformed JSON on PATCH /me returns 400 and changes nothing", async () => {
    const user = await createUser("Keep");
    const res = await as(user).patch("/me").set("Content-Type", "application/json").send("{oops");
    expect(res.status).toBe(400);
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.name).toBe("Keep");
  });
});
