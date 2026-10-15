import type { Frequency } from "../api/types";
import { dayOfWeek, longDateLabel, parseDate, shortDateLabel } from "./dates";

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  MONTHLY: "Monthly",
  YEARLY: "Yearly",
};

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

// One sentence describing the schedule, following the backend's rules: the anchor is always the start date's day,
// and monthly / yearly dates that don't exist in a month are clamped to its last day (Jan 31 -> Feb 28 -> Mar 31).
export function scheduleSummary(frequency: Frequency, startDate: string, endDate: string | null): string {
  const { year, month, day } = parseDate(startDate);
  let repeat: string;
  switch (frequency) {
    case "DAILY":
      repeat = "Every day";
      break;
    case "WEEKLY":
      repeat = `Every ${WEEKDAY_NAMES[dayOfWeek(year, month, day)]}`;
      break;
    case "BIWEEKLY":
      repeat = `Every other ${WEEKDAY_NAMES[dayOfWeek(year, month, day)]}`;
      break;
    case "MONTHLY":
      repeat = `Every month on the ${ordinal(day)}${day > 28 ? " (the last day in shorter months)" : ""}`;
      break;
    case "YEARLY":
      repeat = `Every year on ${shortDateLabel(startDate)}${month === 2 && day === 29 ? " (Feb 28 in other years)" : ""}`;
      break;
  }
  return `${repeat}, from ${longDateLabel(startDate)}${endDate ? ` until ${longDateLabel(endDate)}` : ""}.`;
}
