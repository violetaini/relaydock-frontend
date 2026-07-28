import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from "react";
import {
  ArrowDown,
  ArrowUp,
  Award,
  Braces,
  Check,
  Clipboard,
  CloudDownload,
  Copy,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FileCode2,
  FilePlus2,
  FileText,
  Globe2,
  Info,
  KeyRound,
  Link2,
  LockKeyhole,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  RotateCw,
  Save,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Upload,
  WandSparkles,
} from "lucide-react";
import QRCode from "qrcode";
import { api, request } from "./api";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  PageHeader,
  Spinner,
  Surface,
  Toggle,
  formatBytes,
} from "./ui";
import "./content-workbench.css";

export type ContentNotify = (message: string, tone?: "success" | "error") => void;
export interface ContentPageProps {
  notify?: ContentNotify;
  onOpenCustomRules?: () => void;
  onOpenRulesConfig?: () => void;
}

interface Envelope { success?: boolean; message?: string; error?: string }
interface SubscriptionItem {
  id: number;
  name: string;
  description?: string;
  filename: string;
  type: string;
  can_delete?: boolean;
  file_short_code?: string;
  custom_short_code?: string;
  updated_at?: string;
  latest_version?: number;
}
interface TokenBundle { token: string; user_short_code?: string }
interface NodeItem {
  id: number;
  node_name: string;
  protocol: string;
  clash_config: string;
  enabled: boolean;
  tags?: string[];
  tag?: string;
}
interface RuleTemplateInfo { name: string; filename: string; variables?: Record<string, string> }
interface RuleTemplateList {
  templates: string[];
  owners?: Record<string, string>;
  username?: string;
  is_admin?: boolean;
}
interface SubscribeFile {
  id: number;
  name: string;
  description?: string;
  type: string;
  filename: string;
  file_short_code?: string;
  custom_short_code?: string;
  auto_sync_custom_rules: boolean;
  template_filename?: string;
  selected_tags?: string[];
  selected_node_ids?: number[];
  selected_custom_rule_ids?: number[];
  selected_override_script_ids?: number[];
  stats_server_ids?: string;
  traffic_limit?: number | null;
  sort_order?: number;
  raw_output?: boolean;
  created_by?: string;
  updated_at?: string;
  latest_version?: number;
}
interface CustomRuleOption {
  id: number;
  name: string;
  type: "dns" | "rules" | "rule-providers" | string;
  enabled: boolean;
}
interface OverrideScriptOption {
  id: number;
  name: string;
  hook: "post_fetch" | "pre_save_nodes" | string;
  enabled: boolean;
}
interface ProxyProviderConfig {
  id: number;
  external_subscription_id: number;
  name: string;
  type: string;
  interval: number;
  proxy: string;
  size_limit: number;
  header: string;
  health_check_enabled: boolean;
  health_check_url: string;
  health_check_interval: number;
  health_check_timeout: number;
  health_check_lazy: boolean;
  health_check_expected_status: number;
  filter: string;
  exclude_filter: string;
  exclude_type: string;
  geo_ip_filter: string;
  override: string;
  process_mode: string;
  created_at?: string;
  updated_at?: string;
}
interface ExternalSubscription {
  id: number;
  username?: string;
  name: string;
  url: string;
  user_agent?: string;
  node_count: number;
  last_sync_at?: string | null;
  upload?: number;
  download?: number;
  total?: number;
  expire?: string | null;
  traffic_mode?: "download" | "upload" | "both";
}
interface CertificateItem {
  id: number;
  domain: string;
  email?: string;
  provider?: string;
  status: string;
  expiry_date?: string | null;
  issue_date?: string | null;
  auto_renew: boolean;
  auto_deploy: boolean;
  challenge_mode?: string;
  webroot_path?: string;
  remote_server_id?: number;
  remote_server_name?: string;
  dns_provider_id?: number;
  deploy_target?: string;
  deploy_cert_path?: string;
  deploy_key_path?: string;
  message?: string;
  updated_at?: string;
}
interface DNSProviderItem { id: number; name: string; provider_type: string; created_at?: string; updated_at?: string }
interface DNSProviderWire extends Partial<DNSProviderItem> {
  ID?: number;
  Name?: string;
  ProviderType?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
}
interface DNSProviderCredentialsResponse extends Envelope {
  credentials?: Record<string, unknown> | string;
}
interface RemoteServerItem { id: number; name: string }

type ProxyGroupType = "select" | "url-test" | "fallback" | "load-balance" | "relay";
type VisualSourceKind = "node" | "provider" | "group" | "builtin";
interface VisualSource { id: string; kind: VisualSourceKind; value: string }
interface VisualProxyGroup {
  id: string;
  name: string;
  type: ProxyGroupType;
  sources: VisualSource[];
  url: string;
  interval: number;
  tolerance: number;
  lazy: boolean;
  filter: string;
  excludeFilter: string;
  excludeType: string;
  strategy: string;
  dialerProxyGroup: string;
}
interface VisualTemplateDraft {
  version: 1;
  filename: string;
  dnsMode: "fake-ip" | "redir-host" | "off";
  ipv6: boolean;
  nameservers: string[];
  fakeIPRange: string;
  fakeIPFilters: string[];
  groups: VisualProxyGroup[];
  rules: string[];
}

type TemplateCreateMode = "upload" | "paste" | "blank" | "url" | "v2" | "subscription";

interface V2ConversionResult {
  proxy_groups?: unknown;
  rules?: unknown;
  rule_providers?: unknown;
}

const blankTemplate = `mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
proxies: []
proxy-groups:
  - name: PROXY
    type: select
    proxies: []
rules:
  - MATCH,PROXY
`;

interface DNSProviderField {
  label: string;
  key: string;
  type?: "email" | "password";
  optional?: boolean;
}

const cloudflareCredentialKey = "CF_API_CREDENTIAL";

const dnsProviderFields: Record<string, DNSProviderField[]> = {
  cloudflare: [
    { label: "账户邮箱（可选）", key: "CF_API_EMAIL", type: "email", optional: true },
    { label: "API 密钥", key: cloudflareCredentialKey },
  ],
  alidns: [
    { label: "AccessKey ID", key: "ALICLOUD_ACCESS_KEY" },
    { label: "AccessKey Secret", key: "ALICLOUD_SECRET_KEY" },
  ],
  tencentcloud: [
    { label: "SecretId", key: "TENCENTCLOUD_SECRET_ID" },
    { label: "SecretKey", key: "TENCENTCLOUD_SECRET_KEY" },
  ],
  dnspod: [{ label: "API Key", key: "DNSPOD_API_KEY" }],
  namesilo: [{ label: "API Key", key: "NAMESILO_API_KEY" }],
  godaddy: [
    { label: "API Key", key: "GODADDY_API_KEY" },
    { label: "API Secret", key: "GODADDY_API_SECRET" },
  ],
};

function parseDNSProviderCredentials(value: DNSProviderCredentialsResponse["credentials"]): Record<string, string> {
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return {}; }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed).flatMap(([key, item]) => typeof item === "string" ? [[key, item]] : []));
}

function credentialsForEditor(providerType: string, value: DNSProviderCredentialsResponse["credentials"]): Record<string, string> {
  const stored = parseDNSProviderCredentials(value);
  if (providerType !== "cloudflare") return stored;
  return {
    CF_API_EMAIL: stored.CF_API_EMAIL || "",
    [cloudflareCredentialKey]: stored.CF_DNS_API_TOKEN || stored.CF_API_KEY || stored[cloudflareCredentialKey] || "",
  };
}

const noNotify: ContentNotify = () => undefined;

function fail(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function assertSuccess<T extends Envelope>(payload: T, fallback: string): T {
  if (payload?.success === false) throw new Error(payload.error || payload.message || fallback);
  return payload;
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: "application/yaml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function normalizedFilename(value: string, fallback = "subscription"): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9_\-.]+/g, "-").replace(/^-+|-+$/g, "");
  const base = cleaned || fallback;
  return /\.ya?ml$/i.test(base) ? base : `${base}.yaml`;
}

function safeDownloadBasename(value: string, fallback = "subscription"): string {
  return value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || fallback;
}

async function uploadRuleTemplate(filename: string, content: string | Blob): Promise<void> {
  const safeName = normalizedFilename(filename, "template");
  const blob = content instanceof Blob ? content : new Blob([content], { type: "application/yaml;charset=utf-8" });
  const form = new FormData();
  form.set("template", new File([blob], safeName, { type: "application/yaml" }));
  await request("/api/admin/rule-templates/upload", { method: "POST", body: form });
}

function v2ResultToTemplate(result: V2ConversionResult): string {
  return `${JSON.stringify({
    "mixed-port": 7890,
    "allow-lan": false,
    mode: "rule",
    "log-level": "info",
    proxies: [],
    "proxy-groups": result.proxy_groups ?? [],
    "rule-providers": result.rule_providers ?? {},
    rules: result.rules ?? ["MATCH,PROXY"],
  }, null, 2)}\n`;
}

function certificateTone(status: string): "good" | "warn" | "bad" | "neutral" {
  if (status === "valid") return "good";
  if (status === "pending") return "warn";
  if (status === "failed" || status === "expired") return "bad";
  return "neutral";
}

function certificateStatus(status: string): string {
  return ({ valid: "有效", pending: "处理中", failed: "失败", expired: "已过期" } as Record<string, string>)[status] || status;
}

function certFilename(domain: string): string {
  return domain.startsWith("*.") ? `_.${domain.slice(2)}` : domain;
}

function absoluteURL(path: string): string {
  return new URL(path, window.location.origin).toString();
}

function clashDeepLink(url: string, name: string): string {
  const params = new URLSearchParams({ url, name });
  return `clash://install-config?${params.toString()}`;
}

let generatedID = 0;
function localID(prefix: string): string {
  generatedID += 1;
  return `${prefix}-${Date.now().toString(36)}-${generatedID.toString(36)}`;
}

function defaultVisualGroup(): VisualProxyGroup {
  return {
    id: localID("group"),
    name: "PROXY",
    type: "select",
    sources: [
      { id: localID("source"), kind: "node", value: "__PROXY_NODES__" },
      { id: localID("source"), kind: "builtin", value: "DIRECT" },
    ],
    url: "https://cp.cloudflare.com/generate_204",
    interval: 300,
    tolerance: 50,
    lazy: true,
    filter: "",
    excludeFilter: "",
    excludeType: "",
    strategy: "consistent-hashing",
    dialerProxyGroup: "",
  };
}

function defaultVisualDraft(): VisualTemplateDraft {
  return {
    version: 1,
    filename: "visual_v3.yaml",
    dnsMode: "fake-ip",
    ipv6: false,
    nameservers: ["tls://1.1.1.1", "tls://8.8.8.8"],
    fakeIPRange: "198.18.0.1/16",
    fakeIPFilters: ["+.lan", "+.local"],
    groups: [defaultVisualGroup()],
    rules: ["MATCH,PROXY"],
  };
}

function isVisualDraft(value: unknown): value is VisualTemplateDraft {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<VisualTemplateDraft>;
  return candidate.version === 1 && typeof candidate.filename === "string" && Array.isArray(candidate.groups) && Array.isArray(candidate.rules) && Array.isArray(candidate.nameservers);
}

function visualTemplateObject(draft: VisualTemplateDraft): Record<string, unknown> {
  const groups = draft.groups.map((group) => {
    const proxies = group.sources.filter((source) => source.kind !== "provider").map((source) => source.value);
    const use = group.sources.filter((source) => source.kind === "provider").map((source) => source.value);
    const output: Record<string, unknown> = { name: group.name.trim(), type: group.type };
    if (proxies.length) output.proxies = proxies;
    if (use.length) output.use = use;
    if (["url-test", "fallback", "load-balance"].includes(group.type)) {
      output.url = group.url.trim();
      output.interval = Math.max(1, group.interval || 300);
      output.lazy = group.lazy;
    }
    if (group.type === "url-test") output.tolerance = Math.max(0, group.tolerance || 0);
    if (group.type === "load-balance" && group.strategy) output.strategy = group.strategy;
    if (group.filter.trim()) output.filter = group.filter.trim();
    if (group.excludeFilter.trim()) output["exclude-filter"] = group.excludeFilter.trim();
    if (group.excludeType.trim()) output["exclude-type"] = group.excludeType.trim();
    if (group.dialerProxyGroup.trim()) output["dialer-proxy-group"] = group.dialerProxyGroup.trim();
    return output;
  });
  const output: Record<string, unknown> = {
    mode: "rule",
    proxies: null,
    "proxy-groups": groups,
    rules: draft.rules.map((rule) => rule.trim()).filter(Boolean),
  };
  if (draft.dnsMode !== "off") {
    const dns: Record<string, unknown> = {
      enable: true,
      "enhanced-mode": draft.dnsMode,
      ipv6: draft.ipv6,
      nameserver: draft.nameservers.map((item) => item.trim()).filter(Boolean),
    };
    if (draft.dnsMode === "fake-ip") {
      dns["fake-ip-range"] = draft.fakeIPRange.trim() || "198.18.0.1/16";
      dns["fake-ip-filter"] = draft.fakeIPFilters.map((item) => item.trim()).filter(Boolean);
    }
    output.dns = dns;
  }
  return output;
}

function yamlScalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(String(value));
}

function structuredYAML(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return `${pad}[]`;
    return value.map((item) => {
      if (item && typeof item === "object") return `${pad}-\n${structuredYAML(item, indent + 2)}`;
      return `${pad}- ${yamlScalar(item)}`;
    }).join("\n");
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return `${pad}{}`;
    return entries.map(([key, item]) => {
      const safeKey = /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
      if (Array.isArray(item)) return item.length ? `${pad}${safeKey}:\n${structuredYAML(item, indent + 2)}` : `${pad}${safeKey}: []`;
      if (item && typeof item === "object") return `${pad}${safeKey}:\n${structuredYAML(item, indent + 2)}`;
      return `${pad}${safeKey}: ${yamlScalar(item)}`;
    }).join("\n");
  }
  return `${pad}${yamlScalar(value)}`;
}

function resolveSubscriptionURL(item: SubscriptionItem, token: TokenBundle | null): string {
  const fileCode = item.custom_short_code || item.file_short_code;
  if (fileCode && token?.user_short_code) return absoluteURL(`/x/${fileCode}${token.user_short_code}`);
  const params = new URLSearchParams({ filename: item.filename });
  if (token?.token) params.set("token", token.token);
  return absoluteURL(`/api/clash/subscribe?${params.toString()}`);
}

function privateURL(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.searchParams.has("token")) parsed.searchParams.set("token", "••••••••");
    return parsed.toString();
  } catch {
    return value;
  }
}

function safeProxy(node: NodeItem): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(node.clash_config) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    return { ...parsed, name: node.node_name || parsed.name };
  } catch {
    return null;
  }
}

const ruleCategories = [
  { key: "ads", emoji: "🔴", label: "广告拦截", rules: ["GEOSITE,category-ads-all,REJECT"] },
  { key: "ai", emoji: "🤖", label: "AI 服务", rules: ["GEOSITE,category-ai-!cn,PROXY"] },
  { key: "bilibili", emoji: "📺", label: "哔哩哔哩", rules: ["GEOSITE,bilibili,DIRECT"] },
  { key: "youtube", emoji: "📺", label: "油管视频", rules: ["GEOSITE,youtube,PROXY"] },
  { key: "google", emoji: "🔍", label: "谷歌服务", rules: ["GEOSITE,google,PROXY", "GEOIP,google,PROXY,no-resolve"] },
  { key: "private", emoji: "🏠", label: "私有网络", rules: ["GEOSITE,private,DIRECT", "GEOIP,private,DIRECT,no-resolve"] },
  { key: "cn", emoji: "🔒", label: "国内服务", rules: ["GEOSITE,cn,DIRECT", "GEOIP,cn,DIRECT,no-resolve"] },
  { key: "telegram", emoji: "📱", label: "电报消息", rules: ["GEOSITE,telegram,PROXY", "GEOIP,telegram,PROXY,no-resolve"] },
  { key: "github", emoji: "🐱", label: "Github", rules: ["GEOSITE,github,PROXY"] },
  { key: "microsoft", emoji: "🪟", label: "微软服务", rules: ["GEOSITE,microsoft,PROXY"] },
  { key: "apple", emoji: "🍎", label: "苹果服务", rules: ["GEOSITE,apple,DIRECT"] },
  { key: "social", emoji: "🌐", label: "社交媒体", rules: ["GEOSITE,category-social-media-!cn,PROXY"] },
  { key: "stream", emoji: "📺", label: "流媒体", rules: ["GEOSITE,category-entertainment,PROXY"] },
  { key: "games", emoji: "🎮", label: "游戏平台", rules: ["GEOSITE,category-games,PROXY"] },
  { key: "education", emoji: "📚", label: "教育资源", rules: ["GEOSITE,category-scholar-!cn,PROXY"] },
  { key: "finance", emoji: "💰", label: "金融服务", rules: ["GEOSITE,category-finance,PROXY"] },
  { key: "cloud", emoji: "☁️", label: "云服务", rules: ["GEOSITE,category-dev,PROXY"] },
  { key: "spotify", emoji: "🎵", label: "Spotify", rules: ["GEOSITE,spotify,PROXY"] },
  { key: "pixiv", emoji: "🎨", label: "Pixiv", rules: ["GEOSITE,pixiv,PROXY"] },
  { key: "abema", emoji: "📡", label: "Abema", rules: ["GEOSITE,abema,PROXY"] },
  { key: "proxy", emoji: "🔀", label: "代理服务", rules: ["GEOSITE,gfw,PROXY"] },
  { key: "proxy-media", emoji: "🎭", label: "代理媒体", rules: ["GEOSITE,geolocation-!cn,PROXY"] },
  { key: "ehentai", emoji: "🔞", label: "E-Hentai", rules: ["GEOSITE,ehentai,PROXY"] },
  { key: "non-cn", emoji: "🌍", label: "非中国", rules: ["GEOSITE,geolocation-!cn,PROXY"] },
  { key: "tracker", emoji: "🔗", label: "PT Tracker", rules: ["GEOSITE,category-public-tracker,DIRECT"] },
  { key: "pt", emoji: "🎞️", label: "PT 站点", rules: ["GEOSITE,category-pt,DIRECT"] },
] as const;

