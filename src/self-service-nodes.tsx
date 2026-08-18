import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Gauge,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Server,
  Trash2,
  Unplug,
} from "lucide-react";
import { api } from "./api";
import type { ManagedGrantProtocol, ManagedGrantProtocolProfile } from "./managed-grant-protocols";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, IconButton, Spinner, Surface, formatBytes } from "./ui";
import type { ManagedBillingMode } from "./server-grants";
import "./self-service-nodes.css";

type Notify = (message: string, tone?: "success" | "error") => void;

export interface UserManagedGrant {
  id: number;
  server_id: number;
  server_name: string;
  state: string;
  enabled?: boolean;
  expires_at?: string | null;
  max_active_nodes?: number;
  active_node_count?: number;
  speed_limit_mbps?: number;
  connection_limit?: number;
  traffic_limit_bytes?: number;
  billed_bytes?: number;
  billing_mode?: ManagedBillingMode;
  allowed_protocols: ManagedGrantProtocol[];
  allowed_protocol_profiles: ManagedGrantProtocolProfile[];
}

export interface UserManagedSelection {
  id: number;
  grant_id: number;
  offer_id: number;
  node_id: number;
  node_name: string;
  server_id: number;
  server_name: string;
  protocol: string;
  protocol_profile: string;
  desired_enabled: boolean;
  state: string;
  effective_speed_limit_mbps?: number;
  effective_connection_limit?: number;
  effective_billing_mode?: ManagedBillingMode;
  last_error?: string;
}

export interface ManagedNodeCatalogItem {
  offer_id: number;
  node_id: number;
  node_name: string;
  server_id: number;
  server_name: string;
  server_status?: string;
  protocol: string;
  protocol_profile: string;
  grant_id: number;
  grant_state: string;
  expires_at?: string | null;
  can_create: boolean;
  disabled_reason?: string;
  selected: boolean;
  selection_id?: number;
  speed_limit_mbps?: number;
  connection_limit?: number;
  traffic_limit_bytes?: number;
  billing_mode?: ManagedBillingMode;
  allowed_protocols: ManagedGrantProtocol[];
  allowed_protocol_profiles: ManagedGrantProtocolProfile[];
}

interface ManagedNodesPayload {
  grants?: unknown[];
  selected?: unknown[];
  items?: unknown[];
  catalog?: unknown[];
}

type RecordValue = Record<string, unknown>;

