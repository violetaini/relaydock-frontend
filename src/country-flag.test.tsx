import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CountryFlag, normalizeCountryCode } from "./country-flag";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

describe("CountryFlag", () => {
  it.each(["HK", "US", "JP", "UK"])("renders %s as a bundled SVG flag", (countryCode) => {
    const { container } = render(<CountryFlag countryCode={countryCode} />);
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
});
