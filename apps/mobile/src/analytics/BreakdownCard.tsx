import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { DonutChart } from "./DonutChart";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { Field } from "../components/Field";
import { EmptyView, ErrorView, LoadingView } from "../components/StateViews";
import { MonthNav } from "../home/MonthNav";
import { useCalendarMonth } from "../api/hooks";
import type { Category, Currency, Household, Member } from "../api/types";
import { errorMessage } from "../api/errors";
import { currenciesByAmount, groupSpending, type GroupBy, type Slice } from "../lib/analytics";
import { categoryColor } from "../lib/categoryColors";
import { monthName } from "../lib/dates";
import { colors, type as t } from "../theme";

// "Other" is a neutral gray, never one of the category colors
const OTHER_COLOR = colors.outline;

type Props = { household: Household; categories: Category[]; members: Member[]; currentMonth: string };

// A donut of one month's real expenses (no projections), by category or by payer, in one currency at a time (DonutChart).
export function BreakdownCard({ household, categories, members, currentMonth }: Props) {
  const [by, setBy] = useState<GroupBy>("category");
  const [month, setMonth] = useState(currentMonth);
  const [chosenCurrency, setChosenCurrency] = useState<Currency | null>(null);
  const calendar = useCalendarMonth(household.id, month);

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const memberById = new Map(members.map((m) => [m.userId, m]));
  const expenses = calendar.data?.expenses ?? [];
  const currencies = currenciesByAmount(expenses.map((e) => ({ currency: e.currency, amount: e.amount })), household.defaultCurrency);
  const currency = chosenCurrency && currencies.includes(chosenCurrency) ? chosenCurrency : currencies[0];
  const slices = currency ? groupSpending(expenses, by, currency) : [];

  // the same color a category has on the calendar; a payer gets the palette color of their user id
  const colorOf = (s: Slice) => (s.key === null ? OTHER_COLOR : categoryColor(s.key));
  const labelOf = (s: Slice) => {
    if (s.key === null) return by === "category" ? "Other categories" : "Others";
    if (by === "category") return categoryName.get(s.key) ?? "Unknown category";
    const m = memberById.get(s.key);
    return m ? (m.isActive ? m.name : `${m.name} (left)`) : "Unknown";
  };

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Spending breakdown</Text>
      <Field label="Group by">
        <View style={styles.chips} accessibilityRole="radiogroup">
          <Chip label="Category" active={by === "category"} onPress={() => setBy("category")} />
          <Chip label="Payer" active={by === "payer"} onPress={() => setBy("payer")} />
        </View>
      </Field>
      <MonthNav month={month} current={currentMonth} onChange={setMonth} />
      {currencies.length > 1 && (
        <Field label="Currency">
          <View style={styles.chips} accessibilityRole="radiogroup">
            {currencies.map((c) => <Chip key={c} label={c} active={c === currency} onPress={() => setChosenCurrency(c)} />)}
          </View>
        </Field>
      )}

      {calendar.isError ? (
        <ErrorView message={errorMessage(calendar.error)} onRetry={() => calendar.refetch()} />
      ) : !calendar.data ? (
        <LoadingView />
      ) : slices.length === 0 || !currency ? (
        <EmptyView icon="pie-chart" message={`No expenses in ${monthName(month)}`} />
      ) : (
        <>
          <DonutChart
            key={`${by}-${month}-${currency}`}
            currency={currency}
            parts={slices.map((sl) => ({ key: sl.key, label: labelOf(sl), amount: sl.amount, color: colorOf(sl) }))}
          />
          <Text style={styles.note}>
            {month === currentMonth ? `${monthName(month)} so far. ` : ""}Recurring expenses count once they're due. Tap a slice or a row to see it alone.
          </Text>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 12 },
  title: { ...t.headlineSm, color: colors.onSurface },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  note: { ...t.bodySm, color: colors.onSurfaceVariant },
});
