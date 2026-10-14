import { describe, it, expect } from "vitest";
import {
  prisma, as, createUser, createHousehold, addMember, addHouseholdData, countHouseholdData, INVALID_IDS, expectNoSensitiveFields,
} from "./helpers.js";

async function membership(householdId: number, userId: number) {
  return prisma.householdMember.findUnique({ where: { userId_householdId: { userId, householdId } } });
}

describe("DELETE /households/:id/members/me (leave)", () => {
  it("a MEMBER leaves (soft leave), and is then 404", async () => {
    const owner = await createUser();
    const member = await createUser();
    const h = await createHousehold("Home", owner);
    await addMember(h.id, member.id);

    const res = await as(member).delete(`/households/${h.id}/members/me`);
    expect(res.status).toBe(204);
    expect(res.text).toBe("");

    const m = await membership(h.id, member.id);
    expect(m?.leftAt).toBeInstanceOf(Date);
    expect((await membership(h.id, owner.id))?.role).toBe("OWNER");
    expect((await as(member).get(`/households/${h.id}`)).status).toBe(404);
    const list = await as(owner).get(`/households/${h.id}/members`);
    expect(list.body.map((x: any) => x.userId)).toStrictEqual([owner.id]);
  });

  it("route order: 'me' is not parsed as a user id (a MEMBER can leave, not 403/400)", async () => {
    const owner = await createUser();
    const member = await createUser();
    const h = await createHousehold("Home", owner);
    await addMember(h.id, member.id);
    expect((await as(member).delete(`/households/${h.id}/members/me`)).status).toBe(204);
  });

  it("leaving twice returns 404", async () => {
    const owner = await createUser();
    const member = await createUser();
    const h = await createHousehold("Home", owner);
    await addMember(h.id, member.id);
    expect((await as(member).delete(`/households/${h.id}/members/me`)).status).toBe(204);
    expect((await as(member).delete(`/households/${h.id}/members/me`)).status).toBe(404);
  });

  it("sole OWNER leaves with members left: one member is promoted and stays active", async () => {
    const owner = await createUser();
    const a = await createUser();
    const b = await createUser();
    const h = await createHousehold("Home", owner);
    await addMember(h.id, a.id);
    await addMember(h.id, b.id);

    expect((await as(owner).delete(`/households/${h.id}/members/me`)).status).toBe(204);

    const rows = await prisma.householdMember.findMany({ where: { householdId: h.id } });
    const activeOwners = rows.filter((r) => r.role === "OWNER" && r.leftAt === null);
    expect(activeOwners).toHaveLength(1);
    expect([a.id, b.id]).toContain(activeOwners[0].userId);
    expect(rows.find((r) => r.userId === owner.id)?.leftAt).toBeInstanceOf(Date);
    expect(rows.filter((r) => r.leftAt === null)).toHaveLength(2);

    const promoted = activeOwners[0].userId === a.id ? a : b;
    expect((await as(promoted).get(`/households/${h.id}`)).body.role).toBe("OWNER");
  });

  it("one of two OWNERs leaves: nobody is promoted", async () => {
    const o1 = await createUser();
    const o2 = await createUser();
    const m = await createUser();
    const h = await createHousehold("Home", o1);
    await addMember(h.id, o2.id, "OWNER");
    await addMember(h.id, m.id);

    expect((await as(o1).delete(`/households/${h.id}/members/me`)).status).toBe(204);
    expect((await membership(h.id, m.id))?.role).toBe("MEMBER");
    expect((await membership(h.id, o2.id))).toMatchObject({ role: "OWNER", leftAt: null });
  });

  it("a former owner does not count as an active owner", async () => {
    const o1 = await createUser();
    const exOwner = await createUser();
    const m = await createUser();
    const h = await createHousehold("Home", o1);
    await addMember(h.id, exOwner.id, "OWNER", { leftAt: new Date() });
    await addMember(h.id, m.id);

    expect((await as(o1).delete(`/households/${h.id}/members/me`)).status).toBe(204);
    expect((await membership(h.id, m.id))?.role).toBe("OWNER");
  });

  it("last person leaves: household and all its data are deleted", async () => {
    const owner = await createUser();
    const former = await createUser();
    const h = await createHousehold("Home", owner);
    await addMember(h.id, former.id, "MEMBER", { leftAt: new Date() });
    await addHouseholdData(h.id, owner.id);

    expect((await as(owner).delete(`/households/${h.id}/members/me`)).status).toBe(204);
    expect(await countHouseholdData(h.id)).toStrictEqual({
      households: 0, members: 0, expenses: 0, rules: 0, categories: 0, invites: 0,
    });
    expect((await as(owner).get("/me/households")).body).toStrictEqual([]);
  });

  it("returns 404 for a non-member", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const h = await createHousehold("Home", owner);
    expect((await as(outsider).delete(`/households/${h.id}/members/me`)).status).toBe(404);
  });
});

