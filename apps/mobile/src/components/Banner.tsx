import { StyleSheet, Text, View } from "react-native";
import { colors, radii, type as t } from "../theme";
import { Icon } from "./Icon";

// a general message above a form: an error (errorContainer) or a confirmation
export function Banner({ message, tone = "error" }: { message: string; tone?: "error" | "success" }) {
  const error = tone === "error";
  return (
    <View style={[styles.banner, { backgroundColor: error ? colors.errorContainer : colors.surfaceContainerLow }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <Icon name={error ? "error-outline" : "check-circle"} size={18} color={error ? colors.onErrorContainer : colors.primary} />
      <Text style={[styles.text, { color: error ? colors.onErrorContainer : colors.onSurface }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: "row", gap: 8, alignItems: "flex-start", padding: 12, borderRadius: radii.row },
  text: { flex: 1, ...t.bodyMd },
});
