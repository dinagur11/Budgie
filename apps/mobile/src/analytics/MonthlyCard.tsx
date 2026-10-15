import { StyleSheet, Text } from "react-native";
import { Card } from "../components/Card";
import { ErrorView, LoadingView } from "../components/StateViews";
import { useSummaries } from "../api/hooks";
import type { Household } from "../api/types";
import { errorMessage } from "../api/errors";
import { lastMonths } from "../lib/analytics";
import { colors, type as t } from "../theme";
import { MonthBarChart } from "./MonthBarChart";

export const MONTHS_SHOWN = 6;

// The household's total spending (real expenses) in each of the last 6 months (one summary request per month).
export function MonthlyCard({ household, currentMonth }: { household: Household; currentMonth: string }) {
  const months = lastMonths(currentMonth, MONTHS_SHOWN);
  const summaries = useSummaries(household.id, months);
  const failed = summaries.find((q) => q.isError);
  const loaded = summaries.every((q) => q.data);

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Spending by month</Text>
      {failed ? (
        <ErrorView message={errorMessage(failed.error)} onRetry={() => summaries.forEach((q) => q.isError && void q.refetch())} />
      ) : !loaded ? (
        <LoadingView />
      ) : (
        <MonthBarChart
          months={months}
          currentMonth={currentMonth}
          totals={summaries.map((q) => q.data!.totals.map((x) => ({ currency: x.currency, amount: x.spent })))}
          preferredCurrency={household.defaultCurrency}
          note={(currency) => `Real expenses in ${currency}, recurring ones included once due. Tap a bar to see its total.`}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 12 },
  title: { ...t.headlineSm, color: colors.onSurface },
});
