import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Icon, type IconName } from "../components/Icon";
import { colors, fonts, shadows } from "../theme";

// the add button with its menu: photograph a receipt (scan-receipt), create a recurring expense
// or an expense (for the selected household). Categories are created from the expense forms and the household settings.
export function Fab() {
  const [open, setOpen] = useState(false);
  const go = (href: "/create-expense" | "/scan-receipt" | "/create-rule") => {
    setOpen(false);
    router.push(href);
  };
  return (
    <>
      {open && <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel="Close menu" />}
      <View style={styles.container} pointerEvents="box-none">
        {open && (
          <View style={styles.menu}>
            {/* top to bottom: create expense, photograph receipt, create recurring expense */}
            <MenuItem label="Create Expense" icon="receipt-long" onPress={() => go("/create-expense")} />
            <MenuItem label="Photograph Receipt" icon="photo-camera" onPress={() => go("/scan-receipt")} />
            <MenuItem label="Create Recurring Expense" icon="update" onPress={() => go("/create-rule")} />
          </View>
        )}
        <Pressable
          onPress={() => setOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={open ? "Close add menu" : "Add an expense"}
          accessibilityState={{ expanded: open }}
          style={({ pressed }) => [styles.fab, pressed && { transform: [{ scale: 0.95 }] }]}
        >
          <View style={open && { transform: [{ rotate: "45deg" }] }}><Icon name="add" size={24} color={colors.onSecondary} /></View>
        </Pressable>
      </View>
    </>
  );
}

function MenuItem({ label, icon, onPress }: { label: string; icon: IconName; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.secondaryFixed }]}>
      <Text style={styles.itemText}>{label}</Text>
      <View style={styles.itemIcon}><Icon name={icon} size={18} color={colors.secondary} /></View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { position: "absolute", right: 16, bottom: 16, alignItems: "flex-end", gap: 10 },
  menu: { alignItems: "flex-end", gap: 10 },
  fab: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.secondary, alignItems: "center", justifyContent: "center", ...shadows.floating },
  item: {
    flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 16, paddingRight: 8, minHeight: 48, borderRadius: 9999,
    backgroundColor: colors.surfaceContainerLowest, ...shadows.floating,
  },
  itemText: { fontFamily: fonts.jakarta700, fontSize: 12, lineHeight: 16, letterSpacing: 0.24, color: colors.onSecondaryContainer },
  itemIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.secondaryFixed, alignItems: "center", justifyContent: "center" },
});
