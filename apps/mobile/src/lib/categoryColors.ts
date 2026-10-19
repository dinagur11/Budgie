// The color of a category's dots on the calendar. Picked from the category id, so a category keeps its color
// everywhere and over time. The 10 built-ins are seeded first (ids 1 to 10) and own the first 10 slots; custom
// categories rotate through the other 10, so a custom category never shares a built-in's color. Two custom categories
// still can when their ids end in the same digit (ids are shared by all households).
// Checked with the dataviz palette validator (light surface): lightness band, chroma, colorblind and normal-vision
// separation of neighbouring slots (wrapping around) all pass; across all pairs some are close, which is why charts
// always label their parts. Green, amber, cyan and light violet are under 3:1 against white, so a chart using them
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
  "#aa00cc", // violet
  "#009900", // bright green
  "#7722ff", // electric purple
  "#dd66ff", // light violet
  "#990077", // plum
  "#226622", // forest green
  "#bb55aa", // orchid
  "#0000ff", // pure blue
  "#8888dd", // lavender
  "#ff4499", // hot pink
] as const;

const BUILT_IN_SLOTS = 10;

// the palette slot for an id: built-ins (1 to 10) in the first half, everything else in the second
function slot(id: number, size: number) {
  return ((Math.trunc(id) - 1) % size + size) % size;
}

export function categoryColor(categoryId: number): string {
  if (categoryId >= 1 && categoryId <= BUILT_IN_SLOTS) return CATEGORY_COLORS[Math.trunc(categoryId) - 1];
  return CATEGORY_COLORS[BUILT_IN_SLOTS + slot(categoryId - BUILT_IN_SLOTS, CATEGORY_COLORS.length - BUILT_IN_SLOTS)];
}

// a household's color on the households list: the same palette, picked from the household id (stable, repeats after 20)
export function householdColor(householdId: number): string {
  return CATEGORY_COLORS[slot(householdId, CATEGORY_COLORS.length)];
}

// the color blended into white, as an opaque color, so the card stays light whatever is behind it ("#634eb0", 0.07 -> a pale purple)
export function tint(hex: string, amount: number) {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
    return Math.round(255 + (c - 255) * amount).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}
