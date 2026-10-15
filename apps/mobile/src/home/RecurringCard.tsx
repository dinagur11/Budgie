import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Icon } from "../components/Icon";
import { Pill } from "../components/Pill";
import { EmptyView } from "../components/StateViews";
import { useDeleteRule } from "../api/hooks";
import type { Member, Role, Rule } from "../api/types";
import { errorMessage } from "../api/errors";
import { categoryColor } from "../lib/categoryColors";
import { longDateLabel, shortDateLabel } from "../lib/dates";
import { formatMoney } from "../lib/money";
import { canChangeRule } from "../lib/permissions";
import { FREQUENCY_LABELS } from "../lib/recurring";
import { colors, fonts, MIN_TOUCH, radii, type as t } from "../theme";

type Props = { householdId: number; rules: Rule[]; members: Member[]; myId: number; role: Role };

// The household's recurring expenses (active first, then ended), with Edit and Delete for the payer, the creator or an owner.
// This is the way into a recurring expense: expense rows don't carry their rule's id.
export function RecurringCard({ householdId, rules, members, myId, role }: Props) {
  const remove = useDeleteRule(householdId);
  const names = new Map(members.map((m) => [m.userId, m]));
  const sorted = [...rules].sort((a, b) => Number(a.nextOccurrence === null) - Number(b.nextOccurrence === null));

  function confirmDelete(rule: Rule) {
    remove.reset();
    Alert.alert(
      `Delete ${rule.name}?`,
      `No more expenses will be added. Its ${rule.expenseCount} existing expenses can stay as ordinary expenses, or be deleted with it.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Keep its expenses", onPress: () => remove.mutate({ ruleId: rule.id, deleteExpenses: false }) },
        { text: "Delete its expenses too", style: "destructive", onPress: () => remove.mutate({ ruleId: rule.id, deleteExpenses: true }) },
      ],
    );
  }

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.badge}><Icon name="update" size={16} color={colors.secondary} /></View>
        <Text style={styles.title}>Recurring expenses</Text>
      </View>
      {remove.isError && <Text style={styles.error}>{errorMessage(remove.error)}</Text>}
      {sorted.length === 0 && <EmptyView icon="update" message="No recurring expenses yet" />}
      {sorted.map((r) => {
        const payer = names.get(r.paidById);
        const ended = r.nextOccurrence === null;
        return (
          <View key={r.id} style={[styles.row, ended && styles.endedRow]}>
            <View style={styles.rowTop}>
              <View style={[styles.dot, { backgroundColor: categoryColor(r.categoryId) }]} />
              <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
              {ended && <Pill label="Ended" />}
              <Text style={styles.amount}>{formatMoney(r.amount, r.currency)}</Text>
            </View>
            <Text style={styles.meta} numberOfLines={2}>
              {FREQUENCY_LABELS[r.frequency]} • {ended ? (r.endDate ? `ended ${longDateLabel(r.endDate)}` : "ended") : `next ${shortDateLabel(r.nextOccurrence!)}`}
              {!ended && r.endDate ? ` • until ${longDateLabel(r.endDate)}` : ""} • Paid by {payer?.name ?? "Unknown"}
            </Text>
            {r.nearingLimit && <Text style={styles.warning}>Close to the 600-expense limit; it ends by itself there.</Text>}
            {canChangeRule(r, myId, role) && (
              <View style={styles.actions}>
                <Action label="Edit" icon="edit" onPress={() => router.push({ pathname: "/edit-rule", params: { ruleId: String(r.id) } })} />
                <Action label="Delete" icon="delete-outline" danger onPress={() => confirmDelete(r)} disabled={remove.isPending} />
              </View>
            )}
          </View>
        );
      })}
      <Button label="Create recurring expense" variant="tonal" icon="add" compact onPress={() => router.push("/create-rule")} />
    </Card>
  );
}

function Action({ label, icon, onPress, danger = false, disabled = false }: { label: string; icon: "edit" | "delete-outline"; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  const color = danger ? colors.error : colors.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      hitSlop={(MIN_TOUCH - 28) / 2}
      style={({ pressed }) => [styles.action, (pressed || disabled) && { opacity: 0.6 }]}
    >
      <Icon name={icon} size={14} color={color} />
      <Text style={[styles.actionText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.secondaryFixed, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontFamily: fonts.jakarta700, fontSize: 14, lineHeight: 18, color: colors.onSurface },
  row: { backgroundColor: colors.surfaceContainerLow, borderRadius: radii.row, paddingHorizontal: 12, paddingVertical: 8, gap: 3 },
  endedRow: { opacity: 0.75 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { flexShrink: 1, fontFamily: fonts.jakarta700, fontSize: 12, lineHeight: 16, color: colors.onSurface },
  amount: { marginLeft: "auto", fontFamily: fonts.jakarta700, fontSize: 12, lineHeight: 16, color: colors.onSurface },
  meta: { fontFamily: fonts.inter400, fontSize: 11, lineHeight: 15, color: colors.outline },
  warning: { ...t.bodySm, fontSize: 11, color: colors.error },
  error: { ...t.bodySm, color: colors.error },
  actions: { flexDirection: "row", gap: 16, paddingTop: 2 },
  action: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 28 },
  actionText: { fontFamily: fonts.jakarta700, fontSize: 11, lineHeight: 14 },
});
