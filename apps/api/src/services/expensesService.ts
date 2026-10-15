import { Currency, Prisma, Role } from "../../generated/prisma/client.js";
import { HttpError } from "../middleware/errorHandler.js";
import { prisma } from "../prisma.js";
import { encodeExpenseCursor, type ExpenseCursor } from "../lib/cursor.js";
import { generateDueExpenses } from "./recurringRulesService.js";

export type ExpenseUpdate = {
  name?: string;
  amount?: number;
  currency?: Currency;
  date?: Date;
  categoryId?: number;
  paidById?: number;
  description?: string | null;
};

export type ExpenseFilters = {
  from?: Date;
  to?: Date;
  categoryId?: number;
  paidById?: number;
  limit: number;
  cursor?: ExpenseCursor;
};

export const expenseSelect = {
  id: true, name: true, amount: true, currency: true, date: true, categoryId: true, paidById: true, createdById: true, description: true, recurringRuleId: true,
} as const;

type ExpenseRow = Prisma.ExpenseGetPayload<{ select: typeof expenseSelect }>;

export function toExpenseResponse(expense: ExpenseRow) {
  const { recurringRuleId, date, ...rest } = expense;
  return {
    ...rest,
    date: date.toISOString().slice(0, 10),
    isRecurring: recurringRuleId !== null,
  };
}

// today's date (YYYY-MM-DD) in the household's time zone, not the server's
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// expenses can only be dated today or earlier; date is a UTC-midnight Date from validDate
export function assertNotFutureDate(date: Date, timeZone: string) {
  if (date.toISOString().slice(0, 10) > todayInTimeZone(timeZone))
    throw new HttpError(400, "Date can't be in the future");
}

// the payer must be an active member of the household
export async function assertActivePayer(userId: number, householdId: number) {
  const member = await prisma.householdMember.findUnique({
    where: { userId_householdId: { userId, householdId }, leftAt: null },
    select: { userId: true },
  });
  if (member === null)
    throw new HttpError(400, "Invalid payer id");
}

// the category must be built-in or the household's, and not archived
export async function assertUsableCategory(categoryId: number, householdId: number) {
  const category = await prisma.category.findUnique({
    where: { id: categoryId, isArchived: false, OR: [{ householdId }, { householdId: null }] },
    select: { id: true },
  });
  if (category === null)
    throw new HttpError(400, "Invalid category");
}

export async function createExpense(
    householdId: number, name: string, amount: number, currency: Currency, date: Date,
    categoryId: number, paidById: number, description: string | undefined, createdById: number){
        await assertUsableCategory(categoryId, householdId);
        await assertActivePayer(paidById, householdId);

        const household = await prisma.household.findUnique({
            where: {id: householdId},
            select: { timeZone: true }
        })
        assertNotFutureDate(date, household!.timeZone);
        try{
            const expense = await prisma.expense.create({
                data: { householdId, name, amount, currency, date, categoryId, paidById, description, createdById},
                select: expenseSelect
            })
            return toExpenseResponse(expense);
        }catch (err){
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003")
            throw new HttpError(400, "Invalid category");
            throw err;
        }
}


// newest first (date, then id), keyset pagination on (date, id);
// totalCount ignores the cursor, so it is the same on every page; due recurring expenses are created first
export async function listExpenses(householdId: number, filters: ExpenseFilters) {
  await generateDueExpenses(householdId);
  const { from, to, categoryId, paidById, limit, cursor } = filters;
  const where: Prisma.ExpenseWhereInput = {
    householdId,
    ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(categoryId !== undefined ? { categoryId } : {}),
    ...(paidById !== undefined ? { paidById } : {}),
  };
  const [rows, totalCount] = await Promise.all([
    prisma.expense.findMany({
      where: { ...where, ...(cursor ? { OR: [{ date: { lt: cursor.date } }, { date: cursor.date, id: { lt: cursor.id } }] } : {}) },
      select: expenseSelect,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: limit + 1,
    }),
    prisma.expense.count({ where }),
  ]);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map(toExpenseResponse),
    nextCursor: hasMore ? encodeExpenseCursor(last.date, last.id, { householdId, from, to, categoryId, paidById }) : null,
    totalCount,
  };
}

export async function getExpense(expenseId: number, householdId: number) {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId, householdId },
    select: expenseSelect,
  });
  if (expense === null)
    throw new HttpError(404, "Expense not found");
  return toExpenseResponse(expense);
}

// loads the expense for an update or delete: 404 if it isn't in this household,
// 403 unless the caller is its current payer, its creator or an owner
async function expenseToChange(expenseId: number, householdId: number, userId: number, role: Role) {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId, householdId },
    select: { paidById: true, createdById: true, categoryId: true, recurringRuleId: true },
  });
  if (expense === null)
    throw new HttpError(404, "Expense not found");
  if (role !== "OWNER" && expense.paidById !== userId && expense.createdById !== userId)
    throw new HttpError(403, "Only the payer, the creator or an owner can change this expense");
  return expense;
}

export async function updateExpense(expenseId: number, householdId: number, userId: number, role: Role, dataToUpdate: ExpenseUpdate) {
  const expense = await expenseToChange(expenseId, householdId, userId, role);

  if (expense.recurringRuleId !== null) {
    // the rule owns everything else; changing it on the rule changes all its expenses
    const { name, amount, currency, date, categoryId, paidById } = dataToUpdate;
    if ([name, amount, currency, date, categoryId, paidById].some((v) => v !== undefined))
      throw new HttpError(409, "Only the description can be changed on a recurring expense");
  }

  // same order as createExpense: category first, then payer
  // an unchanged category is never rechecked, so an expense can keep a category archived since
  if (dataToUpdate.categoryId !== undefined && dataToUpdate.categoryId !== expense.categoryId)
    await assertUsableCategory(dataToUpdate.categoryId, householdId);

  // an unchanged payer is never rechecked, so an expense can keep a payer who left
  if (dataToUpdate.paidById !== undefined && dataToUpdate.paidById !== expense.paidById)
    await assertActivePayer(dataToUpdate.paidById, householdId);

  if (dataToUpdate.date !== undefined) {
    const household = await prisma.household.findUnique({
      where: { id: householdId },
      select: { timeZone: true },
    });
    assertNotFutureDate(dataToUpdate.date, household!.timeZone);
  }

  try {
    const updated = await prisma.expense.update({
      where: { id: expenseId, householdId },
      data: dataToUpdate,
      select: expenseSelect,
    });
    return toExpenseResponse(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2003")
        throw new HttpError(400, "Invalid category");
      if (err.code === "P2025")
        throw new HttpError(404, "Expense not found");
    }
    throw err;
  }
}

export async function deleteExpense(expenseId: number, householdId: number, userId: number, role: Role) {
  const expense = await expenseToChange(expenseId, householdId, userId, role);
  if (expense.recurringRuleId !== null)
    throw new HttpError(409, "Recurring expenses can't be deleted; end the rule instead");
  try {
    return await prisma.expense.delete({ where: { id: expenseId, householdId }, select: { id: true } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")
      throw new HttpError(404, "Expense not found");
    throw err;
  }
}
