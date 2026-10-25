import { Currency, Prisma } from "../../generated/prisma/client.js";
import { HttpError } from "../middleware/errorHandler.js";
import { prisma } from "../prisma.js";

export type HouseholdUpdate = {
  name?: string;
  defaultCurrency?: Currency;
  timeZone?: string;
  monthlyLimit?: number | null;
}; 

const householdSelect = { id: true, name: true, defaultCurrency: true, timeZone: true, monthlyLimit: true } as const;

export async function createHousehold(name: string, currency: Currency, timeZone: string, monthlyLimit: number | null, userId: number){
    return prisma.household.create({
        data: { name, defaultCurrency: currency, timeZone, monthlyLimit, members: { create: { userId, role: "OWNER" } } },
        select: householdSelect,
    });
}

export async function getHouseholdData(householdId: number) {
    return prisma.household.findUnique({
        where: { id: householdId },
        select: householdSelect,
    });
} 

export async function updateHousehold(householdId: number, dataToUpdate: HouseholdUpdate){
    return prisma.household.update({
        where: { id: householdId },
        data: dataToUpdate,
        select: householdSelect,
    })
}

// active members only, unless includeFormer (people who left or were removed, isActive false)
export async function getMembers(householdId: number, includeFormer = false) {
    const members = await prisma.householdMember.findMany({
        where: { householdId, ...(includeFormer ? {} : { leftAt: null }) },
        select: { userId: true, role: true, joinedAt: true, leftAt: true, user: { select: { name: true } }, },
        orderBy: { joinedAt: "asc" },
    });

    return members.map((m) => ({
        userId: m.userId,
        name: m.user.name,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
        isActive: m.leftAt === null,
    }));
}

export async function leaveHousehold(householdId: number, userId: number) {
    return prisma.$transaction(async (tx) => {
        await lockHousehold(householdId, tx);
        await markLeft(householdId, userId, tx);
        const membership = await tx.householdMember.findUnique({
            where: { userId_householdId: { userId, householdId } },
        });
        if (membership!.role === "MEMBER")
            return;

        const ownersCount = await tx.householdMember.count({
            where: { householdId, role: "OWNER", leftAt: null },
        });
        if (ownersCount > 0) return;

        const activeMembers = await tx.householdMember.findMany({
            where: { householdId, leftAt: null },
            select: { userId: true },
        });

        if (activeMembers.length === 0) {
            await deleteHouseholdHelper(householdId, tx);
            return;
        }

        const newOwner = activeMembers[Math.floor(Math.random() * activeMembers.length)];
        await tx.householdMember.update({
            where: { userId_householdId: { userId: newOwner.userId, householdId } },
            data: { role: "OWNER" },
        });
    });
}

export async function removeMember(householdId: number, userId: number){
    return prisma.$transaction(async (tx) => {
        await lockHousehold(householdId, tx);
        await markLeft(householdId, userId, tx);
    })
}

//returns count of updated users, if count = 0 the user wasn't found or had already left
async function markLeft(householdId: number, userId: number, tx: Prisma.TransactionClient){
    const markedCount = await tx.householdMember.updateMany({
        where: { householdId: householdId, userId: userId, leftAt: null },
        data: {leftAt: new Date()}
    })
    if (markedCount.count === 0)
        throw new HttpError(404, "user not found or already left");
    
    return markedCount.count;
}

export async function deleteHousehold(householdId: number){
    return prisma.$transaction(async (tx) => {
        if (!(await lockHousehold(householdId, tx)))
            throw new HttpError(404, "Household not found");
        await deleteHouseholdHelper(householdId, tx);
    })
}

async function deleteHouseholdHelper(householdId: number, tx: Prisma.TransactionClient){
    await tx.expense.deleteMany({ where: { householdId } });
    await tx.recurringRule.deleteMany({ where: { householdId } });
    await tx.householdMember.deleteMany({ where: { householdId } });
    await tx.household.delete({ where: { id: householdId } });
}

//locks the household row until the transaction ends, so membership changes (leave, remove, join, delete)
//and invite creation on one household run one at a time; returns false if the household no longer exists
export async function lockHousehold(householdId: number, tx: Prisma.TransactionClient): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: number }[]>`SELECT "id" FROM "Household" WHERE "id" = ${householdId} FOR UPDATE`;
    return rows.length === 1;
}
