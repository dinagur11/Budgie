import { StyleSheet, Text, View } from "react-native";
import type { Currency } from "../api/types";
import { formatMoney, joinAmounts } from "../lib/money";
import { colors, fonts, radii, type as t } from "../theme";
import { Icon } from "./Icon";

type Props = {
  // the small line above the amount; when left out, it is only read out by screen readers
  label?: string;
  // in display order; the first is shown large, the others on their own lines as "+ 220.00 EUR"
  amounts: { amount: number; currency: Currency }[];
  // shown instead of an amount when `amounts` is empty
  emptyText?: string;
  // a line under a divider, such as the scheduled expenses: muted text, then the amount in bold
  note?: { text: string; amount: string };
  // no background or padding, for a surface that is already the secondary color
  bare?: boolean;
};

// The prominent amount block (the secondary color, white numerals) used for "spent so far" totals.
export function AmountPanel({ label, amounts, emptyText = "Nothing yet", note, bare = false }: Props) {
  const [first, ...others] = amounts;
  const spoken = amounts.length > 0 ? joinAmounts(amounts) : emptyText;
  return (
    <View style={bare ? styles.bare : styles.panel} accessible accessibilityLabel={`${label ? `${label}: ` : ""}${spoken}${note ? `. ${note.text} ${note.amount}` : ""}`}>
      {label && <Text style={styles.label}>{label}</Text>}
      {first ? (
        <Text style={styles.total} numberOfLines={1} adjustsFontSizeToFit>{formatMoney(first.amount, first.currency)}</Text>
      ) : (
        <Text style={styles.empty}>{emptyText}</Text>
      )}
      {others.map((o) => (
        <Text key={o.currency} style={styles.other} numberOfLines={1} adjustsFontSizeToFit>+ {formatMoney(o.amount, o.currency)}</Text>
      ))}
      {note && (
        <View style={styles.note}>
          <Icon name="update" size={14} color={colors.panelMuted} />
          <Text style={styles.noteText}>
            {note.text} <Text style={styles.noteAmount}>{note.amount}</Text>
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.secondary, borderRadius: radii.card, paddingHorizontal: 16, paddingVertical: 14, gap: 2 },
  bare: { gap: 2 },
  label: { fontFamily: fonts.inter500, fontSize: 12, lineHeight: 16, color: colors.panelMuted },
  total: { ...t.numeralLg, color: colors.onSecondary },
  empty: { fontFamily: fonts.jakarta700, fontSize: 22, lineHeight: 30, color: colors.onSecondary },
  other: { fontFamily: fonts.jakarta700, fontSize: 18, lineHeight: 24, color: colors.onSecondary },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.2)" },
  noteText: { flex: 1, ...t.bodySm, color: colors.panelMuted },
  noteAmount: { fontFamily: fonts.inter600, color: colors.onSecondary },
});