const defaultRuleKeys = new Set(["ads", "ai", "youtube", "google", "private", "cn", "telegram"]);

function customClashConfig(proxies: Record<string, unknown>[], selected: Set<string>): string {
  const names = proxies.map((proxy) => String(proxy.name || "未命名节点"));
  const rules = ruleCategories.flatMap((category) => selected.has(category.key) ? category.rules : []);
  const proxyLines = proxies.length
    ? proxies.map((proxy) => `  - ${JSON.stringify(proxy)}`).join("\n")
    : "  []";
  const nameLines = names.length ? names.map((name) => `      - ${JSON.stringify(name)}`).join("\n") : "      - DIRECT";
  return [
    "mode: rule",
    "mixed-port: 7890",
    "allow-lan: false",
    "log-level: info",
    "proxies:",
    proxyLines,
    "proxy-groups:",
    "  - name: PROXY",
    "    type: select",
    "    proxies:",
    nameLines,
    "  - name: AUTO",
    "    type: url-test",
    "    url: https://cp.cloudflare.com/generate_204",
    "    interval: 300",
    "    proxies:",
    nameLines,
    "rules:",
    ...rules.map((rule) => `  - ${rule}`),
    "  - MATCH,PROXY",
    "",
  ].join("\n");
}

export function SubscriptionLinksPage({ notify = noNotify }: ContentPageProps) {
  const [items, setItems] = useState<SubscriptionItem[]>([]);
  const [token, setToken] = useState<TokenBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [qrItem, setQRItem] = useState<{ name: string; url: string } | null>(null);
  const [deleteItem, setDeleteItem] = useState<SubscriptionItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [subscriptions, bundle] = await Promise.all([
        api.get<{ subscriptions?: SubscriptionItem[] }>("/api/subscriptions"),
        api.get<TokenBundle>("/api/user/token"),
      ]);
      setItems(subscriptions.subscriptions ?? []);
      setToken(bundle);
    } catch (reason) {
      setError(fail(reason, "加载订阅链接失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const remove = async () => {
    if (!deleteItem?.can_delete || deleteItem.id <= 0) return;
    setDeleting(true);
    setError("");
    try {
      await api.delete(`/api/admin/subscribe-files/${deleteItem.id}`);
      setItems((current) => current.filter((item) => item.id !== deleteItem.id));
      notify(`订阅“${deleteItem.name}”已删除`);
      setDeleteItem(null);
    } catch (reason) {
      setError(fail(reason, "删除订阅失败"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="cw-page">
      <PageHeader title="订阅链接" description="查看已分配的配置并复制到 Clash、Mihomo 或兼容客户端。" actions={<IconButton label="刷新订阅" onClick={() => void load()}><RefreshCw size={18} /></IconButton>} />
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {loading ? <Surface className="cw-loading"><Spinner /></Surface> : items.length === 0 ? (
        <Surface><EmptyState icon={<Link2 size={24} />} title="暂无可用订阅" description="尚未分配套餐或订阅文件。" /></Surface>
      ) : (
        <div className="cw-grid cw-subscription-grid">
          {items.map((item) => {
            const url = resolveSubscriptionURL(item, token);
            return (
              <Surface className="cw-card" key={item.id}>
                <div className="cw-card-head">
                  <div><h2>{item.name}</h2><p>{item.description || "Mihomo / Clash 兼容配置"}</p></div>
                  <Badge tone={item.type === "package" ? "info" : "neutral"}>{item.type === "package" ? "套餐" : "订阅"}</Badge>
                </div>
                <div className="cw-meta">
                  <span><FileText size={13} />{item.filename}</span>
                  {item.latest_version ? <span>版本 {item.latest_version}</span> : null}
                  <span>更新于 {formatDate(item.updated_at)}</span>
                </div>
                <div className="cw-link-box">
                  <code title={privateURL(url)}>{privateURL(url)}</code>
                  <IconButton label={`复制 ${item.name} 订阅链接`} onClick={async () => { await copyText(url); notify("订阅链接已复制"); }}><Copy size={17} /></IconButton>
                </div>
                <div className="cw-card-actions cw-subscription-actions">
                  <Button variant="secondary" onClick={async () => { await copyText(url); notify("订阅链接已复制"); }}><Clipboard size={16} />复制链接</Button>
                  <Button variant="secondary" onClick={() => setQRItem({ name: item.name, url })}><QrCode size={16} />二维码</Button>
                  <a className="button button-secondary" href={clashDeepLink(url, item.name)}><Download size={16} />导入 Clash</a>
                  <Button variant="ghost" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}><ExternalLink size={16} />浏览器打开</Button>
                  {item.can_delete ? <IconButton className="cw-subscription-delete" label={`删除订阅 ${item.name}`} disabled={deleting} onClick={() => setDeleteItem(item)}><Trash2 size={17} /></IconButton> : null}
                </div>
              </Surface>
            );
          })}
        </div>
      )}
      {qrItem ? <SubscriptionQRDialog name={qrItem.name} url={qrItem.url} onClose={() => setQRItem(null)} /> : null}
      {deleteItem ? <ConfirmDialog title="删除订阅" description={`将永久删除“${deleteItem.name}”及其订阅文件，所有已分配链接会立即失效。`} confirmLabel="确认删除" working={deleting} onCancel={() => setDeleteItem(null)} onConfirm={() => void remove()} /> : null}
    </section>
  );
}

function SubscriptionQRDialog({ name, url, onClose }: { name: string; url: string; onClose: () => void }) {
  const [dataURL, setDataURL] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
      color: { dark: "#111815", light: "#ffffff" },
    }).then((value) => { if (active) setDataURL(value); }).catch((reason: unknown) => { if (active) setError(fail(reason, "生成二维码失败")); });
    return () => { active = false; };
  }, [url]);
  return <Dialog title="订阅二维码" description={name} onClose={onClose}>{error ? <ErrorState message={error} /> : null}<div className="cw-qr-wrap">{dataURL ? <img src={dataURL} alt={`${name} 订阅二维码`} width={320} height={320} /> : <Spinner label="正在本地生成二维码" />}</div><div className="cw-link-box"><code title={privateURL(url)}>{privateURL(url)}</code><IconButton label={`复制 ${name} 二维码中的链接`} onClick={async () => { await copyText(url); }}><Copy size={17} /></IconButton></div><div className="dialog-actions"><Button variant="secondary" onClick={onClose}>关闭</Button>{dataURL ? <a className="button button-primary" href={dataURL} download={`${safeDownloadBasename(name)}.png`}><Download size={16} />下载 PNG</a> : null}</div></Dialog>;
}

