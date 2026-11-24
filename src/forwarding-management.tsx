import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  ArrowDown,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  Check,
  CirclePause,
  CirclePlay,
  Copy,
  Gauge,
  Globe,
  Info,
  Laptop,
  Network,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Search,
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
import { PortCheckHint, isPortCheckBlocking, useDebouncedPortCheck } from "./port-check";
import { isPackageAuthorization } from "./user-authorization";
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
  PageHeader,
  Spinner,
  Surface,
  formatBytes,
} from "./ui";
import "./forwarding-management.css";

type Notify = (message: string, tone?: "success" | "error") => void;
type AdminTab = "templates" | "grants" | "my-forwards" | "forwards";
type UserTab = "forwards" | "grants";
type ResourceID = string | number;
type AdminLoadSection = "general" | "templates" | "servers" | "users" | "forwards" | "my-forwards" | "grants";

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

export interface TunnelTemplateGroup {
  id: ResourceID;
  key: string;
  name: string;
  description?: string;
  isBidirectional: boolean;
  primary: TunnelTemplate;
  partner?: TunnelTemplate;
  templates: TunnelTemplate[];
  hops: Array<{ id: number; name: string; status?: string }>;
  billing_mode?: ForwardingBillingMode;
  traffic_multiplier_milli?: number;
  port_range_start?: number;
  port_range_end?: number;
  max_total_forwards: number;
  active_forwards: number;
  grant_count: number;
  state: string;
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
  listen_port?: number;
  target_port?: number;
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
  source_cidrs?: string[];
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
  trafficGB: string;
  billingMode: ForwardingBillingMode;
}

interface TemplateDraft {
  name: string;
  description: string;
  directionMode: "single" | "bidirectional";
  serverIDs: number[];
  billingMode: ForwardingBillingMode;
  multiplier: string;
  maxForwards: string;
  portStart: string;
  portEnd: string;
}

interface ForwardDraft {
  grantID: string;
  targetType: "managed_node" | "custom";
  targetNodeID: string;
  customHost: string;
  customPort: string;
  name: string;
  requestedEntryPort: string;
  sourceCIDRs: string;
}

