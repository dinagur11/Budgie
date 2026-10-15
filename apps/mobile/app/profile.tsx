import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { AppHeader } from "../src/components/AppHeader";
import { Card } from "../src/components/Card";
import { Chip } from "../src/components/Chip";
import { Field } from "../src/components/Field";
import { Icon } from "../src/components/Icon";
import { Screen } from "../src/components/Screen";
import { EmptyView, ErrorView, LoadingView } from "../src/components/StateViews";
import { DonutChart } from "../src/analytics/DonutChart";
import { MonthBarChart } from "../src/analytics/MonthBarChart";
import { MonthNav } from "../src/home/MonthNav";
import { useMe, useMySpending, useMySpendingMonths } from "../src/api/hooks";
import type { Currency, MySpending } from "../src/api/types";
import { errorMessage } from "../src/api/errors";
import { useHouseholdSelection } from "../src/household/HouseholdContext";
import { currenciesByAmount, foldSlices, lastMonths } from "../src/lib/analytics";
import { householdColor, tint } from "../src/lib/categoryColors";
import { deviceTimeZone, monthLabel, monthName, monthOf, todayInTimeZone } from "../src/lib/dates";
import { joinAmounts } from "../src/lib/money";
import { colors, fonts, MIN_TOUCH, radii, type as t } from "../src/theme";

const MONTHS_SHOWN = 6;

// The user's own spending (what they paid, GET /me/spending) across their active households: a month picker, each
// household's amount for that month, the last 6 months as bars and the picked month split by household as a donut.
// Months are the device's (the user's own month, like the households list), not a household's.
export default function ProfileScreen() {
  const currentMonth = monthOf(todayInTimeZone(deviceTimeZone()));
  const [month, setMonth] = useState(currentMonth);
  const me = useMe();
  const spending = useMySpending(month);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));

  return (
    <Screen header={<AppHeader onBack={back} backLabel="Back" />}>
      <View style={styles.heading}>
        <Text style={styles.title}>{me.data ? me.data.name : "Profile"}</Text>
        <Text style={styles.subtitle}>What you paid, in every household you're in.</Text>
      </View>
      <MonthNav month={month} current={currentMonth} onChange={setMonth} />
      {spending.isError ? (
        <Card><ErrorView message={errorMessage(spending.error)} onRetry={() => spending.refetch()} /></Card>
      ) : !spending.data ? (
        <Card><LoadingView /></Card>
      ) : (
        <>
          <HouseholdsCard spending={spending.data} isCurrentMonth={month === currentMonth} />
          <MonthsCard currentMonth={currentMonth} />
          {/* keyed by month, so a new month starts with nothing tapped and its own currency */}
          <ByHouseholdCard key={month} spending={spending.data} />
        </>
      )}
    </Screen>
  );
}

// each active household with what the user paid there in the month; tapping one opens it
function HouseholdsCard({ spending, isCurrentMonth }: { spending: MySpending; isCurrentMonth: boolean }) {
  const { select } = useHouseholdSelection();
  return (
    <Card style={styles.card}>
      <Text style={styles.cardTitle}>Your households</Text>
      <Text style={styles.cardSubtitle}>
        {isCurrentMonth ? `Paid by you in ${monthName(spending.month)} so far` : `Paid by you in ${monthLabel(spending.month)}`}
        {spending.totals.length > 0 ? `: ${joinAmounts(spending.totals.map((x) => ({ amount: x.spent, currency: x.currency })))} in total` : ""}
      </Text>
      {spending.households.length === 0 && <EmptyView icon="roofing" message="You're not in any household yet" />}
      {spending.households.map((h, i) => {
        const color = householdColor(h.householdId);
        return (
          <Pressable
            key={h.householdId}
            onPress={() => {
              select(h.householdId);
              router.push({ pathname: "/household/[id]", params: { id: String(h.householdId) } });
            }}
            accessibilityRole="button"
            accessibilityLabel={`${h.name}: ${h.totals.length > 0 ? joinAmounts(h.totals.map((x) => ({ amount: x.spent, currency: x.currency }))) : "nothing paid"}`}
            style={({ pressed }) => [styles.row, i > 0 && styles.separator, pressed && { opacity: 0.7 }]}
          >
            <View style={[styles.badge, { backgroundColor: tint(color, 0.18) }]}><Icon name="roofing" size={18} color={color} /></View>
            <Text style={styles.name} numberOfLines={1}>{h.name}</Text>
            <Text style={[styles.amount, h.totals.length === 0 && styles.nothing]} numberOfLines={2}>
              {h.totals.length > 0 ? joinAmounts(h.totals.map((x) => ({ amount: x.spent, currency: x.currency }))) : "Nothing paid"}
            </Text>
            <Icon name="chevron-right" size={20} color={colors.outline} />
          </Pressable>
        );
      })}
    </Card>
  );
}

