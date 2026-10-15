import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { AmountPanel } from "../components/AmountPanel";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Icon } from "../components/Icon";
import { Pill } from "../components/Pill";
import { EmptyView } from "../components/StateViews";
import type { Category, Expense, Member, Role, Summary } from "../api/types";
import { useDeleteExpense } from "../api/hooks";
import { errorMessage } from "../api/errors";
import { canChangeExpense } from "../lib/permissions";
import { categoryColor } from "../lib/categoryColors";
import { formatMoney, joinAmounts, projectedLine, spentEntries } from "../lib/money";
import { applyFilter, filterChoices, sumByCurrency, type ExpenseFilter } from "../lib/expenseFilter";
import { monthLabel, monthName, shortDateLabel } from "../lib/dates";
import { colors, fonts, MIN_TOUCH, radii, type as t } from "../theme";

const FIRST_ROWS = 3;

type Props = {
  month: string;
  // the household's current month says "so far"; a past month is complete
  isCurrentMonth: boolean;
  summary: Summary;
  // newest first
  expenses: Expense[];
  categories: Category[];
  members: Member[];
  householdId: number;
  // the caller, for the edit and delete buttons (payer, creator or owner)
  myId: number;
  role: Role;
};

export function SpendingCard({ month, isCurrentMonth, summary, expenses, categories, members, householdId, myId, role }: Props) {
  const [showAll, setShowAll] = useState(false);
  // the list's filter: "all", or a category or payer to pick (id null until one is picked, which still shows everything)
  const [mode, setMode] = useState<"all" | "category" | "payer">("all");
  const [filterId, setFilterId] = useState<number | null>(null);
  const projected = projectedLine(summary.totals);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const memberById = new Map(members.map((m) => [m.userId, m]));
  const filter: ExpenseFilter = mode !== "all" && filterId !== null ? { by: mode, id: filterId } : null;
  const shown = applyFilter(expenses, filter);
  const visible = showAll ? shown : shown.slice(0, FIRST_ROWS);
  const choices = mode === "all" ? [] : filterChoices(expenses, mode);
  const choiceLabel = (id: number) =>
    mode === "category" ? categoryName.get(id) ?? "Uncategorized" : (memberById.get(id)?.name ?? "Unknown") + (memberById.get(id)?.isActive === false ? " (left)" : "");
  const pickMode = (next: "all" | "category" | "payer") => {
    setMode(next);
    setFilterId(null);
    setShowAll(false);
  };

  return (
    <Card>
      {/* the most prominent thing on the screen: the month's spending, then what recurring rules still add */}
      <AmountPanel
        label={isCurrentMonth ? `Spent in ${monthName(month)} so far` : `Spent in ${monthLabel(month)}`}
        amounts={spentEntries(summary.totals)}
        note={projected ? { text: "Future expenses scheduled by the end of the month:", amount: projected } : undefined}
      />

      {expenses.length > 0 && (
        <View style={styles.filter}>
          <View style={styles.filterRow} accessibilityRole="radiogroup" accessibilityLabel="Filter expenses">
            <Text style={styles.filterLabel}>Show</Text>
            <SmallChip label="All" active={mode === "all"} onPress={() => pickMode("all")} />
            <SmallChip label="By category" active={mode === "category"} onPress={() => pickMode("category")} />
            <SmallChip label="By payer" active={mode === "payer"} onPress={() => pickMode("payer")} />
          </View>
          {mode !== "all" && (
            <View style={styles.choiceRow} accessibilityRole="radiogroup">
              {choices.map((id) => (
                <SmallChip
                  key={id}
                  label={choiceLabel(id)}
                  dot={mode === "category" ? categoryColor(id) : undefined}
                  active={filterId === id}
                  onPress={() => { setFilterId(filterId === id ? null : id); setShowAll(false); }}
                />
              ))}
            </View>
          )}
          {filter && (
            <Text style={styles.filterSummary}>
              {shown.length} of {expenses.length} expenses{shown.length > 0 ? ` • ${joinAmounts(sumByCurrency(shown))}` : ""}
            </Text>
          )}
        </View>
      )}

      <View style={styles.rows}>
        {expenses.length === 0 && (
          <>
            <EmptyView icon="receipt-long" message={isCurrentMonth ? "No expenses this month" : `No expenses in ${monthName(month)}`} />
            <Button label="Create expense" variant="tonal" icon="add" compact onPress={() => router.push("/create-expense")} />
          </>
        )}
        {visible.map((e) => {
          const payer = memberById.get(e.paidById);
          return (
            <ExpenseRow
              key={e.id}
              expense={e}
              categoryName={categoryName.get(e.categoryId) ?? "Uncategorized"}
              categoryColor={categoryColor(e.categoryId)}
              payerName={payer?.name ?? "Unknown"}
              payerLeft={!payer || !payer.isActive}
              householdId={householdId}
              canChange={canChangeExpense(e, myId, role)}
            />
          );
        })}
        {shown.length > FIRST_ROWS && (
          <Pressable
            onPress={() => setShowAll((v) => !v)}
            accessibilityRole="button"
            hitSlop={(MIN_TOUCH - 28) / 2}
            style={({ pressed }) => [styles.more, pressed && { backgroundColor: colors.surfaceContainerHigh }]}
          >
            <Text style={styles.moreText}>{showAll ? "Show less" : `Show more (${shown.length - FIRST_ROWS})`}</Text>
            <View style={showAll && styles.flipped}><Icon name="expand-more" size={14} color={colors.outline} /></View>
          </Pressable>
        )}
      </View>
    </Card>
  );
}

