import type { CalendarMonth, Category, Rule as RuleShape, Expense, Household, Me, Member, MyHousehold, MySpending, ProjectedItem, Summary, SummaryTotal } from "../api/types";
import { ApiError } from "../api/errors";
import { daysInMonth, parseDate, todayInTimeZone } from "../lib/dates";

// Fixture mode, for screenshots and UI work without a backend or Cognito. Turned on only by
// EXPO_PUBLIC_FIXTURES=true at build time (never in a real build). No Amplify call and no network request is made:
// the session is fake and apiFetch answers from here. All names are made up.
export const FIXTURES = process.env.EXPO_PUBLIC_FIXTURES === "true";

// "home" (a household with expenses), "empty" (no household yet) or "signedOut" (the auth screens).
// On web the scenario comes from the page URL (?fixture=empty); elsewhere it is "home".
export type Scenario = "home" | "empty" | "signedOut";
export function fixtureScenario(): Scenario {
  const search = (globalThis as { location?: { search?: string } }).location?.search ?? "";
  const value = /[?&]fixture=(\w+)/.exec(search)?.[1];
  return value === "empty" || value === "signedOut" ? value : "home";
}

const households: Household[] = [
  { id: 1, name: "Cohen Family", defaultCurrency: "ILS", timeZone: "Asia/Jerusalem", role: "OWNER" },
  { id: 2, name: "Beach House", defaultCurrency: "EUR", timeZone: "Europe/Berlin", role: "MEMBER" },
  { id: 3, name: "Book Club", defaultCurrency: "USD", timeZone: "America/New_York", role: "OWNER" },
];
const members: Member[] = [
  { userId: 1, name: "Dana", role: "OWNER", joinedAt: "2026-01-04T09:12:00.000Z", isActive: true },
  { userId: 2, name: "Yoni", role: "MEMBER", joinedAt: "2026-01-06T18:40:00.000Z", isActive: true },
  { userId: 3, name: "Maya", role: "MEMBER", joinedAt: "2026-03-15T12:00:00.000Z", isActive: false },
];
const categories: Category[] = [
  { id: 1, name: "Groceries", isArchived: false, isBuiltIn: true },
  { id: 2, name: "Utilities", isArchived: false, isBuiltIn: true },
  { id: 3, name: "Kids", isArchived: false, isBuiltIn: false },
  { id: 4, name: "Transport", isArchived: false, isBuiltIn: true },
  { id: 5, name: "Eating out", isArchived: false, isBuiltIn: true },
];

type Template = Omit<Expense, "id" | "date" | "createdById"> & { day: number };
const cohenExpenses: Template[] = [
  { day: 2, name: "Rent", amount: 520000, currency: "ILS", categoryId: 2, paidById: 1, description: null, isRecurring: true },
  { day: 3, name: "Shufersal weekly shop", amount: 64230, currency: "ILS", categoryId: 1, paidById: 2, description: "Weekly groceries and pantry refills.", isRecurring: false },
  { day: 5, name: "Bus passes", amount: 22500, currency: "ILS", categoryId: 4, paidById: 3, description: null, isRecurring: false },
  { day: 8, name: "Hotel deposit for the summer trip to Lisbon", amount: 22000, currency: "EUR", categoryId: 5, paidById: 1, description: "Paid in euros, refundable until May.", isRecurring: false },
  { day: 10, name: "Soccer camp gear", amount: 31990, currency: "ILS", categoryId: 3, paidById: 2, description: "Cleats, shin guards and the camp deposit.", isRecurring: false },
  { day: 12, name: "High-speed internet", amount: 9900, currency: "ILS", categoryId: 2, paidById: 1, description: "Fiber subscription.", isRecurring: true },
  { day: 13, name: "Pizza night", amount: 14250, currency: "ILS", categoryId: 5, paidById: 2, description: null, isRecurring: false },
];
const beachExpenses: Template[] = [
  { day: 4, name: "Cleaning service", amount: 9000, currency: "EUR", categoryId: 2, paidById: 2, description: null, isRecurring: true },
  { day: 11, name: "Groceries for the weekend", amount: 13475, currency: "EUR", categoryId: 1, paidById: 1, description: null, isRecurring: false },
];
type Rule = Omit<ProjectedItem, "date" | "ruleId" | "isProjected">;
const cohenRules: Rule[] = [
  { name: "Electricity", amount: 43000, currency: "ILS", categoryId: 2, paidById: 1 },
  { name: "Streaming", amount: 1599, currency: "USD", categoryId: 2, paidById: 2 },
];
// per household: its expenses and recurring rules (Book Club has none this month)
const data: Record<number, { expenses: Template[]; rules: Rule[] }> = {
  1: { expenses: cohenExpenses, rules: cohenRules },
  2: { expenses: beachExpenses, rules: [{ name: "Cleaning service", amount: 9000, currency: "EUR", categoryId: 2, paidById: 2 }] },
  3: { expenses: [], rules: [] },
};