describe("DELETE /households/:id/members/:userId (remove)", () => {
  async function setup() {
    const owner = await createUser("Owner");
    const member = await createUser("Member");
    const h = await createHousehold("Home", owner);
    await addMember(h.id, member.id);
    return { owner, member, h };
  }

  it("owner removes a member (soft)", async () => {
    const { owner, member, h } = await setup();
    const res = await as(owner).delete(`/households/${h.id}/members/${member.id}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect((await membership(h.id, member.id))?.leftAt).toBeInstanceOf(Date);
    expect((await as(member).get(`/households/${h.id}`)).status).toBe(404);
    const list = await as(owner).get(`/households/${h.id}/members`);
    expect(list.body.map((x: any) => x.userId)).toStrictEqual([owner.id]);
  });

  it("owner removing themselves returns 400", async () => {
    const { owner, h } = await setup();
    const res = await as(owner).delete(`/households/${h.id}/members/${owner.id}`);
    expect(res.status).toBe(400);
    expect((await membership(h.id, owner.id))?.leftAt).toBeNull();
  });

  it("removing a non-member, a missing user, or someone who left returns 404", async () => {
    const { owner, member, h } = await setup();
    const outsider = await createUser();
    expect((await as(owner).delete(`/households/${h.id}/members/${outsider.id}`)).status).toBe(404);
    expect((await as(owner).delete(`/households/${h.id}/members/999999`)).status).toBe(404);
    expect((await as(owner).delete(`/households/${h.id}/members/${member.id}`)).status).toBe(204);
    expect((await as(owner).delete(`/households/${h.id}/members/${member.id}`)).status).toBe(404);
  });

  it("a member of another household cannot be removed through this household", async () => {
    const { owner, h } = await setup();
    const otherOwner = await createUser();
    const other = await createHousehold("Other", otherOwner);
    expect((await as(owner).delete(`/households/${h.id}/members/${otherOwner.id}`)).status).toBe(404);
    expect((await membership(other.id, otherOwner.id))?.leftAt).toBeNull();
  });

  it("MEMBER gets 403, non-member and former member get 404", async () => {
    const { owner, member, h } = await setup();
    const outsider = await createUser();
    const former = await createUser();
    await addMember(h.id, former.id, "OWNER", { leftAt: new Date() });
    expect((await as(member).delete(`/households/${h.id}/members/${owner.id}`)).status).toBe(403);
    expect((await as(outsider).delete(`/households/${h.id}/members/${member.id}`)).status).toBe(404);
    expect((await as(former).delete(`/households/${h.id}/members/${member.id}`)).status).toBe(404);
    expect((await membership(h.id, owner.id))?.leftAt).toBeNull();
    expect((await membership(h.id, member.id))?.leftAt).toBeNull();
  });

  it("returns 404 for user id 2147483647 (valid id, not a member)", async () => {
    const { owner, h } = await setup();
    expect((await as(owner).delete(`/households/${h.id}/members/2147483647`)).status).toBe(404);
  });

  for (const id of INVALID_IDS) {
    it(`returns 400 for user id "${id}"`, async () => {
      const { owner, h } = await setup();
      const res = await as(owner).delete(`/households/${h.id}/members/${encodeURIComponent(id)}`);
      expect(res.status).toBe(400);
    });
  }
});

describe("concurrent leaves (household row lock)", () => {
  it("both owners leaving at once: the remaining member is promoted", async () => {
    for (let round = 0; round < 5; round++) {
      const o1 = await createUser();
      const o2 = await createUser();
      const m = await createUser();
      const h = await createHousehold("Home", o1);
      await addMember(h.id, o2.id, "OWNER");
      await addMember(h.id, m.id);
      const results = await Promise.all([
        as(o1).delete(`/households/${h.id}/members/me`),
        as(o2).delete(`/households/${h.id}/members/me`),
      ]);
      expect(results.map((r) => r.status)).toStrictEqual([204, 204]);
      expect(await membership(h.id, m.id)).toMatchObject({ role: "OWNER", leftAt: null });
    }
  });

  it("the last two members leaving at once: the household is deleted", async () => {
    for (let round = 0; round < 5; round++) {
      const o = await createUser();
      const m = await createUser();
      const h = await createHousehold("Home", o);
      await addMember(h.id, m.id);
      await addHouseholdData(h.id, o.id);
      const results = await Promise.all([
        as(o).delete(`/households/${h.id}/members/me`),
        as(m).delete(`/households/${h.id}/members/me`),
      ]);
      expect(results.map((r) => r.status)).toStrictEqual([204, 204]);
      expect(await countHouseholdData(h.id)).toStrictEqual({
        households: 0, members: 0, expenses: 0, rules: 0, categories: 0, invites: 0,
      });
    }
  });
});

describe("GET /households/:id/members?includeFormer", () => {
  const list = (u: { id: number }, hid: number, qs = "") => as(u).get(`/households/${hid}/members${qs}`);

  // owner (OWNER), stays (MEMBER), leaver (left via the API), removed (removed by the owner)
  async function household() {
    const owner = await createUser("Olga");
    const stays = await createUser("Sam");
    const leaver = await createUser("Lea");
    const removed = await createUser("Rob");
    const h = await createHousehold("Home", owner);
    await prisma.householdMember.update({ where: { userId_householdId: { userId: owner.id, householdId: h.id } }, data: { joinedAt: new Date("2026-01-01") } });
    await addMember(h.id, stays.id, "MEMBER", { joinedAt: new Date("2026-02-01") });
    await addMember(h.id, leaver.id, "MEMBER", { joinedAt: new Date("2026-03-01") });
    await addMember(h.id, removed.id, "MEMBER", { joinedAt: new Date("2026-04-01") });
    expect((await as(leaver).delete(`/households/${h.id}/members/me`)).status).toBe(204);
    expect((await as(owner).delete(`/households/${h.id}/members/${removed.id}`)).status).toBe(204);
    return { owner, stays, leaver, removed, h };
  }

  it("default and includeFormer=false: active members only, each with isActive true", async () => {
    const { owner, stays, h } = await household();
    const expected = [
      { userId: owner.id, name: "Olga", role: "OWNER", isActive: true },
      { userId: stays.id, name: "Sam", role: "MEMBER", isActive: true },
    ];
    for (const qs of ["", "?includeFormer=false"]) {
      const res = await list(stays, h.id, qs);
      expect(res.status).toBe(200);
      expect(res.body).toStrictEqual(expected);
    }
  });

  it("includeFormer=true adds people who left and people who were removed, isActive false, ordered by joinedAt", async () => {
    const { owner, stays, leaver, removed, h } = await household();
    const res = await list(stays, h.id, "?includeFormer=true");
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual([
      { userId: owner.id, name: "Olga", role: "OWNER", isActive: true },
      { userId: stays.id, name: "Sam", role: "MEMBER", isActive: true },
      { userId: leaver.id, name: "Lea", role: "MEMBER", isActive: false },
      { userId: removed.id, name: "Rob", role: "MEMBER", isActive: false },
    ]);
    expectNoSensitiveFields(res.body);
    expect(JSON.stringify(res.body)).not.toContain("@example.com");
  });

  it("a member who left and rejoined appears once, active", async () => {
    const { owner, leaver, h } = await household();
    const { token } = (await as(owner).post(`/households/${h.id}/invites`)).body;
    expect((await as(leaver).post("/households/join").send({ token })).status).toBe(200);
    const res = await list(owner, h.id, "?includeFormer=true");
    const rows = res.body.filter((m: any) => m.userId === leaver.id);
    expect(rows).toStrictEqual([{ userId: leaver.id, name: "Lea", role: "MEMBER", isActive: true }]);
  });

  it("does not include members of other households", async () => {
    const { owner, h } = await household();
    const other = await createUser();
    const h2 = await createHousehold("Other", other);
    const gone = await createUser();
    await addMember(h2.id, gone.id, "MEMBER", { leftAt: new Date() });
    const ids = (await list(owner, h.id, "?includeFormer=true")).body.map((m: any) => m.userId);
    expect(ids).not.toContain(other.id);
    expect(ids).not.toContain(gone.id);
  });

  for (const qs of ["includeFormer=TRUE", "includeFormer=1", "includeFormer=", "includeFormer=yes",
    "includeFormer=true&includeFormer=true", "includeFormer=true&includeFormer=false"]) {
    it(`returns 400 for ?${qs}`, async () => {
      const { owner, h } = await household();
      const res = await list(owner, h.id, `?${qs}`);
      expect(res.status).toBe(400);
      expect(res.body).toStrictEqual({ error: "includeFormer must be true or false" });
    });
  }

  it("a non-member and a former member (left or removed) get 404, with or without includeFormer", async () => {
    const { leaver, removed, h } = await household();
    const outsider = await createUser();
    for (const u of [outsider, leaver, removed]) {
      expect((await list(u, h.id)).status).toBe(404);
      expect((await list(u, h.id, "?includeFormer=true")).status).toBe(404);
    }
  });
});
