export type TrojanCombination = "tcp-tls" | "ws-tls" | "grpc-tls" | "tcp-reality";

export interface TrojanInboundFields {
  tag: string;
  port: string;
  password: string;
  domain: string;
  combination: TrojanCombination;
  certificateId?: string;
  path?: string;
  serviceName?: string;
  privateKey?: string;
  publicKey?: string;
  shortId?: string;
}

export interface WireGuardInboundFields {
  tag: string;
  port: string;
  serverPrivateKey: string;
  serverPublicKey: string;
  clientPrivateKey: string;
  clientPublicKey: string;
  serverAddress: string;
  clientAddress: string;
  dns: string;
  mtu: string;
  keepAlive: string;
}

export interface WireGuardKeyPair {
  privateKey: string;
  publicKey: string;
}

type XrayResource = Record<string, unknown>;

function requireTag(value: string): string {
  const tag = value.trim();
  if (!tag) throw new Error("Tag 不能为空");
  return tag;
}

function requirePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("监听端口必须在 1 到 65535 之间");
  return port;
}

function requireDomain(value: string): string {
  const domain = value.trim().toLowerCase();
  if (domain.length < 3 || domain.length > 253 || !domain.includes(".") || domain.includes("..")) {
    throw new Error("域名必须是不含协议、端口和路径的有效主机名");
  }
  if (!domain.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
    throw new Error("域名必须是不含协议、端口和路径的有效主机名");
  }
  return domain;
}

function requirePath(value: string): string {
  const path = value.trim();
  if (path.length < 2 || path.length > 1024 || !/^\/[^\s?#]*$/.test(path)) {
    throw new Error("路径必须以 / 开头，且不能包含空格、查询参数或片段");
  }
  return path;
}

function requireTrojanPassword(value: string): string {
  const password = value.trim();
  if (password.length < 8 || password.length > 128) throw new Error("Trojan 密码应为 8 到 128 个字符");
  return password;
}

function requireRealityKey(value: string): string {
  const key = value.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error("Reality X25519 密钥不完整，请重新生成");
  return key;
}

function requireShortId(value: string): string {
  const shortId = value.trim().toLowerCase();
  if (!/^[0-9a-f]{2,16}$/.test(shortId) || shortId.length % 2 !== 0) {
    throw new Error("Reality Short ID 必须是 2 到 16 位偶数长度十六进制");
  }
  return shortId;
}

function requireCertificateId(value: string | undefined): number {
  const certificateId = Number(value);
  if (!Number.isInteger(certificateId) || certificateId <= 0) throw new Error("请选择一张可用于当前服务器的托管证书");
  return certificateId;
}

export function buildTrojanInbound(fields: TrojanInboundFields): XrayResource {
  const tag = requireTag(fields.tag);
  const port = requirePort(fields.port);
  const password = requireTrojanPassword(fields.password);
  const domain = requireDomain(fields.domain);
  const base: XrayResource = {
    tag,
    listen: fields.combination === "ws-tls" ? "127.0.0.1" : "0.0.0.0",
    port,
    protocol: "trojan",
    settings: { clients: [{ password }], fallbacks: [] },
    sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], routeOnly: false },
  };

  if (fields.combination === "tcp-reality") {
    const privateKey = requireRealityKey(fields.privateKey ?? "");
    requireRealityKey(fields.publicKey ?? "");
    const shortId = requireShortId(fields.shortId ?? "");
    return {
      ...base,
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

  if (fields.combination === "ws-tls") {
    return {
      ...base,
      streamSettings: {
        network: "ws",
        security: "none",
        wsSettings: { path: requirePath(fields.path ?? ""), host: domain },
      },
    };
  }

  const certificateId = requireCertificateId(fields.certificateId);
  const networkSettings = fields.combination === "grpc-tls"
    ? {
        network: "grpc",
        grpcSettings: {
          serviceName: requirePath(`/${(fields.serviceName ?? "").replace(/^\/+/, "")}`).slice(1),
          multiMode: false,
        },
      }
    : { network: "tcp" };
  return {
    ...base,
    cert_id: certificateId,
    streamSettings: {
      ...networkSettings,
      security: "tls",
      tlsSettings: {
        serverName: domain,
        minVersion: "1.2",
        alpn: fields.combination === "grpc-tls" ? ["h2"] : ["h2", "http/1.1"],
      },
    },
  };
}

export function x25519ToWireGuardKey(value: string): string {
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]{43}$/.test(normalized)) throw new Error("WireGuard 密钥格式无效");
  return `${normalized}=`;
}

const x25519PKCS8Prefix = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20];

function wireGuardKeyFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== 32) throw new Error("WireGuard 密钥长度无效");
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return globalThis.btoa(binary);
}

