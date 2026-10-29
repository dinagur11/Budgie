// Premium is a monthly subscription from premiumStartedAt. Cancelling sets premiumEndsAt to the end of the paid month;
// the user stays premium until then. Expiry is checked on every read (here), never left to the daily cleanup job,
// which only tidies expired rows.

type PremiumFields = { isPremium: boolean; premiumEndsAt: Date | null };

export const isPremiumActive = (user: PremiumFields, now: Date = new Date()) =>
  user.isPremium && (user.premiumEndsAt === null || user.premiumEndsAt > now);

// The first monthly anniversary of startedAt that is after now: same UTC time of day, and startedAt's UTC day of month,
// clamped against that anchor day in short months (Jan 31 -> Feb 28 -> Mar 31), like recurring rules.
export function nextRenewal(startedAt: Date, now: Date = new Date()): Date {
  const year = startedAt.getUTCFullYear();
  const month = startedAt.getUTCMonth();
  const anchor = startedAt.getUTCDate();
  const at = (n: number) => {
    const days = new Date(Date.UTC(year, month + n + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month + n, Math.min(anchor, days), startedAt.getUTCHours(), startedAt.getUTCMinutes(),
      startedAt.getUTCSeconds(), startedAt.getUTCMilliseconds()));
  };
  let n = Math.max(1, (now.getUTCFullYear() - year) * 12 + now.getUTCMonth() - month);
  while (at(n) <= now) n++;
  return at(n);
}
