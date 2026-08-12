import { describe, expect, it } from "vitest";
import { managedGrantProtocolGroups, managedGrantProtocolOptions, managedGrantProtocolProfiles } from "./managed-grant-protocols";

describe("managed grant protocol choices", () => {
  it.each(["snell", "anytls"])("does not offer unsupported %s grants", (protocol) => {
    expect(managedGrantProtocolGroups.some((group) => group.value === protocol)).toBe(false);
    expect(managedGrantProtocolOptions.some((option) => option.value === protocol)).toBe(false);
    expect(managedGrantProtocolProfiles.some((profile) => profile.value === protocol)).toBe(false);
  });

  it("offers separate exact Shadowsocks Classic and 2022 profiles", () => {
    const shadowsocks = managedGrantProtocolGroups.find((group) => group.value === "shadowsocks");
    expect(shadowsocks?.profiles.map((profile) => profile.value)).toEqual([
      "shadowsocks-classic",
      "shadowsocks-2022",
    ]);
    expect(shadowsocks?.profiles[0]).toMatchObject({
      family: "shadowsocks",
      detail: "AES-128/256-GCM · 多用户",
    });
  });
});