// a 32dp chip for the list filter (touch area still 44dp through hitSlop)
function SmallChip({ label, active, onPress, dot }: { label: string; active: boolean; onPress: () => void; dot?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      hitSlop={(MIN_TOUCH - 32) / 2}
      style={({ pressed }) => [styles.smallChip, active && styles.smallChipActive, pressed && !active && { opacity: 0.7 }]}
    >
      {dot && <View style={[styles.tagDot, { backgroundColor: dot }]} />}
      <Text style={[styles.smallChipText, active && { color: colors.onSecondary }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

// the category tag, tinted with the category's calendar dot color
function CategoryTag({ name, color }: { name: string; color: string }) {
  return (
    <View style={[styles.tag, { backgroundColor: `${color}24` }]}>
      <View style={[styles.tagDot, { backgroundColor: color }]} />
      <Text style={styles.tagText} numberOfLines={1}>{name}</Text>
    </View>
  );
}

type RowProps = {
  expense: Expense;
  categoryName: string;
  categoryColor: string;
  payerName: string;
  payerLeft: boolean;
  householdId: number;
  canChange: boolean;
};

function ExpenseRow({ expense, categoryName, categoryColor: tagColor, payerName, payerLeft, householdId, canChange }: RowProps) {
  const [open, setOpen] = useState(false);
  const remove = useDeleteExpense(householdId);

  function confirmRemove() {
    Alert.alert(`Remove ${expense.name}?`, "The expense is deleted for everyone in the household. It can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => remove.mutate(expense.id) },
    ]);
  }
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${expense.name}, ${formatMoney(expense.amount, expense.currency)}, ${shortDateLabel(expense.date)}, paid by ${payerName}`}
        accessibilityHint={open ? "Hides the details" : "Shows the details"}
        style={styles.rowMain}
      >
        <View style={[styles.rowIcon, expense.isRecurring && { backgroundColor: colors.surfaceContainerHigh }]}>
          <Icon name={expense.isRecurring ? "update" : "receipt-long"} size={14} color={expense.isRecurring ? colors.accent : colors.secondary} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowName} numberOfLines={1}>{expense.name}</Text>
          <View style={styles.rowMeta}>
            <CategoryTag name={categoryName} color={tagColor} />
            <Text style={styles.rowMetaText} numberOfLines={1}>
              {shortDateLabel(expense.date)} • Paid by <Text style={payerLeft && styles.departed}>{payerName}</Text>
            </Text>
          </View>
        </View>
        <Text style={styles.amount}>{formatMoney(-expense.amount, expense.currency)}</Text>
        <View style={[styles.arrow, open && styles.flipped]}><Icon name="expand-more" size={16} color={colors.outline} /></View>
      </Pressable>
      {open && (
        <View style={styles.details}>
          <Text style={styles.detailsText}>{expense.description ?? "No description"}</Text>
          {expense.isRecurring && (
            <>
              <Pill label="Recurring" tone="secondary" />
              <Text style={styles.detailsText}>You can edit recurring expenses in the Recurring expenses panel below.</Text>
            </>
          )}
          {remove.isError && <Text style={styles.errorText}>{errorMessage(remove.error)}</Text>}
          {canChange && (
            <View style={styles.actions}>
              <RowAction
                label={expense.isRecurring ? "Edit description" : "Edit"}
                icon="edit"
                onPress={() => router.push({ pathname: "/edit-expense", params: { expenseId: String(expense.id) } })}
              />
              {/* a recurring expense can't be deleted; its rule is ended instead */}
              {!expense.isRecurring && <RowAction label="Remove" icon="delete-outline" danger onPress={confirmRemove} busy={remove.isPending} />}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function RowAction({ label, icon, onPress, danger = false, busy = false }: { label: string; icon: "edit" | "delete-outline"; onPress: () => void; danger?: boolean; busy?: boolean }) {
  const color = danger ? colors.error : colors.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ busy }}
      hitSlop={(MIN_TOUCH - 28) / 2}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }, busy && { opacity: 0.5 }]}
    >
      <Icon name={icon} size={14} color={color} />
      <Text style={[styles.actionText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radii.pill, flexShrink: 1 },
  tagDot: { width: 6, height: 6, borderRadius: 3 },
  tagText: { flexShrink: 1, fontFamily: fonts.jakarta600, fontSize: 10, lineHeight: 14, color: colors.onSurface },
  rows: { gap: 6, paddingTop: 2 },
  filter: { gap: 6 },
  filterRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  choiceRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  filterLabel: { fontFamily: fonts.jakarta700, fontSize: 11, lineHeight: 14, color: colors.outline, marginRight: 2 },
  filterSummary: { fontFamily: fonts.inter500, fontSize: 11, lineHeight: 16, color: colors.onSurfaceVariant },
  smallChip: {
    height: 32, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, borderRadius: radii.pill,
    backgroundColor: colors.surfaceContainerLow, maxWidth: "100%",
  },
  smallChipActive: { backgroundColor: colors.secondary },
  smallChipText: { flexShrink: 1, fontFamily: fonts.jakarta700, fontSize: 11, lineHeight: 14, color: colors.onSurface },
  row: { backgroundColor: colors.surfaceContainerLow, borderRadius: radii.expenseRow, paddingHorizontal: 8 },
  rowMain: { minHeight: MIN_TOUCH, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  rowIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.secondaryFixed, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontFamily: fonts.jakarta700, fontSize: 12, lineHeight: 16, color: colors.onSurface },
  rowMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  rowMetaText: { flexShrink: 1, fontFamily: fonts.inter400, fontSize: 10, lineHeight: 14, color: colors.outline },
  departed: { color: colors.outlineVariant, fontStyle: "italic" },
  amount: { fontFamily: fonts.jakarta700, fontSize: 12, lineHeight: 16, color: colors.onSurface },
  arrow: { width: 20, alignItems: "center" },
  flipped: { transform: [{ rotate: "180deg" }] },
  details: { borderTopWidth: 1, borderTopColor: colors.surfaceContainer, paddingVertical: 6, gap: 4 },
  actions: { flexDirection: "row", gap: 16, paddingTop: 2 },
  action: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 28 },
  actionText: { fontFamily: fonts.jakarta700, fontSize: 11, lineHeight: 14 },
  errorText: { fontFamily: fonts.inter400, fontSize: 11, lineHeight: 16, color: colors.error },
  detailsText: { fontFamily: fonts.inter400, fontSize: 11, lineHeight: 16, color: colors.onSurfaceVariant },
  more: {
    height: 28, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
    borderRadius: radii.pill, backgroundColor: colors.surfaceContainerLow,
  },
  moreText: { fontFamily: fonts.inter600, fontSize: 11, lineHeight: 14, color: colors.outline },
});
