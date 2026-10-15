import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
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
import { useCategories, useCreateRule, useHousehold, useMe, useMembers, useRule, useUpdateRule, type RuleUpdate } from "../api/hooks";
import { FREQUENCIES, type Category, type Currency, type Frequency, type Household, type Member, type Rule } from "../api/types";
import { errorMessage } from "../api/errors";
import { useHouseholdSelection } from "../household/HouseholdContext";
import { categoryColor } from "../lib/categoryColors";
import { longDateLabel, todayInTimeZone } from "../lib/dates";
import { amountInput, parseAmount } from "../lib/money";
import { canChangeRulePayer } from "../lib/permissions";
import { FREQUENCY_LABELS, scheduleSummary } from "../lib/recurring";
import { validateAmount, validateExpenseDate, validateName } from "../lib/validate";
import { colors, type as t } from "../theme";

// The create and edit recurring expense screens (POST, or PATCH /households/:id/rules/:ruleId) for the selected household.
export function RuleScreen({ ruleId }: { ruleId?: number | null }) {
  const editing = ruleId !== undefined;
  const { selectedId } = useHouseholdSelection();
  const household = useHousehold(selectedId);
  const categories = useCategories(selectedId);
  const members = useMembers(selectedId);
  const me = useMe();
  const rule = useRule(selectedId, editing ? ruleId : null);

  const queries = editing ? [household, categories, members, me, rule] : [household, categories, members, me];
  const failed = queries.find((q) => q.isError);
  const ready = household.data && categories.data && members.data && me.data && (!editing || rule.data);
  return (
    <Screen>
      <Card style={styles.card}>
        <Text style={styles.title}>{editing ? "Edit recurring expense" : "Create recurring expense"}</Text>
        {selectedId === null || ruleId === null ? (
          <Text style={styles.hint}>{ruleId === null ? "Recurring expense not found." : "Create a household first."}</Text>
        ) : failed ? (
          <ErrorView message={errorMessage(failed.error)} onRetry={() => queries.forEach((q) => void q.refetch())} />
        ) : !ready ? (
          <LoadingView />
        ) : (
          <RuleForm household={household.data!} categories={categories.data!} members={members.data!} myId={me.data!.id} rule={editing ? rule.data : undefined} />
        )}
        <Button label="Cancel" variant="text" onPress={() => router.back()} />
      </Card>
    </Screen>
  );
}

type Errors = Partial<Record<"name" | "amount" | "startDate" | "endDate" | "category", string | null>>;

type FormProps = { household: Household; categories: Category[]; members: Member[]; myId: number; rule?: Rule };

