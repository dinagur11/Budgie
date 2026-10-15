import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, radii } from "../theme";

type Tone = "category" | "secondary" | "neutral";

const TONES: Record<Tone, { bg: string; fg: string }> = {
  category: { bg: "rgba(172,151,254,0.4)", fg: colors.onSecondaryContainer }, // secondary-container/40
  secondary: { bg: "rgba(231,222,255,0.5)", fg: colors.secondary }, // secondary-fixed/50
  neutral: { bg: colors.surfaceContainerHigh, fg: colors.onSurfaceVariant },
};

export function Pill({ label, tone = "neutral", rounded = true }: { label: string; tone?: Tone; rounded?: boolean }) {
  const t = TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg, borderRadius: rounded ? radii.pill : 4 }]}>
      <Text style={[styles.text, { color: t.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: 6, paddingVertical: 1, alignSelf: "flex-start", flexShrink: 1 },
  text: { fontFamily: fonts.jakarta600, fontSize: 10, lineHeight: 14 },
});
