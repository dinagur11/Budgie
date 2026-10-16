import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Screen } from "../components/Screen";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { CurrencyPicker } from "../components/CurrencyPicker";
import { DatePicker } from "../components/DatePicker";
import { Field } from "../components/Field";
import { TextField } from "../components/TextField";
import { Button } from "../components/Button";
import { Banner } from "../components/Banner";
import { ErrorView, LoadingView } from "../components/StateViews";
import { useCategories, useCreateExpense, useExpense, useHousehold, useMe, useMembers, useUpdateExpense, type ExpenseUpdate } from "../api/hooks";
import type { Category, Currency, Expense, Household, Member, ReceiptSuggestion } from "../api/types";
import { errorMessage } from "../api/errors";
import { useHouseholdSelection } from "../household/HouseholdContext";
import { categoryColor } from "../lib/categoryColors";
import { addDays, longDateLabel, todayInTimeZone } from "../lib/dates";
import { amountInput, parseAmount } from "../lib/money";
import { suggestionToFormDefaults } from "../lib/receipt";
import { validateAmount, validateDescription, validateExpenseDate, validateName } from "../lib/validate";
import { colors, type as t } from "../theme";

// The create and edit expense screens (POST, or PATCH /households/:id/expenses/:expenseId) for the selected household.
// suggestion (create only): a scanned receipt's fields, used as the form's starting values
export function ExpenseScreen({ expenseId, suggestion }: { expenseId?: number | null; suggestion?: ReceiptSuggestion | null }) {
  const editing = expenseId !== undefined;
  const { selectedId } = useHouseholdSelection();
  const household = useHousehold(selectedId);
  const categories = useCategories(selectedId);
  const members = useMembers(selectedId);
  const me = useMe();
  const expense = useExpense(selectedId, editing ? expenseId : null);

  const queries = editing ? [household, categories, members, me, expense] : [household, categories, members, me];
  const failed = queries.find((q) => q.isError);
  const ready = household.data && categories.data && members.data && me.data && (!editing || expense.data);
  return (
    <Screen>
      <Card style={styles.card}>
        <Text style={styles.title}>{editing ? "Edit expense" : "Create expense"}</Text>
        {selectedId === null || expenseId === null ? (
          <Text style={styles.hint}>{expenseId === null ? "Expense not found." : "Create a household first."}</Text>
        ) : failed ? (
          <ErrorView message={errorMessage(failed.error)} onRetry={() => queries.forEach((q) => void q.refetch())} />
        ) : !ready ? (
          <LoadingView />
        ) : (
          <ExpenseForm
            household={household.data!}
            categories={categories.data!}
            members={members.data!}
            myId={me.data!.id}
            expense={editing ? expense.data : undefined}
            suggestion={editing ? null : suggestion}
          />
        )}
        <Button label="Cancel" variant="text" onPress={() => router.back()} />
      </Card>
    </Screen>
  );
}

type Errors = Partial<Record<"name" | "amount" | "date" | "category" | "description", string | null>>;

type FormProps = { household: Household; categories: Category[]; members: Member[]; myId: number; expense?: Expense; suggestion?: ReceiptSuggestion | null };

