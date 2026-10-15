// Response shapes of the Budgie API (see CLAUDE.md, "Implemented endpoints").
// Dates are "YYYY-MM-DD" strings and months "YYYY-MM"; never turn them into Date objects.
// Money is an integer in minor units (cents).

export const CURRENCIES = ["ILS", "USD", "EUR", "GBP", "RUB", "CAD", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK"] as const;
export type Currency = (typeof CURRENCIES)[number];

export type Role = "OWNER" | "MEMBER";

export type Me = { id: number; name: string; email: string };

// GET /me/spending?month=YYYY-MM: what the caller paid, per currency (alphabetical), across their active households,
// and the same per household (every active household, in the order of GET /me/households, totals [] when nothing)
export type MySpendingTotal = { currency: Currency; spent: number };
export type MySpending = {
  month: string;
  totals: MySpendingTotal[];
  households: { householdId: number; name: string; totals: MySpendingTotal[] }[];
};

// GET /me/households
export type MyHousehold = { householdId: number; name: string; role: Role };

// GET /households/:id, POST /households
export type Household = { id: number; name: string; defaultCurrency: Currency; timeZone: string; role: Role };

// GET /households/:id/members?includeFormer=true
// joinedAt is an ISO timestamp (reset when a former member rejoins)
export type Member = { userId: number; name: string; role: Role; joinedAt: string; isActive: boolean };

// POST /households/:id/invites: the raw token is returned only here; the app builds the link
export type CreatedInvite = { token: string; expiresAt: string };

// GET /households/:id/categories
export type Category = { id: number; name: string; isArchived: boolean; isBuiltIn: boolean };

export type Expense = {
  id: number;
  name: string;
  amount: number;
  currency: Currency;
  date: string;
  categoryId: number;
  paidById: number;
  createdById: number;
  description: string | null;
  isRecurring: boolean;
};

export type ProjectedItem = {
  ruleId: number;
  name: string;
  amount: number;
  currency: Currency;
  date: string;
  categoryId: number;
  paidById: number;
  isProjected: true;
};

// GET /households/:id/calendar?month=YYYY-MM
export type CalendarMonth = { month: string; expenses: Expense[]; projected: ProjectedItem[] };

// GET /households/:id/summary?month=YYYY-MM (default currency first, then the others alphabetically)
export type SummaryTotal = { currency: Currency; spent: number; projected: number };
export type Summary = { month: string; totals: SummaryTotal[] };

export const FREQUENCIES = ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "YEARLY"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

// GET/POST /households/:id/rules (a recurring expense); endDate and nextOccurrence null = open-ended / ended
export type Rule = {
  id: number;
  name: string;
  amount: number;
  currency: Currency;
  frequency: Frequency;
  startDate: string;
  endDate: string | null;
  nextOccurrence: string | null;
  paidById: number;
  createdById: number;
  categoryId: number;
  expenseCount: number;
  nearingLimit: boolean;
};
