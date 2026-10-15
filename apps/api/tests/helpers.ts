import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/prisma.js";
import type { Role } from "../generated/prisma/client.js";

export { prisma };

let seq = 0;

export async function createUser(name = "User") {
  seq += 1;
  const tag = `${Date.now()}-${seq}`;
  return prisma.user.create({
    data: { cognitoId: `cognito-${tag}`, email: `user-${tag}@example.com`, name },
  });
}

export async function createHousehold(name = "Home", owner?: { id: number }) {
  return prisma.household.create({
    data: {
      name,
      defaultCurrency: "USD",
      timeZone: "UTC",
      ...(owner ? { members: { create: { userId: owner.id, role: "OWNER" } } } : {}),
    },
  });
}

export async function addMember(
  householdId: number,
  userId: number,
  role: Role = "MEMBER",
  extra: { joinedAt?: Date; leftAt?: Date | null } = {},
) {
  return prisma.householdMember.create({ data: { householdId, userId, role, ...extra } });
}

// Adds a custom category, an expense, a recurring rule and an invite to the household.
export async function addHouseholdData(householdId: number, userId: number) {
  const category = await prisma.category.create({ data: { householdId, name: `Cat ${householdId}` } });
  const rule = await prisma.recurringRule.create({
    data: {
      name: "Rent",
      amount: 100000,
      currency: "USD",
      frequency: "MONTHLY",
      startDate: new Date("2026-01-01"),
      householdId,
      paidById: userId,
      createdById: userId,
      categoryId: category.id,
    },
  });
  await prisma.expense.create({
    data: {
      name: "Rent",
      amount: 1234,
      currency: "USD",
      date: new Date("2026-02-01"),
      categoryId: category.id,
      paidById: userId,
      createdById: userId,
      householdId,
      recurringRuleId: rule.id,
    },
  });
  await prisma.expense.create({
    data: {
      name: "Snacks",
      amount: 500,
      currency: "USD",
      date: new Date("2026-02-02"),
      categoryId: category.id,
      paidById: userId,
      createdById: userId,
      householdId,
    },
  });
  await prisma.invite.create({
    data: { householdId, tokenHash: `hash-${householdId}-${Date.now()}`, expiresAt: new Date(Date.now() + 7 * 864e5) },
  });
}

export async function countHouseholdData(householdId: number) {
  const [households, members, expenses, rules, categories, invites] = await Promise.all([
    prisma.household.count({ where: { id: householdId } }),
    prisma.householdMember.count({ where: { householdId } }),
    prisma.expense.count({ where: { householdId } }),
    prisma.recurringRule.count({ where: { householdId } }),
    prisma.category.count({ where: { householdId } }),
    prisma.invite.count({ where: { householdId } }),
  ]);
  return { households, members, expenses, rules, categories, invites };
}

// Supertest agent authenticated as the given user (via the mocked auth middleware).
export function as(user: { id: number }) {
  const h = (r: request.Test) => r.set("x-test-user-id", String(user.id));
  return {
    get: (path: string) => h(request(app).get(path)),
    post: (path: string) => h(request(app).post(path)),
    patch: (path: string) => h(request(app).patch(path)),
    delete: (path: string) => h(request(app).delete(path)),
  };
}

export const anon = () => request(app);

// Ids that are not plain positive integers up to 2147483647 (encode before putting them in a path).
export const INVALID_IDS = ["abc", "0", "-1", "007", "0001", "1.5", "1e3", "0x10", " 5 ", "99999999999999999999", "2147483648"];
export const MAX_ID = 2147483647;

// `allow` names fields a route returns on purpose (the members list returns joinedAt, for the app's "Joined" date)
export function expectNoSensitiveFields(body: unknown, allow: string[] = []) {
  const json = JSON.stringify(body);
  const fields = ["email", "cognitoId", "leftAt", "joinedAt", "createdAt"].filter((f) => !allow.includes(f));
  if (new RegExp(fields.map((f) => `"${f}"`).join("|")).test(json)) {
    throw new Error(`Response contains a sensitive or internal field: ${json}`);
  }
}