// the current month of the household, so the screens look the same whenever they are taken:
// expenses on days up to today, projected occurrences after it
// A past month (?month= before the current one) gets every other template on its own day and no projections.
function monthData(household: Household, requested?: string): { calendar: CalendarMonth; summary: Summary } {
  const { expenses: allTemplates, rules: allRules } = data[household.id];
  const realToday = todayInTimeZone(household.timeZone);
  const past = !!requested && requested < realToday.slice(0, 7);
  const expenseTemplates = past ? allTemplates.filter((_, i) => i % 2 === 0) : allTemplates;
  const ruleTemplates = past ? [] : allRules;
  // in a past month every day is "up to today"
  const today = past ? `${requested}-${String(daysInMonth(...(requested!.split("-").map(Number) as [number, number]))).padStart(2, "0")}` : realToday;
  const { year, month, day: todayDay } = parseDate(today);
  const ym = today.slice(0, 7);
  const at = (day: number) => `${ym}-${String(day).padStart(2, "0")}`;
  const last = daysInMonth(year, month);

  // keep the newest expenses: shift the templates so the last one falls on today (or day 1 at the earliest)
  const shift = expenseTemplates.length === 0 ? 0 : Math.min(0, todayDay - expenseTemplates[expenseTemplates.length - 1].day);
  const expenses: Expense[] = expenseTemplates
    .map((tpl, i) => ({ ...tpl, day: Math.max(1, tpl.day + shift), id: i + 1 }))
    .map(({ day, ...e }) => ({ ...e, date: at(day), createdById: e.paidById }));
  const projected: ProjectedItem[] = ruleTemplates
    .map((r, i) => ({ ...r, ruleId: i + 1, date: at(Math.min(last, todayDay + 3 + i * 7)), isProjected: true as const }))
    .filter((p) => p.date > today);

  const totals = new Map<string, SummaryTotal>([[household.defaultCurrency, { currency: household.defaultCurrency, spent: 0, projected: 0 }]]);
  const add = (currency: SummaryTotal["currency"], field: "spent" | "projected", amount: number) => {
    const t = totals.get(currency) ?? { currency, spent: 0, projected: 0 };
    t[field] += amount;
    totals.set(currency, t);
  };
  expenses.forEach((e) => add(e.currency, "spent", e.amount));
  projected.forEach((p) => add(p.currency, "projected", p.amount));
  const [first, ...rest] = [...totals.values()];
  rest.sort((a, b) => a.currency.localeCompare(b.currency));

  return { calendar: { month: ym, expenses, projected }, summary: { month: ym, totals: [first, ...rest] } };
}

// the household's recurring expenses: the rule templates, started a few months ago, plus one ended rule
function fixtureRules(household: Household): RuleShape[] {
  const today = todayInTimeZone(household.timeZone);
  const { year, month } = parseDate(today);
  const startMonth = month > 3 ? `${year}-${String(month - 3).padStart(2, "0")}` : `${year - 1}-${String(month + 9).padStart(2, "0")}`;
  const active = data[household.id].rules.map((r, i): RuleShape => ({
    ...r,
    id: i + 1,
    frequency: "MONTHLY",
    startDate: `${startMonth}-${String(Math.min(28, 10 + i * 7)).padStart(2, "0")}`,
    endDate: null,
    nextOccurrence: monthData(household).calendar.projected.find((p) => p.ruleId === i + 1)?.date ?? today,
    createdById: r.paidById,
    expenseCount: 3,
    nearingLimit: false,
  }));
  if (household.id !== 1) return active;
  return [...active, {
    id: 9, name: "Gym membership", amount: 18000, currency: "ILS", frequency: "MONTHLY", startDate: `${year - 1}-01-05`, endDate: `${year - 1}-06-05`,
    nextOccurrence: null, paidById: 2, createdById: 2, categoryId: 2, expenseCount: 6, nearingLimit: false,
  }];
}

