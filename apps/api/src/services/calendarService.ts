import { prisma } from "../prisma.js";
import { expenseSelect, toExpenseResponse } from "./expensesService.js";
import { generateDueExpenses } from "./recurringRulesService.js";
import { projectMonth } from "./projectionService.js";

const formatDate = (date: Date) => date.toISOString().slice(0, 10);

// a month of the calendar: the real expenses dated inside it, plus the future occurrences of active rules
// (after today in the household's time zone, from the shared projectMonth). Projections are computed only, never written.
export async function getCalendar(householdId: number, first: Date, last: Date) {
  await generateDueExpenses(householdId);

  const household = await prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { timeZone: true } });

  const [expenses, projected] = await Promise.all([
    prisma.expense.findMany({
      where: { householdId, date: { gte: first, lte: last } },
      select: expenseSelect,
      orderBy: [{ date: "asc" }, { id: "asc" }],
    }),
    projectMonth(householdId, household.timeZone, first, last),
  ]);

  return { month: formatDate(first).slice(0, 7), expenses: expenses.map(toExpenseResponse), projected };
}
