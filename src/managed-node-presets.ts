export type ManagedProtocol = "vless-reality" | "vless-ws" | "vmess" | "trojan" | "shadowsocks" | "hysteria2" | "socks5" | "http";

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
  vmessCipher: "auto" | "aes-128-gcm" | "chacha20-poly1305" | "none";
  ssCipher: "2022-blake3-aes-128-gcm" | "2022-blake3-aes-256-gcm";
  certificateId: string;
  skipCertVerify: boolean;
  hysteriaObfsPassword: string;
  accountUsername: string;
  publish: boolean;
  sortOrder: string;
}

export interface ManagedInboundRequest {
  action: "add";
  node_name: string;
  ip_version: "v4" | "v6" | "both";
  inbound: Record<string, unknown>;
}

export const managedProtocolOptions: Array<{
  value: ManagedProtocol;
  label: string;
  detail: string;
  requiresCertificate?: boolean;
}> = [
  { value: "vless-reality", label: "VLESS Reality", detail: "TCP · Reality · 可选 Vision 流控" },
  { value: "vless-ws", label: "VLESS WSS", detail: "WebSocket · Nginx TLS · 443" },
  { value: "shadowsocks", label: "Shadowsocks 2022", detail: "多用户隔离 · AES-GCM" },
  { value: "vmess", label: "VMess", detail: "TCP · 可选客户端加密" },
  { value: "trojan", label: "Trojan TLS", detail: "TCP · 托管证书", requiresCertificate: true },
  { value: "hysteria2", label: "Hysteria2", detail: "UDP · TLS · 可选 Salamander", requiresCertificate: true },
  { value: "socks5", label: "SOCKS5", detail: "TCP + UDP · 用户名密码" },
  { value: "http", label: "HTTP Proxy", detail: "TCP · 用户名密码" },
];

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
    hysteriaObfsPassword: "",
    accountUsername: "admin",
    publish: false,
    sortOrder: "0",
  };
}

export function protocolDefaults(protocol: ManagedProtocol): Partial<ManagedInboundDraft> {
  const base = { protocol, port: "443" } as const;
  switch (protocol) {
    case "vless-reality": return { ...base, tag: "vless-reality", flow: "xtls-rprx-vision" };
    case "vless-ws": return { ...base, tag: "vless-wss", flow: "" };
    case "vmess": return { ...base, tag: "vmess-tcp", flow: "" };
    case "trojan": return { ...base, tag: "trojan-tls", flow: "" };
    case "shadowsocks": return { ...base, tag: "ss2022", flow: "" };
    case "hysteria2": return { ...base, tag: "hysteria2", flow: "" };
    case "socks5": return { ...base, tag: "socks5", flow: "" };
    case "http": return { ...base, tag: "http-proxy", flow: "" };
  }
}

function requirePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("监听端口必须在 1 到 65535 之间");
  return port;
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

function baseInbound(draft: ManagedInboundDraft, protocol: string, settings: Record<string, unknown>): Record<string, unknown> {
  const tag = draft.tag.trim();
  if (!tag) throw new Error("入站 Tag 不能为空");
  return {
    tag,
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
        allowInsecure: draft.skipCertVerify,
      },
    },
  };
}

export function buildManagedInboundRequest(draft: ManagedInboundDraft): ManagedInboundRequest {
  const name = draft.name.trim();
  if (!name) throw new Error("节点名称不能为空");
  let inbound: Record<string, unknown>;

  switch (draft.protocol) {
    case "vless-reality": {
      const domain = requireDomain(draft.domain);
      const privateKey = draft.privateKey.trim();
      const publicKey = draft.publicKey.trim();
      const shortId = draft.shortId.trim().toLowerCase();
      if (!/^[A-Za-z0-9_-]{43}$/.test(privateKey) || !/^[A-Za-z0-9_-]{43}$/.test(publicKey)) throw new Error("Reality X25519 密钥不完整，请重新生成");
      if (!/^[0-9a-f]{2,16}$/.test(shortId) || shortId.length % 2 !== 0) throw new Error("Reality Short ID 必须是 2 到 16 位偶数长度十六进制");
      const client: Record<string, unknown> = { id: requireUUID(draft.uuid), email: "admin" };
      if (draft.flow) client.flow = draft.flow;
      inbound = {
        ...baseInbound(draft, "vless", { clients: [client], decryption: "none" }),
        streamSettings: {
          network: "tcp",
          security: "reality",
          realitySettings: {
            show: false,
            dest: `${domain}:443`,
            xver: 0,
            serverNames: [domain],
            privateKey,
            publicKey,
            shortIds: [shortId],
          },
        },
      };
      break;
    }
    case "vless-ws": {
      const domain = requireDomain(draft.domain);
      const path = draft.wsPath.trim();
      if (path.length < 2 || path.length > 1024 || !/^\/[^\s?#]*$/.test(path)) throw new Error("WebSocket 路径必须以 / 开头，且不能包含空格、查询参数或片段");
      inbound = {
        ...baseInbound(draft, "vless", { clients: [{ id: requireUUID(draft.uuid), email: "admin" }], decryption: "none" }),
        listen: "127.0.0.1",
        streamSettings: { network: "ws", security: "none", wsSettings: { path, headers: { Host: domain } } },
      };
      break;
    }
    case "vmess":
      inbound = {
        ...baseInbound(draft, "vmess", { clients: [{ id: requireUUID(draft.uuid), email: "admin", security: draft.vmessCipher, level: 0 }] }),
        streamSettings: { network: "tcp", security: "none" },
      };
      break;
    case "trojan":
      inbound = {
        ...baseInbound(draft, "trojan", { clients: [{ password: requirePassword(draft.password), email: "admin", level: 0 }] }),
        ...tlsStream(draft),
      };
      break;
    case "shadowsocks": {
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
      streamSettings.hysteriaSettings = {
        version: 2,
        ...(draft.hysteriaObfsPassword.trim() ? { password: draft.hysteriaObfsPassword.trim() } : {}),
      };
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
  }

  return { action: "add", node_name: name, ip_version: draft.ipVersion, inbound };
}