const stateMeta: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" | "info" }> = {
  active: { label: "已开通", tone: "good" },
  provisioning: { label: "等待开通", tone: "warn" },
  scheduled: { label: "待生效", tone: "info" },
  suspending: { label: "等待清理", tone: "warn" },
  suspended: { label: "已停用", tone: "neutral" },
  inactive: { label: "未启用", tone: "neutral" },
  expired: { label: "已到期", tone: "bad" },
  over_limit: { label: "额度用尽", tone: "bad" },
  error: { label: "同步失败", tone: "bad" },
};

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function number(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function boolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function protocolList(value: unknown): ManagedGrantProtocol[] {
  return Array.isArray(value) ? value.filter((item): item is ManagedGrantProtocol => typeof item === "string") : [];
}

function protocolProfileList(value: unknown): ManagedGrantProtocolProfile[] {
  return Array.isArray(value) ? value.filter((item): item is ManagedGrantProtocolProfile => typeof item === "string") : [];
}

function canonicalManagedProtocol(value: string): string {
  switch (value.trim().toLowerCase()) {
    case "ss": return "shadowsocks";
    case "hysteria2":
    case "hy2": return "hysteria";
    case "socks5": return "socks";
    default: return value.trim().toLowerCase();
  }
}

function protocolAllowed(
  protocol: string,
  profile: string,
  allowedProtocols: ManagedGrantProtocol[],
  allowedProfiles: ManagedGrantProtocolProfile[],
): boolean {
  const familyAllowed = allowedProtocols.length === 0 || allowedProtocols.includes(canonicalManagedProtocol(protocol) as ManagedGrantProtocol);
  if (!familyAllowed || allowedProfiles.length === 0) return familyAllowed;
  return Boolean(profile) && allowedProfiles.includes(profile as ManagedGrantProtocolProfile);
}

function normalizeGrant(value: unknown): UserManagedGrant {
  const item = record(value);
  return {
    id: number(item.id),
    server_id: number(item.server_id),
    server_name: string(item.server_name),
    state: string(item.state || item.grant_state),
    enabled: boolean(item.enabled, true),
    expires_at: optionalString(item.expires_at),
    max_active_nodes: number(item.max_active_nodes),
    active_node_count: number(item.active_node_count),
    speed_limit_mbps: number(item.speed_limit_mbps),
    connection_limit: number(item.connection_limit),
    traffic_limit_bytes: number(item.traffic_limit_bytes),
    billed_bytes: number(item.billed_bytes || item.usage_bytes),
    billing_mode: (string(item.billing_mode) || "download") as ManagedBillingMode,
    allowed_protocols: protocolList(item.allowed_protocols),
    allowed_protocol_profiles: protocolProfileList(item.allowed_protocol_profiles),
  };
}

function normalizeSelection(value: unknown, catalog?: RecordValue): UserManagedSelection {
  const item = record(value);
  const offer = record(catalog?.offer);
  const grant = record(catalog?.grant);
  return {
    id: number(item.id),
    grant_id: number(item.grant_id || grant.id),
    offer_id: number(item.offer_id || offer.id),
    node_id: number(item.node_id || offer.node_id),
    node_name: string(item.node_name || catalog?.node_name),
    server_id: number(item.server_id || offer.server_id || grant.server_id),
    server_name: string(item.server_name || catalog?.server_name),
    protocol: string(item.protocol || catalog?.protocol),
    protocol_profile: string(item.protocol_profile || catalog?.protocol_profile),
    desired_enabled: boolean(item.desired_enabled, true),
    state: string(item.state || catalog?.state || catalog?.grant_status || "inactive"),
    effective_speed_limit_mbps: number(item.effective_speed_limit_mbps || grant.speed_limit_mbps),
    effective_connection_limit: number(item.effective_connection_limit || grant.connection_limit),
    effective_billing_mode: (string(item.effective_billing_mode || grant.billing_mode) || "download") as ManagedBillingMode,
    last_error: string(item.last_error || catalog?.last_error),
  };
}

function normalizeCatalog(value: unknown): ManagedNodeCatalogItem {
  const item = record(value);
  const offer = record(item.offer);
  const grant = record(item.grant);
  const selection = record(item.selection);
  const selectionID = number(item.selection_id || selection.id);
  return {
    offer_id: number(item.offer_id || offer.id),
    node_id: number(item.node_id || offer.node_id),
    node_name: string(item.node_name),
    server_id: number(item.server_id || offer.server_id || grant.server_id),
    server_name: string(item.server_name),
    server_status: string(item.server_status),
    protocol: string(item.protocol),
    protocol_profile: string(item.protocol_profile),
    grant_id: number(item.grant_id || grant.id),
    grant_state: string(item.grant_state || item.state),
    expires_at: optionalString(item.expires_at || grant.expires_at),
    can_create: boolean(item.can_create),
    disabled_reason: string(item.disabled_reason || item.deny_reason),
    selected: boolean(item.selected, selectionID > 0 && boolean(selection.desired_enabled, true)),
    selection_id: selectionID || undefined,
    speed_limit_mbps: number(item.speed_limit_mbps || grant.speed_limit_mbps),
    connection_limit: number(item.connection_limit || grant.connection_limit),
    traffic_limit_bytes: number(item.traffic_limit_bytes || grant.traffic_limit_bytes),
    billing_mode: (string(item.billing_mode || grant.billing_mode) || "download") as ManagedBillingMode,
    allowed_protocols: protocolList(item.allowed_protocols || grant.allowed_protocols),
    allowed_protocol_profiles: protocolProfileList(item.allowed_protocol_profiles || grant.allowed_protocol_profiles),
  };
}

function messageOf(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function formatDate(value?: string | null) {
  if (!value) return "长期有效";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date)
    : value;
}

function policyText(speed = 0, connections = 0, billing: ManagedBillingMode = "download") {
  return `${speed ? `${speed} Mbps` : "不限速"} · ${connections ? `${connections} 并发` : "并发不限"} · ${billing === "both" ? "上下行计费" : "下行计费"}`;
}

export function SelfServiceNodes({ view, notify, onChanged, onBrowseCatalog }: {
  view: "mine" | "catalog";
  notify: Notify;
  onChanged?: () => void | Promise<void>;
  onBrowseCatalog?: () => void;
}) {
  const [grants, setGrants] = useState<UserManagedGrant[]>([]);
  const [selected, setSelected] = useState<UserManagedSelection[]>([]);
  const [catalog, setCatalog] = useState<ManagedNodeCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [working, setWorking] = useState("");
  const [pendingRemove, setPendingRemove] = useState<UserManagedSelection | null>(null);
  const [query, setQuery] = useState("");
  const [serverID, setServerID] = useState("all");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const payload = await api.get<ManagedNodesPayload>("/api/user/managed-nodes");
      const rawCatalog = Array.isArray(payload.catalog) ? payload.catalog : [];
      const normalizedGrants = (Array.isArray(payload.grants) ? payload.grants : []).map(normalizeGrant);
      const grantsByID = new Map(normalizedGrants.map((grant) => [grant.id, grant]));
      const normalizedCatalog = rawCatalog.map(normalizeCatalog).filter((item) => {
        if (item.offer_id <= 0) return false;
        const grant = grantsByID.get(item.grant_id);
        const allowedProtocols = item.allowed_protocols.length ? item.allowed_protocols : grant?.allowed_protocols ?? [];
        const allowedProfiles = item.allowed_protocol_profiles.length ? item.allowed_protocol_profiles : grant?.allowed_protocol_profiles ?? [];
        return protocolAllowed(item.protocol, item.protocol_profile, allowedProtocols, allowedProfiles);
      });
      const explicitSelected = Array.isArray(payload.selected) ? payload.selected : Array.isArray(payload.items) ? payload.items : [];
      const nestedSelected = rawCatalog
        .map((item) => ({ entry: record(item), selection: record(record(item).selection) }))
        .filter(({ selection }) => number(selection.id) > 0)
        .map(({ entry, selection }) => normalizeSelection(selection, entry));
      setGrants(normalizedGrants);
      setSelected((explicitSelected.length ? explicitSelected.map((item) => normalizeSelection(item)) : nestedSelected).filter((item) => item.id > 0));
      setCatalog(normalizedCatalog);
    } catch (reason) {
      setError(messageOf(reason, "自助节点加载失败"));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const refreshAll = async () => {
    await load(true);
    await onChanged?.();
  };

  const activate = async (item: ManagedNodeCatalogItem) => {
    setWorking(`offer-${item.offer_id}`);
    try {
      await api.post("/api/user/managed-nodes", { offer_id: item.offer_id });
      notify(`${item.node_name} 已提交开通`);
      await refreshAll();
    } catch (reason) {
      notify(messageOf(reason, "节点开通失败"), "error");
    } finally {
      setWorking("");
    }
  };

  const retry = async (item: UserManagedSelection) => {
    setWorking(`selection-${item.id}`);
    try {
      await api.post(`/api/user/managed-nodes/${item.id}/retry`, {});
      notify(`${item.node_name} 已重新提交同步`);
      await refreshAll();
    } catch (reason) {
      notify(messageOf(reason, "节点重试失败"), "error");
    } finally {
      setWorking("");
    }
  };

  const remove = async () => {
    if (!pendingRemove) return;
    const item = pendingRemove;
    setWorking(`selection-${item.id}`);
    try {
      await api.delete(`/api/user/managed-nodes/${item.id}`);
      notify(`${item.node_name} 已停用`);
      setPendingRemove(null);
      await refreshAll();
    } catch (reason) {
      notify(messageOf(reason, "节点停用失败"), "error");
    } finally {
      setWorking("");
    }
  };

  const serverOptions = useMemo(() => Array.from(new Map(catalog.map((item) => [item.server_id, item.server_name])).entries()), [catalog]);
  const activeSelectionCount = useMemo(() => selected.filter((item) => item.state === "active").length, [selected]);
  const availableCatalogCount = useMemo(() => catalog.filter((item) => item.can_create && !item.selected).length, [catalog]);
  const visibleCatalog = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.filter((item) => {
      if (serverID !== "all" && item.server_id !== Number(serverID)) return false;
      return !needle || [item.node_name, item.server_name, item.protocol].some((value) => value.toLowerCase().includes(needle));
    });
  }, [catalog, query, serverID]);

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (loading) return <Surface className="ssn-loading"><Spinner label="正在加载自助节点" /></Surface>;

  return <section className={`ssn-panel ssn-${view}`} aria-label={view === "mine" ? "我的自助节点" : "可开通节点"}>
    {view === "mine" ? <>
      <div className="ssn-heading"><div><strong>自助开通节点</strong><small>{activeSelectionCount} 个已开通 · {availableCatalogCount} 个可开通</small></div><IconButton label="刷新自助节点" onClick={() => void load()}><RefreshCw size={17} /></IconButton></div>
      {!selected.length ? <Surface><EmptyState
        icon={<Unplug size={23} />}
        title="尚未开通自助节点"
        description={availableCatalogCount > 0 ? `套餐已授权 ${availableCatalogCount} 个可开通节点，请进入目录选择。` : grants.length > 0 ? "授权服务器当前没有可开通的发布项。" : "当前账号没有自助节点授权。"}
        action={availableCatalogCount > 0 && onBrowseCatalog ? <Button onClick={onBrowseCatalog}><Plus size={16} />查看 {availableCatalogCount} 个可开通节点</Button> : undefined}
      /></Surface> : <div className="ssn-selection-list">{selected.map((item) => <SelectionRow key={item.id} item={item} busy={working === `selection-${item.id}`} onRetry={() => void retry(item)} onRemove={() => setPendingRemove(item)} />)}</div>}
    </> : <>
      <div className="ssn-catalog-toolbar">
        <div className="search-box ssn-search"><Search size={17} /><input aria-label="搜索可开通节点" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="节点、服务器或协议" /></div>
        <select aria-label="授权服务器" value={serverID} onChange={(event) => setServerID(event.target.value)}><option value="all">全部授权服务器</option>{serverOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        <IconButton label="刷新可开通节点" onClick={() => void load()}><RefreshCw size={17} /></IconButton>
      </div>
      {grants.length ? <div className="ssn-grant-strip">{grants.map((grant) => { const state = stateMeta[grant.state] ?? { label: grant.state || "未知", tone: "neutral" as const }; return <span key={grant.id}><Server size={16} /><span><strong>{grant.server_name || `服务器 #${grant.server_id}`}</strong><small>{formatDate(grant.expires_at)} · {grant.active_node_count || 0}/{grant.max_active_nodes || "不限"} 节点</small></span><Badge tone={state.tone}>{state.label}</Badge></span>; })}</div> : null}
      {!visibleCatalog.length ? <Surface><EmptyState icon={<Server size={23} />} title={catalog.length ? "没有匹配的节点" : "当前没有可开通节点"} /></Surface> : <Surface className="ssn-catalog-surface"><div className="table-wrap"><table className="ssn-catalog-table"><thead><tr><th>节点</th><th>授权服务器</th><th>有效策略</th><th>授权到期</th><th>状态</th><th aria-label="操作" /></tr></thead><tbody>{visibleCatalog.map((item) => {
        const disabled = !item.can_create || item.selected;
        const state = stateMeta[item.grant_state] ?? { label: item.grant_state || "可开通", tone: item.can_create ? "good" as const : "neutral" as const };
        return <tr key={item.offer_id}><td><span className="ssn-node-cell"><Badge tone="info">{item.protocol.toUpperCase() || "-"}</Badge><span><strong>{item.node_name}</strong><small>发布项 #{item.offer_id}</small></span></span></td><td><strong>{item.server_name}</strong><small className="cell-note">{item.server_status === "connected" || item.server_status === "online" ? "在线" : item.server_status === "offline" ? "离线" : `服务器 #${item.server_id}`}</small></td><td><strong>{policyText(item.speed_limit_mbps, item.connection_limit, item.billing_mode)}</strong>{item.traffic_limit_bytes ? <small className="cell-note">额度 {formatBytes(item.traffic_limit_bytes)}</small> : null}</td><td><span className="ssn-date"><CalendarClock size={14} />{formatDate(item.expires_at)}</span></td><td>{item.selected ? <Badge tone="good">已开通</Badge> : <Badge tone={state.tone}>{state.label}</Badge>}{!item.can_create && item.disabled_reason ? <small className="ssn-deny" title={item.disabled_reason}>{item.disabled_reason}</small> : null}</td><td><Button disabled={disabled || working === `offer-${item.offer_id}`} onClick={() => void activate(item)}>{working === `offer-${item.offer_id}` ? <Spinner label="正在开通" /> : <><Plus size={15} />{item.selected ? "已开通" : "开通"}</>}</Button></td></tr>;
      })}</tbody></table></div></Surface>}
    </>}
    {pendingRemove ? <ConfirmDialog title="停用自助节点" description={`停用 ${pendingRemove.node_name} 后，该节点会立即从订阅排除，远端凭据将在服务器在线后清理。`} confirmLabel="确认停用" working={working === `selection-${pendingRemove.id}`} onCancel={() => !working && setPendingRemove(null)} onConfirm={() => void remove()} /> : null}
  </section>;
}

