import type { HighlightColor } from "./types";

/** Single source for highlight colors: UI swatches and canvas paints both read this. */
export const HIGHLIGHT_COLOR_HEX: Record<HighlightColor, string> = {
  red: "#ff3b30",
  yellow: "#ffcc00",
  green: "#00ff40",
  purple: "#a154f2",
};

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  };
}
