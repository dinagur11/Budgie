import { MaterialCommunityIcons, MaterialIcons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { colors } from "../theme";

// The mock uses Material Symbols; these are the closest Material Icons glyphs (hyphenated names).
export type IconName = ComponentProps<typeof MaterialIcons>["name"];

export function Icon({ name, size = 16, color = colors.onSurface }: { name: IconName; size?: number; color?: string }) {
  return <MaterialIcons name={name} size={size} color={color} />;
}

// outlined Material Community glyphs, for the tab bar icons that Material Icons only has filled
export type OutlineIconName = ComponentProps<typeof MaterialCommunityIcons>["name"];
export function OutlineIcon({ name, size = 16, color = colors.onSurface }: { name: OutlineIconName; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={name} size={size} color={color} />;
}

// the logo mark until assets/logo.png exists
export function BirdIcon({ size = 20, color = colors.accent }: { size?: number; color?: string }) {
  return <MaterialCommunityIcons name="bird" size={size} color={color} />;
}
