import { describe, expect, it } from "vitest";
import {
  buildManagedInboundRequest,
  buildManagedWireGuardClientConfig,
  buildManagedWireGuardInbound,
  managedInboundSupportsPublishing,
  managedProtocolOptions,
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

  it("builds Trojan Reality with password authentication and server-only key material", () => {
    const request = buildManagedInboundRequest({
      ...newManagedInboundDraft(),
      name: "Trojan Reality",
      tag: "trojan-reality-in",
      protocol: "trojan-reality",
      password: "trojan-secret",
      domain: "www.cloudflare.com",
      privateKey: "A".repeat(43),
      publicKey: "B".repeat(43),
      shortId: "A1B2C3D4",
    });

    expect(request.inbound).toMatchObject({
      protocol: "trojan",
      settings: { clients: [{ password: "trojan-secret", email: "admin", level: 0 }] },
      streamSettings: {
        network: "tcp",
        security: "reality",
        realitySettings: {
          target: "www.cloudflare.com:443",
          serverNames: ["www.cloudflare.com"],
          privateKey: "A".repeat(43),
          shortIds: ["a1b2c3d4"],
        },
      },
    });
    expect(request.inbound).not.toHaveProperty("cert_id");
    expect((request.inbound.streamSettings as { realitySettings: Record<string, unknown> }).realitySettings).not.toHaveProperty("publicKey");
  });

  it.each([
    {
      preset: "vless-grpc-tls" as ManagedProtocol,
      xrayProtocol: "vless",
      settings: { clients: [{ id: expect.any(String), email: "admin" }], decryption: "none" },
    },
    {
      preset: "vmess-grpc-tls" as ManagedProtocol,
      xrayProtocol: "vmess",
      settings: { clients: [{ id: expect.any(String), email: "admin", security: "chacha20-poly1305", level: 0 }] },
    },
    {
      preset: "trojan-grpc-tls" as ManagedProtocol,
      xrayProtocol: "trojan",
      settings: { clients: [{ password: "proxy-secret", email: "admin", level: 0 }] },
    },
  ])("builds $preset with HTTP/2-only TLS and a normalized service name", ({ preset, xrayProtocol, settings }) => {
    const request = buildManagedInboundRequest({
      ...newManagedInboundDraft(),
      name: `${preset} node`,
      tag: `${preset}-in`,
      protocol: preset,
      domain: "edge.example.com",
      wsPath: "/grpc-service",
      certificateId: "12",
      password: "proxy-secret",
      flow: "xtls-rprx-vision",
      vmessCipher: "chacha20-poly1305",
      skipCertVerify: true,
    });

    expect(request.inbound).toMatchObject({
      protocol: xrayProtocol,
      cert_id: 12,
      settings,
      streamSettings: {
        network: "grpc",
        security: "tls",
        grpcSettings: { serviceName: "grpc-service", multiMode: false },
        tlsSettings: { serverName: "edge.example.com", alpn: ["h2"] },
      },
    });
    expect(request.client_options).toEqual({ skip_cert_verify: true });
    if (preset === "vless-grpc-tls") {
      expect((request.inbound.settings as { clients: Array<Record<string, unknown>> }).clients[0]).not.toHaveProperty("flow");
    }
  });

  it("rejects missing gRPC service names and incomplete Trojan Reality keys", () => {
    expect(() => buildManagedInboundRequest({
      ...newManagedInboundDraft(),
      name: "Missing service",
      protocol: "vless-grpc-tls",
      certificateId: "3",
      domain: "edge.example.com",
      wsPath: "   ",
    })).toThrow("gRPC Service Name 不能为空");

    expect(() => buildManagedInboundRequest({
      ...newManagedInboundDraft(),
      name: "Missing Trojan Reality key",
      protocol: "trojan-reality",
      domain: "www.cloudflare.com",
      privateKey: "",
      publicKey: "",
    })).toThrow("Reality X25519 密钥不完整");
  });

  it("exposes only the audited Trojan presets and marks certificate requirements", () => {
    const trojanOptions = managedProtocolOptions.filter((option) => option.family === "trojan");
    expect(trojanOptions.map((option) => option.value)).toEqual([
      "trojan",
      "trojan-reality",
      "trojan-grpc-tls",
      "trojan-wss",
    ]);
    expect(trojanOptions.find((option) => option.value === "trojan-reality")?.requiresCertificate).not.toBe(true);
    expect(trojanOptions.find((option) => option.value === "trojan-grpc-tls")?.requiresCertificate).toBe(true);
    expect(managedProtocolOptions.some((option) => option.value === ("trojan-none" as ManagedProtocol))).toBe(false);
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

  it("builds a one-time WireGuard inbound without persisting the client private key", () => {
    const clientPrivateKey = `${"A".repeat(43)}=`;
    const draft = {
      ...newManagedInboundDraft(),
      name: "HK WireGuard",
      protocol: "wireguard" as const,
      tag: "wireguard-hk",
      port: "51820",
      wireGuardServerPrivateKey: `${"B".repeat(43)}=`,
      wireGuardServerPublicKey: `${"C".repeat(43)}=`,
      wireGuardClientPrivateKey: clientPrivateKey,
      wireGuardClientPublicKey: `${"D".repeat(43)}=`,
    };

    const inbound = buildManagedWireGuardInbound(draft);
    expect(inbound).toMatchObject({
      tag: "wireguard-hk",
      protocol: "wireguard",
      settings: {
        secretKey: `${"B".repeat(43)}=`,
        address: ["10.66.66.1/32"],
        peers: [{ publicKey: `${"D".repeat(43)}=`, allowedIPs: ["10.66.66.2/32"], keepAlive: 25 }],
      },
    });
    expect(JSON.stringify(inbound)).not.toContain(clientPrivateKey);
    expect(buildManagedWireGuardClientConfig(draft, "edge.example.com")).toContain(`PrivateKey = ${clientPrivateKey}`);
    expect(managedInboundSupportsPublishing({ protocol: "wireguard", ssCipher: "2022-blake3-aes-128-gcm" })).toBe(false);
    expect(() => buildManagedInboundRequest(draft)).toThrow("一次性客户端配置");
  });

  it("builds AnyDoor as a TCP+UDP tunnel to an existing node", () => {
    const request = buildManagedInboundRequest({
      ...newManagedInboundDraft(),
      name: "A-B-C Tunnel",
      tag: "anydoor-2033",
      protocol: "anydoor",
      port: "2033",
      forwardNodeId: "7",
      targetAddress: "target.example.com",
      targetPort: "443",
      publish: true,
    });

    expect(request).toEqual({
      action: "add",
      node_name: "A-B-C Tunnel",
      ip_version: "v4",
      forward_node_id: 7,
      inbound: {
        tag: "anydoor-2033",
        listen: "0.0.0.0",
        port: 2033,
        protocol: "tunnel",
        settings: {
          address: "target.example.com",
          port: 443,
          network: "tcp,udp",
        },
      },
    });
    expect(managedInboundSupportsPublishing({ protocol: "anydoor", ssCipher: "2022-blake3-aes-128-gcm" })).toBe(false);
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
    });
    expect(request.inbound).toMatchObject({
      protocol: "hysteria",
      cert_id: 7,
      settings: { version: 2, clients: [{ auth: "admin-auth", email: "admin" }] },
      streamSettings: {
        network: "hysteria",
        security: "tls",
        tlsSettings: { serverName: "edge.example.com", alpn: ["h3"] },
        hysteriaSettings: { version: 2 },
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