function ExpenseForm({ household, categories, members, myId, expense, suggestion }: FormProps) {
  const create = useCreateExpense(household.id);
  const update = useUpdateExpense(household.id, expense?.id ?? 0);
  const mutation = expense ? update : create;
  // a recurring expense takes everything but its description from its rule
  const descriptionOnly = !!expense?.isRecurring;
  // "today" is the household's, the same day the backend checks against
  const today = todayInTimeZone(household.timeZone);
  // a scanned receipt's suggestion; unread fields fall back to the empty form's defaults
  const [prefill] = useState(() =>
    suggestion ? suggestionToFormDefaults(suggestion, household, today, categories.filter((c) => !c.isArchived).map((c) => c.id)) : null,
  );
  const [name, setName] = useState(expense?.name ?? prefill?.name ?? "");
  const [amount, setAmount] = useState(expense ? amountInput(expense.amount) : prefill?.amount ?? "");
  const [currency, setCurrency] = useState<Currency>(expense?.currency ?? prefill?.currency ?? household.defaultCurrency);
  const [date, setDate] = useState(expense?.date ?? prefill?.date ?? today);
  const [categoryId, setCategoryId] = useState<number | null>(expense?.categoryId ?? prefill?.categoryId ?? null);
  const [paidById, setPaidById] = useState<number | undefined>(
    expense?.paidById ?? (members.some((m) => m.userId === myId && m.isActive) ? myId : members.find((m) => m.isActive)?.userId),
  );
  const [description, setDescription] = useState(expense?.description ?? prefill?.description ?? "");
  const [errors, setErrors] = useState<Errors>({});

  // new expenses need a usable category and an active payer; an edited expense also keeps its current ones
  // (the backend never rechecks an unchanged category or payer, so an archived category or a departed payer can stay)
  const categoryChoices = categories.filter((c) => !c.isArchived || c.id === expense?.categoryId);
  const payerChoices = members.filter((m) => m.isActive || m.userId === expense?.paidById);

  async function submit() {
    const next: Errors = descriptionOnly
      ? { description: validateDescription(description) }
      : {
          name: validateName(name, "Enter a name"),
          amount: validateAmount(amount),
          date: validateExpenseDate(date, today),
          category: categoryId === null ? "Pick a category" : null,
          description: validateDescription(description),
        };
    setErrors(next);
    if (Object.values(next).some(Boolean) || categoryId === null || paidById === undefined) return;
    try {
      if (expense) {
        const changes = changedFields(expense, { name: name.trim(), amount: parseAmount(amount)!, currency, date, categoryId, paidById, description: description.trim() }, descriptionOnly);
        if (Object.keys(changes).length > 0) await update.mutateAsync(changes);
      } else {
        await create.mutateAsync({
          name: name.trim(),
          amount: parseAmount(amount)!,
          currency,
          date,
          categoryId,
          paidById,
          ...(description.trim() !== "" ? { description: description.trim() } : {}),
        });
      }
      router.back();
    } catch {
      // shown from mutation.error below
    }
  }

  const yesterday = addDays(today, -1);
  return (
    <>
      {mutation.isError && <Banner message={errorMessage(mutation.error)} />}
      {prefill && <Text style={styles.hint}>Filled in from your receipt. Check every field before creating the expense.</Text>}
      {descriptionOnly ? (
        <Text style={styles.hint}>
          This expense comes from a recurring expense, so only its description can be changed here. Its name, amount, date,
          category and payer are set on the recurring expense.
        </Text>
      ) : (
        <>
          <TextField label="Name" value={name} onChangeText={setName} error={errors.name} maxLength={100} placeholder="Groceries at the market" autoFocus={!expense} />
          <TextField label="Amount" value={amount} onChangeText={setAmount} error={errors.amount} keyboardType="decimal-pad" placeholder="0.00" />
          <CurrencyPicker label="Currency" value={currency} onChange={setCurrency} />

          <Field label="Date" error={errors.date}>
            <View style={styles.dateRow}>
              <Text style={styles.dateValue}>{longDateLabel(date)}</Text>
              <View style={styles.chips}>
                <Chip label="Today" active={date === today} onPress={() => setDate(today)} />
                <Chip label="Yesterday" active={date === yesterday} onPress={() => setDate(yesterday)} />
              </View>
            </View>
            <DatePicker value={date} onChange={setDate} max={today} today={today} />
          </Field>

          <Field label="Category" error={errors.category}>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {categoryChoices.map((c) => (
                <Chip key={c.id} label={c.name} dot={categoryColor(c.id)} active={c.id === categoryId} onPress={() => setCategoryId(c.id)} />
              ))}
              <Chip label="+ New category" active={false} onPress={() => router.push("/create-category")} />
            </View>
          </Field>

          <Field label="Paid by">
            <View style={styles.chips} accessibilityRole="radiogroup">
              {payerChoices.map((m) => (
                <Chip key={m.userId} label={m.userId === myId ? `${m.name} (you)` : m.name} active={m.userId === paidById} onPress={() => setPaidById(m.userId)} />
              ))}
            </View>
          </Field>
        </>
      )}

      <TextField
        label="Description (optional)"
        value={description}
        onChangeText={setDescription}
        error={errors.description}
        maxLength={500}
        multiline
      />
      <Button label={expense ? "Save changes" : "Create expense"} onPress={submit} loading={mutation.isPending} />
    </>
  );
}

type FormValues = { name: string; amount: number; currency: Currency; date: string; categoryId: number; paidById: number; description: string };

// only what changed (the backend rechecks a payer or category only when it is sent); an emptied description clears it
function changedFields(expense: Expense, v: FormValues, descriptionOnly: boolean): ExpenseUpdate {
  const changes: ExpenseUpdate = {};
  const description = v.description === "" ? null : v.description;
  if (description !== expense.description) changes.description = description;
  if (descriptionOnly) return changes;
  if (v.name !== expense.name) changes.name = v.name;
  if (v.amount !== expense.amount) changes.amount = v.amount;
  if (v.currency !== expense.currency) changes.currency = v.currency;
  if (v.date !== expense.date) changes.date = v.date;
  if (v.categoryId !== expense.categoryId) changes.categoryId = v.categoryId;
  if (v.paidById !== expense.paidById) changes.paidById = v.paidById;
  return changes;
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 14 },
  title: { ...t.headlineMd, color: colors.onSurface },
  hint: { ...t.bodyMd, color: colors.onSurfaceVariant },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dateRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  dateValue: { ...t.labelLg, color: colors.onSurface },
});
