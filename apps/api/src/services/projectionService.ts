import { prisma } from "../prisma.js";
import { todayInTimeZone } from "./expensesService.js";
import { nextOccurrenceAfter } from "./recurringRulesService.js";

const formatDate = (date: Date) => date.toISOString().slice(0, 10);

// the future occurrences of the household's active rules inside a month (first and last day at UTC midnight, from validMonth),
// after today in the household's time zone and never past endDate. Shared by the calendar and the summary so they can't disagree.
// Computed only, never written. Run generateDueExpenses first, so nextOccurrence is after today.
export async function projectMonth(householdId: number, timeZone: string, first: Date, last: Date) {
  const today = new Date(`${todayInTimeZone(timeZone)}T00:00:00Z`);
  // a past month has nothing to project
  if (last <= today) return [];

  const rules = await prisma.recurringRule.findMany({
    where: { householdId, nextOccurrence: { not: null } },
    select: { id: true, name: true, amount: true, currency: true, frequency: true, startDate: true, endDate: true, nextOccurrence: true, categoryId: true, paidById: true },
  });

  const projected = [];
  for (const rule of rules) {
    const anchorDay = rule.startDate.getUTCDate();
    for (let d = rule.nextOccurrence!; d <= last && (rule.endDate === null || d <= rule.endDate); d = nextOccurrenceAfter(d, rule.frequency, anchorDay)) {
      // today is never projected: the catch-up already made it a real expense
      if (d > today && d >= first)
        projected.push({
          ruleId: rule.id, name: rule.name, amount: rule.amount, currency: rule.currency, date: formatDate(d),
          categoryId: rule.categoryId, paidById: rule.paidById, isProjected: true as const,
        });
    }
  }
  projected.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ruleId - b.ruleId));
  return projected;
}
