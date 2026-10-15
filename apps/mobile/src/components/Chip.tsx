import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts, MIN_TOUCH, radii } from "../theme";

// one choice in a row of chips (currency, category, payer); an optional colored dot (a category's color)
export function Chip({ label, active, onPress, dot }: { label: string; active: boolean; onPress: () => void; dot?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.chip, active && styles.active, pressed && !active && { opacity: 0.8 }]}
    >
      {dot && <View style={[styles.dot, { backgroundColor: dot }, active && styles.dotActive]} />}
      <Text style={[styles.text, active && { color: colors.onSecondary }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minWidth: 60, minHeight: MIN_TOUCH, maxWidth: "100%", borderRadius: radii.pill, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 6, backgroundColor: colors.surfaceContainerLow, paddingHorizontal: 12,
  },
  active: { backgroundColor: colors.secondary },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotActive: { borderWidth: 1, borderColor: colors.onSecondary },
  text: { fontFamily: fonts.jakarta700, fontSize: 12, color: colors.onSurface, flexShrink: 1 },
});