export function SubscriptionGeneratorPage({ notify = noNotify }: ContentPageProps) {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [templates, setTemplates] = useState<RuleTemplateInfo[]>([]);
  const [selectedNodes, setSelectedNodes] = useState<Set<number>>(new Set());
  const [selectedRules, setSelectedRules] = useState<Set<string>>(() => new Set(defaultRuleKeys));
  const [mode, setMode] = useState<"rules" | "template">("rules");
  const [template, setTemplate] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [showSave, setShowSave] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nodePayload, templatePayload] = await Promise.all([
        api.get<{ nodes?: NodeItem[] }>("/api/admin/nodes"),
        api.get<{ templates?: RuleTemplateInfo[] }>("/api/admin/template-v3"),
      ]);
      const enabled = (nodePayload.nodes ?? []).filter((node) => node.enabled && safeProxy(node));
      setNodes(enabled);
      const options = templatePayload.templates ?? [];
      setTemplates(options);
      setTemplate((current) => current || options[0]?.filename || "");
    } catch (reason) {
      setError(fail(reason, "加载生成器数据失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const proxies = useMemo(() => nodes.filter((node) => selectedNodes.has(node.id)).map(safeProxy).filter((item): item is Record<string, unknown> => Boolean(item)), [nodes, selectedNodes]);

  const generate = async () => {
    if (proxies.length === 0) { setError("请至少选择一个节点"); return; }
    setWorking(true);
    setError("");
    try {
      if (mode === "template") {
        if (!template) throw new Error("请选择规则模板");
        const result = await api.post<{ content: string }>("/api/admin/template-v3/process", { template_name: template, proxies });
        setOutput(result.content || "");
      } else {
        setOutput(customClashConfig(proxies, selectedRules));
      }
      notify("订阅配置已生成");
    } catch (reason) {
      setError(fail(reason, "生成订阅失败"));
    } finally {
      setWorking(false);
    }
  };

  const toggleNode = (id: number) => setSelectedNodes((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleRule = (key: string) => setSelectedRules((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <section className="cw-page">
      <PageHeader title="订阅生成器" description="从节点管理选择节点，使用规则分类或模板生成可直接使用的 Mihomo 配置。" actions={<IconButton label="刷新节点和模板" onClick={() => void load()}><RefreshCw size={18} /></IconButton>} />
      {error ? <ErrorState message={error} /> : null}
      {loading ? <Surface className="cw-loading"><Spinner /></Surface> : (
        <Surface className="cw-generator-workbench">
          <section className="cw-workbench-section cw-node-section">
            <div className="cw-section-title"><div><h2>选择节点</h2><p>从已保存的节点中选择需要添加到订阅的节点</p></div><span className="cw-category-count">已选 {selectedNodes.size}</span></div>
            <div className="cw-toolbar cw-generator-toolbar">
              <Button variant="ghost" onClick={() => setSelectedNodes(new Set(nodes.map((node) => node.id)))}>全选</Button>
              <Button variant="ghost" onClick={() => setSelectedNodes(new Set())}>清空</Button>
            </div>
            {nodes.length === 0 ? <div className="cw-empty-inline">暂无可用节点，请先在节点管理中添加并启用节点。</div> : (
              <div className="cw-selector cw-selector-table">
                <div className="cw-selector-head"><span aria-hidden="true" /><strong>节点名称</strong><strong>协议</strong><strong>标签</strong></div>
                {nodes.map((node) => <label className="cw-selector-row" key={node.id}><input type="checkbox" checked={selectedNodes.has(node.id)} onChange={() => toggleNode(node.id)} /><span><strong>{node.node_name}</strong><small>节点 ID {node.id}</small></span><Badge tone={node.enabled ? "good" : "neutral"}>{node.protocol || "未知"}</Badge><small>{node.tags?.length ? node.tags.join(" / ") : node.tag || "手动输入"}</small></label>)}
              </div>
            )}
          </section>

          <section className="cw-workbench-section">
            <div className="cw-section-title"><div><h2>规则模式</h2><p>自定义分类或加载现有模板</p></div></div>
            <div className="cw-mode" role="tablist" aria-label="规则模式">
              <button type="button" className={mode === "rules" ? "is-active" : ""} onClick={() => setMode("rules")}><Settings2 size={16} />自定义规则</button>
              <button type="button" className={mode === "template" ? "is-active" : ""} onClick={() => setMode("template")}><FileCode2 size={16} />使用模板</button>
            </div>
            {mode === "template" ? <div className="cw-template-field"><Field label="选择模板" hint="模板中的代理组会自动注入已选节点"><select value={template} onChange={(event) => setTemplate(event.target.value)}><option value="">请选择模板</option>{templates.map((item) => <option key={item.filename} value={item.filename}>{item.name || item.filename}</option>)}</select></Field></div> : null}
          </section>

          {mode === "rules" ? (
            <section className="cw-workbench-section">
              <div className="cw-section-title"><div><h2>规则选择</h2><p>均衡规则已预选，可按用途调整</p></div><span className="cw-category-count">{selectedRules.size} 个分类</span></div>
              <div className="cw-rules">{ruleCategories.map((item) => <button type="button" className={`cw-rule ${selectedRules.has(item.key) ? "is-selected" : ""}`} key={item.key} onClick={() => toggleRule(item.key)}><span>{item.emoji}</span><span>{item.label}</span></button>)}</div>
            </section>
          ) : null}

          <section className={`cw-workbench-section cw-output-section ${output ? "has-output" : ""}`}>
            <div className="cw-section-title"><div><h2>最终订阅配置</h2><p>生成后可复制、下载或保存到订阅管理</p></div></div>
            {output ? <div className="cw-generator-output">
              <textarea className="cw-code" aria-label="生成的订阅配置" value={output} onChange={(event) => setOutput(event.target.value)} placeholder="选择节点和规则后生成配置" spellCheck={false} />
              <div className="cw-output-actions"><IconButton label="复制配置" onClick={async () => { await copyText(output); notify("配置已复制"); }}><Copy size={16} /></IconButton><IconButton label="下载配置" onClick={() => downloadText("subscription.yaml", output)}><Download size={16} /></IconButton></div>
            </div> : null}
            <div className="cw-card-actions cw-generator-actions">
              <Button onClick={() => void generate()} disabled={working || selectedNodes.size === 0}>{working ? <Spinner label="正在生成" /> : <><WandSparkles size={16} />生成订阅文件</>}</Button>
              <Button variant="secondary" onClick={() => setOutput("")}>清空</Button>
              <Button variant="secondary" disabled={!output} onClick={() => setShowSave(true)}><Save size={16} />保存订阅</Button>
            </div>
          </section>
        </Surface>
      )}
      {showSave ? <SaveGeneratedDialog content={output} onClose={() => setShowSave(false)} onSaved={() => { setShowSave(false); notify("订阅已保存"); }} /> : null}
    </section>
  );
}

function SaveGeneratedDialog({ content, onClose, onSaved }: { content: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [filename, setFilename] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true); setError("");
    try {
      await api.post("/api/admin/subscribe-files/create-from-config", { name, description, filename: normalizedFilename(filename || name), content });
      onSaved();
    } catch (reason) { setError(fail(reason, "保存订阅失败")); }
    finally { setWorking(false); }
  };
  return <Dialog title="保存生成的订阅" description="保存后可在订阅管理中继续编辑和分配" onClose={onClose}><form className="cw-form" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<Field label="订阅名称"><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：日常使用" /></Field><Field label="文件名"><input value={filename} onChange={(event) => setFilename(event.target.value)} placeholder="留空则根据名称生成" /></Field><Field label="说明"><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="可选" /></Field><div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在保存" /> : "保存"}</Button></div></form></Dialog>;
}

function subscribeFilePayload(file: SubscribeFile, overrides: Partial<SubscribeFile> = {}) {
  const next = { ...file, ...overrides };
  return {
    name: next.name,
    description: next.description || "",
    type: next.type,
    filename: next.filename,
    auto_sync_custom_rules: next.auto_sync_custom_rules,
    template_filename: next.template_filename || "",
    selected_tags: next.selected_tags ?? [],
    selected_node_ids: next.selected_node_ids ?? [],
    selected_custom_rule_ids: next.selected_custom_rule_ids ?? [],
    selected_override_script_ids: next.selected_override_script_ids ?? [],
    stats_server_ids: next.stats_server_ids ?? "",
    traffic_limit: next.traffic_limit ?? null,
    custom_short_code: next.custom_short_code ?? "",
    raw_output: next.raw_output ?? false,
    sort_order: next.sort_order ?? 0,
  };
}

type FilePendingAction =
  | { kind: "delete-file"; item: SubscribeFile }
  | { kind: "delete-external"; item: ExternalSubscription }
  | { kind: "delete-provider"; item: ProxyProviderConfig };

export function SubscribeFilesPage({ notify = noNotify, onOpenCustomRules, onOpenRulesConfig }: ContentPageProps) {
  const [tab, setTab] = useState<"files" | "external" | "providers">("files");
  const [files, setFiles] = useState<SubscribeFile[]>([]);
  const [external, setExternal] = useState<ExternalSubscription[]>([]);
  const [providers, setProviders] = useState<ProxyProviderConfig[]>([]);
  const [rules, setRules] = useState<CustomRuleOption[]>([]);
  const [scripts, setScripts] = useState<OverrideScriptOption[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [templates, setTemplates] = useState<string[]>([]);
  const [servers, setServers] = useState<RemoteServerItem[]>([]);
  const [token, setToken] = useState<TokenBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [editingFile, setEditingFile] = useState<SubscribeFile | null>(null);
  const [editingContent, setEditingContent] = useState<SubscribeFile | null>(null);
  const [editingExternal, setEditingExternal] = useState<ExternalSubscription | "new" | null>(null);
  const [editingProvider, setEditingProvider] = useState<ProxyProviderConfig | "new" | null>(null);
  const [pending, setPending] = useState<FilePendingAction | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [filePayload, externalPayload, bundle, rulePayload, scriptPayload, nodePayload, templatePayload, serverPayload, providerPayload] = await Promise.all([
        api.get<{ files?: SubscribeFile[] }>("/api/admin/subscribe-files"),
        api.get<ExternalSubscription[]>("/api/user/external-subscriptions"),
        api.get<TokenBundle>("/api/user/token"),
        api.get<CustomRuleOption[]>("/api/admin/custom-rules"),
        api.get<OverrideScriptOption[]>("/api/admin/override-scripts"),
        api.get<{ nodes?: NodeItem[] }>("/api/admin/nodes"),
        api.get<RuleTemplateList>("/api/admin/rule-templates"),
        api.get<{ servers?: RemoteServerItem[] }>("/api/admin/remote-servers"),
        api.get<ProxyProviderConfig[]>("/api/user/proxy-provider-configs"),
      ]);
      setFiles((filePayload.files ?? []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)));
      setExternal(Array.isArray(externalPayload) ? externalPayload : []);
      setRules(Array.isArray(rulePayload) ? rulePayload : []);
      setScripts(Array.isArray(scriptPayload) ? scriptPayload : []);
      setNodes(nodePayload.nodes ?? []);
      setTemplates(templatePayload.templates ?? []);
      setServers(serverPayload.servers ?? []);
      setProviders(Array.isArray(providerPayload) ? providerPayload : []);
      setToken(bundle);
    } catch (reason) {
      setError(fail(reason, "加载订阅管理数据失败"));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const updateFile = async (file: SubscribeFile, overrides: Partial<SubscribeFile>) => {
    setWorking(true); setError("");
    try {
      await api.put(`/api/admin/subscribe-files/${file.id}`, subscribeFilePayload(file, overrides));
      notify("订阅设置已更新");
      await load();
    } catch (reason) { setError(fail(reason, "更新订阅失败")); }
    finally { setWorking(false); }
  };

  const reorder = async (file: SubscribeFile, direction: -1 | 1) => {
    const index = files.findIndex((item) => item.id === file.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= files.length) return;
    const reordered = [...files];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setFiles(reordered);
    try {
      await api.put("/api/admin/subscribe-files/reorder", { ids: reordered.map((item) => item.id) });
      notify("订阅顺序已更新");
    } catch (reason) {
      setError(fail(reason, "调整顺序失败"));
      await load();
    }
  };

  const confirmPending = async () => {
    if (!pending) return;
    setWorking(true); setError("");
    try {
      if (pending.kind === "delete-file") {
        await api.delete(`/api/admin/subscribe-files/${pending.item.id}`);
        notify("订阅文件已删除");
      } else if (pending.kind === "delete-external") {
        await api.delete(`/api/user/external-subscriptions?id=${pending.item.id}`);
        notify("外部订阅已删除");
      } else {
        await api.delete(`/api/user/proxy-provider-configs?id=${pending.item.id}`);
        notify("Proxy Provider 已删除");
      }
      setPending(null);
      await load();
    } catch (reason) { setError(fail(reason, "删除失败")); }
    finally { setWorking(false); }
  };

  const syncExternal = async (id?: number) => {
    setWorking(true); setError("");
    try {
      const path = id == null ? "/api/user/sync-external-subscriptions" : `/api/user/sync-external-subscription?id=${id}`;
      await api.post(path);
      notify(id == null ? "所有外部订阅同步完成" : "外部订阅同步完成");
      await load();
    } catch (reason) { setError(fail(reason, "同步外部订阅失败")); }
    finally { setWorking(false); }
  };

  return (
    <section className="cw-page">
      <PageHeader title="订阅管理" description="维护订阅文件、第三方订阅源和 Mihomo Proxy Provider。" actions={<>{onOpenCustomRules ? <Button variant="secondary" onClick={onOpenCustomRules}><Braces size={16} />覆写规则</Button> : null}{onOpenRulesConfig ? <Button variant="secondary" onClick={onOpenRulesConfig}><FileCode2 size={16} />规则配置</Button> : null}<IconButton label="刷新订阅管理" onClick={() => void load()}><RefreshCw size={18} /></IconButton>{tab === "files" ? <Button onClick={() => setShowImport(true)}><Plus size={16} />添加订阅</Button> : tab === "external" ? <><Button variant="secondary" onClick={() => void syncExternal()} disabled={working || external.length === 0}><RotateCw size={16} />同步全部</Button><Button onClick={() => setEditingExternal("new")}><Plus size={16} />外部订阅</Button></> : <Button onClick={() => setEditingProvider("new")}><Plus size={16} />Proxy Provider</Button>}</>} />
      <div className="cw-tabs cw-tabs-three" role="tablist" aria-label="订阅管理分类"><button type="button" role="tab" aria-selected={tab === "files"} className={tab === "files" ? "is-active" : ""} onClick={() => setTab("files")}><FileText size={16} />订阅列表 <span>{files.length}</span></button><button type="button" role="tab" aria-selected={tab === "external"} className={tab === "external" ? "is-active" : ""} onClick={() => setTab("external")}><CloudDownload size={16} />外部订阅 <span>{external.length}</span></button><button type="button" role="tab" aria-selected={tab === "providers"} className={tab === "providers" ? "is-active" : ""} onClick={() => setTab("providers")}><Server size={16} />Provider <span>{providers.length}</span></button></div>
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {loading ? <Surface className="cw-loading"><Spinner /></Surface> : tab === "files" ? (
        <Surface className="table-surface cw-compact-table">
          <div className="surface-heading"><div><h2>订阅列表</h2><small>已添加的订阅文件，可编辑内容与同步策略</small></div></div>
          {files.length === 0 ? <EmptyState icon={<FileText size={23} />} title="暂无订阅" description="从链接导入或上传本地 YAML 文件。" action={<Button onClick={() => setShowImport(true)}><Plus size={16} />添加订阅</Button>} /> : (
            <div className="table-wrap"><table><thead><tr><th>订阅</th><th>来源</th><th>模板 / 同步</th><th>更新时间</th><th aria-label="操作" /></tr></thead><tbody>{files.map((file, index) => {
              const item: SubscriptionItem = { ...file, id: file.id, filename: file.filename, type: file.type };
              const url = resolveSubscriptionURL(item, token);
              return <tr key={file.id}><td><div className="cw-file-name"><span className="cw-file-icon"><FileText size={16} /></span><span><strong>{file.name}</strong><small>{file.filename}{file.latest_version ? ` · v${file.latest_version}` : ""}</small></span></div></td><td><Badge tone={file.type === "import" ? "info" : "neutral"}>{file.type === "upload" ? "上传" : file.type === "import" ? "链接导入" : file.type === "create" ? "生成" : file.type}</Badge><span className="cw-table-note">{file.created_by || "系统"}</span></td><td><strong>{file.template_filename || "未绑定模板"}</strong><span className="cw-table-note">{file.auto_sync_custom_rules ? "自动同步自定义规则" : "手动同步"}</span></td><td>{formatDate(file.updated_at)}</td><td><div className="cw-table-actions"><IconButton label={`上移 ${file.name}`} disabled={index === 0} onClick={() => void reorder(file, -1)}><ArrowUp size={16} /></IconButton><IconButton label={`下移 ${file.name}`} disabled={index === files.length - 1} onClick={() => void reorder(file, 1)}><ArrowDown size={16} /></IconButton><IconButton label={`复制 ${file.name} 链接`} onClick={async () => { await copyText(url); notify("订阅链接已复制"); }}><Copy size={16} /></IconButton><IconButton label={`编辑 ${file.name} 内容`} onClick={() => setEditingContent(file)}><FileCode2 size={16} /></IconButton><IconButton label={`编辑 ${file.name}`} onClick={() => setEditingFile(file)}><Pencil size={16} /></IconButton><IconButton label={`${file.auto_sync_custom_rules ? "关闭" : "开启"} ${file.name} 自动同步`} onClick={() => void updateFile(file, { auto_sync_custom_rules: !file.auto_sync_custom_rules })}><RotateCw size={16} /></IconButton><IconButton label={`删除 ${file.name}`} onClick={() => setPending({ kind: "delete-file", item: file })}><Trash2 size={16} /></IconButton></div></td></tr>;
            })}</tbody></table></div>
          )}
        </Surface>
      ) : tab === "external" ? (
        <Surface className="table-surface cw-compact-table">
          <div className="surface-heading"><div><h2>外部订阅</h2><small>从第三方订阅同步节点，并保留流量与到期信息</small></div></div>
          {external.length === 0 ? <EmptyState icon={<CloudDownload size={23} />} title="暂无外部订阅" description="添加第三方订阅地址后可手动同步节点。" action={<Button onClick={() => setEditingExternal("new")}><Plus size={16} />添加外部订阅</Button>} /> : (
            <div className="table-wrap"><table><thead><tr><th>订阅源</th><th>节点</th><th>流量</th><th>上次同步</th><th aria-label="操作" /></tr></thead><tbody>{external.map((item) => {
              const used = (item.upload ?? 0) + (item.download ?? 0);
              const percent = item.total ? Math.min(100, used / item.total * 100) : 0;
              return <tr key={item.id}><td><div className="cw-file-name"><span className="cw-file-icon"><Globe2 size={16} /></span><span><strong>{item.name}</strong><small title={item.url}>{item.username ? `${item.username} · ` : ""}{item.url}</small></span></div></td><td><strong>{item.node_count ?? 0}</strong><span className="cw-table-note">个节点</span></td><td><div className="cw-usage"><strong>{formatBytes(used)} / {item.total ? formatBytes(item.total) : "不限"}</strong>{item.total ? <div className="cw-usage-track"><span style={{ width: `${percent}%` }} /></div> : null}<span className="cw-table-note">{item.expire ? `到期 ${formatDate(item.expire)}` : "无到期信息"}</span></div></td><td>{formatDate(item.last_sync_at)}</td><td><div className="cw-table-actions"><IconButton label={`同步 ${item.name}`} disabled={working} onClick={() => void syncExternal(item.id)}><RotateCw size={16} /></IconButton><IconButton label={`编辑 ${item.name}`} onClick={() => setEditingExternal(item)}><Pencil size={16} /></IconButton><IconButton label={`删除 ${item.name}`} onClick={() => setPending({ kind: "delete-external", item })}><Trash2 size={16} /></IconButton></div></td></tr>;
            })}</tbody></table></div>
          )}
        </Surface>
      ) : (
        <Surface className="table-surface cw-compact-table">
          <div className="surface-heading"><div><h2>Proxy Provider</h2><small>把外部订阅作为 Mihomo provider 使用，完整保留过滤、健康检查和处理模式。</small></div></div>
          {providers.length === 0 ? <EmptyState icon={<Server size={23} />} title="暂无 Proxy Provider" description="先添加外部订阅，再创建一个可复用的 provider 配置。" action={<Button onClick={() => setEditingProvider("new")}><Plus size={16} />创建 Provider</Button>} /> : (
            <div className="table-wrap"><table><thead><tr><th>Provider</th><th>来源 / 模式</th><th>健康检查</th><th>过滤</th><th aria-label="操作" /></tr></thead><tbody>{providers.map((item) => {
              const source = external.find((entry) => entry.id === item.external_subscription_id);
              return <tr key={item.id}><td><div className="cw-file-name"><span className="cw-file-icon"><Server size={16} /></span><span><strong>{item.name}</strong><small>{item.type || "http"} · {item.interval || 0} 秒</small></span></div></td><td><strong>{source?.name || `外部订阅 #${item.external_subscription_id}`}</strong><span className="cw-table-note">{item.process_mode === "mmw" ? "服务端处理" : "客户端 Provider"}</span></td><td><Badge tone={item.health_check_enabled ? "good" : "neutral"}>{item.health_check_enabled ? "已启用" : "未启用"}</Badge><span className="cw-table-note">{item.health_check_enabled ? `${item.health_check_interval || 0}s · HTTP ${item.health_check_expected_status || 204}` : "-"}</span></td><td><strong>{item.filter || "全部节点"}</strong><span className="cw-table-note">{item.exclude_filter ? `排除 ${item.exclude_filter}` : item.geo_ip_filter ? `GeoIP ${item.geo_ip_filter}` : "无排除条件"}</span></td><td><div className="cw-table-actions"><IconButton label={`编辑 Provider ${item.name}`} onClick={() => setEditingProvider(item)}><Pencil size={16} /></IconButton><IconButton label={`删除 Provider ${item.name}`} onClick={() => setPending({ kind: "delete-provider", item })}><Trash2 size={16} /></IconButton></div></td></tr>;
            })}</tbody></table></div>
          )}
        </Surface>
      )}
      {showImport ? <ImportSubscriptionDialog nodes={nodes} templates={templates} rules={rules} scripts={scripts} servers={servers} onClose={() => setShowImport(false)} onComplete={async () => { setShowImport(false); notify("订阅已添加"); await load(); }} /> : null}
      {editingFile ? <EditSubscribeFileDialog item={editingFile} nodes={nodes} templates={templates} rules={rules} scripts={scripts} servers={servers} onClose={() => setEditingFile(null)} onComplete={async () => { setEditingFile(null); notify("订阅信息已更新"); await load(); }} /> : null}
      {editingContent ? <EditSubscribeContentDialog item={editingContent} onClose={() => setEditingContent(null)} onComplete={async () => { setEditingContent(null); notify("订阅内容已保存"); await load(); }} /> : null}
      {editingExternal ? <ExternalSubscriptionDialog item={editingExternal === "new" ? undefined : editingExternal} onClose={() => setEditingExternal(null)} onComplete={async () => { setEditingExternal(null); notify(editingExternal === "new" ? "外部订阅已添加" : "外部订阅已更新"); await load(); }} /> : null}
      {editingProvider ? <ProxyProviderDialog item={editingProvider === "new" ? undefined : editingProvider} subscriptions={external} onClose={() => setEditingProvider(null)} onComplete={async () => { setEditingProvider(null); notify(editingProvider === "new" ? "Proxy Provider 已创建" : "Proxy Provider 已更新"); await load(); }} /> : null}
      {pending ? <ConfirmDialog title={pending.kind === "delete-file" ? "删除订阅文件" : pending.kind === "delete-external" ? "删除外部订阅" : "删除 Proxy Provider"} description={pending.kind === "delete-file" ? `将永久删除“${pending.item.name}”及其 YAML 文件，已分配链接会立即失效。` : pending.kind === "delete-external" ? `将删除“${pending.item.name}”的同步源；已经保存的节点不会自动删除。` : `将删除“${pending.item.name}”的 Provider 配置；引用它的模板需要同步调整。`} confirmLabel="确认删除" working={working} onCancel={() => setPending(null)} onConfirm={() => void confirmPending()} /> : null}
    </section>
  );
}

function ImportSubscriptionDialog({ nodes, templates, rules, scripts, servers, onClose, onComplete }: {
  nodes: NodeItem[];
  templates: string[];
  rules: CustomRuleOption[];
  scripts: OverrideScriptOption[];
  servers: RemoteServerItem[];
  onClose: () => void;
  onComplete: () => void;
}) {
  const [mode, setMode] = useState<"url" | "upload">("url");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setURL] = useState("");
  const [filename, setFilename] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [templateFilename, setTemplateFilename] = useState("");
  const [selectedNodeIDs, setSelectedNodeIDs] = useState<Set<number>>(new Set());
  const [selectedRuleIDs, setSelectedRuleIDs] = useState<Set<number>>(new Set());
  const [selectedScriptIDs, setSelectedScriptIDs] = useState<Set<number>>(new Set());
  const [selectedServerIDs, setSelectedServerIDs] = useState<Set<number>>(new Set());
  const [trafficLimit, setTrafficLimit] = useState("");
  const [autoSync, setAutoSync] = useState(false);
  const [rawOutput, setRawOutput] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      let result: { file?: SubscribeFile };
      if (mode === "url") {
        result = await api.post<{ file?: SubscribeFile }>("/api/admin/subscribe-files/import", { name, description, url, filename: filename ? normalizedFilename(filename) : "" });
      } else {
        if (!file) throw new Error("请选择 YAML 文件");
        const form = new FormData(); form.set("file", file); form.set("name", name || file.name.replace(/\.ya?ml$/i, "")); form.set("description", description); if (filename) form.set("filename", normalizedFilename(filename));
        result = await request<{ file?: SubscribeFile }>("/api/admin/subscribe-files/upload", { method: "POST", body: form });
      }
      if (!result.file?.id) throw new Error("订阅已导入，但后端没有返回可继续配置的文件 ID");
      const limit = trafficLimit.trim() ? Number(trafficLimit) : null;
      if (limit != null && (!Number.isFinite(limit) || limit < 0)) throw new Error("流量上限必须是大于等于 0 的 GB 数值");
      if (advanced) {
        await api.put(`/api/admin/subscribe-files/${result.file.id}`, subscribeFilePayload(result.file, {
          template_filename: templateFilename,
          selected_node_ids: [...selectedNodeIDs],
          selected_custom_rule_ids: [...selectedRuleIDs],
          selected_override_script_ids: [...selectedScriptIDs],
          stats_server_ids: [...selectedServerIDs].join(","),
          traffic_limit: limit,
          auto_sync_custom_rules: autoSync,
          raw_output: rawOutput,
        }));
      }
      onComplete();
    } catch (reason) { setError(fail(reason, "添加订阅失败")); }
    finally { setWorking(false); }
  };
  const toggle = (setter: Dispatch<SetStateAction<Set<number>>>, id: number) => setter((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return <Dialog title="添加订阅" description="从 Clash 订阅链接导入或上传本地 YAML 文件" onClose={onClose} wide><form className="cw-form" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<div className="cw-mode"><button type="button" className={mode === "url" ? "is-active" : ""} onClick={() => setMode("url")}><Link2 size={16} />链接导入</button><button type="button" className={mode === "upload" ? "is-active" : ""} onClick={() => setMode("upload")}><Upload size={16} />本地文件</button></div><div className="cw-form-grid"><Field label="订阅名称"><input required={mode === "url"} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：机场订阅" /></Field><Field label="文件名" hint="留空时自动生成"><input value={filename} onChange={(event) => setFilename(event.target.value)} placeholder="subscription.yaml" /></Field></div>{mode === "url" ? <Field label="订阅 URL"><input required type="url" value={url} onChange={(event) => setURL(event.target.value)} placeholder="https://example.com/subscribe" /></Field> : <Field label="YAML 文件"><input required type="file" accept=".yaml,.yml,application/yaml,text/yaml" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></Field>}<Field label="说明"><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="可选" /></Field><Button type="button" variant="ghost" onClick={() => setAdvanced((value) => !value)}><Settings2 size={16} />{advanced ? "收起高级设置" : "配置模板、节点与覆写范围"}</Button>{advanced ? <>
    <div className="cw-form-grid"><Field label="V3 模板"><select value={templateFilename} onChange={(event) => setTemplateFilename(event.target.value)}><option value="">不绑定模板</option>{templates.map((template) => <option value={template} key={template}>{template}</option>)}</select></Field><Field label="手动流量上限（GB）"><input type="number" min="0" step="0.1" value={trafficLimit} onChange={(event) => setTrafficLimit(event.target.value)} placeholder="留空跟随服务器" /></Field></div>
    <div className="cw-checkboxes"><Toggle checked={autoSync} onChange={setAutoSync} label="自动同步自定义规则" /><Toggle checked={rawOutput} onChange={setRawOutput} label="输出原始配置" /></div>
    <div className="cw-form-section"><strong>节点范围</strong><div className="cw-option-grid">{nodes.map((node) => <label className="cw-option-check" key={node.id}><input type="checkbox" checked={selectedNodeIDs.has(node.id)} onChange={() => toggle(setSelectedNodeIDs, node.id)} /><span><strong>{node.node_name}</strong><small>{node.protocol || "未知协议"}</small></span></label>)}</div></div>
    <div className="cw-form-grid"><div className="cw-form-section"><strong>指定覆写规则</strong><p className="cw-section-hint">不选表示全部已启用规则。</p><div className="cw-option-stack">{rules.map((rule) => <label className="cw-option-check" key={rule.id}><input type="checkbox" checked={selectedRuleIDs.has(rule.id)} onChange={() => toggle(setSelectedRuleIDs, rule.id)} /><span><strong>{rule.name}</strong><small>{rule.type}</small></span></label>)}</div></div><div className="cw-form-section"><strong>指定覆写脚本</strong><p className="cw-section-hint">不选表示全部已启用脚本。</p><div className="cw-option-stack">{scripts.map((script) => <label className="cw-option-check" key={script.id}><input type="checkbox" checked={selectedScriptIDs.has(script.id)} onChange={() => toggle(setSelectedScriptIDs, script.id)} /><span><strong>{script.name}</strong><small>{script.hook}</small></span></label>)}</div></div></div>
    <div className="cw-form-section"><strong>流量统计服务器</strong><p className="cw-section-hint">不选表示汇总全部服务器。</p><div className="cw-option-grid">{servers.map((server) => <label className="cw-option-check" key={server.id}><input type="checkbox" checked={selectedServerIDs.has(server.id)} onChange={() => toggle(setSelectedServerIDs, server.id)} /><span><strong>{server.name}</strong><small>服务器 #{server.id}</small></span></label>)}</div></div>
    <div className="cw-help"><Info size={16} /><span>高级设置在导入成功后通过返回的文件 ID 立即写入；若后端不返回 ID，前端会明确报错而不是假装保存成功。</span></div>
  </> : null}<div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在导入" /> : "添加"}</Button></div></form></Dialog>;
}

function EditSubscribeFileDialog({ item, nodes, templates, rules, scripts, servers, onClose, onComplete }: {
  item: SubscribeFile;
  nodes: NodeItem[];
  templates: string[];
  rules: CustomRuleOption[];
  scripts: OverrideScriptOption[];
  servers: RemoteServerItem[];
  onClose: () => void;
  onComplete: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description || "");
  const [filename, setFilename] = useState(item.filename);
  const [shortCode, setShortCode] = useState(item.custom_short_code || "");
  const [rawOutput, setRawOutput] = useState(Boolean(item.raw_output));
  const [autoSync, setAutoSync] = useState(item.auto_sync_custom_rules);
  const [templateFilename, setTemplateFilename] = useState(item.template_filename || "");
  const [selectedNodeIDs, setSelectedNodeIDs] = useState(() => new Set(item.selected_node_ids ?? []));
  const [selectedTags, setSelectedTags] = useState((item.selected_tags ?? []).join(", "));
  const [ruleScope, setRuleScope] = useState<"all" | "selected">((item.selected_custom_rule_ids?.length ?? 0) > 0 ? "selected" : "all");
  const [selectedRuleIDs, setSelectedRuleIDs] = useState(() => new Set(item.selected_custom_rule_ids ?? []));
  const [scriptScope, setScriptScope] = useState<"all" | "selected">((item.selected_override_script_ids?.length ?? 0) > 0 ? "selected" : "all");
  const [selectedScriptIDs, setSelectedScriptIDs] = useState(() => new Set(item.selected_override_script_ids ?? []));
  const [selectedServerIDs, setSelectedServerIDs] = useState(() => new Set((item.stats_server_ids || "").split(",").map(Number).filter((id) => id > 0)));
  const [trafficLimit, setTrafficLimit] = useState(item.traffic_limit == null ? "" : String(item.traffic_limit));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const toggleID = (setter: Dispatch<SetStateAction<Set<number>>>, id: number) => setter((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      if (ruleScope === "selected" && selectedRuleIDs.size === 0) throw new Error("请至少选择一条覆写规则，或改为全部已启用规则");
      if (scriptScope === "selected" && selectedScriptIDs.size === 0) throw new Error("请至少选择一个覆写脚本，或改为全部已启用脚本");
      const limit = trafficLimit.trim() === "" ? null : Number(trafficLimit);
      if (limit != null && (!Number.isFinite(limit) || limit < 0)) throw new Error("流量上限必须是大于等于 0 的 GB 数值");
      await api.put(`/api/admin/subscribe-files/${item.id}`, subscribeFilePayload(item, {
        name,
        description,
        filename: normalizedFilename(filename),
        custom_short_code: shortCode,
        raw_output: rawOutput,
        auto_sync_custom_rules: autoSync,
        template_filename: templateFilename,
        selected_node_ids: [...selectedNodeIDs],
        selected_tags: selectedTags.split(",").map((tag) => tag.trim()).filter(Boolean),
        selected_custom_rule_ids: ruleScope === "all" ? [] : [...selectedRuleIDs],
        selected_override_script_ids: scriptScope === "all" ? [] : [...selectedScriptIDs],
        stats_server_ids: [...selectedServerIDs].join(","),
        traffic_limit: limit,
      }));
      onComplete();
    } catch (reason) { setError(fail(reason, "更新订阅失败")); }
    finally { setWorking(false); }
  };
  return <Dialog title="编辑订阅" description={item.filename} onClose={onClose} wide><form className="cw-form" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}
    <div className="cw-form-grid"><Field label="订阅名称"><input required value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="文件名"><input required value={filename} onChange={(event) => setFilename(event.target.value)} /></Field></div>
    <Field label="说明"><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
    <div className="cw-form-grid"><Field label="自定义短码" hint="留空使用系统短码；普通用户不能修改全局短码"><input value={shortCode} onChange={(event) => setShortCode(event.target.value)} /></Field><Field label="V3 模板"><select value={templateFilename} onChange={(event) => setTemplateFilename(event.target.value)}><option value="">不绑定模板</option>{templates.map((template) => <option value={template} key={template}>{template}</option>)}</select></Field></div>
    <div className="cw-checkboxes"><Toggle checked={autoSync} onChange={setAutoSync} label="自动同步自定义规则" /><Toggle checked={rawOutput} onChange={setRawOutput} label="输出原始配置" /></div>
    <div className="cw-form-section"><strong>节点范围</strong><p className="cw-section-hint">选择节点 ID 时优先使用该范围；不选节点时才按下方标签过滤，两者都为空表示全部可用节点。</p><div className="cw-option-grid">{nodes.map((node) => <label className="cw-option-check" key={node.id}><input type="checkbox" checked={selectedNodeIDs.has(node.id)} onChange={() => toggleID(setSelectedNodeIDs, node.id)} /><span><strong>{node.node_name}</strong><small>{node.protocol || "未知协议"}{node.enabled ? "" : " · 已停用"}</small></span></label>)}</div><Field label="旧版标签范围" hint="逗号分隔；仅在未选择节点 ID 时生效"><input value={selectedTags} onChange={(event) => setSelectedTags(event.target.value)} placeholder="hk, premium" /></Field></div>
    <div className="cw-form-grid">
      <div className="cw-form-section"><strong>覆写规则</strong><Field label="应用范围"><select value={ruleScope} onChange={(event) => setRuleScope(event.target.value as "all" | "selected")}><option value="all">全部已启用规则（空 ID 数组）</option><option value="selected">仅选择的规则</option></select></Field>{ruleScope === "selected" ? <div className="cw-option-stack">{rules.map((rule) => <label className="cw-option-check" key={rule.id}><input type="checkbox" checked={selectedRuleIDs.has(rule.id)} onChange={() => toggleID(setSelectedRuleIDs, rule.id)} /><span><strong>{rule.name}</strong><small>{rule.type}{rule.enabled ? "" : " · 已停用"}</small></span></label>)}</div> : null}</div>
      <div className="cw-form-section"><strong>覆写脚本</strong><Field label="应用范围"><select value={scriptScope} onChange={(event) => setScriptScope(event.target.value as "all" | "selected")}><option value="all">全部已启用脚本（空 ID 数组）</option><option value="selected">仅选择的脚本</option></select></Field>{scriptScope === "selected" ? <div className="cw-option-stack">{scripts.map((script) => <label className="cw-option-check" key={script.id}><input type="checkbox" checked={selectedScriptIDs.has(script.id)} onChange={() => toggleID(setSelectedScriptIDs, script.id)} /><span><strong>{script.name}</strong><small>{script.hook}{script.enabled ? "" : " · 已停用"}</small></span></label>)}</div> : null}</div>
    </div>
    <div className="cw-form-section"><strong>流量统计</strong><p className="cw-section-hint">不选服务器时汇总全部服务器；手动上限按后端契约使用 GB，留空表示跟随服务器或用户套餐。</p><div className="cw-option-grid">{servers.map((server) => <label className="cw-option-check" key={server.id}><input type="checkbox" checked={selectedServerIDs.has(server.id)} onChange={() => toggleID(setSelectedServerIDs, server.id)} /><span><strong>{server.name}</strong><small>服务器 #{server.id}</small></span></label>)}</div><Field label="手动流量上限（GB）"><input type="number" min="0" step="0.1" value={trafficLimit} onChange={(event) => setTrafficLimit(event.target.value)} placeholder="留空跟随统计范围" /></Field></div>
    <div className="cw-help"><Info size={16} /><span>数据库存在历史 expire_at 列，但当前后端 SubscribeFile DTO 与保存请求没有映射该字段，因此这里不会展示一个无法生效的“过期时间”。</span></div>
    <div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在保存" /> : "保存"}</Button></div>
  </form></Dialog>;
}

function EditSubscribeContentDialog({ item, onClose, onComplete }: { item: SubscribeFile; onClose: () => void; onComplete: () => void }) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void api.get<{ content?: string }>(`/api/admin/subscribe-files/${encodeURIComponent(item.filename)}/content`).then((payload) => setContent(payload.content || "")).catch((reason) => setError(fail(reason, "读取订阅内容失败"))).finally(() => setLoading(false)); }, [item.filename]);
  const save = async () => {
    setWorking(true); setError("");
    try { await api.put(`/api/admin/subscribe-files/${encodeURIComponent(item.filename)}/content`, { content }); onComplete(); }
    catch (reason) { setError(fail(reason, "保存订阅内容失败")); }
    finally { setWorking(false); }
  };
  return <Dialog title="编辑订阅配置" description="保存时会校验 YAML，并创建可回溯版本" onClose={onClose} wide>{error ? <ErrorState message={error} /> : null}{loading ? <div className="cw-loading"><Spinner /></div> : <Field label={item.filename}><textarea className="cw-dialog-code" value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} /></Field>}<div className="dialog-actions"><Button variant="secondary" onClick={onClose}>取消</Button><Button onClick={() => void save()} disabled={working || loading || !content.trim()}>{working ? <Spinner label="正在校验并保存" /> : "保存配置"}</Button></div></Dialog>;
}

