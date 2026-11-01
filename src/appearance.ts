export type ThemePreference = "system" | "light" | "dark" | "stillwater";
export type ResolvedTheme = Exclude<ThemePreference, "system">;
export const DEFAULT_FONT_SIZE = 16;
export const MIN_FONT_SIZE = 12;
export const MAX_FONT_SIZE = 28;
export const MONOSPACE_FONT = '"Inconsolata Variable", monospace';

export function themePreference(value: string | null): ThemePreference {
  return value === "light" || value === "system" || value === "stillwater"
    ? value
    : "dark";
}

export function resolvedTheme(
  preference: ThemePreference,
  systemDark: boolean,
): ResolvedTheme {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

export function fontSize(value: number) {
  return Number.isFinite(value)
    ? Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(value)))
    : DEFAULT_FONT_SIZE;
}

export function savedFontSize(value: string | null) {
  return value?.trim() ? fontSize(Number(value)) : DEFAULT_FONT_SIZE;
}
