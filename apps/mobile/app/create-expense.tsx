import { useLocalSearchParams } from "expo-router";
import { ExpenseScreen } from "../src/expenses/ExpenseForm";
import { parseSuggestionParam } from "../src/lib/receipt";

// POST /households/:id/expenses for the selected household (the "+" menu's "Create Expense"); ?receipt= (a scanned
// receipt's suggestion as JSON, from scan-receipt) prefills the form
export default function CreateExpenseScreen() {
  const { receipt } = useLocalSearchParams<{ receipt?: string }>();
  return <ExpenseScreen suggestion={parseSuggestionParam(receipt)} />;
}
