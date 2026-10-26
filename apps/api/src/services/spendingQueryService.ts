import { prisma } from "../prisma.js";
import { Prisma, type Currency, type Frequency } from "../../generated/prisma/client.js";
import { todayInTimeZone } from "./expensesService.js";
import { formatMoney } from "../lib/money.js";

// The Ask AI query functions. Each one answers one kind of spending question for one household, always scoped by the
// household id from the caller's membership (never from the model). Sums, counts and ranking happen in the database;
// every result has one entry per currency (amounts are never added across currencies), raw minor units next to a
// formatted string, and names instead of ids. Arguments arrive already validated (askService's dispatcher).

// most rows a result lists; grouped results list the top GROUP_ROWS per currency and fold the rest into one "other" row
export const MAX_ROWS = 25;
export const GROUP_ROWS = 20;
export const TOP_CATEGORIES = 5;

export type SpendingFilter = {
  from?: string; // YYYY-MM-DD, inclusive
  to?: string; // YYYY-MM-DD, inclusive
  categoryId?: number;
  paidById?: number;
  nameContains?: string; // case-insensitive substring of the expense name, no wildcards
  currency?: Currency;
};

export type HouseholdFacts = {
  name: string;
  timeZone: string;
  defaultCurrency: Currency;
  today: string; // YYYY-MM-DD in the household's time zone
  categories: { id: number; name: string; isArchived: boolean }[];
  members: { id: number; name: string; isActive: boolean; isYou: boolean }[];
};

export type QueryContext = {
  householdId: number;
  today: string;
  defaultCurrency: Currency;
  categoryNames: Map<number, string>;
  memberNames: Map<number, string>;
};

// What the model is told about the household (and what tool arguments are checked against): built-in and household
// categories, archived ones included, and every member row, former members included.
export async function loadHouseholdFacts(householdId: number, callerId: number): Promise<HouseholdFacts> {
  const [household, categories, members] = await Promise.all([
    prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { name: true, timeZone: true, defaultCurrency: true } }),
    prisma.category.findMany({
      where: { OR: [{ householdId: null }, { householdId }] },
      select: { id: true, name: true, isArchived: true },
      orderBy: { id: "asc" },
    }),
    prisma.householdMember.findMany({
      where: { householdId },
      select: { userId: true, leftAt: true, user: { select: { name: true } } },
      orderBy: { joinedAt: "asc" },
    }),
  ]);
  return {
    ...household,
    today: todayInTimeZone(household.timeZone),
    categories,
    members: members.map((m) => ({ id: m.userId, name: m.user.name, isActive: m.leftAt === null, isYou: m.userId === callerId })),
  };
}

export function toQueryContext(householdId: number, facts: HouseholdFacts): QueryContext {
  return {
    householdId,
    today: facts.today,
    defaultCurrency: facts.defaultCurrency,
    categoryNames: new Map(facts.categories.map((c) => [c.id, c.name])),
    memberNames: new Map(facts.members.map((m) => [m.id, m.isActive ? m.name : `${m.name} (former member)`])),
  };
}

const categoryName = (ctx: QueryContext, id: number) => ctx.categoryNames.get(id) ?? "Unknown category";
const memberName = (ctx: QueryContext, id: number) => ctx.memberNames.get(id) ?? "Unknown member";
const money = (amount: number, currency: string) => ({ amount, formatted: formatMoney(amount, currency) });

// the default currency first, then the others alphabetically (the summary's order)
function byCurrency<T extends { currency: string }>(ctx: QueryContext, items: T[]): T[] {
  return [...items].sort((a, b) =>
    a.currency === b.currency ? 0
    : a.currency === ctx.defaultCurrency ? -1
    : b.currency === ctx.defaultCurrency ? 1
    : a.currency.localeCompare(b.currency));
}

// the filter as the model should read it back: names, not ids, and only what was set
function describeFilter(ctx: QueryContext, f: SpendingFilter) {
  return {
    ...(f.from !== undefined && { from: f.from }),
    ...(f.to !== undefined && { to: f.to }),
    ...(f.categoryId !== undefined && { category: categoryName(ctx, f.categoryId) }),
    ...(f.paidById !== undefined && { paidBy: memberName(ctx, f.paidById) }),
    ...(f.nameContains !== undefined && { nameContains: f.nameContains }),
    ...(f.currency !== undefined && { currency: f.currency }),
  };
}

