import {
  buildWireGuardClientProfile,
  buildWireGuardClientConfig,
  buildWireGuardInbound,
  type WireGuardClientProfile,
  type WireGuardInboundFields,
} from "./xray-inbound-presets";

export type ManagedProtocol =
  | "vless-reality"
  | "vless-tls"
  | "vless-grpc-tls"
  | "vless-ws"
  | "vless-wss"
  | "vmess"
  | "vmess-tls"
  | "vmess-grpc-tls"
  | "vmess-ws"
  | "vmess-wss"
  | "trojan"
  | "trojan-reality"
  | "trojan-grpc-tls"
  | "trojan-wss"
  | "shadowsocks"
  | "hysteria2"
  | "socks5"
  | "http"
  | "wireguard"
  | "anydoor";

export type ManagedProtocolFamily = "vless" | "vmess" | "trojan" | "shadowsocks" | "hysteria2" | "socks5" | "http" | "wireguard" | "anydoor";
export type ShadowsocksCipher =
  | "aes-128-gcm"
  | "aes-256-gcm"
  | "chacha20-ietf-poly1305"
  | "2022-blake3-aes-128-gcm"
  | "2022-blake3-aes-256-gcm";

export interface ManagedInboundDraft {
  name: string;
  tag: string;
  port: string;
  protocol: ManagedProtocol;
  ipVersion: "v4" | "v6" | "both";
  uuid: string;
  password: string;
  ssUserPassword: string;
  flow: "xtls-rprx-vision" | "";
  domain: string;
  wsPath: string;
  shortId: string;
  privateKey: string;
  publicKey: string;
  vmessCipher: "auto" | "aes-128-gcm" | "chacha20-poly1305";
  ssCipher: ShadowsocksCipher;
  certificateId: string;
  skipCertVerify: boolean;
  accountUsername: string;
  wireGuardServerPrivateKey: string;
  wireGuardServerPublicKey: string;
  wireGuardClientPrivateKey: string;
  wireGuardClientPublicKey: string;
  wireGuardServerAddress: string;
  wireGuardClientAddress: string;
  wireGuardDNS: string;
  wireGuardMTU: string;
  wireGuardKeepAlive: string;
  forwardNodeId: string;
  targetAddress: string;
  targetPort: string;
  publish: boolean;
  sortOrder: string;
}

export interface ManagedInboundRequest {
  action: "add";
  node_name: string;
  ip_version: "v4" | "v6" | "both";
  forward_node_id?: number;
  client_options?: {
    skip_cert_verify?: boolean;
  };
  inbound: Record<string, unknown>;
}

