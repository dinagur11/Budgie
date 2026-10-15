import { forwardRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, fonts, MIN_TOUCH, radii, type as t } from "../theme";
import { Icon } from "./Icon";

type Props = Omit<TextInputProps, "style"> & { label: string; error?: string | null; password?: boolean };

export const TextField = forwardRef<TextInput, Props>(function TextField({ label, error, password = false, ...input }, ref) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.box, focused && styles.boxFocused, !!error && styles.boxError]}>
        <TextInput
          ref={ref}
          {...input}
          accessibilityLabel={label}
          secureTextEntry={password && hidden}
          placeholderTextColor={colors.outline}
          onFocus={(e) => { setFocused(true); input.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); input.onBlur?.(e); }}
          style={styles.input}
        />
        {password && (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            accessibilityRole="button"
            accessibilityLabel={hidden ? "Show password" : "Hide password"}
            hitSlop={8}
            style={styles.eye}
          >
            <Icon name={hidden ? "visibility" : "visibility-off"} size={20} color={colors.outline} />
          </Pressable>
        )}
      </View>
      {!!error && <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  label: { ...t.labelMd, color: colors.onSurfaceVariant },
  box: {
    flexDirection: "row", alignItems: "center", minHeight: 52, borderRadius: radii.row, borderWidth: 1,
    borderColor: colors.outlineVariant, backgroundColor: colors.surfaceContainerLowest,
  },
  boxFocused: { borderColor: colors.secondary, borderWidth: 2 },
  boxError: { borderColor: colors.error },
  // no lineHeight: on iOS a single-line TextInput with a fixed lineHeight clips descenders (g, y, p)
  input: {
    flex: 1, fontFamily: fonts.inter400, fontSize: t.bodyLg.fontSize, color: colors.onSurface,
    minHeight: 50, paddingHorizontal: 12, paddingVertical: 12,
  },
  eye: { width: MIN_TOUCH - 8, height: MIN_TOUCH - 8, alignItems: "center", justifyContent: "center", marginRight: 4 },
  error: { ...t.bodySm, color: colors.error },
});
