import { describe, it, expect } from "vitest";
import { prisma, as, createUser, createHousehold, addMember } from "./helpers.js";

describe("GET /me", () => {
  it("returns id, name and email only", async () => {
    const user = await createUser("Dana");
    const res = await as(user).get("/me");
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ id: user.id, name: "Dana", email: user.email });
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
    expect(res.body).toStrictEqual({ id: user.id, name: "New Name", email: user.email });
    const db = await prisma.user.findUnique({ where: { id: user.id } });
    expect(db).toMatchObject({ name: "New Name", email: user.email, cognitoId: user.cognitoId });
  });

  it("the new name shows up in the members list", async () => {
    const user = await createUser("Old");
    const h = await createHousehold("Home", user);
    await as(user).patch("/me").send({ name: "Renamed" });
    const list = await as(user).get(`/households/${h.id}/members`);
    expect(list.body).toStrictEqual([{ userId: user.id, name: "Renamed", role: "OWNER" }]);
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
      expect(db).toMatchObject({ name: "Keep", email: user.email });
    });
  }
});
