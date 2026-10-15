import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { colors, fonts, MIN_TOUCH, radii, shadows } from "../theme";
import { Icon } from "./Icon";

// a rounded search input with a clear button
export function SearchField({ value, onChangeText, placeholder }: { value: string; onChangeText: (v: string) => void; placeholder: string }) {
  return (
    <View style={styles.field}>
      <Icon name="search" size={20} color={colors.outline} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.outline}
        accessibilityLabel={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={styles.input}
      />
      {value !== "" && (
        <Pressable onPress={() => onChangeText("")} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8} style={styles.clear}>
          <Icon name="close" size={18} color={colors.outline} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row", alignItems: "center", gap: 8, minHeight: MIN_TOUCH + 4, paddingHorizontal: 14,
    borderRadius: radii.pill, backgroundColor: colors.surfaceContainerLowest, ...shadows.card,
  },
  input: { flex: 1, fontFamily: fonts.inter400, fontSize: 15, color: colors.onSurface, paddingVertical: 10 },
  clear: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
});
