import { StyleSheet, Text, View } from "react-native";
import { CURRENCIES, type Currency } from "../api/types";
import { colors, type as t } from "../theme";
import { Chip } from "./Chip";

// a currency as chips (the household's default currency, an expense's currency)
export function CurrencyPicker({ value, onChange, label = "Default currency" }: { value: Currency; onChange: (c: Currency) => void; label?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {CURRENCIES.map((c) => <Chip key={c} label={c} active={c === value} onPress={() => onChange(c)} />)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...t.labelMd, color: colors.onSurfaceVariant },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});