// what Dana (user 1) paid in a month (?month=, default the current one), in total and per fixture household
function mySpending(scenario: Scenario, requested?: string): MySpending {
  type Total = MySpending["totals"][number];
  const month = requested ?? todayInTimeZone("UTC").slice(0, 7);
  const sorted = (sums: Map<string, number>): Total[] =>
    [...sums].map(([currency, spent]) => ({ currency: currency as Total["currency"], spent })).sort((a, b) => a.currency.localeCompare(b.currency));
  const all = new Map<string, number>();
  const perHousehold = scenario !== "home" ? [] : households.map((h) => {
    const sums = new Map<string, number>();
    for (const e of monthData(h, month).calendar.expenses)
      if (e.paidById === 1) {
        sums.set(e.currency, (sums.get(e.currency) ?? 0) + e.amount);
        all.set(e.currency, (all.get(e.currency) ?? 0) + e.amount);
      }
    return { householdId: h.id, name: h.name, totals: sorted(sums) };
  });
  return { month, totals: sorted(all), households: perHousehold };
}

// the answer apiFetch gives in fixture mode, by path (query strings ignored except the route itself)
export function fixtureResponse(path: string, scenario: Scenario): unknown {
  const route = path.split("?")[0];
  const requestedMonth = /[?&]month=(\d{4}-\d{2})/.exec(path)?.[1];
  if (route === "/me") return { id: 1, name: "Dana", email: "dana@example.com" } satisfies Me;
  if (route === "/me/spending") return mySpending(scenario, requestedMonth);
  if (route === "/me/households")
    return scenario === "home" ? households.map((h): MyHousehold => ({ householdId: h.id, name: h.name, role: h.role })) : [];
  // any token previews a made-up household; joining it answers like the backend (the household isn't in the lists)
  if (route === "/households/join/preview")
    return { householdName: "Beach House", members: [{ name: "Noa", role: "OWNER" }, { name: "Eli", role: "MEMBER" }] };
  if (route === "/households/join")
    return { id: 99, name: "Beach House", defaultCurrency: "ILS", timeZone: "Asia/Jerusalem", role: "MEMBER" } satisfies Household;
  const one = /^\/households\/(\d+)\/expenses\/(\d+)$/.exec(route);
  const rule = /^\/households\/(\d+)\/rules(?:\/(\d+))?$/.exec(route);
  if (rule) {
    const owner = scenario === "home" ? households.find((h) => h.id === Number(rule[1])) : undefined;
    if (!owner) throw new ApiError(404, "Household not found");
    const list = fixtureRules(owner);
    if (!rule[2]) return list;
    const found = list.find((r) => r.id === Number(rule[2]));
    if (!found) throw new ApiError(404, "Rule not found");
    return found;
  }
  if (one) {
    const owner = scenario === "home" ? households.find((h) => h.id === Number(one[1])) : undefined;
    const expense = owner && monthData(owner).calendar.expenses.find((e) => e.id === Number(one[2]));
    if (!expense) throw new ApiError(404, "Expense not found");
    return expense;
  }
  const m = /^\/households\/(\d+)(\/\w+)?$/.exec(route);
  const household = m && scenario === "home" ? households.find((h) => h.id === Number(m[1])) : undefined;
  if (!household) throw new ApiError(404, "Household not found");
  switch (m![2]) {
    case undefined: return household;
    case "/members": return members;
    case "/categories": return categories;
    case "/summary": return monthData(household, requestedMonth).summary;
    case "/calendar": return monthData(household, requestedMonth).calendar;
  }
  throw new Error(`No fixture for ${path}`);
}
