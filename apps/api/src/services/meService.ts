import { Prisma } from "../../generated/prisma/client.js";
import { HttpError } from "../middleware/errorHandler.js";
import { prisma } from "../prisma.js";

export async function getUserData(userId: number){
    return prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true },
    });
} 

export async function getActiveHouseholds(userId: number){
    const households = await prisma.householdMember.findMany({
        where: { userId, leftAt: null },
        select: { householdId: true, role: true, household: { select: { name: true } }, },
        orderBy: { joinedAt: "asc" },
    });

    return households.map((m) => ({
        householdId: m.householdId,
        name: m.household.name,
        role: m.role,
    }));
}

export async function updateName(userId: number, newName: string){
    return prisma.user.update({
        where: { id: userId },
        data: { name: newName},
        select: { id: true, name: true, email: true }
    });
}