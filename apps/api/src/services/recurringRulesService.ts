import { assertActivePayer, assertUsableCategory, assertNotFutureDate, todayInTimeZone } from "./expensesService.js";
import { lockHousehold } from "./householdsService.js";
import { Currency, Frequency, Prisma, Role } from "../../generated/prisma/client.js";
import { HttpError } from "../middleware/errorHandler.js";
import { prisma } from "../prisma.js";

export const MAX_RULES_PER_HOUSEHOLD = 20;
export const MAX_OCCURRENCES_PER_RULE = 600;
export const NEARING_LIMIT_AT = 540;

export type RuleUpdate = {
  name?: string;
  amount?: number;
  currency?: Currency;
  frequency?: Frequency;
  startDate?: Date;
  endDate?: Date | null;
  paidById?: number;
  categoryId?: number;
};

export const ruleSelect = {
  id: true, name: true, amount: true, currency: true, frequency: true, startDate: true, endDate: true, nextOccurrence: true,
  paidById: true, createdById: true, categoryId: true, _count: { select: { expenses: true } },
} as const;

type RuleRow = Prisma.RecurringRuleGetPayload<{ select: typeof ruleSelect }>;

const formatDate = (date: Date) => date.toISOString().slice(0, 10);

// explicit fields only: never householdId, createdAt or updatedAt
export function toRuleResponse(rule: RuleRow) {
  const expenseCount = rule._count.expenses;
  return {
    id: rule.id,
    name: rule.name,
    amount: rule.amount,
    currency: rule.currency,
    frequency: rule.frequency,
    startDate: formatDate(rule.startDate),
    endDate: rule.endDate === null ? null : formatDate(rule.endDate),
    nextOccurrence: rule.nextOccurrence === null ? null : formatDate(rule.nextOccurrence),
    paidById: rule.paidById,
    createdById: rule.createdById,
    categoryId: rule.categoryId,
    expenseCount,
    nearingLimit: rule.endDate === null && expenseCount >= NEARING_LIMIT_AT,
  };
}

// today in the household's time zone, as a UTC-midnight Date (the form @db.Date columns use)
function todayDate(timeZone: string): Date {
  return new Date(`${todayInTimeZone(timeZone)}T00:00:00Z`);
}

// monthly and yearly occurrences are clamped against the anchor day (startDate's day), never against
// the previous occurrence, so Jan 31 -> Feb 28 -> Mar 31. Shared by the generator and the calendar projections
export function nextOccurrenceAfter(current: Date, frequency: Frequency, anchorDay: number): Date {
  const y = current.getUTCFullYear();
  const m = current.getUTCMonth();
  const d = current.getUTCDate();

  switch (frequency) {
    case "DAILY":    return new Date(Date.UTC(y, m, d + 1));
    case "WEEKLY":   return new Date(Date.UTC(y, m, d + 7));
    case "BIWEEKLY": return new Date(Date.UTC(y, m, d + 14));
    case "MONTHLY": {
      const last = new Date(Date.UTC(y, m + 2, 0)).getUTCDate(); // last day of next month
      return new Date(Date.UTC(y, m + 1, Math.min(anchorDay, last)));
    }
    case "YEARLY": {
      const last = new Date(Date.UTC(y + 1, m + 1, 0)).getUTCDate();
      return new Date(Date.UTC(y + 1, m, Math.min(anchorDay, last)));
    }
  }
}

// 400 if the schedule from startDate up to `until` (endDate, or today for an open-ended rule) has more than 600 occurrences
function assertWithinOccurrenceCap(startDate: Date, frequency: Frequency, until: Date) {
  const anchorDay = startDate.getUTCDate();
  let count = 0;
  for (let d = startDate; d <= until; d = nextOccurrenceAfter(d, frequency, anchorDay)) {
    count += 1;
    if (count > MAX_OCCURRENCES_PER_RULE)
      throw new HttpError(400, "Rule would create too many expenses");
  }
}

// locks the rule row until the transaction ends (edit, delete and the generator all take this lock);
// returns false if the rule isn't in this household
async function lockRule(ruleId: number, householdId: number, tx: Prisma.TransactionClient): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: number }[]>`SELECT "id" FROM "RecurringRule" WHERE "id" = ${ruleId} AND "householdId" = ${householdId} FOR UPDATE`;
  return rows.length === 1;
}

