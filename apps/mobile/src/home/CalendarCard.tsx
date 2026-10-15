import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card } from "../components/Card";
import { Icon } from "../components/Icon";
import type { CalendarMonth, Category } from "../api/types";
import { categoryColor } from "../lib/categoryColors";
import { longDateLabel, monthGrid, monthLabel } from "../lib/dates";
import { formatMoney } from "../lib/money";
import { colors, fonts } from "../theme";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MAX_DOTS = 3;

type Dot = { categoryId: number; scheduled: boolean };

// A month grid with today highlighted. Each day shows one dot per category (up to 3), in the category's color:
// filled for real expenses, hollow for future occurrences of recurring rules. `today` is the household's date.
// Tapping a day with dots (or hovering it, on the web) lists that day's expenses by name under the grid.
export function CalendarCard({ calendar, today, categories }: { calendar: CalendarMonth; today: string; categories: Category[] }) {
  const [picked, setPicked] = useState<string | null>(null);
  const dotsByDay = new Map<string, Dot[]>();
  const add = (date: string, dot: Dot) => {
    const dots = dotsByDay.get(date) ?? [];
    if (!dots.some((d) => d.categoryId === dot.categoryId && d.scheduled === dot.scheduled)) dots.push(dot);
    dotsByDay.set(date, dots);
  };
  calendar.expenses.forEach((e) => add(e.date, { categoryId: e.categoryId, scheduled: false }));
  calendar.projected.filter((p) => p.date > today).forEach((p) => add(p.date, { categoryId: p.categoryId, scheduled: true }));

  // the legend lists the categories that have a dot this month, in the order of the category list
  const shown = new Set([...dotsByDay.values()].flat().map((d) => d.categoryId));
  const legend = categories.filter((c) => shown.has(c.id));
  const cells = monthGrid(calendar.month);

  return (
    <Card style={{ gap: 8 }}>
      <View style={styles.headerRow}>
        <View style={styles.badge}><Icon name="calendar-month" size={16} color={colors.secondary} /></View>
        <Text style={styles.title}>Calendar View</Text>
        <Text style={styles.month}>{monthLabel(calendar.month)}</Text>
      </View>
      <View style={styles.grid}>
        {WEEKDAYS.map((d, i) => <Text key={i} style={[styles.cell, styles.weekday]}>{d}</Text>)}
        {cells.map((c) => {
          const isToday = c.date === today;
          const dots = c.inMonth ? (dotsByDay.get(c.date) ?? []).slice(0, MAX_DOTS) : [];
          return (
            <View key={c.date} style={styles.cell}>
              <Pressable
                onPress={() => setPicked((cur) => (cur === c.date ? null : c.date))}
                onHoverIn={() => setPicked(c.date)}
                disabled={dots.length === 0}
                accessibilityRole="button"
                accessibilityLabel={`${longDateLabel(c.date)}: show its expenses`}
                accessibilityState={{ selected: picked === c.date, disabled: dots.length === 0 }}
                style={[styles.dayBox, isToday && styles.today, picked === c.date && styles.picked]}
              >
                <Text style={[styles.day, !c.inMonth && styles.otherMonth, isToday && styles.todayText]}>{c.day}</Text>
                <View style={styles.dots}>
                  {dots.map((d) => <CategoryDot key={`${d.categoryId}-${d.scheduled}`} color={categoryColor(d.categoryId)} hollow={d.scheduled} />)}
                </View>
              </Pressable>
            </View>
          );
        })}
      </View>
      {picked && <DayList date={picked} calendar={calendar} today={today} onClose={() => setPicked(null)} />}
      {legend.length > 0 && (
        <View style={styles.legend}>
          {legend.map((c) => (
            <View key={c.id} style={styles.legendItem}>
              <CategoryDot color={categoryColor(c.id)} />
              <Text style={styles.legendText} numberOfLines={1}>{c.name}</Text>
            </View>
          ))}
        </View>
      )}
      <View style={styles.legend}>
        <View style={styles.legendItem}><CategoryDot color={colors.outline} /><Text style={styles.legendText}>Paid</Text></View>
        <View style={styles.legendItem}><CategoryDot color={colors.outline} hollow /><Text style={styles.legendText}>Scheduled recurring</Text></View>
      </View>
    </Card>
  );
}

