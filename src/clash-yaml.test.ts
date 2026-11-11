import { describe, expect, it } from "vitest";
import {
  formatProxyToClashJSON,
  formatProxyToClashYAML,
  parseClashProxyInput,
} from "./clash-yaml";

describe("clash-yaml helpers", () => {
  it("formats stored JSON with alphabetical keys and network:tcp into standard Clash YAML", () => {
    const storedJSON = JSON.stringify({
      alterId: 0,
      cipher: "auto",
      name: "1111",
      network: "tcp",
      port: 5245,
      server: "170.9.59.149",
      type: "vmess",
      udp: true,
      uuid: "fd3123de-8ad2-480e-b106-8445cc4006e3",
      "x-arcway-managed-users": [{ id: 1 }],
    });

    const yamlText = formatProxyToClashYAML(storedJSON);
    expect(yamlText).toBe(
      [
        "proxies:",
        "  - name: '1111'",
        "    type: vmess",
        "    server: 170.9.59.149",
        "    port: 5245",
        "    uuid: fd3123de-8ad2-480e-b106-8445cc4006e3",
        "    alterId: 0",
        "    cipher: auto",
        "    udp: true",
        "",
      ].join("\n"),
    );

    const jsonText = formatProxyToClashJSON(storedJSON);
    const parsedFromJSON = JSON.parse(jsonText);
    expect(Object.keys(parsedFromJSON)).toEqual([
      "name",
      "type",
      "server",
      "port",
      "uuid",
      "alterId",
      "cipher",
      "udp",
    ]);
    expect(parsedFromJSON.network).toBeUndefined();
  });

  it("preserves non-tcp network and reality short-id strings", () => {
    const vlessReality = {
      name: "HK Reality",
      type: "vless",
      server: "203.0.113.10",
      port: 443,
      uuid: "fd3123de-8ad2-480e-b106-8445cc4006e3",
      network: "tcp",
      tls: true,
      udp: true,
      flow: "xtls-rprx-vision",
      servername: "www.microsoft.com",
      "client-fingerprint": "chrome",
      "reality-opts": {
        "public-key": "pub_key_123",
        "short-id": "01234567",
      },
    };

    const yamlText = formatProxyToClashYAML(vlessReality);
    expect(yamlText).not.toContain("network: tcp");
    expect(yamlText).toContain("short-id: '01234567'");

    const parsed = parseClashProxyInput(yamlText);
    expect(parsed).toMatchObject({
      name: "HK Reality",
      type: "vless",
      server: "203.0.113.10",
      port: 443,
      "reality-opts": {
        "public-key": "pub_key_123",
        "short-id": "01234567",
      },
    });
    expect(parsed.network).toBeUndefined();
  });

  it("accepts proxies YAML, list item YAML, mapping YAML, and JSON on input", () => {
    const fromProxies = parseClashProxyInput(`
proxies:
  - name: 1111
    type: vmess
    server: 170.9.59.149
    port: 5245
    uuid: fd3123de-8ad2-480e-b106-8445cc4006e3
    alterId: 0
    cipher: auto
    network: ws
    ws-opts:
      path: /ws
`);
    expect(fromProxies.name).toBe("1111");
    expect(fromProxies.network).toBe("ws");
    expect(fromProxies["ws-opts"]).toEqual({ path: "/ws" });

    const fromList = parseClashProxyInput(`
- name: 2222
  type: trojan
  server: example.com
  port: 443
  password: 999999
  network: tcp
`);
    expect(fromList.name).toBe("2222");
    expect(fromList.password).toBe("999999");
    expect(fromList.network).toBeUndefined();

    const fromMapping = parseClashProxyInput(`
name: NodeA
type: ss
server: 1.2.3.4
port: "8388"
cipher: aes-256-gcm
password: secret
`);
    expect(fromMapping.name).toBe("NodeA");
    expect(fromMapping.port).toBe(8388);

    const fromJSON = parseClashProxyInput(
      JSON.stringify({
        name: "1111",
        type: "vmess",
        server: "170.9.59.149",
        port: 5245,
        network: "tcp",
      }),
    );
    expect(fromJSON).toEqual({
      name: "1111",
      type: "vmess",
      server: "170.9.59.149",
      port: 5245,
    });
  });

  it("supports VLESS TCP (no TLS) inbound presets and blocks Cloudflare CDN proxy targets", async () => {
    const {
      buildManagedInboundRequest,
      newManagedInboundDraft,
      protocolDefaults,
      validateWSSCamouflageProxyTarget,
    } = await import("./managed-node-presets");

    const draft = {
      ...newManagedInboundDraft(),
      ...protocolDefaults("vless"),
      name: "VLESS Plain TCP",
      tag: "vless-tcp-test",
      port: "20080",
      uuid: "63d4765a-4e7e-4a60-a47f-9780b98e7e9b",
    };
    const req = buildManagedInboundRequest(draft);
    expect(req.inbound).toMatchObject({
      tag: "vless-tcp-test",
      listen: "0.0.0.0",
      port: 20080,
      protocol: "vless",
      settings: {
        clients: [{ id: "63d4765a-4e7e-4a60-a47f-9780b98e7e9b", email: "admin" }],
        decryption: "none",
      },
      streamSettings: {
        network: "tcp",
        security: "none",
      },
    });

    expect(() => validateWSSCamouflageProxyTarget("https://demo.workers.dev")).toThrow(/Cloudflare/);
    expect(() => validateWSSCamouflageProxyTarget("http://104.16.1.1")).toThrow(/Cloudflare/);
    expect(() => validateWSSCamouflageProxyTarget("https://172.67.5.10")).toThrow(/Cloudflare/);
    expect(validateWSSCamouflageProxyTarget("https://origin.example.com")).toBe("https://origin.example.com");
  });
});
