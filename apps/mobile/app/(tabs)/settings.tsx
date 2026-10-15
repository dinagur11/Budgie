import { useState } from "react";
import { Alert, StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import { AppHeader, useBackToHouseholds } from "../../src/components/AppHeader";
import { Banner } from "../../src/components/Banner";
import { Button } from "../../src/components/Button";
import { Card } from "../../src/components/Card";
import { CurrencyPicker } from "../../src/components/CurrencyPicker";
import { HouseholdSwitcher } from "../../src/components/HouseholdSwitcher";
import { Placeholder } from "../../src/components/Placeholder";
import { Screen } from "../../src/components/Screen";
import { ErrorView, LoadingView } from "../../src/components/StateViews";
import { TextField } from "../../src/components/TextField";
import { CategoriesCard } from "../../src/settings/CategoriesCard";
import { useHouseholdSelection } from "../../src/household/HouseholdContext";
import { useDeleteHousehold, useHousehold, useLeaveHousehold, useUpdateHousehold, type HouseholdUpdate } from "../../src/api/hooks";
import type { Currency, Household } from "../../src/api/types";
import { errorMessage } from "../../src/api/errors";
import { validateName } from "../../src/lib/validate";
import { colors, type as t } from "../../src/theme";

// Settings of the selected household: an owner edits its name, default currency and time zone, manages the
// household's categories, or deletes it; a member can leave it. Log out is in the account menu (AppHeader).
export default function SettingsScreen() {
  const back = useBackToHouseholds();
  const { selectedId } = useHouseholdSelection();
  const household = useHousehold(selectedId);

  return (
    <Screen inTabs header={<AppHeader onBack={back} center={selectedId !== null ? <HouseholdSwitcher /> : undefined} />}>
      {selectedId === null ? (
        <Placeholder icon="settings" title="No household yet" text="Create a household to change its settings here." />
      ) : household.isError ? (
        <Card><ErrorView message={errorMessage(household.error)} onRetry={() => household.refetch()} /></Card>
      ) : !household.data ? (
        <LoadingView />
      ) : household.data.role === "OWNER" ? (
        <>
          {/* keyed by id so switching households resets the form */}
          <HouseholdForm key={household.data.id} household={household.data} />
          <CategoriesCard key={`categories-${household.data.id}`} household={household.data} />
          <DeleteHousehold household={household.data} />
        </>
      ) : (
        <LeaveHousehold household={household.data} />
      )}
    </Screen>
  );
}

// PATCH /households/:id with only the fields that changed
function HouseholdForm({ household }: { household: Household }) {
  const update = useUpdateHousehold(household.id);
  const [name, setName] = useState(household.name);
  const [currency, setCurrency] = useState<Currency>(household.defaultCurrency);
  const [timeZone, setTimeZone] = useState(household.timeZone);
  const [errors, setErrors] = useState<{ name?: string | null; timeZone?: string | null }>({});
  const [saved, setSaved] = useState(false);

  const changes: HouseholdUpdate = {};
  if (name.trim() !== household.name) changes.name = name.trim();
  if (currency !== household.defaultCurrency) changes.defaultCurrency = currency;
  if (timeZone.trim() !== household.timeZone) changes.timeZone = timeZone.trim();
  const dirty = Object.keys(changes).length > 0;

  async function save() {
    const next = { name: validateName(name, "Enter a name"), timeZone: timeZone.trim() === "" ? "Enter a time zone" : null };
    setErrors(next);
    setSaved(false);
    if (next.name || next.timeZone || !dirty) return;
    try {
      const result = await update.mutateAsync(changes);
      // the server normalizes the time zone's spelling
      setName(result.name);
      setTimeZone(result.timeZone);
      setSaved(true);
    } catch {
      // shown from update.error below
    }
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Household</Text>
      {update.isError && <Banner message={errorMessage(update.error)} />}
      {saved && !dirty && <Banner tone="success" message="Changes saved" />}
      <TextField label="Name" value={name} onChangeText={setName} error={errors.name} maxLength={100} returnKeyType="done" />
      <CurrencyPicker value={currency} onChange={setCurrency} />
      <Text style={styles.hint}>Pre-fills new expenses. Each expense still has its own currency.</Text>
      <TextField label="Time zone" value={timeZone} onChangeText={setTimeZone} error={errors.timeZone} autoCapitalize="none" autoCorrect={false} />
      <Text style={styles.hint}>An IANA name such as Asia/Jerusalem. It decides when a day ends for the whole household.</Text>
      <Button label="Save changes" onPress={save} loading={update.isPending} disabled={!dirty} />
    </Card>
  );
}

// the household is gone afterwards, so the user goes back to the households list
function afterExit() {
  router.replace("/");
}

function DeleteHousehold({ household }: { household: Household }) {
  const remove = useDeleteHousehold(household.id);
  function confirm() {
    Alert.alert(
      `Delete ${household.name}?`,
      "This deletes the household for everyone, with all its expenses, recurring expenses, categories and invites. It can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => remove.mutate(undefined, { onSuccess: afterExit }) },
      ],
    );
  }
  return (
    <Card style={styles.card}>
      {remove.isError && <Banner message={errorMessage(remove.error)} />}
      <Button label="Delete household" variant="danger" icon="delete-outline" onPress={confirm} loading={remove.isPending} />
    </Card>
  );
}

function LeaveHousehold({ household }: { household: Household }) {
  const leave = useLeaveHousehold(household.id);
  function confirm() {
    Alert.alert(
      `Leave ${household.name}?`,
      "You'll lose access to its expenses. Your expenses stay in the household. An owner can invite you back.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: () => leave.mutate(undefined, { onSuccess: afterExit }) },
      ],
    );
  }
  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{household.name}</Text>
      {leave.isError && <Banner message={errorMessage(leave.error)} />}
      <Button label="Leave household" variant="danger" icon="logout" onPress={confirm} loading={leave.isPending} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 14 },
  title: { ...t.headlineSm, color: colors.onSurface },
  hint: { ...t.bodySm, color: colors.onSurfaceVariant, marginTop: -8 },
});
