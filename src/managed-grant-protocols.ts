export type ManagedGrantProtocol =
  | "vless"
  | "vmess"
  | "trojan"
  | "shadowsocks"
  | "hysteria"
  | "socks"
  | "http"
  | "anytls"
  | "snell";

export type ManagedGrantProtocolProfile =
  | "vless-reality"
  | "vless-tcp-tls"
  | "vless-grpc-tls"
  | "vless-wss"
  | "vless-ws"
  | "vmess-tcp-none"
  | "vmess-tcp-tls"
  | "vmess-grpc-tls"
  | "vmess-wss"
  | "vmess-ws"
  | "trojan-tcp-tls"
  | "trojan-reality"
  | "trojan-grpc-tls"
  | "trojan-wss"
  | "shadowsocks-2022"
  | "hysteria2"
  | "socks5"
  | "http"
  | "anytls"
  | "snell";

export interface ManagedGrantProtocolProfileOption {
  value: ManagedGrantProtocolProfile;
  family: ManagedGrantProtocol;
  label: string;
  detail: string;
}

export interface ManagedGrantProtocolGroup {
  value: ManagedGrantProtocol;
  label: string;
  profiles: ManagedGrantProtocolProfileOption[];
}

export const managedGrantProtocolGroups: ManagedGrantProtocolGroup[] = [
  {
    value: "vless",
    label: "VLESS",
    profiles: [
      { value: "vless-reality", family: "vless", label: "Reality", detail: "TCP · Reality" },
      { value: "vless-tcp-tls", family: "vless", label: "TCP TLS", detail: "TCP · TLS 证书" },
      { value: "vless-grpc-tls", family: "vless", label: "gRPC TLS", detail: "gRPC · TLS 证书" },
      { value: "vless-wss", family: "vless", label: "WSS", detail: "WebSocket · TLS" },
      { value: "vless-ws", family: "vless", label: "WS", detail: "WebSocket · 无 TLS" },
    ],
  },
  {
    value: "vmess",
    label: "VMess",
    profiles: [
      { value: "vmess-tcp-none", family: "vmess", label: "TCP", detail: "TCP · 无 TLS" },
      { value: "vmess-tcp-tls", family: "vmess", label: "TCP TLS", detail: "TCP · TLS 证书" },
      { value: "vmess-grpc-tls", family: "vmess", label: "gRPC TLS", detail: "gRPC · TLS 证书" },
      { value: "vmess-wss", family: "vmess", label: "WSS", detail: "WebSocket · TLS" },
      { value: "vmess-ws", family: "vmess", label: "WS", detail: "WebSocket · 无 TLS" },
    ],
  },
  {
    value: "trojan",
    label: "Trojan",
    profiles: [
      { value: "trojan-tcp-tls", family: "trojan", label: "TCP TLS", detail: "TCP · TLS 证书" },
      { value: "trojan-reality", family: "trojan", label: "Reality", detail: "TCP · Reality" },
      { value: "trojan-grpc-tls", family: "trojan", label: "gRPC TLS", detail: "gRPC · TLS 证书" },
      { value: "trojan-wss", family: "trojan", label: "WSS", detail: "WebSocket · TLS" },
    ],
  },
  {
    value: "shadowsocks",
    label: "Shadowsocks",
    profiles: [
      { value: "shadowsocks-2022", family: "shadowsocks", label: "Shadowsocks 2022", detail: "BLAKE3 AES-128/256-GCM · 多用户" },
    ],
  },
  {
    value: "hysteria",
    label: "Hysteria2",
    profiles: [{ value: "hysteria2", family: "hysteria", label: "Hysteria2", detail: "UDP · TLS" }],
  },
  {
    value: "socks",
    label: "SOCKS5",
    profiles: [{ value: "socks5", family: "socks", label: "SOCKS5", detail: "TCP + UDP · 用户名密码" }],
  },
  {
    value: "http",
    label: "HTTP",
    profiles: [{ value: "http", family: "http", label: "HTTP Proxy", detail: "TCP · 用户名密码" }],
  },
  {
    value: "anytls",
    label: "AnyTLS",
    profiles: [{ value: "anytls", family: "anytls", label: "AnyTLS", detail: "TCP · TLS" }],
  },
  {
    value: "snell",
    label: "Snell",
    profiles: [{ value: "snell", family: "snell", label: "Snell", detail: "TCP" }],
  },
];

export const managedGrantProtocolOptions = managedGrantProtocolGroups.map(({ value, label }) => ({ value, label }));
export const managedGrantProtocolProfiles = managedGrantProtocolGroups.flatMap((group) => group.profiles);

export function managedGrantProtocolLabel(protocol: string): string {
  return managedGrantProtocolOptions.find((option) => option.value === protocol)?.label ?? protocol.toUpperCase();
}

export function managedGrantProtocolProfileLabel(profile: string): string {
  return managedGrantProtocolProfiles.find((option) => option.value === profile)?.label ?? profile;
}

export function profilesForFamilies(families: ManagedGrantProtocol[]): ManagedGrantProtocolProfile[] {
  const allowedFamilies = new Set(families);
  return managedGrantProtocolProfiles
    .filter((profile) => allowedFamilies.has(profile.family))
    .map((profile) => profile.value);
}

export function familiesForProfiles(profiles: ManagedGrantProtocolProfile[]): ManagedGrantProtocol[] {
  const selectedProfiles = new Set(profiles);
  return managedGrantProtocolGroups
    .filter((group) => group.profiles.some((profile) => selectedProfiles.has(profile.value)))
    .map((group) => group.value);
}
