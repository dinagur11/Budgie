import { describe, it, expect } from "vitest";
import { dateInTimeZone, dayOfWeek, longDateLabel, daysInMonth, formatDate, monthGrid, monthLabel, monthOf, parseDate, shortDateLabel, todayInTimeZone } from "../src/lib/dates";

describe("YYYY-MM-DD handling", () => {
  it("parses and formats without Date shifts", () => {
    expect(parseDate("2026-01-01")).toStrictEqual({ year: 2026, month: 1, day: 1 });
    expect(formatDate({ year: 2026, month: 3, day: 9 })).toBe("2026-03-09");
    expect(formatDate(parseDate("2000-12-31"))).toBe("2000-12-31");
    expect(() => parseDate("2026-1-1")).toThrow();
    expect(monthOf("2026-10-14")).toBe("2026-10");
  });

  it("labels", () => {
    expect(monthLabel("2026-10")).toBe("October 2026");
    expect(monthLabel("2027-01")).toBe("January 2027");
    expect(shortDateLabel("2026-05-18")).toBe("May 18");
    expect(shortDateLabel("2026-12-01")).toBe("Dec 1");
  });
});

describe("calendar arithmetic", () => {
  it("days in month, including leap years", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("day of week matches the UTC calendar for every day of several years", () => {
    for (let y = 2023; y <= 2029; y++)
      for (let m = 1; m <= 12; m++)
        for (let d = 1; d <= daysInMonth(y, m); d++)
          expect(dayOfWeek(y, m, d)).toBe(new Date(Date.UTC(y, m - 1, d)).getUTCDay());
  });

  it("month grid is Sunday first, whole weeks, padded with neighbouring days", () => {
    // October 2026 starts on a Thursday
    const grid = monthGrid("2026-10");
    expect(grid.length % 7).toBe(0);
    expect(grid.slice(0, 4).map((c) => c.date)).toStrictEqual(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"]);
    expect(grid.slice(0, 4).every((c) => !c.inMonth)).toBe(true);
    expect(grid[4]).toStrictEqual({ date: "2026-10-01", day: 1, inMonth: true });
    expect(grid.filter((c) => c.inMonth).length).toBe(31);
    // 4 lead days + 31 = 35: exactly five weeks, ending on Saturday the 31st with no padding
    expect(grid.length).toBe(35);
    expect(grid[grid.length - 1]).toStrictEqual({ date: "2026-10-31", day: 31, inMonth: true });
    // November 2026 starts on Sunday and ends on Monday: padded with December days
    expect(monthGrid("2026-11").slice(-6).map((c) => c.date)).toStrictEqual(["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05"]);
  });

  it("month grid across year ends and a month starting on Sunday", () => {
    const feb = monthGrid("2026-02"); // starts on Sunday, 28 days: exactly 4 weeks
    expect(feb.length).toBe(28);
    expect(feb[0].date).toBe("2026-02-01");
    const jan = monthGrid("2027-01"); // starts on Friday
    expect(jan[0].date).toBe("2026-12-27");
    const dec = monthGrid("2026-12");
    expect(dec[dec.length - 1].date).toBe("2027-01-02");
  });
});

describe("todayInTimeZone", () => {
  const now = new Date("2026-10-14T20:30:00Z");
  it("uses the given zone, not the machine's", () => {
    expect(todayInTimeZone("UTC", now)).toBe("2026-10-14");
    expect(todayInTimeZone("Asia/Tokyo", now)).toBe("2026-10-15");
    expect(todayInTimeZone("Asia/Jerusalem", now)).toBe("2026-10-14");
    expect(todayInTimeZone("America/Los_Angeles", new Date("2026-01-01T05:00:00Z"))).toBe("2025-12-31");
  });

  it("falls back to format() when formatToParts is missing", () => {
    const original = Intl.DateTimeFormat.prototype.formatToParts;
    try {
      // @ts-expect-error simulating an engine without formatToParts
      Intl.DateTimeFormat.prototype.formatToParts = undefined;
      expect(todayInTimeZone("Asia/Tokyo", now)).toBe("2026-10-15");
    } finally {
      Intl.DateTimeFormat.prototype.formatToParts = original;
    }
  });
});

describe("join dates", () => {
  it("longDateLabel adds the year", () => {
    expect(longDateLabel("2026-10-05")).toBe("Oct 5, 2026");
  });
  it("dateInTimeZone uses the zone's calendar day", () => {
    expect(dateInTimeZone("2026-10-14T22:30:00.000Z", "Asia/Jerusalem")).toBe("2026-10-15");
    expect(dateInTimeZone("2026-10-14T22:30:00.000Z", "UTC")).toBe("2026-10-14");
  });
});
