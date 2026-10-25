import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ComponentProps } from "react";
import { usePathname, type Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, shadows } from "../theme";
import { Icon, OutlineIcon, type IconName, type OutlineIconName } from "./Icon";

// the props expo-router passes to a custom tab bar (React Navigation's BottomTabBarProps)
export type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

const TABS: Record<string, { label: string; icon: IconName | { outline: OutlineIconName } }> = {
  "(home)": { label: "Expenses", icon: "payments" },
  members: { label: "Members", icon: "diversity-1" },
  analytics: { label: "Analytics", icon: { outline: "chart-pie-outline" } },
  "ask-ai": { label: "Ask AI", icon: "auto-awesome" },
  settings: { label: "Settings", icon: { outline: "cog-outline" } },
};

// the mock's bottom bar: the active tab is blue on a light blue pill
// Hidden on the households list ("/"): the tabs belong to one household and appear once one is open.
export function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  if (pathname === "/") return null;
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom }]}>
      <View style={styles.row}>
        {state.routes.map((route, index) => {
          const tab = TABS[route.name];
          if (!tab) return null;
          const focused = state.index === index;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={tab.label}
              onPress={() => {
                // pressing the tab you're on does nothing: a stack tab (Expenses) pops back to its first screen,
                // the households list, when it gets a tabPress while focused, so the event is only sent on a change
                if (focused) return;
                const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (!event.defaultPrevented) navigation.navigate(route.name);
              }}
              style={[styles.tab, focused && styles.tabActive]}
            >
              {typeof tab.icon === "string" ? (
                <Icon name={tab.icon} size={22} color={focused ? colors.accent : colors.onSurfaceVariant} />
              ) : (
                <OutlineIcon name={tab.icon.outline} size={22} color={focused ? colors.accent : colors.onSurfaceVariant} />
              )}
              <Text style={[styles.label, { color: focused ? colors.accent : colors.onSurfaceVariant, fontFamily: focused ? fonts.jakarta700 : fonts.jakarta500 }]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.surface, ...shadows.header, shadowOffset: { width: 0, height: -2 } },
  row: { height: 64, flexDirection: "row", justifyContent: "space-around", alignItems: "center", paddingHorizontal: 4 },
  tab: { minWidth: 64, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 2 },
  tabActive: { backgroundColor: colors.accentSoft },
  label: { fontSize: 10, lineHeight: 14, letterSpacing: 0.4 },
});