// inserts the rule's occurrences from nextOccurrence up to today (and endDate), then advances nextOccurrence;
// an open-ended rule that reaches 600 expenses is ended at its last expense's date. Idempotent.
async function generateForRule(ruleId: number, householdId: number, today: Date, tx: Prisma.TransactionClient) {
  if (!(await lockRule(ruleId, householdId, tx)))
    return; // deleted meanwhile
  // read after taking the lock, so a concurrent run that already advanced the rule is seen
  const rule = await tx.recurringRule.findUniqueOrThrow({ where: { id: ruleId } });
  if (rule.nextOccurrence === null || rule.nextOccurrence > today)
    return;

  const existing = await tx.expense.count({ where: { householdId, recurringRuleId: ruleId } });
  const room = rule.endDate === null ? MAX_OCCURRENCES_PER_RULE - existing : Infinity;
  const anchorDay = rule.startDate.getUTCDate();
  const dates: Date[] = [];
  let next: Date = rule.nextOccurrence;
  while (next <= today && (rule.endDate === null || next <= rule.endDate) && dates.length < room) {
    dates.push(next);
    next = nextOccurrenceAfter(next, rule.frequency, anchorDay);
  }

  await tx.expense.createMany({
    data: dates.map((date) => ({
      householdId, recurringRuleId: ruleId, date, name: rule.name, amount: rule.amount, currency: rule.currency,
      categoryId: rule.categoryId, paidById: rule.paidById, createdById: rule.createdById,
    })),
    skipDuplicates: true,
  });

  if (rule.endDate === null && existing + dates.length >= MAX_OCCURRENCES_PER_RULE) {
    const last = dates.at(-1) ?? (await tx.expense.aggregate({ where: { householdId, recurringRuleId: ruleId }, _max: { date: true } }))._max.date;
    await tx.recurringRule.update({ where: { id: ruleId }, data: { endDate: last ?? rule.startDate, nextOccurrence: null } });
    return;
  }
  const exhausted = rule.endDate !== null && next > rule.endDate;
  await tx.recurringRule.update({ where: { id: ruleId }, data: { nextOccurrence: exhausted ? null : next } });
}

// lazy catch-up: creates every due expense of the household's rules up to today (household time zone).
// Called before every read of rules or expenses; one transaction per due rule.
export async function generateDueExpenses(householdId: number) {
  const household = await prisma.household.findUnique({ where: { id: householdId }, select: { timeZone: true } });
  if (household === null)
    return;
  const today = todayDate(household.timeZone);
  const due = await prisma.recurringRule.findMany({
    where: { householdId, nextOccurrence: { lte: today } },
    select: { id: true },
  });
  for (const { id } of due)
    await prisma.$transaction((tx) => generateForRule(id, householdId, today, tx));
}

async function ruleResponse(ruleId: number, tx: Prisma.TransactionClient) {
  return toRuleResponse(await tx.recurringRule.findUniqueOrThrow({ where: { id: ruleId }, select: ruleSelect }));
}

async function householdToday(householdId: number, tx: Prisma.TransactionClient) {
  const household = await tx.household.findUniqueOrThrow({ where: { id: householdId }, select: { timeZone: true } });
  return { timeZone: household.timeZone, today: todayDate(household.timeZone) };
}

export async function createRule(createdById: number, householdId: number, name: string, startDate: Date, endDate: Date | undefined, amount: number,
                                currency: Currency, paidById: number, categoryId: number, frequency: Frequency) {
  await generateDueExpenses(householdId);
  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await lockHousehold(householdId, tx)))
        throw new HttpError(404, "Household not found");
      const count = await tx.recurringRule.count({ where: { householdId } });
      if (count >= MAX_RULES_PER_HOUSEHOLD)
        throw new HttpError(409, "Rule limit reached");

      await assertUsableCategory(categoryId, householdId);
      await assertActivePayer(paidById, householdId);

      const { timeZone, today } = await householdToday(householdId, tx);
      assertNotFutureDate(startDate, timeZone);
      assertWithinOccurrenceCap(startDate, frequency, endDate ?? today);

      const rule = await tx.recurringRule.create({
        data: { householdId, name, amount, currency, frequency, startDate, endDate, nextOccurrence: startDate, paidById, categoryId, createdById },
        select: { id: true },
      });
      await generateForRule(rule.id, householdId, today, tx);
      return ruleResponse(rule.id, tx);
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003")
      throw new HttpError(400, "Invalid category");
    throw err;
  }
}

