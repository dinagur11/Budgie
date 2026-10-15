import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, type as t } from "../theme";

// a labeled form section for inputs that aren't a TextField (chips, the date picker), with an optional error below
export function Field({ label, error, children }: { label: string; error?: string | null; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {!!error && <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...t.labelMd, color: colors.onSurfaceVariant },
  error: { ...t.bodySm, color: colors.error },
});
