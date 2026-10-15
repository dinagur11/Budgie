import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { addMonths, monthGrid, monthLabel, monthOf } from "../lib/dates";
import { colors, fonts, MIN_TOUCH } from "../theme";
import { Icon } from "./Icon";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

type Props = {
  value: string;
  onChange: (date: string) => void;
  // the first and last day that can be picked (the backend accepts years 2000 to 2100)
  min?: string;
  max?: string;
  // outlined when shown (the household's today)
  today?: string;
};

// A month calendar for picking a day ("YYYY-MM-DD"). Days outside min..max can't be picked and the arrows stop at
// their months (an expense's date has max = today; a recurring expense's end date has min = its start date).
// Opens on the selected day's month.
export function DatePicker({ value, onChange, min = "2000-01-01", max = "2100-12-31", today }: Props) {
  const [month, setMonth] = useState(monthOf(value));
  // follow a value set from outside (the "Yesterday" chip on the 1st of a month)
  useEffect(() => setMonth(monthOf(value)), [value]);
  const canPrev = month > monthOf(min);
  const canNext = month < monthOf(max);

  return (
    <View style={styles.box}>
      <View style={styles.header}>
        <Arrow icon="chevron-left" label="Previous month" enabled={canPrev} onPress={() => setMonth(addMonths(month, -1))} />
        <Text style={styles.month} accessibilityRole="header">{monthLabel(month)}</Text>
        <Arrow icon="chevron-right" label="Next month" enabled={canNext} onPress={() => setMonth(addMonths(month, 1))} />
      </View>
      <View style={styles.grid}>
        {WEEKDAYS.map((d, i) => <Text key={i} style={[styles.cell, styles.weekday]}>{d}</Text>)}
        {monthGrid(month).map((c) => {
          // days of the neighbouring months are left blank, so each day appears once
          if (!c.inMonth) return <View key={c.date} style={styles.cell} />;
          const disabled = c.date < min || c.date > max;
          const selected = c.date === value;
          const isToday = c.date === today;
          return (
            <View key={c.date} style={styles.cell}>
              <Pressable
                onPress={() => onChange(c.date)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={c.date}
                accessibilityState={{ selected, disabled }}
                style={({ pressed }) => [styles.day, isToday && styles.today, selected && styles.selected, pressed && !selected && { opacity: 0.6 }]}
              >
                <Text style={[styles.dayText, disabled && styles.disabled, isToday && styles.todayText, selected && styles.selectedText]}>{c.day}</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Arrow({ icon, label, enabled, onPress }: { icon: "chevron-left" | "chevron-right"; label: string; enabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      style={({ pressed }) => [styles.arrow, pressed && { backgroundColor: colors.surfaceContainer }]}
    >
      <Icon name={icon} size={24} color={enabled ? colors.onSurface : colors.outlineVariant} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: colors.outlineVariant, borderRadius: 12, padding: 8, gap: 4 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  month: { fontFamily: fonts.jakarta700, fontSize: 14, lineHeight: 18, color: colors.onSurface },
  arrow: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: MIN_TOUCH / 2, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, alignItems: "center", paddingVertical: 1 },
  weekday: { fontFamily: fonts.jakarta600, fontSize: 11, lineHeight: 16, paddingVertical: 4, color: colors.outline, textAlign: "center" },
  day: { width: MIN_TOUCH, maxWidth: "100%", height: MIN_TOUCH, borderRadius: MIN_TOUCH / 2, alignItems: "center", justifyContent: "center" },
  dayText: { fontFamily: fonts.inter500, fontSize: 14, lineHeight: 18, color: colors.onSurface },
  disabled: { color: "rgba(109,122,115,0.35)" },
  today: { borderWidth: 1.5, borderColor: colors.secondary },
  todayText: { color: colors.secondary, fontFamily: fonts.jakarta700 },
  selected: { backgroundColor: colors.secondary },
  selectedText: { color: colors.onSecondary, fontFamily: fonts.jakarta700 },
});