function ExternalSubscriptionDialog({ item, onClose, onComplete }: { item?: ExternalSubscription; onClose: () => void; onComplete: () => void }) {
  const [name, setName] = useState(item?.name || "");
  const [url, setURL] = useState(item?.url || "");
  const [userAgent, setUserAgent] = useState(item?.user_agent || "clash-meta/2.4.0");
  const [trafficMode, setTrafficMode] = useState(item?.traffic_mode || "both");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      const payload = { name, url, user_agent: userAgent, traffic_mode: trafficMode };
      if (item) await api.put(`/api/user/external-subscriptions?id=${item.id}`, payload); else await api.post("/api/user/external-subscriptions", payload);
      onComplete();
    } catch (reason) { setError(fail(reason, item ? "更新外部订阅失败" : "添加外部订阅失败")); }
    finally { setWorking(false); }
  };
  return <Dialog title={item ? "编辑外部订阅" : "添加外部订阅"} description="同步操作会按当前用户的节点匹配与过滤设置更新节点" onClose={onClose}><form className="cw-form" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<Field label="名称"><input required value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="订阅 URL"><input required type="url" value={url} onChange={(event) => setURL(event.target.value)} /></Field><Field label="User-Agent"><input value={userAgent} onChange={(event) => setUserAgent(event.target.value)} /></Field><Field label="流量统计口径"><select value={trafficMode} onChange={(event) => setTrafficMode(event.target.value as "download" | "upload" | "both")}><option value="both">上传 + 下载</option><option value="download">仅下载</option><option value="upload">仅上传</option></select></Field><div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在保存" /> : "保存"}</Button></div></form></Dialog>;
}

