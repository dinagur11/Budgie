import type { Currency } from "../api/types";

// every currency in the backend's Currency enum has 2 decimals; amounts are integer minor units.
// Formatted by hand ("1,234.50 ILS"), not with Intl, so the output is the same on Hermes and in tests
// and the currency code keeps several currencies unambiguous (CAD, AUD and NZD all use "$").
export function formatMoney(amountMinor: number, currency: Currency | string): string {
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(amountMinor));
  const major = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const minor = (abs % 100).toString().padStart(2, "0");
  return `${sign}${major}.${minor} ${currency}`;
}

// "4,000.00 ILS and 220.00 EUR" (no Intl.ListFormat). Entries keep the order given.
export function joinAmounts(entries: { amount: number; currency: Currency | string }[]): string {
  return entries.map((e) => formatMoney(e.amount, e.currency)).join(" and ");
}

type Total = { currency: Currency; spent: number; projected: number };

// the "spent" amounts to show: non-zero entries in the API's order (default currency first); all zero -> the first entry's zero
export function spentEntries(totals: Total[]): { amount: number; currency: Currency }[] {
  const nonZero = totals.filter((t) => t.spent !== 0);
  const shown = nonZero.length > 0 ? nonZero : totals.slice(0, 1);
  return shown.map((t) => ({ amount: t.spent, currency: t.currency }));
}

// the same amounts on one line: "4,000.00 ILS and 220.00 EUR"
export function spentLine(totals: Total[]): string {
  return joinAmounts(spentEntries(totals));
}

// the "Future expenses scheduled by the end of the month" line, or null when nothing is scheduled
export function projectedLine(totals: Total[]): string | null {
  const positive = totals.filter((t) => t.projected > 0);
  if (positive.length === 0) return null;
  return joinAmounts(positive.map((t) => ({ amount: t.projected, currency: t.currency })));
}

// what the user typed ("12", "12.5", "1,234.50", "12,50") -> minor units, or null when it isn't a valid amount.
// A comma followed by exactly 1-2 digits at the end is a decimal comma; other commas are thousands separators.
// The backend accepts 1 to 2147483647 minor units.
export function parseAmount(text: string): number | null {
  let v = text.trim().replace(/\s/g, "");
  if (/^\d+,\d{1,2}$/.test(v)) v = v.replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+(\.\d{0,2})?$/.test(v)) v = v.replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(v);
  if (!m) return null;
  const minor = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(minor) && minor >= 1 && minor <= 2147483647 ? minor : null;
}

// minor units -> what the amount field shows when editing (1250 -> "12.50"); parseAmount reads it back
export function amountInput(amountMinor: number): string {
  return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}
