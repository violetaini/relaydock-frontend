import * as yaml from "js-yaml";

const PRIORITY_KEYS = [
  "name",
  "type",
  "server",
  "port",
  "uuid",
  "alterId",
  "cipher",
  "password",
  "psk",
  "udp",
  "tls",
  "flow",
  "servername",
  "sni",
  "skip-cert-verify",
  "alpn",
  "client-fingerprint",
  "fingerprint",
  "network",
  "reality-opts",
  "ws-opts",
  "grpc-opts",
  "h2-opts",
  "http-opts",
  "plugin",
  "plugin-opts",
] as const;

const STRING_FIELDS = new Set([
  "name",
  "type",
  "server",
  "uuid",
  "cipher",
  "password",
  "psk",
  "flow",
  "servername",
  "sni",
  "client-fingerprint",
  "fingerprint",
  "network",
  "plugin",
]);

const OMIT_TCP_NETWORK_TYPES = new Set([
  "",
  "vmess",
  "vless",
  "trojan",
  "ss",
  "ssr",
  "anytls",
  "snell",
]);

const INTERNAL_KEYS = new Set(["x-arcway-managed-users"]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeClashProxyObject(raw: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  const proxyType = String(raw.type ?? "").trim().toLowerCase();

  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || INTERNAL_KEYS.has(key)) {
      continue;
    }
    if (
      key === "network" &&
      typeof value === "string" &&
      value.trim().toLowerCase() === "tcp" &&
      OMIT_TCP_NETWORK_TYPES.has(proxyType)
    ) {
      continue;
    }

    if (STRING_FIELDS.has(key) && (typeof value === "number" || typeof value === "boolean")) {
      cleaned[key] = String(value);
      continue;
    }

    if ((key === "port" || key === "alterId") && typeof value === "string" && value.trim() !== "") {
      const num = Number(value);
      if (Number.isFinite(num)) {
        cleaned[key] = num;
        continue;
      }
    }

    if (key === "reality-opts" && isPlainRecord(value)) {
      const realityOpts: Record<string, unknown> = { ...value };
      if (realityOpts["public-key"] !== undefined && realityOpts["public-key"] !== null) {
        realityOpts["public-key"] = String(realityOpts["public-key"]);
      }
      if (realityOpts["short-id"] !== undefined && realityOpts["short-id"] !== null) {
        realityOpts["short-id"] = String(realityOpts["short-id"]);
      }
      cleaned[key] = realityOpts;
      continue;
    }

    cleaned[key] = value;
  }

  const ordered: Record<string, unknown> = {};
  for (const key of PRIORITY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(cleaned, key)) {
      ordered[key] = cleaned[key];
    }
  }
  for (const key of Object.keys(cleaned).sort()) {
    if (!Object.prototype.hasOwnProperty.call(ordered, key)) {
      ordered[key] = cleaned[key];
    }
  }
  return ordered;
}

export function parseClashProxyInput(rawText: string): Record<string, unknown> {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("Clash 配置不能为空");
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(trimmed, { schema: yaml.CORE_SCHEMA });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Clash 配置解析失败：${detail}`);
  }

  let candidate: unknown = parsed;
  if (isPlainRecord(parsed) && Array.isArray(parsed.proxies)) {
    if (parsed.proxies.length === 0) {
      throw new Error("proxies 列表不能为空");
    }
    candidate = parsed.proxies[0];
  } else if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      throw new Error("节点配置列表不能为空");
    }
    candidate = parsed[0];
  }

  if (!isPlainRecord(candidate)) {
    throw new Error("Clash 配置必须是有效的节点对象或 proxies 列表");
  }

  return normalizeClashProxyObject(candidate);
}

function coerceToProxyRecord(input: unknown): Record<string, unknown> {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) {
      return {};
    }
    try {
      return parseClashProxyInput(trimmed);
    } catch {
      return {};
    }
  }
  if (isPlainRecord(input)) {
    return normalizeClashProxyObject(input);
  }
  return {};
}

export function formatProxyToClashYAML(input: unknown): string {
  const proxy = coerceToProxyRecord(input);
  if (Object.keys(proxy).length === 0) {
    return "proxies: []\n";
  }
  return yaml.dump(
    { proxies: [proxy] },
    {
      schema: yaml.CORE_SCHEMA,
      indent: 2,
      lineWidth: -1,
      noRefs: true,
    },
  );
}

export function formatProxyToClashJSON(input: unknown): string {
  const proxy = coerceToProxyRecord(input);
  return JSON.stringify(proxy, null, 2);
}
