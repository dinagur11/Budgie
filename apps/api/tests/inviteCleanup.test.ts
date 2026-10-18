import { describe, it, expect } from "vitest";
import { prisma, as, createUser, createHousehold } from "./helpers.js";
import { cleanupInvites } from "../src/services/invitesService.js";

const DAY = 864e5;
const ago = (days: number) => new Date(Date.now() - days * DAY);

async function invite(householdId: number, tag: string, data: { expiresAt: Date; status?: "PENDING" | "ACCEPTED" | "EXPIRED"; acceptedAt?: Date }) {
  return prisma.invite.create({ data: { householdId, tokenHash: `hash-${tag}`, ...data } });
}

describe("cleanupInvites", () => {
  it("deletes invites expired or accepted more than 30 days ago and keeps the rest", async () => {
    const owner = await createUser();
    const h = await createHousehold("Home", owner);
    const other = await createHousehold("Other", owner);

    const active = await invite(h.id, "active", { expiresAt: new Date(Date.now() + DAY) });
    const recentlyExpired = await invite(h.id, "recent", { expiresAt: ago(29) });
    const recentlyAccepted = await invite(h.id, "accepted-recent", { expiresAt: ago(25), status: "ACCEPTED", acceptedAt: ago(29) });
    await invite(h.id, "old", { expiresAt: ago(31) });
    await invite(h.id, "flagged", { expiresAt: ago(40), status: "EXPIRED" });
    await invite(h.id, "accepted-old", { expiresAt: ago(25), status: "ACCEPTED", acceptedAt: ago(31) });
    await invite(other.id, "other-old", { expiresAt: ago(60) });

    expect(await cleanupInvites()).toBe(4);
    const left = await prisma.invite.findMany({ select: { id: true }, orderBy: { id: "asc" } });
    expect(left.map((i) => i.id)).toStrictEqual([active.id, recentlyExpired.id, recentlyAccepted.id]);
  });

  it("is idempotent and changes nothing else", async () => {
    const owner = await createUser();
    const h = await createHousehold("Home", owner);
    await invite(h.id, "old", { expiresAt: ago(31) });

    expect(await cleanupInvites()).toBe(1);
    expect(await cleanupInvites()).toBe(0);
    expect(await prisma.household.count()).toBe(1);
    expect(await prisma.householdMember.count()).toBe(1);
  });

  it("a deleted invite's token reads as not found; a kept one still answers 410", async () => {
    const owner = await createUser();
    const joiner = await createUser();
    const h = await createHousehold("Home", owner);
    const kept = await as(owner).post(`/households/${h.id}/invites`);
    const gone = await as(owner).post(`/households/${h.id}/invites`);
    const [keptRow, goneRow] = await prisma.invite.findMany({ where: { householdId: h.id }, orderBy: { id: "asc" } });
    await prisma.invite.update({ where: { id: keptRow.id }, data: { expiresAt: ago(29) } });
    await prisma.invite.update({ where: { id: goneRow.id }, data: { expiresAt: ago(31) } });

    await cleanupInvites();
    const keptRes = await as(joiner).post("/households/join/preview").send({ token: kept.body.token });
    expect(keptRes.status).toBe(410);
    expect(keptRes.body).toStrictEqual({ error: "Invite has expired" });
    const goneRes = await as(joiner).post("/households/join/preview").send({ token: gone.body.token });
    expect(goneRes.status).toBe(404);
  });
});
