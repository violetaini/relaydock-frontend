import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  CirclePause,
  CirclePlay,
  Copy,
  Gauge,
  Network,
  Plus,
  RefreshCw,
  Route,
  Server,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X,
  Zap,
} from "lucide-react";
import { forwardingBillingModeLabel, normalizeForwardingBillingMode } from "./forwarding-billing";
import type { ForwardingBillingMode } from "./types";
import { api } from "./api";
import type { NodeItem, RemoteServer, ServerListResponse, UserItem } from "./types";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Spinner,
  Surface,
  formatBytes,
} from "./ui";
import "./forwarding-management.css";

type Notify = (message: string, tone?: "success" | "error") => void;
type AdminTab = "templates" | "grants" | "forwards";
type UserTab = "forwards" | "grants";
type ResourceID = string | number;
type AdminLoadSection = "general" | "templates" | "servers" | "users" | "forwards" | "grants";

// The current Agent cannot enforce limits on raw tunnel inbounds yet.
const INBOUND_LIMITER_V1 = false;

export interface TunnelHop {
  id?: ResourceID;
  position?: number;
  server_id: number;
  server_name?: string;
  name?: string;
  status?: string;
}

export interface TunnelTemplate {
  id: ResourceID;
  public_id?: string;
  name: string;
  description?: string;
  state: string;
  network?: string;
  billing_mode?: ForwardingBillingMode;
  traffic_multiplier_milli?: number;
  max_total_forwards?: number;
  active_forwards?: number;
  grant_count?: number;
  port_range_start?: number;
  port_range_end?: number;
  version?: number;
  hops?: TunnelHop[];
  server_ids?: number[];
  route?: Array<TunnelHop | string>;
  created_at?: string;
  updated_at?: string;
}

