import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Card } from "../components/Card";
import { ErrorView, LoadingView } from "../components/StateViews";
import { useSummary } from "../api/hooks";
import type { Household } from "../api/types";
import { errorMessage } from "../api/errors";
import { budgetProgress, daysUntilReset, type BudgetTone } from "../lib/budget";
import { monthLabel, monthName, todayInTimeZone } from "../lib/dates";
import { formatMoney } from "../lib/money";
import { colors, fonts, MIN_TOUCH, radii, type as t } from "../theme";

const TONE_COLOR: Record<BudgetTone, string> = { ok: colors.primary, warning: colors.warning, over: colors.error };

type Props = { household: Household & { monthlyLimit: number }; month: string; currentMonth: string };

// The month's spending against the household's monthly limit: real expenses in the default currency only (the summary's
// spent, no conversion), as an amount, a percentage that can pass 100% and a bar (green, amber from 80%, red over).
// The limit is the household's current one, also for past months. Owners get "Edit budget" (Settings).
export function BudgetCard({ household, month, currentMonth }: Props) {
  const summary = useSummary(household.id, month);
  const limit = household.monthlyLimit;
  const currency = household.defaultCurrency;
  const isCurrent = month === currentMonth;
  const title = `${isCurrent ? monthName(month) : monthLabel(month)} budget`;

  if (summary.isError)
    return <Card style={styles.card}><ErrorView message={errorMessage(summary.error)} onRetry={() => summary.refetch()} /></Card>;
  if (!summary.data) return <Card style={styles.card}><LoadingView /></Card>;

  // the default currency is always in the summary's totals
  const spent = summary.data.totals.find((x) => x.currency === currency)?.spent ?? 0;
  const { percent, fill, tone } = budgetProgress(spent, limit);
  const days = isCurrent ? daysUntilReset(todayInTimeZone(household.timeZone)) : null;

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.amounts} accessibilityLabel={`${formatMoney(spent, currency)} of ${formatMoney(limit, currency)} spent, ${percent}%`}>
        {formatMoney(spent, currency).replace(` ${currency}`, "")}
        <Text style={styles.limit}> / {formatMoney(limit, currency)}</Text>
      </Text>
      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.min(100, percent) }}
      >
        <View style={[styles.fill, { width: `${fill * 100}%`, backgroundColor: TONE_COLOR[tone] }]} />
      </View>
      <Text style={[styles.percent, { color: TONE_COLOR[tone] }]}>
        {percent}% of the limit{tone === "over" ? `, ${formatMoney(spent - limit, currency)} over` : ""}
      </Text>
      <View style={styles.footer}>
        <Text style={styles.note}>
          {days === null ? `Only expenses in ${currency} count.` : `Resets ${days === 1 ? "tomorrow" : `in ${days} days`}.`}
        </Text>
        {household.role === "OWNER" && (
          <Pressable
            onPress={() => router.navigate("/settings")}
            accessibilityRole="link"
            hitSlop={{ top: (MIN_TOUCH - 16) / 2, bottom: (MIN_TOUCH - 16) / 2, left: 8, right: 8 }}
          >
            <Text style={styles.link}>Edit budget</Text>
          </Pressable>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 10 },
  title: { ...t.headlineSm, color: colors.onSurface },
  amounts: { ...t.headlineMd, color: colors.onSurface },
  limit: { color: colors.onSurfaceVariant, fontFamily: fonts.jakarta600 },
  track: { height: 14, borderRadius: radii.pill, backgroundColor: colors.surfaceContainerHigh, overflow: "hidden" },
  fill: { height: "100%", borderRadius: radii.pill },
  percent: { ...t.labelLg },
  footer: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 },
  note: { ...t.bodySm, color: colors.onSurfaceVariant },
  link: { ...t.bodySm, color: colors.secondary, fontFamily: fonts.inter600, textDecorationLine: "underline" },
});
