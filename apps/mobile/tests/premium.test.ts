import { describe, it, expect } from "vitest";
import { cancelPremiumMessage, premiumDateLabel } from "../src/lib/premium";

describe("premiumDateLabel", () => {
  it("formats the timestamp's date in the given time zone", () => {
    expect(premiumDateLabel("2026-11-15T10:30:00.000Z", "UTC")).toBe("Nov 15, 2026");
    expect(premiumDateLabel("2026-11-15T22:30:00.000Z", "Asia/Jerusalem")).toBe("Nov 16, 2026");
    expect(premiumDateLabel("2026-11-15T02:00:00.000Z", "America/New_York")).toBe("Nov 14, 2026");
  });
});

describe("cancelPremiumMessage", () => {
  it("names the end date", () => {
    expect(cancelPremiumMessage("Nov 15, 2026")).toBe(
      "Are you sure you want to cancel? If you cancel, your membership will end on Nov 15, 2026.",
    );
  });
});
