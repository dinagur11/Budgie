import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSession } from "../auth/session";
import { colors, fonts, MIN_TOUCH } from "../theme";
import { BirdIcon } from "./Icon";

// Text wordmark (the mock's logo image is not usable and assets/logo.png doesn't exist yet). Tapping it goes home:
// the households list when signed in, the welcome screen when signed out (navigate returns to it if it's already in the stack).
// light: white, for use on the secondary color (the home screen's top section)
export function Wordmark({ size = "sm", light = false }: { size?: "sm" | "lg"; light?: boolean }) {
  const { status } = useSession();
  const lg = size === "lg";
  const height = lg ? 36 : 22;
  return (
    <Pressable
      onPress={() => router.navigate(status === "signedIn" ? "/" : "/welcome")}
      accessibilityRole="link"
      accessibilityLabel="Budgie, go to the home screen"
      hitSlop={{ top: (MIN_TOUCH - height) / 2, bottom: (MIN_TOUCH - height) / 2, left: 6, right: 6 }}
      style={({ pressed }) => pressed && { opacity: 0.7 }}
    >
      <View style={styles.row}>
        <BirdIcon size={lg ? 34 : 22} color={light ? colors.onSecondary : colors.accent} />
        <Text style={[styles.text, lg && styles.textLg, light && { color: colors.onSecondary }]}>Budgie</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  text: { fontFamily: fonts.jakarta600, fontSize: 17, lineHeight: 22, letterSpacing: -0.3, color: colors.accent },
  textLg: { fontFamily: fonts.jakarta800, fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
});
