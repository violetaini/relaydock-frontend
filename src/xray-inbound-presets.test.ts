import { describe, expect, it } from "vitest";
import {
  buildTrojanInbound,
  buildWireGuardClientConfig,
  buildWireGuardInbound,
  generateWireGuardKeyPair,
  x25519ToWireGuardKey,
  type WireGuardInboundFields,
} from "./xray-inbound-presets";

const realityPrivate = "A".repeat(43);
const realityPublic = "B".repeat(43);

describe("Trojan inbound presets", () => {
  it("builds managed WebSocket TLS and direct gRPC TLS variants", () => {
    expect(buildTrojanInbound({
      tag: "trojan-wss",
      port: "443",
      password: "strong-password",
      domain: "edge.example.com",
      combination: "ws-tls",
      path: "/trojan",
    })).toMatchObject({
      listen: "127.0.0.1",
      protocol: "trojan",
      settings: { clients: [{ password: "strong-password" }] },
      streamSettings: { network: "ws", security: "none", wsSettings: { path: "/trojan", host: "edge.example.com" } },
    });

    expect(buildTrojanInbound({
      tag: "trojan-grpc",
      port: "8443",
      password: "strong-password",
      domain: "edge.example.com",
      combination: "grpc-tls",
      certificateId: "9",
      serviceName: "trojan-grpc",
    })).toMatchObject({
      cert_id: 9,
      streamSettings: {
        network: "grpc",
        security: "tls",
        grpcSettings: { serviceName: "trojan-grpc", multiMode: false },
        tlsSettings: { serverName: "edge.example.com", alpn: ["h2"] },
      },
    });
  });

  it("builds Trojan Reality without TLS certificate fields", () => {
    const inbound = buildTrojanInbound({
      tag: "trojan-reality",
      port: "443",
      password: "strong-password",
      domain: "www.example.com",
      combination: "tcp-reality",
      privateKey: realityPrivate,
      publicKey: realityPublic,
      shortId: "a1b2c3d4",
    });
    expect(inbound).not.toHaveProperty("cert_id");
    expect(inbound).toMatchObject({
      protocol: "trojan",
      streamSettings: {
        network: "tcp",
        security: "reality",
        realitySettings: { target: "www.example.com:443", privateKey: realityPrivate, shortIds: ["a1b2c3d4"] },
      },
    });
  });
});

describe("WireGuard inbound preset", () => {
  const fields: WireGuardInboundFields = {
    tag: "wireguard-in",
    port: "51820",
    serverPrivateKey: `${"A".repeat(43)}=`,
    serverPublicKey: `${"B".repeat(43)}=`,
    clientPrivateKey: `${"C".repeat(43)}=`,
    clientPublicKey: `${"D".repeat(43)}=`,
    serverAddress: "10.66.66.1/32",
    clientAddress: "10.66.66.2/32",
    dns: "1.1.1.1, 1.0.0.1",
    mtu: "1420",
    keepAlive: "25",
  };

  it("converts Xray's base64url key format to WireGuard base64", () => {
    expect(x25519ToWireGuardKey(`${"A".repeat(41)}-_`)).toBe(`${"A".repeat(41)}+/=`);
  });

  it("generates WireGuard keys locally in WebCrypto-compatible browsers", async () => {
    const pair = await generateWireGuardKeyPair();
    expect(pair.privateKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(pair.publicKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(pair.privateKey).not.toBe(pair.publicKey);
  });

  it("builds a peer-based Xray WireGuard inbound", () => {
    expect(buildWireGuardInbound(fields)).toMatchObject({
      tag: "wireguard-in",
      port: 51820,
      protocol: "wireguard",
      settings: {
        secretKey: fields.serverPrivateKey,
        address: ["10.66.66.1/32"],
        mtu: 1420,
        peers: [{
          publicKey: fields.clientPublicKey,
          allowedIPs: ["10.66.66.2/32"],
          keepAlive: 25,
        }],
      },
    });
    expect(JSON.stringify(buildWireGuardInbound(fields))).not.toContain(fields.clientPrivateKey);
    expect(() => buildWireGuardInbound({ ...fields, serverAddress: "10.66.66.1/24" })).toThrow("IPv4 /32");
  });

  it("brackets IPv6 endpoints without routing IPv6 through an IPv4-only tunnel", () => {
    const ipv6EndpointConfig = buildWireGuardClientConfig(fields, "2603:c024::1");
    expect(ipv6EndpointConfig).toContain("Endpoint = [2603:c024::1]:51820");
    expect(ipv6EndpointConfig).toContain("AllowedIPs = 0.0.0.0/0");
    expect(ipv6EndpointConfig).not.toContain("::/0");
    expect(buildWireGuardClientConfig(fields, "edge.example.com")).toContain(`PublicKey = ${fields.serverPublicKey}`);
  });
});
