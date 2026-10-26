// "1,234.50 ILS": minor units with thousands separators and the code, no symbols and no Intl
// (the same format as formatMoney in apps/mobile/src/lib/money.ts; every Currency has 2 decimals)
export function formatMoney(amountMinor: number, currency: string): string {
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(amountMinor));
  const major = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const minor = (abs % 100).toString().padStart(2, "0");
  return `${sign}${major}.${minor} ${currency}`;
}
