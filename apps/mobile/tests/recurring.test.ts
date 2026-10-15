import { describe, it, expect } from "vitest";
import { scheduleSummary } from "../src/lib/recurring";

describe("scheduleSummary", () => {
  it("daily, weekly and every two weeks", () => {
    expect(scheduleSummary("DAILY", "2026-10-03", null)).toBe("Every day, from Oct 3, 2026.");
    expect(scheduleSummary("WEEKLY", "2026-10-03", null)).toBe("Every Saturday, from Oct 3, 2026.");
    expect(scheduleSummary("BIWEEKLY", "2026-10-05", "2026-12-31")).toBe("Every other Monday, from Oct 5, 2026 until Dec 31, 2026.");
  });
  it("monthly, with the clamp note past the 28th", () => {
    expect(scheduleSummary("MONTHLY", "2026-10-01", null)).toBe("Every month on the 1st, from Oct 1, 2026.");
    expect(scheduleSummary("MONTHLY", "2026-10-22", null)).toBe("Every month on the 22nd, from Oct 22, 2026.");
    expect(scheduleSummary("MONTHLY", "2026-10-13", null)).toBe("Every month on the 13th, from Oct 13, 2026.");
    expect(scheduleSummary("MONTHLY", "2026-01-31", null)).toBe("Every month on the 31st (the last day in shorter months), from Jan 31, 2026.");
  });
  it("yearly, with the Feb 29 note", () => {
    expect(scheduleSummary("YEARLY", "2026-03-15", null)).toBe("Every year on Mar 15, from Mar 15, 2026.");
    expect(scheduleSummary("YEARLY", "2024-02-29", null)).toBe("Every year on Feb 29 (Feb 28 in other years), from Feb 29, 2024.");
  });
});