// all the household's rules, ended ones included unless activeOnly (nextOccurrence not null), newest first
export async function listRules(householdId: number, activeOnly: boolean) {
  await generateDueExpenses(householdId);
  const rules = await prisma.recurringRule.findMany({
    where: { householdId, ...(activeOnly ? { nextOccurrence: { not: null } } : {}) },
    select: ruleSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rules.map(toRuleResponse);
}

export async function getRule(ruleId: number, householdId: number) {
  await generateDueExpenses(householdId);
  const rule = await prisma.recurringRule.findUnique({ where: { id: ruleId, householdId }, select: ruleSelect });
  if (rule === null)
    throw new HttpError(404, "Rule not found");
  return toRuleResponse(rule);
}

// locks and loads the rule for an edit or delete: 404 if it isn't in this household,
// 403 unless the caller is its payer, its creator or an owner
async function ruleToChange(ruleId: number, householdId: number, userId: number, role: Role, tx: Prisma.TransactionClient) {
  if (!(await lockRule(ruleId, householdId, tx)))
    throw new HttpError(404, "Rule not found");
  const rule = await tx.recurringRule.findUniqueOrThrow({ where: { id: ruleId } });
  if (role !== "OWNER" && rule.paidById !== userId && rule.createdById !== userId)
    throw new HttpError(403, "Only the payer, the creator or an owner can change this rule");
  return rule;
}

export async function updateRule(ruleId: number, householdId: number, userId: number, role: Role, dataToUpdate: RuleUpdate) {
  await generateDueExpenses(householdId);
  try {
    return await prisma.$transaction(async (tx) => {
      // nothing here needs the household row, so only the rule is locked
      const rule = await ruleToChange(ruleId, householdId, userId, role, tx);

      const payerChanged = dataToUpdate.paidById !== undefined && dataToUpdate.paidById !== rule.paidById;
      if (payerChanged && role !== "OWNER" && rule.createdById !== userId)
        throw new HttpError(403, "Only the creator or an owner can change the payer");

      // same order as expenses: category first, then payer; unchanged ones are never rechecked
      if (dataToUpdate.categoryId !== undefined && dataToUpdate.categoryId !== rule.categoryId)
        await assertUsableCategory(dataToUpdate.categoryId, householdId);
      if (payerChanged)
        await assertActivePayer(dataToUpdate.paidById!, householdId);

      const { timeZone, today } = await householdToday(householdId, tx);
      if (dataToUpdate.startDate !== undefined)
        assertNotFutureDate(dataToUpdate.startDate, timeZone);

      const startDate = dataToUpdate.startDate ?? rule.startDate;
      const frequency = dataToUpdate.frequency ?? rule.frequency;
      const endDate = dataToUpdate.endDate === undefined ? rule.endDate : dataToUpdate.endDate;
      if (endDate !== null && endDate < startDate)
        throw new HttpError(400, "End date must be on or after start date");
      assertWithinOccurrenceCap(startDate, frequency, endDate ?? today);

      const scheduleChanged = startDate.getTime() !== rule.startDate.getTime() || frequency !== rule.frequency;
      const endChanged = (endDate?.getTime() ?? null) !== (rule.endDate?.getTime() ?? null);
      const scope = { householdId, recurringRuleId: ruleId };

      let nextOccurrence = rule.nextOccurrence;
      if (scheduleChanged) {
        // rebuilt from scratch below (per-expense descriptions are lost; the app warns first)
        await tx.expense.deleteMany({ where: scope });
        nextOccurrence = startDate;
      } else if (endChanged) {
        if (endDate !== null)
          await tx.expense.deleteMany({ where: { ...scope, date: { gt: endDate } } });
        // the first occurrence after the last remaining expense, or null once the schedule is exhausted
        const last = (await tx.expense.aggregate({ where: scope, _max: { date: true } }))._max.date;
        let next = startDate;
        while (last !== null && next <= last)
          next = nextOccurrenceAfter(next, frequency, startDate.getUTCDate());
        nextOccurrence = endDate !== null && next > endDate ? null : next;
      }

      const { name, amount, currency, categoryId, paidById } = dataToUpdate;
      await tx.recurringRule.update({
        where: { id: ruleId },
        data: { name, amount, currency, categoryId, paidById, frequency, startDate, endDate, nextOccurrence },
      });
      // the rule's fields apply to all its expenses, past ones included
      if (!scheduleChanged && [name, amount, currency, categoryId, paidById].some((v) => v !== undefined))
        await tx.expense.updateMany({ where: scope, data: { name, amount, currency, categoryId, paidById } });

      await generateForRule(ruleId, householdId, today, tx);
      return ruleResponse(ruleId, tx);
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003")
      throw new HttpError(400, "Invalid category");
    throw err;
  }
}

// deleteExpenses: also delete the rule's expenses; otherwise they lose the link (onDelete SetNull) and become normal expenses
export async function deleteRule(ruleId: number, householdId: number, userId: number, role: Role, deleteExpenses: boolean) {
  return prisma.$transaction(async (tx) => {
    await ruleToChange(ruleId, householdId, userId, role, tx);
    if (deleteExpenses)
      await tx.expense.deleteMany({ where: { householdId, recurringRuleId: ruleId } });
    await tx.recurringRule.delete({ where: { id: ruleId, householdId } });
  });
}
