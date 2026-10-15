import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import { Screen } from "../src/components/Screen";
import { Card } from "../src/components/Card";
import { TextField } from "../src/components/TextField";
import { Button } from "../src/components/Button";
import { Banner } from "../src/components/Banner";
import { useCreateCategory } from "../src/api/hooks";
import { errorMessage } from "../src/api/errors";
import { useHouseholdSelection } from "../src/household/HouseholdContext";
import { validateName } from "../src/lib/validate";
import { colors, type as t } from "../src/theme";

// POST /households/:id/categories for the selected household (any member)
export default function CreateCategoryScreen() {
  const { selectedId } = useHouseholdSelection();
  return (
    <Screen>
      <Card style={styles.card}>
        <Text style={styles.title}>Create category</Text>
        {selectedId === null ? <Text style={styles.hint}>Create a household first.</Text> : <CategoryForm householdId={selectedId} />}
        <Button label="Cancel" variant="text" onPress={() => router.back()} />
      </Card>
    </Screen>
  );
}

function CategoryForm({ householdId }: { householdId: number }) {
  const create = useCreateCategory(householdId);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const next = validateName(name, "Enter a name");
    setError(next);
    if (next) return;
    try {
      await create.mutateAsync(name.trim());
      router.back();
    } catch {
      // shown from create.error below (for example a name that already exists)
    }
  }

  return (
    <>
      {create.isError && <Banner message={errorMessage(create.error)} />}
      <TextField label="Name" value={name} onChangeText={setName} error={error} maxLength={100} autoFocus returnKeyType="done" onSubmitEditing={submit} />
      <Text style={styles.hint}>Everyone in the household can use it. Names must be different from the built-in categories.</Text>
      <Button label="Create category" onPress={submit} loading={create.isPending} />
    </>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 14 },
  title: { ...t.headlineMd, color: colors.onSurface },
  hint: { ...t.bodySm, color: colors.onSurfaceVariant, marginTop: -6 },
});
