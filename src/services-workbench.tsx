import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Clipboard,
  Cloud,
  Code2,
  Copy,
  Eye,
  FileKey2,
  Gauge,
  Grid2X2,
  KeyRound,
  List,
  Network,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Square,
  TerminalSquare,
  Trash2,
  UploadCloud,
  Wifi,
  WifiOff,
  Wrench,
} from "lucide-react";
import { api, request } from "./api";
import type { RemoteServer, ServerListResponse, SharedServerToken } from "./types";
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
  relativeTime,
  statusTone,
} from "./ui";
import "./services-workbench.css";

type Notify = (message: string, tone?: "success" | "error") => void;
type ViewMode = "cards" | "list";
type StatusFilter = "all" | "online" | "offline";

interface ManagedServer extends RemoteServer {
  token?: string;
  pull_token?: string;
  agent_token?: string;
  pull_address?: string;
  pull_port?: number;
  traffic_reset_day?: number;
  traffic_used_offset?: number;
  use_443?: boolean;
  steal_mode?: string;
  site_type?: string;
  site_value?: string;
  ddns_enabled?: boolean;
  ddns_provider_id?: number;
  ddns_last_synced_at?: string;
  ddns_last_error?: string;
  ddns_pending?: boolean;
  boot_time?: string;
  system_traffic_updated_at?: string;
}

interface ActionResponse {
  success?: boolean;
  message?: string;
  error?: string;
  output?: string;
}

interface DNSProviderWire {
  id?: number;
  ID?: number;
  name?: string;
  Name?: string;
  provider_type?: string;
  ProviderType?: string;
}

interface DNSProviderOption {
  id: number;
  name: string;
  providerType: string;
}

interface DNSProvidersResponse extends ActionResponse {
  providers?: DNSProviderWire[];
}

interface DDNSStatusResponse extends ActionResponse {
  id?: number;
  name?: string;
  ddns_enabled: boolean;
  ddns_provider_id: number;
  ddns_provider_name?: string;
  ddns_last_synced_at?: string;
  ddns_last_error?: string;
  ddns_pending: boolean;
  pull_address?: string;
  ip_address?: string;
  ip_address_v6?: string;
}

interface ServiceState {
  installed: boolean;
  running: boolean;
  version?: string;
}

interface ServiceStatusResponse extends ActionResponse {
  xray?: ServiceState;
  nginx?: ServiceState;
}

interface AgentVersionResponse {
  server_id: number;
  current: string;
  latest: string;
  upgrade_available: boolean;
  current_error?: string;
  latest_error?: string;
}

interface SystemInfoResponse extends ActionResponse {
  hostname?: string;
  uptime?: string;
  loadavg?: string;
  agent_version?: string;
  memory?: Record<string, string>;
}

interface XrayConfigResponse extends ActionResponse {
  path?: string;
  config?: string;
}

type XrayResourceKind = "inbound" | "outbound";
type XrayResource = Record<string, unknown>;

interface XrayResourceListResponse extends ActionResponse {
  inbounds?: XrayResource[];
  outbounds?: XrayResource[];
}

interface XrayProtocolCombination {
  dir_name: string;
  protocol: string;
  transport: string;
  security: string;
  has_config: boolean;
}

interface XrayExamplesResponse extends ActionResponse {
  combinations?: XrayProtocolCombination[];
}

interface X25519Response extends ActionResponse {
  privateKey?: string;
  publicKey?: string;
}

interface VlessEncryptionResponse extends ActionResponse {
  decryptionConfig?: string;
  encryption?: string;
}

interface RealityDomainProbe {
  domain: string;
  target?: string;
  success: boolean;
  latency_ms?: number;
  error?: string;
}

interface RealityDomainsResponse extends ActionResponse {
  domains?: RealityDomainProbe[];
}

type XrayRoutingRule = Record<string, unknown>;

interface XrayRoutingResponse extends ActionResponse {
  routing?: {
    rules?: XrayRoutingRule[];
    domainStrategy?: string;
    balancers?: XrayResource[];
    [key: string]: unknown;
  } | null;
}

interface Credentials {
  server: ManagedServer;
  token: string;
  pullToken: string;
  agentToken: string;
  command: string;
}

interface UpgradeState {
  serverIDs: number[];
  current: number;
  done: number;
  failed: number;
  logs: string[];
  running: boolean;
}

interface CreateServerForm {
  name: string;
  ipAddress: string;
  pullAddress: string;
  pullPort: string;
  pullToken: string;
  connectionMode: string;
  listenPort: string;
  domain: string;
  xrayMode: string;
  trafficLimitGB: string;
  trafficUsedGB: string;
  trafficResetDay: string;
  trafficStatsMode: string;
  trafficSource: string;
  ipv6Enabled: boolean;
  ddnsEnabled: boolean;
  ddnsProviderID: string;
  stealMode: string;
  siteType: string;
  siteValue: string;
}

const emptyCreateForm: CreateServerForm = {
  name: "",
  ipAddress: "",
  pullAddress: "",
  pullPort: "23889",
  pullToken: "",
  connectionMode: "websocket",
  listenPort: "23889",
  domain: "",
  xrayMode: "external",
  trafficLimitGB: "",
  trafficUsedGB: "",
  trafficResetDay: "1",
  trafficStatsMode: "both",
  trafficSource: "system",
  ipv6Enabled: true,
  ddnsEnabled: false,
  ddnsProviderID: "0",
  stealMode: "default",
  siteType: "static",
  siteValue: "",
};

function assertSuccess<T extends ActionResponse>(response: T, fallback: string): T {
  if (!response || response.success === false) throw new Error(response?.error || response?.message || fallback);
  return response;
}

function messageFrom(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function normalizeDNSProviders(items: DNSProviderWire[] = []): DNSProviderOption[] {
  return items.flatMap((item) => {
    const id = item.id ?? item.ID;
    const name = item.name ?? item.Name;
    const providerType = item.provider_type ?? item.ProviderType;
    if (!id || !name || !providerType) return [];
    return [{ id, name, providerType }];
  });
}

function isConnected(server: ManagedServer): boolean {
  return Boolean(server.ws_connected || server.status === "connected" || server.status === "online");
}

function gbToBytes(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 1024 ** 3) : 0;
}

function bytesToGB(value?: number): string {
  if (!value || value <= 0) return "";
  return (value / 1024 ** 3).toFixed(2).replace(/\.00$/, "");
}

function parseSSELog(raw: string): string {
  if (!raw.trim()) return "操作已完成";
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const messages: string[] = [];
  for (const line of lines) {
    const value = line.startsWith("data:") ? line.slice(5).trim() : line;
    let parsed: { message?: string; output?: string; error?: string; hint?: string; success?: boolean };
    try {
      parsed = JSON.parse(value) as typeof parsed;
    } catch {
      if (!value.startsWith("event:")) messages.push(value);
      continue;
    }
    const resultText = parsed.error || parsed.message || parsed.output || parsed.hint;
    if (resultText) messages.push(resultText);
    if (parsed.success === false) throw new Error(resultText || "远端操作失败");
  }
  return messages.slice(-4).join("\n") || "操作已完成";
}

function cleanXrayResource(resource: XrayResource): XrayResource {
  return Object.fromEntries(Object.entries(resource).filter(([key]) => !key.startsWith("_")));
}

function xrayResourceTag(resource: XrayResource): string {
  return typeof resource.tag === "string" ? resource.tag : "";
}

function xrayResourceProtocol(resource: XrayResource): string {
  return typeof resource.protocol === "string" ? resource.protocol : "";
}

type InboundCreationPreset = "reality" | "wss" | "advanced";

interface SecureInboundDraft {
  uuid: string;
  domain: string;
  path: string;
  shortId: string;
  privateKey: string;
  publicKey: string;
  enhancedEncryption: boolean;
  decryptionConfig: string;
  encryption: string;
}

function randomHex(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("").slice(0, length);
}

