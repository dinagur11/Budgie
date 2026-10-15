import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AmountPanel } from "../components/AmountPanel";
import { Wordmark } from "../components/Wordmark";
import { useMe, useMySpending } from "../api/hooks";
import { deviceTimeZone, monthName, monthOf, todayInTimeZone } from "../lib/dates";
import { colors, fonts, radii, type as t } from "../theme";

// The top of the households list, edge to edge in the secondary color: a greeting, what the user paid this month
// across all their households (GET /me/spending) and the wordmark. The user has no time zone of their own,
// so the month is the device's.
export function HomeTop({ householdCount }: { householdCount: number }) {
  const insets = useSafeAreaInsets();
  const month = monthOf(todayInTimeZone(deviceTimeZone()));
  const me = useMe();
  const spending = useMySpending(month);
  const firstName = me.data?.name.trim().split(/\s+/)[0];

  return (
    <View style={[styles.top, { paddingTop: insets.top + 12 }]}>
      <View style={styles.brandRow}><Wordmark light /></View>
      <Text style={styles.greeting} numberOfLines={1} accessibilityRole="header">{firstName ? `Hey ${firstName}!` : "Hey!"}</Text>
      {/* the spending block: a lighter purple, like the spent block inside a household card */}
      <View style={styles.block}>
        {spending.isError ? (
          <Text style={styles.note}>Couldn't load your spending. Pull down to try again.</Text>
        ) : spending.data ? (
          <AmountPanel
            bare
            amounts={spending.data.totals.map((x) => ({ amount: x.spent, currency: x.currency }))}
            emptyText="Nothing yet this month"
          />
        ) : (
          <View style={styles.skeleton} />
        )}
        {householdCount > 0 && (
          <Text style={styles.note}>
            Expenses paid by you in {monthName(month)} across {householdCount} {householdCount === 1 ? "household" : "households"}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: {
    backgroundColor: colors.secondary, paddingHorizontal: 20, paddingBottom: 24, gap: 10,
    borderBottomLeftRadius: radii.card * 2, borderBottomRightRadius: radii.card * 2,
  },
  block: { backgroundColor: "rgba(255,255,255,0.13)", borderRadius: radii.card, paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  brandRow: { flexDirection: "row", justifyContent: "flex-end", minHeight: 44, alignItems: "center" },
  // the greeting sits below the wordmark row, with room above the amount
  greeting: { marginTop: 2, marginBottom: 6, fontFamily: fonts.jakarta800, fontSize: 22, lineHeight: 28, letterSpacing: -0.3, color: colors.onSecondary },
  skeleton: { height: 62, borderRadius: radii.row, backgroundColor: "rgba(255,255,255,0.15)" },
  note: { ...t.bodySm, color: colors.panelMuted },
});
