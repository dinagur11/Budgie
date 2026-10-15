import { Pressable, StyleSheet, Text, View } from "react-native";
import { addMonths, monthLabel, monthName } from "../lib/dates";
import { colors, fonts, MIN_TOUCH, radii } from "../theme";
import { Icon } from "../components/Icon";

// "← September  October 2026  November →" above the household's month: back through past months, forward up to
// the household's current month (no further: the future has no expenses yet). The backend's dates start in 2000.
export function MonthNav({ month, current, onChange }: { month: string; current: string; onChange: (month: string) => void }) {
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  return (
    <View style={styles.row}>
      {/* three equal columns keep the month centered whether or not both buttons are there */}
      <View style={[styles.side, { alignItems: "flex-start" }]}>
        {prev >= "2000-01" && <NavButton label={monthName(prev)} side="left" onPress={() => onChange(prev)} accessibilityLabel={`Show ${monthLabel(prev)}`} />}
      </View>
      <Text style={styles.current} accessibilityRole="header" numberOfLines={1}>{monthLabel(month)}</Text>
      <View style={[styles.side, { alignItems: "flex-end" }]}>
        {month < current && <NavButton label={monthName(next)} side="right" onPress={() => onChange(next)} accessibilityLabel={`Show ${monthLabel(next)}`} />}
      </View>
    </View>
  );
}

function NavButton({ label, side, onPress, accessibilityLabel }: { label: string; side: "left" | "right"; onPress: () => void; accessibilityLabel: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.button, pressed && { backgroundColor: colors.surfaceContainerHigh }]}
    >
      {side === "left" && <Icon name="arrow-back" size={16} color={colors.secondary} />}
      <Text style={styles.buttonText}>{label}</Text>
      {side === "right" && <Icon name="arrow-forward" size={16} color={colors.secondary} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8, marginBottom: 2 },
  side: { flex: 1 },
  button: {
    minHeight: MIN_TOUCH, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.surfaceContainerLow,
  },
  buttonText: { fontFamily: fonts.jakarta700, fontSize: 12, lineHeight: 16, color: colors.secondary },
  current: { flexShrink: 0, fontFamily: fonts.jakarta700, fontSize: 14, lineHeight: 18, color: colors.onSurface, textAlign: "center" },
});