// the last 6 months of what the user paid (one /me/spending request per month), independent of the picked month
function MonthsCard({ currentMonth }: { currentMonth: string }) {
  const months = lastMonths(currentMonth, MONTHS_SHOWN);
  const results = useMySpendingMonths(months);
  const failed = results.find((q) => q.isError);
  return (
    <Card style={styles.card}>
      <Text style={styles.cardTitle}>Spending by month</Text>
      {failed ? (
        <ErrorView message={errorMessage(failed.error)} onRetry={() => results.forEach((q) => q.isError && void q.refetch())} />
      ) : !results.every((q) => q.data) ? (
        <LoadingView />
      ) : (
        <MonthBarChart
          months={months}
          currentMonth={currentMonth}
          totals={results.map((q) => q.data!.totals.map((x) => ({ currency: x.currency, amount: x.spent })))}
          note={(currency) => `What you paid in ${currency}, across your households. Tap a bar to see its total.`}
        />
      )}
    </Card>
  );
}

// the picked month split by household, in one currency at a time; household colors match the households list
function ByHouseholdCard({ spending }: { spending: MySpending }) {
  const [chosenCurrency, setChosenCurrency] = useState<Currency | null>(null);
  const currencies = currenciesByAmount(spending.totals.map((x) => ({ currency: x.currency, amount: x.spent })));
  const currency = chosenCurrency && currencies.includes(chosenCurrency) ? chosenCurrency : currencies[0];
  const names = new Map(spending.households.map((h) => [h.householdId, h.name]));
  const slices = currency
    ? foldSlices(spending.households.map((h) => ({ key: h.householdId, amount: h.totals.find((x) => x.currency === currency)?.spent ?? 0 })))
    : [];

  return (
    <Card style={styles.card}>
      <Text style={styles.cardTitle}>Spending by household</Text>
      {currencies.length > 1 && (
        <Field label="Currency">
          <View style={styles.chips} accessibilityRole="radiogroup">
            {currencies.map((c) => <Chip key={c} label={c} active={c === currency} onPress={() => setChosenCurrency(c)} />)}
          </View>
        </Field>
      )}
      {!currency || slices.length === 0 ? (
        <EmptyView icon="pie-chart" message={`You paid nothing in ${monthName(spending.month)}`} />
      ) : (
        <>
          <DonutChart
            key={currency}
            currency={currency}
            parts={slices.map((s) => ({
              key: s.key,
              label: s.key === null ? "Other households" : names.get(s.key) ?? "Household",
              amount: s.amount,
              color: s.key === null ? colors.outline : householdColor(s.key),
            }))}
          />
          <Text style={styles.note}>Tap a slice or a row to see it alone.</Text>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 2, marginTop: 8 },
  title: { ...t.headlineMd, color: colors.onSurface },
  subtitle: { ...t.bodyMd, color: colors.onSurfaceVariant },
  card: { padding: 16, gap: 12 },
  cardTitle: { ...t.headlineSm, color: colors.onSurface },
  cardSubtitle: { ...t.bodySm, color: colors.onSurfaceVariant, marginTop: -8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: MIN_TOUCH + 12, paddingVertical: 6 },
  separator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outlineVariant },
  badge: { width: 36, height: 36, borderRadius: radii.row, alignItems: "center", justifyContent: "center" },
  name: { flex: 1, ...t.labelLg, color: colors.onSurface },
  amount: { maxWidth: "45%", textAlign: "right", fontFamily: fonts.jakarta700, fontSize: 13, lineHeight: 18, color: colors.onSurface },
  nothing: { fontFamily: fonts.inter400, color: colors.outline },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  note: { ...t.bodySm, color: colors.onSurfaceVariant },
});
