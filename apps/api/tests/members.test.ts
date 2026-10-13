import { describe, it, expect } from "vitest";
import {
  prisma, as, createUser, createHousehold, addMember, addHouseholdData, countHouseholdData, INVALID_IDS,
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
