import { describe, expect, it } from "vitest";
import { CATEGORY_COLORS, categoryColor, householdColor } from "../src/lib/categoryColors";

const BUILT_IN = CATEGORY_COLORS.slice(0, 10);
const CUSTOM = CATEGORY_COLORS.slice(10);

describe("categoryColor", () => {
  it("gives the built-ins (ids 1 to 10) the first ten colors, in palette order", () => {
    expect(BUILT_IN.map((_, i) => categoryColor(i + 1))).toEqual([...BUILT_IN]);
  });

  it("gives the next ten ids the other ten colors, in palette order", () => {
    expect(CUSTOM.map((_, i) => categoryColor(i + 11))).toEqual([...CUSTOM]);
  });

  it("never gives a custom category a built-in's color", () => {
    for (let id = 11; id <= 500; id++) expect(CUSTOM).toContain(categoryColor(id));
  });

  it("has no duplicate colors", () => {
    expect(new Set(CATEGORY_COLORS).size).toBe(CATEGORY_COLORS.length);
  });

  it("is stable for an id and wraps around the custom colors", () => {
    expect(categoryColor(17)).toBe(categoryColor(17));
    expect(categoryColor(21)).toBe(categoryColor(11));
  });

  it("always returns a palette color, even for odd input", () => {
    for (const id of [0, -3, 1.5, 2147483647]) expect(CATEGORY_COLORS).toContain(categoryColor(id));
  });
});

describe("householdColor", () => {
  it("uses the whole palette and wraps around", () => {
    expect(CATEGORY_COLORS.map((_, i) => householdColor(i + 1))).toEqual([...CATEGORY_COLORS]);
    expect(householdColor(CATEGORY_COLORS.length + 1)).toBe(householdColor(1));
    for (const id of [0, -3, 2147483647]) expect(CATEGORY_COLORS).toContain(householdColor(id));
  });
});
