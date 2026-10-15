import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useHouseholdSelection } from "../household/HouseholdContext";
import { colors, fonts, MIN_TOUCH, radii, shadows, type as t } from "../theme";
import { Icon } from "./Icon";

// the header pill with the current household's name; opens a bottom sheet listing the user's households.
// onSelect runs after the selection changes (the household screen uses it to show the chosen household).
export function HouseholdSwitcher({ onSelect }: { onSelect?: (id: number) => void } = {}) {
  const { households, selectedId, select } = useHouseholdSelection();
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const current = households?.find((h) => h.householdId === selectedId);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Household: ${current?.name ?? "none"}. Switch household`}
        hitSlop={{ top: 10, bottom: 10 }}
        style={({ pressed }) => [styles.pill, pressed && { backgroundColor: colors.surfaceContainer }]}
      >
        <Icon name="roofing" size={16} color={colors.secondary} />
        <Text style={styles.pillText} numberOfLines={1}>{current?.name ?? "Households"}</Text>
        <Icon name="expand-more" size={16} color={colors.outline} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)} statusBarTranslucent navigationBarTranslucent>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close" accessibilityRole="button" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />
          <Text style={styles.title}>Your households</Text>
          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 6 }}>
            {(households ?? []).map((h) => {
              const active = h.householdId === selectedId;
              return (
                <Pressable
                  key={h.householdId}
                  onPress={() => { select(h.householdId); setOpen(false); onSelect?.(h.householdId); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [styles.item, active && styles.itemActive, pressed && { opacity: 0.85 }]}
                >
                  <Icon name="roofing" size={18} color={active ? colors.secondary : colors.outline} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName} numberOfLines={1}>{h.name}</Text>
                    <Text style={styles.itemRole}>{h.role === "OWNER" ? "Owner" : "Member"}</Text>
                  </View>
                  {active && <Icon name="check-circle" size={18} color={colors.secondary} />}
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            onPress={() => { setOpen(false); router.push("/create-household"); }}
            accessibilityRole="button"
            style={({ pressed }) => [styles.item, styles.create, pressed && { opacity: 0.85 }]}
          >
            <Icon name="add" size={18} color={colors.accent} />
            <Text style={[styles.itemName, { color: colors.accent }]}>Create household</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4, paddingHorizontal: 10, borderRadius: radii.pill,
    backgroundColor: colors.surfaceContainerLowest, ...shadows.card,
  },
  pillText: { fontFamily: fonts.jakarta700, fontSize: 12, lineHeight: 16, color: colors.onSurface, maxWidth: 110 },
  backdrop: { flex: 1, backgroundColor: "rgba(13,29,43,0.35)" },
  sheet: {
    backgroundColor: colors.surfaceContainerLowest, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 16, paddingTop: 8, gap: 10, ...shadows.floating,
  },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colors.outlineVariant, marginBottom: 4 },
  title: { ...t.headlineSm, color: colors.onSurface },
  item: { minHeight: MIN_TOUCH + 8, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, borderRadius: radii.row, backgroundColor: colors.surfaceContainerLow },
  itemActive: { backgroundColor: colors.secondaryFixed },
  itemName: { ...t.labelLg, color: colors.onSurface },
  itemRole: { ...t.bodySm, color: colors.onSurfaceVariant },
  create: { backgroundColor: colors.surface },
});