// Dates go in as YYYY-MM-DD text cast to date (never a JS Date, which would be compared as a timestamp in the session's
// time zone). nameContains uses position(), so % and _ in the search text are plain characters, not LIKE wildcards.
function whereSql(ctx: QueryContext, f: SpendingFilter): Prisma.Sql {
  const parts = [Prisma.sql`"householdId" = ${ctx.householdId}`];
  if (f.from !== undefined) parts.push(Prisma.sql`"date" >= ${f.from}::date`);
  if (f.to !== undefined) parts.push(Prisma.sql`"date" <= ${f.to}::date`);
  if (f.categoryId !== undefined) parts.push(Prisma.sql`"categoryId" = ${f.categoryId}`);
  if (f.paidById !== undefined) parts.push(Prisma.sql`"paidById" = ${f.paidById}`);
  if (f.nameContains !== undefined) parts.push(Prisma.sql`position(lower(${f.nameContains}::text) in lower("name")) > 0`);
  if (f.currency !== undefined) parts.push(Prisma.sql`"currency" = ${f.currency}::"Currency"`);
  return Prisma.join(parts, " AND ");
}

export type GroupBy = "category" | "payer" | "name" | "none";

type GroupRow = { currency: string; key: string | null; label: string | null; total: number; count: number; groups: number; other: boolean };

// Totals per currency and group, ranked in the database: the top `top` groups of each currency, plus one row per
// currency adding up all the others. Names group case-insensitively (labelled with one of their spellings).
async function groupedTotals(ctx: QueryContext, f: SpendingFilter, by: Exclude<GroupBy, "none">, top: number) {
  const key = by === "category" ? Prisma.sql`"categoryId"::text` : by === "payer" ? Prisma.sql`"paidById"::text` : Prisma.sql`lower("name")`;
  const label = by === "name" ? Prisma.sql`MIN("name")` : Prisma.sql`NULL::text`;
  const rows = await prisma.$queryRaw<GroupRow[]>`
    WITH g AS (
      SELECT "currency"::text AS currency, ${key} AS key, ${label} AS label, SUM("amount")::float8 AS total, COUNT(*)::int AS count
      FROM "Expense" WHERE ${whereSql(ctx, f)} GROUP BY 1, 2
    ), r AS (
      SELECT g.*, (ROW_NUMBER() OVER (PARTITION BY currency ORDER BY total DESC, key))::int AS rn FROM g
    )
    SELECT currency, key, label, total, count, 1 AS groups, false AS other FROM r WHERE rn <= ${top}
    UNION ALL
    SELECT currency, NULL, NULL, SUM(total)::float8, SUM(count)::int, COUNT(*)::int, true FROM r WHERE rn > ${top} GROUP BY currency`;

  const nameOf = (row: GroupRow) =>
    by === "category" ? categoryName(ctx, Number(row.key)) : by === "payer" ? memberName(ctx, Number(row.key)) : row.label ?? "";
  const currencies = [...new Set(rows.map((r) => r.currency))].map((currency) => {
    const own = rows.filter((r) => r.currency === currency);
    const ranked = own.filter((r) => !r.other).sort((a, b) => b.total - a.total);
    const other = own.find((r) => r.other);
    const total = own.reduce((sum, r) => sum + r.total, 0);
    return {
      currency,
      total: money(total, currency),
      count: own.reduce((sum, r) => sum + r.count, 0),
      groups: [
        ...ranked.map((r) => ({ name: nameOf(r), total: money(r.total, currency), count: r.count })),
        ...(other ? [{ name: `Other (${other.groups} more)`, total: money(other.total, currency), count: other.count, isOther: true }] : []),
      ],
      truncated: other !== undefined,
    };
  });
  return byCurrency(ctx, currencies);
}

// 1. How much, and how many expenses, per currency; optionally split by category, payer or expense name.
export async function totalSpending(ctx: QueryContext, f: SpendingFilter, groupBy: GroupBy = "none") {
  if (groupBy !== "none") {
    const currencies = await groupedTotals(ctx, f, groupBy, GROUP_ROWS);
    return { filter: describeFilter(ctx, f), groupBy, noData: currencies.length === 0, currencies };
  }
  const rows = await prisma.$queryRaw<{ currency: string; total: number; count: number }[]>`
    SELECT "currency"::text AS currency, SUM("amount")::float8 AS total, COUNT(*)::int AS count
    FROM "Expense" WHERE ${whereSql(ctx, f)} GROUP BY 1`;
  const currencies = byCurrency(ctx, rows).map((r) => ({ currency: r.currency, total: money(r.total, r.currency), count: r.count }));
  return { filter: describeFilter(ctx, f), groupBy, noData: currencies.length === 0, currencies };
}

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