function ProxyProviderDialog({ item, subscriptions, onClose, onComplete }: { item?: ProxyProviderConfig; subscriptions: ExternalSubscription[]; onClose: () => void; onComplete: () => void }) {
  const [name, setName] = useState(item?.name || "");
  const [subscriptionID, setSubscriptionID] = useState(item?.external_subscription_id || subscriptions[0]?.id || 0);
  const [type, setType] = useState(item?.type || "http");
  const [interval, setInterval] = useState(item?.interval || 3600);
  const [processMode, setProcessMode] = useState(item?.process_mode || "client");
  const [proxy, setProxy] = useState(item?.proxy || "");
  const [sizeLimit, setSizeLimit] = useState(item?.size_limit || 0);
  const [header, setHeader] = useState(item?.header || "");
  const [healthEnabled, setHealthEnabled] = useState(item?.health_check_enabled ?? true);
  const [healthURL, setHealthURL] = useState(item?.health_check_url || "https://cp.cloudflare.com/generate_204");
  const [healthInterval, setHealthInterval] = useState(item?.health_check_interval || 300);
  const [healthTimeout, setHealthTimeout] = useState(item?.health_check_timeout || 5000);
  const [healthLazy, setHealthLazy] = useState(item?.health_check_lazy ?? true);
  const [expectedStatus, setExpectedStatus] = useState(item?.health_check_expected_status || 204);
  const [filter, setFilter] = useState(item?.filter || "");
  const [excludeFilter, setExcludeFilter] = useState(item?.exclude_filter || "");
  const [excludeType, setExcludeType] = useState(item?.exclude_type || "");
  const [geoIPFilter, setGeoIPFilter] = useState(item?.geo_ip_filter || "");
  const [override, setOverride] = useState(item?.override || "");
  const [advanced, setAdvanced] = useState(false);
  const [filterResult, setFilterResult] = useState("");
  const [working, setWorking] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const payload = () => ({
    external_subscription_id: subscriptionID,
    name: name.trim(),
    type,
    interval,
    proxy: proxy.trim(),
    size_limit: sizeLimit,
    header,
    health_check_enabled: healthEnabled,
    health_check_url: healthURL.trim(),
    health_check_interval: healthInterval,
    health_check_timeout: healthTimeout,
    health_check_lazy: healthLazy,
    health_check_expected_status: expectedStatus,
    filter: filter.trim(),
    exclude_filter: excludeFilter.trim(),
    exclude_type: excludeType.trim(),
    geo_ip_filter: geoIPFilter.trim(),
    override,
    process_mode: processMode,
  });

  const checkFilter = async () => {
    if (!subscriptionID) { setError("请先选择外部订阅"); return; }
    setChecking(true); setError(""); setFilterResult("");
    try {
      const result = await api.post<{ has_matches?: boolean; match_count?: number }>("/api/user/external-subscriptions/check-filter", {
        subscription_id: subscriptionID,
        filter: filter.trim(),
        exclude_filter: excludeFilter.trim(),
        geo_ip_filter: geoIPFilter.trim(),
      });
      setFilterResult(result.has_matches ? `匹配 ${result.match_count ?? 0} 个节点` : "没有匹配节点");
    } catch (reason) { setError(fail(reason, "过滤条件校验失败")); }
    finally { setChecking(false); }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      if (!subscriptionID) throw new Error("请选择外部订阅");
      if (interval < 1) throw new Error("更新间隔必须大于 0");
      if (healthEnabled && !healthURL.trim()) throw new Error("启用健康检查时必须填写检测 URL");
      if (item) await api.put(`/api/user/proxy-provider-configs?id=${item.id}`, payload());
      else await api.post("/api/user/proxy-provider-configs", payload());
      onComplete();
    } catch (reason) { setError(fail(reason, item ? "更新 Proxy Provider 失败" : "创建 Proxy Provider 失败")); }
    finally { setWorking(false); }
  };

  return <Dialog title={item ? "编辑 Proxy Provider" : "创建 Proxy Provider"} description="字段与后端 ProxyProviderConfigDTO 一一对应" onClose={onClose} wide><form className="cw-form" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}
    {subscriptions.length === 0 ? <ErrorState message="尚无外部订阅，必须先在“外部订阅”页添加来源。" /> : null}
    <div className="cw-form-grid"><Field label="Provider 名称"><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="airport-hk" /></Field><Field label="外部订阅"><select required value={subscriptionID} onChange={(event) => setSubscriptionID(Number(event.target.value))}><option value={0}>请选择</option>{subscriptions.map((subscription) => <option value={subscription.id} key={subscription.id}>{subscription.name}</option>)}</select></Field><Field label="Provider 类型"><select value={type} onChange={(event) => setType(event.target.value)}><option value="http">HTTP</option><option value="file">File</option><option value="inline">Inline</option></select></Field><Field label="处理模式"><select value={processMode} onChange={(event) => setProcessMode(event.target.value)}><option value="client">客户端 Provider</option><option value="mmw">服务端处理</option></select></Field><Field label="更新间隔（秒）"><input type="number" min="1" value={interval} onChange={(event) => setInterval(Number(event.target.value))} /></Field><Field label="拉取代理" hint="可填代理组名称或 DIRECT"><input value={proxy} onChange={(event) => setProxy(event.target.value)} placeholder="DIRECT" /></Field></div>
    <div className="cw-form-section"><strong>健康检查</strong><Toggle checked={healthEnabled} onChange={setHealthEnabled} label="启用 Provider 健康检查" />{healthEnabled ? <><Field label="检测 URL"><input required type="url" value={healthURL} onChange={(event) => setHealthURL(event.target.value)} /></Field><div className="cw-form-grid"><Field label="检查间隔（秒）"><input type="number" min="1" value={healthInterval} onChange={(event) => setHealthInterval(Number(event.target.value))} /></Field><Field label="超时（毫秒）"><input type="number" min="1" value={healthTimeout} onChange={(event) => setHealthTimeout(Number(event.target.value))} /></Field><Field label="预期 HTTP 状态"><input type="number" min="100" max="599" value={expectedStatus} onChange={(event) => setExpectedStatus(Number(event.target.value))} /></Field><div className="cw-toggle-field"><Toggle checked={healthLazy} onChange={setHealthLazy} label="Lazy 检测" /></div></div></> : null}</div>
    <div className="cw-form-section"><strong>节点过滤</strong><div className="cw-form-grid"><Field label="包含名称（正则）"><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="香港|HK" /></Field><Field label="排除名称（正则）"><input value={excludeFilter} onChange={(event) => setExcludeFilter(event.target.value)} placeholder="测试|到期" /></Field><Field label="排除协议类型"><input value={excludeType} onChange={(event) => setExcludeType(event.target.value)} placeholder="ss|vmess" /></Field><Field label="GeoIP 国家代码"><input value={geoIPFilter} onChange={(event) => setGeoIPFilter(event.target.value)} placeholder="HK,JP,SG" /></Field></div><div className="cw-toolbar"><Button type="button" variant="secondary" onClick={() => void checkFilter()} disabled={checking || !subscriptionID}>{checking ? <Spinner label="正在检查" /> : "检查匹配"}</Button>{filterResult ? <Badge tone={filterResult.startsWith("匹配") ? "good" : "warn"}>{filterResult}</Badge> : null}</div></div>
    <Button type="button" variant="ghost" onClick={() => setAdvanced((value) => !value)}><Settings2 size={16} />{advanced ? "收起高级字段" : "展开高级字段"}</Button>
    {advanced ? <div className="cw-form-section"><strong>高级原始字段</strong><div className="cw-form-grid"><Field label="内容大小上限"><input type="number" min="0" value={sizeLimit} onChange={(event) => setSizeLimit(Number(event.target.value))} /></Field><Field label="请求头原文" hint="后端当前按字符串原样保存"><textarea value={header} onChange={(event) => setHeader(event.target.value)} placeholder={'{"User-Agent":"mihomo"}'} /></Field></div><Field label="Override 原文" hint="后端 DTO 仅提供一个原始字符串字段，不把接口、mark、前后缀或节点替换拆成可验证字段"><textarea className="cw-dialog-code cw-dialog-code-short" value={override} onChange={(event) => setOverride(event.target.value)} spellCheck={false} /></Field><div className="cw-help"><Info size={16} /><span>当前后端没有独立的 interface-name、routing-mark、节点前后缀、替换或链式字段，也没有应用这些字段的 handler；前端不会生成看似可配置但实际不生效的控件。</span></div></div> : null}
    <div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working || subscriptions.length === 0}>{working ? <Spinner label="正在保存" /> : "保存 Provider"}</Button></div>
  </form></Dialog>;
}

export function TemplatesWorkbenchPage({ notify = noNotify }: ContentPageProps) {
  const [templates, setTemplates] = useState<string[]>([]);
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [username, setUsername] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showVisual, setShowVisual] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [defaultTemplate, setDefaultTemplate] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const payload = await api.get<RuleTemplateList>("/api/admin/rule-templates");
      setTemplates([...(payload.templates ?? [])].sort((a, b) => a.localeCompare(b, "zh-CN")));
      setOwners(payload.owners ?? {});
      setUsername(payload.username ?? "");
      setIsAdmin(Boolean(payload.is_admin));
      if (payload.is_admin) {
        const current = await api.get<{ default_template_filename?: string }>("/api/admin/system-settings/default-template")
          .catch(() => ({ default_template_filename: "" }));
        setDefaultTemplate(current.default_template_filename ?? "");
      } else {
        setDefaultTemplate("");
      }
    } catch (reason) { setError(fail(reason, "加载模板失败")); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const canModify = (filename: string) => isAdmin || Boolean(username && owners[filename] === username);

  const makeDefault = async (filename: string) => {
    setWorking(true); setError("");
    try {
      await api.put("/api/admin/system-settings/default-template", { default_template_filename: filename });
      setDefaultTemplate(filename);
      notify(`已将 ${filename} 设为默认模板`);
    } catch (reason) { setError(fail(reason, "默认模板设置失败")); }
    finally { setWorking(false); }
  };

  const remove = async () => {
    if (!deleting) return;
    if (deleting === defaultTemplate) {
      setDeleting(null);
      setError("默认模板不能删除，请先将其他模板设为默认");
      return;
    }
    setWorking(true); setError("");
    try {
      await api.delete(`/api/admin/rule-templates/${encodeURIComponent(deleting)}`);
      notify("模板已删除"); setDeleting(null); await load();
    } catch (reason) { setError(fail(reason, "删除模板失败")); }
    finally { setWorking(false); }
  };

  return (
    <section className="cw-page">
      <Surface className="table-surface cw-compact-table cw-template-panel">
        <div className="surface-heading">
          <div><h2>模板管理</h2><small>管理 V3 规则模板，支持结构化设计、导入、转换、预览和 YAML 编辑</small></div>
          <div className="page-actions"><IconButton label="刷新模板" onClick={() => void load()}><RefreshCw size={18} /></IconButton><Button variant="secondary" onClick={() => setShowVisual(true)}><WandSparkles size={16} />可视化设计</Button><Button onClick={() => setShowCreate(true)}><Plus size={16} />新建模板</Button></div>
        </div>
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        {loading ? <div className="cw-loading"><Spinner /></div> : templates.length === 0 ? (
          <EmptyState icon={<FileCode2 size={24} />} title="暂无模板" description="上传 YAML、粘贴内容或从订阅生成模板。" action={<Button onClick={() => setShowCreate(true)}><Plus size={16} />新建模板</Button>} />
        ) : (
          <div className="table-wrap cw-template-table"><table><thead><tr><th>模板名称</th><th>归属 / 状态</th><th>操作</th></tr></thead><tbody>{templates.map((filename) => {
            const owner = owners[filename];
            const isDefault = defaultTemplate === filename;
            return <tr key={filename}><td><div className="cw-file-name"><span className="cw-file-icon"><FileCode2 size={17} /></span><span><strong>{filename}</strong><small>{filename.replace(/\.ya?ml$/i, "").replaceAll("_", " ")}</small></span></div></td><td>{isDefault ? <Badge tone="good">默认模板</Badge> : owner ? <Badge tone={owner === username ? "info" : "neutral"}>{owner === username ? "我的模板" : owner}</Badge> : <Badge>内置模板</Badge>}</td><td><div className="cw-table-actions">{isAdmin ? <IconButton label={isDefault ? "默认模板" : `将 ${filename} 设为默认模板`} disabled={working || isDefault} onClick={() => void makeDefault(filename)}>{isDefault ? <Check size={16} /> : <Star size={16} />}</IconButton> : null}<IconButton label="预览" title={`预览 ${filename}`} onClick={() => setPreviewing(filename)}><Sparkles size={16} /></IconButton>{canModify(filename) ? <><IconButton label={`编辑 ${filename}`} onClick={() => setEditing(filename)}><Pencil size={16} /></IconButton><IconButton label={`删除 ${filename}`} disabled={working || isDefault} onClick={() => setDeleting(filename)}><Trash2 size={16} /></IconButton></> : null}</div></td></tr>;
          })}</tbody></table></div>
        )}
      </Surface>
      {showCreate ? <CreateTemplateDialog onClose={() => setShowCreate(false)} onComplete={async () => { setShowCreate(false); notify("模板已创建"); await load(); }} /> : null}
      {showVisual ? <VisualTemplateDialog onClose={() => setShowVisual(false)} onComplete={async () => { setShowVisual(false); notify("可视化模板已保存"); await load(); }} /> : null}
      {previewing ? <TemplatePreviewDialog filename={previewing} onClose={() => setPreviewing(null)} /> : null}
      {editing ? <EditTemplateDialog filename={editing} onClose={() => setEditing(null)} onComplete={async () => { setEditing(null); notify("模板已保存"); await load(); }} /> : null}
      {deleting ? <ConfirmDialog title="删除模板" description={`将永久删除“${deleting}”。引用该模板的套餐和订阅需要重新选择模板。`} confirmLabel="确认删除" working={working} onCancel={() => setDeleting(null)} onConfirm={() => void remove()} /> : null}
    </section>
  );
}