// the picked day's expenses by name, then its scheduled recurring ones (future days only)
function DayList({ date, calendar, today, onClose }: { date: string; calendar: CalendarMonth; today: string; onClose: () => void }) {
  const items = [
    ...calendar.expenses.filter((e) => e.date === date).map((e) => ({ key: `e${e.id}`, name: e.name, amount: e.amount, currency: e.currency, categoryId: e.categoryId, scheduled: false })),
    ...calendar.projected.filter((p) => p.date === date && p.date > today).map((p) => ({ key: `p${p.ruleId}`, name: p.name, amount: p.amount, currency: p.currency, categoryId: p.categoryId, scheduled: true })),
  ];
  if (items.length === 0) return null;
  return (
    <View style={styles.dayList} accessibilityLiveRegion="polite">
      <View style={styles.dayListHeader}>
        <Text style={styles.dayListTitle}>{longDateLabel(date)}</Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12}>
          <Icon name="close" size={16} color={colors.outline} />
        </Pressable>
      </View>
      {items.map((it) => (
        <View key={it.key} style={styles.dayItem}>
          <CategoryDot color={categoryColor(it.categoryId)} hollow={it.scheduled} />
          <Text style={styles.dayItemName} numberOfLines={1}>{it.name}{it.scheduled ? " (scheduled)" : ""}</Text>
          <Text style={styles.dayItemAmount}>{formatMoney(it.amount, it.currency)}</Text>
        </View>
      ))}
    </View>
  );
}

function CategoryDot({ color, hollow = false }: { color: string; hollow?: boolean }) {
  return <View style={[styles.dot, hollow ? { borderWidth: 1.5, borderColor: color } : { backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.secondaryFixed, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontFamily: fonts.jakarta700, fontSize: 14, lineHeight: 18, color: colors.onSurface },
  month: { fontFamily: fonts.inter500, fontSize: 12, lineHeight: 16, color: colors.onSurfaceVariant },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 2 },
  cell: { width: `${100 / 7}%`, alignItems: "center" },
  weekday: { fontFamily: fonts.jakarta600, fontSize: 11, lineHeight: 16, paddingVertical: 4, color: colors.outline, textAlign: "center" },
  // 44dp, the minimum touch target, now that a day can be tapped
  dayBox: { width: 44, minHeight: 44, alignItems: "center", paddingTop: 6, paddingBottom: 4, borderRadius: 10 },
  day: { fontFamily: fonts.inter500, fontSize: 14, lineHeight: 18, color: colors.onSurface },
  otherMonth: { color: "rgba(109,122,115,0.4)" },
  today: { backgroundColor: colors.secondaryFixed },
  picked: { borderWidth: 1.5, borderColor: colors.secondary },
  dayList: { backgroundColor: colors.surfaceContainerLow, borderRadius: 12, padding: 10, gap: 6 },
  dayListHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dayListTitle: { fontFamily: fonts.jakarta700, fontSize: 12, lineHeight: 16, color: colors.onSurface },
  dayItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  dayItemName: { flex: 1, fontFamily: fonts.inter500, fontSize: 12, lineHeight: 16, color: colors.onSurface },
  dayItemAmount: { fontFamily: fonts.jakarta700, fontSize: 12, lineHeight: 16, color: colors.onSurface },
  todayText: { color: colors.secondary, fontFamily: fonts.jakarta700 },
  dots: { flexDirection: "row", gap: 2, height: 6, marginTop: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  legend: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", columnGap: 10, rowGap: 4, paddingHorizontal: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%" },
  legendText: { flexShrink: 1, fontFamily: fonts.inter400, fontSize: 11, lineHeight: 14, color: colors.onSurfaceVariant },
});
