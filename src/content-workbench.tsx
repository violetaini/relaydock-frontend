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
  Gauge,
  Globe,
  Globe2,
  Info,
  KeyRound,
  Layers,
  Link2,
  LockKeyhole,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Square,
  Star,
  Trash2,
  Upload,
  WandSparkles,
  X,
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
import { SubscriptionManager, SubscriptionOutputRules, type SubscriptionGeneration, type SubscriptionOutput } from "./subscription-workbench";

export type ContentNotify = (message: string, tone?: "success" | "error") => void;
export interface ContentPageProps {
  notify?: ContentNotify;
  onOpenCustomRules?: () => void;
  onOpenRulesConfig?: () => void;
  isAdmin?: boolean;
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
export interface NodeItem {
  id: number;
  node_name: string;
  protocol: string;
  clash_config: string;
  subscription_eligible?: boolean;
  subscription_ineligible_reason?: string;
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
export interface SubscribeFile {
  kind?: "external" | "custom" | "strategy";
  generation?: SubscriptionGeneration;
  id: number;
  name: string;
  description?: string;
  url?: string;
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
  auto_update_interval?: number;
  last_sync_at?: string;
  updated_at?: string;
  latest_version?: number;
}
export interface CustomRuleOption {
  id: number;
  name: string;
  type: "dns" | "rules" | "rule-providers" | string;
  enabled: boolean;
}
export interface OverrideScriptOption {
  id: number;
  name: string;
  hook: "post_fetch" | "pre_save_nodes" | string;
  enabled: boolean;
}
export interface ProxyProviderConfig {
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

function proxyProviderMode(value: string): "client" | "server" | null {
  switch (value.trim().toLowerCase()) {
    case "":
    case "client": return "client";
    case "server":
    case "mmw": return "server";
    default: return null;
  }
}

export interface ExternalSubscription {
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
export interface RemoteServerItem { id: number; name: string }

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
  huaweicloud: [
    { label: "AccessKey ID (AK)", key: "HUAWEICLOUD_ACCESS_KEY_ID" },
    { label: "Secret Access Key (SK)", key: "HUAWEICLOUD_SECRET_ACCESS_KEY" },
    { label: "Region 区域代码（可选，默认 cn-north-4）", key: "HUAWEICLOUD_REGION", optional: true },
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
  if (providerType === "cloudflare") {
    return {
      CF_API_EMAIL: stored.CF_API_EMAIL || "",
      [cloudflareCredentialKey]: stored.CF_DNS_API_TOKEN || stored.CF_API_KEY || stored[cloudflareCredentialKey] || "",
    };
  }
  if (providerType === "huaweicloud" || providerType === "huawei") {
    return {
      HUAWEICLOUD_ACCESS_KEY_ID: stored.HUAWEICLOUD_ACCESS_KEY_ID || stored.AccessKeyId || stored.ak || "",
      HUAWEICLOUD_SECRET_ACCESS_KEY: stored.HUAWEICLOUD_SECRET_ACCESS_KEY || stored.SecretAccessKey || stored.sk || "",
      HUAWEICLOUD_REGION: stored.HUAWEICLOUD_REGION || stored.Region || stored.region || "cn-north-4",
    };
  }
  return stored;
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
    auto_update_interval: next.auto_update_interval ?? 0,
  };
}

type FilePendingAction =
  | { kind: "delete-file"; item: SubscribeFile }
  | { kind: "delete-external"; item: ExternalSubscription }
  | { kind: "delete-provider"; item: ProxyProviderConfig }
  | { kind: "rotate-provider"; item: ProxyProviderConfig };

function formatInterval(seconds?: number) {
  if (!seconds || seconds <= 0) return "手动同步";
  if (seconds % 86400 === 0) return `每 ${seconds / 86400} 天`;
  if (seconds % 3600 === 0) return `每 ${seconds / 3600} 小时`;
  if (seconds % 60 === 0) return `每 ${seconds / 60} 分钟`;
  return `${seconds} 秒`;
}

export function SubscribeFilesPage(props: ContentPageProps) {
  return <SubscriptionManager {...props} ImportDialog={ImportSubscriptionDialog} ContentDialog={EditSubscribeContentDialog} />;
}

function ImportSubscriptionDialog({ templates, onClose, onComplete }: {
  templates: string[];
  onClose: (created: boolean) => void;
  onComplete: () => void;
}) {
  const [mode, setMode] = useState<"url" | "local">("url");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setURL] = useState("");
  const [filename, setFilename] = useState("");
  const [pastedContent, setPastedContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [advanced, setAdvanced] = useState(false);
  const [output, setOutput] = useState<SubscriptionOutput>({ client: "clashmeta", mode: "source", template_filename: templates[0] || "" });
  const [autoUpdateInterval, setAutoUpdateInterval] = useState(0);
  const [createdFile, setCreatedFile] = useState<SubscribeFile | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const close = () => { if (!working) onClose(Boolean(createdFile)); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (working) return;
    setWorking(true); setError("");
    try {
      if (advanced && output.mode === "full" && output.rule_mode !== "custom" && !output.template_filename) throw new Error("请选择规则模板或使用自定义规则");
      let importedFile = createdFile;
      if (!importedFile) {
        let result: { file?: SubscribeFile };
        if (mode === "url") {
          result = await api.post<{ file?: SubscribeFile }>("/api/admin/subscribe-files/import", {
            name, description, url, filename: filename ? normalizedFilename(filename) : "", auto_update_interval: autoUpdateInterval,
          });
        } else {
          if (!pastedContent.trim()) throw new Error("请选择订阅文件或粘贴节点内容");
          const upload = new File([pastedContent], normalizedFilename(filename || file?.name || name || "subscription"), { type: "text/plain" });
          const form = new FormData();
          form.set("file", upload); form.set("name", name || upload.name.replace(/\.ya?ml$/i, "")); form.set("description", description);
          if (filename) form.set("filename", normalizedFilename(filename));
          result = await request<{ file?: SubscribeFile }>("/api/admin/subscribe-files/upload", { method: "POST", body: form });
        }
        if (!result.file?.id) throw new Error("订阅已导入，但未能读取文件信息，请刷新后重试");
        importedFile = result.file; setCreatedFile(result.file);
      }
      if (advanced) await api.post("/api/admin/subscribe-files/generation", {
        id: importedFile.id,
        generation: { kind: "external", source_ids: [], processing: { deduplicate: false, remove_dead: false, sort: "source" }, outputs: [output] },
      });
      onComplete();
    } catch (reason) { setError(fail(reason, "添加订阅失败")); }
    finally { setWorking(false); }
  };
  const readLocalFile = async (selected: File | undefined) => {
    if (!selected) return;
    setWorking(true); setError("");
    try { const content = await selected.text(); setPastedContent(content); setFile(selected); }
    catch { setError("读取文件失败，请重新选择或直接粘贴内容"); }
    finally { setWorking(false); }
  };
  return <Dialog title="添加订阅" description="通过链接或本地内容导入，支持 Clash YAML、JSON 与 URI / Base64 节点订阅" onClose={close} dismissible={!working} wide>
    <form onSubmit={submit}><fieldset className="cw-form cw-import-fields" disabled={working}>
      {error && <ErrorState message={error} />}
      {createdFile && <div className="cw-help"><Info size={16} /><span>订阅“{createdFile.name}”已导入；再次提交只会重试尚未保存的高级设置，不会重复创建。</span></div>}
      <div className="cw-mode">
        <button type="button" disabled={Boolean(createdFile)} className={mode === "url" ? "is-active" : ""} onClick={() => setMode("url")}><Link2 size={16} />链接导入</button>
        <button type="button" disabled={Boolean(createdFile)} className={mode === "local" ? "is-active" : ""} onClick={() => setMode("local")}><Upload size={16} />本地导入</button>
      </div>
      <div className="cw-form-grid">
        <Field label="订阅名称"><input disabled={Boolean(createdFile)} required={mode === "url"} value={name} onChange={event => setName(event.target.value)} placeholder="例如：机场订阅" /></Field>
        <Field label="文件名" hint="留空时自动生成"><input disabled={Boolean(createdFile)} value={filename} onChange={event => setFilename(event.target.value)} placeholder="subscription.yaml" /></Field>
      </div>
      {mode === "url" ? <>
        <Field label="订阅 URL"><input disabled={Boolean(createdFile)} required type="url" value={url} onChange={event => setURL(event.target.value)} placeholder="https://example.com/subscribe" /></Field>
        <Field label="自动更新时间" hint="按设定周期重新拉取链接；本地导入的内容不会自动更新">
          <select disabled={Boolean(createdFile)} value={autoUpdateInterval} onChange={event => setAutoUpdateInterval(Number(event.target.value))}>
            <option value={0}>不自动更新（仅手动同步）</option><option value={3600}>每 1 小时</option><option value={7200}>每 2 小时</option><option value={21600}>每 6 小时</option><option value={43200}>每 12 小时</option><option value={86400}>每 24 小时（1 天）</option><option value={172800}>每 48 小时（2 天）</option><option value={604800}>每周（7 天）</option>
          </select>
        </Field>
      </> : <>
        <div className="cw-local-file">
          <span className="field-label">订阅文件</span>
          <input ref={fileInput} hidden aria-label="选择订阅文件" disabled={Boolean(createdFile)} type="file" accept=".yaml,.yml,.json,.txt,.conf,application/yaml,text/yaml,application/json,text/plain" onChange={event => { void readLocalFile(event.target.files?.[0]); event.target.value = ""; }} />
          <div className={`cw-file-picker ${file ? "has-file" : ""}`}>
            <span className="cw-file-symbol"><FileText size={23} /></span>
            <div className="cw-file-info"><strong>{file?.name || "尚未选择文件"}</strong><small>{file ? "内容已填入下方，可继续修改" : "支持 YAML、JSON、TXT 或节点订阅文件"}</small></div>
            <Button type="button" variant="secondary" disabled={Boolean(createdFile)} onClick={() => fileInput.current?.click()}><Upload size={15} />{file ? "重新选择" : "选择文件"}</Button>
          </div>
        </div>
        <Field label="订阅内容" hint="可直接粘贴，或选择文件自动填入；最终以下方编辑内容为准。">
          <textarea required disabled={Boolean(createdFile)} value={pastedContent} onChange={event => setPastedContent(event.target.value)} placeholder="粘贴 Clash YAML、JSON、节点分享链接或 Base64 订阅" spellCheck={false} />
        </Field>
      </>}
      <Field label="说明"><textarea disabled={Boolean(createdFile)} value={description} onChange={event => setDescription(event.target.value)} placeholder="可选" /></Field>
      <Button type="button" variant="ghost" disabled={Boolean(createdFile)} aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}><Settings2 size={16} />{advanced ? "收起高级配置" : "高级配置 · 分流规则"}</Button>
      {advanced && <section className="cw-import-rules" aria-label="分流规则配置">
        <Field label="规则配置"><select value={output.mode} onChange={event => setOutput(current => ({ ...current, mode: event.target.value as SubscriptionOutput["mode"] }))}><option value="full">完整配置（分流规则）</option><option value="source">保留上游规则</option><option value="nodes">仅输出节点</option></select></Field>
        <SubscriptionOutputRules out={output} index={0} templates={templates} onChange={next => setOutput(current => ({ ...current, ...next }))} />
        {output.mode === "source" && <p className="sm-hint">保留导入内容中的分组、分流和 DNS。</p>}
      </section>}
      <div className="dialog-actions cw-import-actions"><Button type="button" variant="secondary" onClick={close}>取消</Button><Button type="submit">{working ? <Spinner label={createdFile ? "正在保存" : "正在导入"} /> : createdFile ? "重试高级设置" : "添加"}</Button></div>
    </fieldset></form>
  </Dialog>;
}

function CreateCustomSubscriptionDialog({
  nodes,
  templates,
  isAdmin,
  onClose,
  onComplete,
}: {
  nodes: NodeItem[];
  templates: string[];
  rules?: CustomRuleOption[];
  scripts?: OverrideScriptOption[];
  servers?: RemoteServerItem[];
  isAdmin: boolean;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [name, setName] = useState("");
  const [filename, setFilename] = useState("");
  const [description, setDescription] = useState("");
  const [templateFilename, setTemplateFilename] = useState(templates[0] || "");
  const [trafficLimit, setTrafficLimit] = useState("");
  const [selectedNodeIDs, setSelectedNodeIDs] = useState<Set<number>>(() => new Set(nodes.filter((n) => n.enabled).map((n) => n.id)));
  const [nodeFilter, setNodeFilter] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const toggle = (setter: Dispatch<SetStateAction<Set<number>>>, id: number) =>
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const visibleNodes = useMemo(() => {
    if (!nodeFilter.trim()) return nodes;
    const q = nodeFilter.trim().toLowerCase();
    return nodes.filter(
      (n) =>
        n.node_name.toLowerCase().includes(q) ||
        (n.protocol && n.protocol.toLowerCase().includes(q)) ||
        (n.tags && n.tags.some((t) => t.toLowerCase().includes(q)))
    );
  }, [nodes, nodeFilter]);

  const isAllVisibleSelected =
    visibleNodes.length > 0 && visibleNodes.every((n) => selectedNodeIDs.has(n.id));

  const toggleSelectAllNodes = () => {
    if (isAllVisibleSelected) {
      setSelectedNodeIDs((current) => {
        const next = new Set(current);
        visibleNodes.forEach((n) => next.delete(n.id));
        return next;
      });
    } else {
      setSelectedNodeIDs((current) => {
        const next = new Set(current);
        visibleNodes.forEach((n) => next.add(n.id));
        return next;
      });
    }
  };

  const deselectAllNodes = () => {
    setSelectedNodeIDs(new Set());
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      if (!name.trim()) throw new Error("请输入自选订阅名称");
      const limit = trafficLimit.trim() ? Number(trafficLimit) : null;
      if (limit != null && (!Number.isFinite(limit) || limit < 0)) {
        throw new Error("总流量阀门必须是大于等于 0 的 GB 数值");
      }
      if (!isAdmin && limit != null) {
        throw new Error("普通用户无权设置或修改流量限制");
      }

      const cleanFilename = normalizedFilename(filename || name);
      const createRes = await api.post<{ file?: SubscribeFile }>("/api/admin/subscribe-files/create-from-config", {
        name: name.trim(),
        description: description.trim(),
        filename: cleanFilename,
        content: "proxies: []\n",
      });

      const file = createRes.file;
      if (!file?.id) {
        throw new Error("订阅创建失败，后端未返回文件 ID");
      }

      await api.put(`/api/admin/subscribe-files/${file.id}`, {
        name: file.name,
        description: file.description || "",
        type: "create",
        filename: file.filename,
        template_filename: templateFilename,
        selected_node_ids: [...selectedNodeIDs],
        selected_tags: [],
        selected_custom_rule_ids: [],
        selected_override_script_ids: [],
        stats_server_ids: "",
        traffic_limit: isAdmin ? limit : null,
        auto_sync_custom_rules: true,
        raw_output: false,
        auto_update_interval: 0,
      });

      onComplete();
    } catch (reason) {
      setError(fail(reason, "创建自选订阅失败"));
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog title="创建自选订阅" description="从自建节点与转发中继自选组装，设置专属流量阀门与分流模板" onClose={onClose} dismissible={!working} wide>
      <form className="cw-form" onSubmit={submit}>
        {error ? <ErrorState message={error} /> : null}

        <div className="cw-form-grid">
          <Field label="订阅名称">
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：自建专线集合" />
          </Field>
          <Field label="文件名" hint="留空根据名称自动生成 .yaml 结尾">
            <input value={filename} onChange={(e) => setFilename(e.target.value)} placeholder="custom-sub.yaml" />
          </Field>
        </div>

        <div className="cw-form-grid">
          <Field label="绑定 V3 分流模板" hint="自选节点将自动注入到模板中的策略组">
            <select value={templateFilename} onChange={(e) => setTemplateFilename(e.target.value)}>
              <option value="">不绑定模板（仅输出纯节点）</option>
              {templates.map((tpl) => (
                <option value={tpl} key={tpl}>{tpl}</option>
              ))}
            </select>
          </Field>
          <Field label="总流量阀门（GB）" hint={isAdmin ? "达到该流量后自动阻断或警报；留空表示不限制" : "仅管理员有权配置或修改流量阀门"}>
            <input
              type="number"
              min="0"
              step="0.1"
              disabled={!isAdmin}
              value={trafficLimit}
              onChange={(e) => setTrafficLimit(e.target.value)}
              placeholder={isAdmin ? "例如：100（单位 GB）" : "无权限配置"}
            />
          </Field>
        </div>

        <Field label="说明">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="可选备注说明" />
        </Field>

        <div className="cw-form-section cw-node-picker-section">
          <div className="cw-node-picker-toolbar">
            <div className="cw-node-picker-title-group">
              <strong className="cw-node-picker-title">选择自选节点</strong>
              <span className="badge badge-info cw-node-picker-counter">
                已选 {selectedNodeIDs.size} / {nodes.length} 个节点
              </span>
            </div>
            <div className="cw-node-picker-actions">
              <button
                type="button"
                className="button button-secondary button-sm"
                onClick={toggleSelectAllNodes}
                title={isAllVisibleSelected ? "当前已全选，点击清除" : "全选节点"}
              >
                全选
              </button>
              <button type="button" className="button button-secondary button-sm" onClick={deselectAllNodes}>清空</button>
            </div>
          </div>

          <div className="search-box nw-search cw-node-picker-search">
            <Search size={16} />
            <input
              type="search"
              value={nodeFilter}
              onChange={(e) => setNodeFilter(e.target.value)}
              placeholder="搜索节点名称、协议或标签..."
            />
            {nodeFilter ? (
              <button type="button" className="nw-search-clear" onClick={() => setNodeFilter("")} title="清除搜索">
                <X size={14} />
              </button>
            ) : null}
          </div>

          {nodes.length === 0 ? (
            <p className="cw-section-hint">当前系统暂无可用节点，可在「节点管理」中先添加节点。</p>
          ) : visibleNodes.length === 0 ? (
            <div className="cw-node-picker-empty">
              <span>未找到与“{nodeFilter}”匹配的节点</span>
            </div>
          ) : (
            <div className="cw-node-select-grid">
              {visibleNodes.map((node) => {
                const isChecked = selectedNodeIDs.has(node.id);
                return (
                  <label
                    className={`cw-node-card ${isChecked ? "is-selected" : ""} ${!node.enabled ? "is-disabled" : ""}`}
                    key={node.id}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggle(setSelectedNodeIDs, node.id)}
                    />
                    <div className="cw-node-card-body">
                      <div className="cw-node-card-header">
                        <strong title={node.node_name}>{node.node_name}</strong>
                      </div>
                      <div className="cw-node-card-meta">
                        <span className="cw-node-proto-tag">{node.protocol || "未知协议"}</span>
                        {!node.enabled ? (
                          <span className="cw-node-status-tag">已停用</span>
                        ) : null}
                        {node.tags && node.tags.length > 0 ? (
                          <span className="cw-node-tag-item" title={node.tags.join(", ")}>
                            {node.tags.slice(0, 2).join(", ")}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="dialog-actions">
          <Button type="button" variant="secondary" disabled={working} onClick={onClose}>取消</Button>
          <Button type="submit" disabled={working}>
            {working ? <Spinner label="正在创建自选订阅" /> : "创建自选订阅"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
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
  const [autoUpdateInterval, setAutoUpdateInterval] = useState(item.auto_update_interval ?? 0);
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
  const isExternal = item.type === "import" || Boolean(item.url);
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
        selected_node_ids: isExternal ? [] : [...selectedNodeIDs],
        selected_tags: isExternal ? [] : selectedTags.split(",").map((tag) => tag.trim()).filter(Boolean),
        selected_custom_rule_ids: ruleScope === "all" ? [] : [...selectedRuleIDs],
        selected_override_script_ids: scriptScope === "all" ? [] : [...selectedScriptIDs],
        stats_server_ids: isExternal ? "" : [...selectedServerIDs].join(","),
        traffic_limit: isExternal ? null : limit,
        auto_update_interval: autoUpdateInterval,
      }));
      onComplete();
    } catch (reason) { setError(fail(reason, "更新订阅失败")); }
    finally { setWorking(false); }
  };
  return <Dialog title="编辑订阅" description={item.filename} onClose={onClose} wide><form className="cw-form" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}
    <div className="cw-form-grid"><Field label="订阅名称"><input required value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="文件名"><input required value={filename} onChange={(event) => setFilename(event.target.value)} /></Field></div>
    <Field label="说明"><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
    <div className="cw-form-grid"><Field label="自定义短码" hint="留空使用系统短码；普通用户不能修改全局短码"><input value={shortCode} onChange={(event) => setShortCode(event.target.value)} /></Field><Field label="V3 模板"><select value={templateFilename} onChange={(event) => setTemplateFilename(event.target.value)}><option value="">不绑定模板</option>{templates.map((template) => <option value={template} key={template}>{template}</option>)}</select></Field></div>
    {item.type === "import" || Boolean(item.url) ? <Field label="自动更新时间" hint={item.last_sync_at ? `上次同步时间：${formatDate(item.last_sync_at)}` : "定期自动重新拉取外部订阅链接并更新配置文件"}><select value={autoUpdateInterval} onChange={(event) => setAutoUpdateInterval(Number(event.target.value))}><option value={0}>不自动更新（仅手动同步）</option><option value={3600}>每 1 小时</option><option value={7200}>每 2 小时</option><option value={21600}>每 6 小时</option><option value={43200}>每 12 小时</option><option value={86400}>每 24 小时（1 天）</option><option value={172800}>每 48 小时（2 天）</option><option value={604800}>每周（7 天）</option></select></Field> : null}
    <div className="cw-checkboxes"><Toggle checked={autoSync} onChange={setAutoSync} label="自动同步自定义规则" /><Toggle checked={rawOutput} onChange={setRawOutput} label="输出原始配置" /></div>
    {!isExternal ? (
      <div className="cw-form-section"><strong>节点范围</strong><p className="cw-section-hint">选择节点 ID 时优先使用该范围；不选节点时才按下方标签过滤，两者都为空表示全部可用节点。</p><div className="cw-option-grid">{nodes.map((node) => <label className="cw-option-check" key={node.id}><input type="checkbox" checked={selectedNodeIDs.has(node.id)} onChange={() => toggleID(setSelectedNodeIDs, node.id)} /><span><strong>{node.node_name}</strong><small>{node.protocol || "未知协议"}{node.enabled ? "" : " · 已停用"}</small></span></label>)}</div><Field label="旧版标签范围" hint="逗号分隔；仅在未选择节点 ID 时生效"><input value={selectedTags} onChange={(event) => setSelectedTags(event.target.value)} placeholder="hk, premium" /></Field></div>
    ) : null}
    <div className="cw-form-grid">
      <div className="cw-form-section"><strong>覆写规则</strong><Field label="应用范围"><select value={ruleScope} onChange={(event) => setRuleScope(event.target.value as "all" | "selected")}><option value="all">全部已启用规则（空 ID 数组）</option><option value="selected">仅选择的规则</option></select></Field>{ruleScope === "selected" ? <div className="cw-option-stack">{rules.map((rule) => <label className="cw-option-check" key={rule.id}><input type="checkbox" checked={selectedRuleIDs.has(rule.id)} onChange={() => toggleID(setSelectedRuleIDs, rule.id)} /><span><strong>{rule.name}</strong><small>{rule.type}{rule.enabled ? "" : " · 已停用"}</small></span></label>)}</div> : null}</div>
      <div className="cw-form-section"><strong>覆写脚本</strong><Field label="应用范围"><select value={scriptScope} onChange={(event) => setScriptScope(event.target.value as "all" | "selected")}><option value="all">全部已启用脚本（空 ID 数组）</option><option value="selected">仅选择的脚本</option></select></Field>{scriptScope === "selected" ? <div className="cw-option-stack">{scripts.map((script) => <label className="cw-option-check" key={script.id}><input type="checkbox" checked={selectedScriptIDs.has(script.id)} onChange={() => toggleID(setSelectedScriptIDs, script.id)} /><span><strong>{script.name}</strong><small>{script.hook}{script.enabled ? "" : " · 已停用"}</small></span></label>)}</div> : null}</div>
    </div>
    {!isExternal ? (
      <div className="cw-form-section"><strong>流量统计</strong><p className="cw-section-hint">不选服务器时汇总全部服务器；手动上限按后端契约使用 GB，留空表示跟随服务器或用户套餐。</p><div className="cw-option-grid">{servers.map((server) => <label className="cw-option-check" key={server.id}><input type="checkbox" checked={selectedServerIDs.has(server.id)} onChange={() => toggleID(setSelectedServerIDs, server.id)} /><span><strong>{server.name}</strong><small>服务器 #{server.id}</small></span></label>)}</div><Field label="手动流量上限（GB）"><input type="number" min="0" step="0.1" value={trafficLimit} onChange={(event) => setTrafficLimit(event.target.value)} placeholder="留空跟随统计范围" /></Field></div>
    ) : null}
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
  const legacyUnsupportedFields = [
    item?.type && item.type.trim().toLowerCase() !== "http" ? "Provider 类型" : "",
    item?.header?.trim() ? "自定义请求头" : "",
    item?.geo_ip_filter?.trim() ? "GeoIP 过滤" : "",
    item?.override?.trim() ? "Override" : "",
  ].filter(Boolean);
  const [name, setName] = useState(item?.name || "");
  const [subscriptionID, setSubscriptionID] = useState(item?.external_subscription_id || subscriptions[0]?.id || 0);
  const [interval, setInterval] = useState(item?.interval || 3600);
  const [processMode, setProcessMode] = useState(proxyProviderMode(item?.process_mode || "client") || "client");
  const [proxy, setProxy] = useState(item?.proxy || "");
  const [sizeLimit, setSizeLimit] = useState(item?.size_limit || 0);
  const [healthEnabled, setHealthEnabled] = useState(item?.health_check_enabled ?? true);
  const [healthURL, setHealthURL] = useState(item?.health_check_url || "https://cp.cloudflare.com/generate_204");
  const [healthInterval, setHealthInterval] = useState(item?.health_check_interval || 300);
  const [healthTimeout, setHealthTimeout] = useState(item?.health_check_timeout || 5000);
  const [healthLazy, setHealthLazy] = useState(item?.health_check_lazy ?? true);
  const [expectedStatus, setExpectedStatus] = useState(item?.health_check_expected_status || 204);
  const [filter, setFilter] = useState(item?.filter || "");
  const [excludeFilter, setExcludeFilter] = useState(item?.exclude_filter || "");
  const [excludeType, setExcludeType] = useState(item?.exclude_type || "");
  const [advanced, setAdvanced] = useState(false);
  const [legacyResetConfirmed, setLegacyResetConfirmed] = useState(legacyUnsupportedFields.length === 0);
  const [filterResult, setFilterResult] = useState("");
  const [working, setWorking] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const payload = () => ({
    external_subscription_id: subscriptionID,
    name: name.trim(),
    type: "http",
    interval,
    proxy: proxy.trim(),
    size_limit: sizeLimit,
    header: "",
    health_check_enabled: healthEnabled,
    health_check_url: healthURL.trim(),
    health_check_interval: healthInterval,
    health_check_timeout: healthTimeout,
    health_check_lazy: healthLazy,
    health_check_expected_status: expectedStatus,
    filter: filter.trim(),
    exclude_filter: excludeFilter.trim(),
    exclude_type: excludeType.trim(),
    geo_ip_filter: "",
    override: "",
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
        geo_ip_filter: "",
      });
      setFilterResult(result.has_matches ? `匹配 ${result.match_count ?? 0} 个节点` : "没有匹配节点");
    } catch (reason) { setError(fail(reason, "过滤条件校验失败")); }
    finally { setChecking(false); }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      if (!subscriptionID) throw new Error("请选择外部订阅");
      if (legacyUnsupportedFields.length && !legacyResetConfirmed) throw new Error("请先确认移除旧版不兼容字段");
      if (interval < 60 || interval > 604800) throw new Error("更新间隔必须在 60 到 604800 秒之间");
      if (healthInterval < 60 || healthInterval > 604800) throw new Error("健康检查间隔必须在 60 到 604800 秒之间");
      if (healthTimeout < 100 || healthTimeout > 60000) throw new Error("健康检查超时必须在 100 到 60000 毫秒之间");
      if (sizeLimit < 0 || sizeLimit > 52428800) throw new Error("内容大小上限必须在 0 到 52428800 字节之间");
      if (healthEnabled && !healthURL.trim()) throw new Error("启用健康检查时必须填写检测 URL");
      if (item) await api.put(`/api/user/proxy-provider-configs?id=${item.id}`, payload());
      else await api.post("/api/user/proxy-provider-configs", payload());
      onComplete();
    } catch (reason) { setError(fail(reason, item ? "更新 Proxy Provider 失败" : "创建 Proxy Provider 失败")); }
    finally { setWorking(false); }
  };

  return <Dialog title={item ? "编辑策略订阅 (Proxy Provider)" : "创建策略订阅 (Proxy Provider)"} description="从外部订阅生成可复用的 Mihomo 策略调度节点来源" onClose={onClose} dismissible={!working} wide><form className="cw-form" onSubmit={submit} aria-busy={working}>{error ? <ErrorState message={error} /> : null}
    {subscriptions.length === 0 ? <ErrorState message="尚无外部订阅，必须先在“外部订阅”页添加来源。" /> : null}
    <fieldset className="cw-lock-fields" disabled={working}>
    {legacyUnsupportedFields.length ? <div className="cw-help" role="alert"><Info size={16} /><span>此旧配置包含当前运行时不支持的字段：{legacyUnsupportedFields.join("、")}。保存前必须确认移除这些字段。</span></div> : null}
    {legacyUnsupportedFields.length ? <Toggle checked={legacyResetConfirmed} onChange={setLegacyResetConfirmed} label="确认移除旧版不兼容字段" /> : null}
    <div className="cw-form-grid"><Field label="策略订阅名称"><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="airport-hk" aria-label="Provider 名称" /></Field><Field label="外部订阅"><select required value={subscriptionID} onChange={(event) => setSubscriptionID(Number(event.target.value))}><option value={0}>请选择</option>{subscriptions.map((subscription) => <option value={subscription.id} key={subscription.id}>{subscription.name}</option>)}</select></Field><Field label="Provider 类型" hint="Arcway 通过受保护的 HTTP 端点提供节点内容"><select aria-label="Provider 类型" value="http" disabled><option value="http">HTTP</option></select></Field><Field label="处理模式" hint={processMode === "server" ? "Arcway 在生成订阅时拉取并展开节点" : "Mihomo 从 Arcway 的受保护端点按需拉取节点"}><select aria-label="处理模式" value={processMode} onChange={(event) => { const mode = proxyProviderMode(event.target.value); if (mode) setProcessMode(mode); }}><option value="client">Mihomo 拉取（客户端）</option><option value="server">Arcway 展开（服务端）</option></select></Field><Field label="更新间隔（秒）"><input type="number" min="60" max="604800" value={interval} onChange={(event) => setInterval(Number(event.target.value))} /></Field><Field label="拉取代理" hint="可填代理组名称或 DIRECT"><input value={proxy} onChange={(event) => setProxy(event.target.value)} placeholder="DIRECT" /></Field></div>
    <div className="cw-form-section"><strong>节点连通性检查</strong><Toggle checked={healthEnabled} onChange={setHealthEnabled} label="由 Mihomo 定时测试 Provider 节点连通性" />{healthEnabled ? <><Field label="节点测试 URL"><input required type="url" value={healthURL} onChange={(event) => setHealthURL(event.target.value)} /></Field><div className="cw-form-grid"><Field label="检查间隔（秒）"><input type="number" min="60" max="604800" value={healthInterval} onChange={(event) => setHealthInterval(Number(event.target.value))} /></Field><Field label="超时（毫秒）"><input type="number" min="100" max="60000" value={healthTimeout} onChange={(event) => setHealthTimeout(Number(event.target.value))} /></Field><Field label="预期 HTTP 状态"><input type="number" min="100" max="599" value={expectedStatus} onChange={(event) => setExpectedStatus(Number(event.target.value))} /></Field><div className="cw-toggle-field"><Toggle checked={healthLazy} onChange={setHealthLazy} label="Lazy 检测" /></div></div><div className="cw-help"><Info size={16} /><span>该 URL 由 Mihomo 通过各节点请求，用于判断连通性和延迟；Arcway 不会用它测试外部订阅地址。</span></div></> : null}</div>
    <div className="cw-form-section"><strong>节点过滤</strong><div className="cw-form-grid"><Field label="包含名称（正则）"><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="香港|HK" /></Field><Field label="排除名称（正则）"><input value={excludeFilter} onChange={(event) => setExcludeFilter(event.target.value)} placeholder="测试|到期" /></Field><Field label="排除协议类型（正则）"><input value={excludeType} onChange={(event) => setExcludeType(event.target.value)} placeholder="ss|vmess" /></Field></div><div className="cw-toolbar"><Button type="button" variant="secondary" onClick={() => void checkFilter()} disabled={checking || !subscriptionID}>{checking ? <Spinner label="正在检查" /> : "检查匹配"}</Button>{filterResult ? <Badge tone={filterResult.startsWith("匹配") ? "good" : "warn"}>{filterResult}</Badge> : null}</div></div>
    <Button type="button" variant="ghost" onClick={() => setAdvanced((value) => !value)}><Settings2 size={16} />{advanced ? "收起高级字段" : "展开高级字段"}</Button>
    {advanced ? <div className="cw-form-section"><strong>高级限制</strong><Field label="内容大小上限（字节）" hint="0 表示使用 Arcway 全局安全上限"><input type="number" min="0" max="52428800" value={sizeLimit} onChange={(event) => setSizeLimit(Number(event.target.value))} /></Field><div className="cw-help"><Info size={16} /><span>上游 User-Agent 请在外部订阅中设置；运行时 Provider 不接受任意请求头或未定义的 Override 原文。</span></div></div> : null}
    <div className="dialog-actions"><Button type="button" variant="secondary" disabled={working} onClick={onClose}>取消</Button><Button type="submit" aria-label="保存 Provider" disabled={working || checking || subscriptions.length === 0 || (legacyUnsupportedFields.length > 0 && !legacyResetConfirmed)}>{working ? <Spinner label="正在保存" /> : "保存策略订阅"}</Button></div>
    </fieldset>
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
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "default" | "mine" | "builtin">("all");
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

  const filteredTemplates = useMemo(() => {
    return templates.filter((filename) => {
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const readable = filename.replace(/\.ya?ml$/i, "").replaceAll("_", " ").toLowerCase();
        if (!filename.toLowerCase().includes(q) && !readable.includes(q)) return false;
      }
      const owner = owners[filename];
      const isDefault = defaultTemplate === filename;
      if (filter === "default") return isDefault;
      if (filter === "mine") return Boolean(username && owner === username);
      if (filter === "builtin") return !owner;
      return true;
    });
  }, [templates, search, filter, owners, defaultTemplate, username]);

  return (
    <section className="cw-page">
      <PageHeader
        title="模板管理"
        description="管理 V3 规则模板，支持结构化设计、导入、转换、预览和 YAML 编辑"
        actions={
          <>
            <IconButton label="刷新模板" onClick={() => void load()}>
              <RefreshCw size={18} />
            </IconButton>
            <Button variant="secondary" onClick={() => setShowVisual(true)}>
              <WandSparkles size={16} />
              可视化设计
            </Button>
            <Button onClick={() => setShowCreate(true)}>
              <Plus size={16} />
              新建模板
            </Button>
          </>
        }
      />
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      <Surface className="nw-command-surface cw-template-command-surface">
        <div className="nw-command-row">
          <div className="search-box nw-search cw-template-search">
            <Search size={17} />
            <input
              aria-label="搜索模板"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索模板文件名..."
            />
          </div>
          <div className="segmented-control cw-template-filter" role="tablist" aria-label="模板筛选">
            <button
              type="button"
              role="tab"
              aria-selected={filter === "all"}
              className={filter === "all" ? "is-active" : ""}
              onClick={() => setFilter("all")}
            >
              全部 {templates.length}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "default"}
              className={filter === "default" ? "is-active" : ""}
              onClick={() => setFilter("default")}
            >
              默认模板
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "mine"}
              className={filter === "mine" ? "is-active" : ""}
              onClick={() => setFilter("mine")}
            >
              我的模板
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "builtin"}
              className={filter === "builtin" ? "is-active" : ""}
              onClick={() => setFilter("builtin")}
            >
              内置模板
            </button>
          </div>
        </div>
      </Surface>
      {loading ? (
        <Surface className="table-surface cw-template-surface">
          <div className="cw-loading"><Spinner /></div>
        </Surface>
      ) : templates.length === 0 ? (
        <Surface className="table-surface cw-template-surface">
          <EmptyState
            icon={<FileCode2 size={28} />}
            title="暂无模板"
            description="上传 YAML、粘贴内容或从订阅生成模板。"
            action={<Button onClick={() => setShowCreate(true)}><Plus size={16} />新建模板</Button>}
          />
        </Surface>
      ) : filteredTemplates.length === 0 ? (
        <Surface className="table-surface cw-template-surface">
          <EmptyState
            icon={<Search size={28} />}
            title="未找到匹配模板"
            description="请调整搜索关键词或清除分类筛选条件。"
            action={<Button variant="secondary" onClick={() => { setSearch(""); setFilter("all"); }}>清除筛选</Button>}
          />
        </Surface>
      ) : (
        <Surface className="table-surface cw-template-surface">
          <div className="table-wrap cw-template-table">
            <table>
              <thead>
                <tr>
                  <th>模板名称</th>
                  <th>归属 / 状态</th>
                  <th style={{ width: 160, textAlign: "right" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredTemplates.map((filename) => {
                  const owner = owners[filename];
                  const isDefault = defaultTemplate === filename;
                  return (
                    <tr key={filename}>
                      <td>
                        <div className="cw-file-name">
                          <span className="cw-file-icon">
                            <FileCode2 size={20} />
                          </span>
                          <span>
                            <strong>{filename}</strong>
                            <small>{filename.replace(/\.ya?ml$/i, "").replaceAll("_", " ")}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        {isDefault ? (
                          <Badge tone="good">默认模板</Badge>
                        ) : owner ? (
                          <Badge tone={owner === username ? "info" : "neutral"}>
                            {owner === username ? "我的模板" : owner}
                          </Badge>
                        ) : (
                          <Badge>内置模板</Badge>
                        )}
                      </td>
                      <td>
                        <div className="cw-table-actions">
                          {isAdmin ? (
                            <IconButton
                              label={isDefault ? "默认模板" : `将 ${filename} 设为默认模板`}
                              disabled={working || isDefault}
                              onClick={() => void makeDefault(filename)}
                            >
                              {isDefault ? <Check size={17} /> : <Star size={17} />}
                            </IconButton>
                          ) : null}
                          <IconButton
                            label="预览"
                            title={`预览 ${filename}`}
                            onClick={() => setPreviewing(filename)}
                          >
                            <Sparkles size={17} />
                          </IconButton>
                          {canModify(filename) ? (
                            <>
                              <IconButton
                                label={`编辑 ${filename}`}
                                onClick={() => setEditing(filename)}
                              >
                                <Pencil size={17} />
                              </IconButton>
                              <IconButton
                                label={`删除 ${filename}`}
                                disabled={working || isDefault}
                                onClick={() => setDeleting(filename)}
                              >
                                <Trash2 size={17} />
                              </IconButton>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Surface>
      )}
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
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [providerLoadFailed, setProviderLoadFailed] = useState(false);
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
        api.get<{ region_filters?: unknown }>("/api/admin/template-v3/region-filters"),
        api.get<ProxyProviderConfig[]>("/api/user/proxy-provider-configs"),
      ]);
      if (results[0].status === "fulfilled") setNodes(results[0].value.nodes ?? []);
      if (results[1].status === "fulfilled") {
        const raw = results[1].value.region_filters;
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
      if (results[2].status === "fulfilled") {
        setProviders(Array.isArray(results[2].value) ? results[2].value : []);
      } else {
        setProviderLoadFailed(true);
      }
      setProvidersLoaded(true);
      const labels = ["节点", "地区预设", "Proxy Provider"];
      const failures = results.flatMap((result, index) => result.status === "rejected" ? [labels[index]] : []);
      if (failures.length) setLoadWarning(`${failures.join("、")}加载失败；未加载的数据不会出现在来源选项中。`);
    };
    void loadOptions();
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(draft)); } catch { /* best effort */ }
  }, [draft]);

  const outputObject = useMemo(() => visualTemplateObject(draft), [draft]);
  const yaml = useMemo(() => `${structuredYAML(outputObject)}\n`, [outputObject]);
  const json = useMemo(() => `${JSON.stringify(outputObject, null, 2)}\n`, [outputObject]);
  const availableProviders = useMemo(() => {
    const unique = new Map<string, ProxyProviderConfig>();
    for (const provider of providers) {
      const name = provider.name.trim();
      if (!name || !proxyProviderMode(provider.process_mode) || unique.has(name)) continue;
      unique.set(name, provider);
    }
    return [...unique.values()];
  }, [providers]);
  const referencedProviderNames = useMemo(() => [...new Set(draft.groups.flatMap((group) => group.sources.filter((source) => source.kind === "provider").map((source) => source.value.trim()).filter(Boolean)))], [draft.groups]);
  const missingProviderNames = useMemo(() => {
    if (!providersLoaded || providerLoadFailed) return [];
    const available = new Set(availableProviders.map((provider) => provider.name.trim()));
    return referencedProviderNames.filter((name) => !available.has(name));
  }, [availableProviders, providerLoadFailed, providersLoaded, referencedProviderNames]);
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
      if (referencedProviderNames.length && !providersLoaded) throw new Error("Proxy Provider 列表仍在加载，请稍后再保存");
      if (referencedProviderNames.length && providerLoadFailed) throw new Error("无法验证 Proxy Provider 引用，请刷新页面后重试");
      if (missingProviderNames.length) throw new Error(`草稿引用的 Proxy Provider 已不存在或不可用：${missingProviderNames.join("、")}`);
      for (const group of draft.groups) {
        if (group.sources.length === 0) throw new Error(`代理组“${group.name}”至少需要一个节点或组来源`);
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
    { label: "DIRECT", kind: "builtin" as const, value: "DIRECT" },
    { label: "REJECT", kind: "builtin" as const, value: "REJECT" },
    ...draft.groups.filter((item) => item.id !== group.id && item.name.trim()).map((item) => ({ label: `组 · ${item.name}`, kind: "group" as const, value: item.name.trim() })),
    ...availableProviders.map((item) => ({ label: `Provider · ${item.name} · ${proxyProviderMode(item.process_mode) === "server" ? "Arcway 展开" : "Mihomo 拉取"}`, kind: "provider" as const, value: item.name.trim() })),
    ...nodes.filter((item) => item.enabled).map((item) => ({ label: `节点 · ${item.node_name}`, kind: "node" as const, value: item.node_name })),
  ];

  return <Dialog title="可视化模板设计" description="结构化维护代理组并生成完整 V3 YAML；不会解析或改写已有 YAML" onClose={onClose} dismissible={!working} wide>
    <div className="cw-form">
      {error ? <ErrorState message={error} /> : null}
      {loadWarning ? <div className="cw-help"><Info size={16} /><span>{loadWarning}</span></div> : null}
      {missingProviderNames.length ? <div className="cw-help"><Info size={16} /><span>草稿引用的 Proxy Provider 已不存在或不可用：{missingProviderNames.join("、")}。请重新选择来源后再保存。</span></div> : null}
      <fieldset className="cw-lock-fields" disabled={working}>
      {restoredRef.current ? <div className="cw-draft-notice"><span><RefreshCw size={15} />已恢复上次未保存草稿</span><Button variant="ghost" disabled={working} onClick={clearDraft}>清除草稿</Button></div> : null}
      <div className="cw-tabs cw-tabs-three" role="tablist" aria-label="可视化模板视图"><button type="button" role="tab" aria-selected={tab === "design"} className={tab === "design" ? "is-active" : ""} onClick={() => setTab("design")}>结构设计</button><button type="button" role="tab" aria-selected={tab === "yaml"} className={tab === "yaml" ? "is-active" : ""} onClick={() => setTab("yaml")}>YAML 预览</button><button type="button" role="tab" aria-selected={tab === "json"} className={tab === "json" ? "is-active" : ""} onClick={() => setTab("json")}>JSON 预览</button></div>
      {tab === "design" ? <>
        <div className="cw-form-grid"><Field label="模板文件名"><input required value={draft.filename} onChange={(event) => setDraft((current) => ({ ...current, filename: event.target.value }))} /></Field><Field label="DNS 模式"><select value={draft.dnsMode} onChange={(event) => setDraft((current) => ({ ...current, dnsMode: event.target.value as VisualTemplateDraft["dnsMode"] }))}><option value="fake-ip">Fake IP</option><option value="redir-host">Redir Host</option><option value="off">不写入 DNS</option></select></Field></div>
        {draft.dnsMode !== "off" ? <div className="cw-form-section"><strong>DNS</strong><div className="cw-form-grid"><Field label="Nameserver（每行一个）"><textarea value={draft.nameservers.join("\n")} onChange={(event) => setDraft((current) => ({ ...current, nameservers: event.target.value.split("\n") }))} /></Field>{draft.dnsMode === "fake-ip" ? <><Field label="Fake IP 范围"><input value={draft.fakeIPRange} onChange={(event) => setDraft((current) => ({ ...current, fakeIPRange: event.target.value }))} /></Field><Field label="Fake IP 排除（每行一个）"><textarea value={draft.fakeIPFilters.join("\n")} onChange={(event) => setDraft((current) => ({ ...current, fakeIPFilters: event.target.value.split("\n") }))} /></Field></> : null}<div className="cw-toggle-field"><Toggle checked={draft.ipv6} onChange={(ipv6) => setDraft((current) => ({ ...current, ipv6 }))} label="DNS IPv6" /></div></div></div> : null}
        <div className="cw-form-section"><div className="cw-section-title"><div><h2>代理组</h2><p>节点、内置项和代理组写入 proxies；Provider 写入 use。</p></div><div className="cw-toolbar"><select aria-label="地区分组预设" value={region} onChange={(event) => setRegion(event.target.value)}><option value="">地区预设</option>{regions.map((item) => <option value={item.name} key={item.name}>{item.name}</option>)}</select><Button variant="secondary" onClick={addRegionGroup} disabled={!region}>添加地区组</Button><Button onClick={() => setDraft((current) => ({ ...current, groups: [...current.groups, { ...defaultVisualGroup(), name: `PROXY ${current.groups.length + 1}` }] }))}><Plus size={16} />代理组</Button></div></div>
          <div className="cw-visual-groups">{draft.groups.map((group, groupIndex) => <Surface className="cw-visual-group" key={group.id}>
            <div className="cw-visual-group-head"><strong>{group.name || "未命名组"}</strong><div className="cw-table-actions"><IconButton label={`上移代理组 ${group.name}`} disabled={groupIndex === 0} onClick={() => moveGroup(groupIndex, -1)}><ArrowUp size={15} /></IconButton><IconButton label={`下移代理组 ${group.name}`} disabled={groupIndex === draft.groups.length - 1} onClick={() => moveGroup(groupIndex, 1)}><ArrowDown size={15} /></IconButton><IconButton label={`删除代理组 ${group.name}`} disabled={draft.groups.length === 1} onClick={() => setDraft((current) => ({ ...current, groups: current.groups.filter((item) => item.id !== group.id) }))}><Trash2 size={15} /></IconButton></div></div>
            <div className="cw-form-grid"><Field label="组名"><input value={group.name} onChange={(event) => updateGroup(group.id, { name: event.target.value })} /></Field><Field label="类型"><select value={group.type} onChange={(event) => updateGroup(group.id, { type: event.target.value as ProxyGroupType })}><option value="select">Select</option><option value="url-test">URL Test</option><option value="fallback">Fallback</option><option value="load-balance">Load Balance</option><option value="relay">Relay</option></select></Field></div>
            <Field label="添加节点 / Provider / 代理组来源"><select aria-label={`添加 ${group.name} 来源`} value="" onChange={(event) => addSource(group, event.target.value)}><option value="">选择来源</option>{sourceOptions(group).map((option) => <option value={JSON.stringify({ kind: option.kind, value: option.value })} key={`${option.kind}:${option.value}`}>{option.label}</option>)}</select></Field>
            <div className="cw-source-list">{group.sources.map((source, sourceIndex) => <div className="cw-source-row" key={source.id}><Badge tone={source.kind === "provider" ? "info" : "neutral"}>{({ node: "节点", provider: "Provider", group: "代理组", builtin: "内置" } as const)[source.kind]}</Badge><code>{source.value}</code><div className="cw-table-actions"><IconButton label={`上移来源 ${source.value}`} disabled={sourceIndex === 0} onClick={() => moveSource(group, sourceIndex, -1)}><ArrowUp size={14} /></IconButton><IconButton label={`下移来源 ${source.value}`} disabled={sourceIndex === group.sources.length - 1} onClick={() => moveSource(group, sourceIndex, 1)}><ArrowDown size={14} /></IconButton><IconButton label={`移除来源 ${source.value}`} onClick={() => updateGroup(group.id, { sources: group.sources.filter((item) => item.id !== source.id) })}><Trash2 size={14} /></IconButton></div></div>)}</div>
            {["url-test", "fallback", "load-balance"].includes(group.type) ? <div className="cw-form-grid"><Field label="节点测试 URL"><input type="url" value={group.url} onChange={(event) => updateGroup(group.id, { url: event.target.value })} /></Field><Field label="检查间隔（秒）"><input type="number" min="1" value={group.interval} onChange={(event) => updateGroup(group.id, { interval: Number(event.target.value) })} /></Field>{group.type === "url-test" ? <Field label="容差（毫秒）"><input type="number" min="0" value={group.tolerance} onChange={(event) => updateGroup(group.id, { tolerance: Number(event.target.value) })} /></Field> : null}{group.type === "load-balance" ? <Field label="负载策略"><select value={group.strategy} onChange={(event) => updateGroup(group.id, { strategy: event.target.value })}><option value="consistent-hashing">Consistent Hashing</option><option value="round-robin">Round Robin</option><option value="sticky-sessions">Sticky Sessions</option></select></Field> : null}<div className="cw-toggle-field"><Toggle checked={group.lazy} onChange={(lazy) => updateGroup(group.id, { lazy })} label="Lazy 检测" /></div></div> : null}
            <div className="cw-form-grid"><Field label="包含过滤（filter）"><input value={group.filter} onChange={(event) => updateGroup(group.id, { filter: event.target.value })} /></Field><Field label="排除过滤（exclude-filter）"><input value={group.excludeFilter} onChange={(event) => updateGroup(group.id, { excludeFilter: event.target.value })} /></Field><Field label="排除类型（exclude-type）"><input value={group.excludeType} onChange={(event) => updateGroup(group.id, { excludeType: event.target.value })} /></Field><Field label="链式前置组" hint="生成 dialer-proxy-group，由现有订阅 handler 注入到节点"><select value={group.dialerProxyGroup} onChange={(event) => updateGroup(group.id, { dialerProxyGroup: event.target.value })}><option value="">不设置</option>{draft.groups.filter((item) => item.id !== group.id && item.name.trim()).map((item) => <option value={item.name} key={item.id}>{item.name}</option>)}</select></Field></div>
          </Surface>)}</div>
        </div>
        <div className="cw-form-section"><strong>规则</strong><Field label="每行一条 Mihomo 规则"><textarea className="cw-dialog-code cw-dialog-code-short" value={draft.rules.join("\n")} onChange={(event) => setDraft((current) => ({ ...current, rules: event.target.value.split("\n") }))} spellCheck={false} /></Field></div>
      </> : <pre className="cw-preview">{tab === "yaml" ? yaml : json}</pre>}
      <div className="dialog-actions"><Button variant="secondary" disabled={working} onClick={onClose}>取消</Button><Button variant="ghost" disabled={working} onClick={clearDraft}>恢复默认</Button><Button onClick={() => void save()} disabled={working}>{working ? <Spinner label="正在保存" /> : <><Save size={16} />保存新模板</>}</Button></div>
      </fieldset>
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
      await api.put(`/api/admin/rule-templates/${encodeURIComponent(filename)}`, { content, new_name: normalized });
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
  const [subscriptionsLoading, setSubscriptionsLoading] = useState(true);
  const [subscriptionsError, setSubscriptionsError] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const loadSubscriptions = useCallback(async () => {
    setSubscriptionsLoading(true);
    setSubscriptionsError("");
    try {
      const payload = await api.get<{ files?: SubscribeFile[] }>("/api/admin/subscribe-files");
      const files = payload.files ?? [];
      setSubscriptions(files);
      setSubscription((current) => files.some((item) => item.filename === current) ? current : files[0]?.filename || "");
    } catch (reason) {
      setSubscriptionsError(fail(reason, "读取订阅列表失败"));
    } finally {
      setSubscriptionsLoading(false);
    }
  }, []);
  useEffect(() => { void loadSubscriptions(); }, [loadSubscriptions]);
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
  const subscriptionUnavailable = mode === "subscription" && (subscriptionsLoading || Boolean(subscriptionsError) || !subscription);
  return <Dialog title="新建模板" description="选择模板来源并保存为 V3 YAML 文件" onClose={onClose} wide><form className="cw-form" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<div className="cw-create-modes">{modes.map((item) => <button type="button" key={item.value} className={`cw-create-mode ${mode === item.value ? "is-active" : ""}`} onClick={() => setMode(item.value)}>{item.icon}<span>{item.label}</span></button>)}</div>{mode === "upload" ? <><Field key="template-upload-file" label="YAML 文件"><input required type="file" accept=".yaml,.yml,.json,.txt,.conf,application/yaml,text/yaml,application/json,text/plain" onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); if (next && !filename) setFilename(next.name); }} /></Field><Field label="保存文件名" hint="默认使用上传文件名"><input value={filename} onChange={(event) => setFilename(event.target.value)} placeholder="custom.yaml" /></Field></> : <><Field key="template-output-filename" label="模板文件名"><input required value={filename} onChange={(event) => setFilename(event.target.value)} placeholder="custom_v3.yaml" /></Field>{mode === "url" ? <><Field label="模板 URL"><input required type="url" value={url} onChange={(event) => setURL(event.target.value)} placeholder="https://example.com/template.yaml" /></Field><Toggle checked={useProxy} onChange={setUseProxy} label="通过远程获取代理拉取" /></> : mode === "subscription" ? <>{subscriptionsError ? <ErrorState message={subscriptionsError} onRetry={() => void loadSubscriptions()} /> : null}<Field label="订阅文件"><select required disabled={subscriptionsLoading || Boolean(subscriptionsError)} value={subscription} onChange={(event) => setSubscription(event.target.value)}><option value="">{subscriptionsLoading ? "正在读取订阅..." : subscriptions.length ? "请选择订阅" : "暂无可用订阅"}</option>{subscriptions.map((item) => <option key={item.id} value={item.filename}>{item.name} · {item.filename}</option>)}</select></Field></> : <Field label={mode === "v2" ? "V2 / ACL4SSR 内容" : "YAML 内容"}><textarea required className="cw-dialog-code" value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} placeholder={mode === "paste" ? "粘贴 V3 YAML 模板" : undefined} /></Field>}</>}<div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working || subscriptionUnavailable}>{working ? <Spinner label="正在创建" /> : <><FilePlus2 size={16} />创建模板</>}</Button></div></form></Dialog>;
}