function RuleForm({ household, categories, members, myId, rule }: FormProps) {
  const create = useCreateRule(household.id);
  const update = useUpdateRule(household.id, rule?.id ?? 0);
  const mutation = rule ? update : create;
  // the start date can't be after the household's today (the rule backfills up to today); the end date can be any later day
  const today = todayInTimeZone(household.timeZone);
  const [name, setName] = useState(rule?.name ?? "");
  const [amount, setAmount] = useState(rule ? amountInput(rule.amount) : "");
  const [currency, setCurrency] = useState<Currency>(rule?.currency ?? household.defaultCurrency);
  const [frequency, setFrequency] = useState<Frequency>(rule?.frequency ?? "MONTHLY");
  const [startDate, setStartDate] = useState(rule?.startDate ?? today);
  const [hasEnd, setHasEnd] = useState(!!rule?.endDate);
  const [endDate, setEndDate] = useState(rule?.endDate ?? today);
  const [categoryId, setCategoryId] = useState<number | null>(rule?.categoryId ?? null);
  const [paidById, setPaidById] = useState<number | undefined>(
    rule?.paidById ?? (members.some((m) => m.userId === myId && m.isActive) ? myId : members.find((m) => m.isActive)?.userId),
  );
  const [errors, setErrors] = useState<Errors>({});

  // new rules need a usable category and an active payer; an edited one also keeps its current ones (never rechecked)
  const categoryChoices = categories.filter((c) => !c.isArchived || c.id === rule?.categoryId);
  const payerChoices = members.filter((m) => m.isActive || m.userId === rule?.paidById);
  // only the creator or an owner may change the payer (so a rule whose payer left can be fixed)
  const payerLocked = !!rule && !canChangeRulePayer(rule, myId, household.role);

  async function submit() {
    const next: Errors = {
      name: validateName(name, "Enter a name"),
      amount: validateAmount(amount),
      startDate: validateExpenseDate(startDate, today) && "The start date can't be in the future",
      endDate: hasEnd && endDate < startDate ? "The end date must be on or after the start date" : null,
      category: categoryId === null ? "Pick a category" : null,
    };
    setErrors(next);
    if (Object.values(next).some(Boolean) || categoryId === null || paidById === undefined) return;
    const values = { name: name.trim(), amount: parseAmount(amount)!, currency, frequency, startDate, endDate: hasEnd ? endDate : null, paidById, categoryId };

    if (!rule) {
      const { endDate: end, ...rest } = values;
      try {
        await create.mutateAsync({ ...rest, ...(end ? { endDate: end } : {}) });
        router.back();
      } catch {
        // shown from create.error below (for example the 20-rule limit, or a schedule over 600 expenses)
      }
      return;
    }

    const changes = changedFields(rule, values);
    if (Object.keys(changes).length === 0) return router.back();
    const save = () =>
      update.mutate(changes, { onSuccess: () => router.back() });
    // the backend deletes and recreates every expense of the rule when its schedule starts over
    if (changes.startDate !== undefined || changes.frequency !== undefined)
      Alert.alert(
        "Recreate its expenses?",
        `A new start date or frequency deletes all ${rule.expenseCount} expenses of ${rule.name} and creates them again on the new schedule. Descriptions added to them are lost.`,
        [{ text: "Cancel", style: "cancel" }, { text: "Save", style: "destructive", onPress: save }],
      );
    else save();
  }

  return (
    <>
      {mutation.isError && <Banner message={errorMessage(mutation.error)} />}
      {rule?.nearingLimit && (
        <Banner message={`This recurring expense has ${rule.expenseCount} expenses. At 600 it ends by itself; set an end date or create a new one to keep going.`} />
      )}
      {rule && (
        <Text style={styles.hint}>
          A new name, amount, currency, category or payer applies to all {rule.expenseCount} of its expenses, past ones included.
        </Text>
      )}
      <TextField label="Name" value={name} onChangeText={setName} error={errors.name} maxLength={100} placeholder="Rent" autoFocus={!rule} />
      <TextField label="Amount" value={amount} onChangeText={setAmount} error={errors.amount} keyboardType="decimal-pad" placeholder="0.00" />
      <CurrencyPicker label="Currency" value={currency} onChange={setCurrency} />

      <Field label="Repeats">
        <View style={styles.chips} accessibilityRole="radiogroup">
          {FREQUENCIES.map((f) => <Chip key={f} label={FREQUENCY_LABELS[f]} active={f === frequency} onPress={() => setFrequency(f)} />)}
        </View>
      </Field>

      <Field label="Start date" error={errors.startDate}>
        <View style={styles.dateRow}>
          <Text style={styles.dateValue}>{longDateLabel(startDate)}</Text>
          <Chip label="Today" active={startDate === today} onPress={() => setStartDate(today)} />
        </View>
        <DatePicker value={startDate} onChange={setStartDate} max={today} today={today} />
      </Field>

      <Field label="End date" error={errors.endDate}>
        <View style={styles.dateRow}>
          {hasEnd && <Text style={styles.dateValue}>{longDateLabel(endDate)}</Text>}
          <View style={styles.chips} accessibilityRole="radiogroup">
            <Chip label="No end date" active={!hasEnd} onPress={() => setHasEnd(false)} />
            <Chip
              label="Ends on a date"
              active={hasEnd}
              onPress={() => {
                // start on a valid day: not before the start date
                if (endDate < startDate) setEndDate(startDate);
                setHasEnd(true);
              }}
            />
          </View>
        </View>
        {hasEnd && <DatePicker value={endDate} onChange={setEndDate} min={startDate} today={today} />}
      </Field>

      <Text style={styles.summary}>{scheduleSummary(frequency, startDate, hasEnd && endDate >= startDate ? endDate : null)}</Text>
      {!rule && startDate < today && <Text style={styles.hint}>The expenses from the start date up to today are added right away.</Text>}

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
            <Chip
              key={m.userId}
              label={m.userId === myId ? `${m.name} (you)` : m.name}
              active={m.userId === paidById}
              onPress={() => { if (!payerLocked) setPaidById(m.userId); }}
            />
          ))}
        </View>
        {payerLocked && <Text style={styles.hint}>Only the person who created it or an owner can change the payer.</Text>}
      </Field>

      <Button label={rule ? "Save changes" : "Create recurring expense"} onPress={submit} loading={mutation.isPending} />
    </>
  );
}

type FormValues = Omit<RuleUpdate, "endDate"> & {
  name: string; amount: number; currency: Currency; frequency: Frequency; startDate: string; endDate: string | null; paidById: number; categoryId: number;
};

// only what changed (an unchanged payer or category is never rechecked); endDate null clears it
function changedFields(rule: Rule, v: FormValues): RuleUpdate {
  const changes: RuleUpdate = {};
  if (v.name !== rule.name) changes.name = v.name;
  if (v.amount !== rule.amount) changes.amount = v.amount;
  if (v.currency !== rule.currency) changes.currency = v.currency;
  if (v.frequency !== rule.frequency) changes.frequency = v.frequency;
  if (v.startDate !== rule.startDate) changes.startDate = v.startDate;
  if (v.endDate !== rule.endDate) changes.endDate = v.endDate;
  if (v.categoryId !== rule.categoryId) changes.categoryId = v.categoryId;
  if (v.paidById !== rule.paidById) changes.paidById = v.paidById;
  return changes;
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 14 },
  title: { ...t.headlineMd, color: colors.onSurface },
  hint: { ...t.bodySm, color: colors.onSurfaceVariant },
  summary: { ...t.bodyMd, color: colors.onSurface, backgroundColor: colors.surfaceContainerLow, borderRadius: 12, padding: 12, overflow: "hidden" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dateRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  dateValue: { ...t.labelLg, color: colors.onSurface },
});
