import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, OutlineIcon, type OutlineIconName } from "../components/Icon";
import { colors, fonts, MIN_TOUCH, shadows } from "../theme";

// The households list's small bottom bar (the tab bar belongs to an open household): the account settings, a raised "+" that
// creates a household, and the profile (what the user paid across households).
export function HomeBar() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom }]}>
      <View style={styles.row}>
        <BarItem label="Settings" icon="cog-outline" onPress={() => router.push("/account-settings")} />
        <Pressable
          onPress={() => router.push("/create-household")}
          accessibilityRole="button"
          accessibilityLabel="Create household"
          style={({ pressed }) => [styles.plus, pressed && { transform: [{ scale: 0.95 }] }]}
        >
          <Icon name="add" size={34} color={colors.onSecondary} />
        </Pressable>
        <BarItem label="Profile" icon="account-circle-outline" onPress={() => router.push("/profile")} />
      </View>
    </View>
  );
}

function BarItem({ label, icon, onPress }: { label: string; icon: OutlineIconName; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]}>
      <OutlineIcon name={icon} size={22} color={colors.onSurfaceVariant} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.surfaceContainerLowest, ...shadows.header, shadowOffset: { width: 0, height: -2 } },
  row: { height: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingHorizontal: 24 },
  item: { minWidth: 72, minHeight: MIN_TOUCH, alignItems: "center", justifyContent: "center", gap: 2 },
  label: { fontFamily: fonts.jakarta600, fontSize: 10, lineHeight: 14, letterSpacing: 0.4, color: colors.onSurfaceVariant },
  // the top edge stays where the old 52dp button's was (9dp above the bar); it now reaches down to the bar's bottom edge
  plus: {
    width: 64, height: 64, borderRadius: 32, marginTop: -10, backgroundColor: colors.secondary,
    alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: colors.surface, ...shadows.floating,
  },
});
