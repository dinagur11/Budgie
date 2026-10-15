import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { CalendarMonth, Category, CreatedInvite, Currency, Expense, Frequency, Household, Rule, Me, Member, MyHousehold, MySpending, Summary } from "./types";

// Every household query key starts with ["household", id], so switching households never shows another household's data.
// Every endpoint used here exists in apps/api; in fixture mode (src/fixtures) apiFetch answers locally instead.

export const keys = {
  me: ["me"] as const,
  myHouseholds: ["me", "households"] as const,
  mySpending: (month: string) => ["me", "spending", month] as const,
  household: (id: number) => ["household", id] as const,
  members: (id: number) => ["household", id, "members"] as const,
  categories: (id: number) => ["household", id, "categories"] as const,
  summary: (id: number, month: string) => ["household", id, "summary", month] as const,
  calendar: (id: number, month: string) => ["household", id, "calendar", month] as const,
  expense: (id: number, expenseId: number) => ["household", id, "expense", expenseId] as const,
  rules: (id: number) => ["household", id, "rules"] as const,
  rule: (id: number, ruleId: number) => ["household", id, "rule", ruleId] as const,
};

export function useMyHouseholds(enabled = true) {
  return useQuery({ queryKey: keys.myHouseholds, queryFn: () => apiFetch<MyHousehold[]>("/me/households"), enabled });
}

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => apiFetch<Me>("/me") });
}

// what the user paid this month across all their households (month in the device's time zone)
export function useMySpending(month: string) {
  return useQuery({ queryKey: keys.mySpending(month), queryFn: () => apiFetch<MySpending>(`/me/spending?month=${month}`) });
}

// several months of the caller's spending (one request each, sharing the cache with useMySpending)
export function useMySpendingMonths(months: string[]) {
  return useQueries({
    queries: months.map((month) => ({ queryKey: keys.mySpending(month), queryFn: () => apiFetch<MySpending>(`/me/spending?month=${month}`) })),
  });
}

export function useHousehold(id: number | null) {
  return useQuery({
    queryKey: keys.household(id ?? 0),
    queryFn: () => apiFetch<Household>(`/households/${id}`),
    enabled: id !== null,
  });
}

// including members who left, so a departed payer still has a name (shown grayed out)
export function useMembers(id: number | null) {
  return useQuery({
    queryKey: keys.members(id ?? 0),
    queryFn: () => apiFetch<Member[]>(`/households/${id}/members?includeFormer=true`),
    enabled: id !== null,
  });
}

// including archived ones, since old expenses keep their category
export function useCategories(id: number | null) {
  return useQuery({
    queryKey: keys.categories(id ?? 0),
    queryFn: () => apiFetch<Category[]>(`/households/${id}/categories?includeArchived=true`),
    enabled: id !== null,
  });
}

export function useSummary(id: number | null, month: string | null) {
  return useQuery({
    queryKey: keys.summary(id ?? 0, month ?? ""),
    queryFn: () => apiFetch<Summary>(`/households/${id}/summary?month=${month}`),
    enabled: id !== null && month !== null,
  });
}

// several months' summaries (one request each, sharing the cache with useSummary); for the spending-by-month chart
export function useSummaries(id: number | null, months: string[]) {
  return useQueries({
    queries: months.map((month) => ({
      queryKey: keys.summary(id ?? 0, month),
      queryFn: () => apiFetch<Summary>(`/households/${id}/summary?month=${month}`),
      enabled: id !== null,
    })),
  });
}

// the month's real expenses and projected rule occurrences (one request for both)
export function useCalendarMonth(id: number | null, month: string | null) {
  return useQuery({
    queryKey: keys.calendar(id ?? 0, month ?? ""),
    queryFn: () => apiFetch<CalendarMonth>(`/households/${id}/calendar?month=${month}`),
    enabled: id !== null && month !== null,
  });
}

// the month's real expenses, newest first (the calendar endpoint returns them oldest first); shares the calendar request
export function useMonthExpenses(id: number | null, month: string | null) {
  return useQuery({
    queryKey: keys.calendar(id ?? 0, month ?? ""),
    queryFn: () => apiFetch<CalendarMonth>(`/households/${id}/calendar?month=${month}`),
    enabled: id !== null && month !== null,
    select: (data) => [...data.expenses].reverse(),
  });
}

export function useCreateHousehold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; defaultCurrency: Currency; timeZone: string }) =>
      apiFetch<Household>("/households", { method: "POST", body }),
    onSuccess: async (household) => {
      queryClient.setQueryData(keys.household(household.id), household);
      await queryClient.invalidateQueries({ queryKey: keys.myHouseholds });
    },
  });
}

export type HouseholdUpdate = Partial<{ name: string; defaultCurrency: Currency; timeZone: string }>;

// owner only; the switcher and the list read the name from GET /me/households, so that is refreshed too
export function useUpdateHousehold(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: HouseholdUpdate) => apiFetch<Household>(`/households/${id}`, { method: "PATCH", body }),
    onSuccess: async (household) => {
      queryClient.setQueryData(keys.household(id), household);
      // a new time zone can move "today", so everything under the household is refetched
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.household(id) }),
        queryClient.invalidateQueries({ queryKey: keys.myHouseholds }),
      ]);
    },
  });
}

// leaving and deleting both end with the household gone for this user: drop its data and refresh the list
// (the selection falls back to the first remaining household by itself)
function useHouseholdExit(id: number, request: () => Promise<void>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: keys.household(id) });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useLeaveHousehold(id: number) {
  return useHouseholdExit(id, () => apiFetch<void>(`/households/${id}/members/me`, { method: "DELETE" }));
}

