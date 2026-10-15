import { useLocalSearchParams } from "expo-router";
import { ExpenseScreen } from "../src/expenses/ExpenseForm";

// PATCH /households/:id/expenses/:expenseId, opened from an expense row's "Edit" (?expenseId=)
export default function EditExpenseScreen() {
  const { expenseId } = useLocalSearchParams<{ expenseId?: string }>();
  const id = typeof expenseId === "string" && /^[1-9]\d{0,9}$/.test(expenseId) ? Number(expenseId) : null;
  return <ExpenseScreen expenseId={id} />;
}