export const managedProtocolOptions: Array<{
  value: ManagedProtocol;
  family: ManagedProtocolFamily;
  familyLabel: string;
  label: string;
  detail: string;
  requiresCertificate?: boolean;
}> = [
  { value: "vless-reality", family: "vless", familyLabel: "VLESS", label: "VLESS Reality", detail: "RAW/TCP · Reality · 伪装目标 SNI 必填" },
  { value: "vless-tls", family: "vless", familyLabel: "VLESS", label: "VLESS TCP TLS", detail: "TCP · 托管 TLS 证书", requiresCertificate: true },
  { value: "vless-grpc-tls", family: "vless", familyLabel: "VLESS", label: "VLESS gRPC TLS", detail: "gRPC · 托管 TLS 证书 · ALPN h2", requiresCertificate: true },
  { value: "vless-wss", family: "vless", familyLabel: "VLESS", label: "VLESS WSS", detail: "WebSocket · Nginx TLS · 节点域名" },
  { value: "vless-ws", family: "vless", familyLabel: "VLESS", label: "VLESS WS", detail: "WebSocket · 无 TLS · 域名可选 · 受信链路" },
  { value: "vmess-tls", family: "vmess", familyLabel: "VMess", label: "VMess TCP TLS", detail: "TCP · 托管 TLS 证书", requiresCertificate: true },
  { value: "vmess-grpc-tls", family: "vmess", familyLabel: "VMess", label: "VMess gRPC TLS", detail: "gRPC · 托管 TLS 证书 · ALPN h2", requiresCertificate: true },
  { value: "vmess-wss", family: "vmess", familyLabel: "VMess", label: "VMess WSS", detail: "WebSocket · Nginx TLS · 节点域名" },
  { value: "vmess-ws", family: "vmess", familyLabel: "VMess", label: "VMess WS", detail: "WebSocket · 无 TLS · 域名可选" },
  { value: "vmess", family: "vmess", familyLabel: "VMess", label: "VMess TCP（兼容）", detail: "TCP · 无传输层加密" },
  { value: "trojan", family: "trojan", familyLabel: "Trojan", label: "Trojan TCP TLS", detail: "TCP · 托管 TLS 证书", requiresCertificate: true },
  { value: "trojan-reality", family: "trojan", familyLabel: "Trojan", label: "Trojan TCP Reality", detail: "RAW/TCP · Reality · 无需证书" },
  { value: "trojan-grpc-tls", family: "trojan", familyLabel: "Trojan", label: "Trojan gRPC TLS", detail: "gRPC · 托管 TLS 证书 · ALPN h2", requiresCertificate: true },
  { value: "trojan-wss", family: "trojan", familyLabel: "Trojan", label: "Trojan WSS", detail: "WebSocket · Nginx TLS · 节点域名" },
  { value: "shadowsocks", family: "shadowsocks", familyLabel: "Shadowsocks", label: "Shadowsocks", detail: "经典 AES-GCM 或 2022 · 多用户" },
  { value: "hysteria2", family: "hysteria2", familyLabel: "Hysteria2", label: "Hysteria2", detail: "UDP · TLS · Hysteria2", requiresCertificate: true },
  { value: "socks5", family: "socks5", familyLabel: "SOCKS5", label: "SOCKS5", detail: "TCP + UDP · 用户名密码" },
  { value: "http", family: "http", familyLabel: "HTTP", label: "HTTP Proxy", detail: "TCP · 用户名密码" },
  { value: "wireguard", family: "wireguard", familyLabel: "WireGuard", label: "WireGuard", detail: "UDP · 客户端凭据加密存储" },
  { value: "anydoor", family: "anydoor", familyLabel: "Tunnel", label: "Tunnel（任意门）", detail: "同时转发 TCP 与 UDP · 目标为已有节点" },
];

export function isManagedWSSProtocol(protocol: ManagedProtocol): boolean {
  return protocol === "vless-wss" || protocol === "vmess-wss" || protocol === "trojan-wss";
}

export function isManagedPlainWSProtocol(protocol: ManagedProtocol): boolean {
  return protocol === "vless-ws" || protocol === "vmess-ws";
}

export function isManagedRealityProtocol(protocol: ManagedProtocol): boolean {
  return protocol === "vless-reality" || protocol === "trojan-reality";
}

export function isManagedGRPCProtocol(protocol: ManagedProtocol): boolean {
  return protocol === "vless-grpc-tls" || protocol === "vmess-grpc-tls" || protocol === "trojan-grpc-tls";
}

export function isManagedUUIDProtocol(protocol: ManagedProtocol): boolean {
  return protocol === "vless-reality" || protocol === "vless-tls" || protocol === "vless-grpc-tls" || protocol === "vless-ws" || protocol === "vless-wss" || protocol === "vmess" || protocol === "vmess-tls" || protocol === "vmess-grpc-tls" || protocol === "vmess-ws" || protocol === "vmess-wss";
}

export function isShadowsocks2022Cipher(cipher: ShadowsocksCipher): boolean {
  return cipher.startsWith("2022-");
}

export function isShadowsocksClassicMultiUserCipher(cipher: ShadowsocksCipher): boolean {
  return cipher === "aes-128-gcm" || cipher === "aes-256-gcm";
}

export function managedInboundSupportsPublishing(draft: Pick<ManagedInboundDraft, "protocol" | "ssCipher">): boolean {
  if (draft.protocol === "anydoor" || draft.protocol === "wireguard") return false;
  return draft.protocol !== "shadowsocks"
    || isShadowsocks2022Cipher(draft.ssCipher)
    || isShadowsocksClassicMultiUserCipher(draft.ssCipher);
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return bytes;
}

export function randomHex(length: number): string {
  return Array.from(randomBytes(Math.ceil(length / 2)), (value) => value.toString(16).padStart(2, "0")).join("").slice(0, length);
}

export function randomBase64(byteLength: number): string {
  const bytes = randomBytes(byteLength);
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return globalThis.btoa(binary);
}

