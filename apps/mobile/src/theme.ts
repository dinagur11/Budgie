// Budgie's visual style, mirroring the Tailwind config of design/home.html. Light mode only.
import type { TextStyle } from "react-native";

export const colors = {
  surface: "#f7f9ff",
  background: "#f7f9ff",
  surfaceContainerLowest: "#ffffff",
  surfaceContainerLow: "#edf4ff",
  surfaceContainer: "#e3efff",
  surfaceContainerHigh: "#daeafe",
  surfaceContainerHighest: "#d4e4f8",
  onSurface: "#0d1d2b",
  onSurfaceVariant: "#3d4943",
  outline: "#6d7a73",
  outlineVariant: "#bccac1",
  primary: "#006c4f",
  primaryFixed: "#84f8ca",
  secondary: "#634eb0", // also the FAB and the main button
  secondaryFixed: "#e7deff",
  secondaryContainer: "#ac97fe",
  onSecondary: "#ffffff",
  panelMuted: "rgba(255,255,255,0.82)", // secondary text on the secondary color (the spent panel)
  onSecondaryContainer: "#3f288a",
  error: "#ba1a1a",
  errorContainer: "#ffdad6",
  onErrorContainer: "#93000a",
  warning: "#b25e00", // amber: the budget bar from 80% of the limit
  accent: "#2563eb", // wordmark, active nav icon
  accentRing: "#3b82f6", // avatar ring, calendar dots
  accentSoft: "#dbeafe", // active nav background, avatar
} as const;

// Android ignores fontWeight for custom fonts, so each weight is its own family (loaded in app/_layout.tsx)
export const fonts = {
  jakarta500: "PlusJakartaSans_500Medium",
  jakarta600: "PlusJakartaSans_600SemiBold",
  jakarta700: "PlusJakartaSans_700Bold",
  jakarta800: "PlusJakartaSans_800ExtraBold",
  inter400: "Inter_400Regular",
  inter500: "Inter_500Medium",
  inter600: "Inter_600SemiBold",
} as const;

// letterSpacing in React Native is in pixels, so the mock's em values are multiplied by the font size
export const type = {
  numeralLg: { fontFamily: fonts.jakarta800, fontSize: 32, lineHeight: 38, letterSpacing: -0.64 },
  headlineMd: { fontFamily: fonts.jakarta700, fontSize: 22, lineHeight: 28, letterSpacing: -0.22 },
  headlineSm: { fontFamily: fonts.jakarta600, fontSize: 18, lineHeight: 24 },
  labelLg: { fontFamily: fonts.jakarta700, fontSize: 14, lineHeight: 18, letterSpacing: 0.14 },
  labelMd: { fontFamily: fonts.jakarta700, fontSize: 12, lineHeight: 16, letterSpacing: 0.24 },
  labelSm: { fontFamily: fonts.jakarta700, fontSize: 10, lineHeight: 14, letterSpacing: 0.4 },
  bodyLg: { fontFamily: fonts.inter400, fontSize: 16, lineHeight: 24 },
  bodyMd: { fontFamily: fonts.inter400, fontSize: 14, lineHeight: 20 },
  bodySm: { fontFamily: fonts.inter400, fontSize: 12, lineHeight: 16 },
} satisfies Record<string, TextStyle>;

// expenseRow: the mock's rounded-xl (3rem) list rows, clamped to a pill at one line and soft when expanded
export const radii = { card: 16, row: 12, expenseRow: 24, pill: 9999 } as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, gutter: 12, maxContentWidth: 384 } as const;

// the minimum touch target (dp); compact visuals get hitSlop up to this
export const MIN_TOUCH = 44;

export const shadows = {
  card: { shadowColor: "#243342", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  header: { shadowColor: "#000000", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  floating: { shadowColor: "#243342", shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
} as const;