function createUUID(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = randomHex(32).split("");
  bytes[12] = "4";
  bytes[16] = ["8", "9", "a", "b"][Number.parseInt(bytes[16], 16) % 4];
  const value = bytes.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function newSecureInboundDraft(serverDomain = ""): SecureInboundDraft {
  return {
    uuid: createUUID(),
    domain: serverDomain.trim().toLowerCase(),
    path: `/ws/${randomHex(12)}`,
    shortId: randomHex(16),
    privateKey: "",
    publicKey: "",
    enhancedEncryption: false,
    decryptionConfig: "",
    encryption: "",
  };
}

function validUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function validDomain(value: string): boolean {
  const domain = value.trim().toLowerCase();
  if (domain.length < 3 || domain.length > 253 || !domain.includes(".") || domain.includes("..")) return false;
  return domain.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

function validWSPath(value: string): boolean {
  return value.length >= 2 && value.length <= 1024 && /^\/[^\s?#]*$/.test(value);
}

function validRealityKey(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

function buildSecureInbound(
  preset: Exclude<InboundCreationPreset, "advanced">,
  fields: { tag: string; port: string },
  draft: SecureInboundDraft,
): XrayResource {
  const tag = fields.tag.trim();
  const port = Number(fields.port);
  const domain = draft.domain.trim().toLowerCase();
  const uuid = draft.uuid.trim();
  if (!tag) throw new Error("Tag 不能为空");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("监听端口必须在 1 到 65535 之间");
  if (!validUUID(uuid)) throw new Error("UUID 必须是标准的 36 位格式");
  if (!validDomain(domain)) throw new Error("域名必须是不含协议、端口和路径的有效主机名");

  const settings: Record<string, unknown> = {
    clients: [{ id: uuid, ...(preset === "reality" ? { flow: "xtls-rprx-vision" } : {}) }],
    decryption: "none",
  };
  if (preset === "reality" && draft.enhancedEncryption) {
    if (!draft.decryptionConfig || !draft.encryption) throw new Error("增强加密密钥尚未生成，请重试或关闭增强加密");
    settings.decryption = draft.decryptionConfig;
    // 控制端在同步节点时读取该客户端参数；Xray 服务端使用 decryption。
    settings.encryption = draft.encryption;
  }

  if (preset === "reality") {
    const shortId = draft.shortId.trim().toLowerCase();
    if (!validRealityKey(draft.privateKey) || !validRealityKey(draft.publicKey)) throw new Error("Reality X25519 密钥不完整，请重新生成");
    if (!/^[0-9a-f]{2,16}$/.test(shortId) || shortId.length % 2 !== 0) throw new Error("Reality Short ID 必须是 2 到 16 位偶数长度十六进制");
    return {
      tag,
      listen: "0.0.0.0",
      port,
      protocol: "vless",
      settings,
      streamSettings: {
        network: "tcp",
        security: "reality",
        realitySettings: {
          show: false,
          target: `${domain}:443`,
          xver: 0,
          serverNames: [domain],
          privateKey: draft.privateKey,
          shortIds: [shortId],
        },
      },
      sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], routeOnly: false },
    };
  }

  const path = draft.path.trim();
  if (!validWSPath(path)) throw new Error("WebSocket 路径必须以 / 开头，且不能包含空格、查询参数或片段");
  return {
    tag,
    listen: "127.0.0.1",
    port,
    protocol: "vless",
    settings,
    streamSettings: {
      network: "ws",
      security: "none",
      wsSettings: { path, host: domain },
    },
    sniffing: { enabled: true, destOverride: ["http", "tls"], routeOnly: false },
  };
}

function routingRuleValues(rule: XrayRoutingRule, key: string): string[] {
  const value = rule[key];
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string" || typeof value === "number") return String(value).split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function parseRoutingValues(value: string): string[] {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

export function ServicesWorkbenchPage({ notify, onOpenAdvanced }: { notify: Notify; onOpenAdvanced?: () => void }) {
  const [servers, setServers] = useState<ManagedServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [view, setView] = useState<ViewMode>(() => localStorage.getItem("arcway-services-view") === "list" ? "list" : "cards");
  const [selected, setSelected] = useState<number[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [sharedOpen, setSharedOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedServer | null>(null);
  const [details, setDetails] = useState<ManagedServer | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [credentialsLoading, setCredentialsLoading] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<ManagedServer | null>(null);
  const [deleteWorking, setDeleteWorking] = useState(false);
  const [upgrade, setUpgrade] = useState<UpgradeState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = assertSuccess(await api.get<ServerListResponse>("/api/admin/remote-servers"), "服务器列表加载失败");
      setServers((response.servers ?? []) as ManagedServer[]);
      setSelected((current) => current.filter((id) => (response.servers ?? []).some((server) => server.id === id)));
    } catch (reason) {
      setError(messageFrom(reason, "服务器列表加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return servers.filter((server) => {
      const online = isConnected(server);
      if (filter === "online" && !online) return false;
      if (filter === "offline" && online) return false;
      if (!keyword) return true;
      return [server.name, server.ip_address, server.ip_address_v6, server.domain, server.pull_address, server.xray_version]
        .some((value) => value?.toLowerCase().includes(keyword));
    });
  }, [filter, query, servers]);

  const online = servers.filter(isConnected);
  const selectedOnline = servers.filter((server) => selected.includes(server.id) && isConnected(server));
  const hasSelection = selected.length > 0;
  const upgradeTargets = hasSelection ? selectedOnline : online;
  const upgradeLabel = hasSelection
    ? `升级选中在线 (${selectedOnline.length}/${selected.length})`
    : "批量升级 Agent";

  const changeView = (next: ViewMode) => {
    setView(next);
    localStorage.setItem("arcway-services-view", next);
  };

  const revealCredentials = async (server: ManagedServer) => {
    setCredentialsLoading(server.id);
    try {
      const result = assertSuccess(await api.get<ActionResponse & { token?: string; pull_token?: string; agent_token?: string; install_command?: string }>(`/api/admin/remote-servers/reveal-token?server_id=${server.id}`), "读取凭据失败");
      if (!result.token) throw new Error("服务端未返回服务器 Token");
      if (!result.install_command) throw new Error("服务端未返回权威安装命令，请先升级控制端");
      setCredentials({
        server,
        token: result.token,
        pullToken: result.pull_token ?? "",
        agentToken: result.agent_token ?? "",
        command: result.install_command,
      });
    } catch (reason) {
      notify(messageFrom(reason, "读取凭据失败"), "error");
    } finally {
      setCredentialsLoading(null);
    }
  };

  const deleteServer = async () => {
    if (!deleting) return;
    setDeleteWorking(true);
    try {
      assertSuccess(await api.post<ActionResponse>("/api/admin/remote-servers/delete", { id: deleting.id }), "删除服务器失败");
      notify(`已从控制端删除 ${deleting.name}`);
      setDeleting(null);
      await load();
    } catch (reason) {
      notify(messageFrom(reason, "删除服务器失败"), "error");
    } finally {
      setDeleteWorking(false);
    }
  };

  const runUpgrade = async (targets: ManagedServer[]) => {
    if (!targets.length) return;
    const state: UpgradeState = { serverIDs: targets.map((server) => server.id), current: 0, done: 0, failed: 0, logs: [], running: true };
    setUpgrade(state);
    let done = 0;
    let failed = 0;
    const logs: string[] = [];
    for (let index = 0; index < targets.length; index++) {
      const server = targets[index];
      setUpgrade({ ...state, current: index, done, failed, logs: [...logs], running: true });
      try {
        const raw = await request<string>(`/api/admin/remote/agent/upgrade-stream?server_id=${server.id}`, {
          method: "POST",
          headers: { Accept: "text/event-stream" },
        });
        const result = parseSSELog(typeof raw === "string" ? raw : JSON.stringify(raw));
        logs.push(`${server.name}: ${result}`);
        done++;
      } catch (reason) {
        logs.push(`${server.name}: ${messageFrom(reason, "升级失败")}`);
        failed++;
      }
    }
    setUpgrade({ ...state, current: targets.length, done, failed, logs, running: false });
    notify(failed ? `Agent 升级完成：${done} 成功，${failed} 失败` : `${done} 台 Agent 已完成升级`, failed ? "error" : "success");
    await load();
  };

  return (
    <div className="services-workbench">
      <PageHeader
        eyebrow="Infrastructure"
        title="服务管理"
        description={`${servers.length} 台服务器 · ${online.length} 台在线 · ${servers.length - online.length} 台离线`}
        actions={<>
          <IconButton label="刷新服务器" onClick={() => void load()} disabled={loading}><RefreshCw size={18} /></IconButton>
          {onOpenAdvanced ? <Button variant="secondary" onClick={onOpenAdvanced}><Wrench size={17} />高级运维</Button> : null}
          <Button variant="secondary" onClick={() => void runUpgrade(upgradeTargets)} disabled={!upgradeTargets.length || Boolean(upgrade?.running)}><UploadCloud size={17} />{upgradeLabel}</Button>
          <Button variant="secondary" onClick={() => setSharedOpen(true)}><Cloud size={17} />添加共享服务器</Button>
          <Button onClick={() => setCreateOpen(true)}><Plus size={17} />添加服务器</Button>
        </>}
      />

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <Surface className="services-toolbar">
        <div className="services-filters" role="group" aria-label="服务器状态筛选">
          {(["all", "online", "offline"] as StatusFilter[]).map((value) => (
            <button key={value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>
              {value === "all" ? `全部 ${servers.length}` : value === "online" ? `在线 ${online.length}` : `离线 ${servers.length - online.length}`}
            </button>
          ))}
        </div>
        <label className="services-search"><Search size={17} /><input aria-label="搜索服务器" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名称、IP、域名或版本" /></label>
        <div className="services-view-switch" role="group" aria-label="服务视图">
          <IconButton className={view === "cards" ? "is-active" : ""} label="卡片视图" onClick={() => changeView("cards")}><Grid2X2 size={17} /></IconButton>
          <IconButton className={view === "list" ? "is-active" : ""} label="列表视图" onClick={() => changeView("list")}><List size={18} /></IconButton>
        </div>
      </Surface>

      {loading ? <Surface className="center-state"><Spinner label="正在加载服务器" /></Surface> : visible.length === 0 ? (
        <Surface><EmptyState icon={<Server size={24} />} title={servers.length ? "没有匹配的服务器" : "尚未接入服务器"} description={servers.length ? "调整搜索词或状态筛选" : "创建服务器后会得到 Agent 安装命令"} action={!servers.length ? <Button onClick={() => setCreateOpen(true)}><Plus size={16} />添加服务器</Button> : undefined} /></Surface>
      ) : view === "cards" ? (
        <div className="services-card-grid">
          {visible.map((server) => <ServerCard key={server.id} server={server} checked={selected.includes(server.id)} credentialsLoading={credentialsLoading === server.id} onCheck={(checked) => setSelected((current) => checked ? [...new Set([...current, server.id])] : current.filter((id) => id !== server.id))} onOpen={() => setDetails(server)} onEdit={() => setEditing(server)} onCredentials={() => void revealCredentials(server)} onDelete={() => setDeleting(server)} />)}
        </div>
      ) : (
        <ServerTable servers={visible} selected={selected} credentialsLoading={credentialsLoading} onSelect={setSelected} onOpen={setDetails} onEdit={setEditing} onCredentials={(server) => void revealCredentials(server)} onDelete={setDeleting} />
      )}

      {createOpen ? <CreateServerDialog onClose={() => setCreateOpen(false)} onCreated={async (result) => { setCreateOpen(false); await load(); if (result.server && result.install_command) setCredentials({ server: result.server, token: result.server.token ?? "", pullToken: result.server.pull_token ?? "", agentToken: result.server.agent_token ?? "", command: result.install_command }); notify("服务器已创建"); }} /> : null}
      {sharedOpen ? <AddSharedServerDialog onClose={() => setSharedOpen(false)} onCreated={async () => { setSharedOpen(false); notify("共享服务器已接入"); await load(); }} /> : null}
      {editing ? <EditServerDialog server={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); notify("服务器设置已保存"); await load(); }} /> : null}
      {details ? <ServerOperationsDialog server={details} notify={notify} onClose={() => setDetails(null)} onChanged={load} onUpgrade={() => void runUpgrade([details])} /> : null}
      {credentials ? <CredentialsDialog value={credentials} notify={notify} onClose={() => setCredentials(null)} /> : null}
      {deleting ? <ConfirmDialog title="删除服务器" description={`将从控制端删除“${deleting.name}”及其关联记录；远端 Agent 不会自动卸载。`} confirmLabel="确认删除" working={deleteWorking} onCancel={() => !deleteWorking && setDeleting(null)} onConfirm={() => void deleteServer()} /> : null}
      {upgrade ? <UpgradeDialog state={upgrade} servers={servers} onClose={() => !upgrade.running && setUpgrade(null)} /> : null}
    </div>
  );
}

function ServerCard({ server, checked, credentialsLoading, onCheck, onOpen, onEdit, onCredentials, onDelete }: {
  server: ManagedServer;
  checked: boolean;
  credentialsLoading: boolean;
  onCheck: (checked: boolean) => void;
  onOpen: () => void;
  onEdit: () => void;
  onCredentials: () => void;
  onDelete: () => void;
}) {
  const connected = isConnected(server);
  const usage = server.traffic_limit > 0 ? Math.min(100, server.traffic_used / server.traffic_limit * 100) : 0;
  return (
    <Surface className={`service-card ${checked ? "is-selected" : ""}`}>
      <div className="service-card-head">
        <label className="service-select" title="选择服务器"><input type="checkbox" checked={checked} onChange={(event) => onCheck(event.target.checked)} aria-label={`选择 ${server.name}`} /></label>
        <span className={`service-server-icon ${connected ? "is-online" : ""}`}>{connected ? <Wifi size={19} /> : <WifiOff size={19} />}</span>
        <div className="service-card-title"><strong>{server.name}</strong><small>{server.domain || server.ip_address || "等待 Agent 上报地址"}</small></div>
        <Badge tone={connected ? "good" : statusTone(server.status)}>{connected ? "在线" : "离线"}</Badge>
      </div>
      <div className="service-badges">
        {server.is_federated ? <Badge tone="info">共享</Badge> : null}
        <Badge tone={server.xray_running ? "good" : "neutral"}>Xray {server.xray_running ? "运行中" : "未运行"}</Badge>
        {server.encrypted ? <Badge tone="good"><ShieldCheck size={12} />加密连接</Badge> : null}
        {server.warp_installed ? <Badge tone="info">WARP</Badge> : null}
      </div>
      <div className="service-metrics">
        <span><small>实时上行</small><strong><ArrowUpFromLine size={14} />{formatBytes(server.current_upload_speed, true)}</strong></span>
        <span><small>实时下行</small><strong><ArrowDownToLine size={14} />{formatBytes(server.current_download_speed, true)}</strong></span>
        <span><small>入站</small><strong>{server.inbounds?.length ?? 0}</strong></span>
      </div>
      <div className="service-traffic">
        <div><small>本期流量</small><strong>{formatBytes(server.traffic_used)}{server.traffic_limit > 0 ? ` / ${formatBytes(server.traffic_limit)}` : ""}</strong></div>
        <span><i style={{ width: server.traffic_limit > 0 ? `${usage}%` : "0%" }} /></span>
      </div>
      <div className="service-card-meta">
        <span>{server.ip_address || "IPv4 未上报"}{server.ipv6_enabled && server.ip_address_v6 ? ` · ${server.ip_address_v6}` : ""}</span>
        <span>{server.xray_version || server.xray_mode || "external"} · {relativeTime(server.last_heartbeat)}</span>
      </div>
      <div className="service-card-actions">
        <Button variant="ghost" onClick={onOpen}><Wrench size={16} />管理</Button>
        <IconButton label={`编辑 ${server.name}`} onClick={onEdit}><Pencil size={16} /></IconButton>
        {!server.is_federated ? <IconButton label={`查看 ${server.name} 安装凭据`} onClick={onCredentials} disabled={credentialsLoading}>{credentialsLoading ? <RefreshCw className="service-spin" size={16} /> : <KeyRound size={16} />}</IconButton> : null}
        <IconButton label={`删除 ${server.name}`} onClick={onDelete}><Trash2 size={16} /></IconButton>
      </div>
    </Surface>
  );
}

function ServerTable({ servers, selected, credentialsLoading, onSelect, onOpen, onEdit, onCredentials, onDelete }: {
  servers: ManagedServer[];
  selected: number[];
  credentialsLoading: number | null;
  onSelect: (ids: number[]) => void;
  onOpen: (server: ManagedServer) => void;
  onEdit: (server: ManagedServer) => void;
  onCredentials: (server: ManagedServer) => void;
  onDelete: (server: ManagedServer) => void;
}) {
  const allChecked = servers.length > 0 && servers.every((server) => selected.includes(server.id));
  return (
    <Surface className="table-surface service-table-surface"><div className="table-wrap"><table><thead><tr><th><input aria-label="选择全部服务器" type="checkbox" checked={allChecked} onChange={(event) => onSelect(event.target.checked ? Array.from(new Set([...selected, ...servers.map((server) => server.id)])) : selected.filter((id) => !servers.some((server) => server.id === id)))} /></th><th>服务器</th><th>连接</th><th>实时速度</th><th>本期流量</th><th>Xray</th><th aria-label="操作" /></tr></thead><tbody>{servers.map((server) => {
      const connected = isConnected(server);
      return <tr key={server.id}><td><input aria-label={`选择 ${server.name}`} type="checkbox" checked={selected.includes(server.id)} onChange={(event) => onSelect(event.target.checked ? [...new Set([...selected, server.id])] : selected.filter((id) => id !== server.id))} /></td><td><button className="service-name-button" onClick={() => onOpen(server)}><span className={`service-server-icon ${connected ? "is-online" : ""}`}>{connected ? <Wifi size={16} /> : <WifiOff size={16} />}</span><span><strong>{server.name}</strong><small>{server.domain || server.ip_address || "地址待上报"}</small></span></button></td><td><Badge tone={connected ? "good" : statusTone(server.status)}>{connected ? "WebSocket" : server.status || "离线"}</Badge><small className="cell-note">{relativeTime(server.last_heartbeat)}</small></td><td><span className="speed-pair"><small><ArrowUpFromLine size={13} />{formatBytes(server.current_upload_speed, true)}</small><small><ArrowDownToLine size={13} />{formatBytes(server.current_download_speed, true)}</small></span></td><td><strong>{formatBytes(server.traffic_used)}</strong><small className="cell-note">{server.traffic_limit ? `限额 ${formatBytes(server.traffic_limit)}` : "不限额"}</small></td><td><Badge tone={server.xray_running ? "good" : "neutral"}>{server.xray_running ? server.xray_version || "运行中" : "未运行"}</Badge><small className="cell-note">{server.xray_mode || "external"}</small></td><td><div className="service-row-actions"><IconButton label={`管理 ${server.name}`} onClick={() => onOpen(server)}><Settings2 size={16} /></IconButton><IconButton label={`编辑 ${server.name}`} onClick={() => onEdit(server)}><Pencil size={16} /></IconButton>{!server.is_federated ? <IconButton label={`查看 ${server.name} 安装凭据`} onClick={() => onCredentials(server)} disabled={credentialsLoading === server.id}>{credentialsLoading === server.id ? <RefreshCw className="service-spin" size={16} /> : <KeyRound size={16} />}</IconButton> : null}<IconButton label={`删除 ${server.name}`} onClick={() => onDelete(server)}><Trash2 size={16} /></IconButton></div></td></tr>;
    })}</tbody></table></div></Surface>
  );
}

function ServerFormFields({ form, setForm, editing = false }: { form: CreateServerForm; setForm: (value: CreateServerForm) => void; editing?: boolean }) {
  const [dnsProviders, setDNSProviders] = useState<DNSProviderOption[]>([]);
  const [dnsProvidersLoading, setDNSProvidersLoading] = useState(true);
  const [dnsProvidersError, setDNSProvidersError] = useState("");
  const patch = <K extends keyof CreateServerForm>(key: K, value: CreateServerForm[K]) => setForm({ ...form, [key]: value });

  useEffect(() => {
    let active = true;
    const loadProviders = async () => {
      setDNSProvidersLoading(true);
      setDNSProvidersError("");
      try {
        const result = assertSuccess(await api.get<DNSProvidersResponse>("/api/admin/dns-providers"), "读取 DNS 提供商失败");
        if (active) setDNSProviders(normalizeDNSProviders(result.providers));
      } catch (reason) {
        if (active) setDNSProvidersError(messageFrom(reason, "读取 DNS 提供商失败"));
      } finally {
        if (active) setDNSProvidersLoading(false);
      }
    };
    void loadProviders();
    return () => { active = false; };
  }, []);

  const configuredProviderMissing = Number(form.ddnsProviderID) > 0 && !dnsProviders.some((provider) => provider.id === Number(form.ddnsProviderID));
  const providerHint = dnsProvidersLoading
    ? "正在读取证书管理中的 DNS 提供商"
    : dnsProvidersError
      ? "提供商列表读取失败；可保留当前配置或改用自动模式"
      : "自动模式会按 DDNS 域名匹配证书，并复用该证书的 DNS 提供商";
  return <>
    <div className="form-grid"><Field label="服务器名称"><input required autoFocus value={form.name} onChange={(event) => patch("name", event.target.value)} placeholder="Hong Kong 01" /></Field><Field label="连接模式"><select value={form.connectionMode} onChange={(event) => patch("connectionMode", event.target.value)} disabled={editing}><option value="websocket">WebSocket（推荐）</option><option value="push">HTTP Push</option><option value="pull">HTTP Pull</option></select></Field></div>
    <div className="form-grid"><Field label="公网 IPv4 / 初始地址" hint="允许留空，Agent 首次连接后自动上报"><input value={form.ipAddress} onChange={(event) => patch("ipAddress", event.target.value)} placeholder="203.0.113.10" disabled={editing} /></Field><Field label="服务器地址 / DDNS 域名"><input value={form.pullAddress} onChange={(event) => patch("pullAddress", event.target.value)} placeholder="edge.example.com" /></Field></div>
    <div className="form-grid"><Field label="Agent 监听端口"><input type="number" min="1024" max="65534" value={form.listenPort} onChange={(event) => patch("listenPort", event.target.value)} disabled={editing} /></Field><Field label="Pull 端口"><input type="number" min="1" max="65535" value={form.pullPort} onChange={(event) => patch("pullPort", event.target.value)} disabled={form.connectionMode !== "pull"} /></Field></div>
    {!editing && form.connectionMode === "pull" ? <Field label="可选 Agent 认证 Token" hint="留空时由控制端安全生成"><input value={form.pullToken} onChange={(event) => patch("pullToken", event.target.value)} /></Field> : null}
    <div className="form-grid"><Field label="节点域名" hint={form.stealMode === "default" ? undefined : "Tunnel/Fallback 接管模式必填"}><input required={form.stealMode !== "default"} value={form.domain} onChange={(event) => patch("domain", event.target.value)} placeholder="hk.example.com" /></Field><Field label="Xray 模式"><select value={form.xrayMode} onChange={(event) => patch("xrayMode", event.target.value)}><option value="external">外置 Xray</option><option value="embedded">内嵌 Xray</option></select></Field></div>
    <div className="form-grid"><Field label="流量限额（GB）" hint="0 或留空表示不限"><input type="number" min="0" step="0.01" value={form.trafficLimitGB} onChange={(event) => patch("trafficLimitGB", event.target.value)} /></Field><Field label={editing ? "已用流量校准（GB，可选）" : "初始已用流量（GB）"}><input type="number" min="0" step="0.01" value={form.trafficUsedGB} onChange={(event) => patch("trafficUsedGB", event.target.value)} placeholder={editing ? "留空保持不变" : "0"} /></Field></div>
    <div className="form-grid"><Field label="每月重置日" hint="0 表示不自动重置"><input type="number" min="0" max="31" value={form.trafficResetDay} onChange={(event) => patch("trafficResetDay", event.target.value)} /></Field><Field label="服务器流量来源"><select value={form.trafficSource} onChange={(event) => patch("trafficSource", event.target.value)}><option value="system">系统网卡（VPS 计费口径）</option><option value="xray">Xray 节点聚合</option></select></Field></div>
    <Field label="流量统计方向"><select value={form.trafficStatsMode} onChange={(event) => patch("trafficStatsMode", event.target.value)}><option value="both">上行 + 下行</option><option value="max">上行 / 下行取较大值</option><option value="upload">仅上行</option><option value="download">仅下行</option></select></Field>
    <div className="service-toggle-grid"><Toggle checked={form.ipv6Enabled} onChange={(value) => patch("ipv6Enabled", value)} label="启用 IPv6" /><Toggle checked={form.ddnsEnabled} onChange={(value) => patch("ddnsEnabled", value)} label="自动同步 DDNS" /></div>
    {form.ddnsEnabled ? <Field label="DDNS 提供商" hint={providerHint}><select aria-label="DDNS 提供商" value={form.ddnsProviderID} onChange={(event) => patch("ddnsProviderID", event.target.value)}><option value="0">自动（按证书）</option>{configuredProviderMissing ? <option value={form.ddnsProviderID}>当前配置 #{form.ddnsProviderID}（列表中不可用）</option> : null}{dnsProviders.map((provider) => <option key={provider.id} value={String(provider.id)}>{provider.name}（{provider.providerType}）</option>)}</select></Field> : null}
    {!editing ? <details className="service-advanced-fields"><summary>前置与伪装站高级选项</summary><div className="form-stack"><div className="form-grid"><Field label="接管模式"><select value={form.stealMode} onChange={(event) => patch("stealMode", event.target.value)}><option value="default">不接管</option><option value="tunnel">Tunnel</option><option value="fallback">Fallback</option></select></Field><Field label="站点类型"><select value={form.siteType} onChange={(event) => patch("siteType", event.target.value)}><option value="static">静态目录</option><option value="proxy">反向代理</option></select></Field></div><Field label={form.siteType === "proxy" ? "反代目标" : "静态目录"}><input value={form.siteValue} onChange={(event) => patch("siteValue", event.target.value)} placeholder={form.siteType === "proxy" ? "http://127.0.0.1:8080" : "/var/www/html"} /></Field></div></details> : null}
  </>;
}

function CreateServerDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (result: ActionResponse & { server?: ManagedServer; install_command?: string }) => void }) {
  const [form, setForm] = useState<CreateServerForm>(emptyCreateForm);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const response = assertSuccess(await api.post<ActionResponse & { server?: ManagedServer; install_command?: string }>("/api/admin/remote-servers/create", {
        name: form.name.trim(),
        ip_address: form.ipAddress.trim(),
        pull_address: form.pullAddress.trim(),
        pull_port: Number(form.pullPort) || 23889,
        pull_token: form.pullToken.trim(),
        connection_mode: form.connectionMode,
        listen_port: Number(form.listenPort) || 0,
        domain: form.domain.trim(),
        xray_mode: form.xrayMode,
        traffic_limit: gbToBytes(form.trafficLimitGB),
        traffic_used_offset: gbToBytes(form.trafficUsedGB),
        traffic_reset_day: Number(form.trafficResetDay) || 0,
        traffic_stats_mode: form.trafficStatsMode,
        traffic_source: form.trafficSource,
        ipv6_enabled: form.ipv6Enabled,
        ddns_enabled: form.ddnsEnabled,
        ddns_provider_id: Number(form.ddnsProviderID) || 0,
        steal_self: form.stealMode === "tunnel" || form.stealMode === "fallback",
        front_service: "xray",
        use_443: form.stealMode === "tunnel" || form.stealMode === "fallback",
        steal_mode: form.stealMode,
        site_type: form.siteType,
        site_value: form.siteValue.trim(),
      }), "创建服务器失败");
      if (!response.server || !response.install_command) throw new Error("创建成功，但响应缺少服务器信息或权威安装命令");
      onCreated(response);
    } catch (reason) {
      setError(messageFrom(reason, "创建服务器失败"));
    } finally {
      setWorking(false);
    }
  };
  return <Dialog title="添加服务器" description="创建 Agent 身份并生成安装命令" onClose={() => !working && onClose()} wide><form className="form-stack" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<ServerFormFields form={form} setForm={setForm} /><div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={working}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在创建" /> : <><Plus size={16} />创建并生成命令</>}</Button></div></form></Dialog>;
}

