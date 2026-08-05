export type XrayConfigObject = Record<string, unknown>;

export type XrayBasicRuleKind =
  | "blockedIPs"
  | "blockedDomains"
  | "directIPs"
  | "directDomains"
  | "ipv4Domains"
  | "warpDomains"
  | "warpIPv4Domains"
  | "warpIPv6Domains";

export interface XrayPresetOption {
  label: string;
  value: string;
}

export interface XrayBasicSettings {
  freedomStrategy: string;
  routingStrategy: string;
  statsInboundUplink: boolean;
  statsInboundDownlink: boolean;
  statsOutboundUplink: boolean;
  statsOutboundDownlink: boolean;
  logLevel: string;
  accessLog: string;
  errorLog: string;
  maskAddress: string;
  dnsLog: boolean;
  torrentBlocked: boolean;
  blockedIPs: string[];
  blockedDomains: string[];
  directIPs: string[];
  directDomains: string[];
  ipv4Domains: string[];
  warpDomains: string[];
  warpIPv4Domains: string[];
  warpIPv6Domains: string[];
  warpAvailable: boolean;
  warpIPv4Available: boolean;
  warpIPv6Available: boolean;
  blockOutboundTag: string;
}

export const freedomDomainStrategies = [
  "AsIs",
  "UseIP",
  "UseIPv4",
  "UseIPv6",
  "UseIPv6v4",
  "UseIPv4v6",
  "ForceIP",
  "ForceIPv6v4",
  "ForceIPv6",
  "ForceIPv4v6",
  "ForceIPv4",
] as const;

export const routingDomainStrategies = ["AsIs", "IPIfNonMatch", "IPOnDemand"] as const;

export const xrayIPPresets: XrayPresetOption[] = [
  { label: "私有网络", value: "geoip:private" },
  { label: "中国", value: "geoip:cn" },
  { label: "伊朗", value: "geoip:ir" },
  { label: "俄罗斯", value: "geoip:ru" },
  { label: "越南", value: "geoip:vn" },
  { label: "西班牙", value: "geoip:es" },
  { label: "印度尼西亚", value: "geoip:id" },
  { label: "乌克兰", value: "geoip:ua" },
  { label: "土耳其", value: "geoip:tr" },
  { label: "巴西", value: "geoip:br" },
];

export const xrayBlockedDomainPresets: XrayPresetOption[] = [
  { label: "全部广告", value: "geosite:category-ads-all" },
  { label: "成人内容", value: "geosite:category-porn" },
];

export const xrayDirectDomainPresets: XrayPresetOption[] = [
  { label: "中国站点", value: "geosite:cn" },
  { label: "Apple 中国", value: "geosite:apple-cn" },
  { label: "私有域名", value: "geosite:private" },
];

export const xrayServicePresets: XrayPresetOption[] = [
  { label: "Apple", value: "geosite:apple" },
  { label: "Meta", value: "geosite:meta" },
  { label: "Google", value: "geosite:google" },
  { label: "OpenAI", value: "geosite:openai" },
  { label: "Spotify", value: "geosite:spotify" },
  { label: "Netflix", value: "geosite:netflix" },
  { label: "Reddit", value: "geosite:reddit" },
  { label: "Speedtest", value: "geosite:speedtest" },
];

function isObject(value: unknown): value is XrayConfigObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function objectSection(parent: XrayConfigObject, key: string): XrayConfigObject {
  const current = parent[key];
  if (isObject(current)) return current;
  const next: XrayConfigObject = {};
  parent[key] = next;
  return next;
}

