import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { HttpError } from "../middleware/errorHandler.js";
import { prisma } from "../prisma.js";
import { lockHousehold } from "./householdsService.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ACTIVE_INVITES = 25;

function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

//creates a single-use invite; the raw token is returned only here and never stored
export async function createInvite(householdId: number) {
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);

    return prisma.$transaction(async (tx) => {
        // the lock makes the count and the insert atomic, so concurrent requests can't pass the cap
        if (!(await lockHousehold(householdId, tx)))
            throw new HttpError(404, "Household not found");
        const activeCount = await tx.invite.count({
            where: { householdId, status: "PENDING", expiresAt: { gt: now } },
        });
        if (activeCount >= MAX_ACTIVE_INVITES)
            throw new HttpError(409, `This household already has ${MAX_ACTIVE_INVITES} active invites`);

        const invite = await tx.invite.create({
            data: { householdId, tokenHash: hashToken(token), expiresAt },
            select: { expiresAt: true },
        });
        return { token, expiresAt: invite.expiresAt };
    });
}

//active invites (pending and not expired), newest first; nothing token-related is returned
export async function listInvites(householdId: number) {
    return prisma.invite.findMany({
        where: { householdId, status: "PENDING", expiresAt: { gt: new Date() } },
        select: { id: true, createdAt: true, expiresAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
}

//cancels an invite; filtering by household too means one household can't delete another's invite
export async function cancelInvite(householdId: number, inviteId: number) {
    const deleted = await prisma.invite.deleteMany({
        where: { id: inviteId, householdId },
    });
    if (deleted.count === 0)
        throw new HttpError(404, "Invite not found");
}

//household name and active members for the join screen; changes nothing
export async function previewInvite(token: string) {
    const invite = await findUsableInvite(token, prisma);
    const household = await prisma.household.findUnique({
        where: { id: invite.householdId },
        select: {
            name: true,
            members: {
                where: { leftAt: null },
                select: { role: true, user: { select: { name: true } } },
                orderBy: { joinedAt: "asc" },
            },
        },
    });
    if (household === null)
        throw new HttpError(404, "Invite not found");

    return {
        householdName: household.name,
        members: household.members.map((m) => ({ name: m.user.name, role: m.role })),
    };
}

//joins the household as MEMBER; the invite is consumed only if the join succeeds
export async function acceptInvite(token: string, userId: number) {
    return prisma.$transaction(async (tx) => {
        const invite = await findUsableInvite(token, tx);
        const householdId = invite.householdId;
        // serializes the join with leave, remove and delete on the same household
        if (!(await lockHousehold(householdId, tx)))
            throw new HttpError(404, "Invite not found");

        const membership = await tx.householdMember.findUnique({
            where: { userId_householdId: { userId, householdId } },
            select: { leftAt: true },
        });
        if (membership && membership.leftAt === null)
            throw new HttpError(409, "Already a member of this household");

        // conditional claim: if another request accepted the invite first, count is 0
        const now = new Date();
        const claimed = await tx.invite.updateMany({
            where: { id: invite.id, status: "PENDING", expiresAt: { gt: now } },
            data: { status: "ACCEPTED", acceptedAt: now },
        });
        if (claimed.count !== 1)
            throw new HttpError(410, "Invite was already used");

        if (membership) {
            // former member: reactivate, never restoring an old OWNER role
            await tx.householdMember.update({
                where: { userId_householdId: { userId, householdId } },
                data: { leftAt: null, role: "MEMBER", joinedAt: now },
            });
        } else {
            await tx.householdMember.create({
                data: { userId, householdId, role: "MEMBER", joinedAt: now },
            });
        }

        const household = await tx.household.findUnique({
            where: { id: householdId },
            select: { id: true, name: true, defaultCurrency: true, timeZone: true },
        });
        return { ...household!, role: "MEMBER" as const };
    });
}

//looks up the invite by token hash; expiry is computed from expiresAt, the EXPIRED status is not written here
async function findUsableInvite(token: string, db: Prisma.TransactionClient) {
    const invite = await db.invite.findUnique({
        where: { tokenHash: hashToken(token) },
        select: { id: true, householdId: true, status: true, expiresAt: true },
    });
    if (invite === null)
        throw new HttpError(404, "Invite not found");
    if (invite.status === "ACCEPTED")
        throw new HttpError(410, "Invite was already used");
    if (invite.status === "EXPIRED" || invite.expiresAt <= new Date())
        throw new HttpError(410, "Invite has expired");
    return invite;
}
