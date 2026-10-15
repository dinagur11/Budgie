import { Stack } from "expo-router";
import { colors } from "../../src/theme";

// welcome first, so a signed-out user (and one who just signed out) lands on it; login and register open on top of it
export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="confirm" />
    </Stack>
  );
}