function formFromServer(server: ManagedServer): CreateServerForm {
  return {
    ...emptyCreateForm,
    name: server.name,
    ipAddress: server.ip_address ?? "",
    pullAddress: server.pull_address ?? "",
    pullPort: String(server.pull_port || 23889),
    connectionMode: server.connection_mode || "websocket",
    listenPort: String(server.listen_port || 23889),
    domain: server.domain ?? "",
    xrayMode: server.xray_mode || "external",
    trafficLimitGB: bytesToGB(server.traffic_limit),
    trafficUsedGB: "",
    trafficResetDay: String(server.traffic_reset_day ?? 0),
    trafficStatsMode: server.traffic_stats_mode || "both",
    trafficSource: server.traffic_source || "system",
    ipv6Enabled: server.ipv6_enabled,
    ddnsEnabled: Boolean(server.ddns_enabled),
    ddnsProviderID: String(server.ddns_provider_id ?? 0),
  };
}

function EditServerDialog({ server, onClose, onSaved }: { server: ManagedServer; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<CreateServerForm>(() => formFromServer(server));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const updatesPullConfig = Boolean(form.pullAddress.trim()) || form.connectionMode === "pull";
      let pullToken = "";
      if (updatesPullConfig) {
        const credentials = assertSuccess(await api.get<ActionResponse & { pull_token?: string; agent_token?: string }>(`/api/admin/remote-servers/reveal-token?server_id=${server.id}`), "读取现有 Agent Token 失败");
        pullToken = credentials.pull_token || credentials.agent_token || "";
        if (!pullToken) throw new Error("现有 Agent Token 为空，为避免破坏连接已取消保存");
      }
      const payload: Record<string, unknown> = {
        id: server.id,
        name: form.name.trim(),
        domain: form.domain.trim(),
        traffic_limit: gbToBytes(form.trafficLimitGB),
        traffic_reset_day: Number(form.trafficResetDay) || 0,
        connection_mode: form.connectionMode,
        listen_port: Number(form.listenPort) || 0,
        pull_address: updatesPullConfig ? form.pullAddress.trim() : "",
        pull_port: updatesPullConfig ? Number(form.pullPort) || 23889 : 0,
        pull_token: pullToken,
        xray_mode: form.xrayMode,
        traffic_stats_mode: form.trafficStatsMode,
        traffic_source: form.trafficSource,
        ipv6_enabled: form.ipv6Enabled,
        ddns_enabled: form.ddnsEnabled,
        ddns_provider_id: Number(form.ddnsProviderID) || 0,
      };
      if (form.trafficUsedGB.trim()) payload.traffic_used = gbToBytes(form.trafficUsedGB);
      assertSuccess(await api.put<ActionResponse>("/api/admin/remote-servers/update", payload), "保存服务器设置失败");
      onSaved();
    } catch (reason) {
      setError(messageFrom(reason, "保存服务器设置失败"));
    } finally {
      setWorking(false);
    }
  };
  return <Dialog title={`编辑 ${server.name}`} description="保存后流量口径和 Xray 模式会同步到 Agent" onClose={() => !working && onClose()} wide><form className="form-stack" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<ServerFormFields form={form} setForm={setForm} editing /><div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={working}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在保存" /> : <><Check size={16} />保存更改</>}</Button></div></form></Dialog>;
}

function AddSharedServerDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ ownerURL: "", shareToken: "", name: "", prefix: "" });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      await api.post("/api/admin/remote-servers/add-shared", { owner_url: form.ownerURL.trim(), share_token: form.shareToken.trim(), name: form.name.trim(), prefix: form.prefix.trim() });
      onCreated();
    } catch (reason) {
      setError(messageFrom(reason, "共享服务器接入失败"));
    } finally {
      setWorking(false);
    }
  };
  return <Dialog title="添加共享服务器" description="使用另一套控制端签发的一次性分享令牌接入服务器" onClose={() => !working && onClose()}><form className="form-stack" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<Field label="拥有方控制端地址"><input required autoFocus value={form.ownerURL} onChange={(event) => setForm({ ...form, ownerURL: event.target.value })} placeholder="https://panel.example.com" /></Field><Field label="分享令牌"><input required value={form.shareToken} onChange={(event) => setForm({ ...form, shareToken: event.target.value })} autoComplete="off" /></Field><div className="form-grid"><Field label="显示名称（可选）"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field label="节点名称前缀（可选）"><input value={form.prefix} onChange={(event) => setForm({ ...form, prefix: event.target.value })} placeholder="共享-" /></Field></div><div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={working}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在验证令牌" /> : <><Cloud size={16} />验证并接入</>}</Button></div></form></Dialog>;
}

function CredentialsDialog({ value, notify, onClose }: { value: Credentials; notify: Notify; onClose: () => void }) {
  const copy = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); notify(`${label}已复制`); } catch { notify("复制失败，请手动选择", "error"); }
  };
  return <Dialog title={`${value.server.name} 接入凭据`} description="Token 具有服务器管理权限，只应保存在目标服务器" onClose={onClose} wide><div className="credential-warning"><ShieldCheck size={19} /><span><strong>敏感信息</strong><small>关闭弹窗后不会继续在列表中显示明文 Token。</small></span></div><Field label="Agent 安装命令"><div className="service-command"><code>{value.command}</code><IconButton label="复制 Agent 安装命令" onClick={() => void copy(value.command, "安装命令")}><Copy size={17} /></IconButton></div></Field><div className="form-grid"><Field label="服务器 Token"><div className="service-command compact"><code>{value.token || "仅创建时可见"}</code>{value.token ? <IconButton label="复制服务器 Token" onClick={() => void copy(value.token, "服务器 Token")}><Copy size={16} /></IconButton> : null}</div></Field><Field label="Agent Token"><div className="service-command compact"><code>{value.agentToken || value.pullToken || "未设置"}</code>{value.agentToken || value.pullToken ? <IconButton label="复制 Agent Token" onClick={() => void copy(value.agentToken || value.pullToken, "Agent Token")}><Copy size={16} /></IconButton> : null}</div></Field></div><div className="dialog-actions"><Button onClick={onClose}><Check size={16} />完成</Button></div></Dialog>;
}

function UpgradeDialog({ state, servers, onClose }: { state: UpgradeState; servers: ManagedServer[]; onClose: () => void }) {
  const current = state.current < state.serverIDs.length ? servers.find((server) => server.id === state.serverIDs[state.current]) : null;
  const progress = state.serverIDs.length ? Math.round((state.done + state.failed) / state.serverIDs.length * 100) : 0;
  return <Dialog title="Agent 批量升级" description={state.running ? `正在处理 ${current?.name ?? "服务器"}` : "升级任务已结束"} onClose={onClose} dismissible={!state.running} wide><div className="upgrade-summary"><span><strong>{state.done}</strong><small>成功</small></span><span><strong>{state.failed}</strong><small>失败</small></span><span><strong>{state.serverIDs.length - state.done - state.failed}</strong><small>待处理</small></span></div><div className="upgrade-progress"><span><i style={{ width: `${progress}%` }} /></span><small>{progress}%</small></div><pre className="service-log" aria-label="Agent 升级日志">{state.logs.length ? state.logs.join("\n\n") : "等待远端 Agent 返回升级结果..."}</pre><div className="dialog-actions"><Button onClick={onClose} disabled={state.running}>{state.running ? <Spinner label="升级进行中" /> : <><Check size={16} />关闭</>}</Button></div></Dialog>;
}

function DDNSOverviewPanel({ status, working, onRetry }: { status: DDNSStatusResponse | null; working: boolean; onRetry: () => void }) {
  const enabled = Boolean(status?.ddns_enabled);
  const provider = status?.ddns_provider_id
    ? status.ddns_provider_name || `提供商 #${status.ddns_provider_id}`
    : status?.ddns_provider_name
      ? `${status.ddns_provider_name}（自动匹配）`
      : "自动（按证书）";
  const state = !status
    ? { label: "状态未知", tone: "neutral" as const }
    : !enabled
      ? { label: "未启用", tone: "neutral" as const }
      : status.ddns_pending
        ? { label: "同步中", tone: "warn" as const }
        : status.ddns_last_error
          ? { label: "同步失败", tone: "bad" as const }
          : status.ddns_last_synced_at
            ? { label: "正常", tone: "good" as const }
            : { label: "等待首次同步", tone: "info" as const };

  return <Surface className="service-ddns-panel">
    <div className="service-ddns-head"><span><Cloud size={17} /><span><strong>动态 DNS</strong><small>{enabled ? "Agent 地址变化后自动更新解析记录" : "在编辑服务器中启用自动同步"}</small></span></span><Badge tone={state.tone}>{state.label}</Badge></div>
    <dl>
      <div><dt>提供商</dt><dd>{enabled ? provider : "未配置"}</dd></div>
      <div><dt>更新域名</dt><dd>{status?.pull_address || "未设置"}</dd></div>
      <div><dt>最近同步</dt><dd>{status?.ddns_last_synced_at ? relativeTime(status.ddns_last_synced_at) : "尚未同步"}</dd></div>
      <div><dt>最近错误</dt><dd className={status?.ddns_last_error ? "is-error" : ""}>{status?.ddns_last_error || "无"}</dd></div>
    </dl>
    <div className="service-ddns-actions"><Button variant="secondary" onClick={onRetry} disabled={!enabled || Boolean(status?.ddns_pending) || working}>{working ? <Spinner label="正在触发" /> : <><RotateCw size={15} />重试 DDNS</>}</Button></div>
  </Surface>;
}

type OperationTab = "overview" | "services" | "inbounds" | "outbounds" | "routing" | "config" | "sharing";

