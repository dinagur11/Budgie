import type { Expense, Role, Rule } from "../api/types";

// who may edit or delete an expense (the backend's rule): its current payer, its creator, or an owner
export function canChangeExpense(expense: Pick<Expense, "paidById" | "createdById">, myId: number, role: Role): boolean {
  return role === "OWNER" || expense.paidById === myId || expense.createdById === myId;
}

// the same rule for a recurring expense; changing its payer is only for its creator or an owner
export function canChangeRule(rule: Pick<Rule, "paidById" | "createdById">, myId: number, role: Role): boolean {
  return canChangeExpense(rule, myId, role);
}

export function canChangeRulePayer(rule: Pick<Rule, "createdById">, myId: number, role: Role): boolean {
  return role === "OWNER" || rule.createdById === myId;
}
