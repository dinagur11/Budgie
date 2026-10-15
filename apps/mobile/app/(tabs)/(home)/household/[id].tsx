import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { AppHeader } from "../../../../src/components/AppHeader";
import { Button } from "../../../../src/components/Button";
import { Card } from "../../../../src/components/Card";
import { HouseholdSwitcher } from "../../../../src/components/HouseholdSwitcher";
import { Placeholder } from "../../../../src/components/Placeholder";
import { Screen } from "../../../../src/components/Screen";
import { ErrorView, LoadingView } from "../../../../src/components/StateViews";
import { CalendarCard } from "../../../../src/home/CalendarCard";
import { Fab } from "../../../../src/home/Fab";
import { SpendingCard } from "../../../../src/home/SpendingCard";
import { MonthNav } from "../../../../src/home/MonthNav";
import { RecurringCard } from "../../../../src/home/RecurringCard";
import { useHouseholdSelection } from "../../../../src/household/HouseholdContext";
import { keys, useCalendarMonth, useCategories, useHousehold, useMe, useMembers, useMonthExpenses, useRules, useSummary } from "../../../../src/api/hooks";
import { errorMessage } from "../../../../src/api/errors";
import { monthOf, todayInTimeZone } from "../../../../src/lib/dates";

// One household: monthly totals, the month's expenses and a mini calendar. The id comes from the route;
// it also becomes the selected household, so the other tabs show the same one.
export default function HouseholdScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === "string" && /^[1-9]\d{0,9}$/.test(params.id) ? Number(params.id) : null;
  const queryClient = useQueryClient();
  const { households, select, query: householdsQuery } = useHouseholdSelection();
  const isMember = id !== null && !!households?.some((h) => h.householdId === id);

  useEffect(() => {
    if (isMember) select(id!);
  }, [isMember, id, select]);

  const householdId = isMember ? id : null;
  const household = useHousehold(householdId);
  // "today" and the month are the household's, not the device's
  const today = household.data ? todayInTimeZone(household.data.timeZone) : null;
  const currentMonth = today ? monthOf(today) : null;
  // the month shown (MonthNav); null = the household's current month. Another household starts on its current month.
  const [viewMonth, setViewMonth] = useState<string | null>(null);
  useEffect(() => setViewMonth(null), [id]);
  const month = viewMonth ?? currentMonth;

  const summary = useSummary(householdId, month);
  const calendar = useCalendarMonth(householdId, month);
  const expenses = useMonthExpenses(householdId, month);
  const categories = useCategories(householdId);
  const members = useMembers(householdId);
  const me = useMe();
  const rules = useRules(householdId);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.all([
        householdsQuery.refetch(),
        householdId !== null ? queryClient.invalidateQueries({ queryKey: keys.household(householdId) }) : undefined,
      ]);
    } finally {
      setRefreshing(false);
    }
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));
  const header = (
    <AppHeader
      onBack={back}
      center={isMember ? <HouseholdSwitcher onSelect={(next) => router.setParams({ id: String(next) })} /> : undefined}
    />
  );

  if (householdsQuery.isPending)
    return <Screen inTabs header={header}><LoadingView /></Screen>;
  if (householdsQuery.isError)
    return <Screen inTabs header={header}><ErrorView message={errorMessage(householdsQuery.error)} onRetry={() => householdsQuery.refetch()} /></Screen>;
  // a bad link, or a household the user has left or was removed from
  if (!isMember)
    return (
      <Screen inTabs header={header}>
        <Placeholder icon="roofing" title="Household not found" text="You're not a member of this household anymore." />
        <Button label="Back to your households" variant="tonal" onPress={back} />
      </Screen>
    );

  const queries = [household, summary, calendar, expenses, categories, members, me, rules];
  const failed = queries.find((q) => q.isError);
  const ready = summary.data && calendar.data && expenses.data && categories.data && members.data && me.data && household.data && rules.data && month && currentMonth && today;

  return (
    <Screen inTabs header={header} refreshing={refreshing} onRefresh={refresh} overlay={<Fab />}>
      {month && currentMonth && <MonthNav month={month} current={currentMonth} onChange={(m) => setViewMonth(m === currentMonth ? null : m)} />}
      {failed ? (
        <Card>
          <ErrorView message={errorMessage(failed.error)} onRetry={() => queries.filter((q) => q.isError).forEach((q) => void q.refetch())} />
        </Card>
      ) : !ready ? (
        <SkeletonCards />
      ) : (
        <>
          <SpendingCard
            // a new month starts with no filter and a short list
            key={month}
            month={month}
            isCurrentMonth={month === currentMonth}
            summary={summary.data}
            expenses={expenses.data}
            categories={categories.data}
            members={members.data}
            householdId={household.data.id}
            myId={me.data.id}
            role={household.data.role}
          />
          <RecurringCard householdId={household.data.id} rules={rules.data} members={members.data} myId={me.data.id} role={household.data.role} />
          <CalendarCard calendar={calendar.data} today={today} categories={categories.data} />
        </>
      )}
    </Screen>
  );
}

function SkeletonCards() {
  return (
    <>
      <Card style={{ height: 220 }}><LoadingView /></Card>
      <Card style={{ height: 300 }} />
    </>
  );
}