function VisualTemplateDialog({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const storageKey = "arcway:visual-template-draft:v1";
  const restoredRef = useRef(false);
  const [draft, setDraft] = useState<VisualTemplateDraft>(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (isVisualDraft(parsed)) { restoredRef.current = true; return parsed; }
      }
    } catch { /* localStorage may be unavailable in private contexts */ }
    return defaultVisualDraft();
  });
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [providers, setProviders] = useState<ProxyProviderConfig[]>([]);
  const [regions, setRegions] = useState<{ name: string; filter: string }[]>([]);
  const [region, setRegion] = useState("");
  const [tab, setTab] = useState<"design" | "yaml" | "json">("design");
  const [working, setWorking] = useState(false);
  const [loadWarning, setLoadWarning] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const loadOptions = async () => {
      const results = await Promise.allSettled([
        api.get<{ nodes?: NodeItem[] }>("/api/admin/nodes"),
        api.get<ProxyProviderConfig[]>("/api/user/proxy-provider-configs"),
        api.get<{ region_filters?: unknown }>("/api/admin/template-v3/region-filters"),
      ]);
      if (results[0].status === "fulfilled") setNodes(results[0].value.nodes ?? []);
      if (results[1].status === "fulfilled") setProviders(Array.isArray(results[1].value) ? results[1].value : []);
      if (results[2].status === "fulfilled") {
        const raw = results[2].value.region_filters;
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          setRegions(Object.entries(raw as Record<string, unknown>).flatMap(([name, value]) => typeof value === "string" ? [{ name, filter: value }] : []));
        } else if (Array.isArray(raw)) {
          setRegions(raw.flatMap((value, index) => {
            if (typeof value === "string") return [{ name: value, filter: value }];
            if (!value || typeof value !== "object") return [];
            const entry = value as Record<string, unknown>;
            const filter = entry.filter;
            if (typeof filter !== "string") return [];
            return [{ name: typeof entry.name === "string" ? entry.name : `地区 ${index + 1}`, filter }];
          }));
        }
      }
      const failures = results.filter((result) => result.status === "rejected").length;
      if (failures) setLoadWarning(`${failures} 项节点 / Provider / 地区预设数据加载失败，仍可使用占位来源手动设计。`);
    };
    void loadOptions();
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(draft)); } catch { /* best effort */ }
  }, [draft]);

  const outputObject = useMemo(() => visualTemplateObject(draft), [draft]);
  const yaml = useMemo(() => `${structuredYAML(outputObject)}\n`, [outputObject]);
  const json = useMemo(() => `${JSON.stringify(outputObject, null, 2)}\n`, [outputObject]);
  const updateGroup = (id: string, patch: Partial<VisualProxyGroup>) => setDraft((current) => ({ ...current, groups: current.groups.map((group) => group.id === id ? { ...group, ...patch } : group) }));
  const moveGroup = (index: number, direction: -1 | 1) => setDraft((current) => {
    const target = index + direction;
    if (target < 0 || target >= current.groups.length) return current;
    const groups = [...current.groups];
    [groups[index], groups[target]] = [groups[target], groups[index]];
    return { ...current, groups };
  });
  const addSource = (group: VisualProxyGroup, raw: string) => {
    if (!raw) return;
    try {
      const source = JSON.parse(raw) as Pick<VisualSource, "kind" | "value">;
      if (!source.value || group.sources.some((item) => item.kind === source.kind && item.value === source.value)) return;
      updateGroup(group.id, { sources: [...group.sources, { ...source, id: localID("source") }] });
    } catch { setError("无法识别代理来源"); }
  };
  const moveSource = (group: VisualProxyGroup, index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= group.sources.length) return;
    const sources = [...group.sources];
    [sources[index], sources[target]] = [sources[target], sources[index]];
    updateGroup(group.id, { sources });
  };
  const addRegionGroup = () => {
    const preset = regions.find((item) => item.name === region);
    if (!preset) return;
    setDraft((current) => ({ ...current, groups: [...current.groups, { ...defaultVisualGroup(), name: preset.name, filter: preset.filter }] }));
    setRegion("");
  };
  const clearDraft = () => {
    try { window.localStorage.removeItem(storageKey); } catch { /* best effort */ }
    setDraft(defaultVisualDraft());
    restoredRef.current = false;
  };
  const save = async () => {
    setWorking(true); setError("");
    try {
      const names = draft.groups.map((group) => group.name.trim());
      if (names.some((name) => !name)) throw new Error("代理组名称不能为空");
      if (new Set(names).size !== names.length) throw new Error("代理组名称不能重复");
      for (const group of draft.groups) {
        if (group.sources.length === 0) throw new Error(`代理组“${group.name}”至少需要一个节点、Provider 或组来源`);
        if (group.type === "relay" && group.sources.filter((source) => source.kind !== "provider").length < 2) throw new Error(`Relay 组“${group.name}”至少需要两个有序节点来源`);
      }
      if (!draft.rules.some((rule) => rule.trim())) throw new Error("至少需要一条规则");
      await api.post<{ content?: string }>("/api/admin/template-v3/preview", { template_content: yaml, proxies: [] });
      await uploadRuleTemplate(normalizedFilename(draft.filename, "visual_v3"), yaml);
      try { window.localStorage.removeItem(storageKey); } catch { /* best effort */ }
      onComplete();
    } catch (reason) { setError(fail(reason, "保存可视化模板失败")); }
    finally { setWorking(false); }
  };

  const sourceOptions = (group: VisualProxyGroup) => [
    { label: "全部注入节点", kind: "node" as const, value: "__PROXY_NODES__" },
    { label: "全部 Proxy Provider", kind: "provider" as const, value: "__PROXY_PROVIDERS__" },
    { label: "DIRECT", kind: "builtin" as const, value: "DIRECT" },
    { label: "REJECT", kind: "builtin" as const, value: "REJECT" },
    ...draft.groups.filter((item) => item.id !== group.id && item.name.trim()).map((item) => ({ label: `组 · ${item.name}`, kind: "group" as const, value: item.name.trim() })),
    ...providers.map((item) => ({ label: `Provider · ${item.name}`, kind: "provider" as const, value: item.name })),
    ...nodes.filter((item) => item.enabled).map((item) => ({ label: `节点 · ${item.node_name}`, kind: "node" as const, value: item.node_name })),
  ];

  return <Dialog title="可视化模板设计" description="结构化维护代理组并生成完整 V3 YAML；不会解析或改写已有 YAML" onClose={onClose} wide>
    <div className="cw-form">
      {error ? <ErrorState message={error} /> : null}
      {loadWarning ? <div className="cw-help"><Info size={16} /><span>{loadWarning}</span></div> : null}
      {restoredRef.current ? <div className="cw-draft-notice"><span><RefreshCw size={15} />已恢复上次未保存草稿</span><Button variant="ghost" onClick={clearDraft}>清除草稿</Button></div> : null}
      <div className="cw-tabs cw-tabs-three" role="tablist" aria-label="可视化模板视图"><button type="button" role="tab" aria-selected={tab === "design"} className={tab === "design" ? "is-active" : ""} onClick={() => setTab("design")}>结构设计</button><button type="button" role="tab" aria-selected={tab === "yaml"} className={tab === "yaml" ? "is-active" : ""} onClick={() => setTab("yaml")}>YAML 预览</button><button type="button" role="tab" aria-selected={tab === "json"} className={tab === "json" ? "is-active" : ""} onClick={() => setTab("json")}>JSON 预览</button></div>
      {tab === "design" ? <>
        <div className="cw-form-grid"><Field label="模板文件名"><input required value={draft.filename} onChange={(event) => setDraft((current) => ({ ...current, filename: event.target.value }))} /></Field><Field label="DNS 模式"><select value={draft.dnsMode} onChange={(event) => setDraft((current) => ({ ...current, dnsMode: event.target.value as VisualTemplateDraft["dnsMode"] }))}><option value="fake-ip">Fake IP</option><option value="redir-host">Redir Host</option><option value="off">不写入 DNS</option></select></Field></div>
        {draft.dnsMode !== "off" ? <div className="cw-form-section"><strong>DNS</strong><div className="cw-form-grid"><Field label="Nameserver（每行一个）"><textarea value={draft.nameservers.join("\n")} onChange={(event) => setDraft((current) => ({ ...current, nameservers: event.target.value.split("\n") }))} /></Field>{draft.dnsMode === "fake-ip" ? <><Field label="Fake IP 范围"><input value={draft.fakeIPRange} onChange={(event) => setDraft((current) => ({ ...current, fakeIPRange: event.target.value }))} /></Field><Field label="Fake IP 排除（每行一个）"><textarea value={draft.fakeIPFilters.join("\n")} onChange={(event) => setDraft((current) => ({ ...current, fakeIPFilters: event.target.value.split("\n") }))} /></Field></> : null}<div className="cw-toggle-field"><Toggle checked={draft.ipv6} onChange={(ipv6) => setDraft((current) => ({ ...current, ipv6 }))} label="DNS IPv6" /></div></div></div> : null}
        <div className="cw-form-section"><div className="cw-section-title"><div><h2>代理组</h2><p>来源顺序会写入 proxies；Provider 来源按 Mihomo 语义写入 use。</p></div><div className="cw-toolbar"><select aria-label="地区分组预设" value={region} onChange={(event) => setRegion(event.target.value)}><option value="">地区预设</option>{regions.map((item) => <option value={item.name} key={item.name}>{item.name}</option>)}</select><Button variant="secondary" onClick={addRegionGroup} disabled={!region}>添加地区组</Button><Button onClick={() => setDraft((current) => ({ ...current, groups: [...current.groups, { ...defaultVisualGroup(), name: `PROXY ${current.groups.length + 1}` }] }))}><Plus size={16} />代理组</Button></div></div>
          <div className="cw-visual-groups">{draft.groups.map((group, groupIndex) => <Surface className="cw-visual-group" key={group.id}>
            <div className="cw-visual-group-head"><strong>{group.name || "未命名组"}</strong><div className="cw-table-actions"><IconButton label={`上移代理组 ${group.name}`} disabled={groupIndex === 0} onClick={() => moveGroup(groupIndex, -1)}><ArrowUp size={15} /></IconButton><IconButton label={`下移代理组 ${group.name}`} disabled={groupIndex === draft.groups.length - 1} onClick={() => moveGroup(groupIndex, 1)}><ArrowDown size={15} /></IconButton><IconButton label={`删除代理组 ${group.name}`} disabled={draft.groups.length === 1} onClick={() => setDraft((current) => ({ ...current, groups: current.groups.filter((item) => item.id !== group.id) }))}><Trash2 size={15} /></IconButton></div></div>
            <div className="cw-form-grid"><Field label="组名"><input value={group.name} onChange={(event) => updateGroup(group.id, { name: event.target.value })} /></Field><Field label="类型"><select value={group.type} onChange={(event) => updateGroup(group.id, { type: event.target.value as ProxyGroupType })}><option value="select">Select</option><option value="url-test">URL Test</option><option value="fallback">Fallback</option><option value="load-balance">Load Balance</option><option value="relay">Relay</option></select></Field></div>
            <Field label="添加节点 / Provider / 代理组来源"><select aria-label={`添加 ${group.name} 来源`} value="" onChange={(event) => addSource(group, event.target.value)}><option value="">选择来源</option>{sourceOptions(group).map((option) => <option value={JSON.stringify({ kind: option.kind, value: option.value })} key={`${option.kind}:${option.value}`}>{option.label}</option>)}</select></Field>
            <div className="cw-source-list">{group.sources.map((source, sourceIndex) => <div className="cw-source-row" key={source.id}><Badge tone={source.kind === "provider" ? "info" : "neutral"}>{({ node: "节点", provider: "Provider", group: "代理组", builtin: "内置" } as const)[source.kind]}</Badge><code>{source.value}</code><div className="cw-table-actions"><IconButton label={`上移来源 ${source.value}`} disabled={sourceIndex === 0} onClick={() => moveSource(group, sourceIndex, -1)}><ArrowUp size={14} /></IconButton><IconButton label={`下移来源 ${source.value}`} disabled={sourceIndex === group.sources.length - 1} onClick={() => moveSource(group, sourceIndex, 1)}><ArrowDown size={14} /></IconButton><IconButton label={`移除来源 ${source.value}`} onClick={() => updateGroup(group.id, { sources: group.sources.filter((item) => item.id !== source.id) })}><Trash2 size={14} /></IconButton></div></div>)}</div>
            {["url-test", "fallback", "load-balance"].includes(group.type) ? <div className="cw-form-grid"><Field label="健康检查 URL"><input type="url" value={group.url} onChange={(event) => updateGroup(group.id, { url: event.target.value })} /></Field><Field label="检查间隔（秒）"><input type="number" min="1" value={group.interval} onChange={(event) => updateGroup(group.id, { interval: Number(event.target.value) })} /></Field>{group.type === "url-test" ? <Field label="容差（毫秒）"><input type="number" min="0" value={group.tolerance} onChange={(event) => updateGroup(group.id, { tolerance: Number(event.target.value) })} /></Field> : null}{group.type === "load-balance" ? <Field label="负载策略"><select value={group.strategy} onChange={(event) => updateGroup(group.id, { strategy: event.target.value })}><option value="consistent-hashing">Consistent Hashing</option><option value="round-robin">Round Robin</option><option value="sticky-sessions">Sticky Sessions</option></select></Field> : null}<div className="cw-toggle-field"><Toggle checked={group.lazy} onChange={(lazy) => updateGroup(group.id, { lazy })} label="Lazy 检测" /></div></div> : null}
            <div className="cw-form-grid"><Field label="包含过滤（filter）"><input value={group.filter} onChange={(event) => updateGroup(group.id, { filter: event.target.value })} /></Field><Field label="排除过滤（exclude-filter）"><input value={group.excludeFilter} onChange={(event) => updateGroup(group.id, { excludeFilter: event.target.value })} /></Field><Field label="排除类型（exclude-type）"><input value={group.excludeType} onChange={(event) => updateGroup(group.id, { excludeType: event.target.value })} /></Field><Field label="链式前置组" hint="生成 dialer-proxy-group，由现有订阅 handler 注入到节点"><select value={group.dialerProxyGroup} onChange={(event) => updateGroup(group.id, { dialerProxyGroup: event.target.value })}><option value="">不设置</option>{draft.groups.filter((item) => item.id !== group.id && item.name.trim()).map((item) => <option value={item.name} key={item.id}>{item.name}</option>)}</select></Field></div>
          </Surface>)}</div>
        </div>
        <div className="cw-form-section"><strong>规则</strong><Field label="每行一条 Mihomo 规则"><textarea className="cw-dialog-code cw-dialog-code-short" value={draft.rules.join("\n")} onChange={(event) => setDraft((current) => ({ ...current, rules: event.target.value.split("\n") }))} spellCheck={false} /></Field></div>
      </> : <pre className="cw-preview">{tab === "yaml" ? yaml : json}</pre>}
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>取消</Button><Button variant="ghost" onClick={clearDraft}>恢复默认</Button><Button onClick={() => void save()} disabled={working}>{working ? <Spinner label="正在保存" /> : <><Save size={16} />保存新模板</>}</Button></div>
    </div>
  </Dialog>;
}

function TemplatePreviewDialog({ filename, onClose }: { filename: string; onClose: () => void }) {
  const [raw, setRaw] = useState("");
  const [rendered, setRendered] = useState("");
  const [tab, setTab] = useState<"rendered" | "raw">("rendered");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api.get<{ content?: string }>(`/api/admin/rule-templates/${encodeURIComponent(filename)}`).then(async (payload) => {
      const content = payload.content ?? "";
      if (!active) return;
      setRaw(content);
      try {
        const result = await api.post<{ content?: string }>("/api/admin/template-v3/preview", { template_content: content, proxies: [] });
        if (active) setRendered(result.content || content);
      } catch {
        if (active) setRendered(content);
      }
    }).catch((reason) => active && setError(fail(reason, "读取模板失败"))).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [filename]);
  const content = tab === "rendered" ? rendered : raw;
  return <Dialog title="模板预览" description={filename} onClose={onClose} wide>{error ? <ErrorState message={error} /> : null}<div className="cw-tabs" role="tablist" aria-label="模板预览模式"><button type="button" role="tab" aria-selected={tab === "rendered"} className={tab === "rendered" ? "is-active" : ""} onClick={() => setTab("rendered")}>处理结果</button><button type="button" role="tab" aria-selected={tab === "raw"} className={tab === "raw" ? "is-active" : ""} onClick={() => setTab("raw")}>源文件</button></div>{loading ? <div className="cw-loading"><Spinner /></div> : <pre className="cw-preview">{content}</pre>}<div className="dialog-actions"><Button variant="secondary" onClick={onClose}>关闭</Button><Button disabled={!content} onClick={async () => { await copyText(content); }}><Copy size={16} />复制内容</Button></div></Dialog>;
}

function EditTemplateDialog({ filename, onClose, onComplete }: { filename: string; onClose: () => void; onComplete: () => void }) {
  const [nextName, setNextName] = useState(filename);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void api.get<{ content?: string }>(`/api/admin/rule-templates/${encodeURIComponent(filename)}`).then((payload) => setContent(payload.content || "")).catch((reason) => setError(fail(reason, "读取模板失败"))).finally(() => setLoading(false)); }, [filename]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      const normalized = normalizedFilename(nextName, "template");
      await api.put(`/api/admin/rule-templates/${encodeURIComponent(filename)}`, { content });
      if (normalized !== filename) {
        await api.post<{ filename?: string }>("/api/admin/rule-templates/rename", { old_name: filename, new_name: normalized });
      }
      onComplete();
    } catch (reason) { setError(fail(reason, "保存模板失败")); }
    finally { setWorking(false); }
  };
  return <Dialog title="编辑模板" description="模板内容将在订阅生成和套餐订阅中直接使用" onClose={onClose} wide><form className="cw-form" onSubmit={save}>{error ? <ErrorState message={error} /> : null}<Field label="文件名"><input required value={nextName} onChange={(event) => setNextName(event.target.value)} /></Field>{loading ? <div className="cw-loading"><Spinner /></div> : <Field label="YAML 内容"><textarea required className="cw-dialog-code" value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} /></Field>}<div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working || loading || !content.trim()}>{working ? <Spinner label="正在保存" /> : <><Save size={16} />保存模板</>}</Button></div></form></Dialog>;
}

function CreateTemplateDialog({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [mode, setMode] = useState<TemplateCreateMode>("upload");
  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  const [url, setURL] = useState("");
  const [useProxy, setUseProxy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [subscriptions, setSubscriptions] = useState<SubscribeFile[]>([]);
  const [subscription, setSubscription] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void api.get<{ files?: SubscribeFile[] }>("/api/admin/subscribe-files").then((payload) => { const files = payload.files ?? []; setSubscriptions(files); setSubscription(files[0]?.filename || ""); }).catch(() => undefined); }, []);
  useEffect(() => { if (mode === "blank") setContent(blankTemplate); }, [mode]);
  const modes: { value: TemplateCreateMode; label: string; icon: ReactNode }[] = [
    { value: "upload", label: "上传文件", icon: <Upload size={18} /> },
    { value: "paste", label: "粘贴内容", icon: <Clipboard size={18} /> },
    { value: "blank", label: "空白模板", icon: <FilePlus2 size={18} /> },
    { value: "url", label: "从 URL", icon: <Link2 size={18} /> },
    { value: "v2", label: "转换 V2", icon: <RotateCw size={18} /> },
    { value: "subscription", label: "从订阅", icon: <CloudDownload size={18} /> },
  ];
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      if (mode === "upload") {
        if (!file) throw new Error("请选择 YAML 文件");
        await uploadRuleTemplate(filename || file.name, file);
      } else {
        if (!filename.trim()) throw new Error("请输入模板文件名");
        let finalContent = content;
        if (mode === "url") {
          const result = await api.post<{ content?: string }>("/api/admin/templates/fetch-source", { url, use_proxy: useProxy });
          finalContent = result.content || "";
        } else if (mode === "v2") {
          const result = await api.post<V2ConversionResult>("/api/admin/template-v3/convert-v2", { content });
          finalContent = v2ResultToTemplate(result);
        } else if (mode === "subscription") {
          const result = await api.post<{ template_content?: string }>("/api/admin/template-v3/analyze-subscription", { subscription_filename: subscription });
          finalContent = result.template_content || "";
        }
        if (!finalContent.trim()) throw new Error("模板内容为空");
        await uploadRuleTemplate(filename, finalContent);
      }
      onComplete();
    } catch (reason) { setError(fail(reason, "创建模板失败")); }
    finally { setWorking(false); }
  };
  return <Dialog title="新建模板" description="选择模板来源并保存为 V3 YAML 文件" onClose={onClose} wide><form className="cw-form" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<div className="cw-create-modes">{modes.map((item) => <button type="button" key={item.value} className={`cw-create-mode ${mode === item.value ? "is-active" : ""}`} onClick={() => setMode(item.value)}>{item.icon}<span>{item.label}</span></button>)}</div>{mode === "upload" ? <><Field key="template-upload-file" label="YAML 文件"><input required type="file" accept=".yaml,.yml,application/yaml,text/yaml" onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); if (next && !filename) setFilename(next.name); }} /></Field><Field label="保存文件名" hint="默认使用上传文件名"><input value={filename} onChange={(event) => setFilename(event.target.value)} placeholder="custom.yaml" /></Field></> : <><Field key="template-output-filename" label="模板文件名"><input required value={filename} onChange={(event) => setFilename(event.target.value)} placeholder="custom_v3.yaml" /></Field>{mode === "url" ? <><Field label="模板 URL"><input required type="url" value={url} onChange={(event) => setURL(event.target.value)} placeholder="https://example.com/template.yaml" /></Field><Toggle checked={useProxy} onChange={setUseProxy} label="通过远程获取代理拉取" /></> : mode === "subscription" ? <Field label="订阅文件"><select required value={subscription} onChange={(event) => setSubscription(event.target.value)}><option value="">请选择订阅</option>{subscriptions.map((item) => <option key={item.id} value={item.filename}>{item.name} · {item.filename}</option>)}</select></Field> : <Field label={mode === "v2" ? "V2 / ACL4SSR 内容" : "YAML 内容"}><textarea required className="cw-dialog-code" value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} placeholder={mode === "paste" ? "粘贴 V3 YAML 模板" : undefined} /></Field>}</>}<div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在创建" /> : <><FilePlus2 size={16} />创建模板</>}</Button></div></form></Dialog>;
}

