import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { prisma, as, anon, createUser, createHousehold, addMember } from "./helpers.js";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function setup() {
  const owner = await createUser("Olga");
  const member = await createUser("Max");
  const h = await createHousehold("Home", owner);
  await addMember(h.id, member.id);
  return { owner, member, h };
}

async function newInvite(owner: { id: number }, householdId: number): Promise<string> {
  const res = await as(owner).post(`/households/${householdId}/invites`);
  expect(res.status).toBe(201);
  return res.body.token;
}

async function membership(householdId: number, userId: number) {
  return prisma.householdMember.findUnique({ where: { userId_householdId: { userId, householdId } } });
}

describe("POST /households/:id/invites", () => {
  it("owner creates an invite: raw token returned once, only its hash stored", async () => {
    const { owner, h } = await setup();
    const before = Date.now();
    const res = await as(owner).post(`/households/${h.id}/invites`);
    expect(res.status).toBe(201);
    expect(res.body).toStrictEqual({ token: expect.any(String), expiresAt: expect.any(String) });
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const expires = new Date(res.body.expiresAt).getTime();
    const week = 7 * 24 * 60 * 60 * 1000;
    expect(expires).toBeGreaterThanOrEqual(before + week - 1000);
    expect(expires).toBeLessThanOrEqual(Date.now() + week + 1000);

    const rows = await prisma.invite.findMany({ where: { householdId: h.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tokenHash: sha256(res.body.token), status: "PENDING", acceptedAt: null });
    expect(JSON.stringify(rows)).not.toContain(res.body.token);
  });

  it("each invite gets a different token", async () => {
    const { owner, h } = await setup();
    const a = await newInvite(owner, h.id);
    const b = await newInvite(owner, h.id);
    expect(a).not.toBe(b);
  });

  it("MEMBER gets 403, non-member and former member get 404, and nothing is created", async () => {
    const { member, h } = await setup();
    const outsider = await createUser();
    const former = await createUser();
    await addMember(h.id, former.id, "OWNER", { leftAt: new Date() });
    expect((await as(member).post(`/households/${h.id}/invites`)).status).toBe(403);
    expect((await as(outsider).post(`/households/${h.id}/invites`)).status).toBe(404);
    expect((await as(former).post(`/households/${h.id}/invites`)).status).toBe(404);
    expect(await prisma.invite.count()).toBe(0);
  });

  it("invalid household id returns 400", async () => {
    const owner = await createUser();
    expect((await as(owner).post(`/households/abc/invites`)).status).toBe(400);
  });

  it("caps active invites at 25 per household (409); expired and used ones don't count", async () => {
    const { owner, h } = await setup();
    for (let i = 0; i < 25; i++) await newInvite(owner, h.id);

    const over = await as(owner).post(`/households/${h.id}/invites`);
    expect(over.status).toBe(409);
    expect(over.body).toStrictEqual({ error: expect.stringMatching(/25 active invites/) });
    expect(await prisma.invite.count({ where: { householdId: h.id } })).toBe(25);

    // another household is not affected
    const other = await createHousehold("Other", owner);
    expect((await as(owner).post(`/households/${other.id}/invites`)).status).toBe(201);

    // expiring one frees a slot
    const one = await prisma.invite.findFirst({ where: { householdId: h.id } });
    await prisma.invite.update({ where: { id: one!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await as(owner).post(`/households/${h.id}/invites`)).status).toBe(201);
    expect((await as(owner).post(`/households/${h.id}/invites`)).status).toBe(409);

    // using one frees a slot
    const two = await prisma.invite.findFirst({ where: { householdId: h.id, status: "PENDING", expiresAt: { gt: new Date() } } });
    await prisma.invite.update({ where: { id: two!.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
    expect((await as(owner).post(`/households/${h.id}/invites`)).status).toBe(201);
  });
});

describe("POST /households/join/preview", () => {
  it("returns only the household name and active members (name, role), ordered by joinedAt", async () => {
    const owner = await createUser("Olga");
    const a = await createUser("Avi");
    const gone = await createUser("Gone");
    const h = await prisma.household.create({ data: { name: "Home" } });
    await addMember(h.id, a.id, "MEMBER", { joinedAt: new Date("2026-02-01") });
    await addMember(h.id, owner.id, "OWNER", { joinedAt: new Date("2026-01-01") });
    await addMember(h.id, gone.id, "MEMBER", { joinedAt: new Date("2026-01-15"), leftAt: new Date() });
    const token = await newInvite(owner, h.id);

    const visitor = await createUser("Visitor");
    const res = await as(visitor).post("/households/join/preview").send({ token });
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({
      householdName: "Home",
      members: [
        { name: "Olga", role: "OWNER" },
        { name: "Avi", role: "MEMBER" },
      ],
    });
    const json = JSON.stringify(res.body);
    expect(json).not.toMatch(/email|@example\.com|"id"|userId|householdId|cognito|joinedAt|leftAt/i);
  });

  it("changes nothing", async () => {
    const { owner, h } = await setup();
    const token = await newInvite(owner, h.id);
    const visitor = await createUser();
    const before = await prisma.invite.findFirst({ where: { householdId: h.id } });
    expect((await as(visitor).post("/households/join/preview").send({ token })).status).toBe(200);
    expect((await as(visitor).post("/households/join/preview").send({ token })).status).toBe(200);
    expect(await prisma.invite.findFirst({ where: { householdId: h.id } })).toStrictEqual(before);
    expect(await membership(h.id, visitor.id)).toBeNull();
  });

  it("an existing member can preview too", async () => {
    const { owner, member, h } = await setup();
    const token = await newInvite(owner, h.id);
    expect((await as(member).post("/households/join/preview").send({ token })).status).toBe(200);
  });

  it("unknown token 404, expired 410, used 410 (separate messages)", async () => {
    const { owner, h } = await setup();
    const visitor = await createUser();

    const unknown = await as(visitor).post("/households/join/preview").send({ token: "x".repeat(43) });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toStrictEqual({ error: "Invite not found" });

    const expiredToken = await newInvite(owner, h.id);
    await prisma.invite.update({ where: { tokenHash: sha256(expiredToken) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await as(visitor).post("/households/join/preview").send({ token: expiredToken });
    expect(expired.status).toBe(410);
    expect(expired.body).toStrictEqual({ error: "Invite has expired" });

    const usedToken = await newInvite(owner, h.id);
    expect((await as(visitor).post("/households/join").send({ token: usedToken })).status).toBe(200);
    const used = await as(await createUser()).post("/households/join/preview").send({ token: usedToken });
    expect(used.status).toBe(410);
    expect(used.body).toStrictEqual({ error: "Invite was already used" });
  });
});

describe("POST /households/join", () => {
  it("accepts: joins as MEMBER, consumes the invite, returns the GET /:id shape", async () => {
    const { owner, h } = await setup();
    const token = await newInvite(owner, h.id);
    const joiner = await createUser("Joiner");

    const res = await as(joiner).post("/households/join").send({ token });
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual({ id: h.id, name: "Home", defaultCurrency: "USD", timeZone: "UTC", role: "MEMBER" });

    expect(await membership(h.id, joiner.id)).toMatchObject({ role: "MEMBER", leftAt: null });
    const invite = await prisma.invite.findUnique({ where: { tokenHash: sha256(token) } });
    expect(invite?.status).toBe("ACCEPTED");
    expect(invite?.acceptedAt).toBeInstanceOf(Date);

    const get = await as(joiner).get(`/households/${h.id}`);
    expect(get.body).toStrictEqual(res.body);
    const list = await as(joiner).get("/me/households");
    expect(list.body).toStrictEqual([{ householdId: h.id, name: "Home", role: "MEMBER" }]);
  });

  it("unknown token returns 404 'Invite not found'", async () => {
    const user = await createUser();
    const res = await as(user).post("/households/join").send({ token: "nope" });
    expect(res.status).toBe(404);
    expect(res.body).toStrictEqual({ error: "Invite not found" });
  });

  it("expired token returns 410 'Invite has expired' and adds nobody", async () => {
    const { owner, h } = await setup();
    const token = await newInvite(owner, h.id);
    await prisma.invite.update({ where: { tokenHash: sha256(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const joiner = await createUser();
    const res = await as(joiner).post("/households/join").send({ token });
    expect(res.status).toBe(410);
    expect(res.body).toStrictEqual({ error: "Invite has expired" });
    expect(await membership(h.id, joiner.id)).toBeNull();
    expect((await prisma.invite.findUnique({ where: { tokenHash: sha256(token) } }))?.status).toBe("PENDING");
  });

  it("an invite with status EXPIRED returns 410 'Invite has expired' even before expiresAt", async () => {
    const { owner, h } = await setup();
    const token = await newInvite(owner, h.id);
    await prisma.invite.update({ where: { tokenHash: sha256(token) }, data: { status: "EXPIRED" } });
    const res = await as(await createUser()).post("/households/join").send({ token });
    expect(res.status).toBe(410);
    expect(res.body).toStrictEqual({ error: "Invite has expired" });
  });

  it("used token returns 410 'Invite was already used'", async () => {
    const { owner, h } = await setup();
    const token = await newInvite(owner, h.id);
    expect((await as(await createUser()).post("/households/join").send({ token })).status).toBe(200);
    const second = await createUser();
    const res = await as(second).post("/households/join").send({ token });
    expect(res.status).toBe(410);
    expect(res.body).toStrictEqual({ error: "Invite was already used" });
    expect(await membership(h.id, second.id)).toBeNull();
  });

  it("an active member gets 409 and the invite is not consumed", async () => {
    const { owner, member, h } = await setup();
    const token = await newInvite(owner, h.id);
    for (const u of [member, owner]) {
      const res = await as(u).post("/households/join").send({ token });
      expect(res.status).toBe(409);
      expect(res.body).toStrictEqual({ error: "Already a member of this household" });
    }
    expect(await prisma.invite.findUnique({ where: { tokenHash: sha256(token) } })).toMatchObject({ status: "PENDING", acceptedAt: null });
    expect((await membership(h.id, owner.id))?.role).toBe("OWNER");

    // still usable by someone else
    expect((await as(await createUser()).post("/households/join").send({ token })).status).toBe(200);
  });

  it("rejoin: a former member is reactivated (leftAt cleared, MEMBER, joinedAt reset)", async () => {
    const { owner, member, h } = await setup();
    expect((await as(member).delete(`/households/${h.id}/members/me`)).status).toBe(204);
    const old = await membership(h.id, member.id);
    expect(old?.leftAt).toBeInstanceOf(Date);

    const token = await newInvite(owner, h.id);
    const before = Date.now();
    const res = await as(member).post("/households/join").send({ token });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("MEMBER");

    const row = await membership(h.id, member.id);
    expect(row?.leftAt).toBeNull();
    expect(row?.role).toBe("MEMBER");
    expect(row!.joinedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row!.joinedAt.getTime()).toBeGreaterThan(old!.joinedAt.getTime());
    expect(await prisma.householdMember.count({ where: { householdId: h.id, userId: member.id } })).toBe(1);

    const list = await as(owner).get(`/households/${h.id}/members`);
    expect(list.body.map((m: any) => m.userId)).toStrictEqual([owner.id, member.id]);
  });

  it("a former OWNER rejoins as MEMBER", async () => {
    const o1 = await createUser("O1");
    const o2 = await createUser("O2");
    const h = await createHousehold("Home", o1);
    await addMember(h.id, o2.id, "OWNER");
    expect((await as(o1).delete(`/households/${h.id}/members/me`)).status).toBe(204);

    const token = await newInvite(o2, h.id);
    const res = await as(o1).post("/households/join").send({ token });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("MEMBER");
    expect(await membership(h.id, o1.id)).toMatchObject({ role: "MEMBER", leftAt: null });
    expect((await as(o1).patch(`/households/${h.id}`).send({ name: "X" })).status).toBe(403);
  });

  it("a removed member can rejoin with a new invite", async () => {
    const { owner, member, h } = await setup();
    expect((await as(owner).delete(`/households/${h.id}/members/${member.id}`)).status).toBe(204);
    const token = await newInvite(owner, h.id);
    expect((await as(member).post("/households/join").send({ token })).status).toBe(200);
    expect(await membership(h.id, member.id)).toMatchObject({ role: "MEMBER", leftAt: null });
  });

  it("two simultaneous accepts of the same link by different users: exactly one succeeds", async () => {
    for (let round = 0; round < 5; round++) {
      const { owner, h } = await setup();
      const token = await newInvite(owner, h.id);
      const a = await createUser();
      const b = await createUser();
      const results = await Promise.all([
        as(a).post("/households/join").send({ token }),
        as(b).post("/households/join").send({ token }),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toStrictEqual([200, 410]);
      expect(results.find((r) => r.status === 410)!.body).toStrictEqual({ error: "Invite was already used" });
      const joined = await prisma.householdMember.count({ where: { householdId: h.id, userId: { in: [a.id, b.id] } } });
      expect(joined).toBe(1);
    }
  });

  it("the same user accepting twice at once: one 200, the other 4xx, one membership row", async () => {
    const { owner, h } = await setup();
    const token = await newInvite(owner, h.id);
    const a = await createUser();
    const results = await Promise.all([
      as(a).post("/households/join").send({ token }),
      as(a).post("/households/join").send({ token }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(200);
    expect([409, 410]).toContain(statuses[1]);
    expect(await prisma.householdMember.count({ where: { householdId: h.id, userId: a.id } })).toBe(1);
  });
});

describe("token validation and auth", () => {
  const bad: [string, unknown][] = [
    ["missing token", {}],
    ["empty token", { token: "" }],
    ["numeric token", { token: 123 }],
    ["null token", { token: null }],
    ["array token", { token: ["a"] }],
    ["object token", { token: { a: 1 } }],
    ["over-long token", { token: "a".repeat(129) }],
  ];
  for (const path of ["/households/join/preview", "/households/join"]) {
    for (const [label, body] of bad) {
      it(`${path}: ${label} returns 400`, async () => {
        const user = await createUser();
        const res = await as(user).post(path).send(body as object);
        expect(res.status).toBe(400);
        expect(res.body).toStrictEqual({ error: "Invalid token" });
      });
    }

    it(`${path}: no body returns 400`, async () => {
      const user = await createUser();
      expect((await as(user).post(path)).status).toBe(400);
    });

    it(`${path}: returns 401 without credentials`, async () => {
      const { owner, h } = await setup();
      const token = await newInvite(owner, h.id);
      const res = await anon().post(path).send({ token });
      expect(res.status).toBe(401);
      expect((await prisma.invite.findUnique({ where: { tokenHash: sha256(token) } }))?.status).toBe("PENDING");
    });
  }

  it("POST /households/:id/invites returns 401 without credentials", async () => {
    const { h } = await setup();
    expect((await anon().post(`/households/${h.id}/invites`)).status).toBe(401);
    expect(await prisma.invite.count()).toBe(0);
  });

  it("token in the query string is ignored (body only)", async () => {
    const { owner, h } = await setup();
    const token = await newInvite(owner, h.id);
    const res = await as(await createUser()).post(`/households/join?token=${token}`).send({});
    expect(res.status).toBe(400);
  });
});

describe("GET /households/:id/invites", () => {
  it("lists only active invites, newest first, as [{ id, createdAt, expiresAt }]", async () => {
    const { owner, h } = await setup();
    const older = await prisma.invite.create({
      data: { householdId: h.id, tokenHash: sha256("older"), expiresAt: new Date(Date.now() + 864e5), createdAt: new Date(Date.now() - 2 * 864e5) },
    });
    const newer = await prisma.invite.create({
      data: { householdId: h.id, tokenHash: sha256("newer"), expiresAt: new Date(Date.now() + 864e5), createdAt: new Date(Date.now() - 864e5) },
    });
    await prisma.invite.create({ data: { householdId: h.id, tokenHash: sha256("expired"), expiresAt: new Date(Date.now() - 1000) } });
    await prisma.invite.create({ data: { householdId: h.id, tokenHash: sha256("used"), expiresAt: new Date(Date.now() + 864e5), status: "ACCEPTED", acceptedAt: new Date() } });
    await prisma.invite.create({ data: { householdId: h.id, tokenHash: sha256("flagged"), expiresAt: new Date(Date.now() + 864e5), status: "EXPIRED" } });
    const other = await createHousehold("Other", owner);
    await prisma.invite.create({ data: { householdId: other.id, tokenHash: sha256("other"), expiresAt: new Date(Date.now() + 864e5) } });
    const token = await newInvite(owner, h.id);
    const newest = await prisma.invite.findUnique({ where: { tokenHash: sha256(token) } });

    const res = await as(owner).get(`/households/${h.id}/invites`);
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual([newest!, newer, older].map((i) => ({
      id: i.id, createdAt: i.createdAt.toISOString(), expiresAt: i.expiresAt.toISOString(),
    })));
    expect(JSON.stringify(res.body)).not.toMatch(/token|hash|status|householdId/i);
    expect(JSON.stringify(res.body)).not.toContain(token);
  });

  it("returns an empty array when there are no active invites", async () => {
    const { owner, h } = await setup();
    const res = await as(owner).get(`/households/${h.id}/invites`);
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual([]);
  });

  it("MEMBER gets 403, non-member and former member get 404, no credentials 401", async () => {
    const { owner, member, h } = await setup();
    await newInvite(owner, h.id);
    const outsider = await createUser();
    const former = await createUser();
    await addMember(h.id, former.id, "OWNER", { leftAt: new Date() });
    expect((await as(member).get(`/households/${h.id}/invites`)).status).toBe(403);
    expect((await as(outsider).get(`/households/${h.id}/invites`)).status).toBe(404);
    expect((await as(former).get(`/households/${h.id}/invites`)).status).toBe(404);
    expect((await anon().get(`/households/${h.id}/invites`)).status).toBe(401);
  });
});

describe("DELETE /households/:id/invites/:inviteId", () => {
  it("owner cancels an invite: 204, row deleted, the link no longer works", async () => {
    const { owner, h } = await setup();
    const token = await newInvite(owner, h.id);
    const keep = await newInvite(owner, h.id);
    const invite = await prisma.invite.findUnique({ where: { tokenHash: sha256(token) } });

    const res = await as(owner).delete(`/households/${h.id}/invites/${invite!.id}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect(await prisma.invite.findUnique({ where: { id: invite!.id } })).toBeNull();
    expect(await prisma.invite.count({ where: { tokenHash: sha256(keep) } })).toBe(1);

    const join = await as(await createUser()).post("/households/join").send({ token });
    expect(join.status).toBe(404);
    expect(join.body).toStrictEqual({ error: "Invite not found" });
    const list = await as(owner).get(`/households/${h.id}/invites`);
    expect(list.body.map((i: any) => i.id)).not.toContain(invite!.id);
  });

  it("cancelling twice or a missing id returns 404 'Invite not found'", async () => {
    const { owner, h } = await setup();
    const token = await newInvite(owner, h.id);
    const invite = await prisma.invite.findUnique({ where: { tokenHash: sha256(token) } });
    expect((await as(owner).delete(`/households/${h.id}/invites/${invite!.id}`)).status).toBe(204);
    const again = await as(owner).delete(`/households/${h.id}/invites/${invite!.id}`);
    expect(again.status).toBe(404);
    expect(again.body).toStrictEqual({ error: "Invite not found" });
    expect((await as(owner).delete(`/households/${h.id}/invites/2147483647`)).status).toBe(404);
  });

  it("an owner of one household cannot delete another household's invite", async () => {
    const { owner, h } = await setup();
    const otherOwner = await createUser();
    const other = await createHousehold("Other", otherOwner);
    const token = await newInvite(otherOwner, other.id);
    const invite = await prisma.invite.findUnique({ where: { tokenHash: sha256(token) } });

    const res = await as(owner).delete(`/households/${h.id}/invites/${invite!.id}`);
    expect(res.status).toBe(404);
    expect(res.body).toStrictEqual({ error: "Invite not found" });
    expect((await as(owner).delete(`/households/${other.id}/invites/${invite!.id}`)).status).toBe(404);
    expect(await prisma.invite.count({ where: { id: invite!.id } })).toBe(1);
  });

  it("MEMBER gets 403, non-member and former member get 404, no credentials 401; nothing is deleted", async () => {
    const { owner, member, h } = await setup();
    const token = await newInvite(owner, h.id);
    const invite = await prisma.invite.findUnique({ where: { tokenHash: sha256(token) } });
    const outsider = await createUser();
    const former = await createUser();
    await addMember(h.id, former.id, "OWNER", { leftAt: new Date() });
    const path = `/households/${h.id}/invites/${invite!.id}`;
    expect((await as(member).delete(path)).status).toBe(403);
    expect((await as(outsider).delete(path)).status).toBe(404);
    expect((await as(former).delete(path)).status).toBe(404);
    expect((await anon().delete(path)).status).toBe(401);
    expect(await prisma.invite.count({ where: { id: invite!.id } })).toBe(1);
  });

  for (const id of ["abc", "0", "-1", "007", "1.5", "2147483648"]) {
    it(`invalid invite id ${JSON.stringify(id)} returns 400 "Invalid id"`, async () => {
      const { owner, h } = await setup();
      const res = await as(owner).delete(`/households/${h.id}/invites/${encodeURIComponent(id)}`);
      expect(res.status).toBe(400);
      expect(res.body).toStrictEqual({ error: "Invalid id" });
    });
  }
});

describe("household row lock", () => {
  it("concurrent creates cannot pass the 25 cap", async () => {
    const { owner, h } = await setup();
    for (let i = 0; i < 22; i++) await newInvite(owner, h.id);
    const results = await Promise.all(Array.from({ length: 8 }, () => as(owner).post(`/households/${h.id}/invites`)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toStrictEqual([201, 201, 201, 409, 409, 409, 409, 409]);
    expect(await prisma.invite.count({ where: { householdId: h.id } })).toBe(25);
  });

  it("a join racing with the last member leaving never returns 500 and leaves a consistent state", async () => {
    for (let round = 0; round < 8; round++) {
      const owner = await createUser();
      const h = await createHousehold("Race", owner);
      const token = await newInvite(owner, h.id);
      const joiner = await createUser();

      const [leave, join] = await Promise.all([
        as(owner).delete(`/households/${h.id}/members/me`),
        as(joiner).post("/households/join").send({ token }),
      ]);
      expect(leave.status).toBe(204);
      const exists = await prisma.household.count({ where: { id: h.id } });
      if (join.status === 200) {
        // join won: the joiner is the only active member and was promoted to OWNER
        expect(exists).toBe(1);
        expect(await membership(h.id, joiner.id)).toMatchObject({ role: "OWNER", leftAt: null });
      } else {
        // leave won: the household (and its invite) are gone
        expect(join.status).toBe(404);
        expect(join.body).toStrictEqual({ error: "Invite not found" });
        expect(exists).toBe(0);
        expect(await membership(h.id, joiner.id)).toBeNull();
      }
    }
  });

  it("a join racing with DELETE /:id never returns 500", async () => {
    for (let round = 0; round < 8; round++) {
      const owner = await createUser();
      const h = await createHousehold("Race", owner);
      const token = await newInvite(owner, h.id);
      const joiner = await createUser();
      const [del, join] = await Promise.all([
        as(owner).delete(`/households/${h.id}`),
        as(joiner).post("/households/join").send({ token }),
      ]);
      expect(del.status).toBe(204);
      expect([200, 404]).toContain(join.status);
      expect(await prisma.household.count({ where: { id: h.id } })).toBe(0);
      expect(await prisma.householdMember.count({ where: { householdId: h.id } })).toBe(0);
    }
  });
});
