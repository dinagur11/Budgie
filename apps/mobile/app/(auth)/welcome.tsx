import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Screen } from "../../src/components/Screen";
import { Button } from "../../src/components/Button";
import { Icon, type IconName } from "../../src/components/Icon";
import { AuthTop, authTopText } from "../../src/components/AuthTop";
import { colors } from "../../src/theme";

// The signed-out home: what Budgie does (in the colored top section, like the signed-in home), and the way in.
// Only features that exist today are listed.
const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: "diversity-1", title: "Share a household", text: "Everyone logs what they paid, and you all see the month's spending." },
  { icon: "update", title: "Recurring expenses", text: "Rent, bills and subscriptions are added for you on schedule." },
  { icon: "calendar-month", title: "See what's ahead", text: "A calendar of what's been paid and what's still to come." },
  { icon: "pie-chart", title: "Analytics", text: "Charts of your spending by category, by payer and month by month." },
];

export default function WelcomeScreen() {
  return (
    <Screen
      top={
        <AuthTop title="Household expenses, together" subtitle="Budgie keeps track of what your household spends.">
          {FEATURES.map((f) => (
            <View key={f.title} style={styles.feature}>
              <View style={styles.badge}><Icon name={f.icon} size={18} color={colors.onSecondary} /></View>
              <View style={styles.featureText}>
                <Text style={authTopText.strong}>{f.title}</Text>
                <Text style={authTopText.muted}>{f.text}</Text>
              </View>
            </View>
          ))}
        </AuthTop>
      }
    >
      <View style={styles.actions}>
        <Button label="Create an account" onPress={() => router.push("/register")} />
        <Button label="Log in" variant="tonal" onPress={() => router.push("/login")} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  feature: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  badge: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  featureText: { flex: 1, gap: 2 },
  actions: { gap: 10, marginTop: 8 },
});
