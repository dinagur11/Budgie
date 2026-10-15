import { useCallback, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "expo-router";
import { colors, MIN_TOUCH, shadows } from "../theme";
import { Icon } from "./Icon";
import { Wordmark } from "./Wordmark";
import { AccountMenu } from "./AccountMenu";

// The household tabs' back arrow: switch to the Expenses tab and go back to its first screen, the households list.
// `pop` makes the Expenses stack return to the list already in it (a plain navigate would push a second copy).
export function useBackToHouseholds() {
  const navigation = useNavigation<{ navigate: (name: string, params: object) => void }>();
  return useCallback(() => navigation.navigate("(home)", { screen: "index", pop: true }), [navigation]);
}

// The shared top bar: logo (or a back button), an optional center element (the household switcher) and the account menu.
// A solid surface with a faint shadow (the mock's blur is left out on purpose).
export function AppHeader({ center, onBack, backLabel = "Back to your households" }: { center?: ReactNode; onBack?: () => void; backLabel?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <View style={styles.side}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel={backLabel}
              style={({ pressed }) => [styles.back, pressed && { backgroundColor: colors.surfaceContainer }]}
            >
              <Icon name="arrow-back" size={22} color={colors.onSurface} />
            </Pressable>
          ) : (
            <Wordmark />
          )}
        </View>
        <View style={styles.center}>{center}</View>
        <View style={[styles.side, styles.right]}>
          <AccountMenu />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.surface, zIndex: 10, ...shadows.header },
  row: { height: 56, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  side: { flex: 1, flexDirection: "row", alignItems: "center" },
  right: { justifyContent: "flex-end" },
  center: { flexShrink: 1, alignItems: "center" },
  back: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: MIN_TOUCH / 2, alignItems: "center", justifyContent: "center", marginLeft: -8 },
});