function ServerOperationsDialog({ server, notify, onClose, onChanged, onUpgrade }: { server: ManagedServer; notify: Notify; onClose: () => void; onChanged: () => Promise<void>; onUpgrade: () => void }) {
  const [tab, setTab] = useState<OperationTab>("overview");
  const [status, setStatus] = useState<ServiceStatusResponse | null>(null);
  const [version, setVersion] = useState<AgentVersionResponse | null>(null);
  const [system, setSystem] = useState<SystemInfoResponse | null>(null);
  const [ddnsStatus, setDDNSStatus] = useState<DDNSStatusResponse | null>(null);
  const [ddnsPollAttempt, setDDNSPollAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [working, setWorking] = useState("");
  const [confirm, setConfirm] = useState<{ service: "xray" | "nginx"; action: "stop" | "remove" } | null>(null);
  const [config, setConfig] = useState("");
  const [configPath, setConfigPath] = useState("");
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configDirty, setConfigDirty] = useState(false);
  const [shares, setShares] = useState<SharedServerToken[]>([]);
  const [shareLabel, setShareLabel] = useState("");
  const [newShareToken, setNewShareToken] = useState("");

  const refreshDDNSStatus = useCallback(async () => {
    const result = assertSuccess(await api.get<DDNSStatusResponse>(`/api/admin/servers/${server.id}/ddns-status`), "读取 DDNS 状态失败");
    setDDNSStatus(result);
    return result;
  }, [server.id]);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      api.get<ServiceStatusResponse>(`/api/admin/remote/services/status?server_id=${server.id}`),
      api.get<AgentVersionResponse>(`/api/admin/remote/agent/version-info?server_id=${server.id}`),
      api.get<SystemInfoResponse>(`/api/admin/remote/system/info?server_id=${server.id}`),
      refreshDDNSStatus(),
    ]);
    if (results[0].status === "fulfilled") setStatus(results[0].value);
    if (results[1].status === "fulfilled") setVersion(results[1].value);
    if (results[2].status === "fulfilled") setSystem(results[2].value);
    if (results.slice(0, 3).every((result) => result.status === "rejected")) setError("Agent 当前不可达，远程运维操作暂不可用");
    setLoading(false);
  }, [refreshDDNSStatus, server.id]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  useEffect(() => {
    if (ddnsPollAttempt <= 0) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void refreshDDNSStatus().then((result) => {
        if (!active) return;
        setDDNSPollAttempt((current) => current >= 10 || (current >= 2 && !result.ddns_pending) ? 0 : current + 1);
      }).catch(() => {
        if (active) setDDNSPollAttempt(0);
      });
    }, ddnsPollAttempt === 1 ? 200 : 1000);
    return () => { active = false; window.clearTimeout(timer); };
  }, [ddnsPollAttempt, refreshDDNSStatus]);

  const triggerDDNS = async () => {
    setWorking("ddns-test");
    setError("");
    try {
      assertSuccess(await api.post<ActionResponse>(`/api/admin/servers/${server.id}/ddns-test`), "触发 DDNS 同步失败");
      setDDNSStatus((current) => current ? { ...current, ddns_pending: true, ddns_last_error: "" } : current);
      setDDNSPollAttempt(1);
      notify("DDNS 同步已触发，正在刷新状态");
    } catch (reason) {
      setError(messageFrom(reason, "触发 DDNS 同步失败"));
    } finally {
      setWorking("");
    }
  };

  const serviceAction = async (service: "xray" | "nginx", action: "start" | "stop" | "restart" | "install" | "remove") => {
    const key = `${service}-${action}`;
    setWorking(key);
    setError("");
    try {
      if (action === "install" || action === "remove") {
        const raw = await request<string>(`/api/admin/remote/${service}/${action === "remove" ? "remove-stream" : "install-stream"}?server_id=${server.id}`, { method: "POST", headers: { Accept: "text/event-stream" } });
        parseSSELog(typeof raw === "string" ? raw : JSON.stringify(raw));
      } else {
        assertSuccess(await api.post<ActionResponse>(`/api/admin/remote/services/control?server_id=${server.id}`, { service, action }), `${service} ${action} 失败`);
      }
      notify(`${service === "xray" ? "Xray" : "Nginx"} ${action === "install" ? "安装" : action === "remove" ? "卸载" : action === "start" ? "启动" : action === "stop" ? "停止" : "重启"}完成`);
      setConfirm(null);
      await loadStatus();
      await onChanged();
    } catch (reason) {
      setError(messageFrom(reason, "远程服务操作失败"));
    } finally {
      setWorking("");
    }
  };

  const loadConfig = async () => {
    setWorking("config-load");
    setError("");
    try {
      const result = assertSuccess(await api.get<XrayConfigResponse>(`/api/admin/remote/xray/config?server_id=${server.id}`), "读取 Xray 配置失败");
      setConfig(result.config ?? "");
      setConfigPath(result.path ?? "");
      setConfigLoaded(true);
      setConfigDirty(false);
    } catch (reason) {
      setError(messageFrom(reason, "读取 Xray 配置失败"));
    } finally {
      setWorking("");
    }
  };

  const testConfig = async () => {
    setWorking("config-test");
    setError("");
    try {
      JSON.parse(config);
      assertSuccess(await api.post<ActionResponse>(`/api/admin/remote/xray/test-config?server_id=${server.id}`, { config, path: configPath }), "Xray 配置预检失败");
      notify("Xray 配置预检通过");
    } catch (reason) {
      setError(messageFrom(reason, "Xray 配置预检失败"));
    } finally {
      setWorking("");
    }
  };

  const saveConfig = async () => {
    setWorking("config-save");
    setError("");
    try {
      JSON.parse(config);
      assertSuccess(await api.post<ActionResponse>(`/api/admin/remote/xray/test-config?server_id=${server.id}`, { config, path: configPath }), "Xray 配置预检失败");
      assertSuccess(await api.post<ActionResponse>(`/api/admin/remote/xray/config?server_id=${server.id}`, { config, path: configPath }), "保存 Xray 配置失败");
      try {
        assertSuccess(await api.post<ActionResponse>(`/api/admin/remote/services/control?server_id=${server.id}`, { service: "xray", action: "restart" }), "Xray 重启失败");
      } catch (reason) {
        throw new Error(`配置已写入，但 Xray 未能重启：${messageFrom(reason, "远端服务不可用")}`);
      }
      setConfigDirty(false);
      notify("Xray 配置已保存，服务已重启");
      await loadStatus();
      await onChanged();
    } catch (reason) {
      setError(messageFrom(reason, "保存 Xray 配置失败"));
    } finally {
      setWorking("");
    }
  };

  const loadShares = useCallback(async () => {
    if (server.is_federated) return;
    try {
      const result = await api.get<{ shares?: SharedServerToken[] }>(`/api/admin/server-share/list?server_id=${server.id}`);
      setShares(result.shares ?? []);
    } catch (reason) {
      setError(messageFrom(reason, "分享令牌加载失败"));
    }
  }, [server.id, server.is_federated]);

  useEffect(() => { if (tab === "sharing") void loadShares(); }, [loadShares, tab]);

  const createShare = async (event: FormEvent) => {
    event.preventDefault();
    setWorking("share-create");
    setError("");
    try {
      const result = await api.post<{ share_token?: string }>("/api/admin/server-share/create", { server_id: server.id, label: shareLabel.trim() });
      if (!result.share_token) throw new Error("创建成功，但服务端未返回分享令牌");
      setNewShareToken(result.share_token);
      setShareLabel("");
      await loadShares();
    } catch (reason) {
      setError(messageFrom(reason, "创建分享令牌失败"));
    } finally {
      setWorking("");
    }
  };

  const revokeShare = async (id: number) => {
    setWorking(`share-${id}`);
    try {
      await api.post("/api/admin/server-share/revoke", { id });
      notify("分享令牌已吊销");
      await loadShares();
    } catch (reason) {
      setError(messageFrom(reason, "吊销分享令牌失败"));
    } finally {
      setWorking("");
    }
  };

  const tabs: Array<{ key: OperationTab; label: string; icon: ReactNode }> = [
    { key: "overview", label: "概览", icon: <Activity size={16} /> },
    { key: "services", label: "服务控制", icon: <TerminalSquare size={16} /> },
    { key: "inbounds", label: "入站", icon: <ArrowDownToLine size={16} /> },
    { key: "outbounds", label: "出站", icon: <ArrowUpFromLine size={16} /> },
    { key: "routing", label: "路由规则", icon: <Network size={16} /> },
    { key: "config", label: "Xray 配置", icon: <Code2 size={16} /> },
    ...(!server.is_federated ? [{ key: "sharing" as const, label: "服务器分享", icon: <Network size={16} /> }] : []),
  ];

  return <Dialog title={server.name} description={`${server.domain || server.ip_address || "地址待上报"} · ${isConnected(server) ? "Agent 在线" : "Agent 离线"}`} onClose={() => !working && onClose()} wide><div className="service-operation-tabs" role="tablist">{tabs.map((item) => <button key={item.key} role="tab" aria-selected={tab === item.key} className={tab === item.key ? "is-active" : ""} onClick={() => setTab(item.key)}>{item.icon}{item.label}</button>)}</div>{error ? <ErrorState message={error} onRetry={() => void loadStatus()} /> : null}{loading ? <div className="center-state"><Spinner label="正在读取 Agent 状态" /></div> : null}
    {!loading && tab === "overview" ? <div className="service-overview"><div className="service-overview-grid"><InfoTile label="连接状态" value={isConnected(server) ? "在线" : "离线"} detail={server.encrypted ? "加密 WebSocket" : server.connection_mode} icon={<Wifi size={18} />} /><InfoTile label="Agent 版本" value={version?.current || system?.agent_version || "未知"} detail={version?.latest ? `最新 ${version.latest}` : version?.latest_error || "未读取最新版本"} icon={<UploadCloud size={18} />} /><InfoTile label="主机名" value={system?.hostname || server.name} detail={system?.uptime ? `运行 ${Math.floor(Number(system.uptime) / 3600)} 小时` : relativeTime(server.last_heartbeat)} icon={<Server size={18} />} /><InfoTile label="系统负载" value={system?.loadavg?.split(" ").slice(0, 3).join(" / ") || "暂无"} detail={system?.memory?.MemAvailable ? `可用内存 ${system.memory.MemAvailable}` : "Agent 未上报内存"} icon={<Gauge size={18} />} /></div><Surface className="service-address-panel"><h3>连接与流量</h3><dl><div><dt>IPv4</dt><dd>{server.ip_address || "未上报"}</dd></div><div><dt>IPv6</dt><dd>{server.ipv6_enabled ? server.ip_address_v6 || "未上报" : "已关闭"}</dd></div><div><dt>节点域名</dt><dd>{server.domain || "未设置"}</dd></div><div><dt>Agent 端口</dt><dd>{server.listen_port || 23889}</dd></div><div><dt>统计口径</dt><dd>{server.traffic_source === "system" ? "系统网卡" : "Xray 聚合"} / {server.traffic_stats_mode || "both"}</dd></div><div><dt>本期流量</dt><dd>{formatBytes(server.traffic_used)}{server.traffic_limit ? ` / ${formatBytes(server.traffic_limit)}` : "（不限）"}</dd></div></dl></Surface><DDNSOverviewPanel status={ddnsStatus} working={working === "ddns-test"} onRetry={() => void triggerDDNS()} /><div className="dialog-actions"><Button variant="secondary" onClick={() => void loadStatus()}><RefreshCw size={16} />刷新状态</Button><Button onClick={onUpgrade} disabled={!isConnected(server)}><UploadCloud size={16} />{version?.upgrade_available ? "升级 Agent" : "重新安装 / 升级 Agent"}</Button></div></div> : null}
    {!loading && tab === "services" ? <div className="service-control-stack"><ServiceControlCard name="Xray" state={status?.xray} fallbackVersion={server.xray_version} working={working} onAction={(action) => action === "stop" ? setConfirm({ service: "xray", action }) : void serviceAction("xray", action)} onRemove={() => setConfirm({ service: "xray", action: "remove" })} /><ServiceControlCard name="Nginx" state={status?.nginx} working={working} onAction={(action) => action === "stop" ? setConfirm({ service: "nginx", action }) : void serviceAction("nginx", action)} onRemove={() => setConfirm({ service: "nginx", action: "remove" })} /></div> : null}
    {!loading && tab === "inbounds" ? <XrayResourcesWorkbench serverId={server.id} serverDomain={server.domain} kind="inbound" notify={notify} /> : null}
    {!loading && tab === "outbounds" ? <XrayResourcesWorkbench serverId={server.id} serverDomain={server.domain} kind="outbound" notify={notify} /> : null}
    {!loading && tab === "routing" ? <XrayRoutingWorkbench serverId={server.id} notify={notify} /> : null}
    {!loading && tab === "config" ? <div className="service-config-panel">{!configLoaded ? <EmptyState icon={<Code2 size={23} />} title="读取 Agent 上的 Xray 配置" description="编辑前会从目标服务器读取当前配置，不使用本地缓存。" action={<Button onClick={() => void loadConfig()} disabled={working === "config-load"}>{working === "config-load" ? <Spinner label="正在读取" /> : <><Clipboard size={16} />读取配置</>}</Button>} /> : <><div className="service-config-head"><span><strong>{configPath || "config.json"}</strong><small>{configDirty ? "存在未保存更改" : "已与 Agent 同步"}</small></span><div><Button variant="ghost" onClick={() => void loadConfig()} disabled={Boolean(working)}><RefreshCw size={15} />重新读取</Button><Button variant="secondary" onClick={() => void testConfig()} disabled={Boolean(working) || !config.trim()}>{working === "config-test" ? <Spinner label="预检中" /> : <><ShieldCheck size={15} />预检</>}</Button><Button onClick={() => void saveConfig()} disabled={Boolean(working) || !configDirty}>{working === "config-save" ? <Spinner label="保存中" /> : <><Check size={15} />保存配置</>}</Button></div></div><textarea className="service-code-editor" aria-label="Xray 配置 JSON" spellCheck={false} value={config} onChange={(event) => { setConfig(event.target.value); setConfigDirty(true); }} /></>}</div> : null}
    {!loading && tab === "sharing" ? <div className="service-sharing"><form onSubmit={createShare} className="service-share-create"><Field label="令牌备注"><input required value={shareLabel} onChange={(event) => setShareLabel(event.target.value)} placeholder="提供给分控制端 A" /></Field><Button type="submit" disabled={working === "share-create"}>{working === "share-create" ? <Spinner label="生成中" /> : <><FileKey2 size={16} />生成分享令牌</>}</Button></form>{newShareToken ? <div className="credential-warning"><KeyRound size={19} /><span><strong>仅显示一次</strong><code>{newShareToken}</code></span><IconButton label="复制新分享令牌" onClick={() => navigator.clipboard.writeText(newShareToken).then(() => notify("分享令牌已复制")).catch(() => notify("复制失败", "error"))}><Copy size={17} /></IconButton></div> : null}<div className="service-share-list">{shares.length ? shares.map((share) => <div key={share.id}><span><strong>{share.label || `令牌 #${share.id}`}</strong><small>{share.revoked_at ? `已于 ${share.revoked_at} 吊销` : `创建于 ${share.created_at}`}</small></span><Badge tone={share.revoked_at ? "neutral" : "good"}>{share.revoked_at ? "已吊销" : "有效"}</Badge>{!share.revoked_at ? <IconButton label={`吊销 ${share.label || share.id}`} onClick={() => void revokeShare(share.id)} disabled={working === `share-${share.id}`}><Trash2 size={16} /></IconButton> : null}</div>) : <EmptyState icon={<FileKey2 size={22} />} title="暂无分享令牌" description="生成后可在其他 Arcway 控制端接入这台服务器" />}</div></div> : null}
    {confirm ? <ConfirmDialog title={confirm.action === "remove" ? `卸载 ${confirm.service}` : `停止 ${confirm.service}`} description={confirm.action === "remove" ? `将从 ${server.name} 卸载 ${confirm.service}，现有配置和节点可能立即不可用。` : `停止 ${confirm.service} 会中断由该服务承载的连接。`} confirmLabel={confirm.action === "remove" ? "确认卸载" : "确认停止"} working={Boolean(working)} onCancel={() => !working && setConfirm(null)} onConfirm={() => void serviceAction(confirm.service, confirm.action)} /> : null}
  </Dialog>;
}

