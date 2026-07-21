import { describe, expect, it } from "vitest";
import { nextThemeMode, normalizeThemeMode, resolveThemeMode } from "./theme";

describe("theme mode", () => {
  it("defaults missing and unknown preferences to system", () => {
    expect(normalizeThemeMode(null)).toBe("system");
    expect(normalizeThemeMode("unknown")).toBe("system");
  });

  it("resolves system mode from the current media preference", () => {
    expect(resolveThemeMode("system", true)).toBe("dark");
    expect(resolveThemeMode("system", false)).toBe("light");
    expect(resolveThemeMode("light", true)).toBe("light");
  });

  it("cycles through every available mode", () => {
    expect(nextThemeMode("light")).toBe("dark");
    expect(nextThemeMode("dark")).toBe("system");
    expect(nextThemeMode("system")).toBe("light");
  });
});