type CertificatePending = { kind: "certificate"; item: CertificateItem } | { kind: "provider"; item: DNSProviderItem };

export function CertificatesWorkbenchPage({ notify = noNotify, isAdmin = true }: ContentPageProps & { isAdmin?: boolean }) {
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
  const [pending, setPending] = useState<CertificatePending | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [certPayload, providerPayload] = await Promise.all([
        api.get<{ success?: boolean; certificates?: CertificateItem[] }>("/api/admin/certificates"),
        api.get<{ success?: boolean; providers?: DNSProviderWire[] }>("/api/admin/dns-providers"),
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
  const toggleCertificate = async (item: CertificateItem, value: boolean) => {
    setWorking(true); setError("");
    try {
      assertSuccess(await request<Envelope>("/api/admin/certificates/auto-renew", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, auto_renew: value }) }), "更新证书策略失败");
      notify("自动续期设置已更新"); await load();
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
    <PageHeader title="SSL/TLS 证书管理" description="管理 ACME 证书，支持通配符、DNS 验证与多 CA 自动续期。" actions={<><IconButton label="刷新证书" onClick={() => void load()}><RefreshCw size={18} /></IconButton>{tab === "certificates" ? <><Button onClick={() => setShowApply(true)}><Plus size={16} />申请证书</Button><Button variant="secondary" onClick={() => setShowUpload(true)}><Upload size={16} />上传证书</Button><Button variant="secondary" onClick={() => setEditingProvider("new")}><KeyRound size={16} />DNS 提供商</Button></> : <Button onClick={() => setEditingProvider("new")}><Plus size={16} />DNS 提供商</Button>}</>} />
    <div className="cw-tabs" role="tablist" aria-label="证书管理分类"><button type="button" role="tab" aria-selected={tab === "certificates"} className={tab === "certificates" ? "is-active" : ""} onClick={() => setTab("certificates")}><Award size={16} />证书 <span>{certificates.length}</span></button><button type="button" role="tab" aria-selected={tab === "providers"} className={tab === "providers" ? "is-active" : ""} onClick={() => setTab("providers")}><KeyRound size={16} />DNS 提供商 <span>{providers.length}</span></button></div>
    {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
    {loading ? <Surface className="cw-loading"><Spinner /></Surface> : tab === "certificates" ? <CertificateTable items={certificates} working={working} onApply={() => setShowApply(true)} onEdit={setEditingCertificate} onRenew={(item) => void renew(item)} onToggle={toggleCertificate} onDelete={(item) => setPending({ kind: "certificate", item })} /> : <DNSProviderTable items={providers} onCreate={() => setEditingProvider("new")} onEdit={setEditingProvider} onDelete={(item) => setPending({ kind: "provider", item })} />}
    {showApply ? <ApplyCertificateDialog providers={providers} onCreateProvider={() => { setShowApply(false); setProviderForApply(true); setEditingProvider("new"); }} onClose={() => setShowApply(false)} onComplete={async () => { setShowApply(false); notify("证书申请已提交"); await load(); }} /> : null}
    {showUpload ? <UploadCertificateDialog onClose={() => setShowUpload(false)} onComplete={async () => { setShowUpload(false); notify("证书已上传"); await load(); }} /> : null}
    {editingCertificate ? <EditCertificateDialog item={editingCertificate} providers={providers} onClose={() => setEditingCertificate(null)} onComplete={async () => { setEditingCertificate(null); notify("证书设置已更新"); await load(); }} /> : null}
    {editingProvider ? <DNSProviderDialog item={editingProvider === "new" ? undefined : editingProvider} onClose={() => { setEditingProvider(null); if (providerForApply) { setProviderForApply(false); setShowApply(true); } }} onComplete={async () => { const returnToApply = providerForApply; setEditingProvider(null); setProviderForApply(false); notify(editingProvider === "new" ? "DNS 提供商已创建" : "DNS 提供商已更新"); await load(); if (returnToApply) setShowApply(true); }} /> : null}
    {pending ? <ConfirmDialog title={pending.kind === "certificate" ? "删除证书" : "删除 DNS 提供商"} description={pending.kind === "certificate" ? `将删除“${pending.item.domain}”的证书记录。` : `将删除“${pending.item.name}”，使用该凭据的证书后续无法自动续期。`} confirmLabel="确认删除" working={working} onCancel={() => setPending(null)} onConfirm={() => void remove()} /> : null}
  </section>;
}

const formatCertProvider = (provider?: string) => {
  const p = (provider || "").trim();
  if (!p || p === "manual") return "手动导入";
  if (p === "letsencrypt") return "Let's Encrypt";
  if (p === "letsencrypt-staging") return "Let's Encrypt (Staging)";
  return p;
};

const formatCertChallenge = (mode?: string) => {
  const m = (mode || "").trim();
  if (m === "manual") return "手动导入";
  if (m === "dns") return "DNS-01";
  if (m === "http" || m === "webroot") return "HTTP-01";
  return m || "手动导入";
};

function CertificateTable({ items, working, onApply, onEdit, onRenew, onToggle, onDelete }: { items: CertificateItem[]; working: boolean; onApply: () => void; onEdit: (item: CertificateItem) => void; onRenew: (item: CertificateItem) => void; onToggle: (item: CertificateItem, value: boolean) => void; onDelete: (item: CertificateItem) => void }) {
  if (items.length === 0) return <Surface><EmptyState icon={<ShieldCheck size={24} />} title="暂无证书" description="申请 ACME 证书或上传已有 PEM 证书。" action={<Button onClick={onApply}><Plus size={16} />申请证书</Button>} /></Surface>;
  return <Surface className="table-surface cw-compact-table cw-managed-table cw-certificate-table">
    <div className="table-wrap"><table>
      <thead><tr><th>域名</th><th>状态 / CA</th><th>有效期</th><th>自动续期</th><th aria-label="操作" /></tr></thead>
      <tbody>{items.map((item) => {
        const manual = item.provider === "manual" || item.challenge_mode === "manual";
        return <tr key={item.id}>
        <td data-label="域名"><div className="cw-file-name"><span className="cw-file-icon"><LockKeyhole size={16} /></span><span><strong title={item.domain}>{item.domain}</strong><small title={item.email}>{item.email || "未记录邮箱"}</small></span></div>{item.message ? <span className={`cw-table-note cw-clamp-note ${item.status === "failed" ? "cw-private-warning" : ""}`} title={item.message}>{item.message}</span> : null}</td>
        <td data-label="状态 / CA"><span className="cw-status"><span className={`cw-status-dot is-${item.status}`} /><Badge tone={certificateTone(item.status)}>{certificateStatus(item.status)}</Badge></span><span className="cw-table-note">{formatCertProvider(item.provider)} · {formatCertChallenge(item.challenge_mode)}</span></td>
        <td data-label="有效期"><strong>{formatDate(item.expiry_date)}</strong><span className="cw-table-note">签发 {formatDate(item.issue_date)}</span></td>
        <td data-label="自动续期"><Toggle checked={item.auto_renew} disabled={manual && !item.auto_renew} onChange={(value) => onToggle(item, value)} label="自动续期" /><span className="cw-table-note">{manual ? "手动证书不自动续期" : "到期前自动续期"}</span></td>
        <td data-label="操作"><div className="cw-table-actions"><IconButton label={`编辑 ${item.domain}`} onClick={() => onEdit(item)}><Pencil size={16} /></IconButton>{item.status === "failed" ? <Button variant="secondary" disabled={working || manual} onClick={() => onRenew(item)}><RotateCw size={15} />重试申请</Button> : <IconButton label={manual ? `${item.domain} 为手动导入证书，不可在线续期` : `续期 ${item.domain}`} disabled={working || item.status === "pending" || manual} onClick={() => onRenew(item)}><RotateCw size={16} /></IconButton>}<IconButton label={`删除 ${item.domain}`} onClick={() => onDelete(item)}><Trash2 size={16} /></IconButton></div></td>
      </tr>})}</tbody>
    </table></div>
  </Surface>;
}

function DNSProviderTable({ items, onCreate, onEdit, onDelete }: { items: DNSProviderItem[]; onCreate: () => void; onEdit: (item: DNSProviderItem) => void; onDelete: (item: DNSProviderItem) => void }) {
  if (items.length === 0) return <Surface><EmptyState icon={<KeyRound size={24} />} title="暂无 DNS 提供商" description="添加凭据后可使用 DNS-01 申请泛域名证书。" action={<Button onClick={onCreate}><Plus size={16} />DNS 提供商</Button>} /></Surface>;
  return <Surface className="table-surface cw-compact-table cw-managed-table cw-provider-table"><div className="table-wrap"><table><thead><tr><th>名称</th><th>提供商</th><th>凭据</th><th>更新时间</th><th aria-label="操作" /></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td data-label="名称"><div className="cw-file-name"><span className="cw-file-icon"><Globe2 size={16} /></span><span><strong title={item.name}>{item.name}</strong><small>ID {item.id}</small></span></div></td><td data-label="提供商"><Badge tone="info">{item.provider_type}</Badge></td><td data-label="凭据"><span className="cw-secret">••••••••</span><span className="cw-table-note">编辑后可按需显示</span></td><td data-label="更新时间">{formatDate(item.updated_at || item.created_at)}</td><td data-label="操作"><div className="cw-table-actions"><IconButton label={`编辑 ${item.name}`} onClick={() => onEdit(item)}><Pencil size={16} /></IconButton><IconButton label={`删除 ${item.name}`} onClick={() => onDelete(item)}><Trash2 size={16} /></IconButton></div></td></tr>)}</tbody></table></div></Surface>;
}

