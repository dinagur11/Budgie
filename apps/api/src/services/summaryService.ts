import { prisma } from "../prisma.js";
import type { Currency } from "../../generated/prisma/client.js";
import { generateDueExpenses } from "./recurringRulesService.js";
import { projectMonth } from "./projectionService.js";

const formatDate = (date: Date) => date.toISOString().slice(0, 10);

// a month's totals per currency, in minor units: spent (real expenses in the month, summed in the database)
// and projected (the sum of the shared projectMonth items, the same ones the calendar shows). No conversion, no formatting.
export async function getSummary(householdId: number, first: Date, last: Date) {
  await generateDueExpenses(householdId);

  const household = await prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { timeZone: true, defaultCurrency: true } });

  const [spentRows, projectedItems] = await Promise.all([
    prisma.expense.groupBy({
      by: ["currency"],
      where: { householdId, date: { gte: first, lte: last } },
      _sum: { amount: true },
    }),
    projectMonth(householdId, household.timeZone, first, last),
  ]);

  // the default currency is always present, zeros included
  const totals = new Map<Currency, { spent: number; projected: number }>([[household.defaultCurrency, { spent: 0, projected: 0 }]]);
  const entry = (currency: Currency) => {
    let t = totals.get(currency);
    if (!t) totals.set(currency, (t = { spent: 0, projected: 0 }));
    return t;
  };
  // Postgres sums an int column as bigint; Prisma returns it as a plain number, never cast back to 32 bits
  for (const row of spentRows) entry(row.currency).spent += Number(row._sum.amount ?? 0);
  for (const item of projectedItems) entry(item.currency).projected += item.amount;

  const others = [...totals.keys()]
    .filter((c) => c !== household.defaultCurrency)
    .filter((c) => totals.get(c)!.spent !== 0 || totals.get(c)!.projected !== 0)
    .sort();
  return {
    month: formatDate(first).slice(0, 7),
    totals: [household.defaultCurrency, ...others].map((currency) => ({ currency, ...totals.get(currency)! })),
  };
}
