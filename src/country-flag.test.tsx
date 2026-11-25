import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CountryFlag, getCountryRegionLabel, GLOBAL_COUNTRY_REGIONS, normalizeCountryCode } from "./country-flag";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

describe("CountryFlag", () => {
  it.each(["HK", "US", "JP", "UK"])("renders %s as a bundled SVG flag", async (countryCode) => {
    const { container } = render(<CountryFlag countryCode={countryCode} />);
    await waitFor(() => expect(container.querySelector("img")).toBeInTheDocument());
    const flag = container.querySelector("img");

    expect(flag).toBeInTheDocument();
    expect(flag).toHaveClass("country-flag-svg");
    expect(flag).toHaveAttribute("src", expect.stringMatching(/(?:data:image\/svg\+xml|\.svg(?:\?|$))/));
    expect(container).not.toHaveTextContent(countryCode);
  });

  it("uses the SVG globe fallback when no country flag is available", () => {
    const { container } = render(<CountryFlag countryCode="ZZ" />);
    const fallback = container.querySelector("svg");

    expect(fallback).toBeInTheDocument();
    expect(fallback).toHaveClass("country-flag-fallback");
    expect(container).not.toHaveTextContent("ZZ");
  });

  it("normalizes valid country codes before resolving an asset", () => {
    expect(normalizeCountryCode(" hk ")).toBe("HK");
    expect(normalizeCountryCode("Hong Kong")).toBeUndefined();
  });

  it("exposes global country/region list with localized labels", () => {
    expect(GLOBAL_COUNTRY_REGIONS.length).toBeGreaterThan(240);
    expect(GLOBAL_COUNTRY_REGIONS.some((item) => item.code === "BR")).toBe(true);
    expect(GLOBAL_COUNTRY_REGIONS.some((item) => item.code === "ZA")).toBe(true);
    expect(getCountryRegionLabel("JP")).toContain("JP");
    expect(getCountryRegionLabel("UN")).toContain("未知");
  });
});
