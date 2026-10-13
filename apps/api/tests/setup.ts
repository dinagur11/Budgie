import { vi, beforeEach, afterAll } from "vitest";

// Database guard: runs before anything imports src/prisma.ts (which would load .env as a fallback).
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. Export it in the shell, pointing at the expenses_test database.");
}
const dbName = new URL(url).pathname.replace(/^\//, "");
if (!dbName.endsWith("_test")) {
  throw new Error(`Refusing to run: database "${dbName}" does not end with _test.`);
}

// Replace Cognito auth: the caller is identified by the x-test-user-id header.
vi.mock("../src/middleware/auth.js", async () => {
  const { prisma } = await import("../src/prisma.js");
  const { HttpError } = await import("../src/middleware/errorHandler.js");
  return {
    requireAuth: async (req: any, _res: any, next: any) => {
      const header = req.headers["x-test-user-id"];
      if (!header) throw new HttpError(401, "Missing test user");
      const user = await prisma.user.findUnique({ where: { id: Number(header) } });
      if (!user) throw new HttpError(401, "Unknown test user");
      req.user = user;
      next();
    },
  };
});

const { prisma } = await import("../src/prisma.js");

beforeEach(async () => {
  await prisma.expense.deleteMany();
  await prisma.recurringRule.deleteMany();
  await prisma.invite.deleteMany();
  await prisma.householdMember.deleteMany();
  await prisma.category.deleteMany({ where: { householdId: { not: null } } });
  await prisma.household.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});
