import { useState } from "react";
import { AppHeader, useBackToHouseholds } from "../../src/components/AppHeader";
import { Card } from "../../src/components/Card";
import { HouseholdSwitcher } from "../../src/components/HouseholdSwitcher";
import { Placeholder } from "../../src/components/Placeholder";
import { Screen } from "../../src/components/Screen";
import { ErrorView, LoadingView } from "../../src/components/StateViews";
import { BreakdownCard } from "../../src/analytics/BreakdownCard";
import { BudgetCard } from "../../src/analytics/BudgetCard";
import { MonthlyCard } from "../../src/analytics/MonthlyCard";
import { useHouseholdSelection } from "../../src/household/HouseholdContext";
import { useCategories, useHousehold, useMembers } from "../../src/api/hooks";
import type { Category, Household, Member } from "../../src/api/types";
import { errorMessage } from "../../src/api/errors";
import { monthOf, todayInTimeZone } from "../../src/lib/dates";

// The selected household's analytics: the picked month's spending against the monthly limit (when there is one), that
// month's spending by category or payer (a donut), and the last months' totals (bars). All read existing endpoints
// (summary and calendar); months are the household's.
export default function AnalyticsScreen() {
  const back = useBackToHouseholds();
  const { selectedId } = useHouseholdSelection();
  const household = useHousehold(selectedId);
  const categories = useCategories(selectedId);
  const members = useMembers(selectedId);
  const header = <AppHeader onBack={back} center={selectedId !== null ? <HouseholdSwitcher /> : undefined} />;

  if (selectedId === null)
    return (
      <Screen inTabs header={header}>
        <Placeholder icon="pie-chart" title="No household yet" text="Create a household to see where its money goes." />
      </Screen>
    );
  const queries = [household, categories, members];
  const failed = queries.find((q) => q.isError);
  if (failed)
    return (
      <Screen inTabs header={header}>
        <Card><ErrorView message={errorMessage(failed.error)} onRetry={() => queries.forEach((q) => void q.refetch())} /></Card>
      </Screen>
    );
  if (!household.data || !categories.data || !members.data)
    return <Screen inTabs header={header}><LoadingView /></Screen>;

  const currentMonth = monthOf(todayInTimeZone(household.data.timeZone));
  return (
    <Screen inTabs header={header}>
      {/* keyed by household, so switching households starts over on its current month */}
      <MonthCards key={`month-${household.data.id}`} household={household.data} categories={categories.data} members={members.data} currentMonth={currentMonth} />
      <MonthlyCard key={`monthly-${household.data.id}`} household={household.data} currentMonth={currentMonth} />
    </Screen>
  );
}

// the cards that follow the breakdown's month picker: the budget (only with a limit) and the breakdown
function MonthCards({ household, categories, members, currentMonth }: { household: Household; categories: Category[]; members: Member[]; currentMonth: string }) {
  const [month, setMonth] = useState(currentMonth);
  const limit = household.monthlyLimit;
  return (
    <>
      {limit !== null && <BudgetCard household={{ ...household, monthlyLimit: limit }} month={month} currentMonth={currentMonth} />}
      <BreakdownCard household={household} categories={categories} members={members} month={month} currentMonth={currentMonth} onMonthChange={setMonth} />
    </>
  );
}