function ApplyCertificateDialog({ providers, onCreateProvider, onClose, onComplete }: { providers: DNSProviderItem[]; onCreateProvider: () => void; onClose: () => void; onComplete: () => void }) {
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [provider, setProvider] = useState("letsencrypt");
  const [dnsProviderID, setDNSProviderID] = useState(() => providers[0] ? String(providers[0].id) : "");
  const [autoRenew, setAutoRenew] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setDNSProviderID((current) => providers.some((item) => String(item.id) === current) ? current : providers[0] ? String(providers[0].id) : "");
  }, [providers]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      if (!dnsProviderID) throw new Error("请选择用于 DNS-01 TXT 验证的 DNS 提供商");
      const payload = assertSuccess(await api.post<Envelope>("/api/admin/certificates/create", {
        domain: domain.trim(), email: email.trim(), provider, challenge_mode: "dns",
        dns_provider_id: Number(dnsProviderID),
        remote_server_id: 0, auto_renew: autoRenew,
      }), "提交证书申请失败");
      if (payload.success === false) throw new Error(payload.message || "提交证书申请失败");
      onComplete();
    } catch (reason) { setError(fail(reason, "提交证书申请失败")); }
    finally { setWorking(false); }
  };
  return <Dialog title="申请 ACME 证书" description="仅支持 DNS TXT (DNS-01) 验证，原生支持通配符泛域名" onClose={onClose} dismissible={!working} wide><form className="cw-form" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<div className="cw-form-grid"><Field label="域名"><input required value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="example.com 或 *.example.com" /></Field><Field label="联系邮箱"><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.com" /></Field><Field label="证书颁发机构"><select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="letsencrypt">Let's Encrypt</option><option value="letsencrypt-staging">Let's Encrypt Staging</option></select></Field><Field label="验证方式" hint="系统仅支持 DNS TXT 记录自动验证"><input aria-label="验证方式" readOnly value="DNS-01（DNS TXT 验证）" /></Field><Field label="DNS 提供商" hint={providers.length ? "使用已保存的 DNS API 凭据自动添加与验证 TXT 记录" : "还没有可用凭据，请先添加 DNS 提供商"}><div className="cw-provider-picker"><select required aria-label="DNS 提供商" value={dnsProviderID} onChange={(event) => setDNSProviderID(event.target.value)}><option value="">请选择 DNS 提供商</option>{providers.map((item) => <option key={item.id} value={String(item.id)}>{item.name} · {item.provider_type}</option>)}</select><Button type="button" variant="secondary" onClick={onCreateProvider}><Plus size={15} />添加</Button></div></Field></div><div className="cw-checkboxes"><Toggle checked={autoRenew} onChange={setAutoRenew} label="到期前自动续期" /></div><div className="dialog-actions"><Button type="button" variant="secondary" disabled={working} onClick={onClose}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在提交" /> : <><ShieldCheck size={16} />提交申请</>}</Button></div></form></Dialog>;
}

