import { StyleSheet } from "react-native";
import { colors, type as t } from "../theme";

// shared by the login, register and confirm screens (their title is in AuthTop)
export const authStyles = StyleSheet.create({
  card: { padding: 16, gap: 14 },
  hint: { ...t.bodySm, color: colors.onSurfaceVariant },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  footerText: { ...t.bodyMd, color: colors.onSurfaceVariant },
});
