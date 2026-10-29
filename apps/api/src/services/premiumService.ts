import { HttpError } from "../middleware/errorHandler.js";
import { prisma } from "../prisma.js";
import { isPremiumActive, nextRenewal } from "../lib/premium.js";
import { meSelect, toMeResponse } from "./meService.js";

async function lockUser(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], userId: number) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  return tx.user.findUniqueOrThrow({ where: { id: userId }, select: meSelect });
}

// Cancels at the end of the paid month: premiumEndsAt = the next monthly anniversary of premiumStartedAt.
// A premium user without a start date (set by hand without one) starts now, so their paid month ends a month from now.
export async function cancelPremium(userId: number, now: Date = new Date()) {
  return prisma.$transaction(async (tx) => {
    const user = await lockUser(tx, userId);
    if (!isPremiumActive(user, now)) throw new HttpError(403, "Premium required");
    if (user.premiumEndsAt) throw new HttpError(409, "Premium is already canceled");
    const startedAt = user.premiumStartedAt ?? now;
    const updated = await tx.user.update({
      where: { id: userId },
      data: { premiumStartedAt: startedAt, premiumEndsAt: nextRenewal(startedAt, now) },
      select: meSelect,
    });
    return toMeResponse(updated, now);
  });
}

// Undoes a cancel before the end date; the subscription keeps its start date and renews monthly again.
// After the end date the user isn't premium any more and has to join again.
export async function resumePremium(userId: number, now: Date = new Date()) {
  return prisma.$transaction(async (tx) => {
    const user = await lockUser(tx, userId);
    if (!isPremiumActive(user, now)) throw new HttpError(403, "Premium required");
    if (!user.premiumEndsAt) throw new HttpError(409, "Premium is not canceled");
    const updated = await tx.user.update({ where: { id: userId }, data: { premiumEndsAt: null }, select: meSelect });
    return toMeResponse(updated, now);
  });
}

// Daily cleanup: ends the subscriptions whose end date has passed. Only tidies rows; isPremiumActive already treats them
// as not premium. Idempotent.
export async function expirePremium(now: Date = new Date()) {
  const { count } = await prisma.user.updateMany({
    where: { premiumEndsAt: { lte: now } },
    data: { isPremium: false, premiumStartedAt: null, premiumEndsAt: null },
  });
  return count;
}
