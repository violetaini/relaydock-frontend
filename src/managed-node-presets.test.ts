import { describe, expect, it } from "vitest";
import {
  buildManagedInboundRequest,
  managedInboundSupportsPublishing,
  newManagedInboundDraft,
  randomBase64,
  type ManagedProtocol,
} from "./managed-node-presets";

describe("managed node protocol presets", () => {
  it("builds Reality with the selected flow and exact key material", () => {
    const request = buildManagedInboundRequest({
      ...newManagedInboundDraft(),
      name: "HK Reality",
      domain: "www.cloudflare.com",
      privateKey: "A".repeat(43),
      publicKey: "B".repeat(43),
      shortId: "a1b2c3d4",
      flow: "",
    });
    expect(request.node_name).toBe("HK Reality");
    expect(request.inbound).toMatchObject({
      protocol: "vless",
      settings: { clients: [{ id: expect.any(String), email: "admin" }], decryption: "none" },
      streamSettings: {
        network: "tcp",
        security: "reality",
        realitySettings: { target: "www.cloudflare.com:443", serverNames: ["www.cloudflare.com"], privateKey: "A".repeat(43), shortIds: ["a1b2c3d4"] },
      },
    });
    expect((request.inbound.streamSettings as { realitySettings: Record<string, unknown> }).realitySettings).not.toHaveProperty("publicKey");
    expect((request.inbound.streamSettings as { realitySettings: Record<string, unknown> }).realitySettings).not.toHaveProperty("dest");
    expect((request.inbound.settings as { clients: Array<Record<string, unknown>> }).clients[0]).not.toHaveProperty("flow");
  });

  it("requires a dedicated Reality camouflage target domain", () => {
    expect(() => buildManagedInboundRequest({
      ...newManagedInboundDraft(),
      name: "Missing Reality target",
      domain: "",
      privateKey: "A".repeat(43),
      publicKey: "B".repeat(43),
    })).toThrow("Reality 必须填写有效的伪装目标域名 / SNI");
  });

  it.each([
    {
      preset: "vless-tls" as ManagedProtocol,
      xrayProtocol: "vless",
      network: "tcp",
      security: "tls",
      client: { id: expect.any(String), email: "admin", flow: "xtls-rprx-vision" },
      certificate: true,
      loopback: false,
    },
    {
      preset: "vless-ws" as ManagedProtocol,
      xrayProtocol: "vless",
      network: "ws",
      security: "none",
      client: { id: expect.any(String), email: "admin" },
      certificate: false,
      loopback: false,
    },
    {
      preset: "vless-wss" as ManagedProtocol,
      xrayProtocol: "vless",
      network: "ws",
      security: "none",
      client: { id: expect.any(String), email: "admin" },
      certificate: false,
      loopback: true,
    },
    {
      preset: "vmess" as ManagedProtocol,
      xrayProtocol: "vmess",
      network: "tcp",
      security: "none",
      client: { id: expect.any(String), email: "admin", security: "chacha20-poly1305", level: 0 },
      certificate: false,
      loopback: false,
    },
    {
      preset: "vmess-tls" as ManagedProtocol,
      xrayProtocol: "vmess",
      network: "tcp",
      security: "tls",
      client: { id: expect.any(String), email: "admin", security: "chacha20-poly1305", level: 0 },
      certificate: true,
      loopback: false,
    },
    {
      preset: "vmess-ws" as ManagedProtocol,
      xrayProtocol: "vmess",
      network: "ws",
      security: "none",
      client: { id: expect.any(String), email: "admin", security: "chacha20-poly1305", level: 0 },
      certificate: false,
      loopback: false,
    },
    {
      preset: "vmess-wss" as ManagedProtocol,
      xrayProtocol: "vmess",
      network: "ws",
      security: "none",
      client: { id: expect.any(String), email: "admin", security: "chacha20-poly1305", level: 0 },
      certificate: false,
      loopback: true,
    },
    {
      preset: "trojan" as ManagedProtocol,
      xrayProtocol: "trojan",
      network: "tcp",
      security: "tls",
      client: { password: "proxy-secret", email: "admin", level: 0 },
      certificate: true,
      loopback: false,
    },
    {
      preset: "trojan-wss" as ManagedProtocol,
      xrayProtocol: "trojan",
      network: "ws",
      security: "none",
      client: { password: "proxy-secret", email: "admin", level: 0 },
      certificate: false,
      loopback: true,
    },
  ])("builds $preset with protocol-specific credentials and transport", ({ preset, xrayProtocol, network, security, client, certificate, loopback }) => {
    const request = buildManagedInboundRequest({
      ...newManagedInboundDraft(),
      name: `${preset} node`,
      tag: `${preset}-in`,
      protocol: preset,
      domain: "edge.example.com",
      wsPath: "/ws/test-path",
      certificateId: "9",
      password: "proxy-secret",
      flow: "xtls-rprx-vision",
      vmessCipher: "chacha20-poly1305",
    });
    expect(request.inbound).toMatchObject({
      protocol: xrayProtocol,
      settings: { clients: [client] },
      streamSettings: { network, security },
    });
    if (network === "ws") {
      expect(request.inbound).toMatchObject({
        listen: loopback ? "127.0.0.1" : "0.0.0.0",
        streamSettings: { wsSettings: { path: "/ws/test-path", host: "edge.example.com" } },
      });
    }
    if (certificate) expect(request.inbound).toMatchObject({ cert_id: 9, streamSettings: { tlsSettings: { serverName: "edge.example.com" } } });
    else expect(request.inbound).not.toHaveProperty("cert_id");
  });

  it.each(["vless-ws", "vmess-ws"] as const)("builds public plain WS without requiring a domain for %s", (protocol) => {
    const request = buildManagedInboundRequest({
      ...newManagedInboundDraft(),
      name: `${protocol} no host`,
      protocol,
      port: "8080",
      domain: "",
      wsPath: "/socket",
    });
    expect(request.inbound).toMatchObject({
      listen: "0.0.0.0",
      port: 8080,
      streamSettings: { network: "ws", security: "none", wsSettings: { path: "/socket" } },
    });
    expect((request.inbound.streamSettings as { wsSettings: Record<string, unknown> }).wsSettings).not.toHaveProperty("headers");
    expect((request.inbound.streamSettings as { wsSettings: Record<string, unknown> }).wsSettings).not.toHaveProperty("host");
  });

  it.each(["vless-wss", "vmess-wss", "trojan-wss"] as const)("keeps managed WSS domain-gated for %s", (protocol) => {
    expect(() => buildManagedInboundRequest({
      ...newManagedInboundDraft(),
      name: `${protocol} missing domain`,
      protocol,
      domain: "",
    })).toThrow("域名必须是");
  });

  it("allows VLESS TCP TLS without Vision flow", () => {
    const request = buildManagedInboundRequest({
      ...newManagedInboundDraft(),
      name: "VLESS TLS",
      protocol: "vless-tls",
      certificateId: "3",
      domain: "edge.example.com",
      flow: "",
    });
    const client = (request.inbound.settings as { clients: Array<Record<string, unknown>> }).clients[0];
    expect(client).not.toHaveProperty("flow");
  });

  it.each([
    ["2022-blake3-aes-128-gcm", 16],
    ["2022-blake3-aes-256-gcm", 32],
  ] as const)("builds a multi-user Shadowsocks 2022 inbound for %s", (cipher, keyLength) => {
    const master = randomBase64(keyLength);
    const user = randomBase64(keyLength);
    const request = buildManagedInboundRequest({
      ...newManagedInboundDraft(),
      name: "SS 2022",
      tag: "ss-2022",
      protocol: "shadowsocks",
      ssCipher: cipher,
      password: master,
      ssUserPassword: user,
    });
    expect(request.inbound).toMatchObject({
      protocol: "shadowsocks",
      settings: {
        method: cipher,
        password: master,
        network: "tcp,udp",
        clients: [{ password: user, email: "admin", level: 0 }],
      },
    });
  });

  it.each(["aes-128-gcm", "aes-256-gcm", "chacha20-ietf-poly1305"] as const)("builds classic single-password Shadowsocks for %s", (cipher) => {
    const request = buildManagedInboundRequest({
      ...newManagedInboundDraft(),
      name: "Classic SS",
      tag: "ss-classic",
      protocol: "shadowsocks",
      ssCipher: cipher,
      password: "classic-password",
    });
    expect(request.inbound).toMatchObject({
      protocol: "shadowsocks",
      settings: { method: cipher, password: "classic-password", email: "admin", network: "tcp,udp" },
    });
    expect(request.inbound.settings).not.toHaveProperty("clients");
    expect(managedInboundSupportsPublishing({ protocol: "shadowsocks", ssCipher: cipher })).toBe(false);
  });

  it("keeps Shadowsocks 2022 eligible for isolated user publishing", () => {
    expect(managedInboundSupportsPublishing({ protocol: "shadowsocks", ssCipher: "2022-blake3-aes-128-gcm" })).toBe(true);
    expect(managedInboundSupportsPublishing({ protocol: "vmess-ws", ssCipher: "aes-128-gcm" })).toBe(true);
  });

  it("uses Xray's canonical hysteria protocol with version 2 and a managed certificate", () => {
    const request = buildManagedInboundRequest({
      ...newManagedInboundDraft(),
      name: "US Hysteria2",
      tag: "hy2-us",
      protocol: "hysteria2",
      password: "admin-auth",
      certificateId: "7",
      domain: "edge.example.com",
      hysteriaObfsPassword: "obfs-secret",
    });
    expect(request.inbound).toMatchObject({
      protocol: "hysteria",
      cert_id: 7,
      settings: { version: 2, clients: [{ auth: "admin-auth", email: "admin" }] },
      streamSettings: {
        network: "hysteria",
        security: "tls",
        tlsSettings: { serverName: "edge.example.com" },
        hysteriaSettings: { version: 2, password: "obfs-secret" },
      },
    });
  });

  it.each([
    ["socks5", "socks", { auth: "password", udp: true }],
    ["http", "http", { allowTransparent: false }],
  ] as const)("builds an authenticated %s inbound", (protocol, xrayProtocol, extraSettings) => {
    const request = buildManagedInboundRequest({
      ...newManagedInboundDraft(),
      name: `${protocol} node`,
      protocol,
      accountUsername: "operator",
      password: "proxy-secret",
    });
    expect(request.inbound).toMatchObject({
      protocol: xrayProtocol,
      settings: {
        accounts: [{ user: "operator", pass: "proxy-secret" }],
        ...extraSettings,
      },
    });
  });
});
