import { dateInTimeZone, deviceTimeZone, longDateLabel } from "./dates";

// where "Join premium" leads until joining exists
export const JOIN_PREMIUM_ROUTE = {
  pathname: "/coming-soon",
  params: { title: "Coming soon", text: "Joining premium is coming soon." },
} as const;

// a premium timestamp (premiumEndsAt, premiumRenewsAt) as "Nov 15, 2026" in the device's time zone
export function premiumDateLabel(timestamp: string, timeZone: string = deviceTimeZone()): string {
  return longDateLabel(dateInTimeZone(timestamp, timeZone));
}

export const cancelPremiumMessage = (endDate: string) =>
  `Are you sure you want to cancel? If you cancel, your membership will end on ${endDate}.`;