export function UserForwardingGrantsPanel({ username, notify }: { username: string; notify: Notify }) {
  const [templates, setTemplates] = useState<TunnelTemplate[]>([]);
  const [grants, setGrants] = useState<TunnelGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<TunnelGrant | undefined>();
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [templatePayload, grantPayload] = await Promise.all([
        api.get<unknown>("/api/admin/tunnel-templates"),
        api.get<unknown>(`/api/admin/users/${encodeURIComponent(username)}/tunnel-grants`),
      ]);
      setTemplates(extractList<TunnelTemplate>(templatePayload, "tunnels", "templates"));
      setGrants(extractList<TunnelGrant>(grantPayload, "grants", "tunnel_grants"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "转发授权加载失败");
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => { void load(); }, [load]);

  return <div className="fm-panel">
    <div className="fm-toolbar"><div><strong>个性化转发授权</strong><span>不依赖套餐，可按账号单独授予线路和额度。</span></div><Button onClick={() => setCreating(true)}><Plus size={16} />新增授权</Button></div>
    {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
    {loading ? <div className="fm-center"><Spinner label="正在加载转发授权" /></div> : <GrantPanel grants={grants} templates={templates} onCreate={() => setCreating(true)} onEdit={setEditing} onAction={async (grant, action) => {
      await api.post(`/api/admin/users/${encodeURIComponent(username)}/tunnel-grants/${encodeURIComponent(resourceID(grant))}/${action}`, {}, { idempotencyKey: idempotencyKey() });
      notify(action === "suspend" ? "转发授权已暂停" : "转发授权已恢复");
      await load();
    }} onDelete={async (grant) => {
      await api.delete(`/api/admin/users/${encodeURIComponent(username)}/tunnel-grants/${encodeURIComponent(resourceID(grant))}`, undefined, { idempotencyKey: idempotencyKey() });
      notify("转发授权已撤销");
      await load();
    }} />}
    {creating || editing ? <GrantDialog grant={editing} users={[{ username } as UserItem]} templates={templates} onClose={() => { setCreating(false); setEditing(undefined); }} onComplete={async () => { setCreating(false); setEditing(undefined); notify(editing ? "转发授权已更新" : "转发授权已创建"); await load(); }} /> : null}
  </div>;
}

export interface TunnelGrant {
  id: ResourceID;
  public_id?: string;
  username: string;
  tunnel_id?: ResourceID;
  name?: string;
  description?: string;
  route?: Array<TunnelHop | string>;
  tunnel_name?: string;
  tunnel?: TunnelTemplate;
  enabled?: boolean;
  state?: string;
  effective_state?: string;
  starts_at?: string;
  expires_at?: string | null;
  max_active_forwards: number;
  active_forwards?: number;
  active_forward_count?: number;
  per_forward_speed_mbps?: number;
  per_forward_connection_limit?: number;
  traffic_limit_bytes?: number;
  traffic_used_bytes?: number;
  used_bytes?: number;
  billing_mode_override?: ForwardingBillingMode | null;
  reset_policy?: string;
  reset_day?: number;
  version?: number;
  source_type?: "manual" | "package";
  source_package_id?: number;
}

interface ForwardEndpoint {
  host?: string;
  address?: string;
  port?: number;
}

interface ForwardHop {
  position?: number;
  server_id?: number;
  server_name?: string;
}

export interface ForwardRule {
  id: ResourceID;
  public_id?: string;
  username?: string;
  name: string;
  grant_id: ResourceID;
  tunnel_id?: ResourceID;
  tunnel_name?: string;
  tunnel?: TunnelTemplate;
  target_type?: string;
  target_node_id?: number;
  target_node_name?: string;
  target_name?: string;
  target_host?: string;
  target_port?: number;
  network?: string;
  allocated_entry_port?: number;
  entry_port?: number;
  requested_entry_port?: number;
  entry_host?: string;
  entry_address?: string;
  entry?: ForwardEndpoint;
  route?: string[];
  hops?: ForwardHop[];
  desired_state?: string;
  observed_state?: string;
  state?: string;
  suspend_reason?: string;
  traffic_used_bytes?: number;
  speed_limit_mbps?: number;
  connection_limit?: number;
  effective_expires_at?: string | null;
  last_error_code?: string;
  created_at?: string;
}

interface PreflightResult {
  success?: boolean;
  ready?: boolean;
  message?: string;
  entry_host?: string;
  entry_address?: string;
  entry_port?: number;
  effective_expires_at?: string;
  warnings?: string[];
}

interface ConfirmState {
  title: string;
  description: string;
  confirmLabel: string;
  run: () => Promise<void>;
}

interface GrantDraft {
  username: string;
  tunnelID: string;
  startsAt: string;
  expiresAt: string;
  maxForwards: string;
  speedMbps: string;
  connectionLimit: string;
  trafficGB: string;
  billingMode: ForwardingBillingMode;
}

interface TemplateDraft {
  name: string;
  description: string;
  serverIDs: number[];
  billingMode: ForwardingBillingMode;
  multiplier: string;
  maxForwards: string;
  portStart: string;
  portEnd: string;
}

interface ForwardDraft {
  grantID: string;
  targetNodeID: string;
  name: string;
  requestedEntryPort: string;
  sourceCIDRs: string;
}

interface ForwardingManagementProps {
  isAdmin: boolean;
  notify: Notify;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function extractList<T>(payload: unknown, ...keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const root = asRecord(payload);
  if (!root) return [];
  const candidates: unknown[] = [root.items, ...keys.map((key) => root[key])];
  const data = asRecord(root.data);
  if (Array.isArray(root.data)) candidates.push(root.data);
  if (data) candidates.push(data.items, ...keys.map((key) => data[key]));
  return (candidates.find(Array.isArray) as T[] | undefined) ?? [];
}

function resourceID(item: { id: ResourceID; public_id?: string }): ResourceID {
  return item.public_id || item.id;
}

function sameID(left: ResourceID | null | undefined, right: ResourceID | null | undefined): boolean {
  return left !== null && left !== undefined && right !== null && right !== undefined && String(left) === String(right);
}

function idempotencyKey(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadFailure(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message.trim() ? reason.message : fallback;
}

function responseObject<T>(payload: unknown, ...keys: string[]): T {
  const root = asRecord(payload);
  if (!root) return payload as T;
  for (const key of keys) {
    if (root[key] !== undefined) return root[key] as T;
  }
  const data = asRecord(root.data);
  if (data) {
    for (const key of keys) {
      if (data[key] !== undefined) return data[key] as T;
    }
    return data as T;
  }
  return root as T;
}

function isServerOnline(server: RemoteServer): boolean {
  return server.ws_connected || ["online", "connected"].includes(server.status?.toLowerCase());
}

function stateLabel(state?: string): string {
  switch ((state || "").toLowerCase()) {
    case "active": return "运行中";
    case "inactive": return "已暂停";
    case "pending": return "等待下发";
    case "provisioning": return "正在下发";
    case "degraded": return "部分异常";
    case "suspended": return "已停用";
    case "draining": return "停止新建";
    case "cleanup_pending": return "等待清理";
    case "scheduled": return "待生效";
    case "expired": return "已到期";
    case "over_limit": return "流量已用尽";
    case "tunnel_unavailable": return "隧道不可用";
    case "tunnel_draining": return "隧道停止新建";
    case "user_disabled": return "用户已停用";
    case "error": return "异常";
    default: return state || "未知";
  }
}

function stateTone(state?: string): "good" | "warn" | "bad" | "info" | "neutral" {
  const value = (state || "").toLowerCase();
  if (value === "active") return "good";
  if (["pending", "provisioning", "scheduled", "draining", "degraded", "cleanup_pending"].includes(value)) return "warn";
  if (["error", "expired", "over_limit", "tunnel_unavailable", "user_disabled"].includes(value)) return "bad";
  if (["inactive", "suspended"].includes(value)) return "neutral";
  return "info";
}

function displayDate(value?: string | null): string {
  if (!value) return "长期有效";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : "时间未知";
}

function datetimeLocal(value?: string | null): string {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function futureLocal(days: number): string {
  return datetimeLocal(new Date(Date.now() + days * 86_400_000).toISOString());
}

function routeHops(template: TunnelTemplate | undefined, servers: RemoteServer[] = []): Array<{ id: number; name: string; status?: string }> {
  if (!template) return [];
  const serverMap = new Map(servers.map((server) => [server.id, server]));
  if (Array.isArray(template.hops) && template.hops.length) {
    return [...template.hops]
      .sort((left, right) => Number(left.position ?? 0) - Number(right.position ?? 0))
      .map((hop) => ({
        id: hop.server_id,
        name: hop.server_name || hop.name || serverMap.get(hop.server_id)?.name || `服务器 #${hop.server_id}`,
        status: hop.status || serverMap.get(hop.server_id)?.status,
      }));
  }
  if (Array.isArray(template.route) && template.route.length) {
    return template.route.map((hop, index) => typeof hop === "string"
      ? { id: index, name: hop }
      : { id: hop.server_id, name: hop.server_name || hop.name || serverMap.get(hop.server_id)?.name || `服务器 #${hop.server_id}`, status: hop.status });
  }
  return (template.server_ids ?? []).map((id) => ({ id, name: serverMap.get(id)?.name || `服务器 #${id}`, status: serverMap.get(id)?.status }));
}

function tunnelForGrant(grant: TunnelGrant, templates: TunnelTemplate[]): TunnelTemplate | undefined {
  if (grant.tunnel) return grant.tunnel;
  const matched = templates.find((template) => sameID(resourceID(template), grant.tunnel_id) || sameID(template.id, grant.tunnel_id));
  if (matched) return matched;
  if (grant.name || grant.route) {
    return {
      id: grant.tunnel_id ?? grant.id,
      name: grant.name || `隧道 ${grant.tunnel_id ?? grant.id}`,
      description: grant.description,
      state: grant.state || "active",
      route: grant.route,
    };
  }
  return undefined;
}

function tunnelName(grant: TunnelGrant, templates: TunnelTemplate[]): string {
  return grant.tunnel_name || grant.name || tunnelForGrant(grant, templates)?.name || `隧道 ${grant.tunnel_id ?? grant.id}`;
}

function forwardState(forward: ForwardRule): string {
  return forward.observed_state || forward.state || forward.desired_state || "pending";
}

function forwardEntry(forward: ForwardRule): { host: string; port: number } {
  return {
    host: forward.entry_host || forward.entry_address || forward.entry?.host || forward.entry?.address || "",
    port: Number(forward.allocated_entry_port || forward.entry_port || forward.entry?.port || 0),
  };
}

function grantActiveForwards(grant: TunnelGrant): number {
  return Number(grant.active_forwards ?? grant.active_forward_count ?? 0);
}

function grantUsedBytes(grant: TunnelGrant): number {
  return Number(grant.traffic_used_bytes ?? grant.used_bytes ?? 0);
}

function forwardRoute(forward: ForwardRule): string[] {
  if (forward.route?.length) return forward.route;
  return [...(forward.hops ?? [])]
    .sort((left, right) => Number(left.position ?? 0) - Number(right.position ?? 0))
    .map((hop) => hop.server_name || `服务器 #${hop.server_id ?? "-"}`);
}

function defaultTemplateDraft(): TemplateDraft {
  return {
    name: "",
    description: "",
    serverIDs: [],
    billingMode: "both",
    multiplier: "1",
    maxForwards: "0",
    portStart: "1024",
    portEnd: "65535",
  };
}

function defaultGrantDraft(users: UserItem[], templates: TunnelTemplate[]): GrantDraft {
  const firstCustomUser = users.find((user) => {
    const authorizationMode = user.authorization_mode ?? (user.package_id ? "package" : "custom");
    return user.role !== "admin" && authorizationMode === "custom";
  });
  return {
    username: firstCustomUser?.username || "",
    tunnelID: templates[0] ? String(resourceID(templates[0])) : "",
    startsAt: datetimeLocal(),
    expiresAt: futureLocal(30),
    maxForwards: "1",
    speedMbps: "0",
    connectionLimit: "0",
    trafficGB: "0",
    billingMode: normalizeForwardingBillingMode(templates[0]?.billing_mode),
  };
}

function grantDraftFrom(grant: TunnelGrant, templates: TunnelTemplate[]): GrantDraft {
  const template = tunnelForGrant(grant, templates);
  return {
    username: grant.username,
    tunnelID: grant.tunnel ? String(resourceID(grant.tunnel)) : grant.tunnel_id === undefined ? "" : String(grant.tunnel_id),
    startsAt: datetimeLocal(grant.starts_at),
    expiresAt: grant.expires_at ? datetimeLocal(grant.expires_at) : "",
    maxForwards: String(grant.max_active_forwards ?? 1),
    speedMbps: String(grant.per_forward_speed_mbps ?? 0),
    connectionLimit: String(grant.per_forward_connection_limit ?? 0),
    trafficGB: String((Number(grant.traffic_limit_bytes || 0) / 1024 ** 3) || 0),
    billingMode: normalizeForwardingBillingMode(grant.billing_mode_override, template?.billing_mode),
  };
}

export function ForwardingManagement({ isAdmin, notify }: ForwardingManagementProps) {
  return isAdmin ? <AdminForwarding notify={notify} /> : <UserForwarding notify={notify} />;
}

function AdminForwarding({ notify }: { notify: Notify }) {
  const [tab, setTab] = useState<AdminTab>("templates");
  const [templates, setTemplates] = useState<TunnelTemplate[]>([]);
  const [grants, setGrants] = useState<TunnelGrant[]>([]);
  const [forwards, setForwards] = useState<ForwardRule[]>([]);
  const [servers, setServers] = useState<RemoteServer[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<Partial<Record<AdminLoadSection, string>>>({});
  const [dialog, setDialog] = useState<"template" | "grant" | null>(null);
  const [editingGrant, setEditingGrant] = useState<TunnelGrant | undefined>();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const nextErrors: Partial<Record<AdminLoadSection, string>> = {};
    try {
      const [templateResult, serverResult, userResult, forwardResult] = await Promise.allSettled([
        api.get<unknown>("/api/admin/tunnel-templates"),
        api.get<ServerListResponse | RemoteServer[]>("/api/admin/remote-servers"),
        api.get<unknown>("/api/admin/users"),
        api.get<unknown>("/api/admin/forwards"),
      ]);

      if (templateResult.status === "fulfilled") {
        setTemplates(extractList<TunnelTemplate>(templateResult.value, "templates", "tunnels"));
      } else {
        nextErrors.templates = `隧道模板：${loadFailure(templateResult.reason, "加载失败")}`;
      }
      if (serverResult.status === "fulfilled") {
        const serverPayload = serverResult.value;
        const serverRoot = asRecord(serverPayload);
        setServers(Array.isArray(serverPayload)
          ? serverPayload
          : Array.isArray(serverRoot?.servers) ? serverRoot.servers as RemoteServer[] : []);
      } else {
        nextErrors.servers = `服务器列表：${loadFailure(serverResult.reason, "加载失败")}`;
      }
      if (forwardResult.status === "fulfilled") {
        setForwards(extractList<ForwardRule>(forwardResult.value, "forwards", "rules"));
      } else {
        nextErrors.forwards = `全部转发：${loadFailure(forwardResult.reason, "加载失败")}`;
      }

      if (userResult.status === "fulfilled") {
        const nextUsers = extractList<UserItem>(userResult.value, "users");
        const grantUsers = [...new Map(nextUsers.filter((user) => user.username).map((user) => [user.username, user])).values()];
        setUsers(nextUsers);
        const grantResults = await Promise.allSettled(grantUsers.map((user) => (
          api.get<unknown>(`/api/admin/users/${encodeURIComponent(user.username)}/tunnel-grants`)
        )));
        const failedUsernames = grantResults.flatMap((result, index) => (
          result.status === "rejected" ? [grantUsers[index].username] : []
        ));
        setGrants((current) => {
          const currentByUsername = new Map<string, TunnelGrant[]>();
          current.forEach((grant) => currentByUsername.set(grant.username, [...(currentByUsername.get(grant.username) ?? []), grant]));
          return grantResults.flatMap((result, index) => {
            const username = grantUsers[index].username;
            if (result.status === "rejected") return currentByUsername.get(username) ?? [];
            return extractList<TunnelGrant>(result.value, "grants", "tunnel_grants")
              .map((grant) => grant.username ? grant : { ...grant, username });
          });
        });
        if (failedUsernames.length) {
          nextErrors.grants = `用户授权：${failedUsernames.join("、")} 加载失败`;
        }
      } else {
        nextErrors.users = `用户列表：${loadFailure(userResult.reason, "加载失败")}`;
      }
    } catch (reason) {
      nextErrors.general = loadFailure(reason, "转发管理数据加载失败");
    } finally {
      setLoadErrors(nextErrors);
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runConfirmed = async () => {
    if (!confirm) return;
    setWorking(true);
    try {
      await confirm.run();
      setConfirm(null);
      await load(true);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "操作失败", "error");
    } finally {
      setWorking(false);
    }
  };

  const changeTemplateState = async (template: TunnelTemplate, state: string) => {
    await api.put(`/api/admin/tunnel-templates/${encodeURIComponent(resourceID(template))}/state`, { state, version: template.version ?? 1 }, { idempotencyKey: idempotencyKey() });
    notify(state === "active" ? "隧道已恢复运行" : state === "draining" ? "隧道已停止新建" : "隧道已紧急停用");
    await load(true);
  };

  const runForwardAction = async (forward: ForwardRule, action: "suspend" | "resume" | "retry") => {
    await api.post(`/api/admin/forwards/${encodeURIComponent(resourceID(forward))}/${action}`, {}, { idempotencyKey: idempotencyKey() });
    notify(action === "suspend" ? "转发已暂停" : action === "resume" ? "转发恢复任务已提交" : "已重新下发转发");
    await load(true);
  };

  const visibleLoadErrors = (tab === "templates"
    ? [loadErrors.general, loadErrors.templates, loadErrors.servers]
    : tab === "grants"
      ? [loadErrors.general, loadErrors.users, loadErrors.grants, loadErrors.templates]
      : [loadErrors.general, loadErrors.forwards, loadErrors.templates])
    .filter((message): message is string => Boolean(message));

  return <section className="fm-root" aria-label="转发管理">
    <div className="fm-section-heading">
      <div><span className="eyebrow">FORWARDING</span><h2>转发管理</h2><p>由管理员编排服务器路线，再按用户授权创建转发。</p></div>
      <IconButton label="刷新转发管理数据" disabled={loading} onClick={() => void load()}><RefreshCw size={18} /></IconButton>
    </div>

    <div className="fm-metrics" aria-label="转发运行摘要">
      <Metric icon={<Route size={18} />} label="隧道模板" value={templates.length} note={`${templates.filter((item) => item.state === "active").length} 条可新建`} />
      <Metric icon={<Users size={18} />} label="用户授权" value={grants.length} note={`${grants.filter((item) => (item.effective_state || item.state) === "active").length} 份生效`} />
      <Metric icon={<Activity size={18} />} label="全部转发" value={forwards.length} note={`${forwards.filter((item) => forwardState(item) === "active").length} 条运行中`} />
      <Metric icon={<Server size={18} />} label="可用服务器" value={servers.filter(isServerOnline).length} note={`共 ${servers.filter((item) => !item.is_federated).length} 台受管服务器`} />
    </div>

    <div className="fm-tabs" role="tablist" aria-label="管理员转发视图">
      <button role="tab" aria-selected={tab === "templates"} className={tab === "templates" ? "is-active" : ""} onClick={() => setTab("templates")}><Route size={16} />隧道模板 <span>{templates.length}</span></button>
      <button role="tab" aria-selected={tab === "grants"} className={tab === "grants" ? "is-active" : ""} onClick={() => setTab("grants")}><ShieldCheck size={16} />用户授权 <span>{grants.length}</span></button>
      <button role="tab" aria-selected={tab === "forwards"} className={tab === "forwards" ? "is-active" : ""} onClick={() => setTab("forwards")}><Network size={16} />全部转发 <span>{forwards.length}</span></button>
    </div>

    {visibleLoadErrors.length ? <ErrorState message={`部分数据未能刷新：${visibleLoadErrors.join("；")}。已保留其余成功数据，可继续操作。`} onRetry={() => void load(true)} /> : null}
    {loading ? <div className="center-state"><Spinner label="正在加载转发管理" /></div> : null}
    {!loading && tab === "templates" ? <TemplatePanel templates={templates} servers={servers} onCreate={() => setDialog("template")} onState={changeTemplateState} onDelete={(template) => setConfirm({
      title: "删除隧道模板",
      description: `将删除“${template.name}”。存在转发时后端会拒绝删除，不会留下未托管配置。`,
      confirmLabel: "确认删除",
      run: async () => { await api.delete(`/api/admin/tunnel-templates/${encodeURIComponent(resourceID(template))}`, undefined, { idempotencyKey: idempotencyKey() }); notify("隧道模板已删除"); },
    })} /> : null}
    {!loading && tab === "grants" ? <GrantPanel grants={grants} templates={templates} onCreate={() => { setEditingGrant(undefined); setDialog("grant"); }} onEdit={(grant) => { setEditingGrant(grant); setDialog("grant"); }} onAction={async (grant, action) => {
      await api.post(`/api/admin/users/${encodeURIComponent(grant.username)}/tunnel-grants/${encodeURIComponent(resourceID(grant))}/${action}`, {}, { idempotencyKey: idempotencyKey() });
      notify(action === "suspend" ? "隧道授权已暂停" : "隧道授权已恢复");
      await load(true);
    }} onDelete={(grant) => setConfirm({
      title: "撤销隧道授权",
      description: `仅可删除没有关联转发的授权。若要立即停用 ${grant.username} 的“${tunnelName(grant, templates)}”，请先使用暂停操作；如仍有关联转发，请先清理后再删除。`,
      confirmLabel: "确认撤权",
      run: async () => { await api.delete(`/api/admin/users/${encodeURIComponent(grant.username)}/tunnel-grants/${encodeURIComponent(resourceID(grant))}`, undefined, { idempotencyKey: idempotencyKey() }); notify("隧道授权已撤销"); },
    })} /> : null}
    {!loading && tab === "forwards" ? <ForwardTable admin forwards={forwards} templates={templates} onAction={runForwardAction} onDelete={(forward) => setConfirm({
      title: "删除用户转发",
      description: `将切断“${forward.name}”的入口并逐跳清理远端资源。离线服务器会进入等待清理状态。`,
      confirmLabel: "确认删除",
      run: async () => { await api.delete(`/api/admin/forwards/${encodeURIComponent(resourceID(forward))}`, undefined, { idempotencyKey: idempotencyKey() }); notify("转发删除任务已提交"); },
    })} /> : null}

    {dialog === "template" ? <TemplateDialog servers={servers} onClose={() => setDialog(null)} onComplete={async () => { setDialog(null); notify("隧道模板已创建"); await load(true); }} /> : null}
    {dialog === "grant" ? <GrantDialog grant={editingGrant} users={users} templates={templates} onClose={() => setDialog(null)} onComplete={async () => { setDialog(null); notify(editingGrant ? "隧道授权已更新" : "隧道授权已创建"); await load(true); }} /> : null}
    {confirm ? <ConfirmDialog title={confirm.title} description={confirm.description} confirmLabel={confirm.confirmLabel} working={working} onCancel={() => !working && setConfirm(null)} onConfirm={() => void runConfirmed()} /> : null}
  </section>;
}

function Metric({ icon, label, value, note }: { icon: ReactNode; label: string; value: ReactNode; note: string }) {
  return <div className="fm-metric"><span className="fm-metric-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong><span>{note}</span></div></div>;
}

function TemplatePanel({ templates, servers, onCreate, onState, onDelete }: {
  templates: TunnelTemplate[];
  servers: RemoteServer[];
  onCreate: () => void;
  onState: (template: TunnelTemplate, state: string) => Promise<void>;
  onDelete: (template: TunnelTemplate) => void;
}) {
  const [workingID, setWorkingID] = useState<ResourceID | null>(null);
  const changeState = async (template: TunnelTemplate, state: string) => {
    setWorkingID(resourceID(template));
    try { await onState(template, state); } finally { setWorkingID(null); }
  };
  return <div className="fm-panel">
    <div className="fm-toolbar"><div><strong>隧道模板</strong><span>服务器顺序由管理员固定，用户无法修改路线。</span></div><Button onClick={onCreate}><Plus size={16} />创建隧道</Button></div>
    {templates.length === 0 ? <EmptyState icon={<Route size={25} />} title="暂无隧道模板" description="先选择 1 至 8 台在线受管服务器创建路线" action={<Button onClick={onCreate}><Plus size={16} />创建第一条隧道</Button>} /> : <Surface className="table-surface fm-table-surface"><div className="table-wrap"><table className="fm-table"><thead><tr><th>隧道</th><th>服务器路线</th><th>策略</th><th>使用情况</th><th>状态</th><th aria-label="操作" /></tr></thead><tbody>{templates.map((template) => {
      const hops = routeHops(template, servers);
      const id = resourceID(template);
      return <tr key={String(id)}><td className="fm-primary-cell"><strong>{template.name}</strong><small>{template.description || `#${id}`}</small></td><td><RouteLine hops={hops.map((hop) => ({ name: hop.name, tone: hop.status && ["online", "connected"].includes(hop.status) ? "good" : undefined }))} /><small className="fm-cell-note">{hops.length} 跳 · TCP + UDP</small></td><td><span>{forwardingBillingModeLabel(template.billing_mode)}</span><small className="fm-cell-note">{((template.traffic_multiplier_milli ?? 1000) / 1000).toFixed(2)} 倍 · {template.port_range_start || "-"}–{template.port_range_end || "-"}</small></td><td><span>{template.active_forwards ?? 0}/{template.max_total_forwards || "不限"} 条转发</span><small className="fm-cell-note">{template.grant_count ?? 0} 份授权</small></td><td><Badge tone={stateTone(template.state)}>{stateLabel(template.state)}</Badge></td><td><div className="fm-row-actions">{template.state !== "active" ? <IconButton label={`恢复 ${template.name}`} disabled={sameID(workingID, id)} onClick={() => void changeState(template, "active")}><CirclePlay size={16} /></IconButton> : <IconButton label={`停止 ${template.name} 新建`} disabled={sameID(workingID, id)} onClick={() => void changeState(template, "draining")}><CirclePause size={16} /></IconButton>}<IconButton label={`紧急停用 ${template.name}`} disabled={template.state === "suspended" || sameID(workingID, id)} onClick={() => void changeState(template, "suspended")}><Zap size={16} /></IconButton><IconButton label={`删除 ${template.name}`} onClick={() => onDelete(template)}><Trash2 size={16} /></IconButton></div></td></tr>;
    })}</tbody></table></div></Surface>}
  </div>;
}

function RouteLine({ hops }: { hops: Array<{ name: string; tone?: "good" | "warn" }> }) {
  return <div className="fm-route-line">{hops.map((hop, index) => <span key={`${hop.name}-${index}`}><span className={`fm-hop ${hop.tone ? `is-${hop.tone}` : ""}`} title={hop.name}>{hop.name}</span>{index < hops.length - 1 ? <ArrowRight size={14} /> : null}</span>)}</div>;
}

function TemplateDialog({ servers, onClose, onComplete }: { servers: RemoteServer[]; onClose: () => void; onComplete: () => Promise<void> }) {
  const eligible = servers.filter((server) => !server.is_federated);
  const [draft, setDraft] = useState(defaultTemplateDraft);
  const [nextServer, setNextServer] = useState(String(eligible[0]?.id || ""));
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState<"preflight" | "create" | "">("");
  const selectedServers = draft.serverIDs.map((id) => eligible.find((server) => server.id === id)).filter((server): server is RemoteServer => Boolean(server));
  const available = eligible.filter((server) => !draft.serverIDs.includes(server.id));
  const portStart = Number(draft.portStart);
  const portEnd = Number(draft.portEnd);
  const validPorts = Number.isInteger(portStart) && Number.isInteger(portEnd) && portStart >= 1024 && portEnd <= 65535 && portStart <= portEnd;
  const valid = draft.name.trim().length > 0 && draft.serverIDs.length >= 1 && draft.serverIDs.length <= 8 && validPorts && Number(draft.multiplier) > 0;
  const payload = () => ({
    name: draft.name.trim(),
    description: draft.description.trim(),
    billing_mode: draft.billingMode,
    traffic_multiplier_milli: Math.round(Number(draft.multiplier) * 1000),
    max_total_forwards: Math.max(0, Number(draft.maxForwards) || 0),
    port_range_start: Number(draft.portStart),
    port_range_end: Number(draft.portEnd),
    server_ids: draft.serverIDs,
  });
  const update = <K extends keyof TemplateDraft>(key: K, value: TemplateDraft[K]) => { setDraft((current) => ({ ...current, [key]: value })); setPreflight(null); };
  const addServer = () => {
    const id = Number(nextServer);
    if (!id || draft.serverIDs.includes(id) || draft.serverIDs.length >= 8) return;
    update("serverIDs", [...draft.serverIDs, id]);
    const following = available.find((server) => server.id !== id);
    setNextServer(String(following?.id || ""));
  };
  const moveServer = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= draft.serverIDs.length) return;
    const next = [...draft.serverIDs];
    [next[index], next[target]] = [next[target], next[index]];
    update("serverIDs", next);
  };
  const runPreflight = async () => {
    if (!valid) return;
    setWorking("preflight"); setError("");
    try {
      const response = await api.post<unknown>("/api/admin/tunnel-templates/preflight", payload(), { idempotencyKey: idempotencyKey() });
      setPreflight(responseObject<PreflightResult>(response, "preflight", "result"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "隧道预检失败"); }
    finally { setWorking(""); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || !preflight || preflight.success === false || preflight.ready === false) return;
    setWorking("create"); setError("");
    try { await api.post("/api/admin/tunnel-templates", payload(), { idempotencyKey: idempotencyKey() }); await onComplete(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "隧道创建失败"); setWorking(""); }
  };
  return <Dialog title="创建隧道模板" description="按真实流量方向，从入口到出口排列 1 至 8 台服务器。" onClose={onClose} wide dismissible={!working}>
    <form className="fm-form" onSubmit={(event) => void submit(event)}>
      {error ? <ErrorState message={error} /> : null}
      <div className="fm-form-grid"><Field label="隧道名称"><input required value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="例如：香港-日本-洛杉矶" /></Field><Field label="备注"><input value={draft.description} onChange={(event) => update("description", event.target.value)} placeholder="用途或线路说明" /></Field></div>
      <fieldset className="fm-route-editor"><legend>服务器路线</legend><div className="fm-route-add"><Field label="添加受管服务器"><select value={nextServer} onChange={(event) => setNextServer(event.target.value)} disabled={!available.length || draft.serverIDs.length >= 8}><option value="">选择服务器</option>{available.map((server) => <option key={server.id} value={server.id}>{server.name} · {isServerOnline(server) ? "在线" : "离线"}</option>)}</select></Field><Button type="button" variant="secondary" onClick={addServer} disabled={!nextServer || draft.serverIDs.length >= 8}><Plus size={16} />加入路线</Button></div>
        {selectedServers.length ? <ol className="fm-route-editor-list">{selectedServers.map((server, index) => <li key={server.id}><span className="fm-hop-index">{index + 1}</span><span><strong>{server.name}</strong><small>{index === 0 ? "入口服务器" : index === selectedServers.length - 1 ? "出口服务器" : `中转第 ${index} 跳`} · {isServerOnline(server) ? "Agent 在线" : "Agent 离线"}</small></span><div><IconButton type="button" label={`上移 ${server.name}`} disabled={index === 0} onClick={() => moveServer(index, -1)}><ArrowUp size={15} /></IconButton><IconButton type="button" label={`下移 ${server.name}`} disabled={index === selectedServers.length - 1} onClick={() => moveServer(index, 1)}><ArrowDown size={15} /></IconButton><IconButton type="button" label={`移除 ${server.name}`} onClick={() => update("serverIDs", draft.serverIDs.filter((id) => id !== server.id))}><X size={15} /></IconButton></div></li>)}</ol> : <EmptyState icon={<Server size={22} />} title="尚未选择服务器" description="第一台为用户入口，最后一台连接目标节点" />}
      </fieldset>
      <div className="fm-form-grid fm-form-grid-four"><Field label="计费方向"><select value={draft.billingMode} onChange={(event) => update("billingMode", event.target.value as TemplateDraft["billingMode"])}><option value="both">双向</option><option value="upload">仅算上行</option><option value="download">仅算下行</option></select></Field><Field label="流量倍率"><input type="number" min="0.01" step="0.01" value={draft.multiplier} onChange={(event) => update("multiplier", event.target.value)} /></Field><Field label="最大总转发数" hint="0 表示不限"><input type="number" min="0" value={draft.maxForwards} onChange={(event) => update("maxForwards", event.target.value)} /></Field><Field label="网络类型"><select value="tcp_udp" disabled><option value="tcp_udp">TCP + UDP</option></select></Field></div>
      <div className="fm-form-grid"><Field label="端口范围起点" hint="仅限制可选端口，不会预占整段范围"><input type="number" min="1024" max="65535" value={draft.portStart} onChange={(event) => update("portStart", event.target.value)} /></Field><Field label="端口范围终点" hint="未被实际转发使用的端口仍可用于节点"><input type="number" min="1024" max="65535" value={draft.portEnd} onChange={(event) => update("portEnd", event.target.value)} /></Field></div>
      {preflight ? <div className={`fm-preflight ${preflight.success === false || preflight.ready === false ? "is-bad" : "is-good"}`}><ShieldCheck size={18} /><span><strong>{preflight.success === false || preflight.ready === false ? "预检未通过" : "路线预检通过"}</strong><small>{preflight.message || "服务器、TCP/UDP 能力与端口范围均可用"}</small>{preflight.warnings?.map((warning) => <small key={warning}>{warning}</small>)}</span></div> : null}
      <div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={Boolean(working)}>取消</Button><Button type="button" variant="secondary" disabled={!valid || Boolean(working)} onClick={() => void runPreflight()}>{working === "preflight" ? <Spinner label="正在预检" /> : <><Zap size={16} />预检路线</>}</Button><Button type="submit" disabled={!valid || !preflight || preflight.success === false || preflight.ready === false || Boolean(working)}>{working === "create" ? <Spinner label="正在创建" /> : <><Check size={16} />创建隧道</>}</Button></div>
    </form>
  </Dialog>;
}

function GrantPanel({ grants, templates, onCreate, onEdit, onAction, onDelete }: {
  grants: TunnelGrant[];
  templates: TunnelTemplate[];
  onCreate: () => void;
  onEdit: (grant: TunnelGrant) => void;
  onAction: (grant: TunnelGrant, action: "suspend" | "resume") => Promise<void>;
  onDelete: (grant: TunnelGrant) => void;
}) {
  const [workingID, setWorkingID] = useState<ResourceID | null>(null);
  const change = async (grant: TunnelGrant, action: "suspend" | "resume") => {
    setWorkingID(resourceID(grant));
    try { await onAction(grant, action); } finally { setWorkingID(null); }
  };
  return <div className="fm-panel"><div className="fm-toolbar"><div><strong>用户隧道授权</strong><span>授权仅提供路线使用权，不开放服务器管理权限。</span></div><Button onClick={onCreate}><Plus size={16} />新增授权</Button></div>{grants.length === 0 ? <EmptyState icon={<UserRound size={25} />} title="暂无隧道授权" description="先建立隧道模板，再为用户设置期限与资源上限" action={<Button onClick={onCreate}><Plus size={16} />新增第一份授权</Button>} /> : <Surface className="table-surface fm-table-surface"><div className="table-wrap"><table className="fm-table"><thead><tr><th>用户 / 隧道</th><th>有效期</th><th>转发限制</th><th>流量</th><th>状态</th><th aria-label="操作" /></tr></thead><tbody>{grants.map((grant) => {
    const id = resourceID(grant);
    const state = grant.effective_state || grant.state || (grant.enabled === false ? "suspended" : "active");
    const packageManaged = grant.source_type === "package";
    return <tr key={`${grant.username}-${String(id)}`}><td className="fm-primary-cell"><strong>{grant.username}</strong><small>{tunnelName(grant, templates)}{packageManaged ? " · 套餐来源" : ""}</small></td><td><span>{displayDate(grant.expires_at)}</span><small className="fm-cell-note">{grant.starts_at ? `${displayDate(grant.starts_at)} 起` : "立即生效"}</small></td><td><span>{grantActiveForwards(grant)}/{grant.max_active_forwards} 条启用</span><small className="fm-cell-note">{grant.per_forward_speed_mbps ? `${grant.per_forward_speed_mbps} Mbps` : "不限速"} · {grant.per_forward_connection_limit ? `${grant.per_forward_connection_limit} 连接` : "不限连接"}</small></td><td><span>{formatBytes(grantUsedBytes(grant))} / {grant.traffic_limit_bytes ? formatBytes(grant.traffic_limit_bytes) : "不限"}</span><small className="fm-cell-note">当前版本不自动重置</small></td><td><Badge tone={stateTone(state)}>{stateLabel(state)}</Badge></td><td><div className="fm-row-actions">{packageManaged ? <Badge tone="info">套餐管理</Badge> : <><IconButton label={`编辑 ${grant.username} 的隧道授权`} onClick={() => onEdit(grant)}><Gauge size={16} /></IconButton>{state === "active" ? <IconButton label={`暂停 ${grant.username} 的隧道授权`} disabled={sameID(workingID, id)} onClick={() => void change(grant, "suspend")}><CirclePause size={16} /></IconButton> : <IconButton label={`恢复 ${grant.username} 的隧道授权`} disabled={sameID(workingID, id)} onClick={() => void change(grant, "resume")}><CirclePlay size={16} /></IconButton>}<IconButton label={`撤销 ${grant.username} 的隧道授权`} onClick={() => onDelete(grant)}><Trash2 size={16} /></IconButton></>}</div></td></tr>;
  })}</tbody></table></div></Surface>}</div>;
}

function GrantDialog({ grant, users, templates, onClose, onComplete }: { grant?: TunnelGrant; users: UserItem[]; templates: TunnelTemplate[]; onClose: () => void; onComplete: () => Promise<void> }) {
  const [draft, setDraft] = useState<GrantDraft>(() => grant ? grantDraftFrom(grant, templates) : defaultGrantDraft(users, templates));
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const eligibleUsers = users.filter((user) => {
    const authorizationMode = user.authorization_mode ?? (user.package_id ? "package" : "custom");
    return (user.role !== "admin" && authorizationMode === "custom") || (Boolean(grant) && user.username === draft.username);
  });
  const activeTemplates = templates.filter((template) => template.state === "active" || sameID(resourceID(template), draft.tunnelID));
  const selectedUser = users.find((user) => user.username === draft.username);
  const selectedAuthorizationMode = selectedUser?.authorization_mode ?? (selectedUser?.package_id ? "package" : "custom");
  const valid = selectedAuthorizationMode === "custom" && draft.username && draft.tunnelID && draft.startsAt && Number(draft.maxForwards) >= 1 && Number(draft.speedMbps) >= 0 && Number(draft.connectionLimit) >= 0 && Number(draft.trafficGB) >= 0 && (!draft.expiresAt || new Date(draft.expiresAt).getTime() > new Date(draft.startsAt).getTime());
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setWorking(true); setError("");
    const payload = {
      tunnel_id: draft.tunnelID,
      enabled: grant?.enabled ?? true,
      starts_at: new Date(draft.startsAt).toISOString(),
      expires_at: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null,
      max_active_forwards: Number(draft.maxForwards),
      per_forward_speed_mbps: INBOUND_LIMITER_V1 ? Number(draft.speedMbps) : 0,
      per_forward_connection_limit: INBOUND_LIMITER_V1 ? Number(draft.connectionLimit) : 0,
      traffic_limit_bytes: Math.round(Number(draft.trafficGB) * 1024 ** 3),
      billing_mode_override: draft.billingMode,
      allow_custom_public_target: false,
      ...(grant ? { version: grant.version ?? 1 } : {}),
    };
    try {
      const base = `/api/admin/users/${encodeURIComponent(draft.username)}/tunnel-grants`;
      if (grant) await api.put(`${base}/${encodeURIComponent(resourceID(grant))}`, payload, { idempotencyKey: idempotencyKey() });
      else await api.post(base, payload, { idempotencyKey: idempotencyKey() });
      await onComplete();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "隧道授权保存失败"); setWorking(false); }
  };
  const update = <K extends keyof GrantDraft>(key: K, value: GrantDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  return <Dialog title={grant ? "编辑隧道授权" : "新增隧道授权"} description="限制对单个用户生效，不会改变隧道模板或服务器权限。" onClose={onClose} wide dismissible={!working}><form className="fm-form" onSubmit={(event) => void submit(event)}>{error ? <ErrorState message={error} /> : null}<div className="fm-form-grid"><Field label="授权用户"><select value={draft.username} disabled={Boolean(grant)} onChange={(event) => update("username", event.target.value)}><option value="">选择用户</option>{eligibleUsers.map((user) => <option key={user.username} value={user.username}>{user.nickname || user.username} ({user.username})</option>)}</select></Field><Field label="隧道模板"><select value={draft.tunnelID} disabled={Boolean(grant)} onChange={(event) => update("tunnelID", event.target.value)}><option value="">选择隧道</option>{activeTemplates.map((template) => <option key={String(resourceID(template))} value={String(resourceID(template))}>{template.name}</option>)}</select></Field></div><div className="fm-form-grid"><Field label="生效时间"><input type="datetime-local" value={draft.startsAt} onChange={(event) => update("startsAt", event.target.value)} /></Field><Field label="到期时间" hint="留空表示长期"><input type="datetime-local" value={draft.expiresAt} onChange={(event) => update("expiresAt", event.target.value)} /></Field></div><div className="fm-form-grid fm-form-grid-four"><Field label="最大启用转发"><input type="number" min="1" value={draft.maxForwards} onChange={(event) => update("maxForwards", event.target.value)} /></Field><Field label="每转发限速 Mbps" hint="当前节点组件暂不支持"><input type="number" min="0" step="0.1" value={INBOUND_LIMITER_V1 ? draft.speedMbps : "0"} disabled={!INBOUND_LIMITER_V1} onChange={(event) => update("speedMbps", event.target.value)} /></Field><Field label="每转发连接数" hint="当前节点组件暂不支持"><input type="number" min="0" value={INBOUND_LIMITER_V1 ? draft.connectionLimit : "0"} disabled={!INBOUND_LIMITER_V1} onChange={(event) => update("connectionLimit", event.target.value)} /></Field><Field label="授权总流量 GB" hint="0 表示不限"><input type="number" min="0" step="0.1" value={draft.trafficGB} onChange={(event) => update("trafficGB", event.target.value)} /></Field></div><div className="fm-form-grid"><Field label="计费方向"><select value={draft.billingMode} onChange={(event) => update("billingMode", event.target.value as ForwardingBillingMode)}><option value="both">双向</option><option value="upload">仅算上行</option><option value="download">仅算下行</option></select></Field><Field label="流量重置" hint="当前版本暂不支持"><select value="none" disabled><option value="none">不自动重置</option></select></Field></div><div className="fm-capability-note"><ShieldCheck size={17} /><span>转发同时支持 TCP 与 UDP，可自动选取共同端口或由用户在模板范围内指定端口。当前 Agent 未提供限速组件，限速和连接数固定为不限。</span></div><div className="dialog-actions"><Button type="button" variant="secondary" disabled={working} onClick={onClose}>取消</Button><Button type="submit" disabled={!valid || working}>{working ? <Spinner label="正在保存" /> : <><Check size={16} />保存授权</>}</Button></div></form></Dialog>;
}

function ForwardTable({ forwards, templates, admin = false, onAction, onDelete, onCopy }: {
  forwards: ForwardRule[];
  templates: TunnelTemplate[];
  admin?: boolean;
  onAction: (forward: ForwardRule, action: "suspend" | "resume" | "retry") => Promise<void>;
  onDelete: (forward: ForwardRule) => void;
  onCopy?: (forward: ForwardRule) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [workingID, setWorkingID] = useState<ResourceID | null>(null);
  const visible = useMemo(() => forwards.filter((forward) => {
    const state = forwardState(forward);
    if (status !== "all" && state !== status) return false;
    const text = [forward.name, forward.username, forward.tunnel_name, forward.target_node_name, forward.target_name, forward.target_host].filter(Boolean).join(" ").toLowerCase();
    return !query.trim() || text.includes(query.trim().toLowerCase());
  }), [forwards, query, status]);
  const act = async (forward: ForwardRule, action: "suspend" | "resume" | "retry") => {
    setWorkingID(resourceID(forward));
    try { await onAction(forward, action); } finally { setWorkingID(null); }
  };
  return <div className="fm-panel"><div className="fm-toolbar fm-filter-toolbar"><div><strong>{admin ? "全部用户转发" : "我的转发"}</strong><span>{admin ? "入口异常时可重试下发，删除会按入口到出口顺序清理。" : "入口完全生效后才能复制地址或生成客户端配置。"}</span></div><div className="fm-inline-filters"><input aria-label="搜索转发" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名称、用户、隧道或目标" /><select aria-label="转发状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="active">运行中</option><option value="pending">等待下发</option><option value="provisioning">正在下发</option><option value="degraded">部分异常</option><option value="suspended">已停用</option><option value="error">异常</option></select></div></div>{visible.length === 0 ? <EmptyState icon={<Network size={25} />} title={forwards.length ? "没有匹配的转发" : "暂无转发"} description={forwards.length ? "调整搜索条件或状态筛选" : admin ? "用户创建的转发会显示在这里" : "从有效隧道授权创建第一条转发"} /> : <Surface className="table-surface fm-table-surface"><div className="table-wrap"><table className="fm-table fm-forward-table"><thead><tr>{admin ? <th>用户</th> : null}<th>转发 / 入口</th><th>隧道</th><th>最终目标</th><th>限制与流量</th><th>状态</th><th aria-label="操作" /></tr></thead><tbody>{visible.map((forward) => {
    const id = resourceID(forward);
    const state = forwardState(forward);
    const entry = forwardEntry(forward);
    const route = forwardRoute(forward);
    const template = forward.tunnel || templates.find((item) => sameID(resourceID(item), forward.tunnel_id)) || (route.length ? { id: forward.grant_id, name: forward.tunnel_name || `授权 ${forward.grant_id}`, state: "active", route } : undefined);
    return <tr key={String(id)}>{admin ? <td><strong>{forward.username || "-"}</strong></td> : null}<td className="fm-primary-cell"><strong>{forward.name}</strong><small>{state === "active" && entry.host && entry.port ? `${entry.host}:${entry.port}` : "入口尚未可用"}</small></td><td><span>{forward.tunnel_name || template?.name || `授权 ${forward.grant_id}`}</span>{template ? <RouteLine hops={routeHops(template).map((hop) => ({ name: hop.name }))} /> : null}</td><td><span>{forward.target_node_name || forward.target_name || forward.target_host || `节点 #${forward.target_node_id || "-"}`}</span><small className="fm-cell-note">TCP + UDP · {forward.target_port || "节点服务端口"}</small></td><td><span>{formatBytes(forward.traffic_used_bytes)}</span><small className="fm-cell-note">{forward.speed_limit_mbps ? `${forward.speed_limit_mbps} Mbps` : "不限速"} · {forward.connection_limit ? `${forward.connection_limit} 连接` : "不限连接"}</small></td><td><Badge tone={stateTone(state)}>{stateLabel(state)}</Badge>{forward.effective_expires_at ? <small className="fm-cell-note">至 {displayDate(forward.effective_expires_at)}</small> : null}</td><td><div className="fm-row-actions">{onCopy ? <IconButton label={`复制 ${forward.name} 入口`} disabled={state !== "active" || !entry.host || !entry.port} onClick={() => void onCopy(forward)}><Copy size={16} /></IconButton> : null}{state === "active" ? <IconButton label={`暂停 ${forward.name}`} disabled={sameID(workingID, id)} onClick={() => void act(forward, "suspend")}><CirclePause size={16} /></IconButton> : <IconButton label={`恢复 ${forward.name}`} disabled={sameID(workingID, id) || ["pending", "provisioning", "cleanup_pending"].includes(state)} onClick={() => void act(forward, "resume")}><CirclePlay size={16} /></IconButton>}{["error", "degraded"].includes(state) ? <IconButton label={`重试 ${forward.name}`} disabled={sameID(workingID, id)} onClick={() => void act(forward, "retry")}><RefreshCw size={16} /></IconButton> : null}<IconButton label={`删除 ${forward.name}`} onClick={() => onDelete(forward)}><Trash2 size={16} /></IconButton></div></td></tr>;
  })}</tbody></table></div></Surface>}</div>;
}

function UserForwarding({ notify }: { notify: Notify }) {
  const [tab, setTab] = useState<UserTab>("forwards");
  const [grants, setGrants] = useState<TunnelGrant[]>([]);
  const [forwards, setForwards] = useState<ForwardRule[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wizard, setWizard] = useState(false);
  const [wizardGrantID, setWizardGrantID] = useState<string>();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const [grantPayload, forwardPayload, nodePayload] = await Promise.all([
        api.get<unknown>("/api/user/tunnel-grants"),
        api.get<unknown>("/api/user/forwards"),
        api.get<unknown>("/api/user/nodes"),
      ]);
      setGrants(extractList<TunnelGrant>(grantPayload, "grants", "tunnel_grants"));
      setForwards(extractList<ForwardRule>(forwardPayload, "forwards", "rules"));
      setNodes(extractList<NodeItem>(nodePayload, "nodes"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "转发数据加载失败"); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const templates = useMemo(() => grants.map((grant) => tunnelForGrant(grant, [])).filter((item): item is TunnelTemplate => Boolean(item)), [grants]);
  const activeGrants = grants.filter((grant) => (grant.effective_state || grant.state || (grant.enabled === false ? "suspended" : "active")) === "active");
  const activeForwards = forwards.filter((forward) => forwardState(forward) === "active");
  const totalLimit = grants.reduce((total, grant) => total + Number(grant.traffic_limit_bytes || 0), 0);
  const totalUsed = grants.reduce((total, grant) => total + grantUsedBytes(grant), 0);
  const nearestExpiry = grants.map((grant) => grant.expires_at).filter((value): value is string => Boolean(value)).sort()[0];

  const runForwardAction = async (forward: ForwardRule, action: "suspend" | "resume" | "retry") => {
    await api.post(`/api/user/forwards/${encodeURIComponent(resourceID(forward))}/${action}`, {}, { idempotencyKey: idempotencyKey() });
    notify(action === "suspend" ? "转发已暂停" : action === "resume" ? "转发恢复任务已提交" : "转发重试任务已提交");
    await load(true);
  };
  const runConfirmed = async () => {
    if (!confirm) return;
    setWorking(true);
    try { await confirm.run(); setConfirm(null); await load(true); }
    catch (reason) { notify(reason instanceof Error ? reason.message : "操作失败", "error"); }
    finally { setWorking(false); }
  };
  const copyEntry = async (forward: ForwardRule) => {
    const entry = forwardEntry(forward);
    await navigator.clipboard.writeText(`${entry.host}:${entry.port}`);
    notify("入口地址已复制");
  };

  return <section className="fm-root" aria-label="转发管理"><div className="fm-section-heading"><div><span className="eyebrow">FORWARDING</span><h2>转发管理</h2><p>使用管理员授权的固定路线，把入口流量安全转发到自己的受管节点。</p></div><div className="fm-heading-actions"><IconButton label="刷新我的转发" disabled={loading} onClick={() => void load()}><RefreshCw size={18} /></IconButton><Button disabled={!activeGrants.length} onClick={() => { setWizardGrantID(undefined); setWizard(true); }}><Plus size={16} />创建转发</Button></div></div>
    <div className="fm-metrics"><Metric icon={<Activity size={18} />} label="运行中转发" value={activeForwards.length} note={`共 ${forwards.length} 条`} /><Metric icon={<Route size={18} />} label="可用隧道" value={activeGrants.length} note={`共 ${grants.length} 份授权`} /><Metric icon={<Gauge size={18} />} label="本周期流量" value={formatBytes(totalUsed)} note={totalLimit ? `总额 ${formatBytes(totalLimit)}` : "当前授权不限总流量"} /><Metric icon={<ShieldCheck size={18} />} label="最近到期" value={nearestExpiry ? displayDate(nearestExpiry).split(" ")[0] : "长期"} note={nearestExpiry ? displayDate(nearestExpiry) : "没有固定到期时间"} /></div>
    <div className="fm-tabs" role="tablist" aria-label="用户转发视图"><button role="tab" aria-selected={tab === "forwards"} className={tab === "forwards" ? "is-active" : ""} onClick={() => setTab("forwards")}><Network size={16} />我的转发 <span>{forwards.length}</span></button><button role="tab" aria-selected={tab === "grants"} className={tab === "grants" ? "is-active" : ""} onClick={() => setTab("grants")}><Route size={16} />可用隧道 <span>{activeGrants.length}</span></button></div>
    {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}{loading ? <div className="center-state"><Spinner label="正在加载转发" /></div> : null}
    {!loading && tab === "forwards" ? <><ForwardTable forwards={forwards} templates={templates} onAction={runForwardAction} onCopy={copyEntry} onDelete={(forward) => setConfirm({ title: "删除转发", description: `将停止“${forward.name}”入口并清理每一跳端口。此操作无法撤销。`, confirmLabel: "确认删除", run: async () => { await api.delete(`/api/user/forwards/${encodeURIComponent(resourceID(forward))}`, undefined, { idempotencyKey: idempotencyKey() }); notify("转发删除任务已提交"); } })} />{!forwards.length && activeGrants.length ? <div className="fm-empty-action"><Button onClick={() => { setWizardGrantID(undefined); setWizard(true); }}><Plus size={16} />创建第一条转发</Button></div> : null}</> : null}
    {!loading && tab === "grants" ? <UserGrantCards grants={grants} onCreate={(grant) => { if ((grant.effective_state || grant.state || "active") !== "active") return; setWizardGrantID(String(resourceID(grant))); setWizard(true); }} /> : null}
    {wizard ? <ForwardWizard grants={activeGrants} initialGrantID={wizardGrantID} nodes={nodes.filter((node) => node.enabled)} onClose={() => { setWizard(false); setWizardGrantID(undefined); }} onComplete={async () => { setWizard(false); setWizardGrantID(undefined); notify("转发创建任务已提交"); setTab("forwards"); await load(true); }} /> : null}
    {confirm ? <ConfirmDialog title={confirm.title} description={confirm.description} confirmLabel={confirm.confirmLabel} working={working} onCancel={() => !working && setConfirm(null)} onConfirm={() => void runConfirmed()} /> : null}
  </section>;
}

function UserGrantCards({ grants, onCreate }: { grants: TunnelGrant[]; onCreate: (grant: TunnelGrant) => void }) {
  if (!grants.length) return <EmptyState icon={<Route size={25} />} title="暂无隧道授权" description="管理员授权后，可用路线会显示在这里" />;
  return <div className="fm-grant-grid">{grants.map((grant) => {
    const state = grant.effective_state || grant.state || (grant.enabled === false ? "suspended" : "active");
    const template = tunnelForGrant(grant, []);
    const usedPercent = grant.traffic_limit_bytes ? Math.min(100, (grantUsedBytes(grant) / grant.traffic_limit_bytes) * 100) : 0;
    return <article className="fm-grant-card" key={String(resourceID(grant))}><header><span><Route size={18} /><strong>{tunnelName(grant, [])}</strong></span><Badge tone={stateTone(state)}>{stateLabel(state)}</Badge></header>{template ? <RouteLine hops={routeHops(template).map((hop) => ({ name: hop.name }))} /> : null}<dl><div><dt>转发数量</dt><dd>{grantActiveForwards(grant)} / {grant.max_active_forwards}</dd></div><div><dt>每转发限速</dt><dd>{grant.per_forward_speed_mbps ? `${grant.per_forward_speed_mbps} Mbps` : "不限"}</dd></div><div><dt>连接数</dt><dd>{grant.per_forward_connection_limit || "不限"}</dd></div><div><dt>有效期</dt><dd>{displayDate(grant.expires_at)}</dd></div></dl><div className="fm-usage"><span><small>授权流量</small><strong>{formatBytes(grantUsedBytes(grant))} / {grant.traffic_limit_bytes ? formatBytes(grant.traffic_limit_bytes) : "不限"}</strong></span>{grant.traffic_limit_bytes ? <progress value={usedPercent} max="100" /> : null}</div><Button variant="secondary" disabled={state !== "active" || grantActiveForwards(grant) >= grant.max_active_forwards} onClick={() => onCreate(grant)}><Plus size={16} />使用此隧道创建</Button></article>;
  })}</div>;
}

function ForwardWizard({ grants, initialGrantID, nodes, onClose, onComplete }: { grants: TunnelGrant[]; initialGrantID?: string; nodes: NodeItem[]; onClose: () => void; onComplete: () => Promise<void> }) {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<ForwardDraft>({ grantID: grants.some((grant) => sameID(resourceID(grant), initialGrantID)) ? initialGrantID || "" : grants[0] ? String(resourceID(grants[0])) : "", targetNodeID: nodes[0] ? String(nodes[0].id) : "", name: "", requestedEntryPort: "", sourceCIDRs: "" });
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [working, setWorking] = useState<"preflight" | "create" | "">("");
  const [error, setError] = useState("");
  const grant = grants.find((item) => sameID(resourceID(item), draft.grantID));
  const grantTunnel = grant ? tunnelForGrant(grant, []) : undefined;
  const target = nodes.find((node) => String(node.id) === draft.targetNodeID);
  const sourceCIDRs = draft.sourceCIDRs.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
  const requestedEntryPort = Number(draft.requestedEntryPort) || 0;
  const requestedPortValid = !draft.requestedEntryPort || (Number.isInteger(requestedEntryPort) && requestedEntryPort >= 1024 && requestedEntryPort <= 65535);
  const stepValid = step === 1 ? Boolean(grant) : step === 2 ? Boolean(target) : step === 3 ? Boolean(draft.name.trim()) && requestedPortValid : Boolean(preflight && preflight.success !== false && preflight.ready !== false);
  const payload = () => ({ grant_id: draft.grantID, name: draft.name.trim(), target: { type: "managed_node", node_id: Number(draft.targetNodeID) }, network: "tcp_udp", requested_entry_port: requestedEntryPort, source_cidrs: sourceCIDRs });
  const update = <K extends keyof ForwardDraft>(key: K, value: ForwardDraft[K]) => { setDraft((current) => ({ ...current, [key]: value })); setPreflight(null); };
  const next = async () => {
    if (!stepValid || step >= 4) return;
    if (step < 3) { setStep((current) => current + 1); return; }
    setWorking("preflight"); setError("");
    try { const result = await api.post<unknown>("/api/user/forwards/preflight", payload(), { idempotencyKey: idempotencyKey() }); setPreflight(responseObject<PreflightResult>(result, "preflight", "result")); setStep(4); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "转发预检失败"); }
    finally { setWorking(""); }
  };
  const create = async () => {
    if (!stepValid || !preflight) return;
    setWorking("create"); setError("");
    try { await api.post("/api/user/forwards", payload(), { idempotencyKey: idempotencyKey() }); await onComplete(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "转发创建失败"); setWorking(""); }
  };
  return <Dialog title="创建用户转发" description="TCP 与 UDP 共用端口，并在路线上的每台服务器保持同一个端口号。" onClose={onClose} wide dismissible={!working}><div className="fm-wizard"><ol className="fm-steps" aria-label="创建转发步骤">{([[1, "选择隧道"], [2, "选择目标"], [3, "转发设置"], [4, "确认创建"]] as const).map(([number, label]) => <li key={number} className={step === number ? "is-active" : step > number ? "is-done" : ""}><span>{step > number ? <Check size={14} /> : number}</span><strong>{label}</strong></li>)}</ol>{error ? <ErrorState message={error} /> : null}
    <div className="fm-wizard-content">{step === 1 ? <div className="fm-choice-grid">{grants.map((item) => { const template = tunnelForGrant(item, []); return <button type="button" key={String(resourceID(item))} className={sameID(resourceID(item), draft.grantID) ? "is-active" : ""} onClick={() => update("grantID", String(resourceID(item)))}><span><Route size={19} /><strong>{tunnelName(item, [])}</strong></span>{template ? <RouteLine hops={routeHops(template).map((hop) => ({ name: hop.name }))} /> : null}<small>{item.per_forward_speed_mbps ? `${item.per_forward_speed_mbps} Mbps` : "不限速"} · {item.per_forward_connection_limit ? `${item.per_forward_connection_limit} 连接` : "不限连接"} · 至 {displayDate(item.expires_at)}</small></button>; })}</div> : null}
      {step === 2 ? <><div className="fm-target-types"><button type="button" className="is-active"><Server size={19} /><span><strong>受管节点</strong><small>从自己已有且可访问的节点中选择</small></span><Check size={16} /></button><button type="button" disabled><Network size={19} /><span><strong>自定义公网目标</strong><small>首版暂未开放</small></span></button></div>{nodes.length ? <Field label="最终目标节点"><select value={draft.targetNodeID} onChange={(event) => update("targetNodeID", event.target.value)}>{nodes.map((node) => <option key={node.id} value={node.id}>{node.node_name} · {node.protocol.toUpperCase()}</option>)}</select></Field> : <EmptyState icon={<Server size={24} />} title="没有可用受管节点" description="请先在节点管理中开通或导入符合条件的节点" />}</> : null}
      {step === 3 ? <div className="fm-form"><div className="fm-form-grid"><Field label="转发名称"><input autoFocus value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="例如：香港入口到美国 Reality" /></Field><Field label="网络类型"><select value="tcp_udp" disabled><option value="tcp_udp">TCP + UDP</option></select></Field></div><Field label="全链路端口（可选）" hint="例如 2033；留空时从模板范围自动选择共同空闲端口"><input type="number" min="1024" max="65535" value={draft.requestedEntryPort} onChange={(event) => update("requestedEntryPort", event.target.value)} placeholder="自动选择" /></Field><Field label="入口来源 CIDR 白名单（可选）" hint="每行或逗号分隔；留空时遵循隧道模板策略"><textarea rows={4} value={draft.sourceCIDRs} onChange={(event) => update("sourceCIDRs", event.target.value)} placeholder="例如：203.0.113.8/32" /></Field><div className="fm-capability-note"><ShieldCheck size={17} /><span>所有跳点使用同一个端口；未被实际转发使用的范围端口不会被预占，仍可用于节点。</span></div></div> : null}
      {step === 4 ? <div className="fm-review"><div className="fm-review-route"><span>固定路线</span>{grantTunnel ? <RouteLine hops={[...routeHops(grantTunnel).map((hop) => ({ name: hop.name })), { name: target?.node_name || "目标节点" }]} /> : <strong>{grant ? tunnelName(grant, []) : "已授权隧道"} → {target?.node_name}</strong>}</div><dl><div><dt>转发名称</dt><dd>{draft.name}</dd></div><div><dt>网络与入口</dt><dd>TCP + UDP · {requestedEntryPort ? `全链路端口 ${requestedEntryPort}` : "自动选择共同端口"}</dd></div><div><dt>最终目标</dt><dd>{target?.node_name}</dd></div><div><dt>有效期</dt><dd>{displayDate(preflight?.effective_expires_at || grant?.expires_at)}</dd></div><div><dt>每转发限速</dt><dd>{grant?.per_forward_speed_mbps ? `${grant.per_forward_speed_mbps} Mbps` : "不限"}</dd></div><div><dt>连接数</dt><dd>{grant?.per_forward_connection_limit || "不限"}</dd></div><div><dt>计费流量</dt><dd>仅入口统计一次</dd></div><div><dt>入口预览</dt><dd>{preflight?.entry_host || preflight?.entry_address ? `${preflight.entry_host || preflight.entry_address}:${preflight.entry_port || requestedEntryPort || "自动"}` : requestedEntryPort ? `创建后使用 ${requestedEntryPort}` : "创建后由系统分配"}</dd></div></dl><div className={`fm-preflight ${preflight?.success === false || preflight?.ready === false ? "is-bad" : "is-good"}`}><ShieldCheck size={18} /><span><strong>{preflight?.success === false || preflight?.ready === false ? "预检未通过" : "转发预检通过"}</strong><small>{preflight?.message || "授权、目标、路线和端口资源均满足创建条件"}</small>{preflight?.warnings?.map((warning) => <small key={warning}>{warning}</small>)}</span></div></div> : null}</div>
    <div className="dialog-actions"><Button type="button" variant="secondary" disabled={Boolean(working)} onClick={step === 1 ? onClose : () => setStep((current) => current - 1)}>{step === 1 ? "取消" : "上一步"}</Button>{step < 4 ? <Button type="button" disabled={!stepValid || Boolean(working)} onClick={() => void next()}>{working === "preflight" ? <Spinner label="正在预检" /> : <>下一步<ArrowRight size={16} /></>}</Button> : <Button type="button" disabled={!stepValid || Boolean(working)} onClick={() => void create()}>{working === "create" ? <Spinner label="正在创建" /> : <><Check size={16} />确认创建</>}</Button>}</div>
  </div></Dialog>;
}