export function createManagedUUID(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const value = randomHex(32).split("");
  value[12] = "4";
  value[16] = ["8", "9", "a", "b"][Number.parseInt(value[16], 16) % 4];
  const joined = value.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

export function newManagedInboundDraft(): ManagedInboundDraft {
  return {
    name: "",
    tag: `vless-reality-${randomHex(6)}`,
    port: "443",
    protocol: "vless-reality",
    ipVersion: "v4",
    uuid: createManagedUUID(),
    password: createManagedUUID(),
    ssUserPassword: randomBase64(16),
    flow: "xtls-rprx-vision",
    domain: "",
    wsPath: `/ws/${randomHex(12)}`,
    shortId: randomHex(16),
    privateKey: "",
    publicKey: "",
    vmessCipher: "auto",
    ssCipher: "2022-blake3-aes-128-gcm",
    certificateId: "",
    skipCertVerify: false,
    accountUsername: "admin",
    wireGuardServerPrivateKey: "",
    wireGuardServerPublicKey: "",
    wireGuardClientPrivateKey: "",
    wireGuardClientPublicKey: "",
    wireGuardServerAddress: "10.66.66.1/32",
    wireGuardClientAddress: "10.66.66.2/32",
    wireGuardDNS: "1.1.1.1, 1.0.0.1",
    wireGuardMTU: "1420",
    wireGuardKeepAlive: "25",
    forwardNodeId: "",
    targetAddress: "",
    targetPort: "2033",
    publish: false,
    sortOrder: "0",
  };
}

export function protocolDefaults(protocol: ManagedProtocol): Partial<ManagedInboundDraft> {
  const base = { protocol, port: "443" } as const;
  switch (protocol) {
    case "vless-reality": return { ...base, tag: "vless-reality", flow: "xtls-rprx-vision" };
    case "vless-tls": return { ...base, tag: "vless-tcp-tls", flow: "xtls-rprx-vision" };
    case "vless-grpc-tls": return { ...base, tag: "vless-grpc-tls", flow: "", wsPath: `vless-${randomHex(12)}` };
    case "vless-ws": return { ...base, port: "8080", tag: "vless-ws", flow: "", domain: "" };
    case "vless-wss": return { ...base, tag: "vless-wss", flow: "" };
    case "vmess": return { ...base, tag: "vmess-tcp", flow: "" };
    case "vmess-tls": return { ...base, tag: "vmess-tcp-tls", flow: "" };
    case "vmess-grpc-tls": return { ...base, tag: "vmess-grpc-tls", flow: "", wsPath: `vmess-${randomHex(12)}` };
    case "vmess-ws": return { ...base, port: "8080", tag: "vmess-ws", flow: "", domain: "" };
    case "vmess-wss": return { ...base, tag: "vmess-wss", flow: "" };
    case "trojan": return { ...base, tag: "trojan-tls", flow: "" };
    case "trojan-reality": return { ...base, tag: "trojan-reality", flow: "", domain: "" };
    case "trojan-grpc-tls": return { ...base, tag: "trojan-grpc-tls", flow: "", wsPath: `trojan-${randomHex(12)}` };
    case "trojan-wss": return { ...base, tag: "trojan-wss", flow: "" };
    case "shadowsocks": return { ...base, tag: "ss2022", flow: "", ssCipher: "2022-blake3-aes-128-gcm" };
    case "hysteria2": return { ...base, tag: "hysteria2", flow: "" };
    case "socks5": return { ...base, tag: "socks5", flow: "" };
    case "http": return { ...base, tag: "http-proxy", flow: "" };
    case "wireguard": return { ...base, port: "51820", tag: "wireguard", flow: "", publish: false };
    case "anydoor": return { ...base, port: "2033", tag: "anydoor", flow: "", publish: false };
  }
}

function requirePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("监听端口必须在 1 到 65535 之间");
  return port;
}

function requireTargetPort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("目标端口必须在 1 到 65535 之间");
  return port;
}

function requireForwardTargetAddress(value: string): string {
  const address = value.trim();
  if (!address || address.length > 253 || /[\s/?#]/.test(address) || address.includes("://")) {
    throw new Error("目标节点地址必须是有效的域名或 IP，不含协议、端口和路径");
  }
  return address;
}

function requireInboundTag(value: string): string {
  const tag = value.trim();
  if (!tag) throw new Error("入站标识（Tag）不能为空");
  return tag;
}

function requireUUID(value: string): string {
  const uuid = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) throw new Error("UUID 必须是标准的 36 位格式");
  return uuid;
}

function requirePassword(value: string): string {
  const password = value.trim();
  if (!password) throw new Error("认证密码不能为空");
  return password;
}

