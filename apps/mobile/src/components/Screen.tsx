import type { ReactNode } from "react";
import { KeyboardAvoidingView, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "../theme";

type Props = {
  children: ReactNode;
  // a fixed header above the scrolling content (it handles the top safe area itself)
  header?: ReactNode;
  // inside the tab navigator the tab bar already covers the bottom safe area
  inTabs?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  centered?: boolean;
  // drawn above the content (for example the FAB), outside the scroll view
  overlay?: ReactNode;
  // full-width content at the top of the scroll view, edge to edge and under the status bar (it handles the top safe area itself)
  top?: ReactNode;
  // a bar under the scroll view, outside it (it handles the bottom safe area itself)
  footer?: ReactNode;
};

// Safe areas, keyboard avoiding and scrolling; content is centered with a max width of 384 and 12dp gutters.
export function Screen({ children, header, inTabs = false, refreshing, onRefresh, centered = false, overlay, top, footer }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      {header}
      {/* Android draws edge to edge, so the keyboard is avoided with padding */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: header ? 2 : top ? 0 : insets.top + spacing.xl,
              paddingBottom: (inTabs || footer ? 0 : insets.bottom) + (footer ? 24 : 96),
            },
            centered && styles.centered,
          ]}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.secondary]} /> : undefined}
        >
          {top && <View style={styles.top}>{top}</View>}
          <View style={styles.column}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
      {footer}
      {overlay}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: spacing.gutter },
  centered: { justifyContent: "center" },
  // cancels the content gutter so the top section reaches both edges
  top: { marginHorizontal: -spacing.gutter, marginBottom: spacing.lg },
  column: { width: "100%", maxWidth: spacing.maxContentWidth, alignSelf: "center", gap: 10 },
});
