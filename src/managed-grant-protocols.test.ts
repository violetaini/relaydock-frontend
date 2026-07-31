import { describe, expect, it } from "vitest";
import { managedGrantProtocolGroups, managedGrantProtocolOptions, managedGrantProtocolProfiles } from "./managed-grant-protocols";

describe("managed grant protocol choices", () => {
  it("does not offer unsupported Snell grants", () => {
    expect(managedGrantProtocolGroups.some((group) => group.value === "snell")).toBe(false);
    expect(managedGrantProtocolOptions.some((option) => option.value === "snell")).toBe(false);
    expect(managedGrantProtocolProfiles.some((profile) => profile.value === "snell")).toBe(false);
  });
});