function objectArray(parent: XrayConfigObject, key: string): XrayConfigObject[] {
  const current = parent[key];
  if (Array.isArray(current)) return current.filter(isObject);
  const next: XrayConfigObject[] = [];
  parent[key] = next;
  return next;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizedValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function outbounds(config: XrayConfigObject): XrayConfigObject[] {
  return objectArray(config, "outbounds");
}

function routingRules(config: XrayConfigObject): XrayConfigObject[] {
  return objectArray(objectSection(config, "routing"), "rules");
}

function outboundTag(outbound: XrayConfigObject): string {
  return typeof outbound.tag === "string" ? outbound.tag : "";
}

function blockTag(config: XrayConfigObject): string {
  const items = outbounds(config);
  const exact = items.find((item) => item.protocol === "blackhole" && ["blocked", "block"].includes(outboundTag(item)));
  const anyBlackhole = items.find((item) => item.protocol === "blackhole" && outboundTag(item));
  if (exact) return outboundTag(exact);
  if (anyBlackhole) return outboundTag(anyBlackhole);
  const referenced = routingRules(config).find((rule) => ["blocked", "block"].includes(String(rule.outboundTag || "")));
  return referenced ? String(referenced.outboundTag) : "blocked";
}

function ensureOutbound(config: XrayConfigObject, tag: string, protocol: string, settings: XrayConfigObject): XrayConfigObject {
  const items = outbounds(config);
  const existing = items.find((item) => outboundTag(item) === tag);
  if (existing) return existing;
  const next = { tag, protocol, settings };
  items.push(next);
  config.outbounds = items;
  return next;
}

function ensureDirectOutbound(config: XrayConfigObject): XrayConfigObject {
  const items = outbounds(config);
  const existing = items.find((item) => outboundTag(item) === "direct" && item.protocol === "freedom");
  return existing ?? ensureOutbound(config, "direct", "freedom", {});
}

function ensureBlockOutbound(config: XrayConfigObject): string {
  const tag = blockTag(config);
  ensureOutbound(config, tag, "blackhole", {});
  return tag;
}

function ensureIPv4Outbound(config: XrayConfigObject): void {
  ensureOutbound(config, "IPv4", "freedom", { domainStrategy: "UseIPv4" });
}

function isSimpleRule(rule: XrayConfigObject, tag: string, field: "ip" | "domain" | "protocol"): boolean {
  if (rule.type !== undefined && rule.type !== "field") return false;
  if (rule.outboundTag !== tag || !Object.prototype.hasOwnProperty.call(rule, field)) return false;
  const allowed = new Set(["type", "outboundTag", field]);
  return Object.keys(rule).every((key) => allowed.has(key));
}

function readRuleValues(config: XrayConfigObject, tag: string, field: "ip" | "domain" | "protocol"): string[] {
  const values = routingRules(config)
    .filter((rule) => isSimpleRule(rule, tag, field))
    .flatMap((rule) => stringArray(rule[field]));
  return [...new Set(values)];
}

function writeRuleValues(config: XrayConfigObject, tag: string, field: "ip" | "domain" | "protocol", values: string[]): void {
  const nextValues = normalizedValues(values);
  const rules = routingRules(config);
  const matchingIndexes = rules.flatMap((rule, index) => isSimpleRule(rule, tag, field) ? [index] : []);
  if (nextValues.length === 0) {
    objectSection(config, "routing").rules = rules.filter((_, index) => !matchingIndexes.includes(index));
    return;
  }
  const nextRule: XrayConfigObject = { type: "field", outboundTag: tag, [field]: nextValues };
  if (matchingIndexes.length === 0) {
    rules.push(nextRule);
    objectSection(config, "routing").rules = rules;
    return;
  }
  const first = matchingIndexes[0];
  objectSection(config, "routing").rules = rules.flatMap((rule, index) => {
    if (index === first) return [nextRule];
    return matchingIndexes.includes(index) ? [] : [rule];
  });
}

function ruleTarget(config: XrayConfigObject, kind: XrayBasicRuleKind): { tag: string; field: "ip" | "domain" } {
  switch (kind) {
    case "blockedIPs": return { tag: blockTag(config), field: "ip" };
    case "blockedDomains": return { tag: blockTag(config), field: "domain" };
    case "directIPs": return { tag: "direct", field: "ip" };
    case "directDomains": return { tag: "direct", field: "domain" };
    case "ipv4Domains": return { tag: "IPv4", field: "domain" };
    case "warpDomains": return { tag: "warp", field: "domain" };
    case "warpIPv4Domains": return { tag: "warp-v4", field: "domain" };
    case "warpIPv6Domains": return { tag: "warp-v6", field: "domain" };
  }
}

export function readXrayBasicSettings(config: XrayConfigObject): XrayBasicSettings {
  const direct = outbounds(config).find((item) => outboundTag(item) === "direct" && item.protocol === "freedom");
  const directSettings = direct && isObject(direct.settings) ? direct.settings : {};
  const routing = isObject(config.routing) ? config.routing : {};
  const policy = isObject(config.policy) ? config.policy : {};
  const system = isObject(policy.system) ? policy.system : {};
  const log = isObject(config.log) ? config.log : {};
  const blockedTag = blockTag(config);
  return {
    freedomStrategy: typeof directSettings.domainStrategy === "string" ? directSettings.domainStrategy : "AsIs",
    routingStrategy: typeof routing.domainStrategy === "string" ? routing.domainStrategy : "AsIs",
    statsInboundUplink: system.statsInboundUplink === true,
    statsInboundDownlink: system.statsInboundDownlink === true,
    statsOutboundUplink: system.statsOutboundUplink === true,
    statsOutboundDownlink: system.statsOutboundDownlink === true,
    logLevel: typeof log.loglevel === "string" ? log.loglevel : "warning",
    accessLog: typeof log.access === "string" ? log.access : "",
    errorLog: typeof log.error === "string" ? log.error : "",
    maskAddress: typeof log.maskAddress === "string" ? log.maskAddress : "",
    dnsLog: log.dnsLog === true,
    torrentBlocked: readRuleValues(config, blockedTag, "protocol").includes("bittorrent"),
    blockedIPs: readRuleValues(config, blockedTag, "ip"),
    blockedDomains: readRuleValues(config, blockedTag, "domain"),
    directIPs: readRuleValues(config, "direct", "ip"),
    directDomains: readRuleValues(config, "direct", "domain"),
    ipv4Domains: readRuleValues(config, "IPv4", "domain"),
    warpDomains: readRuleValues(config, "warp", "domain"),
    warpIPv4Domains: readRuleValues(config, "warp-v4", "domain"),
    warpIPv6Domains: readRuleValues(config, "warp-v6", "domain"),
    warpAvailable: outbounds(config).some((item) => outboundTag(item) === "warp"),
    warpIPv4Available: outbounds(config).some((item) => outboundTag(item) === "warp-v4"),
    warpIPv6Available: outbounds(config).some((item) => outboundTag(item) === "warp-v6"),
    blockOutboundTag: blockedTag,
  };
}

export function setXrayFreedomStrategy(config: XrayConfigObject, strategy: string): void {
  const direct = ensureDirectOutbound(config);
  const settings = isObject(direct.settings) ? direct.settings : {};
  settings.domainStrategy = strategy;
  direct.settings = settings;
}

export function setXrayRoutingStrategy(config: XrayConfigObject, strategy: string): void {
  objectSection(config, "routing").domainStrategy = strategy;
}

export function setXrayStat(config: XrayConfigObject, key: "statsInboundUplink" | "statsInboundDownlink" | "statsOutboundUplink" | "statsOutboundDownlink", enabled: boolean): void {
  const system = objectSection(objectSection(config, "policy"), "system");
  system[key] = enabled;
  if (enabled && !isObject(config.stats)) config.stats = {};
}

export function setXrayLog(config: XrayConfigObject, key: "loglevel" | "access" | "error" | "maskAddress" | "dnsLog", value: string | boolean): void {
  objectSection(config, "log")[key] = value;
}

export function setXrayTorrentBlocked(config: XrayConfigObject, enabled: boolean): void {
  const tag = enabled ? ensureBlockOutbound(config) : blockTag(config);
  const current = readRuleValues(config, tag, "protocol").filter((value) => value !== "bittorrent");
  writeRuleValues(config, tag, "protocol", enabled ? [...current, "bittorrent"] : current);
}

export function setXrayBasicRule(config: XrayConfigObject, kind: XrayBasicRuleKind, values: string[]): void {
  if ((kind === "blockedIPs" || kind === "blockedDomains") && values.length > 0) ensureBlockOutbound(config);
  if ((kind === "directIPs" || kind === "directDomains") && values.length > 0) ensureDirectOutbound(config);
  if (kind === "ipv4Domains" && values.length > 0) ensureIPv4Outbound(config);
  const target = ruleTarget(config, kind);
  writeRuleValues(config, target.tag, target.field, values);
}

export function applyXrayBasicDefaults(config: XrayConfigObject): void {
  setXrayFreedomStrategy(config, "AsIs");
  setXrayRoutingStrategy(config, "AsIs");
  setXrayStat(config, "statsInboundUplink", true);
  setXrayStat(config, "statsInboundDownlink", true);
  setXrayStat(config, "statsOutboundUplink", false);
  setXrayStat(config, "statsOutboundDownlink", false);
  setXrayLog(config, "loglevel", "warning");
  setXrayLog(config, "access", "none");
  setXrayLog(config, "error", "");
  setXrayLog(config, "maskAddress", "");
  setXrayLog(config, "dnsLog", false);
  setXrayTorrentBlocked(config, true);
  setXrayBasicRule(config, "blockedIPs", ["geoip:private"]);
  setXrayBasicRule(config, "blockedDomains", []);
  setXrayBasicRule(config, "directIPs", []);
  setXrayBasicRule(config, "directDomains", []);
  setXrayBasicRule(config, "ipv4Domains", []);
  setXrayBasicRule(config, "warpDomains", []);
  setXrayBasicRule(config, "warpIPv4Domains", []);
  setXrayBasicRule(config, "warpIPv6Domains", []);
}
