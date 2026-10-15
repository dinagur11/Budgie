import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, MIN_TOUCH, radii, type as t } from "../theme";
import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "tonal" | "text" | "danger";

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  accessibilityHint?: string;
  // a 28dp visual (touch area still 44dp through hitSlop)
  compact?: boolean;
};

// primary = the secondary color (like the FAB); tonal = light surface (the mock's "open calendar view"); text = a link;
// danger = red, for actions that can't be undone (delete, leave)
export function Button({ label, onPress, variant = "primary", loading = false, disabled = false, icon, accessibilityHint, compact = false }: Props) {
  const inactive = disabled || loading;
  const filled = variant === "primary" || variant === "danger";
  const fg = filled ? colors.onSecondary : colors.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      hitSlop={compact ? (MIN_TOUCH - 28) / 2 : undefined}
      style={({ pressed }) => [
        styles.base,
        variant === "primary" && styles.primary,
        variant === "tonal" && styles.tonal,
        variant === "danger" && styles.danger,
        variant === "text" && styles.text,
        compact && styles.compact,
        disabled && !loading && styles.disabled,
        pressed && !inactive && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.content}>
          <Text style={[filled ? t.labelLg : styles.smallLabel, { color: fg }]}>{label}</Text>
          {icon && <Icon name={icon} size={16} color={fg} />}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: MIN_TOUCH, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  primary: { backgroundColor: colors.secondary, borderRadius: radii.pill, minHeight: 48 },
  danger: { backgroundColor: colors.error, borderRadius: radii.pill, minHeight: 48 },
  tonal: { backgroundColor: colors.surfaceContainerLow, borderRadius: radii.pill },
  compact: { minHeight: 28, paddingHorizontal: 12 },
  text: { backgroundColor: "transparent" },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  content: { flexDirection: "row", alignItems: "center", gap: 6 },
  smallLabel: { ...t.labelMd, fontSize: 12 },
});
