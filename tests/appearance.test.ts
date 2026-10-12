import { describe, expect, it } from "vitest";
import {
  DEFAULT_FONT_SIZE,
  fontSize,
  savedFontSize,
  themePreference,
  resolvedTheme,
} from "../src/appearance";

describe("appearance preferences", () => {
  it("defaults to the OS theme, not a saved resolved color", () => {
    expect(themePreference(null)).toBe("system");
    expect(themePreference("obsolete")).toBe("system");
    expect(resolvedTheme("system", false)).toBe("light");
    expect(resolvedTheme("system", true)).toBe("dark");
  });
  it("respects explicit themes independently of the OS", () => {
    expect(resolvedTheme(themePreference("light"), true)).toBe("light");
    expect(resolvedTheme(themePreference("dark"), false)).toBe("dark");
  });
  it("bounds font sizes and recovers from invalid stored values", () => {
    for (const value of [null, "", " ", "not a size", "Infinity"])
      expect(savedFontSize(value)).toBe(DEFAULT_FONT_SIZE);
    expect(savedFontSize("20")).toBe(20);
    expect(fontSize(20.3)).toBe(20);
    expect(fontSize(11)).toBe(12);
    expect(fontSize(29)).toBe(28);
    expect(fontSize(NaN)).toBe(DEFAULT_FONT_SIZE);
  });
});