// 2. The average per month. With from and/or to it averages over every month of that window, empty months counting as 0
// (a missing to is today, a missing from is the first matching expense); without either, over the months that have a
// matching expense. `basis` says which.
export async function averageMonthlySpending(ctx: QueryContext, f: SpendingFilter) {
  const currentMonth = ctx.today.slice(0, 7);
  if (f.from === undefined && f.to === undefined) {
    const rows = await prisma.$queryRaw<{ currency: string; total: number; count: number; months: number }[]>`
      SELECT "currency"::text AS currency, SUM("amount")::float8 AS total, COUNT(*)::int AS count,
             COUNT(DISTINCT date_trunc('month', "date"))::int AS months
      FROM "Expense" WHERE ${whereSql(ctx, f)} GROUP BY 1`;
    const currencies = byCurrency(ctx, rows).map((r) => ({
      currency: r.currency,
      monthlyAverage: money(Math.round(r.total / r.months), r.currency),
      total: money(r.total, r.currency),
      months: r.months,
      count: r.count,
    }));
    return { filter: describeFilter(ctx, f), basis: "months_with_data" as const, noData: currencies.length === 0, currencies };
  }

  const to = f.to ?? ctx.today;
  let from = f.from;
  if (from === undefined) {
    const [first] = await prisma.$queryRaw<{ first: string | null }[]>`
      SELECT to_char(MIN("date"), 'YYYY-MM-DD') AS first FROM "Expense" WHERE ${whereSql(ctx, { ...f, to })}`;
    from = first?.first ?? to;
  }
  const window = { ...f, from, to };
  const months = Math.max(1, monthIndex(to) - monthIndex(from) + 1);
  const rows = await prisma.$queryRaw<{ currency: string; total: number; count: number }[]>`
    SELECT "currency"::text AS currency, SUM("amount")::float8 AS total, COUNT(*)::int AS count
    FROM "Expense" WHERE ${whereSql(ctx, window)} GROUP BY 1`;
  const currencies = byCurrency(ctx, rows).map((r) => ({
    currency: r.currency,
    monthlyAverage: money(Math.round(r.total / months), r.currency),
    total: money(r.total, r.currency),
    count: r.count,
  }));
  return {
    filter: describeFilter(ctx, window),
    basis: "window" as const,
    window: { fromMonth: from.slice(0, 7), toMonth: to.slice(0, 7), months },
    // the current month isn't over yet, so it pulls the average down
    includesCurrentMonth: from.slice(0, 7) <= currentMonth && to.slice(0, 7) >= currentMonth,
    noData: currencies.length === 0,
    currencies,
  };
}

type ExpenseRow = { name: string; amount: number; currency: string; date: string; categoryId: number; paidById: number; isRecurring: boolean };

const expenseOut = (ctx: QueryContext, r: ExpenseRow) => ({
  name: r.name,
  amount: money(r.amount, r.currency),
  date: r.date,
  category: categoryName(ctx, r.categoryId),
  paidBy: memberName(ctx, r.paidById),
  isRecurring: r.isRecurring,
});

// 3. The most expensive expenses, the top `limit` (1 to 25) of each currency, at most 25 rows in all.
export async function topExpenses(ctx: QueryContext, f: SpendingFilter, limit = 5) {
  const rows = await prisma.$queryRaw<(ExpenseRow & { rn: number })[]>`
    WITH r AS (
      SELECT "name", "amount", "currency"::text AS currency, to_char("date", 'YYYY-MM-DD') AS date, "categoryId", "paidById",
             ("recurringRuleId" IS NOT NULL) AS "isRecurring",
             (ROW_NUMBER() OVER (PARTITION BY "currency" ORDER BY "amount" DESC, "date" DESC, "id" DESC))::int AS rn
      FROM "Expense" WHERE ${whereSql(ctx, f)}
    )
    SELECT * FROM r WHERE rn <= ${limit}
    ORDER BY (currency = ${ctx.defaultCurrency}::text) DESC, currency, rn
    LIMIT ${MAX_ROWS + 1}`;
  const kept = rows.slice(0, MAX_ROWS);
  const currencies = [...new Set(kept.map((r) => r.currency))].map((currency) => ({
    currency,
    expenses: kept.filter((r) => r.currency === currency).map((r) => ({ rank: r.rn, ...expenseOut(ctx, r) })),
  }));
  return { filter: describeFilter(ctx, f), noData: currencies.length === 0, truncated: rows.length > MAX_ROWS, currencies };
}