type CertificatePending = { kind: "certificate"; item: CertificateItem } | { kind: "provider"; item: DNSProviderItem };

export function CertificatesWorkbenchPage({ notify = noNotify }: ContentPageProps) {
  const [tab, setTab] = useState<"certificates" | "providers">("certificates");
  const [certificates, setCertificates] = useState<CertificateItem[]>([]);
  const [providers, setProviders] = useState<DNSProviderItem[]>([]);
  const [servers, setServers] = useState<RemoteServerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [showApply, setShowApply] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [editingCertificate, setEditingCertificate] = useState<CertificateItem | null>(null);
  const [editingProvider, setEditingProvider] = useState<DNSProviderItem | "new" | null>(null);
  const [providerForApply, setProviderForApply] = useState(false);
  const [deploying, setDeploying] = useState<CertificateItem | null>(null);
  const [pending, setPending] = useState<CertificatePending | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [certPayload, providerPayload, serverPayload] = await Promise.all([
        api.get<{ success?: boolean; certificates?: CertificateItem[] }>("/api/admin/certificates"),
        api.get<{ success?: boolean; providers?: DNSProviderWire[] }>("/api/admin/dns-providers"),
        api.get<{ servers?: RemoteServerItem[] }>("/api/admin/remote-servers"),
      ]);
      assertSuccess(certPayload, "加载证书失败");
      assertSuccess(providerPayload, "加载 DNS 提供商失败");
      setCertificates(certPayload.certificates ?? []);
      setProviders((providerPayload.providers ?? []).flatMap((item) => {
        const id = item.id ?? item.ID;
        const name = item.name ?? item.Name;
        const providerType = item.provider_type ?? item.ProviderType;
        if (id == null || !name || !providerType) return [];
        return [{ id, name, provider_type: providerType, created_at: item.created_at ?? item.CreatedAt, updated_at: item.updated_at ?? item.UpdatedAt }];
      }));
      setServers(serverPayload.servers ?? []);
    } catch (reason) { setError(fail(reason, "加载证书管理数据失败")); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const renew = async (item: CertificateItem) => {
    setWorking(true); setError("");
    try { assertSuccess(await api.post<Envelope>("/api/admin/certificates/renew", { id: item.id }), "提交续期失败"); notify("证书续期已提交"); await load(); }
    catch (reason) { setError(fail(reason, "提交续期失败")); }
    finally { setWorking(false); }
  };
  const toggleCertificate = async (item: CertificateItem, key: "auto_renew" | "auto_deploy", value: boolean) => {
    setWorking(true); setError("");
    try {
      const path = key === "auto_renew" ? "/api/admin/certificates/auto-renew" : "/api/admin/certificates/auto-deploy";
      assertSuccess(await request<Envelope>(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, [key]: value }) }), "更新证书策略失败");
      notify(key === "auto_renew" ? "自动续期设置已更新" : "自动部署设置已更新"); await load();
    } catch (reason) { setError(fail(reason, "更新证书策略失败")); }
    finally { setWorking(false); }
  };
  const remove = async () => {
    if (!pending) return;
    setWorking(true); setError("");
    try {
      if (pending.kind === "certificate") {
        assertSuccess(await api.delete<Envelope>("/api/admin/certificates/delete", { id: pending.item.id }), "删除证书失败");
        notify("证书记录已删除");
      } else {
        assertSuccess(await api.delete<Envelope>(`/api/admin/dns-providers/${pending.item.id}`), "删除 DNS 提供商失败");
        notify("DNS 提供商已删除");
      }
      setPending(null); await load();
    } catch (reason) { setError(fail(reason, "删除失败")); }
    finally { setWorking(false); }
  };

  return <section className="cw-page">
    <PageHeader title="SSL/TLS 证书管理" description="管理 ACME 证书，支持通配符、DNS 验证、多 CA 和自动部署。" actions={<><IconButton label="刷新证书" onClick={() => void load()}><RefreshCw size={18} /></IconButton>{tab === "certificates" ? <><Button onClick={() => setShowApply(true)}><Plus size={16} />申请证书</Button><Button variant="secondary" onClick={() => setShowUpload(true)}><Upload size={16} />上传证书</Button><Button variant="secondary" onClick={() => setEditingProvider("new")}><KeyRound size={16} />DNS 提供商</Button></> : <Button onClick={() => setEditingProvider("new")}><Plus size={16} />DNS 提供商</Button>}</>} />
    <div className="cw-tabs" role="tablist" aria-label="证书管理分类"><button type="button" role="tab" aria-selected={tab === "certificates"} className={tab === "certificates" ? "is-active" : ""} onClick={() => setTab("certificates")}><Award size={16} />证书 <span>{certificates.length}</span></button><button type="button" role="tab" aria-selected={tab === "providers"} className={tab === "providers" ? "is-active" : ""} onClick={() => setTab("providers")}><KeyRound size={16} />DNS 提供商 <span>{providers.length}</span></button></div>
    {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
    {loading ? <Surface className="cw-loading"><Spinner /></Surface> : tab === "certificates" ? <CertificateTable items={certificates} working={working} onApply={() => setShowApply(true)} onEdit={setEditingCertificate} onRenew={(item) => void renew(item)} onToggle={(item, key, value) => void toggleCertificate(item, key, value)} onDeploy={setDeploying} onDelete={(item) => setPending({ kind: "certificate", item })} /> : <DNSProviderTable items={providers} onCreate={() => setEditingProvider("new")} onEdit={setEditingProvider} onDelete={(item) => setPending({ kind: "provider", item })} />}
    {showApply ? <ApplyCertificateDialog providers={providers} servers={servers} onCreateProvider={() => { setShowApply(false); setProviderForApply(true); setEditingProvider("new"); }} onClose={() => setShowApply(false)} onComplete={async () => { setShowApply(false); notify("证书申请已提交"); await load(); }} /> : null}
    {showUpload ? <UploadCertificateDialog onClose={() => setShowUpload(false)} onComplete={async () => { setShowUpload(false); notify("证书已上传"); await load(); }} /> : null}
    {editingCertificate ? <EditCertificateDialog item={editingCertificate} providers={providers} onClose={() => setEditingCertificate(null)} onComplete={async () => { setEditingCertificate(null); notify("证书设置已更新"); await load(); }} /> : null}
    {deploying ? <DeployCertificateDialog item={deploying} onClose={() => setDeploying(null)} onComplete={async () => { setDeploying(null); notify("证书已部署"); await load(); }} /> : null}
    {editingProvider ? <DNSProviderDialog item={editingProvider === "new" ? undefined : editingProvider} onClose={() => { setEditingProvider(null); if (providerForApply) { setProviderForApply(false); setShowApply(true); } }} onComplete={async () => { const returnToApply = providerForApply; setEditingProvider(null); setProviderForApply(false); notify(editingProvider === "new" ? "DNS 提供商已创建" : "DNS 提供商已更新"); await load(); if (returnToApply) setShowApply(true); }} /> : null}
    {pending ? <ConfirmDialog title={pending.kind === "certificate" ? "删除证书" : "删除 DNS 提供商"} description={pending.kind === "certificate" ? `将删除“${pending.item.domain}”的证书记录和自动化策略。` : `将删除“${pending.item.name}”，使用该凭据的证书后续无法自动续期。`} confirmLabel="确认删除" working={working} onCancel={() => setPending(null)} onConfirm={() => void remove()} /> : null}
  </section>;
}

function CertificateTable({ items, working, onApply, onEdit, onRenew, onToggle, onDeploy, onDelete }: { items: CertificateItem[]; working: boolean; onApply: () => void; onEdit: (item: CertificateItem) => void; onRenew: (item: CertificateItem) => void; onToggle: (item: CertificateItem, key: "auto_renew" | "auto_deploy", value: boolean) => void; onDeploy: (item: CertificateItem) => void; onDelete: (item: CertificateItem) => void }) {
  if (items.length === 0) return <Surface><EmptyState icon={<ShieldCheck size={24} />} title="暂无证书" description="申请 ACME 证书或上传已有 PEM 证书。" action={<Button onClick={onApply}><Plus size={16} />申请证书</Button>} /></Surface>;
  return <Surface className="table-surface cw-compact-table cw-managed-table cw-certificate-table">
    <div className="table-wrap"><table>
      <thead><tr><th>域名</th><th>状态 / CA</th><th>目标</th><th>有效期</th><th>自动化</th><th aria-label="操作" /></tr></thead>
      <tbody>{items.map((item) => <tr key={item.id}>
        <td data-label="域名"><div className="cw-file-name"><span className="cw-file-icon"><LockKeyhole size={16} /></span><span><strong title={item.domain}>{item.domain}</strong><small title={item.email}>{item.email || "未记录邮箱"}</small></span></div>{item.message ? <span className={`cw-table-note cw-clamp-note ${item.status === "failed" ? "cw-private-warning" : ""}`} title={item.message}>{item.message}</span> : null}</td>
        <td data-label="状态 / CA"><span className="cw-status"><span className={`cw-status-dot is-${item.status}`} /><Badge tone={certificateTone(item.status)}>{certificateStatus(item.status)}</Badge></span><span className="cw-table-note">{item.provider || "manual"} · {item.challenge_mode || "manual"}</span></td>
        <td data-label="目标"><strong title={item.remote_server_name}>{item.remote_server_name || (item.remote_server_id ? `服务器 #${item.remote_server_id}` : "主控本地")}</strong><span className="cw-table-note">{item.deploy_target && item.deploy_target !== "none" ? `部署到 ${item.deploy_target}` : "未配置部署"}</span></td>
        <td data-label="有效期"><strong>{formatDate(item.expiry_date)}</strong><span className="cw-table-note">签发 {formatDate(item.issue_date)}</span></td>
        <td data-label="自动化"><div className="cw-auto-stack"><Toggle checked={item.auto_renew} onChange={(value) => onToggle(item, "auto_renew", value)} label="自动续期" /><Toggle checked={item.auto_deploy} onChange={(value) => onToggle(item, "auto_deploy", value)} label="自动部署" /></div></td>
        <td data-label="操作"><div className="cw-table-actions"><IconButton label={`编辑 ${item.domain}`} onClick={() => onEdit(item)}><Pencil size={16} /></IconButton>{item.status === "failed" ? <Button variant="secondary" disabled={working || item.provider === "manual"} onClick={() => onRenew(item)}><RotateCw size={15} />重试申请</Button> : <IconButton label={`续期 ${item.domain}`} disabled={working || item.status === "pending" || item.provider === "manual"} onClick={() => onRenew(item)}><RotateCw size={16} /></IconButton>}<IconButton label={`部署 ${item.domain}`} disabled={item.status !== "valid"} onClick={() => onDeploy(item)}><Server size={16} /></IconButton><IconButton label={`删除 ${item.domain}`} onClick={() => onDelete(item)}><Trash2 size={16} /></IconButton></div></td>
      </tr>)}</tbody>
    </table></div>
  </Surface>;
}

function DNSProviderTable({ items, onCreate, onEdit, onDelete }: { items: DNSProviderItem[]; onCreate: () => void; onEdit: (item: DNSProviderItem) => void; onDelete: (item: DNSProviderItem) => void }) {
  if (items.length === 0) return <Surface><EmptyState icon={<KeyRound size={24} />} title="暂无 DNS 提供商" description="添加凭据后可使用 DNS-01 申请泛域名证书。" action={<Button onClick={onCreate}><Plus size={16} />DNS 提供商</Button>} /></Surface>;
  return <Surface className="table-surface cw-compact-table cw-managed-table cw-provider-table"><div className="table-wrap"><table><thead><tr><th>名称</th><th>提供商</th><th>凭据</th><th>更新时间</th><th aria-label="操作" /></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td data-label="名称"><div className="cw-file-name"><span className="cw-file-icon"><Globe2 size={16} /></span><span><strong title={item.name}>{item.name}</strong><small>ID {item.id}</small></span></div></td><td data-label="提供商"><Badge tone="info">{item.provider_type}</Badge></td><td data-label="凭据"><span className="cw-secret">••••••••</span><span className="cw-table-note">编辑后可按需显示</span></td><td data-label="更新时间">{formatDate(item.updated_at || item.created_at)}</td><td data-label="操作"><div className="cw-table-actions"><IconButton label={`编辑 ${item.name}`} onClick={() => onEdit(item)}><Pencil size={16} /></IconButton><IconButton label={`删除 ${item.name}`} onClick={() => onDelete(item)}><Trash2 size={16} /></IconButton></div></td></tr>)}</tbody></table></div></Surface>;
}

function ApplyCertificateDialog({ providers, servers: _servers, onCreateProvider, onClose, onComplete }: { providers: DNSProviderItem[]; servers: RemoteServerItem[]; onCreateProvider: () => void; onClose: () => void; onComplete: () => void }) {
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [provider, setProvider] = useState("letsencrypt");
  const [challenge, setChallenge] = useState("dns");
  const [dnsProviderID, setDNSProviderID] = useState(() => providers[0] ? String(providers[0].id) : "");
  const [webrootPath, setWebrootPath] = useState("/var/www/html");
  const [deployTarget, setDeployTarget] = useState("none");
  const [certPath, setCertPath] = useState("");
  const [keyPath, setKeyPath] = useState("");
  const [autoRenew, setAutoRenew] = useState(true);
  const [autoDeploy, setAutoDeploy] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setDNSProviderID((current) => providers.some((item) => String(item.id) === current) ? current : providers[0] ? String(providers[0].id) : "");
  }, [providers]);
  useEffect(() => {
    if (!domain.trim()) return;
    const name = certFilename(domain.trim());
    if (!certPath || certPath.startsWith("/usr/local/nginx/cert/")) setCertPath(`/usr/local/nginx/cert/${name}.pem`);
    if (!keyPath || keyPath.startsWith("/usr/local/nginx/cert/")) setKeyPath(`/usr/local/nginx/cert/${name}.key`);
  }, [domain]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      if (domain.includes("*") && challenge !== "dns") throw new Error("泛域名证书必须使用 DNS-01 验证");
      if (challenge === "dns" && !dnsProviderID) throw new Error("请选择 DNS 提供商");
      if (deployTarget !== "none" && (!certPath.trim() || !keyPath.trim())) throw new Error("请输入证书和私钥部署路径");
      const payload = assertSuccess(await api.post<Envelope>("/api/admin/certificates/create", {
        domain: domain.trim(), email: email.trim(), provider, challenge_mode: challenge,
        webroot_path: challenge === "webroot" ? webrootPath.trim() : "",
        dns_provider_id: challenge === "dns" ? Number(dnsProviderID) : 0,
        remote_server_id: 0, auto_renew: autoRenew,
        deploy_target: deployTarget,
        deploy_cert_path: deployTarget === "none" ? "" : certPath.trim(),
        deploy_key_path: deployTarget === "none" ? "" : keyPath.trim(),
        auto_deploy: deployTarget !== "none" && autoDeploy,
      }), "提交证书申请失败");
      if (payload.success === false) throw new Error(payload.message || "提交证书申请失败");
      onComplete();
    } catch (reason) { setError(fail(reason, "提交证书申请失败")); }
    finally { setWorking(false); }
  };
  return <Dialog title="申请 ACME 证书" description="支持 HTTP、Webroot 与 DNS-01 验证" onClose={onClose} wide><form className="cw-form" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<div className="cw-form-grid"><Field label="域名"><input required value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="example.com 或 *.example.com" /></Field><Field label="联系邮箱"><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.com" /></Field><Field label="证书颁发机构"><select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="letsencrypt">Let's Encrypt</option><option value="letsencrypt-staging">Let's Encrypt Staging</option></select></Field><Field label="验证方式"><select value={challenge} onChange={(event) => setChallenge(event.target.value)}><option value="dns">DNS-01</option><option value="standalone">HTTP 独立验证</option><option value="webroot">网站根目录</option></select></Field>{challenge === "dns" ? <Field label="DNS 提供商" hint={providers.length ? "使用已保存的 DNS API 凭据" : "还没有可用凭据，请先添加 DNS 提供商"}><div className="cw-provider-picker"><select required aria-label="DNS 提供商" value={dnsProviderID} onChange={(event) => setDNSProviderID(event.target.value)}><option value="">请选择 DNS 提供商</option>{providers.map((item) => <option key={item.id} value={String(item.id)}>{item.name} · {item.provider_type}</option>)}</select><Button type="button" variant="secondary" onClick={onCreateProvider}><Plus size={15} />添加</Button></div></Field> : null}{challenge === "webroot" ? <Field label="网站根目录"><input required value={webrootPath} onChange={(event) => setWebrootPath(event.target.value)} /></Field> : null}<Field label="部署目标"><select value={deployTarget} onChange={(event) => { const value = event.target.value; setDeployTarget(value); if (value === "none") setAutoDeploy(false); }}><option value="none">仅保存</option><option value="nginx">Nginx</option><option value="xray">Xray</option><option value="both">Nginx + Xray</option></select></Field></div>{deployTarget !== "none" ? <div className="cw-form-grid"><Field label="证书部署路径"><input required value={certPath} onChange={(event) => setCertPath(event.target.value)} /></Field><Field label="私钥部署路径"><input required value={keyPath} onChange={(event) => setKeyPath(event.target.value)} /></Field></div> : null}<div className="cw-checkboxes"><Toggle checked={autoRenew} onChange={setAutoRenew} label="自动续期" /><Toggle checked={autoDeploy} onChange={setAutoDeploy} label="续期后自动部署" /></div><div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在提交" /> : <><ShieldCheck size={16} />提交申请</>}</Button></div></form></Dialog>;
}

