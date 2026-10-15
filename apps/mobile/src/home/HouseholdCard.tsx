import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "../components/Icon";
import type { MyHousehold } from "../api/types";
import { useHousehold, useSummary } from "../api/hooks";
import { householdColor, tint } from "../lib/categoryColors";
import { spentLine } from "../lib/money";
import { monthName as nameOfMonth, monthOf, todayInTimeZone } from "../lib/dates";
import { colors, fonts, MIN_TOUCH, radii, shadows, type as t } from "../theme";

// One household in the home list: its name, the caller's role and what it has spent so far this month
// (the household's month, from its time zone). Projected amounts are left out here. Tapping opens the household.
// Each household has its own color (householdColor): a light undertone on the card, a stronger one on the badge and the total.
export function HouseholdCard({ household, onPress }: { household: MyHousehold; onPress: () => void }) {
  const details = useHousehold(household.householdId);
  const month = details.data ? monthOf(todayInTimeZone(details.data.timeZone)) : null;
  const summary = useSummary(household.householdId, month);

  const monthName = month ? nameOfMonth(month) : null;
  const failed = details.isError || summary.isError;
  const amount = summary.data ? spentLine(summary.data.totals) : null;
  const color = householdColor(household.householdId);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${household.name}${amount && monthName ? `, spent in ${monthName} so far: ${amount}` : ""}`}
      accessibilityHint="Opens the household"
      style={({ pressed }) => [styles.card, { backgroundColor: tint(color, pressed ? 0.14 : 0.07), borderColor: tint(color, 0.22) }]}
    >
      <View style={styles.headerRow}>
        <View style={[styles.badge, { backgroundColor: tint(color, 0.18) }]}><Icon name="roofing" size={18} color={color} /></View>
        <Text style={styles.name} numberOfLines={1}>{household.name}</Text>
        <View style={[styles.role, { backgroundColor: tint(color, 0.16) }]}>
          <Text style={[styles.roleText, { color }]}>{household.role === "OWNER" ? "Owner" : "Member"}</Text>
        </View>
        <Icon name="chevron-right" size={20} color={colors.outline} />
      </View>
      <View style={[styles.spent, { backgroundColor: tint(color, 0.17) }]}>
        <Text style={styles.label}>{monthName ? `Spent in ${monthName} so far` : "Spent this month so far"}</Text>
        {failed ? (
          <Text style={styles.error}>Couldn't load the totals. Pull down to try again.</Text>
        ) : amount ? (
          <Text style={styles.amount}>{amount}</Text>
        ) : (
          <View style={styles.skeleton} />
        )}
      </View>
    </Pressable>
  );
}



const styles = StyleSheet.create({
  card: { borderRadius: radii.card, borderWidth: 1, padding: 16, gap: 14, minHeight: MIN_TOUCH, ...shadows.card },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  badge: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  name: { flex: 1, fontFamily: fonts.jakarta700, fontSize: 16, lineHeight: 20, color: colors.onSurface },
  role: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.pill },
  roleText: { fontFamily: fonts.jakarta700, fontSize: 11, lineHeight: 14 },
  spent: { borderRadius: radii.row, paddingHorizontal: 14, paddingVertical: 12, gap: 4 },
  label: { fontFamily: fonts.inter500, fontSize: 12, lineHeight: 16, color: colors.onSurfaceVariant },
  amount: { fontFamily: fonts.jakarta800, fontSize: 20, lineHeight: 26, color: colors.onSurface },
  error: { ...t.bodySm, color: colors.error },
  skeleton: { height: 20, width: "55%", marginVertical: 2, borderRadius: 6, backgroundColor: colors.surfaceContainerHigh },
});
