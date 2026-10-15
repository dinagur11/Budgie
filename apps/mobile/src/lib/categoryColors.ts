// The color of a category's dots on the calendar. Picked from the category id, so a category keeps its color
// everywhere and over time (built-ins and custom ones alike). With more categories than colors, two can share one.
// Checked with the dataviz palette validator (light surface): lightness band, chroma, colorblind and normal-vision
// separation of neighbouring slots all pass. Green, amber and cyan are under 3:1 against white, so a chart using them
// always labels its parts (the analytics legend lists every slice by name).
export const CATEGORY_COLORS = [
  "#634eb0", // purple
  "#00897b", // teal
  "#e65100", // orange
  "#2563eb", // blue
  "#c2185b", // pink
  "#7cb342", // green
  "#8a5a00", // brown
  "#d4a106", // amber
  "#00acc1", // cyan
  "#9e2a2b", // dark red
] as const;

export function categoryColor(categoryId: number): string {
  const n = CATEGORY_COLORS.length;
  return CATEGORY_COLORS[(((Math.trunc(categoryId) - 1) % n) + n) % n];
}

// a household's color on the households list: the same palette, picked from the household id (stable, repeats after 10)
export const householdColor = categoryColor;

// the color blended into white, as an opaque color, so the card stays light whatever is behind it ("#634eb0", 0.07 -> a pale purple)
export function tint(hex: string, amount: number) {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
    return Math.round(255 + (c - 255) * amount).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}