export function useDeleteHousehold(id: number) {
  return useHouseholdExit(id, () => apiFetch<void>(`/households/${id}`, { method: "DELETE" }));
}

// owner only
export function useRemoveMember(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) => apiFetch<void>(`/households/${id}/members/${userId}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.members(id) }),
  });
}

// owner only; single use, valid for 7 days
export function useCreateInvite(id: number) {
  return useMutation({ mutationFn: () => apiFetch<CreatedInvite>(`/households/${id}/invites`, { method: "POST" }) });
}

export type NewExpense = {
  name: string;
  amount: number;
  currency: Currency;
  date: string;
  categoryId: number;
  paidById: number;
  description?: string;
};

export function useCreateExpense(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: NewExpense) => apiFetch<Expense>(`/households/${id}/expenses`, { method: "POST", body }),
    onSuccess: () => invalidateAfterExpenseChange(queryClient, id),
  });
}

export function useCreateCategory(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => apiFetch<Category>(`/households/${id}/categories`, { method: "POST", body: { name } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.categories(id) }),
  });
}

// rename and/or archive a custom category (built-ins can't be changed)
export function useUpdateCategory(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, ...body }: { categoryId: number; name?: string; isArchived?: boolean }) =>
      apiFetch<Category>(`/households/${id}/categories/${categoryId}`, { method: "PATCH", body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.categories(id) }),
  });
}

// owner only; an unused custom category (one in use gets a 409: archive it instead)
export function useDeleteCategory(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: number) => apiFetch<void>(`/households/${id}/categories/${categoryId}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.categories(id) }),
  });
}

// PATCH /me; the name also shows in every household's members list, so those are refetched too
export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => apiFetch<Me>("/me", { method: "PATCH", body: { name } }),
    onSuccess: async (me) => {
      queryClient.setQueryData(keys.me, me);
      await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "household" && q.queryKey[2] === "members" });
    },
  });
}

export function useExpense(id: number | null, expenseId: number | null) {
  return useQuery({
    queryKey: keys.expense(id ?? 0, expenseId ?? 0),
    queryFn: () => apiFetch<Expense>(`/households/${id}/expenses/${expenseId}`),
    enabled: id !== null && expenseId !== null,
  });
}

// any subset of the fields; description null clears it. On a recurring expense only description may change.
export type ExpenseUpdate = Partial<Omit<NewExpense, "description">> & { description?: string | null };

// both change the household's totals and calendar, and maybe what the caller paid this month
function invalidateAfterExpenseChange(queryClient: ReturnType<typeof useQueryClient>, id: number) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: keys.household(id) }),
    queryClient.invalidateQueries({ queryKey: ["me", "spending"] }),
  ]);
}

// the payer, the creator or an owner
export function useUpdateExpense(id: number, expenseId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ExpenseUpdate) => apiFetch<Expense>(`/households/${id}/expenses/${expenseId}`, { method: "PATCH", body }),
    onSuccess: () => invalidateAfterExpenseChange(queryClient, id),
  });
}

// the payer, the creator or an owner; recurring expenses can't be deleted (409)
export function useDeleteExpense(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (expenseId: number) => apiFetch<void>(`/households/${id}/expenses/${expenseId}`, { method: "DELETE" }),
    onSuccess: () => invalidateAfterExpenseChange(queryClient, id),
  });
}

export type NewRule = {
  name: string;
  amount: number;
  currency: Currency;
  frequency: Frequency;
  startDate: string;
  endDate?: string;
  paidById: number;
  categoryId: number;
};

// creating a rule backfills its expenses up to today and adds projected ones to the calendar
export function useCreateRule(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: NewRule) => apiFetch<Rule>(`/households/${id}/rules`, { method: "POST", body }),
    onSuccess: () => invalidateAfterExpenseChange(queryClient, id),
  });
}

// all of the household's recurring expenses, ended ones included (at most 20, no pagination)
export function useRules(id: number | null) {
  return useQuery({
    queryKey: keys.rules(id ?? 0),
    queryFn: () => apiFetch<Rule[]>(`/households/${id}/rules`),
    enabled: id !== null,
  });
}

export function useRule(id: number | null, ruleId: number | null) {
  return useQuery({
    queryKey: keys.rule(id ?? 0, ruleId ?? 0),
    queryFn: () => apiFetch<Rule>(`/households/${id}/rules/${ruleId}`),
    enabled: id !== null && ruleId !== null,
  });
}

// any subset of the fields; endDate null makes it open-ended again
export type RuleUpdate = Partial<Omit<NewRule, "endDate">> & { endDate?: string | null };

// the payer, the creator or an owner (only the creator or an owner may change the payer). A rule's fields are copied
// to all its expenses, and a new start date or frequency regenerates them, so everything under the household is refetched.
export function useUpdateRule(id: number, ruleId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RuleUpdate) => apiFetch<Rule>(`/households/${id}/rules/${ruleId}`, { method: "PATCH", body }),
    onSuccess: () => invalidateAfterExpenseChange(queryClient, id),
  });
}

// deleteExpenses false keeps its expenses as ordinary ones; true deletes them with the rule
export function useDeleteRule(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ruleId, deleteExpenses }: { ruleId: number; deleteExpenses: boolean }) =>
      apiFetch<void>(`/households/${id}/rules/${ruleId}?deleteExpenses=${deleteExpenses}`, { method: "DELETE" }),
    onSuccess: () => invalidateAfterExpenseChange(queryClient, id),
  });
}
