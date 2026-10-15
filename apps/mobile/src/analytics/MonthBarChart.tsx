import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Chip } from "../components/Chip";
import { Field } from "../components/Field";
import type { Currency } from "../api/types";
import { currenciesByAmount } from "../lib/analytics";
import { monthLabel, monthName } from "../lib/dates";
import { formatMoney } from "../lib/money";
import { colors, fonts, MIN_TOUCH, type as t } from "../theme";

const CHART_HEIGHT = 160;

type Props = {
  // oldest first; the last one is shown first
  months: string[];
  currentMonth: string;
  // per month (same order as months): the amounts per currency
  totals: { currency: Currency; amount: number }[][];
  // shown first among the currency chips (a household's default currency)
  preferredCurrency?: Currency;
  // the line under the chart, for the shown currency
  note: (currency: Currency) => string;
};

// One bar per month, one currency at a time (currency chips when there is more than one; amounts in different
// currencies are never added). Tapping a bar shows its amount above the chart. One series: one hue, no legend.
export function MonthBarChart({ months, currentMonth, totals, preferredCurrency, note }: Props) {
  const [chosenCurrency, setChosenCurrency] = useState<Currency | null>(null);
  const [selected, setSelected] = useState(months.length - 1);
  const currencies = currenciesByAmount(totals.flat(), preferredCurrency);
  const currency = chosenCurrency && currencies.includes(chosenCurrency) ? chosenCurrency : currencies[0] ?? preferredCurrency ?? "USD";
  const values = totals.map((list) => list.filter((x) => x.currency === currency).reduce((sum, x) => sum + x.amount, 0));
  const max = Math.max(...values, 1);
  const pickedMonth = months[selected];

  return (
    <>
      {currencies.length > 1 && (
        <Field label="Currency">
          <View style={styles.chips} accessibilityRole="radiogroup">
            {currencies.map((c) => <Chip key={c} label={c} active={c === currency} onPress={() => setChosenCurrency(c)} />)}
          </View>
        </Field>
      )}
      {/* the tapped bar's value (the newest month at first) */}
      <View accessibilityLiveRegion="polite">
        <Text style={styles.pickedLabel}>{monthLabel(pickedMonth)}{pickedMonth === currentMonth ? " so far" : ""}</Text>
        <Text style={styles.pickedValue}>{formatMoney(values[selected], currency)}</Text>
      </View>
      <View style={styles.plot}>
        {/* a recessive guide at the top of the scale */}
        <View style={styles.grid}><Text style={styles.gridLabel}>{formatMoney(max, currency)}</Text></View>
        <View style={styles.bars}>
          {months.map((m, i) => {
            const active = i === selected;
            const height = values[i] === 0 ? 0 : Math.max(3, (values[i] / max) * CHART_HEIGHT);
            return (
              <Pressable
                key={m}
                onPress={() => setSelected(i)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${monthLabel(m)}${m === currentMonth ? " so far" : ""}: ${formatMoney(values[i], currency)}`}
                style={styles.column}
              >
                <View style={[styles.bar, { height, backgroundColor: active ? colors.secondary : colors.secondaryContainer }]} />
              </Pressable>
            );
          })}
        </View>
        <View style={styles.baseline} />
        <View style={styles.labels}>
          {months.map((m, i) => (
            <Text key={m} style={[styles.monthLabel, i === selected && styles.monthLabelActive]}>{monthName(m).slice(0, 3)}</Text>
          ))}
        </View>
      </View>
      <Text style={styles.note}>{note(currency)}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pickedLabel: { ...t.bodySm, color: colors.onSurfaceVariant },
  pickedValue: { fontFamily: fonts.jakarta800, fontSize: 22, lineHeight: 28, color: colors.onSurface },
  plot: { paddingTop: 18 },
  grid: { position: "absolute", top: 18, left: 0, right: 0, borderTopWidth: 1, borderStyle: "dashed", borderColor: colors.outlineVariant },
  gridLabel: { position: "absolute", top: -16, right: 0, ...t.bodySm, fontSize: 10, color: colors.outline },
  bars: { height: CHART_HEIGHT, flexDirection: "row", alignItems: "flex-end" },
  // the whole column is the touch target, wider and taller than the bar
  column: { flex: 1, height: CHART_HEIGHT, minWidth: MIN_TOUCH, alignItems: "center", justifyContent: "flex-end" },
  bar: { width: 28, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  baseline: { height: 1, backgroundColor: colors.outlineVariant },
  labels: { flexDirection: "row", paddingTop: 6 },
  monthLabel: { flex: 1, textAlign: "center", ...t.bodySm, color: colors.onSurfaceVariant },
  monthLabelActive: { color: colors.onSurface, fontFamily: fonts.jakarta700 },
  note: { ...t.bodySm, color: colors.onSurfaceVariant },
});
