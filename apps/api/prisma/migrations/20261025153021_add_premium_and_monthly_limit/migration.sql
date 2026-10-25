-- AlterTable
ALTER TABLE "Household" ADD COLUMN     "monthlyLimit" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isPremium" BOOLEAN NOT NULL DEFAULT false;
