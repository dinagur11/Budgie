import { useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, useIsFocused } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../../../src/components/Button";
import { Placeholder } from "../../../src/components/Placeholder";
import { Screen } from "../../../src/components/Screen";
import { SearchField } from "../../../src/components/SearchField";
import { EmptyView, ErrorView, LoadingView } from "../../../src/components/StateViews";
import { HomeBar } from "../../../src/home/HomeBar";
import { HomeTop } from "../../../src/home/HomeTop";
import { HouseholdCard } from "../../../src/home/HouseholdCard";
import { useHouseholdSelection } from "../../../src/household/HouseholdContext";
import { errorMessage } from "../../../src/api/errors";
import { colors, type as t } from "../../../src/theme";

// Home: a greeting with what the user paid this month across all households (the colored top section), then every
// household they are an active member of, searchable by name, with what each has spent so far this month.
// No tab bar here (TabBar hides itself on "/"; the tabs belong to an open household): a small bar with settings,
// "+" (create a household) and profile instead. Tapping a household selects it (the other tabs follow) and opens it.
export default function HouseholdsScreen() {
  const queryClient = useQueryClient();
  const focused = useIsFocused();
  const { households, select, query } = useHouseholdSelection();
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.all([query.refetch(), queryClient.invalidateQueries({ queryKey: ["household"] }), queryClient.invalidateQueries({ queryKey: ["me"] })]);
    } finally {
      setRefreshing(false);
    }
  }

  function open(id: number) {
    select(id);
    router.push({ pathname: "/household/[id]", params: { id: String(id) } });
  }

  const shell = (children: ReactNode, withRefresh = true) => (
    <>
      {/* white status bar text on the colored top section, only while this screen is showing */}
      {focused && <StatusBar style="light" />}
      <Screen
        top={<HomeTop householdCount={households?.length ?? 0} />}
        footer={<HomeBar />}
        refreshing={withRefresh ? refreshing : undefined}
        onRefresh={withRefresh ? refresh : undefined}
      >
        {children}
      </Screen>
    </>
  );

  if (query.isPending) return shell(<LoadingView />, false);
  if (query.isError) return shell(<ErrorView message={errorMessage(query.error)} onRetry={() => query.refetch()} />, false);
  if (!households || households.length === 0)
    return shell(
      <>
        <Placeholder icon="roofing" title="No household yet" text="Create a household to start tracking expenses together." />
        <Button label="Create household" icon="add" onPress={() => router.push("/create-household")} />
      </>,
    );

  const term = search.trim().toLocaleLowerCase();
  const shown = term === "" ? households : households.filter((h) => h.name.toLocaleLowerCase().includes(term));

  return shell(
    <>
      <View style={styles.heading}>
        <Text style={styles.title}>Your households</Text>
        <Text style={styles.subtitle}>What each household has spent so far this month</Text>
      </View>
      <SearchField value={search} onChangeText={setSearch} placeholder="Search households by name" />
      <View style={styles.list}>
        {shown.map((h) => (
          <HouseholdCard key={h.householdId} household={h} onPress={() => open(h.householdId)} />
        ))}
        {shown.length === 0 && <EmptyView icon="search-off" message={`No household matches "${search.trim()}"`} />}
      </View>
    </>,
  );
}

const styles = StyleSheet.create({
  heading: { paddingHorizontal: 4, gap: 2 },
  list: { gap: 14, marginTop: 4 },
  title: { ...t.headlineSm, fontSize: 20, lineHeight: 26, color: colors.onSurface },
  subtitle: { ...t.bodySm, color: colors.onSurfaceVariant },
});
