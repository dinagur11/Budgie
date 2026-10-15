import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useIsFocused } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, radii, type as t } from "../theme";
import { Wordmark } from "./Wordmark";

// The signed-out screens' top section, matching the home screen's (HomeTop): edge to edge in the secondary color,
// rounded bottom corners, the white wordmark in the top right, a title and a subtitle. `children` go in a lighter block.
// Pass it to Screen as `top`.
export function AuthTop({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  return (
    <View style={[styles.top, { paddingTop: insets.top + 12 }]}>
      {/* white status bar text on the colored section, only while this screen is showing */}
      {focused && <StatusBar style="light" />}
      <View style={styles.brandRow}><Wordmark light /></View>
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {children && <View style={styles.block}>{children}</View>}
    </View>
  );
}

// text styles for content inside the block
export const authTopText = StyleSheet.create({
  strong: { fontFamily: fonts.jakarta700, fontSize: 14, lineHeight: 18, color: colors.onSecondary },
  muted: { ...t.bodySm, color: colors.panelMuted },
});

const styles = StyleSheet.create({
  top: {
    backgroundColor: colors.secondary, paddingHorizontal: 20, paddingBottom: 24, gap: 6,
    borderBottomLeftRadius: radii.card * 2, borderBottomRightRadius: radii.card * 2,
  },
  brandRow: { flexDirection: "row", justifyContent: "flex-end", minHeight: 44, alignItems: "center" },
  title: { marginTop: 2, fontFamily: fonts.jakarta800, fontSize: 22, lineHeight: 28, letterSpacing: -0.3, color: colors.onSecondary },
  subtitle: { ...t.bodyMd, color: colors.panelMuted },
  block: {
    marginTop: 10, backgroundColor: "rgba(255,255,255,0.13)", borderRadius: radii.card, paddingHorizontal: 16, paddingVertical: 14, gap: 14,
  },
});
