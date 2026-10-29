import { Prisma } from "../../generated/prisma/client.js";
import { HttpError } from "../middleware/errorHandler.js";
import { prisma } from "../prisma.js";
import { generateDueExpenses } from "./recurringRulesService.js";
import { isPremiumActive, nextRenewal } from "../lib/premium.js";

export const meSelect = { id: true, name: true, email: true, isPremium: true, premiumStartedAt: true, premiumEndsAt: true } as const;
type MeRow = { id: number; name: string; email: string; isPremium: boolean; premiumStartedAt: Date | null; premiumEndsAt: Date | null };

// The /me shape. isPremium is the effective value (an ended subscription reads false even before the daily cleanup),
// and the dates are null unless premium. premiumRenewsAt is when a renewing subscription would end if canceled now
// (null once canceled; premiumEndsAt is then the end date).
export function toMeResponse(user: MeRow, now: Date = new Date()) {
    const active = isPremiumActive(user, now);
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        isPremium: active,
        premiumStartedAt: active ? user.premiumStartedAt?.toISOString() ?? null : null,
        premiumEndsAt: active ? user.premiumEndsAt?.toISOString() ?? null : null,
        premiumRenewsAt: active && !user.premiumEndsAt ? nextRenewal(user.premiumStartedAt ?? now, now).toISOString() : null,
    };
}

export async function getUserData(userId: number){
    const user = await prisma.user.findUnique({ where: { id: userId }, select: meSelect });
    return user && toMeResponse(user);
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
    const user = await prisma.user.update({
        where: { id: userId },
        data: { name: newName},
        select: meSelect,
    });
    return toMeResponse(user);
}

// what the user paid in a month, per currency, across the households they are an active member of
// (expenses with paidById = the user; households they left are not counted). Minor units, summed in the database,
// no conversion. Due recurring expenses are generated first in each of those households, like the summary does.
export async function getMySpending(userId: number, first: Date, last: Date) {
    const memberships = await prisma.householdMember.findMany({
        where: { userId, leftAt: null },
        select: { householdId: true, household: { select: { name: true } } },
        orderBy: { joinedAt: "asc" },
    });
    const householdIds = memberships.map((m) => m.householdId);
    // one household at a time, so a user in many households doesn't take many connections at once
    for (const householdId of householdIds)
        await generateDueExpenses(householdId);

    const rows = householdIds.length === 0 ? [] : await prisma.expense.groupBy({
        by: ["householdId", "currency"],
        where: { paidById: userId, householdId: { in: householdIds }, date: { gte: first, lte: last } },
        _sum: { amount: true },
    });

    // Postgres sums an int column as bigint; returned as plain numbers, never cast back to 32 bits
    const spentRows = rows
        .map((row) => ({ householdId: row.householdId, currency: row.currency, spent: Number(row._sum.amount ?? 0) }))
        .filter((r) => r.spent !== 0);
    const byCurrency = (list: { currency: string; spent: number }[]) =>
        list.map((r) => ({ currency: r.currency, spent: r.spent })).sort((a, b) => a.currency.localeCompare(b.currency));

    // the overall totals add up the households' rows per currency (one query for both)
    const overall = new Map<string, number>();
    for (const r of spentRows) overall.set(r.currency, (overall.get(r.currency) ?? 0) + r.spent);
    const totals = byCurrency([...overall].map(([currency, spent]) => ({ currency, spent })));

    // every active household, in the order of GET /me/households, even when the caller paid nothing there
    const households = memberships.map((m) => ({
        householdId: m.householdId,
        name: m.household.name,
        totals: byCurrency(spentRows.filter((r) => r.householdId === m.householdId)),
    }));
    return { month: first.toISOString().slice(0, 7), totals, households };
}
