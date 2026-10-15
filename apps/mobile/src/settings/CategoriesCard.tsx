import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Pill } from "../components/Pill";
import { TextField } from "../components/TextField";
import { ErrorView, LoadingView } from "../components/StateViews";
import { useCategories, useDeleteCategory, useUpdateCategory } from "../api/hooks";
import type { Category, Household } from "../api/types";
import { errorMessage } from "../api/errors";
import { categoryColor } from "../lib/categoryColors";
import { validateName } from "../lib/validate";
import { colors, MIN_TOUCH, type as t } from "../theme";

// The owner's category settings: built-ins are listed without actions; the household's own categories can be
// renamed, archived (kept on old expenses, hidden from the picker) or deleted (only when nothing uses them).
export function CategoriesCard({ household }: { household: Household }) {
  const categories = useCategories(household.id);
  const update = useUpdateCategory(household.id);
  const remove = useDeleteCategory(household.id);
  const [editing, setEditing] = useState<number | null>(null);

  // one banner for whichever action failed last
  const failed = [update, remove].find((m) => m.isError);
  const reset = () => { update.reset(); remove.reset(); };

  function confirmDelete(c: Category) {
    reset();
    Alert.alert(
      `Delete ${c.name}?`,
      "Only a category that no expense or recurring expense uses can be deleted. Archive it to hide it instead.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => remove.mutate(c.id) },
      ],
    );
  }

  const builtIns = categories.data?.filter((c) => c.isBuiltIn) ?? [];
  const own = categories.data?.filter((c) => !c.isBuiltIn) ?? [];
  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Categories</Text>
      {categories.isError ? (
        <ErrorView message={errorMessage(categories.error)} onRetry={() => categories.refetch()} />
      ) : !categories.data ? (
        <LoadingView />
      ) : (
        <>
          {failed && <Banner message={errorMessage(failed.error)} />}
          <Text style={styles.label}>Your categories</Text>
          {own.length === 0 && <Text style={styles.hint}>No categories of your own yet.</Text>}
          {own.map((c) =>
            editing === c.id ? (
              <RenameRow
                key={c.id}
                category={c}
                saving={update.isPending}
                onCancel={() => setEditing(null)}
                onSave={(name) => {
                  reset();
                  update.mutate({ categoryId: c.id, name }, { onSuccess: () => setEditing(null) });
                }}
              />
            ) : (
              <View key={c.id} style={styles.row}>
                <View style={[styles.dot, { backgroundColor: categoryColor(c.id) }, c.isArchived && styles.archivedDot]} />
                <View style={styles.nameBox}>
                  <Text style={[styles.name, c.isArchived && styles.archivedText]} numberOfLines={1}>{c.name}</Text>
                  {c.isArchived && <Pill label="Archived" />}
                </View>
                <View style={styles.actions}>
                  <Action label="Rename" onPress={() => { reset(); setEditing(c.id); }} />
                  <Action
                    label={c.isArchived ? "Unarchive" : "Archive"}
                    onPress={() => { reset(); update.mutate({ categoryId: c.id, isArchived: !c.isArchived }); }}
                  />
                  <Action label="Delete" danger onPress={() => confirmDelete(c)} />
                </View>
              </View>
            ),
          )}
          <Button label="Create category" variant="tonal" icon="add" onPress={() => router.push("/create-category")} />

          <Text style={[styles.label, { marginTop: 4 }]}>Built-in</Text>
          <View style={styles.builtIns}>
            {builtIns.map((c) => <Pill key={c.id} label={c.name} />)}
          </View>
          <Text style={styles.hint}>Built-in categories are the same in every household and can't be changed.</Text>
        </>
      )}
    </Card>
  );
}

function RenameRow({ category, saving, onSave, onCancel }: { category: Category; saving: boolean; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(category.name);
  const [error, setError] = useState<string | null>(null);
  function save() {
    const next = validateName(name, "Enter a name");
    setError(next);
    if (next) return;
    if (name.trim() === category.name) return onCancel();
    onSave(name.trim());
  }
  return (
    <View style={styles.renameBox}>
      <TextField label={`Rename ${category.name}`} value={name} onChangeText={setName} error={error} maxLength={100} autoFocus returnKeyType="done" onSubmitEditing={save} />
      <View style={styles.renameButtons}>
        <Button label="Cancel" variant="text" onPress={onCancel} />
        <Button label="Save" variant="tonal" onPress={save} loading={saving} />
      </View>
    </View>
  );
}

function Action({ label, onPress, danger = false }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      hitSlop={(MIN_TOUCH - 24) / 2}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
    >
      <Text style={[styles.actionText, danger && { color: colors.error }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 12 },
  title: { ...t.headlineSm, color: colors.onSurface },
  label: { ...t.labelMd, color: colors.onSurfaceVariant },
  hint: { ...t.bodySm, color: colors.onSurfaceVariant },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, flexWrap: "wrap" },
  dot: { width: 10, height: 10, borderRadius: 5 },
  archivedDot: { opacity: 0.4 },
  nameBox: { flex: 1, minWidth: 120, flexDirection: "row", alignItems: "center", gap: 6 },
  name: { ...t.labelLg, color: colors.onSurface, flexShrink: 1 },
  archivedText: { color: colors.outline },
  actions: { flexDirection: "row", gap: 14 },
  action: { minHeight: 24, justifyContent: "center" },
  actionText: { ...t.labelMd, color: colors.accent },
  renameBox: { gap: 4 },
  renameButtons: { flexDirection: "row", justifyContent: "flex-end", gap: 4 },
  builtIns: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});