export interface ForwardingManagementProps {
  isAdmin: boolean;
  notify: Notify;
  currentUsername?: string;
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

export function resourceID(item: { id: ResourceID; public_id?: string }): ResourceID {
  return item.public_id || item.id;
}

export function sameID(left: ResourceID | null | undefined, right: ResourceID | null | undefined): boolean {
  return left !== null && left !== undefined && right !== null && right !== undefined && String(left) === String(right);
}

export function idempotencyKey(): string {
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

export function stateLabel(state?: string): string {
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

export function stateTone(state?: string): "good" | "warn" | "bad" | "info" | "neutral" {
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

export function isReverseHops(
  leftHops: Array<{ id: number; name: string }>,
  rightHops: Array<{ id: number; name: string }>
): boolean {
  if (leftHops.length < 2 || leftHops.length !== rightHops.length) {
    return false;
  }
  const len = leftHops.length;
  for (let i = 0; i < len; i++) {
    const left = leftHops[i];
    const right = rightHops[len - 1 - i];
    const matchId = Boolean(left.id && right.id && left.id === right.id);
    const matchName = Boolean(left.name && right.name && left.name === right.name);
    if (!matchId && !matchName) {
      return false;
    }
  }
  return true;
}

export function groupTunnelTemplates(
  templates: TunnelTemplate[],
  servers: RemoteServer[] = []
): TunnelTemplateGroup[] {
  const groups: TunnelTemplateGroup[] = [];
  const used = new Set<string>();

  for (let i = 0; i < templates.length; i++) {
    const primary = templates[i];
    const primaryID = String(resourceID(primary));
    if (used.has(primaryID)) continue;

    const primaryHops = routeHops(primary, servers);
    let partner: TunnelTemplate | undefined;

    if (primaryHops.length >= 2) {
      for (let j = i + 1; j < templates.length; j++) {
        const candidate = templates[j];
        const candidateID = String(resourceID(candidate));
        if (used.has(candidateID)) continue;

        if (primary.name.trim() === candidate.name.trim()) {
          const candidateHops = routeHops(candidate, servers);
          if (isReverseHops(primaryHops, candidateHops)) {
            partner = candidate;
            used.add(candidateID);
            break;
          }
        }
      }
    }

    used.add(primaryID);

    const isBidirectional = Boolean(partner);
    const templatesInGroup = partner ? [primary, partner] : [primary];

    let groupState = primary.state;
    if (partner) {
      if (primary.state === "suspended" || partner.state === "suspended") {
        groupState = "suspended";
      } else if (primary.state === "draining" || partner.state === "draining") {
        groupState = "draining";
      } else {
        groupState = "active";
      }
    }

    const activeForwards = (primary.active_forwards ?? 0) + (partner?.active_forwards ?? 0);
    const maxTotalForwards = (primary.max_total_forwards ?? 0) + (partner?.max_total_forwards ?? 0);
    const grantCount = (primary.grant_count ?? 0) + (partner?.grant_count ?? 0);

    groups.push({
      id: resourceID(primary),
      key: partner ? `${primaryID}-${String(resourceID(partner))}` : primaryID,
      name: primary.name,
      description: primary.description || partner?.description,
      isBidirectional,
      primary,
      partner,
      templates: templatesInGroup,
      hops: primaryHops,
      billing_mode: primary.billing_mode,
      traffic_multiplier_milli: primary.traffic_multiplier_milli,
      port_range_start: primary.port_range_start,
      port_range_end: primary.port_range_end,
      max_total_forwards: maxTotalForwards,
      active_forwards: activeForwards,
      grant_count: grantCount,
      state: groupState,
    });
  }

  return groups;
}

export function tunnelForGrant(grant: TunnelGrant, templates: TunnelTemplate[]): TunnelTemplate | undefined {
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

export function forwardState(forward: ForwardRule): string {
  return forward.observed_state || forward.state || forward.desired_state || "pending";
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    return success;
  } catch {
    return false;
  }
}

export function forwardEntry(
  forward: ForwardRule,
  servers: RemoteServer[] = [],
  templates: TunnelTemplate[] = [],
): { host: string; port: number } {
  let host = forward.entry_host || forward.entry_address || forward.entry?.host || forward.entry?.address || "";
  if (!host && servers.length) {
    if (forward.hops?.length) {
      const server = servers.find((s) => s.id === forward.hops![0].server_id);
      if (server) {
        host = server.ip_address || server.domain || "";
      }
    }
    if (!host) {
      const t = forward.tunnel || templates.find((item) => sameID(resourceID(item), forward.tunnel_id));
      if (t?.hops?.length) {
        const firstHopServerID = t.hops[0].server_id;
        const server = servers.find((s) => s.id === firstHopServerID);
        if (server) {
          host = server.ip_address || server.domain || "";
        }
      }
    }
  }
  const port = Number(
    forward.allocated_entry_port ||
      forward.entry_port ||
      forward.entry?.port ||
      forward.hops?.[0]?.listen_port ||
      forward.requested_entry_port ||
      0,
  );
  return { host, port };
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
    directionMode: "single",
    serverIDs: [],
    billingMode: "both",
    multiplier: "1",
    maxForwards: "0",
    portStart: "1024",
    portEnd: "65535",
  };
}

function templateDraftFrom(group: TunnelTemplateGroup): TemplateDraft {
  const hops = group.hops || [];
  let serverIDs = hops.map((hop) => hop.id).filter((id): id is number => typeof id === "number" && id > 0);
  if (!serverIDs.length && Array.isArray(group.primary.hops)) {
    serverIDs = group.primary.hops.map((h) => h.server_id).filter((id): id is number => typeof id === "number" && id > 0);
  }
  if (!serverIDs.length && Array.isArray(group.primary.server_ids)) {
    serverIDs = [...group.primary.server_ids];
  }
  return {
    name: group.name,
    description: group.description || "",
    directionMode: group.isBidirectional ? "bidirectional" : "single",
    serverIDs,
    billingMode: (group.billing_mode as TemplateDraft["billingMode"]) || "both",
    multiplier: group.traffic_multiplier_milli ? (group.traffic_multiplier_milli / 1000).toString() : "1",
    maxForwards: group.primary.max_total_forwards ? String(group.primary.max_total_forwards) : "0",
    portStart: String(group.port_range_start || 1024),
    portEnd: String(group.port_range_end || 65535),
  };
}

function defaultGrantDraft(users: UserItem[], templates: TunnelTemplate[]): GrantDraft {
  const firstCustomUser = users.find((user) => {
    return user.role !== "admin" && !isPackageAuthorization(user);
  }) || users.find((user) => !isPackageAuthorization(user));
  return {
    username: firstCustomUser?.username || "",
    tunnelID: templates[0] ? String(resourceID(templates[0])) : "",
    startsAt: datetimeLocal(),
    expiresAt: futureLocal(30),
    maxForwards: "1",
    speedMbps: "0",
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
    trafficGB: String((Number(grant.traffic_limit_bytes || 0) / 1024 ** 3) || 0),
    billingMode: normalizeForwardingBillingMode(grant.billing_mode_override, template?.billing_mode),
  };
}

export function ForwardingManagement({ isAdmin, notify, currentUsername = "admin" }: ForwardingManagementProps) {
  return isAdmin ? <AdminForwarding notify={notify} currentUsername={currentUsername} /> : <UserForwarding notify={notify} />;
}

function AdminForwarding({ notify, currentUsername = "admin" }: { notify: Notify; currentUsername?: string }) {
  const [tab, setTab] = useState<AdminTab>("templates");
  const [templates, setTemplates] = useState<TunnelTemplate[]>([]);
  const [grants, setGrants] = useState<TunnelGrant[]>([]);
  const [forwards, setForwards] = useState<ForwardRule[]>([]);
  const [servers, setServers] = useState<RemoteServer[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<Partial<Record<AdminLoadSection, string>>>({});
  const [dialog, setDialog] = useState<"template" | "grant" | null>(null);
  const [wizard, setWizard] = useState(false);
  const [wizardGrantID, setWizardGrantID] = useState<string | undefined>();
  const [editingGrant, setEditingGrant] = useState<TunnelGrant | undefined>();
  const [editingTemplate, setEditingTemplate] = useState<TunnelTemplateGroup | undefined>();
  const [editingForward, setEditingForward] = useState<ForwardRule | undefined>();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const nextErrors: Partial<Record<AdminLoadSection, string>> = {};
    try {
      const [templateResult, serverResult, userResult, forwardResult, nodeResult] = await Promise.allSettled([
        api.get<unknown>("/api/admin/tunnel-templates"),
        api.get<ServerListResponse | RemoteServer[]>("/api/admin/remote-servers"),
        api.get<unknown>("/api/admin/users"),
        api.get<unknown>("/api/admin/forwards"),
        api.get<unknown>("/api/user/nodes"),
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
      if (nodeResult.status === "fulfilled") {
        setNodes(extractList<NodeItem>(nodeResult.value, "nodes"));
      }

      if (userResult.status === "fulfilled") {
        const nextUsers = extractList<UserItem>(userResult.value, "users");
        const grantUsers = [...new Map(nextUsers.filter((user) => user.username && user.username !== "admin" && user.role !== "admin").map((user) => [user.username, user])).values()];
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
            if (result.status === "rejected") return (currentByUsername.get(username) ?? []).filter((g) => g.username !== "admin");
            return extractList<TunnelGrant>(result.value, "grants", "tunnel_grants")
              .filter((g) => g.username !== "admin")
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
      await load(true);
    } finally {
      setWorking(false);
    }
  };

  const changeTemplateGroupState = async (group: TunnelTemplateGroup, state: string) => {
    for (const template of group.templates) {
      await api.put(`/api/admin/tunnel-templates/${encodeURIComponent(resourceID(template))}/state`, { state, version: template.version ?? 1 }, { idempotencyKey: idempotencyKey() });
    }
    const label = group.isBidirectional ? "双向隧道" : "隧道";
    notify(state === "active" ? `${label}已恢复运行` : state === "draining" ? `${label}已停止新建` : `${label}已紧急停用`);
    await load(true);
  };

  const deleteTemplateGroup = (group: TunnelTemplateGroup) => {
    if (group.isBidirectional) {
      setConfirm({
        title: "删除双向隧道模板",
        description: `将同时删除“${group.name}”的正反两条隧道模板。存在转发时后端会拒绝删除，不会留下未托管配置。`,
        confirmLabel: "确认删除",
        run: async () => {
          for (const template of group.templates) {
            await api.delete(`/api/admin/tunnel-templates/${encodeURIComponent(resourceID(template))}`, undefined, { idempotencyKey: idempotencyKey() });
          }
          notify("双向隧道模板已删除");
        },
      });
    } else {
      setConfirm({
        title: "删除隧道模板",
        description: `将删除“${group.name}”。存在转发时后端会拒绝删除，不会留下未托管配置。`,
        confirmLabel: "确认删除",
        run: async () => {
          await api.delete(`/api/admin/tunnel-templates/${encodeURIComponent(resourceID(group.primary))}`, undefined, { idempotencyKey: idempotencyKey() });
          notify("隧道模板已删除");
        },
      });
    }
  };

  const runForwardAction = async (forward: ForwardRule, action: "suspend" | "resume" | "retry") => {
    await api.post(`/api/admin/forwards/${encodeURIComponent(resourceID(forward))}/${action}`, {}, { idempotencyKey: idempotencyKey() });
    notify(action === "suspend" ? "转发已暂停" : action === "resume" ? "转发恢复任务已提交" : "已重新下发转发");
    await load(true);
  };

  const runMyForwardAction = async (forward: ForwardRule, action: "suspend" | "resume" | "retry") => {
    await api.post(`/api/user/forwards/${encodeURIComponent(resourceID(forward))}/${action}`, {}, { idempotencyKey: idempotencyKey() });
    notify(action === "suspend" ? "转发已暂停" : action === "resume" ? "转发恢复任务已提交" : "转发重试任务已提交");
    await load(true);
  };

  const copyEntry = async (forward: ForwardRule) => {
    const entry = forwardEntry(forward, servers, templates);
    if (!entry.host || !entry.port) {
      notify("入口尚未生成，请稍后重试", "error");
      return;
    }
    const text = `${entry.host}:${entry.port}`;
    const ok = await copyToClipboard(text);
    if (ok) {
      notify(`入口已复制：${text}`);
    } else {
      notify(`复制受限，入口地址为：${text}`);
    }
  };

  const myForwards = useMemo(() => forwards.filter((forward) => forward.username === currentUsername), [forwards, currentUsername]);
  const activeAdminGrants = useMemo(() => {
    const activeTemplates = templates.filter((t) => (t.state || "active") === "active");
    return activeTemplates.map((t) => ({
      id: `admin_auto_${resourceID(t)}`,
      public_id: `admin_auto_${resourceID(t)}`,
      username: currentUsername || "admin",
      tunnel_id: resourceID(t),
      tunnel: t,
      enabled: true,
      effective_state: "active" as const,
      state: "active",
      starts_at: new Date().toISOString(),
      expires_at: null,
      max_active_forwards: 1000,
      per_forward_speed_mbps: 0,
      per_forward_connection_limit: 0,
      traffic_limit_bytes: 0,
      billing_mode_override: "both" as const,
      source_type: "manual" as const,
    }));
  }, [templates, currentUsername]);

  const openCreateForward = async (initialTemplateOrGrantID?: ResourceID) => {
    const activeTemplates = templates.filter((t) => (t.state || "active") === "active");
    if (!activeTemplates.length) {
      notify("请先创建并启用隧道模板", "error");
      return;
    }

    setWorking(true);

    // Ensure nodes are loaded
    if (!nodes.length) {
      try {
        const nodeData = await api.get<unknown>("/api/user/nodes");
        const loadedNodes = extractList<NodeItem>(nodeData, "nodes");
        setNodes(loadedNodes);
      } catch (err) {
        console.warn("Failed to load user nodes", err);
      }
    }

    setWorking(false);

    let grantIDToSelect: string | undefined = undefined;
    if (initialTemplateOrGrantID) {
      const matched = activeAdminGrants.find((g) => sameID(resourceID(g), initialTemplateOrGrantID) || sameID(g.tunnel_id, initialTemplateOrGrantID));
      if (matched) {
        grantIDToSelect = String(resourceID(matched));
      }
    }

    setWizardGrantID(grantIDToSelect);
    setWizard(true);
  };

  const templateGroups = useMemo(() => groupTunnelTemplates(templates, servers), [templates, servers]);

  const visibleLoadErrors = (tab === "templates"
    ? [loadErrors.general, loadErrors.templates, loadErrors.servers]
    : tab === "grants"
      ? [loadErrors.general, loadErrors.users, loadErrors.grants, loadErrors.templates]
      : tab === "my-forwards"
        ? [loadErrors.general, loadErrors.forwards, loadErrors.templates]
        : [loadErrors.general, loadErrors.forwards, loadErrors.templates])
    .filter((message): message is string => Boolean(message));

  return <section className="fm-root" aria-label="转发管理">
    <PageHeader
      title="转发管理"
      description="由管理员编排服务器路线，再按用户授权创建转发。"
      actions={
        <div className="fm-heading-actions">
          <IconButton label="刷新转发管理数据" disabled={loading} onClick={() => void load()}><RefreshCw size={18} /></IconButton>
          <Button onClick={() => void openCreateForward()}><Plus size={17} />创建转发</Button>
        </div>
      }
    />

    <div className="fm-metrics" aria-label="转发运行摘要">
      <Metric icon={<Route size={18} />} label="隧道模板" value={templateGroups.length} note={`${templateGroups.filter((item) => item.state === "active").length} 条可新建`} />
      <Metric icon={<ShieldCheck size={18} />} label="用户授权" value={grants.length} note={`${grants.filter((item) => (item.effective_state || item.state) === "active").length} 份生效`} />
      <Metric icon={<UserRound size={18} />} label="我的转发" value={myForwards.length} note={`${myForwards.filter((item) => forwardState(item) === "active").length} 条运行中`} />
      <Metric icon={<Network size={18} />} label="全部转发" value={forwards.length} note={`${forwards.filter((item) => forwardState(item) === "active").length} 条运行中`} />
    </div>

    <div className="fm-tabs" role="tablist" aria-label="管理员转发视图">
      <button role="tab" aria-selected={tab === "templates"} className={tab === "templates" ? "is-active" : ""} onClick={() => setTab("templates")}><Route size={16} />隧道模板 <span>{templateGroups.length}</span></button>
      <button role="tab" aria-selected={tab === "grants"} className={tab === "grants" ? "is-active" : ""} onClick={() => setTab("grants")}><ShieldCheck size={16} />用户授权 <span>{grants.length}</span></button>
      <button role="tab" aria-selected={tab === "my-forwards"} className={tab === "my-forwards" ? "is-active" : ""} onClick={() => setTab("my-forwards")}><UserRound size={16} />我的转发 <span>{myForwards.length}</span></button>
      <button role="tab" aria-selected={tab === "forwards"} className={tab === "forwards" ? "is-active" : ""} onClick={() => setTab("forwards")}><Network size={16} />全部转发 <span>{forwards.length}</span></button>
    </div>

    {visibleLoadErrors.length ? <ErrorState message={`部分数据未能刷新：${visibleLoadErrors.join("；")}。已保留其余成功数据，可继续操作。`} onRetry={() => void load(true)} /> : null}
    {loading ? <div className="center-state"><Spinner label="正在加载转发管理" /></div> : null}
    {!loading && tab === "templates" ? <TemplatePanel groups={templateGroups} servers={servers} onCreate={() => { setEditingTemplate(undefined); setDialog("template"); }} onEdit={(group) => { setEditingTemplate(group); setDialog("template"); }} onCreateForward={(group) => { void openCreateForward(resourceID(group.primary)); }} onState={changeTemplateGroupState} onDelete={deleteTemplateGroup} /> : null}
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
    {!loading && tab === "my-forwards" ? (
      <>
        <ForwardTable
          forwards={myForwards}
          templates={templates}
          servers={servers}
          onAction={runMyForwardAction}
          onCopy={copyEntry}
          onEdit={setEditingForward}
          onDelete={(forward) => setConfirm({
            title: "删除转发",
            description: `将切断“${forward.name}”的入口并清理各跳端口。此操作无法撤销。`,
            confirmLabel: "确认删除",
            run: async () => {
              await api.delete(`/api/user/forwards/${encodeURIComponent(resourceID(forward))}`, undefined, { idempotencyKey: idempotencyKey() });
              notify("转发删除任务已提交");
            },
          })}
        />
        {!myForwards.length ? (
          <div className="fm-empty-action">
            <Button onClick={() => void openCreateForward()}><Plus size={17} />创建第一条转发</Button>
          </div>
        ) : null}
      </>
    ) : null}
    {!loading && tab === "forwards" ? (
      <ForwardTable
        admin
        forwards={forwards}
        templates={templates}
        servers={servers}
        onAction={runForwardAction}
        onCopy={copyEntry}
        onEdit={setEditingForward}
        onDelete={(forward) => setConfirm({
          title: "删除用户转发",
          description: `将切断“${forward.name}”的入口并逐跳清理远端资源。离线服务器会进入等待清理状态。`,
          confirmLabel: "确认删除",
          run: async () => {
            await api.delete(`/api/admin/forwards/${encodeURIComponent(resourceID(forward))}`, undefined, { idempotencyKey: idempotencyKey() });
            notify("转发删除任务已提交");
          },
        })}
      />
    ) : null}

    {editingForward ? (
      <ForwardEditDialog
        admin
        forward={editingForward}
        nodes={nodes.filter((node) => node.enabled)}
        servers={servers}
        templates={templates}
        onClose={() => setEditingForward(undefined)}
        onComplete={async () => {
          setEditingForward(undefined);
          notify("转发已更新");
          await load(true);
        }}
      />
    ) : null}

    {dialog === "template" ? <TemplateDialog templateGroup={editingTemplate} servers={servers} onClose={() => { setDialog(null); setEditingTemplate(undefined); }} onComplete={async () => { setDialog(null); notify(editingTemplate ? (editingTemplate.isBidirectional ? "双向隧道已更新" : "隧道模板已更新") : "隧道模板已创建"); setEditingTemplate(undefined); await load(true); }} /> : null}
    {dialog === "grant" ? <GrantDialog grant={editingGrant} users={users} templates={templates} servers={servers} onClose={() => setDialog(null)} onComplete={async () => { setDialog(null); notify(editingGrant ? "隧道授权已更新" : "隧道授权已创建"); await load(true); }} /> : null}
    {wizard ? (
      <ForwardWizard
        grants={activeAdminGrants}
        initialGrantID={wizardGrantID}
        nodes={nodes.filter((node) => node.enabled)}
        templates={templates}
        onClose={() => {
          setWizard(false);
          setWizardGrantID(undefined);
        }}
        onComplete={async () => {
          setWizard(false);
          setWizardGrantID(undefined);
          notify("转发创建任务已提交");
          setTab("my-forwards");
          await load(true);
        }}
      />
    ) : null}
    {confirm ? <ConfirmDialog title={confirm.title} description={confirm.description} confirmLabel={confirm.confirmLabel} working={working} onCancel={() => !working && setConfirm(null)} onConfirm={() => void runConfirmed()} /> : null}
  </section>;
}

function Metric({ icon, label, value, note }: { icon: ReactNode; label: string; value: ReactNode; note: string }) {
  return <div className="fm-metric"><span className="fm-metric-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong><span>{note}</span></div></div>;
}

function TemplatePanel({ groups, servers, onCreate, onEdit, onCreateForward, onState, onDelete }: {
  groups: TunnelTemplateGroup[];
  servers: RemoteServer[];
  onCreate: () => void;
  onEdit: (group: TunnelTemplateGroup) => void;
  onCreateForward?: (group: TunnelTemplateGroup) => void;
  onState: (group: TunnelTemplateGroup, state: string) => Promise<void>;
  onDelete: (group: TunnelTemplateGroup) => void;
}) {
  const [workingKey, setWorkingKey] = useState<string | null>(null);
  const changeState = async (group: TunnelTemplateGroup, state: string) => {
    setWorkingKey(group.key);
    try { await onState(group, state); } finally { setWorkingKey(null); }
  };
  return <div className="fm-panel">
    <div className="fm-toolbar"><div><strong>隧道模板</strong><span>服务器顺序由管理员固定，用户无法修改路线。</span></div><Button onClick={onCreate}><Plus size={17} />创建隧道</Button></div>
    {groups.length === 0 ? <EmptyState icon={<Route size={25} />} title="暂无隧道模板" description="先选择 1 至 8 台在线受管服务器创建路线" action={<Button onClick={onCreate}><Plus size={17} />创建第一条隧道</Button>} /> : <Surface className="table-surface fm-table-surface"><div className="table-wrap"><table className="fm-table"><thead><tr><th>隧道</th><th>服务器路线</th><th>策略</th><th>使用情况</th><th>状态</th><th aria-label="操作" /></tr></thead><tbody>{groups.map((group) => {
      const hops = group.hops;
      const id = group.id;
      const isWorking = workingKey === group.key;
      return <tr key={group.key}><td className="fm-primary-cell"><div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><strong>{group.name}</strong>{group.isBidirectional ? <Badge tone="info">双向</Badge> : null}</div>{group.description ? <small>{group.description}</small> : null}</td><td><RouteLine hops={hops.map((hop) => ({ name: hop.name, tone: hop.status && ["online", "connected"].includes(hop.status) ? "good" : undefined }))} bidirectional={group.isBidirectional} /><small className="fm-cell-note">{hops.length} 跳 · {group.isBidirectional ? "双向 · " : ""}TCP + UDP</small></td><td><span>{forwardingBillingModeLabel(group.billing_mode)}</span><small className="fm-cell-note">{((group.traffic_multiplier_milli ?? 1000) / 1000).toFixed(2)} 倍 · {group.port_range_start || "-"}–{group.port_range_end || "-"}</small></td><td><span>{group.max_total_forwards ? `${group.active_forwards}/${group.max_total_forwards} 条转发` : "不限制"}</span><small className="fm-cell-note">{group.grant_count} 份授权</small></td><td><Badge tone={stateTone(group.state)}>{stateLabel(group.state)}</Badge></td><td><div className="fm-row-actions">{onCreateForward ? <IconButton label={`使用 ${group.name} 创建转发`} disabled={isWorking || group.state !== "active"} onClick={() => onCreateForward(group)}><Plus size={18} /></IconButton> : null}<IconButton label={`编辑 ${group.name}`} disabled={isWorking} onClick={() => onEdit(group)}><Pencil size={18} /></IconButton>{group.state !== "active" ? <IconButton label={`恢复 ${group.name}`} disabled={isWorking} onClick={() => void changeState(group, "active")}><CirclePlay size={18} /></IconButton> : <IconButton label={`停止 ${group.name} 新建`} disabled={isWorking} onClick={() => void changeState(group, "draining")}><CirclePause size={18} /></IconButton>}<IconButton label={`删除 ${group.name}`} disabled={isWorking} onClick={() => onDelete(group)}><Trash2 size={18} /></IconButton></div></td></tr>;
    })}</tbody></table></div></Surface>}
  </div>;
}

function RouteLine({ hops, bidirectional = false }: { hops: Array<{ name: string; tone?: "good" | "warn" }>; bidirectional?: boolean }) {
  return <div className="fm-route-line">{hops.map((hop, index) => <span key={`${hop.name}-${index}`}><span className={`fm-hop ${hop.tone ? `is-${hop.tone}` : ""}`} title={hop.name}>{hop.name}</span>{index < hops.length - 1 ? (bidirectional ? <ArrowLeftRight size={16} /> : <ArrowRight size={16} />) : null}</span>)}</div>;
}

function TemplateDialog({ templateGroup, servers, onClose, onComplete }: { templateGroup?: TunnelTemplateGroup; servers: RemoteServer[]; onClose: () => void; onComplete: () => Promise<void> }) {
  const eligible = servers.filter((server) => !server.is_federated);
  const [draft, setDraft] = useState<TemplateDraft>(() => templateGroup ? templateDraftFrom(templateGroup) : defaultTemplateDraft());
  const [nextServer, setNextServer] = useState(String(eligible[0]?.id || ""));
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState<"preflight" | "create" | "update" | "">("");
  const selectedServers = draft.serverIDs.map((id) => eligible.find((server) => server.id === id)).filter((server): server is RemoteServer => Boolean(server));
  const available = eligible.filter((server) => !draft.serverIDs.includes(server.id));
  const portStart = Number(draft.portStart);
  const portEnd = Number(draft.portEnd);
  const validPorts = Number.isInteger(portStart) && Number.isInteger(portEnd) && portStart >= 1024 && portEnd <= 65535 && portStart <= portEnd;
  const isBidirectional = draft.directionMode === "bidirectional";
  const hasMinBidirectionalServers = draft.serverIDs.length >= 2;
  const reverseServerIDs = useMemo(() => [...draft.serverIDs].reverse(), [draft.serverIDs]);

  const validHops = isBidirectional ? hasMinBidirectionalServers : draft.serverIDs.length >= 1;
  const valid = draft.name.trim().length > 0 && validHops && draft.serverIDs.length <= 8 && validPorts && Number(draft.multiplier) > 0;

  const payload = (reverse = false, template?: TunnelTemplate) => ({
    name: draft.name.trim(),
    description: draft.description.trim(),
    state: template?.state || "active",
    billing_mode: draft.billingMode,
    traffic_multiplier_milli: Math.round(Number(draft.multiplier) * 1000),
    max_total_forwards: Math.max(0, Number(draft.maxForwards) || 0),
    port_range_start: Number(draft.portStart),
    port_range_end: Number(draft.portEnd),
    server_ids: reverse ? reverseServerIDs : draft.serverIDs,
    ...(template ? { version: template.version ?? 1 } : {}),
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
      const response = await api.post<unknown>("/api/admin/tunnel-templates/preflight", payload(false), { idempotencyKey: idempotencyKey() });
      const forwardResult = responseObject<PreflightResult>(response, "preflight", "result");
      if (forwardResult.success === false || forwardResult.ready === false) {
        setPreflight(forwardResult);
        return;
      }
      if (isBidirectional && hasMinBidirectionalServers) {
        const reverseResponse = await api.post<unknown>("/api/admin/tunnel-templates/preflight", payload(true), { idempotencyKey: idempotencyKey() });
        const reverseResult = responseObject<PreflightResult>(reverseResponse, "preflight", "result");
        if (reverseResult.success === false || reverseResult.ready === false) {
          setPreflight({
            ...reverseResult,
            message: `反向路线预检未通过: ${reverseResult.message || "请检查反向跳点服务器状态"}`,
          });
          return;
        }
        setPreflight({
          ...forwardResult,
          message: "路线预检通过（正反双向均已验证可用）",
        });
      } else {
        setPreflight(forwardResult);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "隧道预检失败"); }
    finally { setWorking(""); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    if (!templateGroup && (!preflight || preflight.success === false || preflight.ready === false)) return;
    setWorking(templateGroup ? "update" : "create"); setError("");
    try {
      if (templateGroup) {
        await api.put(`/api/admin/tunnel-templates/${encodeURIComponent(resourceID(templateGroup.primary))}`, payload(false, templateGroup.primary), { idempotencyKey: idempotencyKey() });
        if (templateGroup.isBidirectional && templateGroup.partner) {
          await api.put(`/api/admin/tunnel-templates/${encodeURIComponent(resourceID(templateGroup.partner))}`, payload(true, templateGroup.partner), { idempotencyKey: idempotencyKey() });
        }
      } else {
        await api.post("/api/admin/tunnel-templates", payload(false), { idempotencyKey: idempotencyKey() });
        if (isBidirectional && hasMinBidirectionalServers) {
          await api.post("/api/admin/tunnel-templates", payload(true), { idempotencyKey: idempotencyKey() });
        }
      }
      await onComplete();
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : (templateGroup ? "隧道修改失败" : "隧道创建失败")); setWorking(""); }
  };
  return <Dialog title={templateGroup ? (templateGroup.isBidirectional ? "编辑双向隧道" : "编辑隧道模板") : "创建隧道模板"} description={templateGroup ? "修改隧道名称、服务器路线、倍率与端口范围等配置。" : "按真实流量方向，从入口到出口排列 1 至 8 台服务器。"} onClose={onClose} wide dismissible={!working}>
    <form className="fm-form" onSubmit={(event) => void submit(event)}>
      {error ? <ErrorState message={error} /> : null}
      <div className="fm-form-grid"><Field label="隧道名称"><input required value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="例如：香港-日本-洛杉矶" /></Field><Field label="备注"><input value={draft.description} onChange={(event) => update("description", event.target.value)} placeholder="用途或线路说明" /></Field></div>
      <fieldset className="fm-route-editor"><legend>服务器路线</legend><div className="fm-route-add"><Field label="添加受管服务器"><select value={nextServer} onChange={(event) => setNextServer(event.target.value)} disabled={!available.length || draft.serverIDs.length >= 8}><option value="">选择服务器</option>{available.map((server) => <option key={server.id} value={server.id}>{server.name} · {isServerOnline(server) ? "在线" : "离线"}</option>)}</select></Field><Button type="button" variant="secondary" onClick={addServer} disabled={!nextServer || draft.serverIDs.length >= 8}><Plus size={17} />加入路线</Button></div>
        {selectedServers.length ? <ol className="fm-route-editor-list">{selectedServers.map((server, index) => <li key={server.id}><span className="fm-hop-index">{index + 1}</span><span><strong>{server.name}</strong><small>{index === 0 ? "入口服务器" : index === selectedServers.length - 1 ? "出口服务器" : `中转第 ${index} 跳`} · {isServerOnline(server) ? "Agent 在线" : "Agent 离线"}</small></span><div><IconButton type="button" label={`上移 ${server.name}`} disabled={index === 0} onClick={() => moveServer(index, -1)}><ArrowUp size={16} /></IconButton><IconButton type="button" label={`下移 ${server.name}`} disabled={index === selectedServers.length - 1} onClick={() => moveServer(index, 1)}><ArrowDown size={16} /></IconButton><IconButton type="button" label={`移除 ${server.name}`} onClick={() => update("serverIDs", draft.serverIDs.filter((id) => id !== server.id))}><X size={16} /></IconButton></div></li>)}</ol> : <EmptyState icon={<Server size={22} />} title="尚未选择服务器" description="第一台为用户入口，最后一台连接目标节点" />}
      </fieldset>
      <Field
        label="路线方向"
        hint={
          templateGroup
            ? (templateGroup.isBidirectional ? "双向对称模式（正反镜像将同步修改保存）" : "单向隧道模式")
            : (isBidirectional
              ? (hasMinBidirectionalServers
                ? "将同时创建正向与反向两条独立隧道模板（共用相同名称）"
                : "双向对称模式至少需要添加 2 台服务器（用于首尾互换）")
              : "单向：仅从首台到末台")
        }
      >
        <select
          value={draft.directionMode}
          disabled={Boolean(templateGroup)}
          onChange={(event) => update("directionMode", event.target.value as TemplateDraft["directionMode"])}
        >
          <option value="single">单向隧道（仅从首台到末台）</option>
          <option value="bidirectional">双向对称（一键同时生成反向镜像）</option>
        </select>
      </Field>
      <div className="fm-form-grid fm-form-grid-four"><Field label="计费方向"><select value={draft.billingMode} onChange={(event) => update("billingMode", event.target.value as TemplateDraft["billingMode"])}><option value="both">双向</option><option value="upload">仅算上行</option><option value="download">仅算下行</option></select></Field><Field label="流量倍率"><input type="number" min="0.01" step="0.01" value={draft.multiplier} onChange={(event) => update("multiplier", event.target.value)} /></Field><Field label="最大总转发数" hint="0 表示不限"><input type="number" min="0" value={draft.maxForwards} onChange={(event) => update("maxForwards", event.target.value)} /></Field><Field label="网络类型"><select value="tcp_udp" disabled><option value="tcp_udp">TCP + UDP</option></select></Field></div>
      <div className="fm-form-grid"><Field label="端口范围起点" hint="仅限制可选端口，不会预占整段范围"><input type="number" min="1024" max="65535" value={draft.portStart} onChange={(event) => update("portStart", event.target.value)} /></Field><Field label="端口范围终点" hint="未被实际转发使用的端口仍可用于节点"><input type="number" min="1024" max="65535" value={draft.portEnd} onChange={(event) => update("portEnd", event.target.value)} /></Field></div>
      {preflight ? <div className={`fm-preflight ${preflight.success === false || preflight.ready === false ? "is-bad" : "is-good"}`}><ShieldCheck size={18} /><span><strong>{preflight.success === false || preflight.ready === false ? "预检未通过" : "路线预检通过"}</strong><small>{preflight.message || "服务器、TCP/UDP 能力与端口范围均可用"}</small>{preflight.warnings?.map((warning) => <small key={warning}>{warning}</small>)}</span></div> : null}
      <div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={Boolean(working)}>取消</Button><Button type="button" variant="secondary" disabled={!valid || Boolean(working)} onClick={() => void runPreflight()}>{working === "preflight" ? <Spinner label="正在预检" /> : <><Zap size={16} />预检路线</>}</Button><Button type="submit" disabled={!valid || Boolean(working) || (!templateGroup && (!preflight || preflight.success === false || preflight.ready === false)) || (Boolean(preflight) && (preflight?.success === false || preflight?.ready === false))}>{working === "create" || working === "update" ? <Spinner label="正在保存" /> : templateGroup ? <><Check size={16} />保存修改</> : <><Check size={16} />创建隧道</>}</Button></div>
    </form>
  </Dialog>;
}

function GrantPanel({
  grants,
  templates,
  onCreate,
  onEdit,
  onAction,
  onDelete,
}: {
  grants: TunnelGrant[];
  templates: TunnelTemplate[];
  onCreate: () => void;
  onEdit: (grant: TunnelGrant) => void;
  onAction: (grant: TunnelGrant, action: "suspend" | "resume") => Promise<void>;
  onDelete: (grant: TunnelGrant) => void;
}) {
  const [workingID, setWorkingID] = useState<ResourceID | null>(null);
  const [batchWorking, setBatchWorking] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Filter out admin users: admin has all tunnel permissions by default and does not appear in grants
  const nonAdminGrants = useMemo(() => grants.filter((g) => g.username !== "admin"), [grants]);

  const visibleGrants = useMemo(() => {
    return nonAdminGrants.filter((grant) => {
      const state = grant.effective_state || grant.state || (grant.enabled === false ? "suspended" : "active");
      if (statusFilter !== "all" && state !== statusFilter) return false;
      const isPackage = grant.source_type === "package";
      if (sourceFilter === "package" && !isPackage) return false;
      if (sourceFilter === "manual" && isPackage) return false;
      if (query.trim()) {
        const tName = tunnelName(grant, templates);
        const text = `${grant.username} ${tName}`.toLowerCase();
        if (!text.includes(query.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [nonAdminGrants, templates, statusFilter, sourceFilter, query]);

  const grantKey = (g: TunnelGrant) => `${g.username}:::${String(resourceID(g))}`;

  const allVisibleSelected = visibleGrants.length > 0 && visibleGrants.every((g) => selectedKeys.has(grantKey(g)));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedKeys(new Set());
    } else {
      const next = new Set(selectedKeys);
      visibleGrants.forEach((g) => next.add(grantKey(g)));
      setSelectedKeys(next);
    }
  };

  const toggleSelect = (key: string) => {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedKeys(next);
  };

  const change = async (grant: TunnelGrant, action: "suspend" | "resume") => {
    setWorkingID(resourceID(grant));
    try {
      await onAction(grant, action);
    } finally {
      setWorkingID(null);
    }
  };

  const batchAction = async (action: "suspend" | "resume") => {
    const targets = visibleGrants.filter((g) => {
      if (!selectedKeys.has(grantKey(g))) return false;
      const state = g.effective_state || g.state || (g.enabled === false ? "suspended" : "active");
      if (action === "suspend") return state === "active";
      return state !== "active";
    });
    if (!targets.length) return;
    setBatchWorking(true);
    try {
      for (const g of targets) {
        await onAction(g, action);
      }
      setSelectedKeys(new Set());
    } finally {
      setBatchWorking(false);
    }
  };

  const batchDelete = async () => {
    const targets = visibleGrants.filter((g) => selectedKeys.has(grantKey(g)) && g.source_type !== "package");
    if (!targets.length) return;
    for (const g of targets) {
      onDelete(g);
    }
    setSelectedKeys(new Set());
  };

  return (
    <div className="fm-panel">
      <div className="fm-toolbar fm-filter-toolbar">
        <div>
          <strong>用户隧道授权</strong>
          <span>授权仅提供路线使用权，不开放服务器管理权限。管理员写死享有全部路线。</span>
        </div>
        <div className="fm-inline-filters">
          <input
            aria-label="搜索用户或隧道"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索用户名或隧道路线..."
          />
          <select
            aria-label="授权状态筛选"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">全部状态</option>
            <option value="active">运行中</option>
            <option value="suspended">已暂停</option>
          </select>
          <select
            aria-label="授权来源筛选"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <option value="all">全部来源</option>
            <option value="manual">手动授权</option>
            <option value="package">套餐隧道</option>
          </select>
          <Button onClick={onCreate}><Plus size={17} />新增授权</Button>
        </div>
      </div>

      {selectedKeys.size > 0 ? (
        <div className="fm-batch-bar">
          <div>
            已选择 <strong>{selectedKeys.size}</strong> 项授权
          </div>
          <div className="fm-batch-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={batchWorking}
              onClick={() => void batchAction("suspend")}
            >
              <CirclePause size={15} />批量暂停
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={batchWorking}
              onClick={() => void batchAction("resume")}
            >
              <CirclePlay size={15} />批量恢复
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={batchWorking}
              onClick={() => void batchDelete()}
            >
              <Trash2 size={15} />批量删除
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={batchWorking}
              onClick={() => setSelectedKeys(new Set())}
            >
              取消选择
            </Button>
          </div>
        </div>
      ) : null}

      {visibleGrants.length === 0 ? (
        <EmptyState
          icon={<UserRound size={25} />}
          title={nonAdminGrants.length ? "没有匹配的隧道授权" : "暂无隧道授权"}
          description={nonAdminGrants.length ? "请调整搜索条件或状态筛选" : "先建立隧道模板，再为用户设置期限与资源上限"}
          action={!nonAdminGrants.length ? <Button onClick={onCreate}><Plus size={17} />新增第一份授权</Button> : undefined}
        />
      ) : (
        <Surface className="table-surface fm-table-surface">
          <div className="table-wrap">
            <table className="fm-table">
              <thead>
                <tr>
                  <th className="fm-checkbox-col">
                    <input
                      type="checkbox"
                      aria-label="全选授权"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th>用户 / 隧道</th>
                  <th>有效期</th>
                  <th>转发限制</th>
                  <th>流量</th>
                  <th>状态</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {visibleGrants.map((grant) => {
                  const id = resourceID(grant);
                  const key = grantKey(grant);
                  const isChecked = selectedKeys.has(key);
                  const state = grant.effective_state || grant.state || (grant.enabled === false ? "suspended" : "active");
                  const packageManaged = grant.source_type === "package";

                  return (
                    <tr key={key} className={isChecked ? "is-selected" : ""}>
                      <td className="fm-checkbox-col">
                        <input
                          type="checkbox"
                          aria-label={`选择 ${grant.username} 的授权`}
                          checked={isChecked}
                          onChange={() => toggleSelect(key)}
                        />
                      </td>
                      <td className="fm-primary-cell">
                        <strong>{grant.username}</strong>
                        <div className="fm-tunnel-name-row">
                          <small>{tunnelName(grant, templates)}</small>
                          {packageManaged ? <Badge tone="info">套餐隧道</Badge> : null}
                        </div>
                      </td>
                      <td>
                        <span>{displayDate(grant.expires_at)}</span>
                        <small className="fm-cell-note">{grant.starts_at ? `${displayDate(grant.starts_at)} 起` : "立即生效"}</small>
                      </td>
                      <td>
                        <span>{grantActiveForwards(grant)}/{grant.max_active_forwards} 条启用</span>
                        <small className="fm-cell-note">{grant.per_forward_speed_mbps ? `${grant.per_forward_speed_mbps} Mbps` : "不限速"} · {grant.per_forward_connection_limit ? `${grant.per_forward_connection_limit} 连接` : "不限连接"}</small>
                      </td>
                      <td>
                        <span>{formatBytes(grantUsedBytes(grant))} / {grant.traffic_limit_bytes ? formatBytes(grant.traffic_limit_bytes) : "不限"}</span>
                        <small className="fm-cell-note">当前版本不自动重置</small>
                      </td>
                      <td>
                        <Badge tone={stateTone(state)}>{stateLabel(state)}</Badge>
                      </td>
                      <td>
                        <div className="fm-row-actions">
                          {packageManaged ? (
                            <Badge tone="neutral" title="套餐隧道禁止从本处修改，请在套餐管理中调整">套餐隧道 · 禁止从本处修改</Badge>
                          ) : (
                            <>
                              <IconButton label={`编辑 ${grant.username} 的隧道授权`} onClick={() => onEdit(grant)}>
                                <Gauge size={18} />
                              </IconButton>
                              {state === "active" ? (
                                <IconButton label={`暂停 ${grant.username} 的隧道授权`} disabled={sameID(workingID, id)} onClick={() => void change(grant, "suspend")}>
                                  <CirclePause size={18} />
                                </IconButton>
                              ) : (
                                <IconButton label={`恢复 ${grant.username} 的隧道授权`} disabled={sameID(workingID, id)} onClick={() => void change(grant, "resume")}>
                                  <CirclePlay size={18} />
                                </IconButton>
                              )}
                              <IconButton label={`撤销 ${grant.username} 的隧道授权`} onClick={() => onDelete(grant)}>
                                <Trash2 size={18} />
                              </IconButton>
                            </>
                          )}
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
    </div>
  );
}

function GrantDialog({
  grant,
  users,
  templates,
  servers = [],
  onClose,
  onComplete,
}: {
  grant?: TunnelGrant;
  users: UserItem[];
  templates: TunnelTemplate[];
  servers?: RemoteServer[];
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<GrantDraft>(() =>
    grant ? grantDraftFrom(grant, templates) : defaultGrantDraft(users, templates)
  );
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  // Filter out admin users from grant creation: admin has full permissions by default
  const eligibleUsers = users.filter((user) => {
    if (user.username === "admin" || user.role === "admin") return false;
    return !isPackageAuthorization(user) || (Boolean(grant) && user.username === draft.username);
  });

  const activeTemplates = templates.filter(
    (template) => template.state === "active" || sameID(resourceID(template), draft.tunnelID)
  );

  const templateGroups = useMemo(() => groupTunnelTemplates(activeTemplates, servers), [activeTemplates, servers]);

  const [tunnelFilter, setTunnelFilter] = useState("");

  const filteredTemplateGroups = useMemo(() => {
    if (!tunnelFilter.trim()) return templateGroups;
    const q = tunnelFilter.trim().toLowerCase();
    return templateGroups.filter((g) => {
      const nameMatch = g.name.toLowerCase().includes(q);
      const descMatch = (g.description || "").toLowerCase().includes(q);
      const hopsMatch = (g.hops || []).some((h) => (h.name || "").toLowerCase().includes(q));
      return nameMatch || descMatch || hopsMatch;
    });
  }, [templateGroups, tunnelFilter]);

  // Selected group keys for batch tunnel granting
  const [selectedGroupKeys, setSelectedGroupKeys] = useState<Set<string>>(() => {
    if (grant) {
      const matchedGroup = templateGroups.find((g) =>
        g.templates.some((t) => sameID(resourceID(t), grant.tunnel_id) || sameID(t.id, grant.tunnel_id))
      );
      return new Set(matchedGroup ? [matchedGroup.key] : []);
    }
    return new Set(templateGroups[0] ? [templateGroups[0].key] : []);
  });

  const toggleGroupSelection = (key: string) => {
    setSelectedGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllGroups = () => {
    if (tunnelFilter.trim()) {
      setSelectedGroupKeys((current) => {
        const next = new Set(current);
        filteredTemplateGroups.forEach((g) => next.add(g.key));
        return next;
      });
    } else {
      setSelectedGroupKeys(new Set(templateGroups.map((g) => g.key)));
    }
  };

  const clearAllGroups = () => {
    if (tunnelFilter.trim()) {
      setSelectedGroupKeys((current) => {
        const next = new Set(current);
        filteredTemplateGroups.forEach((g) => next.delete(g.key));
        return next;
      });
    } else {
      setSelectedGroupKeys(new Set());
    }
  };

  const selectedUser = users.find((user) => user.username === draft.username);

  // Target template IDs representing all directions of all selected groups
  const targetTemplateIDs = useMemo(() => {
    return templateGroups
      .filter((g) => selectedGroupKeys.has(g.key))
      .flatMap((g) => g.templates.map((t) => resourceID(t)));
  }, [templateGroups, selectedGroupKeys]);

  const isPackageManaged = grant?.source_type === "package";

  const valid =
    !isPackageManaged &&
    Boolean(selectedUser && !isPackageAuthorization(selectedUser)) &&
    Boolean(draft.username) &&
    (Boolean(grant) ? Boolean(draft.tunnelID) : targetTemplateIDs.length > 0) &&
    Boolean(draft.startsAt) &&
    Number(draft.maxForwards) >= 1 &&
    Number(draft.speedMbps) >= 0 &&
    Number(draft.trafficGB) >= 0 &&
    (!draft.expiresAt || new Date(draft.expiresAt).getTime() > new Date(draft.startsAt).getTime());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setWorking(true);
    setError("");

    try {
      const base = `/api/admin/users/${encodeURIComponent(draft.username)}/tunnel-grants`;
      if (grant) {
        const payload = {
          tunnel_id: draft.tunnelID,
          enabled: grant.enabled ?? true,
          starts_at: new Date(draft.startsAt).toISOString(),
          expires_at: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null,
          max_active_forwards: Number(draft.maxForwards),
          per_forward_speed_mbps: Number(draft.speedMbps),
          per_forward_connection_limit: 0,
          traffic_limit_bytes: Math.round(Number(draft.trafficGB) * 1024 ** 3),
          billing_mode_override: draft.billingMode,
          allow_custom_public_target: false,
          version: grant.version ?? 1,
        };
        await api.put(`${base}/${encodeURIComponent(resourceID(grant))}`, payload, { idempotencyKey: idempotencyKey() });
      } else {
        for (const tid of targetTemplateIDs) {
          const payload = {
            tunnel_id: String(tid),
            enabled: true,
            starts_at: new Date(draft.startsAt).toISOString(),
            expires_at: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null,
            max_active_forwards: Number(draft.maxForwards),
            per_forward_speed_mbps: Number(draft.speedMbps),
            per_forward_connection_limit: 0,
            traffic_limit_bytes: Math.round(Number(draft.trafficGB) * 1024 ** 3),
            billing_mode_override: draft.billingMode,
            allow_custom_public_target: false,
          };
          await api.post(base, payload, { idempotencyKey: idempotencyKey() });
        }
      }
      await onComplete();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "隧道授权保存失败");
      setWorking(false);
    }
  };

  const update = <K extends keyof GrantDraft>(key: K, value: GrantDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <Dialog
      title={grant ? "编辑隧道授权" : "新增隧道授权"}
      description="限制对单个用户生效，不会改变隧道模板或服务器权限。"
      onClose={onClose}
      wide
      dismissible={!working}
    >
      <form className="fm-form" onSubmit={(event) => void submit(event)}>
        {error ? <ErrorState message={error} /> : null}
        {isPackageManaged ? (
          <ErrorState message="套餐授权的隧道禁止从本处修改，请前往套餐管理调整。" />
        ) : null}

        {grant ? (
          <div className="fm-form-grid">
            <Field label="授权用户">
              <select
                value={draft.username}
                disabled
                onChange={(event) => update("username", event.target.value)}
              >
                <option value="">选择用户</option>
                {eligibleUsers.map((user) => (
                  <option key={user.username} value={user.username}>
                    {user.nickname || user.username} ({user.username})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="隧道线路">
              <input
                disabled
                value={tunnelName(grant, templates)}
                readOnly
              />
            </Field>
          </div>
        ) : (
          <Field label="授权用户" className="fm-field-full">
            <select
              value={draft.username}
              onChange={(event) => update("username", event.target.value)}
            >
              <option value="">选择用户</option>
              {eligibleUsers.map((user) => (
                <option key={user.username} value={user.username}>
                  {user.nickname || user.username} ({user.username})
                </option>
              ))}
            </select>
          </Field>
        )}

        {!grant ? (
          <div className="fm-tunnel-selection-container">
            <div className="fm-tunnel-selection-header">
              <div className="fm-tunnel-selection-title">
                <strong>选择授权隧道路线</strong>
                <span className="fm-selection-hint">（可多选 · 双向隧道自动双向授权）</span>
              </div>
              <div className="fm-tunnel-selection-actions">
                <div className="fm-tunnel-search-box">
                  <Search size={14} className="fm-tunnel-search-icon" />
                  <input
                    type="text"
                    aria-label="搜索隧道路线"
                    placeholder="快速筛选隧道..."
                    value={tunnelFilter}
                    onChange={(e) => setTunnelFilter(e.target.value)}
                  />
                  {tunnelFilter ? (
                    <button
                      type="button"
                      aria-label="清空搜索"
                      className="fm-tunnel-search-clear"
                      onClick={() => setTunnelFilter("")}
                    >
                      <X size={12} />
                    </button>
                  ) : null}
                </div>
                <Button type="button" variant="ghost" onClick={selectAllGroups}>全选所有</Button>
                <Button type="button" variant="ghost" onClick={clearAllGroups}>清空选择</Button>
              </div>
            </div>
            <div className="fm-tunnel-selection-list">
              {filteredTemplateGroups.length === 0 ? (
                <div className="fm-tunnel-empty-notice">
                  {templateGroups.length === 0 ? "暂无可授权的隧道线路" : "未找到匹配的隧道路线"}
                </div>
              ) : (
                filteredTemplateGroups.map((group) => {
                  const isChecked = selectedGroupKeys.has(group.key);
                  const hops = group.hops || [];
                  const routeText = hops.length > 0
                    ? (group.isBidirectional ? ` (${hops.map((h) => h.name).join(" ⇄ ")})` : ` (${hops.map((h) => h.name).join(" → ")})`)
                    : "";
                  return (
                    <label
                      key={group.key}
                      className={`fm-tunnel-option-item ${isChecked ? "is-selected" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleGroupSelection(group.key)}
                      />
                      <div className="fm-tunnel-option-content">
                        <div className="fm-tunnel-option-title">
                          <span title={group.name + routeText}>{group.name}{routeText}</span>
                          {group.isBidirectional ? <Badge tone="info">双向对称</Badge> : null}
                        </div>
                        <div className="fm-tunnel-option-desc" title={group.description || undefined}>
                          {group.description || `${group.isBidirectional ? "双向" : ""}${hops.length ? `${hops.length} 跳线路` : "直连线路"}`}
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
            <div className="fm-tunnel-selection-footer">
              <small className="fm-cell-note">
                已选中 <strong>{selectedGroupKeys.size}</strong> 组隧道
                {targetTemplateIDs.length > selectedGroupKeys.size ? (
                  <>（含双向对称隧道，共将为用户开通 <strong>{targetTemplateIDs.length}</strong> 条单向/反向路线）</>
                ) : null}
              </small>
              {templateGroups.length > 4 ? (
                <small className="fm-scroll-tip">
                  共 {templateGroups.length} 组路线（面板支持上下滚动）
                </small>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="fm-form-grid">
          <Field label="生效时间">
            <input
              type="datetime-local"
              value={draft.startsAt}
              onChange={(event) => update("startsAt", event.target.value)}
            />
          </Field>
          <Field label="到期时间" hint="留空表示长期">
            <input
              type="datetime-local"
              value={draft.expiresAt}
              onChange={(event) => update("expiresAt", event.target.value)}
            />
          </Field>
        </div>
        <div className="fm-form-grid fm-form-grid-four">
          <Field label="最大启用转发">
            <input
              type="number"
              min="1"
              value={draft.maxForwards}
              onChange={(event) => update("maxForwards", event.target.value)}
            />
          </Field>
          <Field label="每转发限速 Mbps" hint="0 表示不限">
            <input
              type="number"
              min="0"
              step="0.1"
              value={draft.speedMbps}
              onChange={(event) => update("speedMbps", event.target.value)}
            />
          </Field>
          <Field label="每转发连接数" hint="当前节点组件暂不支持">
            <input type="number" min="0" value="0" disabled />
          </Field>
          <Field label="授权总流量 GB" hint="0 表示不限">
            <input
              type="number"
              min="0"
              step="0.1"
              value={draft.trafficGB}
              onChange={(event) => update("trafficGB", event.target.value)}
            />
          </Field>
        </div>
        <div className="fm-form-grid">
          <Field label="计费方向">
            <select
              value={draft.billingMode}
              onChange={(event) => update("billingMode", event.target.value as ForwardingBillingMode)}
            >
              <option value="both">双向</option>
              <option value="upload">仅算上行</option>
              <option value="download">仅算下行</option>
            </select>
          </Field>
          <Field label="流量重置" hint="当前版本暂不支持">
            <select value="none" disabled>
              <option value="none">不自动重置</option>
            </select>
          </Field>
        </div>
        <div className="fm-capability-note">
          <ShieldCheck size={17} />
          <span>
            转发同时支持 TCP 与 UDP，可配置每条转发的独立限速，并自动选取共同端口或由用户在模板范围内指定端口。连接数限制当前不可用并固定为不限。
          </span>
        </div>
        <div className="dialog-actions">
          <Button type="button" variant="secondary" disabled={working} onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={!valid || working}>
            {working ? <Spinner label="正在保存" /> : <><Check size={16} />保存授权</>}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ForwardEditDialog({
  forward,
  nodes,
  servers = [],
  templates = [],
  admin = false,
  onClose,
  onComplete,
}: {
  forward: ForwardRule;
  nodes: NodeItem[];
  servers?: RemoteServer[];
  templates?: TunnelTemplate[];
  admin?: boolean;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const currentEntry = forwardEntry(forward, servers, templates);
  const isCustom = forward.target_type === "custom";
  const [name, setName] = useState(forward.name || "");
  const [customHost, setCustomHost] = useState(forward.target_host || "");
  const [customPort, setCustomPort] = useState(forward.target_port ? String(forward.target_port) : "");
  const [targetNodeID, setTargetNodeID] = useState(forward.target_node_id ? String(forward.target_node_id) : "");
  const [requestedEntryPort, setRequestedEntryPort] = useState(
    String(forward.allocated_entry_port || forward.entry_port || currentEntry.port || ""),
  );
  const [sourceCIDRs, setSourceCIDRs] = useState((forward.source_cidrs || []).join("\n"));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const parsedPort = Number(requestedEntryPort.trim()) || 0;
  const isPortChanged = parsedPort > 0 && parsedPort !== currentEntry.port;
  const portCheckURL = forward.grant_id && isPortChanged
    ? `/api/user/forwards/port-check?grant_id=${encodeURIComponent(forward.grant_id)}&port=${encodeURIComponent(requestedEntryPort.trim())}`
    : null;
  const portCheck = useDebouncedPortCheck({
    enabled: Boolean(forward.grant_id) && isPortChanged,
    url: portCheckURL,
    port: requestedEntryPort,
    minPort: 1024,
    maxPort: 65535,
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("转发名称不能为空");
      return;
    }
    const parsedCustomPort = Number(customPort.trim()) || 0;
    if (isCustom) {
      if (!customHost.trim()) {
        setError("目标主机地址不能为空");
        return;
      }
      if (parsedCustomPort < 1 || parsedCustomPort > 65535) {
        setError("目标端口必须在 1 至 65535 范围内");
        return;
      }
    }
    if (parsedPort > 0 && (parsedPort < 1024 || parsedPort > 65535)) {
      setError("入口端口必须在 1024 至 65535 范围内");
      return;
    }
    if (isPortChanged && isPortCheckBlocking(portCheck)) {
      setError("指定入口端口已被占用或无法使用，请修改后重试");
      return;
    }
    setWorking(true);
    setError("");
    try {
      const endpoint = admin
        ? `/api/admin/forwards/${encodeURIComponent(resourceID(forward))}`
        : `/api/user/forwards/${encodeURIComponent(resourceID(forward))}`;
      const cidrs = sourceCIDRs
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      await api.put(
        endpoint,
        {
          name: name.trim(),
          requested_entry_port: parsedPort > 0 ? parsedPort : undefined,
          ...(isCustom
            ? {
                target_type: "custom",
                target_host: customHost.trim(),
                target_port: parsedCustomPort,
                target_node_id: 0,
              }
            : {
                target_node_id: Number(targetNodeID) || undefined,
              }),
          source_cidrs: cidrs,
        },
        { idempotencyKey: idempotencyKey() },
      );
      await onComplete();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存转发修改失败");
    } finally {
      setWorking(false);
    }
  };

  const selectedNode = nodes.find((n) => String(n.id) === targetNodeID);
  const previewPort = parsedPort > 0 ? parsedPort : currentEntry.port;
  const previewHost = currentEntry.host || forward.entry_host || forward.entry_address || "入口服务器";

  return (
    <Dialog
      title={`编辑转发 “${forward.name}”`}
      description="可修改转发名称、入口地址/端口、最终目标受管节点以及来源 IP 白名单。修改后将自动平滑热重载下发。"
      onClose={onClose}
      wide
      dismissible={!working}
    >
      <form className="fm-form" onSubmit={(event) => void submit(event)}>
        {error ? <ErrorState message={error} /> : null}
        {isCustom ? (
          <>
            <div className="fm-form-grid">
              <Field label="转发名称">
                <input
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：香港入口到外部服务器"
                />
              </Field>
              <Field label="目标主机 / IP" hint="自定义公网目标 IP 或域名">
                <input
                  required
                  aria-label="目标主机"
                  value={customHost}
                  onChange={(e) => setCustomHost(e.target.value.trim())}
                  placeholder="例如：198.51.100.24 或 api.example.com"
                />
              </Field>
            </div>
            <div className="fm-form-grid">
              <Field label="目标端口" hint="目标服务监听端口（1 至 65535）">
                <input
                  required
                  aria-label="目标端口"
                  type="number"
                  min="1"
                  max="65535"
                  value={customPort}
                  onChange={(e) => setCustomPort(e.target.value)}
                  placeholder="例如：443"
                />
              </Field>
              <div className="port-field-group">
                <Field label="入口端口" hint="可修改为 1024–65535 范围内的空闲端口">
                  <input
                    type="number"
                    min="1024"
                    max="65535"
                    value={requestedEntryPort}
                    onChange={(e) => setRequestedEntryPort(e.target.value)}
                    placeholder="例如 2056"
                  />
                </Field>
                {isPortChanged ? <PortCheckHint state={portCheck} /> : null}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="fm-form-grid">
              <Field label="转发名称">
                <input
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：香港入口到美国 Reality"
                />
              </Field>
              <Field label="最终目标节点" hint="选择流量要送往的目标受管节点">
                <select
                  value={targetNodeID}
                  onChange={(e) => setTargetNodeID(e.target.value)}
                >
                  <option value="">保持当前目标 ({forward.target_name || forward.target_host || "未变更"})</option>
                  {nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.node_name} · {node.protocol ? node.protocol.toUpperCase() : "受管"} ({node.original_server || "节点 #" + node.id})
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="fm-form-grid">
              <Field label="入口主机 / 路线" hint="由隧道固定首跳服务器提供连接">
                <input
                  readOnly
                  disabled
                  value={previewHost}
                  title="入口服务器由已选隧道固定"
                />
              </Field>
              <div className="port-field-group">
                <Field label="入口端口" hint="可修改为 1024–65535 范围内的空闲端口">
                  <input
                    type="number"
                    min="1024"
                    max="65535"
                    value={requestedEntryPort}
                    onChange={(e) => setRequestedEntryPort(e.target.value)}
                    placeholder="例如 2056"
                  />
                </Field>
                {isPortChanged ? <PortCheckHint state={portCheck} /> : null}
              </div>
            </div>
          </>
        )}
        <Field
          label="入口来源 CIDR 白名单（可选）"
          hint="每行或逗号分隔；留空表示允许任何客户端访问此入口端口。"
        >
          <textarea
            rows={3}
            value={sourceCIDRs}
            onChange={(e) => setSourceCIDRs(e.target.value)}
            placeholder="例如：203.0.113.8/32 或 198.51.100.0/24"
          />
        </Field>
        <div className="fm-capability-note">
          <ShieldCheck size={17} />
          <span>
            {`保存后完整入口地址为 ${previewHost}:${previewPort || "自动"}。`}
            {selectedNode ? `最终交付至：${selectedNode.node_name}（所属服务器：${selectedNode.original_server || "未知"}）。` : ""}
            系统将自动平滑下发更新，客户端连接入口地址即可直连。
          </span>
        </div>
        <div className="dialog-actions">
          <Button type="button" variant="secondary" disabled={working} onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={!name.trim() || working || (isPortChanged && isPortCheckBlocking(portCheck))}>
            {working ? <Spinner label="正在保存" /> : <><Check size={16} />保存修改</>}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

interface ForwardProbeSegment {
  type: "entry" | "tunnel" | "target";
  source_name: string;
  target_name: string;
  target_host: string;
  target_port: number;
  success: boolean;
  latency_ms: number;
  status: "healthy" | "degraded" | "error";
  error?: string;
}

interface ForwardHealthResult {
  loading?: boolean;
  success?: boolean;
  latency?: number;
  tunnel_latency?: number;
  target_latency?: number;
  status?: "healthy" | "degraded" | "error";
  message?: string;
  entry_host?: string;
  entry_port?: number;
  segments?: ForwardProbeSegment[];
  checkedAt?: number;
}

function formatHealthTooltip(health?: ForwardHealthResult, entryHost?: string, entryPort?: number): string {
  if (!health) {
    return entryHost && entryPort ? `点击测试全链路健康与延迟 (${entryHost}:${entryPort})` : "测试链路健康状态";
  }
  if (health.loading) {
    return "正在执行全链路探针检测...";
  }
  const lines: string[] = [];
  if (health.success) {
    lines.push(`🟢 全链路通畅 · 往返延迟 ${Math.round(health.latency || 0)} ms`);
    if (health.tunnel_latency != null && health.target_latency != null) {
      lines.push(`   (隧道: ${Math.round(health.tunnel_latency)} ms · 落地: ${Math.round(health.target_latency)} ms)`);
    }
  } else {
    lines.push(`🔴 链路异常 · ${health.message || "存在故障节点"}`);
  }
  lines.push("----------------------------------------");
  if (health.segments && health.segments.length > 0) {
    for (const seg of health.segments) {
      const typeLabel = seg.type === "entry" ? "🌐 [入口]" : seg.type === "tunnel" ? "🚇 [隧道]" : "🎯 [落地]";
      if (seg.success) {
        lines.push(`${typeLabel} ${seg.source_name} ➔ ${seg.target_name}: ${Math.round(seg.latency_ms)} ms`);
      } else {
        lines.push(`❌ ${typeLabel} ${seg.source_name} ➔ ${seg.target_name}: 失败 (${seg.error || "未响应"})`);
      }
    }
  } else if (health.message) {
    lines.push(health.message);
  }
  lines.push("----------------------------------------");
  lines.push("点击查看完整拓扑与链路诊断");
  return lines.join("\n");
}

function ForwardDiagnosticDialog({
  forward,
  health,
  onClose,
  onRecheck,
}: {
  forward: ForwardRule;
  health?: ForwardHealthResult;
  onClose: () => void;
  onRecheck: () => void;
}) {
  const isHealthy = health?.success && health.status === "healthy";
  const isDegraded = health?.success && health.status === "degraded";
  const isError = health?.status === "error";

  return (
    <Dialog
      title={`链路健康与延迟诊断 · ${forward.name}`}
      description="基于各节点 Agent 探针测量端到端分段延迟、链路质量与服务连通性"
      onClose={onClose}
      wide
    >
      <div className="fm-diag-container">
        <div className={`fm-diag-summary ${isHealthy ? "is-good" : isDegraded ? "is-warning" : isError ? "is-bad" : ""}`}>
          <div className="fm-diag-summary-header">
            <div className="fm-diag-status-pill">
              {health?.loading ? <Spinner label="" /> : <Zap size={18} />}
              <strong>
                {health?.loading
                  ? "正在诊断全链路..."
                  : isHealthy
                  ? "全链路通畅"
                  : isDegraded
                  ? "部分分段延迟偏高"
                  : isError
                  ? "链路存在异常"
                  : "尚未检测"}
              </strong>
            </div>
            {health?.latency != null ? (
              <div className="fm-diag-total-latency">
                <span>往返总延迟: <strong>{Math.round(health.latency)} ms</strong></span>
                {health?.tunnel_latency != null && health?.target_latency != null ? (
                  <small className="muted"> (隧道 {Math.round(health.tunnel_latency)} ms + 落地 {Math.round(health.target_latency)} ms)</small>
                ) : null}
              </div>
            ) : null}
          </div>
          {health?.message ? <p className="fm-diag-message">{health.message}</p> : null}
        </div>

        {health?.segments && health.segments.length > 0 ? (
          <div className="fm-diag-flow-wrapper">
            <div className="fm-diag-flow">
              {health.segments.map((seg, idx) => (
                <div key={idx} className="fm-diag-hop-wrap">
                  <div className={`fm-diag-node ${seg.success ? "is-ok" : "is-error"}`}>
                    <span className="fm-diag-node-badge">
                      {seg.type === "entry" ? <Globe size={13} /> : seg.type === "tunnel" ? <Route size={13} /> : <Radio size={13} />}
                      {seg.type === "entry" ? "入口监听" : seg.type === "tunnel" ? `隧道跳 #${idx}` : "最终目标"}
                    </span>
                    <strong>{seg.target_name}</strong>
                    <small>{seg.target_host}:{seg.target_port}</small>
                  </div>
                  {idx < (health.segments?.length || 0) - 1 ? (
                    <div className={`fm-diag-connector ${seg.success ? "is-ok" : "is-error"}`}>
                      <span className="fm-diag-link-latency">
                        {seg.success ? `${Math.round(seg.latency_ms)} ms` : "断开"}
                      </span>
                      <ArrowRight size={16} />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {health?.segments && health.segments.length > 0 ? (
          <div className="fm-diag-breakdown">
            <h4>分段探测明细</h4>
            <div className="table-wrap">
              <table className="fm-table fm-diag-table">
                <thead>
                  <tr>
                    <th>分段类型</th>
                    <th>起始节点 ➔ 目标</th>
                    <th>目标地址</th>
                    <th>分段延迟</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {health.segments.map((seg, idx) => (
                    <tr key={idx}>
                      <td>
                        <Badge tone={seg.type === "tunnel" ? "info" : seg.type === "entry" ? "neutral" : "good"}>
                          {seg.type === "entry" ? "入口握手" : seg.type === "tunnel" ? "隧道穿透" : "落地目标"}
                        </Badge>
                      </td>
                      <td>
                        <strong>{seg.source_name}</strong>
                        <span className="muted"> ➔ </span>
                        <strong>{seg.target_name}</strong>
                      </td>
                      <td><code>{seg.target_host}:{seg.target_port}</code></td>
                      <td>
                        {seg.success ? (
                          <span className={seg.latency_ms > 300 ? "text-warning" : "text-success"} style={{ fontWeight: 700 }}>
                            {Math.round(seg.latency_ms)} ms
                          </span>
                        ) : (
                          <span className="text-danger" style={{ fontWeight: 700 }}>失败</span>
                        )}
                      </td>
                      <td>
                        {seg.success ? (
                          <Badge tone="good">正常</Badge>
                        ) : (
                          <div>
                            <Badge tone="bad">异常</Badge>
                            {seg.error ? <small className="fm-cell-note" style={{ color: "var(--red, #c94b45)" }}>{seg.error}</small> : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="dialog-actions">
          <Button variant="secondary" onClick={onClose}>关闭</Button>
          <Button disabled={health?.loading} onClick={onRecheck}>
            {health?.loading ? <Spinner label="" /> : <RefreshCw size={15} />}
            <span>重新检测</span>
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function ForwardTable({ forwards, templates, servers = [], admin = false, onAction, onDelete, onCopy, onEdit }: {
  forwards: ForwardRule[];
  templates: TunnelTemplate[];
  servers?: RemoteServer[];
  admin?: boolean;
  onAction: (forward: ForwardRule, action: "suspend" | "resume" | "retry") => Promise<void>;
  onDelete: (forward: ForwardRule) => void;
  onCopy?: (forward: ForwardRule) => Promise<void>;
  onEdit?: (forward: ForwardRule) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [workingID, setWorkingID] = useState<ResourceID | null>(null);
  const [healthMap, setHealthMap] = useState<Record<string, ForwardHealthResult>>({});
  const [testingAll, setTestingAll] = useState(false);
  const [diagForward, setDiagForward] = useState<ForwardRule | null>(null);

  const probeForward = async (forward: ForwardRule) => {
    const fwdID = String(resourceID(forward));
    setHealthMap((prev) => ({
      ...prev,
      [fwdID]: { loading: true },
    }));
    try {
      const endpoint = admin
        ? `/api/admin/forwards/${encodeURIComponent(fwdID)}/probe`
        : `/api/user/forwards/${encodeURIComponent(fwdID)}/probe`;
      const res = await api.post<{
        success: boolean;
        latency_ms: number;
        tunnel_latency_ms?: number;
        target_latency_ms?: number;
        status: "healthy" | "degraded" | "error";
        message?: string;
        entry_host?: string;
        entry_port?: number;
        segments?: ForwardProbeSegment[];
      }>(endpoint, {});
      setHealthMap((prev) => ({
        ...prev,
        [fwdID]: {
          loading: false,
          success: res.success,
          latency: res.latency_ms,
          tunnel_latency: res.tunnel_latency_ms,
          target_latency: res.target_latency_ms,
          status: res.status,
          message: res.message,
          entry_host: res.entry_host,
          entry_port: res.entry_port,
          segments: res.segments,
          checkedAt: Date.now(),
        },
      }));
    } catch (err) {
      setHealthMap((prev) => ({
        ...prev,
        [fwdID]: {
          loading: false,
          success: false,
          status: "error",
          message: err instanceof Error ? err.message : "检测失败",
          checkedAt: Date.now(),
        },
      }));
    }
  };

  const probeAllVisibleForwards = async () => {
    const activeTargets = visible.filter((f) => forwardState(f) === "active");
    if (!activeTargets.length) return;
    setTestingAll(true);
    try {
      const pool = [...activeTargets];
      const workers = Array.from({ length: Math.min(4, pool.length) }, async () => {
        while (pool.length > 0) {
          const item = pool.shift();
          if (item) {
            await probeForward(item);
          }
        }
      });
      await Promise.all(workers);
    } finally {
      setTestingAll(false);
    }
  };

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
  return <div className="fm-panel"><div className="fm-toolbar fm-filter-toolbar"><div><strong>{admin ? "全部用户转发" : "我的转发"}</strong><span>{admin ? "入口异常时可重试下发，删除会按入口到出口顺序清理。" : "入口完全生效后才能复制地址或生成客户端配置。"}</span></div><div className="fm-inline-filters"><input aria-label="搜索转发" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名称、用户、隧道或目标" /><select aria-label="转发状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="active">运行中</option><option value="pending">等待下发</option><option value="provisioning">正在下发</option><option value="degraded">部分异常</option><option value="suspended">已停用</option><option value="error">异常</option></select>{visible.some((f) => forwardState(f) === "active") ? <Button type="button" variant="secondary" className="fm-batch-probe-btn" disabled={testingAll} onClick={() => void probeAllVisibleForwards()}>{testingAll ? <Spinner label="检测中..." /> : <><Activity size={14} /> 批量健康检查</>}</Button> : null}</div></div>{visible.length === 0 ? <EmptyState icon={<Network size={25} />} title={forwards.length ? "没有匹配的转发" : "暂无转发"} description={forwards.length ? "调整搜索条件或状态筛选" : admin ? "用户创建的转发会显示在这里" : "从有效隧道授权创建第一条转发"} /> : <Surface className="table-surface fm-table-surface"><div className="table-wrap"><table className="fm-table fm-forward-table"><thead><tr>{admin ? <th>用户</th> : null}<th>转发 / 入口</th><th>隧道</th><th>最终目标</th><th>限制与流量</th><th>健康 / 延迟</th><th>状态</th><th aria-label="操作" /></tr></thead><tbody>{visible.map((forward) => {
    const id = resourceID(forward);
    const state = forwardState(forward);
    const entry = forwardEntry(forward, servers, templates);
    const route = forwardRoute(forward);
    const template = forward.tunnel || templates.find((item) => sameID(resourceID(item), forward.tunnel_id)) || (route.length ? { id: forward.grant_id, name: forward.tunnel_name || "", state: "active", route } : undefined);
    const rawTunnelName = forward.tunnel_name || template?.name || "";
    const isGrantPlaceholder = !rawTunnelName || rawTunnelName.startsWith("授权") || rawTunnelName.startsWith("grt_");
    const tunnelTitle = isGrantPlaceholder ? "" : rawTunnelName;
    const health = healthMap[String(id)];
    return <tr key={String(id)}>{admin ? <td><strong>{forward.username || "-"}</strong></td> : null}<td className="fm-primary-cell"><strong>{forward.name}</strong><small>{state === "active" && entry.host && entry.port ? `${entry.host}:${entry.port}` : "入口尚未可用"}</small></td><td>{tunnelTitle ? <span>{tunnelTitle}</span> : null}{template ? <RouteLine hops={routeHops(template).map((hop) => ({ name: hop.name }))} /> : null}</td><td><span>{forward.target_type === "custom" || !forward.target_node_id ? (forward.target_host ? `${forward.target_host}:${forward.target_port}` : forward.target_name || "自定义目标") : (forward.target_node_name || forward.target_name || forward.target_host || `节点 #${forward.target_node_id || "-"}`)}</span><small className="fm-cell-note">{forward.target_type === "custom" || !forward.target_node_id ? "自定义目标 · TCP + UDP" : `TCP + UDP · ${forward.target_port || "节点服务端口"}`}</small></td><td><span>{formatBytes(forward.traffic_used_bytes)}</span><small className="fm-cell-note">{forward.speed_limit_mbps ? `${forward.speed_limit_mbps} Mbps` : "不限速"} · {forward.connection_limit ? `${forward.connection_limit} 连接` : "不限连接"}</small></td><td className="fm-cell-health">{state === "active" && entry.host && entry.port ? <button type="button" className={`fm-health-button ${health?.loading ? "is-loading" : health?.success ? "is-good" : health?.status === "error" ? "is-bad" : ""}`} disabled={health?.loading} title={formatHealthTooltip(health, entry.host, entry.port)} onClick={() => { if (health?.segments && health.segments.length > 0) { setDiagForward(forward); } else { void probeForward(forward); } }}>{health?.loading ? <Spinner label="" /> : <Zap size={14} />}<span>{health?.loading ? "检测中" : health?.success ? `${Math.round(health.tunnel_latency || health.latency || 0)} ms` : health?.status === "error" ? "异常" : "测健康"}</span></button> : <span className="muted" title="入口尚未生效">-</span>}</td><td><Badge tone={stateTone(state)}>{stateLabel(state)}</Badge>{forward.effective_expires_at ? <small className="fm-cell-note">至 {displayDate(forward.effective_expires_at)}</small> : null}</td><td><div className="fm-row-actions">{onCopy ? <IconButton label={`复制 ${forward.name} 入口`} disabled={state !== "active" || !entry.host || !entry.port} onClick={() => void onCopy(forward)}><Copy size={18} /></IconButton> : null}{state === "active" && entry.host && entry.port ? <IconButton label={`链路诊断 ${forward.name}`} onClick={() => { setDiagForward(forward); if (!health || !health.segments) { void probeForward(forward); } }}><Activity size={18} /></IconButton> : null}{onEdit ? <IconButton label={`编辑 ${forward.name}`} onClick={() => onEdit(forward)}><Pencil size={18} /></IconButton> : null}{state === "active" ? <IconButton label={`暂停 ${forward.name}`} disabled={sameID(workingID, id)} onClick={() => void act(forward, "suspend")}><CirclePause size={18} /></IconButton> : <IconButton label={`恢复 ${forward.name}`} disabled={sameID(workingID, id) || ["pending", "provisioning", "cleanup_pending"].includes(state)} onClick={() => void act(forward, "resume")}><CirclePlay size={18} /></IconButton>}{["error", "degraded"].includes(state) ? <IconButton label={`重试 ${forward.name}`} disabled={sameID(workingID, id)} onClick={() => void act(forward, "retry")}><RefreshCw size={18} /></IconButton> : null}<IconButton label={`删除 ${forward.name}`} onClick={() => onDelete(forward)}><Trash2 size={18} /></IconButton></div></td></tr>;
  })}</tbody></table></div></Surface>}
  {diagForward ? <ForwardDiagnosticDialog forward={diagForward} health={healthMap[String(resourceID(diagForward))]} onClose={() => setDiagForward(null)} onRecheck={() => void probeForward(diagForward)} /> : null}
  </div>;
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
  const [editingForward, setEditingForward] = useState<ForwardRule | undefined>();
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
    const entry = forwardEntry(forward, [], templates);
    if (!entry.host || !entry.port) {
      notify("入口尚未生成，请稍后重试", "error");
      return;
    }
    const text = `${entry.host}:${entry.port}`;
    const ok = await copyToClipboard(text);
    if (ok) {
      notify(`入口已复制：${text}`);
    } else {
      notify(`复制受限，入口地址为：${text}`);
    }
  };

  return <section className="fm-root" aria-label="转发管理">
    <PageHeader
      title="转发管理"
      description="使用管理员授权的固定路线，把入口流量安全转发到自己的受管节点。"
      actions={
        <div className="fm-heading-actions">
          <IconButton label="刷新我的转发" disabled={loading} onClick={() => void load()}><RefreshCw size={18} /></IconButton>
          <Button disabled={!activeGrants.length} onClick={() => { setWizardGrantID(undefined); setWizard(true); }}><Plus size={17} />创建转发</Button>
        </div>
      }
    />
    <div className="fm-metrics"><Metric icon={<Activity size={18} />} label="运行中转发" value={activeForwards.length} note={`共 ${forwards.length} 条`} /><Metric icon={<Route size={18} />} label="可用隧道" value={activeGrants.length} note={`共 ${grants.length} 份授权`} /><Metric icon={<Gauge size={18} />} label="本周期流量" value={formatBytes(totalUsed)} note={totalLimit ? `总额 ${formatBytes(totalLimit)}` : "当前授权不限总流量"} /><Metric icon={<ShieldCheck size={18} />} label="最近到期" value={nearestExpiry ? displayDate(nearestExpiry).split(" ")[0] : "长期"} note={nearestExpiry ? displayDate(nearestExpiry) : "没有固定到期时间"} /></div>
    <div className="fm-tabs" role="tablist" aria-label="用户转发视图"><button role="tab" aria-selected={tab === "forwards"} className={tab === "forwards" ? "is-active" : ""} onClick={() => setTab("forwards")}><Network size={16} />我的转发 <span>{forwards.length}</span></button><button role="tab" aria-selected={tab === "grants"} className={tab === "grants" ? "is-active" : ""} onClick={() => setTab("grants")}><Route size={16} />可用隧道 <span>{activeGrants.length}</span></button></div>
    {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}{loading ? <div className="center-state"><Spinner label="正在加载转发" /></div> : null}
    {!loading && tab === "forwards" ? <><ForwardTable forwards={forwards} templates={templates} onAction={runForwardAction} onCopy={copyEntry} onEdit={setEditingForward} onDelete={(forward) => setConfirm({ title: "删除转发", description: `将停止“${forward.name}”入口并清理每一跳端口。此操作无法撤销。`, confirmLabel: "确认删除", run: async () => { await api.delete(`/api/user/forwards/${encodeURIComponent(resourceID(forward))}`, undefined, { idempotencyKey: idempotencyKey() }); notify("转发删除任务已提交"); } })} />{!forwards.length && activeGrants.length ? <div className="fm-empty-action"><Button onClick={() => { setWizardGrantID(undefined); setWizard(true); }}><Plus size={17} />创建第一条转发</Button></div> : null}</> : null}
    {!loading && tab === "grants" ? <UserGrantCards grants={grants} onCreate={(grant) => { if ((grant.effective_state || grant.state || "active") !== "active") return; setWizardGrantID(String(resourceID(grant))); setWizard(true); }} /> : null}
    {wizard ? <ForwardWizard grants={activeGrants} initialGrantID={wizardGrantID} nodes={nodes.filter((node) => node.enabled)} onClose={() => { setWizard(false); setWizardGrantID(undefined); }} onComplete={async () => { setWizard(false); setWizardGrantID(undefined); notify("转发创建任务已提交"); setTab("forwards"); await load(true); }} /> : null}
    {editingForward ? (
      <ForwardEditDialog
        forward={editingForward}
        nodes={nodes.filter((node) => node.enabled)}
        templates={templates}
        onClose={() => setEditingForward(undefined)}
        onComplete={async () => {
          setEditingForward(undefined);
          notify("转发已更新");
          await load(true);
        }}
      />
    ) : null}
    {confirm ? <ConfirmDialog title={confirm.title} description={confirm.description} confirmLabel={confirm.confirmLabel} working={working} onCancel={() => !working && setConfirm(null)} onConfirm={() => void runConfirmed()} /> : null}
  </section>;
}

function UserGrantCards({ grants, onCreate }: { grants: TunnelGrant[]; onCreate: (grant: TunnelGrant) => void }) {
  if (!grants.length) return <EmptyState icon={<Route size={25} />} title="暂无隧道授权" description="管理员授权后，可用路线会显示在这里" />;
  return <div className="fm-grant-grid">{grants.map((grant) => {
    const state = grant.effective_state || grant.state || (grant.enabled === false ? "suspended" : "active");
    const template = tunnelForGrant(grant, []);
    const usedPercent = grant.traffic_limit_bytes ? Math.min(100, (grantUsedBytes(grant) / grant.traffic_limit_bytes) * 100) : 0;
    return <article className="fm-grant-card" key={String(resourceID(grant))}><header><span><Route size={18} /><strong>{tunnelName(grant, [])}</strong></span><Badge tone={stateTone(state)}>{stateLabel(state)}</Badge></header>{template ? <RouteLine hops={routeHops(template).map((hop) => ({ name: hop.name }))} /> : null}<dl><div><dt>转发数量</dt><dd>{grantActiveForwards(grant)} / {grant.max_active_forwards}</dd></div><div><dt>每转发限速</dt><dd>{grant.per_forward_speed_mbps ? `${grant.per_forward_speed_mbps} Mbps` : "不限"}</dd></div><div><dt>连接数</dt><dd>{grant.per_forward_connection_limit || "不限"}</dd></div><div><dt>有效期</dt><dd>{displayDate(grant.expires_at)}</dd></div></dl><div className="fm-usage"><span><small>授权流量</small><strong>{formatBytes(grantUsedBytes(grant))} / {grant.traffic_limit_bytes ? formatBytes(grant.traffic_limit_bytes) : "不限"}</strong></span>{grant.traffic_limit_bytes ? <progress value={usedPercent} max="100" /> : null}</div><Button variant="secondary" disabled={state !== "active" || grantActiveForwards(grant) >= grant.max_active_forwards} onClick={() => onCreate(grant)}><Plus size={17} />使用此隧道创建</Button></article>;
  })}</div>;
}

function ForwardFlowVisualizer({
  grantTunnel,
  grant,
  templates = [],
  target,
  targetType = "managed_node",
  customTarget,
}: {
  grantTunnel?: TunnelTemplate;
  grant?: TunnelGrant;
  templates?: TunnelTemplate[];
  target?: NodeItem;
  targetType?: "managed_node" | "custom";
  customTarget?: { host: string; port: string };
}) {
  const hops = useMemo(() => {
    if (grantTunnel) {
      const raw = routeHops(grantTunnel);
      if (raw.length > 0) return raw;
    }
    return [{ id: 0, name: grant ? tunnelName(grant, templates) : "中转隧道" }];
  }, [grantTunnel, grant, templates]);

  const entryHop = hops[0];
  const exitHop = hops[hops.length - 1];
  const targetServer = (target?.original_server || "").trim();
  const entryServerName = (entryHop?.name || "").trim().toLowerCase();
  const exitServerName = (exitHop?.name || "").trim().toLowerCase();
  const targetServerLower = targetServer.toLowerCase();

  const isLocalHandover = Boolean(
    targetType !== "custom" &&
      targetServer &&
      exitServerName &&
      (targetServerLower === exitServerName ||
        exitServerName.includes(targetServerLower) ||
        targetServerLower.includes(exitServerName))
  );

  const isLoopback = Boolean(
    targetType !== "custom" &&
      !isLocalHandover &&
      targetServer &&
      entryServerName &&
      exitServerName &&
      (targetServerLower === entryServerName ||
        entryServerName.includes(targetServerLower) ||
        targetServerLower.includes(entryServerName)) &&
      entryServerName !== exitServerName
  );

  let tone: "good" | "warn" | "info" = "info";
  let statusBadge = targetType === "custom" ? "公网端点交付" : "跨区网络交付";
  let diagnostic = targetType === "custom"
    ? customTarget?.host
      ? `流量自入口【${entryHop?.name || "入口"}】进入隧道，于出口【${exitHop?.name || "出口"}】直接交付至自定义公网目标【${customTarget.host}:${customTarget.port || "..."}】。`
      : "请输入自定义目标的公网 IP 或域名与端口，即可查看流量走向。"
    : target
      ? `流量自入口【${entryHop?.name || "入口"}】进入隧道，于出口【${exitHop?.name || "出口"}】发往目标节点【${target.node_name}${targetServer ? ` (${targetServer})` : ""}】。`
      : "请在上方选择目标节点，即可查看完整的流量走向与拓扑诊断。";

  if (targetType !== "custom" && target) {
    if (isLoopback) {
      tone = "warn";
      statusBadge = "⚠️ 绕路折返 (建议反向)";
      diagnostic = `注意：目标节点与入口同在「${entryHop.name}」，但出口在「${exitHop.name}」。流量将由 ${entryHop.name} 穿透至 ${exitHop.name} 后又折返连回 ${targetServer} 节点，产生额外跨区延迟！建议在步骤一选择反向对称隧道（${exitHop.name} → ${entryHop.name}）。`;
    } else if (isLocalHandover) {
      tone = "good";
      statusBadge = "✓ 同机直连 (极低延迟)";
      diagnostic = `最佳拓扑：隧道出口【${exitHop.name}】与目标节点归属同一服务器，流量经本机回环直接交付，零额外跨海开销。`;
    }
  }

  return (
    <div className="fm-flow-visualizer" aria-label="流量走向动效图">
      <div className="fm-flow-header">
        <div className="fm-flow-title">
          <Activity size={14} className="fm-flow-pulse-icon" />
          <span>实时流量走向模拟</span>
        </div>
        <div className={`fm-flow-status-badge is-${tone}`}>
          {statusBadge}
        </div>
      </div>

      <div className="fm-flow-track">
        <div className="fm-flow-node is-client">
          <div className="fm-flow-node-icon"><Laptop size={15} /></div>
          <div className="fm-flow-node-meta">
            <strong>客户端</strong>
            <small>用户设备</small>
          </div>
        </div>

        <div className="fm-flow-connector">
          <div className="fm-flow-line">
            <span className="fm-flow-beam" style={{ animationDelay: "0s" }} />
          </div>
          <span className="fm-flow-step-tag">入站连接</span>
        </div>

        {hops.map((hop, idx) => {
          const isEntry = idx === 0;
          const isExit = idx === hops.length - 1;
          const delay = `${(idx + 1) * 0.35}s`;
          return (
            <Fragment key={`${hop.name}-${idx}`}>
              <div className={`fm-flow-node ${isEntry ? "is-entry" : isExit ? "is-exit" : "is-hop"}`}>
                <div className="fm-flow-node-icon"><Server size={15} /></div>
                <div className="fm-flow-node-meta">
                  <strong title={hop.name}>{hop.name}</strong>
                  <small>{isEntry ? "入口 (第1跳)" : isExit ? `出口 (第${hops.length}跳)` : `中转 #${idx + 1}`}</small>
                </div>
              </div>

              <div className="fm-flow-connector">
                <div className={`fm-flow-line ${isExit ? (isLoopback ? "is-warn" : isLocalHandover ? "is-good" : "") : ""}`}>
                  <span
                    className={`fm-flow-beam ${isExit ? (isLoopback ? "is-warn" : isLocalHandover ? "is-good" : "") : ""}`}
                    style={{ animationDelay: delay }}
                  />
                </div>
                <span className="fm-flow-step-tag">
                  {isExit
                    ? (isLocalHandover ? "本机直连" : isLoopback ? "折返公网" : "出口交付")
                    : "隧道穿透"}
                </span>
              </div>
            </Fragment>
          );
        })}

        <div className={`fm-flow-node is-target ${isLoopback ? "is-warn" : isLocalHandover ? "is-good" : ""}`}>
          <div className="fm-flow-node-icon">
            {targetType === "custom" ? <Network size={15} /> : <Radio size={15} />}
          </div>
          <div className="fm-flow-node-meta">
            <strong title={targetType === "custom" ? (customTarget?.host ? `${customTarget.host}:${customTarget.port || "..."}` : "自定义公网目标") : (target?.node_name || "未选目标")}>
              {targetType === "custom"
                ? (customTarget?.host ? `${customTarget.host}:${customTarget.port || "..."}` : "自定义公网目标")
                : (target?.node_name || "目标节点")}
            </strong>
            <small>
              {targetType === "custom"
                ? (customTarget?.host ? "公网目标" : "等待输入")
                : (target ? target.protocol.toUpperCase() : "等待选择")}
            </small>
          </div>
        </div>

        <div className="fm-flow-connector">
          <div className="fm-flow-line">
            <span className="fm-flow-beam" style={{ animationDelay: `${(hops.length + 1) * 0.35}s` }} />
          </div>
          <span className="fm-flow-step-tag">出海访问</span>
        </div>

        <div className="fm-flow-node is-internet">
          <div className="fm-flow-node-icon"><Globe size={15} /></div>
          <div className="fm-flow-node-meta">
            <strong>目标网站</strong>
            <small>Internet</small>
          </div>
        </div>
      </div>

      <div className={`fm-flow-diagnostic is-${tone}`}>
        <Info size={14} />
        <div className="fm-flow-diag-content">
          <span>{diagnostic}</span>
          {targetType === "custom" ? (
            customTarget?.host ? (
              <div className="fm-flow-target-meta">
                <span>公网地址: {customTarget.host}</span>
                <span className="fm-flow-meta-sep">·</span>
                <span>目标端口: {customTarget.port || "未指定"}</span>
                <span className="fm-flow-meta-sep">·</span>
                <span className="fm-meta-good">自定义公网端点</span>
              </div>
            ) : null
          ) : target ? (
            <div className="fm-flow-target-meta">
              <span>节点 ID: {target.id}</span>
              <span className="fm-flow-meta-sep">·</span>
              <span>入站: {target.inbound_tag || "默认入站"}</span>
              <span className="fm-flow-meta-sep">·</span>
              <span className={target.enabled ? "fm-meta-good" : "fm-meta-warn"}>
                {target.enabled ? "正常运行" : "已停用"}
              </span>
              {target.tag ? (
                <>
                  <span className="fm-flow-meta-sep">·</span>
                  <span>标签: {target.tag}</span>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ForwardWizard({
  grants,
  initialGrantID,
  initialTargetNodeID,
  nodes,
  templates = [],
  onClose,
  onComplete,
}: {
  grants: TunnelGrant[];
  initialGrantID?: string;
  initialTargetNodeID?: string | number;
  nodes: NodeItem[];
  templates?: TunnelTemplate[];
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const matchedTarget = initialTargetNodeID
    ? nodes.find((node) => String(node.id) === String(initialTargetNodeID))
    : undefined;
  const [draft, setDraft] = useState<ForwardDraft>({
    grantID: grants.some((grant) => sameID(resourceID(grant), initialGrantID))
      ? initialGrantID || ""
      : grants[0]
      ? String(resourceID(grants[0]))
      : "",
    targetType: "managed_node",
    targetNodeID: matchedTarget
      ? String(matchedTarget.id)
      : nodes[0]
      ? String(nodes[0].id)
      : "",
    customHost: "",
    customPort: "",
    name: "",
    requestedEntryPort: "",
    sourceCIDRs: "",
  });
  const [selectedServer, setSelectedServer] = useState<string>(
    () => matchedTarget?.original_server?.trim() || "",
  );
  const [nodeSearch, setNodeSearch] = useState<string>("");
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [working, setWorking] = useState<"preflight" | "create" | "">("");
  const [error, setError] = useState("");
  const grant = grants.find((item) => sameID(resourceID(item), draft.grantID));
  const grantTunnel = grant ? tunnelForGrant(grant, templates) : undefined;
  const target = nodes.find((node) => String(node.id) === draft.targetNodeID);
  const sourceCIDRs = draft.sourceCIDRs.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
  const requestedEntryPort = Number(draft.requestedEntryPort) || 0;
  const requestedPortValid = !draft.requestedEntryPort || (Number.isInteger(requestedEntryPort) && requestedEntryPort >= 1024 && requestedEntryPort <= 65535);
  const portCheckURL = step === 3 && draft.grantID && draft.requestedEntryPort.trim()
    ? `/api/user/forwards/port-check?grant_id=${encodeURIComponent(draft.grantID)}&port=${encodeURIComponent(draft.requestedEntryPort.trim())}`
    : null;
  const portCheck = useDebouncedPortCheck({
    enabled: step === 3 && Boolean(draft.grantID),
    url: portCheckURL,
    port: draft.requestedEntryPort,
    minPort: 1024,
    maxPort: 65535,
  });

  const serverOptions = useMemo(() => {
    const map = new Map<string, number>();
    nodes.forEach((node) => {
      const srv = (node.original_server || "其他服务器").trim();
      map.set(srv, (map.get(srv) ?? 0) + 1);
    });
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
  }, [nodes]);

  const filteredNodes = useMemo(() => {
    let list = nodes;
    if (selectedServer) {
      list = list.filter((node) => (node.original_server || "其他服务器").trim() === selectedServer);
    }
    const q = nodeSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((node) => {
        const text = [node.node_name, node.protocol, node.tag, node.original_server].filter(Boolean).join(" ").toLowerCase();
        return text.includes(q);
      });
    }
    return list;
  }, [nodes, selectedServer, nodeSearch]);

  const otherServerMatches = useMemo(() => {
    if (!selectedServer || !nodeSearch.trim()) return 0;
    const q = nodeSearch.trim().toLowerCase();
    return nodes.filter((node) => {
      const srv = (node.original_server || "其他服务器").trim();
      if (srv === selectedServer) return false;
      const text = [node.node_name, node.protocol, node.tag, node.original_server].filter(Boolean).join(" ").toLowerCase();
      return text.includes(q);
    }).length;
  }, [nodes, selectedServer, nodeSearch]);

  const handleServerChange = (newServer: string) => {
    setSelectedServer(newServer);
    const matching = newServer
      ? nodes.filter((node) => (node.original_server || "其他服务器").trim() === newServer)
      : nodes;
    const currentStillValid = matching.some((node) => String(node.id) === draft.targetNodeID);
    if (!currentStillValid && matching.length > 0) {
      update("targetNodeID", String(matching[0].id));
    }
  };

  const handleNodeSelect = (newNodeID: string) => {
    update("targetNodeID", newNodeID);
    const node = nodes.find((n) => String(n.id) === newNodeID);
    if (node && node.original_server) {
      setSelectedServer(node.original_server.trim());
    }
  };

  useEffect(() => {
    if (step === 2 && filteredNodes.length > 0) {
      const currentStillValid = filteredNodes.some((node) => String(node.id) === draft.targetNodeID);
      if (!currentStillValid) {
        update("targetNodeID", String(filteredNodes[0].id));
      }
    }
  }, [step, filteredNodes, draft.targetNodeID]);

  const isCustomTargetValid = Boolean(draft.customHost.trim()) &&
    Number.isInteger(Number(draft.customPort)) &&
    Number(draft.customPort) >= 1 &&
    Number(draft.customPort) <= 65535;

  const stepValid = step === 1
    ? Boolean(grant)
    : step === 2
      ? draft.targetType === "custom"
        ? isCustomTargetValid
        : Boolean(target && (!nodes.length || filteredNodes.some((n) => String(n.id) === String(target.id))))
      : step === 3
        ? Boolean(draft.name.trim()) && requestedPortValid && !isPortCheckBlocking(portCheck)
        : Boolean(preflight && preflight.success !== false && preflight.ready !== false);

  const payload = () => ({
    grant_id: draft.grantID,
    name: draft.name.trim(),
    target: draft.targetType === "custom"
      ? { type: "custom", host: draft.customHost.trim(), port: Number(draft.customPort) }
      : { type: "managed_node", node_id: Number(draft.targetNodeID) },
    network: "tcp_udp",
    requested_entry_port: requestedEntryPort,
    source_cidrs: sourceCIDRs,
  });
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
  return <Dialog title="创建用户转发" description="TCP 与 UDP 共用端口，支持双向隧道两端使用相同入口端口。" onClose={onClose} wide dismissible={!working}><div className="fm-wizard"><ol className="fm-steps" aria-label="创建转发步骤">{([[1, "选择隧道"], [2, "选择目标"], [3, "转发设置"], [4, "确认创建"]] as const).map(([number, label]) => <li key={number} className={step === number ? "is-active" : step > number ? "is-done" : ""}><span>{step > number ? <Check size={14} /> : number}</span><strong>{label}</strong></li>)}</ol>{error ? <ErrorState message={error} /> : null}
    <div className="fm-wizard-content">{step === 1 ? (!grants.length ? <EmptyState icon={<Route size={25} />} title="暂无可用隧道" description="管理员尚未开通可用路线或模板未激活" /> : <div className="fm-choice-grid">{grants.map((item) => { const template = tunnelForGrant(item, templates); return <button type="button" key={String(resourceID(item))} className={sameID(resourceID(item), draft.grantID) ? "is-active" : ""} onClick={() => update("grantID", String(resourceID(item)))}><span><Route size={19} /><strong>{tunnelName(item, templates)}</strong></span>{template ? <RouteLine hops={routeHops(template).map((hop) => ({ name: hop.name }))} /> : null}<small>{item.per_forward_speed_mbps ? `${item.per_forward_speed_mbps} Mbps` : "不限速"} · {item.per_forward_connection_limit ? `${item.per_forward_connection_limit} 连接` : "不限连接"} · 至 {displayDate(item.expires_at)}</small></button>; })}</div>) : null}
      {step === 2 ? <>
        <div className="fm-target-segmented">
          <button
            type="button"
            className={draft.targetType === "managed_node" ? "is-active" : ""}
            onClick={() => update("targetType", "managed_node")}
          >
            <Server size={14} />
            <span>受管节点</span>
            {draft.targetType === "managed_node" ? <Check size={13} /> : null}
          </button>
          <button
            type="button"
            className={draft.targetType === "custom" ? "is-active" : ""}
            onClick={() => update("targetType", "custom")}
          >
            <Network size={14} />
            <span>自定义公网目标</span>
            {draft.targetType === "custom" ? <Check size={13} /> : null}
          </button>
        </div>
        {draft.targetType === "custom" ? (
          <div className="fm-form" style={{ marginTop: 10 }}>
            <div className="fm-form-grid">
              <Field label="目标主机 / IP" hint="支持 IPv4、IPv6 或外部域名（如 198.51.100.24 或 api.example.com）">
                <input
                  autoFocus
                  aria-label="目标主机"
                  type="text"
                  placeholder="例如：198.51.100.24 或 api.example.com"
                  value={draft.customHost}
                  onChange={(event) => update("customHost", event.target.value.trim())}
                />
              </Field>

              <Field label="目标端口" hint="目标服务监听端口（1 至 65535）">
                <input
                  aria-label="目标端口"
                  type="number"
                  min="1"
                  max="65535"
                  placeholder="例如：443 或 8080"
                  value={draft.customPort}
                  onChange={(event) => update("customPort", event.target.value)}
                />
              </Field>
            </div>

            <div className="fm-capability-note">
              <Network size={16} />
              <span>流量经隧道各跳到达出口服务器后，将由出口直接通过 TCP/UDP 将流量交付至该公网地址与端口。</span>
            </div>

            <ForwardFlowVisualizer
              grantTunnel={grantTunnel}
              grant={grant}
              templates={templates}
              targetType="custom"
              customTarget={{ host: draft.customHost.trim(), port: draft.customPort.trim() }}
            />
          </div>
        ) : nodes.length ? (
          <div className="fm-form" style={{ marginTop: 10 }}>
            <div className="fm-form-grid">
              <Field label="目标服务器">
                <select
                  aria-label="目标服务器"
                  value={selectedServer}
                  onChange={(event) => handleServerChange(event.target.value)}
                >
                  <option value="">全部服务器（{serverOptions.length} 个服务器 · 共 {nodes.length} 个节点）</option>
                  {serverOptions.map((srv) => (
                    <option key={srv.name} value={srv.name}>
                      {srv.name}（{srv.count} 个节点）
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="节点预筛选">
                <div className="fm-search-wrap">
                  <Search size={15} className="fm-search-icon" />
                  <input
                    aria-label="节点预筛选"
                    type="text"
                    placeholder="搜索节点名称、协议或服务器..."
                    value={nodeSearch}
                    onChange={(event) => setNodeSearch(event.target.value)}
                  />
                  {nodeSearch ? (
                    <button
                      type="button"
                      className="fm-search-clear"
                      onClick={() => setNodeSearch("")}
                      title="清空搜索"
                    >
                      <X size={13} />
                    </button>
                  ) : null}
                </div>
              </Field>
            </div>

            {otherServerMatches > 0 && filteredNodes.length === 0 ? (
              <div className="fm-filter-tip">
                <span>当前服务器下无匹配项，但在其他服务器找到 {otherServerMatches} 个节点。</span>
                <button
                  type="button"
                  className="fm-text-action"
                  onClick={() => setSelectedServer("")}
                >
                  切换至全部服务器
                </button>
              </div>
            ) : null}

            <Field label="最终目标节点">
              <select
                aria-label="最终目标节点"
                value={draft.targetNodeID}
                onChange={(event) => handleNodeSelect(event.target.value)}
              >
                {filteredNodes.length === 0 ? (
                  <option value="" disabled>无匹配节点（请调整筛选条件）</option>
                ) : (
                  filteredNodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.node_name} · {node.protocol.toUpperCase()}
                      {node.original_server ? ` [${node.original_server}]` : ""}
                    </option>
                  ))
                )}
              </select>
            </Field>

            <ForwardFlowVisualizer
              grantTunnel={grantTunnel}
              grant={grant}
              templates={templates}
              target={target}
              targetType="managed_node"
            />
          </div>
        ) : (
          <EmptyState
            icon={<Server size={24} />}
            title="没有可用受管节点"
            description="请先在节点管理中开通或导入符合条件的节点，或切换到“自定义公网目标”直接转发至外部主机"
          />
        )}
      </> : null}
      {step === 3 ? <div className="fm-form"><div className="fm-form-grid"><Field label="转发名称"><input autoFocus value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="例如：香港入口到美国 Reality" /></Field><Field label="网络类型"><select value="tcp_udp" disabled><option value="tcp_udp">TCP + UDP</option></select></Field></div><div className="port-field-group"><Field label="入口端口（可选）" hint="例如 2022；留空时自动分配空闲端口。支持双向隧道两端使用相同入口端口。"><input type="number" min="1024" max="65535" value={draft.requestedEntryPort} onChange={(event) => update("requestedEntryPort", event.target.value)} placeholder="自动选择" /></Field><PortCheckHint state={portCheck} /></div><Field label="入口来源 CIDR 白名单（可选）" hint="每行或逗号分隔；留空时遵循隧道模板策略"><textarea rows={4} value={draft.sourceCIDRs} onChange={(event) => update("sourceCIDRs", event.target.value)} placeholder="例如：203.0.113.8/32" /></Field><div className="fm-capability-note"><ShieldCheck size={17} /><span>入口节点绑定入口端口，中转跳点自动分配内部端口，支持双向隧道两端使用相同入口端口。</span></div></div> : null}
      {step === 4 ? <div className="fm-review"><div className="fm-review-route"><span>固定路线</span>{grantTunnel ? <RouteLine hops={[...routeHops(grantTunnel).map((hop) => ({ name: hop.name })), { name: draft.targetType === "custom" ? (draft.customHost.trim() || "公网目标") : (target?.node_name || "目标节点") }]} /> : <strong>{grant ? tunnelName(grant, templates) : "已授权隧道"} → {draft.targetType === "custom" ? `${draft.customHost.trim()}:${draft.customPort.trim()}` : target?.node_name}</strong>}</div><dl><div><dt>转发名称</dt><dd>{draft.name}</dd></div><div><dt>网络与入口</dt><dd>TCP + UDP · {requestedEntryPort ? `入口端口 ${requestedEntryPort}` : "自动分配入口端口"}</dd></div><div><dt>最终目标</dt><dd>{draft.targetType === "custom" ? `自定义公网目标 (${draft.customHost.trim()}:${draft.customPort.trim()})` : `${target?.node_name || "目标节点"}${target?.original_server ? ` (${target.original_server})` : ""}`}</dd></div><div><dt>有效期</dt><dd>{displayDate(preflight?.effective_expires_at || grant?.expires_at)}</dd></div><div><dt>每转发限速</dt><dd>{grant?.per_forward_speed_mbps ? `${grant.per_forward_speed_mbps} Mbps` : "不限"}</dd></div><div><dt>连接数</dt><dd>{grant?.per_forward_connection_limit || "不限"}</dd></div><div><dt>计费流量</dt><dd>仅入口统计一次</dd></div><div><dt>入口预览</dt><dd>{preflight?.entry_host || preflight?.entry_address ? `${preflight.entry_host || preflight.entry_address}:${preflight.entry_port || requestedEntryPort || "自动"}` : requestedEntryPort ? `创建后使用 ${requestedEntryPort}` : "创建后由系统分配"}</dd></div></dl><div className={`fm-preflight ${preflight?.success === false || preflight?.ready === false ? "is-bad" : "is-good"}`}><ShieldCheck size={18} /><span><strong>{preflight?.success === false || preflight?.ready === false ? "预检未通过" : "转发预检通过"}</strong><small>{preflight?.message || "授权、目标、路线和端口资源均满足创建条件"}</small>{preflight?.warnings?.map((warning) => <small key={warning}>{warning}</small>)}</span></div></div> : null}</div>
    <div className="dialog-actions"><Button type="button" variant="secondary" disabled={Boolean(working)} onClick={step === 1 ? onClose : () => setStep((current) => current - 1)}>{step === 1 ? "取消" : "上一步"}</Button>{step < 4 ? <Button type="button" disabled={!stepValid || Boolean(working)} onClick={() => void next()}>{working === "preflight" ? <Spinner label="正在预检" /> : <>下一步<ArrowRight size={16} /></>}</Button> : <Button type="button" disabled={!stepValid || Boolean(working)} onClick={() => void create()}>{working === "create" ? <Spinner label="正在创建" /> : <><Check size={16} />确认创建</>}</Button>}</div>
  </div></Dialog>;
}