function EditCertificateDialog({ item, providers, onClose, onComplete }: { item: CertificateItem; providers: DNSProviderItem[]; onClose: () => void; onComplete: () => void }) {
  const domain = item.domain;
  const [email, setEmail] = useState(item.email || "");
  const [provider, setProvider] = useState(item.provider || "manual");
  const [dnsProviderID, setDNSProviderID] = useState(item.dns_provider_id ? String(item.dns_provider_id) : "");
  const [autoRenew, setAutoRenew] = useState(item.auto_renew);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const manual = provider === "manual" || item.challenge_mode === "manual";
  const issued = item.status === "valid" || Boolean(item.issue_date);
  const providerIsKnown = ["manual", "letsencrypt", "letsencrypt-staging"].includes(provider);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      if (!manual && !dnsProviderID) throw new Error("请选择用于 DNS-01 TXT 验证的 DNS 提供商");
      assertSuccess(await api.put<Envelope>(`/api/admin/certificates/${item.id}`, {
        domain: domain.trim(),
        email: email.trim(),
        provider,
        challenge_mode: manual ? "manual" : "dns",
        webroot_path: "",
        dns_provider_id: Number(dnsProviderID) || 0,
        remote_server_id: item.remote_server_id || 0,
        auto_renew: !manual && autoRenew,
      }), "更新证书设置失败");
      onComplete();
    } catch (reason) { setError(fail(reason, "更新证书设置失败")); }
    finally { setWorking(false); }
  };

  return <Dialog title="编辑证书设置" description="修改仅用于后续自动续期，不会立即重新签发证书" onClose={onClose} wide>
    <form className="cw-form" onSubmit={submit}>
      {error ? <ErrorState message={error} /> : null}
      <div className="cw-form-grid">
        <Field label="域名" hint="证书域名来自证书内容，不能直接修改"><input aria-label="域名" readOnly value={domain} /></Field>
        <Field label="联系邮箱"><input required={!manual} type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.com" /></Field>
        <Field label="证书颁发机构" hint={issued ? "已签发证书不能更改 CA" : undefined}><select aria-label="证书颁发机构" disabled={issued} value={provider} onChange={(event) => { const value = event.target.value; setProvider(value); if (value === "manual") setAutoRenew(false); }}>{!providerIsKnown ? <option value={provider}>{formatCertProvider(provider)}</option> : null}<option value="letsencrypt">Let's Encrypt</option><option value="letsencrypt-staging">Let's Encrypt Staging</option><option value="manual">手动上传</option></select></Field>
        {!manual ? <Field label="验证方式"><input aria-label="验证方式" readOnly value="DNS-01（DNS TXT 验证）" /></Field> : null}
        <Field label={!manual ? "DNS 提供商" : "关联 DNS 提供商（可选 · 用于 DDNS 自动复用）"}>
          <select required={!manual} aria-label="DNS 提供商" value={dnsProviderID} onChange={(event) => setDNSProviderID(event.target.value)}>
            <option value="">{manual ? "未关联 DNS 提供商" : "请选择 DNS 提供商"}</option>
            {providers.map((providerItem) => <option key={providerItem.id} value={String(providerItem.id)}>{providerItem.name} · {providerItem.provider_type}</option>)}
          </select>
        </Field>
      </div>
      <div className="cw-checkboxes">{!manual ? <Toggle checked={autoRenew} onChange={setAutoRenew} label="到期前自动续期" /> : null}</div>
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
  return <Dialog title="上传证书" description="导入 PEM 证书链和对应私钥" onClose={onClose} dismissible={!working} wide><form className="cw-form" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<Field label="证书域名"><input required value={domain} onChange={(event) => setDomain(event.target.value)} /></Field><div className="cw-form-grid"><Field label="证书文件"><input type="file" accept=".pem,.crt,.cer" onChange={(event) => void readFile(event.target.files?.[0], setCertPEM)} /></Field><Field label="私钥文件"><input type="file" accept=".pem,.key" onChange={(event) => void readFile(event.target.files?.[0], setKeyPEM)} /></Field></div><Field label="证书链 PEM"><textarea required className="cw-dialog-code" value={certPEM} onChange={(event) => setCertPEM(event.target.value)} spellCheck={false} placeholder="-----BEGIN CERTIFICATE-----" /></Field><Field label="私钥 PEM"><textarea required className="cw-dialog-code is-private" value={keyPEM} onChange={(event) => setKeyPEM(event.target.value)} spellCheck={false} autoComplete="new-password" placeholder="私钥仅提交到服务器，不会回显" /></Field><div className="cw-help"><LockKeyhole size={16} /><span>私钥仅用于本次写入，证书列表和编辑页面不会读取或显示私钥内容。</span></div><div className="dialog-actions"><Button type="button" variant="secondary" disabled={working} onClick={() => { setKeyPEM(""); onClose(); }}>取消</Button><Button type="submit" disabled={working || !certPEM.trim() || !keyPEM.trim()}>{working ? <Spinner label="正在上传" /> : <><Upload size={16} />上传证书</>}</Button></div></form></Dialog>;
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
      <Field label="提供商类型"><select value={providerType} onChange={(event) => setProviderType(event.target.value)}>{Object.keys(dnsProviderFields).map((type) => <option key={type} value={type}>{type === "huaweicloud" ? "huaweicloud (华为云)" : type === "alidns" ? "alidns (阿里云)" : type === "tencentcloud" ? "tencentcloud (腾讯云)" : type === "cloudflare" ? "cloudflare (Cloudflare)" : type}</option>)}</select></Field>
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