// Keeps the client private key in the browser. WebCrypto exposes X25519 private
// material as PKCS#8, whose RFC 8410 wrapper contains one raw 32-byte scalar.
export async function generateWireGuardKeyPair(): Promise<WireGuardKeyPair> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("当前浏览器不支持本地 WireGuard 密钥生成，请使用最新版 Chrome、Edge 或 Firefox");

  let pair: CryptoKeyPair;
  try {
    pair = await subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]) as CryptoKeyPair;
  } catch {
    throw new Error("当前浏览器不支持本地 WireGuard 密钥生成，请使用最新版 Chrome、Edge 或 Firefox");
  }

  try {
    const [publicRaw, privatePKCS8] = await Promise.all([
      subtle.exportKey("raw", pair.publicKey),
      subtle.exportKey("pkcs8", pair.privateKey),
    ]);
    const privateBytes = new Uint8Array(privatePKCS8);
    const validWrapper = privateBytes.length === x25519PKCS8Prefix.length + 32
      && x25519PKCS8Prefix.every((value, index) => privateBytes[index] === value);
    if (!validWrapper) throw new Error("浏览器返回了不兼容的 X25519 私钥格式");
    return {
      privateKey: wireGuardKeyFromBytes(privateBytes.slice(x25519PKCS8Prefix.length)),
      publicKey: wireGuardKeyFromBytes(new Uint8Array(publicRaw)),
    };
  } catch (reason) {
    if (reason instanceof Error && reason.message.includes("不兼容")) throw reason;
    throw new Error("浏览器无法导出 WireGuard 密钥，请使用最新版 Chrome、Edge 或 Firefox");
  }
}

function requireWireGuardKey(value: string): string {
  const key = value.trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key)) throw new Error("WireGuard 密钥尚未生成或格式无效");
  return key;
}

function requireIPv4HostCIDR(value: string, label: string): string {
  const cidr = value.trim();
  const match = cidr.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/32$/);
  if (!match || match[1].split(".").some((part) => Number(part) > 255)) {
    throw new Error(`${label}必须是有效的 IPv4 /32 地址，例如 10.66.66.2/32`);
  }
  return cidr;
}

function optionalPositiveInteger(value: string, fallback: number, label: string, maximum: number): number {
  if (!value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maximum) throw new Error(`${label}格式无效`);
  return parsed;
}

export function buildWireGuardInbound(fields: WireGuardInboundFields): XrayResource {
  const serverPrivateKey = requireWireGuardKey(fields.serverPrivateKey);
  requireWireGuardKey(fields.serverPublicKey);
  requireWireGuardKey(fields.clientPrivateKey);
  const clientPublicKey = requireWireGuardKey(fields.clientPublicKey);
  const serverAddress = requireIPv4HostCIDR(fields.serverAddress, "服务端隧道地址");
  const clientAddress = requireIPv4HostCIDR(fields.clientAddress, "客户端隧道地址");
  if (serverAddress === clientAddress) throw new Error("服务端与客户端隧道地址不能相同");
  const mtu = optionalPositiveInteger(fields.mtu, 1420, "MTU", 9000);
  if (mtu < 576) throw new Error("MTU 必须在 576 到 9000 之间");
  const keepAlive = optionalPositiveInteger(fields.keepAlive, 25, "Keepalive", 65535);

  return {
    tag: requireTag(fields.tag),
    listen: "0.0.0.0",
    port: requirePort(fields.port),
    protocol: "wireguard",
    settings: {
      secretKey: serverPrivateKey,
      address: [serverAddress],
      mtu,
      noKernelTun: false,
      peers: [{
        publicKey: clientPublicKey,
        allowedIPs: [clientAddress],
        ...(keepAlive > 0 ? { keepAlive } : {}),
      }],
    },
    sniffing: { enabled: false },
  };
}

export function buildWireGuardClientConfig(fields: WireGuardInboundFields, endpointHost: string): string {
  const host = endpointHost.trim();
  if (!host) throw new Error("服务器尚未上报可连接的域名或 IP");
  const endpoint = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const clientPrivateKey = requireWireGuardKey(fields.clientPrivateKey);
  const serverPublicKey = requireWireGuardKey(fields.serverPublicKey);
  const clientAddress = requireIPv4HostCIDR(fields.clientAddress, "客户端隧道地址");
  const port = requirePort(fields.port);
  const mtu = optionalPositiveInteger(fields.mtu, 1420, "MTU", 9000);
  const keepAlive = optionalPositiveInteger(fields.keepAlive, 25, "Keepalive", 65535);
  const dns = fields.dns.split(",").map((item) => item.trim()).filter(Boolean).join(", ") || "1.1.1.1, 1.0.0.1";
  return [
    "[Interface]",
    `PrivateKey = ${clientPrivateKey}`,
    `Address = ${clientAddress}`,
    `DNS = ${dns}`,
    `MTU = ${mtu}`,
    "",
    "[Peer]",
    `PublicKey = ${serverPublicKey}`,
    "AllowedIPs = 0.0.0.0/0",
    `Endpoint = ${endpoint}:${port}`,
    ...(keepAlive > 0 ? [`PersistentKeepalive = ${keepAlive}`] : []),
    "",
  ].join("\n");
}
