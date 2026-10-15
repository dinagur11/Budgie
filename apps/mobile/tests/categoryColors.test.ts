import { describe, expect, it } from "vitest";
import { CATEGORY_COLORS, categoryColor } from "../src/lib/categoryColors";

describe("categoryColor", () => {
  it("gives the first ids different colors, in palette order", () => {
    const colors = CATEGORY_COLORS.map((_, i) => categoryColor(i + 1));
    expect(colors).toEqual([...CATEGORY_COLORS]);
    expect(new Set(colors).size).toBe(CATEGORY_COLORS.length);
  });

  it("is stable for an id and wraps around the palette", () => {
    expect(categoryColor(7)).toBe(categoryColor(7));
    expect(categoryColor(CATEGORY_COLORS.length + 1)).toBe(categoryColor(1));
  });

  it("always returns a palette color, even for odd input", () => {
    for (const id of [0, -3, 2147483647]) expect(CATEGORY_COLORS).toContain(categoryColor(id));
  });
});
