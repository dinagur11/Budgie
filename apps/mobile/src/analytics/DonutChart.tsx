import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import type { Currency } from "../api/types";
import { donutSegment, percentLabel } from "../lib/analytics";
import { formatMoney } from "../lib/money";
import { colors, fonts, MIN_TOUCH, radii, type as t } from "../theme";

const SIZE = 200;
const OUTER = SIZE / 2;
const INNER = OUTER * 0.62;

// one part of the donut, already named and colored by the caller (key null = "Other")
export type DonutPart = { key: number | null; label: string; amount: number; color: string };

// A donut of parts in one currency, the total in the hole, and a legend that names every part with its amount and share,
// so no part is told apart by color alone. Tapping a slice or a legend row shows that part in the hole.
// The caller keys this component by what it shows (month, grouping, currency), so a new view starts with nothing tapped.
export function DonutChart({ parts, currency }: { parts: DonutPart[]; currency: Currency }) {
  const [selected, setSelected] = useState<number | null | undefined>(undefined); // a part key; undefined = none
  const total = parts.reduce((sum, p) => sum + p.amount, 0);
  const focus = selected !== undefined ? parts.find((p) => p.key === selected) : undefined;
  const toggle = (key: number | null) => setSelected((cur) => (cur === key ? undefined : key));

  return (
    <>
      <View style={styles.chart}>
        <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          {parts.length === 1 ? (
            // a full ring (an arc can't start and end at the same point)
            <Circle cx={OUTER} cy={OUTER} r={(OUTER + INNER) / 2} stroke={parts[0].color} strokeWidth={OUTER - INNER} fill="none" onPress={() => toggle(parts[0].key)} />
          ) : (
            slicePaths(parts, total).map(({ part, d }) => (
              <Path
                key={String(part.key)}
                d={d}
                fill={part.color}
                // a 2dp surface-colored gap between neighbouring slices
                stroke={colors.surfaceContainerLowest}
                strokeWidth={2}
                opacity={focus && focus.key !== part.key ? 0.3 : 1}
                onPress={() => toggle(part.key)}
              />
            ))
          )}
        </Svg>
        {/* the total, or the tapped part, in the hole; the number and the currency on separate lines so large amounts fit */}
        <View style={styles.center} pointerEvents="none">
          <Text style={styles.centerLabel} numberOfLines={1}>{focus ? focus.label : "Total"}</Text>
          <Text style={styles.centerValue} numberOfLines={1} adjustsFontSizeToFit>{formatMoney(focus ? focus.amount : total, "").trim()}</Text>
          <Text style={styles.centerCurrency}>{currency}</Text>
          {focus && <Text style={styles.centerLabel}>{percentLabel(focus.amount, total)}</Text>}
        </View>
      </View>

      <View style={styles.legend}>
        {parts.map((p) => {
          const active = focus?.key === p.key;
          return (
            <Pressable
              key={String(p.key)}
              onPress={() => toggle(p.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${p.label}: ${formatMoney(p.amount, currency)}, ${percentLabel(p.amount, total)}`}
              style={[styles.legendRow, active && styles.legendRowActive, focus && !active && { opacity: 0.55 }]}
            >
              <View style={[styles.swatch, { backgroundColor: p.color }]} />
              <Text style={styles.legendName} numberOfLines={1}>{p.label}</Text>
              <Text style={styles.legendAmount}>{formatMoney(p.amount, currency)}</Text>
              <Text style={styles.legendPercent}>{percentLabel(p.amount, total)}</Text>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

// clockwise from 12 o'clock, in the parts' order (largest first, "Other" last)
function slicePaths(parts: DonutPart[], total: number) {
  let angle = 0;
  return parts.map((part) => {
    const sweep = (part.amount / total) * Math.PI * 2;
    const d = donutSegment(OUTER, OUTER, OUTER - 1, INNER, angle, angle + sweep);
    angle += sweep;
    return { part, d };
  });
}

const styles = StyleSheet.create({
  chart: { alignSelf: "center", width: SIZE, height: SIZE, marginVertical: 4 },
  center: { position: "absolute", top: OUTER - INNER, left: OUTER - INNER, width: INNER * 2, height: INNER * 2, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  centerLabel: { ...t.bodySm, color: colors.onSurfaceVariant, textAlign: "center" },
  centerValue: { fontFamily: fonts.jakarta800, fontSize: 18, lineHeight: 24, color: colors.onSurface, textAlign: "center" },
  centerCurrency: { fontFamily: fonts.jakarta700, fontSize: 12, lineHeight: 16, color: colors.onSurfaceVariant },
  legend: { gap: 2 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: MIN_TOUCH, paddingHorizontal: 8, borderRadius: radii.row },
  legendRowActive: { backgroundColor: colors.surfaceContainerLow },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  legendName: { flex: 1, ...t.bodyMd, color: colors.onSurface },
  legendAmount: { fontFamily: fonts.jakarta700, fontSize: 13, lineHeight: 18, color: colors.onSurface },
  legendPercent: { width: 40, textAlign: "right", ...t.bodySm, color: colors.onSurfaceVariant },
});
