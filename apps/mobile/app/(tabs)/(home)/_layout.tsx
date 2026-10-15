import { Stack } from "expo-router";
import { colors } from "../../../src/theme";

// the Expenses tab: the list of the user's households, and one household's screen on top of it
export const unstable_settings = { initialRouteName: "index" };

export default function HomeLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />;
}