// 4. Categories ranked by total, the top 5 of each currency plus an "other" row.
export async function topCategory(ctx: QueryContext, f: SpendingFilter) {
  const currencies = await groupedTotals(ctx, f, "category", TOP_CATEGORIES);
  return { filter: describeFilter(ctx, f), noData: currencies.length === 0, currencies };
}

// 5. The month with the highest total per currency, and the runner-up.
export async function peakMonth(ctx: QueryContext, f: SpendingFilter) {
  const rows = await prisma.$queryRaw<{ currency: string; month: string; total: number; count: number; rn: number; months: number }[]>`
    WITH m AS (
      SELECT "currency"::text AS currency, to_char("date", 'YYYY-MM') AS month, SUM("amount")::float8 AS total, COUNT(*)::int AS count
      FROM "Expense" WHERE ${whereSql(ctx, f)} GROUP BY 1, 2
    ), r AS (
      SELECT m.*, (ROW_NUMBER() OVER (PARTITION BY currency ORDER BY total DESC, month DESC))::int AS rn,
             (COUNT(*) OVER (PARTITION BY currency))::int AS months
      FROM m
    )
    SELECT * FROM r WHERE rn <= 2`;
  const month = (r: { month: string; total: number; count: number; currency: string }) => ({ month: r.month, total: money(r.total, r.currency), count: r.count });
  const currencies = byCurrency(ctx, rows.filter((r) => r.rn === 1)).map((peak) => {
    const runnerUp = rows.find((r) => r.currency === peak.currency && r.rn === 2);
    return { currency: peak.currency, peak: month(peak), runnerUp: runnerUp ? month(runnerUp) : null, monthsWithData: peak.months };
  });
  return { filter: describeFilter(ctx, f), noData: currencies.length === 0, currencies };
}

// a rule's amount per month, on average
const PER_MONTH: Record<Frequency, number> = { DAILY: 365 / 12, WEEKLY: 52 / 12, BIWEEKLY: 26 / 12, MONTHLY: 1, YEARLY: 1 / 12 };

// 6. What the active recurring rules (nextOccurrence not null) cost per month, per currency. Approximate: each rule's
// amount times its average occurrences per month, rounded to whole minor units. At most 20 rules per household.
export async function recurringCost(ctx: QueryContext, paidById?: number) {
  const rules = await prisma.recurringRule.findMany({
    where: { householdId: ctx.householdId, nextOccurrence: { not: null }, ...(paidById !== undefined && { paidById }) },
    select: { name: true, amount: true, currency: true, frequency: true, nextOccurrence: true, paidById: true, categoryId: true },
    orderBy: [{ amount: "desc" }, { id: "asc" }],
    take: MAX_ROWS,
  });
  const currencies = byCurrency(ctx, [...new Set(rules.map((r) => r.currency))].map((currency) => ({ currency }))).map(({ currency }) => {
    const own = rules.filter((r) => r.currency === currency);
    const monthly = own.reduce((sum, r) => sum + r.amount * PER_MONTH[r.frequency], 0);
    return {
      currency,
      monthlyTotal: money(Math.round(monthly), currency),
      rules: own.map((r) => ({
        name: r.name,
        amount: money(r.amount, currency),
        frequency: r.frequency,
        monthlyEquivalent: money(Math.round(r.amount * PER_MONTH[r.frequency]), currency),
        nextOccurrence: r.nextOccurrence!.toISOString().slice(0, 10),
        category: categoryName(ctx, r.categoryId),
        paidBy: memberName(ctx, r.paidById),
      })),
    };
  });
  return {
    ...(paidById !== undefined && { paidBy: memberName(ctx, paidById) }),
    approximate: true,
    noData: currencies.length === 0,
    currencies,
  };
}

// 7. The most recent expense whose name contains the text (plus any other filter), or found: false.
export async function lastPurchase(ctx: QueryContext, f: SpendingFilter & { nameContains: string }) {
  const [row] = await prisma.$queryRaw<ExpenseRow[]>`
    SELECT "name", "amount", "currency"::text AS currency, to_char("date", 'YYYY-MM-DD') AS date, "categoryId", "paidById",
           ("recurringRuleId" IS NOT NULL) AS "isRecurring"
    FROM "Expense" WHERE ${whereSql(ctx, f)}
    ORDER BY "date" DESC, "id" DESC LIMIT 1`;
  return row ? { filter: describeFilter(ctx, f), found: true, expense: expenseOut(ctx, row) } : { filter: describeFilter(ctx, f), found: false };
}
