import { describe, expect, it } from "vitest";
import {
  applyXrayBasicDefaults,
  readXrayBasicSettings,
  setXrayBasicRule,
  setXrayFreedomStrategy,
  setXrayLog,
  setXrayRoutingStrategy,
  setXrayStat,
  setXrayTorrentBlocked,
  type XrayConfigObject,
} from "./xray-basic-config";

function baseConfig(): XrayConfigObject {
  return {
    log: { loglevel: "warning" },
    inbounds: [{ tag: "database-owned", protocol: "vless", port: 443 }],
    outbounds: [
      { tag: "direct", protocol: "freedom", settings: {} },
      { tag: "block", protocol: "blackhole", settings: {} },
      { tag: "custom-proxy", protocol: "socks", settings: { servers: [] } },
    ],
    routing: {
      domainStrategy: "AsIs",
      rules: [
        { type: "field", outboundTag: "block", ip: ["geoip:private"] },
        { type: "field", outboundTag: "block", protocol: ["bittorrent"] },
        { type: "field", inboundTag: ["special-in"], outboundTag: "block", domain: ["domain:conditional.example"] },
        { type: "field", outboundTag: "custom-proxy", domain: ["domain:keep.example"] },
      ],
    },
    dns: { servers: ["1.1.1.1"] },
  };
}

describe("Xray basic configuration model", () => {
  it("projects safe, global shortcut rules without absorbing conditional rules", () => {
    const settings = readXrayBasicSettings(baseConfig());

    expect(settings.blockOutboundTag).toBe("block");
    expect(settings.blockedIPs).toEqual(["geoip:private"]);
    expect(settings.blockedDomains).toEqual([]);
    expect(settings.torrentBlocked).toBe(true);
  });

  it("updates common strategies, statistics, and logging in the Xray JSON", () => {
    const config = baseConfig();

    setXrayFreedomStrategy(config, "UseIPv4");
    setXrayRoutingStrategy(config, "IPIfNonMatch");
    setXrayStat(config, "statsInboundUplink", true);
    setXrayStat(config, "statsOutboundDownlink", false);
    setXrayLog(config, "maskAddress", "half");
    setXrayLog(config, "dnsLog", true);

    const settings = readXrayBasicSettings(config);
    expect(settings.freedomStrategy).toBe("UseIPv4");
    expect(settings.routingStrategy).toBe("IPIfNonMatch");
    expect(settings.statsInboundUplink).toBe(true);
    expect(settings.statsOutboundDownlink).toBe(false);
    expect(settings.maskAddress).toBe("half");
    expect(settings.dnsLog).toBe(true);
    expect(config.stats).toEqual({});
  });

  it("adds and clears shortcut rules without deleting unrelated rules or outbounds", () => {
    const config = baseConfig();

    setXrayBasicRule(config, "blockedDomains", ["geosite:category-ads-all", "domain:example.test"]);
    setXrayBasicRule(config, "ipv4Domains", ["geosite:openai"]);
    setXrayTorrentBlocked(config, false);
    setXrayBasicRule(config, "blockedIPs", []);

    const settings = readXrayBasicSettings(config);
    expect(settings.blockedDomains).toEqual(["geosite:category-ads-all", "domain:example.test"]);
    expect(settings.blockedIPs).toEqual([]);
    expect(settings.torrentBlocked).toBe(false);
    expect(settings.ipv4Domains).toEqual(["geosite:openai"]);

    const rules = (config.routing as { rules: XrayConfigObject[] }).rules;
    expect(rules).toContainEqual(expect.objectContaining({ inboundTag: ["special-in"], domain: ["domain:conditional.example"] }));
    expect(rules).toContainEqual(expect.objectContaining({ outboundTag: "custom-proxy", domain: ["domain:keep.example"] }));
    const outbounds = config.outbounds as XrayConfigObject[];
    expect(outbounds.map((item) => item.tag)).toEqual(["direct", "block", "custom-proxy", "IPv4"]);
  });

  it("does not create unused outbounds when an empty shortcut is cleared", () => {
    const config: XrayConfigObject = { outbounds: [], routing: { rules: [] } };

    setXrayBasicRule(config, "blockedDomains", []);
    setXrayBasicRule(config, "directDomains", []);

    expect(config.outbounds).toEqual([]);
    expect((config.routing as XrayConfigObject).rules).toEqual([]);
  });

  it("restores only the basic defaults and preserves database-owned and advanced sections", () => {
    const config = baseConfig();
    const inbounds = JSON.stringify(config.inbounds);
    const dns = JSON.stringify(config.dns);

    applyXrayBasicDefaults(config);

    const settings = readXrayBasicSettings(config);
    expect(settings).toEqual(expect.objectContaining({
      freedomStrategy: "AsIs",
      routingStrategy: "AsIs",
      statsInboundUplink: true,
      statsInboundDownlink: true,
      statsOutboundUplink: false,
      statsOutboundDownlink: false,
      logLevel: "warning",
      accessLog: "none",
      errorLog: "",
      maskAddress: "",
      dnsLog: false,
      torrentBlocked: true,
      blockedIPs: ["geoip:private"],
      blockedDomains: [],
      directIPs: [],
      directDomains: [],
      ipv4Domains: [],
      warpDomains: [],
    }));
    expect(JSON.stringify(config.inbounds)).toBe(inbounds);
    expect(JSON.stringify(config.dns)).toBe(dns);
    expect((config.outbounds as XrayConfigObject[]).some((item) => item.tag === "custom-proxy")).toBe(true);
    expect(((config.routing as XrayConfigObject).rules as XrayConfigObject[])).toContainEqual(
      expect.objectContaining({ inboundTag: ["special-in"], domain: ["domain:conditional.example"] }),
    );
  });
});