function requireDomain(value: string): string {
  const domain = value.trim().toLowerCase();
  if (domain.length < 3 || domain.length > 253 || !domain.includes(".") || domain.includes("..") || !domain.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
    throw new Error("域名必须是不含协议、端口和路径的有效主机名");
  }
  return domain;
}

function requireRealityTargetDomain(value: string): string {
  try {
    return requireDomain(value);
  } catch {
    throw new Error("Reality 必须填写有效的伪装目标域名 / SNI（它不是节点连接地址）");
  }
}

function requireWebSocketPath(value: string): string {
  const path = value.trim();
  if (path.length < 2 || path.length > 1024 || !/^\/[^\s?#]*$/.test(path)) throw new Error("WebSocket 路径必须以 / 开头，且不能包含空格、查询参数或片段");
  return path;
}

function requireGRPCServiceName(value: string): string {
  const serviceName = value.trim().replace(/^\/+/, "");
  if (!serviceName || serviceName.length > 1023 || /[\s?#]/.test(serviceName)) {
    throw new Error("gRPC Service Name 不能为空，且不能包含空格、查询参数或片段");
  }
  return serviceName;
}

function optionalWebSocketHost(value: string): string {
  const host = value.trim();
  if (!host) return "";
  if (host.length > 253 || /[\s/?#]/.test(host) || host.includes("://")) throw new Error("WebSocket Host 只能填写主机名或 IP，不含协议、端口和路径");
  return host;
}

function baseInbound(draft: ManagedInboundDraft, protocol: string, settings: Record<string, unknown>): Record<string, unknown> {
  return {
    tag: requireInboundTag(draft.tag),
    listen: "0.0.0.0",
    port: requirePort(draft.port),
    protocol,
    settings,
    sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], routeOnly: false },
  };
}

function tlsStream(draft: ManagedInboundDraft): Record<string, unknown> {
  const certificateId = Number(draft.certificateId);
  if (!Number.isInteger(certificateId) || certificateId <= 0) throw new Error("请选择一张有效的托管证书");
  const domain = requireDomain(draft.domain);
  return {
    cert_id: certificateId,
    streamSettings: {
      network: "tcp",
      security: "tls",
      tlsSettings: {
        serverName: domain,
        alpn: ["h2", "http/1.1"],
      },
    },
  };
}

function grpcTLSStream(draft: ManagedInboundDraft): Record<string, unknown> {
  const tls = tlsStream(draft);
  const streamSettings = tls.streamSettings as Record<string, unknown>;
  const tlsSettings = streamSettings.tlsSettings as Record<string, unknown>;
  return {
    ...tls,
    streamSettings: {
      ...streamSettings,
      network: "grpc",
      grpcSettings: { serviceName: requireGRPCServiceName(draft.wsPath), multiMode: false },
      tlsSettings: { ...tlsSettings, alpn: ["h2"] },
    },
  };
}

function realityStream(draft: ManagedInboundDraft): Record<string, unknown> {
  const domain = requireRealityTargetDomain(draft.domain);
  const privateKey = draft.privateKey.trim();
  const publicKey = draft.publicKey.trim();
  const shortId = draft.shortId.trim().toLowerCase();
  if (!/^[A-Za-z0-9_-]{43}$/.test(privateKey) || !/^[A-Za-z0-9_-]{43}$/.test(publicKey)) throw new Error("Reality X25519 密钥不完整，请重新生成");
  if (!/^[0-9a-f]{2,16}$/.test(shortId) || shortId.length % 2 !== 0) throw new Error("Reality Short ID 必须是 2 到 16 位偶数长度十六进制");
  return {
    streamSettings: {
      network: "tcp",
      security: "reality",
      realitySettings: {
        show: false,
        target: `${domain}:443`,
        xver: 0,
        serverNames: [domain],
        privateKey,
        shortIds: [shortId],
      },
    },
  };
}

function wssStream(draft: ManagedInboundDraft): Record<string, unknown> {
  const domain = requireDomain(draft.domain);
  const path = requireWebSocketPath(draft.wsPath);
  return {
    listen: "127.0.0.1",
    streamSettings: { network: "ws", security: "none", wsSettings: { path, host: domain } },
  };
}

function wsStream(draft: ManagedInboundDraft): Record<string, unknown> {
  const path = requireWebSocketPath(draft.wsPath);
  const host = optionalWebSocketHost(draft.domain);
  return {
    streamSettings: {
      network: "ws",
      security: "none",
      wsSettings: { path, ...(host ? { host } : {}) },
    },
  };
}

export function managedWireGuardFields(draft: ManagedInboundDraft): WireGuardInboundFields {
  return {
    tag: draft.tag,
    port: draft.port,
    serverPrivateKey: draft.wireGuardServerPrivateKey,
    serverPublicKey: draft.wireGuardServerPublicKey,
    clientPrivateKey: draft.wireGuardClientPrivateKey,
    clientPublicKey: draft.wireGuardClientPublicKey,
    serverAddress: draft.wireGuardServerAddress,
    clientAddress: draft.wireGuardClientAddress,
    dns: draft.wireGuardDNS,
    mtu: draft.wireGuardMTU,
    keepAlive: draft.wireGuardKeepAlive,
  };
}

export function buildManagedWireGuardInbound(draft: ManagedInboundDraft): Record<string, unknown> {
  return buildWireGuardInbound(managedWireGuardFields(draft));
}

export function buildManagedWireGuardClientConfig(draft: ManagedInboundDraft, endpointHost: string): string {
  return buildWireGuardClientConfig(managedWireGuardFields(draft), endpointHost);
}

export function buildManagedWireGuardClientProfile(draft: ManagedInboundDraft): WireGuardClientProfile {
  return buildWireGuardClientProfile(managedWireGuardFields(draft));
}

export function buildManagedInboundRequest(draft: ManagedInboundDraft): ManagedInboundRequest {
  const name = draft.name.trim();
  if (!name) throw new Error("节点名称不能为空");
  let inbound: Record<string, unknown>;
  let forwardNodeID: number | undefined;

  switch (draft.protocol) {
    case "vless-reality": {
      const client: Record<string, unknown> = { id: requireUUID(draft.uuid), email: "admin" };
      if (draft.flow) client.flow = draft.flow;
      inbound = {
        ...baseInbound(draft, "vless", { clients: [client], decryption: "none" }),
        ...realityStream(draft),
      };
      break;
    }
    case "vless-tls": {
      const client: Record<string, unknown> = { id: requireUUID(draft.uuid), email: "admin" };
      if (draft.flow) client.flow = draft.flow;
      inbound = {
        ...baseInbound(draft, "vless", { clients: [client], decryption: "none" }),
        ...tlsStream(draft),
      };
      break;
    }
    case "vless-grpc-tls":
      inbound = {
        ...baseInbound(draft, "vless", { clients: [{ id: requireUUID(draft.uuid), email: "admin" }], decryption: "none" }),
        ...grpcTLSStream(draft),
      };
      break;
    case "vless-ws":
      inbound = {
        ...baseInbound(draft, "vless", { clients: [{ id: requireUUID(draft.uuid), email: "admin" }], decryption: "none" }),
        ...wsStream(draft),
      };
      break;
    case "vless-wss":
      inbound = {
        ...baseInbound(draft, "vless", { clients: [{ id: requireUUID(draft.uuid), email: "admin" }], decryption: "none" }),
        ...wssStream(draft),
      };
      break;
    case "vmess":
      inbound = {
        ...baseInbound(draft, "vmess", { clients: [{ id: requireUUID(draft.uuid), email: "admin", security: draft.vmessCipher, level: 0 }] }),
        streamSettings: { network: "tcp", security: "none" },
      };
      break;
    case "vmess-tls":
      inbound = {
        ...baseInbound(draft, "vmess", { clients: [{ id: requireUUID(draft.uuid), email: "admin", security: draft.vmessCipher, level: 0 }] }),
        ...tlsStream(draft),
      };
      break;
    case "vmess-grpc-tls":
      inbound = {
        ...baseInbound(draft, "vmess", { clients: [{ id: requireUUID(draft.uuid), email: "admin", security: draft.vmessCipher, level: 0 }] }),
        ...grpcTLSStream(draft),
      };
      break;
    case "vmess-ws":
      inbound = {
        ...baseInbound(draft, "vmess", { clients: [{ id: requireUUID(draft.uuid), email: "admin", security: draft.vmessCipher, level: 0 }] }),
        ...wsStream(draft),
      };
      break;
    case "vmess-wss":
      inbound = {
        ...baseInbound(draft, "vmess", { clients: [{ id: requireUUID(draft.uuid), email: "admin", security: draft.vmessCipher, level: 0 }] }),
        ...wssStream(draft),
      };
      break;
    case "trojan":
      inbound = {
        ...baseInbound(draft, "trojan", { clients: [{ password: requirePassword(draft.password), email: "admin", level: 0 }] }),
        ...tlsStream(draft),
      };
      break;
    case "trojan-reality":
      inbound = {
        ...baseInbound(draft, "trojan", { clients: [{ password: requirePassword(draft.password), email: "admin", level: 0 }] }),
        ...realityStream(draft),
      };
      break;
    case "trojan-grpc-tls":
      inbound = {
        ...baseInbound(draft, "trojan", { clients: [{ password: requirePassword(draft.password), email: "admin", level: 0 }] }),
        ...grpcTLSStream(draft),
      };
      break;
    case "trojan-wss":
      inbound = {
        ...baseInbound(draft, "trojan", { clients: [{ password: requirePassword(draft.password), email: "admin", level: 0 }] }),
        ...wssStream(draft),
      };
      break;
    case "shadowsocks": {
      if (!isShadowsocks2022Cipher(draft.ssCipher)) {
        if (isShadowsocksClassicMultiUserCipher(draft.ssCipher)) {
          inbound = baseInbound(draft, "shadowsocks", {
            clients: [{
              method: draft.ssCipher,
              password: requirePassword(draft.password),
              email: "admin",
              level: 0,
            }],
            network: "tcp,udp",
          });
          break;
        }
        inbound = baseInbound(draft, "shadowsocks", {
          method: draft.ssCipher,
          password: requirePassword(draft.password),
          email: "admin",
          network: "tcp,udp",
        });
        break;
      }
      const keyLength = draft.ssCipher === "2022-blake3-aes-128-gcm" ? 16 : 32;
      let decodedLength = 0;
      let userDecodedLength = 0;
      try { decodedLength = globalThis.atob(draft.password.trim()).length; } catch { /* Validation below provides one error. */ }
      try { userDecodedLength = globalThis.atob(draft.ssUserPassword.trim()).length; } catch { /* Validation below provides one error. */ }
      if (decodedLength !== keyLength) throw new Error(`该加密方式的服务端密钥必须是 ${keyLength} 字节 Base64`);
      if (userDecodedLength !== keyLength) throw new Error(`该加密方式的初始用户密钥必须是 ${keyLength} 字节 Base64`);
      inbound = baseInbound(draft, "shadowsocks", {
        method: draft.ssCipher,
        password: draft.password.trim(),
        network: "tcp,udp",
        clients: [{ password: draft.ssUserPassword.trim(), email: "admin", level: 0 }],
      });
      break;
    }
    case "hysteria2": {
      const tls = tlsStream(draft);
      const streamSettings = tls.streamSettings as Record<string, unknown>;
      streamSettings.network = "hysteria";
      (streamSettings.tlsSettings as Record<string, unknown>).alpn = ["h3"];
      streamSettings.hysteriaSettings = { version: 2 };
      inbound = {
        ...baseInbound(draft, "hysteria", { version: 2, clients: [{ auth: requirePassword(draft.password), email: "admin", level: 0 }] }),
        ...tls,
        streamSettings,
      };
      break;
    }
    case "socks5":
      inbound = baseInbound(draft, "socks", {
        auth: "password",
        accounts: [{ user: requirePassword(draft.accountUsername), pass: requirePassword(draft.password) }],
        udp: true,
      });
      break;
    case "http":
      inbound = baseInbound(draft, "http", {
        accounts: [{ user: requirePassword(draft.accountUsername), pass: requirePassword(draft.password) }],
        allowTransparent: false,
      });
      break;
    case "wireguard":
      throw new Error("WireGuard 必须通过包含加密客户端凭据的专用创建流程");
    case "anydoor":
      forwardNodeID = Number(draft.forwardNodeId);
      if (!Number.isInteger(forwardNodeID) || forwardNodeID <= 0) throw new Error("请选择要转发的目标节点");
      inbound = {
        tag: requireInboundTag(draft.tag),
        listen: "0.0.0.0",
        port: requirePort(draft.port),
        protocol: "tunnel",
        settings: {
          address: requireForwardTargetAddress(draft.targetAddress),
          port: requireTargetPort(draft.targetPort),
          network: "tcp,udp",
        },
      };
      break;
  }

  return {
    action: "add",
    node_name: name,
    ip_version: draft.ipVersion,
    ...(forwardNodeID ? { forward_node_id: forwardNodeID } : {}),
    ...(draft.skipCertVerify ? { client_options: { skip_cert_verify: true } } : {}),
    inbound,
  };
}