function SelectionRow({ item, busy, onRetry, onRemove }: { item: UserManagedSelection; busy: boolean; onRetry: () => void; onRemove: () => void }) {
  const state = stateMeta[item.state] ?? { label: item.state || "未知", tone: "neutral" as const };
  const retryable = ["error", "provisioning", "suspending"].includes(item.state);
  return <Surface className="ssn-selection-row">
    <span className="ssn-node-cell"><Badge tone="info">{item.protocol.toUpperCase() || "-"}</Badge><span><strong>{item.node_name}</strong><small>{item.server_name} · #{item.node_id}</small></span></span>
    <span className="ssn-effective-policy"><Gauge size={14} /><span><strong>{policyText(item.effective_speed_limit_mbps, item.effective_connection_limit, item.effective_billing_mode)}</strong>{item.last_error ? <small title={item.last_error}>{item.last_error}</small> : null}</span></span>
    <Badge tone={state.tone}>{state.label}</Badge>
    <span className="ssn-row-actions">{retryable ? <IconButton label={`重试 ${item.node_name}`} disabled={busy} onClick={onRetry}><RotateCw size={16} /></IconButton> : null}<IconButton label={`停用 ${item.node_name}`} disabled={busy || !item.desired_enabled} onClick={onRemove}><Trash2 size={16} /></IconButton></span>
  </Surface>;
}
