import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors, type as t } from "../theme";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";

export function LoadingView({ label = "Loading…" }: { label?: string }) {
  return (
    <View style={styles.box} accessibilityLabel={label}>
      <ActivityIndicator color={colors.secondary} />
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.box}>
      <Icon name="cloud-off" size={24} color={colors.outline} />
      <Text style={styles.text}>{message}</Text>
      <Button label="Try again" variant="tonal" icon="refresh" onPress={onRetry} />
    </View>
  );
}

export function EmptyView({ icon, message }: { icon: IconName; message: string }) {
  return (
    <View style={styles.box}>
      <Icon name={icon} size={22} color={colors.outline} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16 },
  text: { ...t.bodyMd, color: colors.onSurfaceVariant, textAlign: "center" },
});
