import { StyleSheet, Text } from "react-native";
import { Card } from "./Card";
import { Icon, type IconName } from "./Icon";
import { colors, type as t } from "../theme";

// a "coming soon" card for screens that aren't built yet
export function Placeholder({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <Card style={styles.card}>
      <Icon name={icon} size={28} color={colors.secondary} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.text}>{text}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: "center", paddingVertical: 32, gap: 8 },
  title: { ...t.headlineSm, color: colors.onSurface },
  text: { ...t.bodyMd, color: colors.onSurfaceVariant, textAlign: "center" },
});
