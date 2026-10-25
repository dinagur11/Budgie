import { Tabs } from "expo-router";
import { TabBar } from "../../src/components/TabBar";
import { colors } from "../../src/theme";

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.surface } }}>
      <Tabs.Screen name="(home)" />
      <Tabs.Screen name="members" />
      <Tabs.Screen name="analytics" />
      <Tabs.Screen name="ask-ai" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