type XrayEditorMode = "create" | "view" | "edit";

function defaultXrayResource(kind: XrayResourceKind): XrayResource {
  if (kind === "inbound") {
    return { tag: "", listen: "0.0.0.0", port: 1080, protocol: "socks", settings: { auth: "noauth", udp: true } };
  }
  return { tag: "", protocol: "freedom", settings: {} };
}

function XrayResourcesWorkbench({ serverId, serverDomain = "", kind, notify }: { serverId: number; serverDomain?: string; kind: XrayResourceKind; notify: Notify }) {
  const plural = kind === "inbound" ? "inbounds" : "outbounds";
  const label = kind === "inbound" ? "入站" : "出站";
  const endpoint = `/api/admin/remote/${plural}?server_id=${serverId}`;
  const [items, setItems] = useState<XrayResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [editor, setEditor] = useState<{ mode: XrayEditorMode; original?: XrayResource } | null>(null);
  const [tag, setTag] = useState("");
  const [protocol, setProtocol] = useState("");
  const [listen, setListen] = useState("");
  const [port, setPort] = useState("");
  const [jsonDraft, setJsonDraft] = useState("");
  const [creationPreset, setCreationPreset] = useState<InboundCreationPreset>("advanced");
  const [secureDraft, setSecureDraft] = useState<SecureInboundDraft>(() => newSecureInboundDraft());
  const [examples, setExamples] = useState<XrayProtocolCombination[]>([]);
  const [examplesLoading, setExamplesLoading] = useState(false);
  const [examplesError, setExamplesError] = useState("");
  const [realityDomains, setRealityDomains] = useState<RealityDomainProbe[]>([]);
  const [domainsLoading, setDomainsLoading] = useState(false);
  const [domainsError, setDomainsError] = useState("");
  const [keyWorking, setKeyWorking] = useState<"reality" | "encryption" | "">("");
  const [editorError, setEditorError] = useState("");
  const [working, setWorking] = useState(false);
  const [deleting, setDeleting] = useState<XrayResource | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setListError("");
    try {
      const result = assertSuccess(await api.get<XrayResourceListResponse>(endpoint), `${label}列表加载失败`);
      setItems(result[plural] ?? []);
    } catch (reason) {
      setListError(messageFrom(reason, `${label}列表加载失败`));
    } finally {
      setLoading(false);
    }
  }, [endpoint, label, plural]);

  useEffect(() => { void load(); }, [load]);

  const loadExamples = useCallback(async () => {
    setExamplesLoading(true);
    setExamplesError("");
    try {
      const result = assertSuccess(await api.get<XrayExamplesResponse>("/api/admin/xray-examples"), "读取 Xray 协议模板失败");
      setExamples(result.combinations ?? []);
    } catch (reason) {
      setExamplesError(messageFrom(reason, "协议模板暂不可用"));
    } finally {
      setExamplesLoading(false);
    }
  }, []);

  const loadRealityDomains = useCallback(async () => {
    setDomainsLoading(true);
    setDomainsError("");
    try {
      const result = assertSuccess(await api.get<RealityDomainsResponse>(`/api/admin/remote/reality-domains?server_id=${serverId}`), "探测 Reality 域名失败");
      const candidates = result.domains ?? [];
      setRealityDomains(candidates);
    } catch (reason) {
      setDomainsError(messageFrom(reason, "域名探测暂不可用，可手动填写"));
    } finally {
      setDomainsLoading(false);
    }
  }, [serverId]);

  const generateRealityKeys = useCallback(async () => {
    setKeyWorking("reality");
    setEditorError("");
    try {
      const result = assertSuccess(await api.post<X25519Response>("/api/admin/xray/generate-x25519"), "生成 Reality 密钥失败");
      if (!result.privateKey || !result.publicKey) throw new Error("服务端未返回完整的 X25519 密钥对");
      setSecureDraft((current) => ({ ...current, privateKey: result.privateKey ?? "", publicKey: result.publicKey ?? "" }));
    } catch (reason) {
      setEditorError(messageFrom(reason, "生成 Reality 密钥失败"));
    } finally {
      setKeyWorking("");
    }
  }, []);

  const generateVlessEncryption = useCallback(async () => {
    setKeyWorking("encryption");
    setEditorError("");
    try {
      const result = assertSuccess(await api.post<VlessEncryptionResponse>("/api/admin/xray/generate-keys", {
        type: "mlkem768x25519plus",
        encryptionType: "x25519",
        appearance: "native",
        ticketLifetime: "600s",
        padding: "0rtt",
      }), "生成 VLESS 增强加密密钥失败");
      if (!result.decryptionConfig || !result.encryption) throw new Error("服务端未返回完整的 VLESS 增强加密参数");
      setSecureDraft((current) => ({ ...current, decryptionConfig: result.decryptionConfig ?? "", encryption: result.encryption ?? "" }));
    } catch (reason) {
      setEditorError(messageFrom(reason, "生成 VLESS 增强加密密钥失败"));
    } finally {
      setKeyWorking("");
    }
  }, []);

  const openEditor = (mode: XrayEditorMode, resource?: XrayResource) => {
    const value = cleanXrayResource(resource ?? defaultXrayResource(kind));
    setEditor({ mode, original: resource });
    const secureCreate = kind === "inbound" && mode === "create";
    setCreationPreset(secureCreate ? "reality" : "advanced");
    setSecureDraft(newSecureInboundDraft());
    setTag(secureCreate ? "vless-reality" : xrayResourceTag(value));
    setProtocol(secureCreate ? "vless" : xrayResourceProtocol(value));
    setListen(secureCreate ? "0.0.0.0" : typeof value.listen === "string" ? value.listen : "");
    setPort(secureCreate ? "443" : typeof value.port === "number" || typeof value.port === "string" ? String(value.port) : "");
    setJsonDraft(JSON.stringify(value, null, 2));
    setEditorError("");
    setExamplesError("");
    setDomainsError("");
    if (secureCreate) {
      void loadExamples();
      void loadRealityDomains();
      void generateRealityKeys();
    }
  };

  const selectCreationPreset = (preset: InboundCreationPreset) => {
    setCreationPreset(preset);
    setEditorError("");
    if (preset === "advanced") {
      const value = defaultXrayResource("inbound");
      setTag(xrayResourceTag(value));
      setProtocol(xrayResourceProtocol(value));
      setListen(String(value.listen ?? ""));
      setPort(String(value.port ?? ""));
      setJsonDraft(JSON.stringify(value, null, 2));
      return;
    }
    setTag((current) => !current || current === "vless-reality" || current === "vless-wss" || current === "" ? `vless-${preset}` : current);
    setProtocol("vless");
    setListen(preset === "reality" ? "0.0.0.0" : "127.0.0.1");
    setPort("443");
    if (preset === "wss") setSecureDraft((current) => ({ ...current, domain: serverDomain.trim().toLowerCase() }));
    if (preset === "reality") {
      if (creationPreset !== "reality") setSecureDraft((current) => ({ ...current, domain: "" }));
      void loadRealityDomains();
      if (!secureDraft.privateKey || !secureDraft.publicKey) void generateRealityKeys();
    }
  };

  const closeEditor = () => {
    if (working) return;
    setEditor(null);
    setEditorError("");
  };

  const matchingExample = useMemo(() => {
    if (creationPreset === "advanced") return undefined;
    return examples.find((item) => {
      const signature = `${item.dir_name} ${item.transport} ${item.security}`.toLowerCase();
      if (!item.has_config || item.protocol.toLowerCase() !== "vless") return false;
      return creationPreset === "reality"
        ? signature.includes("reality")
        : (signature.includes("ws") || signature.includes("websocket")) && (signature.includes("tls") || signature.includes("nginx") || signature.includes("caddy"));
    });
  }, [creationPreset, examples]);

  const securePreview = useMemo(() => {
    if (kind !== "inbound" || editor?.mode !== "create" || creationPreset === "advanced") return "";
    try {
      return JSON.stringify(buildSecureInbound(creationPreset, { tag, port }, secureDraft), null, 2);
    } catch {
      return "";
    }
  }, [creationPreset, editor?.mode, kind, port, secureDraft, tag]);

  const parseDraft = (): XrayResource => {
    if (kind === "inbound" && editor?.mode === "create" && creationPreset !== "advanced") {
      return buildSecureInbound(creationPreset, { tag, port }, secureDraft);
    }
    const parsed = JSON.parse(jsonDraft) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label}配置必须是 JSON 对象`);
    const resource = cleanXrayResource(parsed as XrayResource);
    const normalizedTag = tag.trim();
    const normalizedProtocol = protocol.trim();
    if (!normalizedTag) throw new Error("Tag 不能为空");
    if (!normalizedProtocol) throw new Error("协议不能为空");
    resource.tag = normalizedTag;
    resource.protocol = normalizedProtocol;
    if (kind === "inbound") {
      const parsedPort = Number(port);
      if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) throw new Error("监听端口必须在 1 到 65535 之间");
      resource.port = parsedPort;
      if (listen.trim()) resource.listen = listen.trim();
      else delete resource.listen;
    }
    return resource;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editor || editor.mode === "view") return;
    setEditorError("");
    let resource: XrayResource;
    try {
      resource = parseDraft();
      if (editor.mode === "create" && items.some((item) => xrayResourceTag(item) === xrayResourceTag(resource))) {
        throw new Error(`Tag “${xrayResourceTag(resource)}” 已存在，请使用唯一 Tag`);
      }
    } catch (reason) {
      setEditorError(messageFrom(reason, `${label}配置格式错误`));
      return;
    }

    setWorking(true);
    try {
      if (editor.mode === "edit" && editor.original) {
        const original = cleanXrayResource(editor.original);
        const originalTag = xrayResourceTag(original);
        if (!originalTag) throw new Error("该配置没有可操作的原始 Tag");
        assertSuccess(await api.post<ActionResponse>(endpoint, { action: "remove", tag: originalTag }), `删除旧${label}失败`);
        try {
          assertSuccess(await api.post<ActionResponse>(endpoint, { action: "add", [kind]: resource }), `添加新${label}失败`);
        } catch (reason) {
          try {
            assertSuccess(await api.post<ActionResponse>(endpoint, { action: "add", [kind]: original }), `回滚旧${label}失败`);
            throw new Error(`${messageFrom(reason, `添加新${label}失败`)}；旧配置已自动恢复`);
          } catch (rollbackReason) {
            if (rollbackReason instanceof Error && rollbackReason.message.endsWith("旧配置已自动恢复")) throw rollbackReason;
            throw new Error(`${messageFrom(reason, `添加新${label}失败`)}；自动恢复旧配置也失败：${messageFrom(rollbackReason, "未知错误")}`);
          }
        }
      } else {
        assertSuccess(await api.post<ActionResponse>(endpoint, { action: "add", [kind]: resource }), `创建${label}失败`);
      }
      notify(editor.mode === "edit" ? `${label}已更新` : `${label}已创建`);
      setEditor(null);
      await load();
    } catch (reason) {
      setEditorError(messageFrom(reason, `${label}保存失败`));
    } finally {
      setWorking(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    const deletingTag = xrayResourceTag(deleting);
    setWorking(true);
    setEditorError("");
    try {
      assertSuccess(await api.post<ActionResponse>(endpoint, { action: "remove", tag: deletingTag }), `删除${label}失败`);
      notify(`${label} ${deletingTag} 已删除`);
      setDeleting(null);
      if (editor?.original === deleting) setEditor(null);
      await load();
    } catch (reason) {
      setDeleting(null);
      setListError(messageFrom(reason, `删除${label}失败`));
    } finally {
      setWorking(false);
    }
  };

  const protocols = kind === "inbound"
    ? ["vless", "vmess", "trojan", "shadowsocks", "socks", "http", "dokodemo-door", "wireguard", "hysteria2", "anytls", "snell"]
    : ["freedom", "blackhole", "vless", "vmess", "trojan", "shadowsocks", "socks", "http", "wireguard", "dns"];

  return <div className="xray-resource-workbench">
    <div className="xray-resource-head">
      <span><strong>{label}管理</strong><small>目标服务器 #{serverId} · {items.length} 项</small></span>
      <div><Button variant="ghost" onClick={() => void load()} disabled={loading || working}><RefreshCw size={15} />刷新</Button><Button onClick={() => openEditor("create")} disabled={working}><Plus size={16} />添加{label}</Button></div>
    </div>
    {listError ? <ErrorState message={listError} onRetry={() => void load()} /> : null}
    {loading ? <div className="center-state"><Spinner label={`正在加载${label}`} /></div> : items.length === 0 ? <EmptyState icon={kind === "inbound" ? <ArrowDownToLine size={23} /> : <ArrowUpFromLine size={23} />} title={`暂无${label}`} description={`此列表直接读取服务器 #${serverId} 当前 Xray 配置`} action={<Button onClick={() => openEditor("create")}><Plus size={16} />添加{label}</Button>} /> : <div className="xray-resource-list" role="list" aria-label={`${label}列表`}>
      {items.map((item, index) => {
        const itemTag = xrayResourceTag(item);
        const generated = item._generated_tag === true;
        const runtime = item._runtime_status === "running";
        return <Surface className="xray-resource-row" key={`${itemTag}-${index}`}><span className="xray-resource-icon">{kind === "inbound" ? <ArrowDownToLine size={17} /> : <ArrowUpFromLine size={17} />}</span><span className="xray-resource-main"><strong>{itemTag || `未命名${label}`}</strong><small>{xrayResourceProtocol(item) || "未知协议"}{kind === "inbound" && item.port ? ` · ${String(item.listen || "0.0.0.0")}:${String(item.port)}` : ""}</small></span>{kind === "inbound" ? <Badge tone={runtime ? "good" : "warn"}>{runtime ? "运行中" : item._source === "runtime_only" ? "仅运行时" : "未运行"}</Badge> : null}<div className="xray-resource-actions"><Button variant="ghost" onClick={() => openEditor("view", item)}><Eye size={15} />查看</Button><IconButton label={`编辑${label} ${itemTag || index + 1}`} onClick={() => openEditor("edit", item)} disabled={!itemTag || generated || working}><Pencil size={15} /></IconButton><IconButton label={`删除${label} ${itemTag || index + 1}`} onClick={() => setDeleting(item)} disabled={!itemTag || generated || working}><Trash2 size={15} /></IconButton></div></Surface>;
      })}
    </div>}
    {editor ? <Surface className="xray-resource-editor">
      <div className="xray-resource-editor-head"><span><strong>{editor.mode === "create" ? `添加${label}` : editor.mode === "edit" ? `编辑${label}` : `${label}详情`}</strong><small>{editor.mode === "edit" ? "后端不支持原位更新；保存时会安全重建，失败自动回滚" : editor.mode === "view" ? "只读查看服务器返回的完整配置" : kind === "inbound" && creationPreset !== "advanced" ? "安全向导生成完整的 Xray 入站配置" : "基础字段会覆盖高级 JSON 中的同名字段"}</small></span><Button type="button" variant="ghost" onClick={closeEditor} disabled={working}>关闭</Button></div>
      {kind === "inbound" && editor.mode === "create" ? <div className="secure-inbound-presets" role="tablist" aria-label="入站创建方式">
        <button type="button" role="tab" aria-selected={creationPreset === "reality"} className={creationPreset === "reality" ? "is-active" : ""} onClick={() => selectCreationPreset("reality")}><ShieldCheck size={16} /><span><strong>VLESS + Reality</strong><small>Vision · X25519</small></span></button>
        <button type="button" role="tab" aria-selected={creationPreset === "wss"} className={creationPreset === "wss" ? "is-active" : ""} onClick={() => selectCreationPreset("wss")}><Cloud size={16} /><span><strong>VLESS + WS + TLS</strong><small>Nginx · 443</small></span></button>
        <button type="button" role="tab" aria-selected={creationPreset === "advanced"} className={creationPreset === "advanced" ? "is-active" : ""} onClick={() => selectCreationPreset("advanced")}><Code2 size={16} /><span><strong>高级 JSON</strong><small>全部协议</small></span></button>
      </div> : null}
      {editorError ? <ErrorState message={editorError} /> : null}
      {editor.mode === "view" ? <textarea className="service-code-editor xray-resource-json" aria-label={`${label}只读 JSON`} readOnly value={jsonDraft} /> : <form className="form-stack" onSubmit={submit}>
        {kind === "inbound" && editor.mode === "create" && creationPreset !== "advanced" ? <>
          <div className="secure-inbound-reference"><span><Badge tone={matchingExample ? "good" : examplesError ? "warn" : "neutral"}>{examplesLoading ? "模板读取中" : matchingExample ? "官方模板" : "内置模板"}</Badge><strong>{matchingExample?.dir_name || (creationPreset === "reality" ? "VLESS TCP Reality" : "VLESS WSS")}</strong></span>{examplesError ? <small>{examplesError}</small> : null}</div>
          <div className="form-grid two"><Field label="Tag"><input required aria-label="入站 Tag" value={tag} onChange={(event) => setTag(event.target.value)} placeholder={creationPreset === "reality" ? "vless-reality" : "vless-wss"} /></Field><Field label={creationPreset === "wss" ? "外部 TLS 端口" : "监听端口"} hint={creationPreset === "wss" ? "Nginx 对外使用 443，Agent 会自动分配内部端口" : undefined}><input type="number" min="1" max="65535" required aria-label="入站监听端口" value={port} onChange={(event) => setPort(event.target.value)} /></Field></div>
          <div className="form-grid two"><Field label="客户端 UUID"><div className="secure-field-action"><input required aria-label="客户端 UUID" value={secureDraft.uuid} onChange={(event) => setSecureDraft({ ...secureDraft, uuid: event.target.value.trim() })} /><IconButton type="button" label="重新生成客户端 UUID" onClick={() => setSecureDraft({ ...secureDraft, uuid: createUUID() })}><RefreshCw size={15} /></IconButton></div></Field><Field label={creationPreset === "reality" ? "Reality 伪装目标 / SNI" : "TLS 节点域名"} hint={creationPreset === "reality" ? "必须明确选择目标；优先使用同 ASN 且证书覆盖该 SNI 的 TLS 站点" : creationPreset === "wss" && !serverDomain ? "请先在服务器编辑页配置节点域名" : undefined}><div className="secure-field-action"><input required aria-label={creationPreset === "reality" ? "Reality 伪装目标 / SNI" : "TLS 节点域名"} list={creationPreset === "reality" ? `reality-domains-${serverId}` : undefined} readOnly={creationPreset === "wss"} value={secureDraft.domain} onChange={(event) => setSecureDraft({ ...secureDraft, domain: event.target.value.trim().toLowerCase() })} placeholder="www.example.com" />{creationPreset === "reality" ? <IconButton type="button" label="重新探测 Reality 域名" disabled={domainsLoading} onClick={() => void loadRealityDomains()}>{domainsLoading ? <Spinner /> : <RefreshCw size={15} />}</IconButton> : null}</div></Field></div>
          {creationPreset === "reality" ? <>
            <datalist id={`reality-domains-${serverId}`}>{realityDomains.map((item) => <option key={item.domain} value={item.domain}>{item.success ? `443 可达 · ${item.latency_ms ?? "-"} ms` : item.error || "探测失败"}</option>)}</datalist>
            {domainsError ? <small className="secure-inline-error">{domainsError}</small> : null}
            <div className="form-grid two"><Field label="Reality Short ID" hint="2-16 位偶数长度十六进制"><input required aria-label="Reality Short ID" value={secureDraft.shortId} onChange={(event) => setSecureDraft({ ...secureDraft, shortId: event.target.value.trim().toLowerCase() })} /></Field><Field label="X25519 密钥对"><div className="secure-key-status"><Badge tone={validRealityKey(secureDraft.privateKey) && validRealityKey(secureDraft.publicKey) ? "good" : "warn"}>{validRealityKey(secureDraft.privateKey) && validRealityKey(secureDraft.publicKey) ? "已生成" : "未就绪"}</Badge><Button type="button" variant="secondary" disabled={keyWorking !== ""} onClick={() => void generateRealityKeys()}>{keyWorking === "reality" ? <Spinner label="生成中" /> : <><KeyRound size={15} />重新生成</>}</Button></div></Field></div>
            <div className="secure-encryption-row"><Toggle checked={secureDraft.enhancedEncryption} disabled={keyWorking !== ""} label="VLESS 后量子增强加密" onChange={(checked) => { setSecureDraft((current) => ({ ...current, enhancedEncryption: checked })); if (checked && (!secureDraft.decryptionConfig || !secureDraft.encryption)) void generateVlessEncryption(); }} />{secureDraft.enhancedEncryption ? <span><Badge tone={secureDraft.decryptionConfig && secureDraft.encryption ? "good" : "warn"}>{secureDraft.decryptionConfig && secureDraft.encryption ? "增强密钥已生成" : "增强密钥未就绪"}</Badge><Button type="button" variant="ghost" disabled={keyWorking !== ""} onClick={() => void generateVlessEncryption()}>{keyWorking === "encryption" ? <Spinner label="生成中" /> : <><RefreshCw size={14} />重生成</>}</Button></span> : null}</div>
          </> : <Field label="WebSocket 路径" hint="必须以 / 开头；Agent 保存时会安全随机化最终路径"><input required aria-label="WebSocket 路径" value={secureDraft.path} onChange={(event) => setSecureDraft({ ...secureDraft, path: event.target.value })} placeholder="/ws/path" /></Field>}
          <details className="secure-inbound-preview"><summary>查看生成的 Xray JSON</summary>{securePreview ? <textarea className="service-code-editor xray-resource-json" aria-label="生成的入站 JSON" readOnly value={securePreview} /> : <small>字段与密钥完整后显示最终配置</small>}</details>
        </> : <>
          <div className="form-grid two"><Field label="Tag"><input required aria-label={`${label} Tag`} value={tag} onChange={(event) => setTag(event.target.value)} placeholder={kind === "inbound" ? "vless-in" : "proxy-out"} /></Field><Field label="协议"><select aria-label={`${label}协议`} value={protocol} onChange={(event) => setProtocol(event.target.value)}>{protocol && !protocols.includes(protocol) ? <option value={protocol}>{protocol}</option> : null}{protocols.map((value) => <option key={value} value={value}>{value}</option>)}</select></Field></div>
          {kind === "inbound" ? <div className="form-grid two"><Field label="监听地址"><input aria-label="入站监听地址" value={listen} onChange={(event) => setListen(event.target.value)} placeholder="0.0.0.0" /></Field><Field label="监听端口"><input type="number" min="1" max="65535" required aria-label="入站监听端口" value={port} onChange={(event) => setPort(event.target.value)} /></Field></div> : null}
          <Field label="高级 JSON" hint="可配置 settings、streamSettings、sniffing、mux 等完整 Xray 字段；必须是单个对象。"><textarea className="service-code-editor xray-resource-json" aria-label={`${label}高级 JSON`} spellCheck={false} value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} /></Field>
        </>}
        <div className="dialog-actions"><Button type="button" variant="secondary" onClick={closeEditor} disabled={working}>取消</Button><Button type="submit" disabled={working || (creationPreset === "reality" && keyWorking !== "")}>{working ? <Spinner label="正在保存" /> : <><Check size={16} />{editor.mode === "edit" ? "保存并重建" : `创建${label}`}</>}</Button></div>
      </form>}
    </Surface> : null}
    {deleting ? <ConfirmDialog title={`删除${label}`} description={`将从服务器 #${serverId} 的 Xray 运行时和配置文件中删除“${xrayResourceTag(deleting)}”。`} confirmLabel="确认删除" working={working} onCancel={() => !working && setDeleting(null)} onConfirm={() => void remove()} /> : null}
  </div>;
}

