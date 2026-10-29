-- AlterTable
ALTER TABLE "User" ADD COLUMN     "premiumEndsAt" TIMESTAMP(3),
ADD COLUMN     "premiumStartedAt" TIMESTAMP(3);

-- Users made premium by hand before subscriptions existed start their subscription now.
UPDATE "User" SET "premiumStartedAt" = now() WHERE "isPremium" AND "premiumStartedAt" IS NULL;