function EditCertificateDialog({ item, providers, onClose, onComplete }: { item: CertificateItem; providers: DNSProviderItem[]; onClose: () => void; onComplete: () => void }) {
  const domain = item.domain;
  const [email, setEmail] = useState(item.email || "");
  const [provider, setProvider] = useState(item.provider || "manual");
  const [challenge, setChallenge] = useState(item.challenge_mode || (item.provider === "manual" ? "manual" : "dns"));
  const [dnsProviderID, setDNSProviderID] = useState(item.dns_provider_id ? String(item.dns_provider_id) : "");
  const [webrootPath, setWebrootPath] = useState(item.webroot_path || "/var/www/html");
  const [deployTarget, setDeployTarget] = useState(item.deploy_target || "none");
  const [certPath, setCertPath] = useState(item.deploy_cert_path || "");
  const [keyPath, setKeyPath] = useState(item.deploy_key_path || "");
  const [autoRenew, setAutoRenew] = useState(item.auto_renew);
  const [autoDeploy, setAutoDeploy] = useState(item.auto_deploy);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const manual = provider === "manual";
  const issued = item.status === "valid" || Boolean(item.issue_date);
  const providerIsKnown = ["manual", "letsencrypt", "letsencrypt-staging"].includes(provider);
  const challengeIsKnown = ["dns", "standalone", "webroot", "manual"].includes(challenge);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      if (!manual && domain.includes("*") && challenge !== "dns") throw new Error("泛域名证书必须使用 DNS-01 验证");
      if (!manual && challenge === "dns" && !dnsProviderID) throw new Error("请选择 DNS 提供商");
      if (deployTarget !== "none" && (!certPath.trim() || !keyPath.trim())) throw new Error("请输入证书和私钥部署路径");
      assertSuccess(await api.put<Envelope>(`/api/admin/certificates/${item.id}`, {
        domain: domain.trim(),
        email: email.trim(),
        provider,
        challenge_mode: manual ? "manual" : challenge,
        webroot_path: !manual && challenge === "webroot" ? webrootPath.trim() : "",
        dns_provider_id: !manual && challenge === "dns" ? Number(dnsProviderID) : 0,
        remote_server_id: item.remote_server_id || 0,
        auto_renew: !manual && autoRenew,
        auto_deploy: deployTarget !== "none" && autoDeploy,
        deploy_target: deployTarget,
        deploy_cert_path: deployTarget === "none" ? "" : certPath.trim(),
        deploy_key_path: deployTarget === "none" ? "" : keyPath.trim(),
      }), "更新证书设置失败");
      onComplete();
    } catch (reason) { setError(fail(reason, "更新证书设置失败")); }
    finally { setWorking(false); }
  };

  return <Dialog title="编辑证书设置" description="修改仅用于后续续期和部署，不会立即重新签发证书" onClose={onClose} wide>
    <form className="cw-form" onSubmit={submit}>
      {error ? <ErrorState message={error} /> : null}
      <div className="cw-form-grid">
        <Field label="域名" hint="证书域名来自证书内容，不能直接修改"><input aria-label="域名" readOnly value={domain} /></Field>
        <Field label="联系邮箱"><input required={!manual} type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.com" /></Field>
        <Field label="证书颁发机构" hint={issued ? "已签发证书不能更改 CA" : undefined}><select aria-label="证书颁发机构" disabled={issued} value={provider} onChange={(event) => { const value = event.target.value; setProvider(value); if (value === "manual") { setChallenge("manual"); setAutoRenew(false); } else if (challenge === "manual") { setChallenge("dns"); } }}>{!providerIsKnown ? <option value={provider}>{provider}</option> : null}<option value="letsencrypt">Let's Encrypt</option><option value="letsencrypt-staging">Let's Encrypt Staging</option><option value="manual">手动上传</option></select></Field>
        {!manual ? <Field label="验证方式"><select value={challenge} onChange={(event) => setChallenge(event.target.value)}>{!challengeIsKnown ? <option value={challenge}>{challenge}</option> : null}<option value="dns">DNS-01</option><option value="standalone">HTTP 独立验证</option><option value="webroot">网站根目录</option></select></Field> : null}
        {!manual && challenge === "dns" ? <Field label="DNS 提供商"><select required value={dnsProviderID} onChange={(event) => setDNSProviderID(event.target.value)}><option value="">请选择 DNS 提供商</option>{providers.map((providerItem) => <option key={providerItem.id} value={String(providerItem.id)}>{providerItem.name} · {providerItem.provider_type}</option>)}</select></Field> : null}
        {!manual && challenge === "webroot" ? <Field label="网站根目录"><input required value={webrootPath} onChange={(event) => setWebrootPath(event.target.value)} /></Field> : null}
        <Field label="部署目标"><select value={deployTarget} onChange={(event) => { const value = event.target.value; setDeployTarget(value); if (value === "none") setAutoDeploy(false); }}><option value="none">仅保存</option><option value="nginx">Nginx</option><option value="xray">Xray</option><option value="both">Nginx + Xray</option></select></Field>
      </div>
      {deployTarget !== "none" ? <div className="cw-form-grid"><Field label="证书部署路径"><input required value={certPath} onChange={(event) => setCertPath(event.target.value)} /></Field><Field label="私钥部署路径"><input required value={keyPath} onChange={(event) => setKeyPath(event.target.value)} /></Field></div> : null}
      <div className="cw-checkboxes">{!manual ? <Toggle checked={autoRenew} onChange={setAutoRenew} label="自动续期" /> : null}<Toggle checked={autoDeploy} disabled={deployTarget === "none"} onChange={setAutoDeploy} label="续期后自动部署" /></div>
      <div className="cw-help"><Info size={16} /><span>更换 DNS 提供商后，新设置会在下一次续期时生效；当前证书文件不会被覆盖。</span></div>
      <div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在保存" /> : <><Save size={16} />保存设置</>}</Button></div>
    </form>
  </Dialog>;
}

function UploadCertificateDialog({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [domain, setDomain] = useState("");
  const [certPEM, setCertPEM] = useState("");
  const [keyPEM, setKeyPEM] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const readFile = async (file: File | undefined, setter: (value: string) => void) => { if (file) setter(await file.text()); };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError("");
    try { assertSuccess(await api.post<Envelope>("/api/admin/certificates/upload", { domain: domain.trim(), cert_pem: certPEM.trim(), key_pem: keyPEM.trim() }), "上传证书失败"); setKeyPEM(""); onComplete(); }
    catch (reason) { setError(fail(reason, "上传证书失败")); }
    finally { setWorking(false); }
  };
  return <Dialog title="上传证书" description="导入 PEM 证书链和对应私钥" onClose={onClose} wide><form className="cw-form" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<Field label="证书域名"><input required value={domain} onChange={(event) => setDomain(event.target.value)} /></Field><div className="cw-form-grid"><Field label="证书文件"><input type="file" accept=".pem,.crt,.cer" onChange={(event) => void readFile(event.target.files?.[0], setCertPEM)} /></Field><Field label="私钥文件"><input type="file" accept=".pem,.key" onChange={(event) => void readFile(event.target.files?.[0], setKeyPEM)} /></Field></div><Field label="证书链 PEM"><textarea required className="cw-dialog-code" value={certPEM} onChange={(event) => setCertPEM(event.target.value)} spellCheck={false} placeholder="-----BEGIN CERTIFICATE-----" /></Field><Field label="私钥 PEM"><textarea required className="cw-dialog-code is-private" value={keyPEM} onChange={(event) => setKeyPEM(event.target.value)} spellCheck={false} autoComplete="new-password" placeholder="私钥仅提交到服务器，不会回显" /></Field><div className="cw-help"><LockKeyhole size={16} /><span>私钥仅用于本次写入，证书列表和编辑页面不会读取或显示私钥内容。</span></div><div className="dialog-actions"><Button type="button" variant="secondary" onClick={() => { setKeyPEM(""); onClose(); }}>取消</Button><Button type="submit" disabled={working || !certPEM.trim() || !keyPEM.trim()}>{working ? <Spinner label="正在上传" /> : <><Upload size={16} />上传证书</>}</Button></div></form></Dialog>;
}

function DeployCertificateDialog({ item, onClose, onComplete }: { item: CertificateItem; onClose: () => void; onComplete: () => void }) {
  const name = certFilename(item.domain);
  const [target, setTarget] = useState(item.deploy_target && item.deploy_target !== "none" ? item.deploy_target : "both");
  const [certPath, setCertPath] = useState(item.deploy_cert_path || `/usr/local/nginx/cert/${name}.pem`);
  const [keyPath, setKeyPath] = useState(item.deploy_key_path || `/usr/local/nginx/cert/${name}.key`);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError("");
    try { assertSuccess(await api.post<Envelope>("/api/admin/certificates/deploy", { id: item.id, deploy_target: target, deploy_cert_path: certPath.trim(), deploy_key_path: keyPath.trim() }), "部署证书失败"); onComplete(); }
    catch (reason) { setError(fail(reason, "部署证书失败")); }
    finally { setWorking(false); }
  };
  return <Dialog title="手动部署证书" description={item.domain} onClose={onClose}><form className="cw-form" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<Field label="部署目标"><select value={target} onChange={(event) => setTarget(event.target.value)}><option value="nginx">Nginx</option><option value="xray">Xray</option><option value="both">Nginx + Xray</option></select></Field><Field label="证书路径"><input required value={certPath} onChange={(event) => setCertPath(event.target.value)} /></Field><Field label="私钥路径"><input required value={keyPath} onChange={(event) => setKeyPath(event.target.value)} /></Field><div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在部署" /> : <><Server size={16} />立即部署</>}</Button></div></form></Dialog>;
}

function DNSProviderDialog({ item, onClose, onComplete }: { item?: DNSProviderItem; onClose: () => void; onComplete: () => void }) {
  const [name, setName] = useState(item?.name || "");
  const [providerType, setProviderType] = useState(item?.provider_type || "cloudflare");
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [visibleCredentials, setVisibleCredentials] = useState<Record<string, boolean>>({});
  const [loadingCredentials, setLoadingCredentials] = useState(false);
  const [credentialsLoaded, setCredentialsLoaded] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const fields = dnsProviderFields[providerType] ?? [];
  const providerChanged = Boolean(item && providerType !== item.provider_type);
  const requiresFreshCredentials = !item || providerChanged;
  useEffect(() => {
    setCredentials({});
    setVisibleCredentials({});
    setCredentialsLoaded(false);
    setError("");
  }, [providerType]);
  const loadCredentials = async () => {
    if (!item || providerChanged) return;
    setLoadingCredentials(true); setError("");
    try {
      const payload = assertSuccess(await api.get<DNSProviderCredentialsResponse>(`/api/admin/dns-providers/${item.id}/credentials`), "读取 DNS 凭据失败");
      const next = credentialsForEditor(providerType, payload.credentials);
      setCredentials(next);
      setVisibleCredentials(Object.fromEntries(fields.filter((field) => field.type !== "email").map((field) => [field.key, true])));
      setCredentialsLoaded(true);
    } catch (reason) { setError(fail(reason, "读取 DNS 凭据失败")); }
    finally { setLoadingCredentials(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      let values: Record<string, string>;
      if (providerType === "cloudflare") {
        const email = (credentials.CF_API_EMAIL || "").trim();
        const secret = (credentials[cloudflareCredentialKey] || "").trim();
        if (email && !secret) throw new Error("填写账户邮箱时也必须输入 API 密钥");
        values = secret
          ? email ? { CF_API_EMAIL: email, CF_API_KEY: secret } : { CF_DNS_API_TOKEN: secret }
          : {};
      } else {
        values = Object.fromEntries(fields.flatMap((field) => {
          const value = (credentials[field.key] || "").trim();
          return value ? [[field.key, value]] : [];
        }));
        if (Object.keys(values).length > 0 && fields.some((field) => !field.optional && !values[field.key])) throw new Error("请完整输入该提供商所需的 DNS 凭据");
      }
      if (requiresFreshCredentials && Object.keys(values).length === 0) throw new Error(providerChanged ? "切换提供商后必须输入新提供商的 DNS 凭据" : "请输入 DNS API 凭据");
      const payload = { name: name.trim(), provider_type: providerType, credentials: JSON.stringify(values) };
      if (item) assertSuccess(await api.put<Envelope>(`/api/admin/dns-providers/${item.id}`, payload), "更新 DNS 提供商失败");
      else assertSuccess(await api.post<Envelope>("/api/admin/dns-providers/create", payload), "创建 DNS 提供商失败");
      setCredentials({}); onComplete();
    } catch (reason) { setError(fail(reason, item ? "更新 DNS 提供商失败" : "创建 DNS 提供商失败")); }
    finally { setWorking(false); }
  };
  return <Dialog title={item ? "编辑 DNS 提供商" : "添加 DNS 提供商"} description="凭据安全保存在服务器，编辑时可按需显示" onClose={onClose}>
    <form className="cw-form" onSubmit={submit}>
      {error ? <ErrorState message={error} /> : null}
      <Field label="名称"><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：Cloudflare 主账号" /></Field>
      <Field label="提供商类型"><select value={providerType} onChange={(event) => setProviderType(event.target.value)}>{Object.keys(dnsProviderFields).map((type) => <option key={type} value={type}>{type}</option>)}</select></Field>
      <div className="cw-form-section">
        <div className="cw-form-section-heading"><strong>{providerChanged ? "新提供商凭据" : "DNS API 凭据"}</strong>{item && !providerChanged ? <Button type="button" variant="secondary" disabled={loadingCredentials} onClick={() => void loadCredentials()}>{loadingCredentials ? <Spinner label="正在读取" /> : <><Eye size={15} />{credentialsLoaded ? "重新读取已保存凭据" : "显示已保存凭据"}</>}</Button> : null}</div>
        {providerType === "cloudflare" ? <p className="cw-section-hint">邮箱留空时按 API Token 使用；填写邮箱时按 Global API Key 使用。</p> : null}
        <div className="cw-form">{fields.map((field) => <Field key={field.key} label={field.label}>{field.type === "email" ? <input required={requiresFreshCredentials && !field.optional} type="email" autoComplete="email" value={credentials[field.key] || ""} onChange={(event) => setCredentials((current) => ({ ...current, [field.key]: event.target.value }))} /> : <div className="cw-secret-field"><input required={requiresFreshCredentials && !field.optional} type={visibleCredentials[field.key] ? "text" : "password"} autoComplete="new-password" value={credentials[field.key] || ""} onChange={(event) => setCredentials((current) => ({ ...current, [field.key]: event.target.value }))} /><IconButton type="button" label={`${visibleCredentials[field.key] ? "隐藏" : "显示"} ${field.label}`} onClick={() => setVisibleCredentials((current) => ({ ...current, [field.key]: !current[field.key] }))}>{visibleCredentials[field.key] ? <EyeOff size={16} /> : <Eye size={16} />}</IconButton></div>}</Field>)}</div>
      </div>
      <div className="cw-help"><KeyRound size={16} /><span>{item && !providerChanged ? "不读取或不输入新凭据时会保留现有凭据；显示后可以直接修改并保存。" : providerChanged ? "提供商类型已变更，请输入新提供商的完整凭据。" : "保存后可在编辑窗口中按需显示凭据。"}</span></div>
      <div className="dialog-actions"><Button type="button" variant="secondary" onClick={() => { setCredentials({}); onClose(); }}>取消</Button><Button type="submit" disabled={working || loadingCredentials}>{working ? <Spinner label="正在保存" /> : <><Save size={16} />保存</>}</Button></div>
    </form>
  </Dialog>;
}