const routingMatchFields: Array<{ key: string; label: string }> = [
  { key: "domain", label: "域名" },
  { key: "ip", label: "IP" },
  { key: "port", label: "端口" },
  { key: "network", label: "网络" },
  { key: "inboundTag", label: "入站" },
  { key: "user", label: "用户" },
  { key: "protocol", label: "协议" },
  { key: "outboundTag", label: "出站" },
  { key: "balancerTag", label: "负载均衡" },
];

function XrayRoutingWorkbench({ serverId, notify }: { serverId: number; notify: Notify }) {
  const endpoint = `/api/admin/remote/routing?server_id=${serverId}`;
  const [rules, setRules] = useState<XrayRoutingRule[]>([]);
  const [domainStrategy, setDomainStrategy] = useState("");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [domain, setDomain] = useState("");
  const [ip, setIP] = useState("");
  const [port, setPort] = useState("");
  const [network, setNetwork] = useState("");
  const [inboundTag, setInboundTag] = useState("");
  const [user, setUser] = useState("");
  const [protocol, setProtocol] = useState("");
  const [outboundTag, setOutboundTag] = useState("");
  const [balancerTag, setBalancerTag] = useState("");
  const [jsonDraft, setJsonDraft] = useState("{\n  \"type\": \"field\"\n}");
  const [editorError, setEditorError] = useState("");
  const [working, setWorking] = useState(false);
  const [deleting, setDeleting] = useState<{ index: number; rule: XrayRoutingRule } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setListError("");
    try {
      const result = assertSuccess(await api.get<XrayRoutingResponse>(endpoint), "路由规则加载失败");
      setRules(Array.isArray(result.routing?.rules) ? result.routing.rules : []);
      setDomainStrategy(typeof result.routing?.domainStrategy === "string" ? result.routing.domainStrategy : "");
    } catch (reason) {
      setListError(messageFrom(reason, "路由规则加载失败"));
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => { void load(); }, [load]);

  const resetEditor = () => {
    setDomain("");
    setIP("");
    setPort("");
    setNetwork("");
    setInboundTag("");
    setUser("");
    setProtocol("");
    setOutboundTag("");
    setBalancerTag("");
    setJsonDraft("{\n  \"type\": \"field\"\n}");
    setEditorError("");
  };

  const openEditor = () => {
    resetEditor();
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (working) return;
    setEditorOpen(false);
    setEditorError("");
  };

  const buildRule = (): XrayRoutingRule => {
    const parsed = JSON.parse(jsonDraft) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("路由规则高级配置必须是 JSON 对象");
    const rule = cleanXrayResource(parsed as XrayRoutingRule);
    rule.type = "field";

    const listFields: Array<[string, string]> = [
      ["domain", domain],
      ["ip", ip],
      ["inboundTag", inboundTag],
      ["user", user],
      ["protocol", protocol],
    ];
    for (const [key, value] of listFields) {
      const normalized = parseRoutingValues(value);
      if (normalized.length) rule[key] = normalized;
      else delete rule[key];
    }

    if (port.trim()) rule.port = port.trim();
    else delete rule.port;
    if (network.trim()) rule.network = network.trim();
    else delete rule.network;

    const normalizedOutbound = outboundTag.trim();
    const normalizedBalancer = balancerTag.trim();
    if (!normalizedOutbound && !normalizedBalancer) throw new Error("出站 Tag 与负载均衡 Tag 至少填写一项");
    if (normalizedOutbound) {
      rule.outboundTag = normalizedOutbound;
      delete rule.balancerTag;
    } else {
      rule.balancerTag = normalizedBalancer;
      delete rule.outboundTag;
    }
    return rule;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setEditorError("");
    let rule: XrayRoutingRule;
    try {
      rule = buildRule();
    } catch (reason) {
      setEditorError(messageFrom(reason, "路由规则格式错误"));
      return;
    }

    setWorking(true);
    try {
      assertSuccess(await api.post<ActionResponse>(endpoint, { action: "add_rule", rule }), "创建路由规则失败");
      notify("路由规则已创建");
      setEditorOpen(false);
      await load();
    } catch (reason) {
      setEditorError(messageFrom(reason, "创建路由规则失败"));
    } finally {
      setWorking(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setWorking(true);
    setListError("");
    try {
      assertSuccess(await api.post<ActionResponse>(endpoint, { action: "remove_rule", index: deleting.index }), "删除路由规则失败");
      notify(`路由规则 #${deleting.index + 1} 已删除`);
      setDeleting(null);
      await load();
    } catch (reason) {
      setDeleting(null);
      setListError(messageFrom(reason, "删除路由规则失败"));
    } finally {
      setWorking(false);
    }
  };

  return <div className="xray-resource-workbench xray-routing-workbench">
    <div className="xray-resource-head">
      <span><strong>路由规则管理</strong><small>目标服务器 #{serverId} · {rules.length} 条{domainStrategy ? ` · ${domainStrategy}` : ""}</small></span>
      <div><Button variant="ghost" onClick={() => void load()} disabled={loading || working}><RefreshCw size={15} />刷新</Button><Button onClick={openEditor} disabled={working}><Plus size={16} />添加规则</Button></div>
    </div>
    {listError ? <ErrorState message={listError} onRetry={() => void load()} /> : null}
    {loading ? <div className="center-state"><Spinner label="正在加载路由规则" /></div> : rules.length === 0 ? <EmptyState icon={<Network size={23} />} title="暂无路由规则" description={`此列表直接读取服务器 #${serverId} 当前 Xray 配置`} action={<Button onClick={openEditor}><Plus size={16} />添加规则</Button>} /> : <div className="routing-rule-list" role="list" aria-label="路由规则列表">
      {rules.map((rule, index) => {
        const target = typeof rule.outboundTag === "string" ? rule.outboundTag : typeof rule.balancerTag === "string" ? rule.balancerTag : "未指定目标";
        const usesBalancer = typeof rule.balancerTag === "string" && !rule.outboundTag;
        return <Surface className="routing-rule-row" key={`${target}-${index}`}>
          <div className="routing-rule-head"><span><strong>规则 #{index + 1}</strong><small>{usesBalancer ? "负载均衡" : "出站"} · {target}</small></span><div><Badge tone={rule.type === "field" ? "good" : "neutral"}>{typeof rule.type === "string" ? rule.type : "field"}</Badge><IconButton label={`删除路由规则 ${index + 1}`} onClick={() => setDeleting({ index, rule })} disabled={working}><Trash2 size={15} /></IconButton></div></div>
          <dl className="routing-rule-fields">{routingMatchFields.map(({ key, label }) => {
            const values = routingRuleValues(rule, key);
            return <div key={key} className={values.length ? "" : "is-empty"}><dt>{label}</dt><dd>{values.length ? values.join(" · ") : "不限"}</dd></div>;
          })}</dl>
          <details className="routing-rule-json"><summary>查看完整 JSON</summary><pre>{JSON.stringify(rule, null, 2)}</pre></details>
        </Surface>;
      })}
    </div>}
    {editorOpen ? <Surface className="xray-resource-editor routing-rule-editor">
      <div className="xray-resource-editor-head"><span><strong>添加路由规则</strong><small>填写匹配条件和唯一目标；基础字段会覆盖高级 JSON 中的同名字段</small></span><Button type="button" variant="ghost" onClick={closeEditor} disabled={working}>关闭</Button></div>
      {editorError ? <ErrorState message={editorError} /> : null}
      <form className="form-stack" onSubmit={submit}>
        <div className="form-grid two"><Field label="出站 Tag"><input aria-label="路由出站 Tag" value={outboundTag} onChange={(event) => { setOutboundTag(event.target.value); if (event.target.value.trim()) setBalancerTag(""); }} placeholder="proxy-out" /></Field><Field label="负载均衡 Tag"><input aria-label="路由负载均衡 Tag" value={balancerTag} onChange={(event) => { setBalancerTag(event.target.value); if (event.target.value.trim()) setOutboundTag(""); }} placeholder="任选其一" /></Field></div>
        <div className="form-grid two"><Field label="域名" hint="逗号或换行分隔"><textarea aria-label="路由域名" rows={3} value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="domain:example.com&#10;geosite:google" /></Field><Field label="IP" hint="逗号或换行分隔"><textarea aria-label="路由 IP" rows={3} value={ip} onChange={(event) => setIP(event.target.value)} placeholder="geoip:private&#10;10.0.0.0/8" /></Field></div>
        <div className="form-grid two"><Field label="端口"><input aria-label="路由端口" value={port} onChange={(event) => setPort(event.target.value)} placeholder="80,443,1000-2000" /></Field><Field label="网络"><input aria-label="路由网络" value={network} onChange={(event) => setNetwork(event.target.value)} placeholder="tcp,udp" /></Field></div>
        <div className="form-grid two"><Field label="入站 Tag" hint="逗号或换行分隔"><input aria-label="路由入站 Tag" value={inboundTag} onChange={(event) => setInboundTag(event.target.value)} placeholder="vless-in" /></Field><Field label="用户" hint="逗号或换行分隔"><input aria-label="路由用户" value={user} onChange={(event) => setUser(event.target.value)} placeholder="user@example.com" /></Field></div>
        <Field label="协议" hint="逗号或换行分隔"><input aria-label="路由协议" value={protocol} onChange={(event) => setProtocol(event.target.value)} placeholder="bittorrent" /></Field>
        <Field label="高级 JSON" hint="可配置 attrs、source、sourcePort、marktag 等完整 Xray 路由字段；必须是单个对象。"><textarea className="service-code-editor xray-resource-json" aria-label="路由规则高级 JSON" spellCheck={false} value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} /></Field>
        <div className="dialog-actions"><Button type="button" variant="secondary" onClick={closeEditor} disabled={working}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在保存" /> : <><Check size={16} />创建规则</>}</Button></div>
      </form>
    </Surface> : null}
    {deleting ? <ConfirmDialog title="删除路由规则" description={`将从服务器 #${serverId} 删除规则 #${deleting.index + 1}（${String(deleting.rule.outboundTag || deleting.rule.balancerTag || "未指定目标")}）。`} confirmLabel="确认删除" working={working} onCancel={() => !working && setDeleting(null)} onConfirm={() => void remove()} /> : null}
  </div>;
}

function InfoTile({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: ReactNode }) {
  return <Surface className="service-info-tile"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></Surface>;
}

function ServiceControlCard({ name, state, fallbackVersion, working, onAction, onRemove }: { name: "Xray" | "Nginx"; state?: ServiceState; fallbackVersion?: string; working: string; onAction: (action: "start" | "stop" | "restart" | "install") => void; onRemove: () => void }) {
  const key = name.toLowerCase();
  const installed = state?.installed ?? (name === "Xray" && Boolean(fallbackVersion));
  const running = state?.running ?? false;
  return <Surface className="service-control-card"><div className="service-control-icon">{name === "Xray" ? <Network size={21} /> : <Server size={21} />}</div><div className="service-control-main"><div><h3>{name}</h3><Badge tone={running ? "good" : installed ? "warn" : "neutral"}>{running ? "运行中" : installed ? "已停止" : "未安装"}</Badge></div><p>{state?.version || fallbackVersion || "未检测到版本信息"}</p></div><div className="service-control-actions">{!installed ? <Button onClick={() => onAction("install")} disabled={Boolean(working)}>{working === `${key}-install` ? <Spinner label="安装中" /> : <><Plus size={15} />安装</>}</Button> : <><IconButton label={`启动 ${name}`} onClick={() => onAction("start")} disabled={Boolean(working) || running}><Play size={16} /></IconButton><IconButton label={`重启 ${name}`} onClick={() => onAction("restart")} disabled={Boolean(working)}><RotateCw size={16} /></IconButton><IconButton label={`停止 ${name}`} onClick={() => onAction("stop")} disabled={Boolean(working) || !running}><Square size={15} /></IconButton><IconButton label={`卸载 ${name}`} onClick={onRemove} disabled={Boolean(working)}><Trash2 size={16} /></IconButton></>}</div></Surface>;
}
