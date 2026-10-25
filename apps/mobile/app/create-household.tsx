import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Screen } from "../src/components/Screen";
import { Card } from "../src/components/Card";
import { TextField } from "../src/components/TextField";
import { Button } from "../src/components/Button";
import { Banner } from "../src/components/Banner";
import { useCreateHousehold } from "../src/api/hooks";
import type { Currency } from "../src/api/types";
import { CurrencyPicker } from "../src/components/CurrencyPicker";
import { errorMessage } from "../src/api/errors";
import { useHouseholdSelection } from "../src/household/HouseholdContext";
import { validateLimit, validateName } from "../src/lib/validate";
import { limitFromInput } from "../src/lib/budget";
import { deviceTimeZone } from "../src/lib/dates";
import { colors, type as t } from "../src/theme";


// POST /households, then the new household becomes the selected one
export default function CreateHouseholdScreen() {
  const { select } = useHouseholdSelection();
  const create = useCreateHousehold();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [timeZone, setTimeZone] = useState(deviceTimeZone);
  const [limit, setLimit] = useState("");
  const [errors, setErrors] = useState<{ name?: string | null; timeZone?: string | null; limit?: string | null }>({});

  async function submit() {
    const next = { name: validateName(name, "Enter a name"), timeZone: timeZone.trim() === "" ? "Enter a time zone" : null, limit: validateLimit(limit) };
    setErrors(next);
    if (next.name || next.timeZone || next.limit) return;
    try {
      const household = await create.mutateAsync({ name: name.trim(), defaultCurrency: currency, timeZone: timeZone.trim(), monthlyLimit: limitFromInput(limit) });
      select(household.id);
      router.back();
    } catch {
      // shown from create.error below
    }
  }

  return (
    <Screen>
      <Card style={styles.card}>
        <Text style={styles.title}>Create household</Text>
        {create.isError && <Banner message={errorMessage(create.error)} />}
        <TextField label="Name" value={name} onChangeText={setName} error={errors.name} maxLength={100} autoFocus returnKeyType="done" />
        <View style={{ gap: 6 }}>
          <CurrencyPicker value={currency} onChange={setCurrency} />
          <Text style={styles.hint}>Pre-fills new expenses. Each expense still has its own currency.</Text>
        </View>
        <TextField label="Monthly limit (optional)" value={limit} onChangeText={setLimit} error={errors.limit} keyboardType="decimal-pad" placeholder="No limit" />
        <Text style={styles.hint}>In {currency}. Only expenses in {currency} count toward it. Leave empty for no limit.</Text>
        <TextField
          label="Time zone"
          value={timeZone}
          onChangeText={setTimeZone}
          error={errors.timeZone}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.hint}>From this device. It decides when a day ends for the whole household.</Text>
        <Button label="Create" onPress={submit} loading={create.isPending} />
        <Button label="Cancel" variant="text" onPress={() => router.back()} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 14 },
  title: { ...t.headlineMd, color: colors.onSurface },
  hint: { ...t.bodySm, color: colors.onSurfaceVariant, marginTop: -6 },
});
