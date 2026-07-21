import type { Theme } from "./types";

export type ThemeMode = Theme | "system";

export function normalizeThemeMode(value: string | null): ThemeMode {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveThemeMode(mode: ThemeMode, prefersDark: boolean): Theme {
  return mode === "system" ? (prefersDark ? "dark" : "light") : mode;
}

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  if (mode === "light") return "dark";
  if (mode === "dark") return "system";
  return "light";
}
