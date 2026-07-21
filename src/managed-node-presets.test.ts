import { describe, expect, it } from "vitest";
import { buildManagedInboundRequest, newManagedInboundDraft, randomBase64 } from "./managed-node-presets";

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
        realitySettings: { dest: "www.cloudflare.com:443", privateKey: "A".repeat(43), publicKey: "B".repeat(43), shortIds: ["a1b2c3d4"] },
      },
    });
    expect((request.inbound.settings as { clients: Array<Record<string, unknown>> }).clients[0]).not.toHaveProperty("flow");
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
