import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CalendarClock,
  Gauge,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Server,
  Settings2,
  Trash2,
  Unplug,
} from "lucide-react";
import { api } from "./api";
import {
  familiesForProfiles,
  managedGrantProtocolGroups,
  managedGrantProtocolLabel,
  managedGrantProtocolProfileLabel,
  managedGrantProtocolProfiles,
  profilesForFamilies,
  type ManagedGrantProtocol,
  type ManagedGrantProtocolProfile,
} from "./managed-grant-protocols";
import type { RemoteServer, ServerListResponse } from "./types";
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
  Toggle,
  formatBytes,
} from "./ui";
import "./server-grants.css";

export type ManagedBillingMode = "download" | "both";
export type { ManagedGrantProtocol, ManagedGrantProtocolProfile } from "./managed-grant-protocols";

export interface ServerGrant {
  id: number;
  username: string;
  server_id: number;
  server_name: string;
  server_status?: string;
  enabled: boolean;
  starts_at: string;
  expires_at?: string | null;
  max_active_nodes: number;
  speed_limit_mbps: number;
  connection_limit: number;
  traffic_limit_bytes: number;
  billing_mode: ManagedBillingMode;
  reset_policy: "none" | "monthly";
  reset_day: number;
  allowed_protocols?: ManagedGrantProtocol[];
  allowed_protocol_profiles?: ManagedGrantProtocolProfile[];
  version: number;
  state: string;
  offer_count: number;
  active_node_count: number;
  used_uplink_bytes: number;
  used_downlink_bytes: number;
  billed_bytes: number;
  last_error?: string;
}

export interface ManagedNodeSelection {
  id: number;
  grant_id: number;
  offer_id: number;
  node_id: number;
  node_name: string;
  server_id: number;
  server_name: string;
  protocol: string;
  desired_enabled: boolean;
  state: string;
  effective_speed_limit_mbps: number;
  effective_connection_limit: number;
  effective_billing_mode: ManagedBillingMode;
  speed_limit_override_mbps?: number | null;
  connection_limit_override?: number | null;
  billing_mode_override?: ManagedBillingMode | null;
  last_error?: string;
}

type Notify = (message: string, tone?: "success" | "error") => void;
type GrantTab = "grants" | "nodes";

interface GrantFormValue {
  serverID: string;
  enabled: boolean;
  startsAt: string;
  expiresAt: string;
  maxNodes: string;
  speed: string;
  connections: string;
  trafficGB: string;
  billing: ManagedBillingMode;
  resetPolicy: "none" | "monthly";
  resetDay: string;
  allowedProtocols: ManagedGrantProtocol[];
  allowedProtocolProfiles: ManagedGrantProtocolProfile[];
  protocolProfilesExplicit: boolean;
}

const stateMeta: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" | "info" }> = {
  active: { label: "生效中", tone: "good" },
  scheduled: { label: "待生效", tone: "info" },
  suspended: { label: "已暂停", tone: "warn" },
  expired: { label: "已到期", tone: "bad" },
  over_limit: { label: "额度用尽", tone: "bad" },
  user_disabled: { label: "用户停用", tone: "bad" },
  provisioning: { label: "等待开通", tone: "warn" },
  suspending: { label: "等待清理", tone: "warn" },
  error: { label: "同步失败", tone: "bad" },
  inactive: { label: "未启用", tone: "neutral" },
};

function getStateMeta(state: string) {
  return stateMeta[state] ?? { label: state || "未知", tone: "neutral" as const };
}

function messageOf(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function listFrom<T>(value: unknown, key: string): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const list = (value as Record<string, unknown>)[key];
    if (Array.isArray(list)) return list as T[];
  }
  return [];
}

function localDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function asUTC(value: string) {
  return new Date(value).toISOString();
}

function formatDate(value?: string | null) {
  if (!value) return "长期有效";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date)
    : value;
}

function billingLabel(mode: ManagedBillingMode) {
  return mode === "both" ? "上下行" : "仅下行";
}

function limitedNumber(value: string) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function formFromGrant(grant?: ServerGrant): GrantFormValue {
  const allowedProtocols = grant?.allowed_protocols ?? [];
  const explicitProfiles = grant?.allowed_protocol_profiles ?? [];
  return {
    serverID: grant ? String(grant.server_id) : "",
    enabled: grant?.enabled ?? true,
    startsAt: localDateTime(grant?.starts_at ?? new Date().toISOString()),
    expiresAt: localDateTime(grant?.expires_at),
    maxNodes: String(grant?.max_active_nodes ?? 0),
    speed: String(grant?.speed_limit_mbps ?? 0),
    connections: String(grant?.connection_limit ?? 0),
    trafficGB: grant?.traffic_limit_bytes ? String(Number((grant.traffic_limit_bytes / 1024 ** 3).toFixed(2))) : "0",
    billing: grant?.billing_mode ?? "download",
    resetPolicy: grant?.reset_policy ?? "none",
    resetDay: String(grant?.reset_day ?? 1),
    allowedProtocols,
    allowedProtocolProfiles: explicitProfiles.length ? explicitProfiles : profilesForFamilies(allowedProtocols),
    protocolProfilesExplicit: explicitProfiles.length > 0,
  };
}

function payloadFromForm(form: GrantFormValue, version = 1) {
  const selectedProfiles = managedGrantProtocolProfiles
    .filter((profile) => form.allowedProtocolProfiles.includes(profile.value))
    .map((profile) => profile.value);
  return {
    server_id: Number(form.serverID),
    enabled: form.enabled,
    starts_at: asUTC(form.startsAt),
    expires_at: form.expiresAt ? asUTC(form.expiresAt) : null,
    max_active_nodes: Math.floor(limitedNumber(form.maxNodes)),
    speed_limit_mbps: limitedNumber(form.speed),
    connection_limit: Math.floor(limitedNumber(form.connections)),
    traffic_limit_bytes: Math.round(limitedNumber(form.trafficGB) * 1024 ** 3),
    billing_mode: form.billing,
    reset_policy: form.resetPolicy,
    reset_day: form.resetPolicy === "monthly" ? Math.min(28, Math.max(1, Math.floor(Number(form.resetDay) || 1))) : 1,
    allowed_protocols: form.protocolProfilesExplicit ? familiesForProfiles(selectedProfiles) : form.allowedProtocols,
    allowed_protocol_profiles: form.protocolProfilesExplicit ? selectedProfiles : [],
    version,
  };
}

function grantPayload(grant: ServerGrant, patch: Partial<ReturnType<typeof payloadFromForm>> = {}) {
  return {
    server_id: grant.server_id,
    enabled: grant.enabled,
    starts_at: grant.starts_at,
    expires_at: grant.expires_at ?? null,
    max_active_nodes: grant.max_active_nodes,
    speed_limit_mbps: grant.speed_limit_mbps,
    connection_limit: grant.connection_limit,
    traffic_limit_bytes: grant.traffic_limit_bytes,
    billing_mode: grant.billing_mode,
    reset_policy: grant.reset_policy,
    reset_day: grant.reset_day,
    allowed_protocols: grant.allowed_protocols ?? [],
    allowed_protocol_profiles: grant.allowed_protocol_profiles ?? [],
    version: grant.version,
    ...patch,
  };
}

function effectiveProtocolProfiles(protocols: ManagedGrantProtocol[] = [], profiles: ManagedGrantProtocolProfile[] = []): Set<ManagedGrantProtocolProfile> {
  if (profiles.length) return new Set(profiles);
  if (protocols.length) return new Set(profilesForFamilies(protocols));
  return new Set(managedGrantProtocolProfiles.map((profile) => profile.value));
}

function protocolScopeNarrows(
  currentProtocols: ManagedGrantProtocol[] = [],
  currentProfiles: ManagedGrantProtocolProfile[] = [],
  nextProtocols: ManagedGrantProtocol[],
  nextProfiles: ManagedGrantProtocolProfile[],
): boolean {
  const current = effectiveProtocolProfiles(currentProtocols, currentProfiles);
  const next = effectiveProtocolProfiles(nextProtocols, nextProfiles);
  return [...current].some((profile) => !next.has(profile));
}

export function ServerGrantsPanel({ username, notify }: { username: string; notify: Notify }) {
  const [tab, setTab] = useState<GrantTab>("grants");
  const [grants, setGrants] = useState<ServerGrant[]>([]);
  const [nodes, setNodes] = useState<ManagedNodeSelection[]>([]);
  const [servers, setServers] = useState<RemoteServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<ServerGrant | "new" | null>(null);
  const [limitsEditor, setLimitsEditor] = useState<ManagedNodeSelection | null>(null);
  const [removeGrant, setRemoveGrant] = useState<ServerGrant | null>(null);
  const [working, setWorking] = useState("");

  const base = `/api/admin/users/${encodeURIComponent(username)}`;
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const [grantPayload, nodePayload, serverPayload] = await Promise.all([
        api.get<unknown>(`${base}/server-grants`),
        api.get<unknown>(`${base}/managed-nodes`),
        api.get<ServerListResponse>("/api/admin/remote-servers").catch(() => ({ success: false, servers: [] })),
      ]);
      setGrants(listFrom<ServerGrant>(grantPayload, "grants"));
      setNodes(listFrom<ManagedNodeSelection>(nodePayload, "items"));
      setServers(serverPayload.servers ?? []);
    } catch (reason) {
      setError(messageOf(reason, "服务器授权加载失败"));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [base]);

  useEffect(() => { void load(); }, [load]);

  const updateEnabled = async (grant: ServerGrant) => {
    setWorking(`grant-${grant.id}`);
    try {
      await api.put(`${base}/server-grants/${grant.id}`, grantPayload(grant, { enabled: !grant.enabled }));
      notify(grant.enabled ? "服务器授权已暂停" : "服务器授权已恢复");
      await load(true);
    } catch (reason) {
      notify(messageOf(reason, "授权状态更新失败"), "error");
    } finally {
      setWorking("");
    }
  };

  const retry = async (id: number, target: "grant" | "node") => {
    setWorking(`${target}-${id}`);
    try {
      const path = target === "grant" ? `${base}/server-grants/${id}/retry` : `${base}/managed-nodes/${id}/retry`;
      await api.post(path, {});
      notify("同步任务已重新提交");
      await load(true);
    } catch (reason) {
      notify(messageOf(reason, "重试失败"), "error");
    } finally {
      setWorking("");
    }
  };

  const remove = async () => {
    if (!removeGrant) return;
    setWorking(`grant-${removeGrant.id}`);
    try {
      await api.delete(`${base}/server-grants/${removeGrant.id}`);
      notify(`${removeGrant.server_name} 的授权已撤销`);
      setRemoveGrant(null);
      await load(true);
    } catch (reason) {
      notify(messageOf(reason, "撤销授权失败"), "error");
    } finally {
      setWorking("");
    }
  };

  const availableServers = useMemo(() => servers.filter((server) => !grants.some((grant) => grant.server_id === server.id)), [grants, servers]);

  return (
    <>
      <div className="sg-layout">
        <div className="sg-tabs" role="tablist" aria-label="服务器授权视图">
          <button role="tab" aria-selected={tab === "grants"} className={tab === "grants" ? "is-active" : ""} onClick={() => setTab("grants")}><Server size={16} />服务器授权 <span>{grants.length}</span></button>
          <button role="tab" aria-selected={tab === "nodes"} className={tab === "nodes" ? "is-active" : ""} onClick={() => setTab("nodes")}><Gauge size={16} />已开通节点 <span>{nodes.length}</span></button>
          <IconButton label="刷新服务器授权" onClick={() => void load()} disabled={loading}><RefreshCw size={17} /></IconButton>
        </div>

        {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        {loading ? <div className="sg-center"><Spinner label="正在加载授权" /></div> : tab === "grants" ? (
          <div className="sg-stack">
            <div className="sg-section-actions"><span>每台服务器单独计算有效期和流量</span><Button onClick={() => setEditor("new")} disabled={!availableServers.length}><Plus size={16} />新增授权</Button></div>
            {!grants.length ? <EmptyState icon={<Server size={23} />} title="尚未授权服务器" description="新增授权后，用户才能看到该服务器的可开通节点" /> : (
              <div className="sg-card-list">{grants.map((grant) => <GrantCard key={grant.id} grant={grant} busy={working === `grant-${grant.id}`} onEdit={() => setEditor(grant)} onToggle={() => void updateEnabled(grant)} onRetry={() => void retry(grant.id, "grant")} onRemove={() => setRemoveGrant(grant)} />)}</div>
            )}
          </div>
        ) : (
          <div className="sg-stack">
            {!nodes.length ? <EmptyState icon={<Unplug size={23} />} title="用户尚未开通节点" description="用户从获授权服务器的目录开通后会显示在这里" /> : (
              <div className="sg-node-list">{nodes.map((node) => <ManagedNodeRow key={node.id} node={node} busy={working === `node-${node.id}`} onLimits={() => setLimitsEditor(node)} onRetry={() => void retry(node.id, "node")} />)}</div>
            )}
          </div>
        )}
      </div>

      {editor ? <GrantEditorDialog username={username} grant={editor === "new" ? undefined : editor} servers={editor === "new" ? availableServers : servers} onClose={() => setEditor(null)} onSaved={async (message) => { setEditor(null); notify(message); await load(true); }} /> : null}
      {limitsEditor ? <SelectionLimitsDialog username={username} node={limitsEditor} onClose={() => setLimitsEditor(null)} onSaved={async () => { setLimitsEditor(null); notify("节点覆盖限制已保存"); await load(true); }} /> : null}
      {removeGrant ? <ConfirmDialog title="撤销服务器授权" description={`撤销 ${removeGrant.server_name} 的授权后，本地访问会立即失效，并清理该用户在此服务器已开通的 ${removeGrant.active_node_count} 个节点。`} confirmLabel="确认撤销" working={working === `grant-${removeGrant.id}`} onCancel={() => !working && setRemoveGrant(null)} onConfirm={() => void remove()} /> : null}
    </>
  );
}

export function ServerGrantsDialog({ username, notify, onClose }: { username: string; notify: Notify; onClose: () => void }) {
  return <Dialog title={`服务器授权 · ${username}`} description="授权用户在指定服务器的发布节点上开通自己的凭据" onClose={onClose} wide><ServerGrantsPanel username={username} notify={notify} /></Dialog>;
}

function GrantCard({ grant, busy, onEdit, onToggle, onRetry, onRemove }: { grant: ServerGrant; busy: boolean; onEdit: () => void; onToggle: () => void; onRetry: () => void; onRemove: () => void }) {
  const state = getStateMeta(grant.state);
  const quotaPercent = grant.traffic_limit_bytes > 0 ? Math.min(100, grant.billed_bytes / grant.traffic_limit_bytes * 100) : 0;
  const online = grant.server_status === "connected" || grant.server_status === "online";
  return <article className="sg-grant-card">
    <div className="sg-grant-head"><span className={`sg-server-state ${online ? "is-online" : ""}`}><Server size={18} /></span><span><strong>{grant.server_name}</strong><small>{online ? "服务器在线" : "服务器离线"} · {grant.offer_count} 个可发布节点</small></span><Badge tone={state.tone}>{state.label}</Badge></div>
    <div className="sg-policy-grid">
      <span><small>有效期</small><strong>{formatDate(grant.expires_at)}</strong></span>
      <span><small>节点名额</small><strong>{grant.active_node_count} / {grant.max_active_nodes || "不限"}</strong></span>
      <span><small>速率</small><strong>{grant.speed_limit_mbps ? `${grant.speed_limit_mbps} Mbps` : "不限速"}</strong></span>
      <span><small>并发连接</small><strong>{grant.connection_limit || "不限"}</strong></span>
      <span><small>计费方向</small><strong>{billingLabel(grant.billing_mode)}</strong></span>
      <span><small>流量额度</small><strong>{grant.traffic_limit_bytes ? `${formatBytes(grant.billed_bytes)} / ${formatBytes(grant.traffic_limit_bytes)}` : "不限"}</strong></span>
    </div>
    <div className="sg-protocol-summary"><small>允许组合</small><span>{grant.allowed_protocol_profiles?.length
      ? grant.allowed_protocol_profiles.map((profile) => <Badge key={profile}>{managedGrantProtocolProfileLabel(profile)}</Badge>)
      : grant.allowed_protocols?.length
        ? grant.allowed_protocols.map((protocol) => <Badge key={protocol}>{managedGrantProtocolLabel(protocol)} · 全部组合</Badge>)
        : <Badge tone="info">全部协议组合</Badge>}</span></div>
    {grant.traffic_limit_bytes ? <div className="sg-quota"><span><i style={{ width: `${quotaPercent}%` }} /></span><small>{quotaPercent.toFixed(0)}%</small></div> : null}
    {grant.last_error ? <p className="sg-item-error" title={grant.last_error}>{grant.last_error}</p> : null}
    <div className="sg-card-actions">
      <IconButton label={`编辑 ${grant.server_name} 授权`} onClick={onEdit} disabled={busy}><Pencil size={16} /></IconButton>
      <IconButton label={`${grant.enabled ? "暂停" : "恢复"} ${grant.server_name} 授权`} onClick={onToggle} disabled={busy}>{grant.enabled ? <Pause size={16} /> : <Play size={16} />}</IconButton>
      <IconButton label={`续期 ${grant.server_name} 授权`} onClick={onEdit} disabled={busy}><CalendarClock size={16} /></IconButton>
      {(grant.state === "error" || grant.last_error) ? <IconButton label={`重试 ${grant.server_name} 同步`} onClick={onRetry} disabled={busy}><RotateCw size={16} /></IconButton> : null}
      <IconButton label={`撤销 ${grant.server_name} 授权`} onClick={onRemove} disabled={busy}><Trash2 size={16} /></IconButton>
    </div>
  </article>;
}

function ManagedNodeRow({ node, busy, onLimits, onRetry }: { node: ManagedNodeSelection; busy: boolean; onLimits: () => void; onRetry: () => void }) {
  const state = getStateMeta(node.state);
  return <article className="sg-node-row">
    <span className="sg-protocol">{node.protocol?.toUpperCase() || "-"}</span>
    <span className="sg-node-name"><strong>{node.node_name}</strong><small>{node.server_name} · #{node.node_id}</small>{node.last_error ? <small className="sg-item-error" title={node.last_error}>{node.last_error}</small> : null}</span>
    <span className="sg-node-policy"><small>{node.effective_speed_limit_mbps ? `${node.effective_speed_limit_mbps} Mbps` : "不限速"}</small><small>{node.effective_connection_limit ? `${node.effective_connection_limit} 并发` : "并发不限"}</small><small>{billingLabel(node.effective_billing_mode)}</small></span>
    <Badge tone={state.tone}>{state.label}</Badge>
    <span className="sg-row-actions"><IconButton label={`设置 ${node.node_name} 限制`} onClick={onLimits} disabled={busy}><Settings2 size={16} /></IconButton>{["error", "provisioning"].includes(node.state) ? <IconButton label={`重试 ${node.node_name}`} onClick={onRetry} disabled={busy}><RotateCw size={16} /></IconButton> : null}</span>
  </article>;
}

function GrantEditorDialog({ username, grant, servers, onClose, onSaved }: { username: string; grant?: ServerGrant; servers: RemoteServer[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [form, setForm] = useState(() => formFromGrant(grant));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [pendingNarrowedPayload, setPendingNarrowedPayload] = useState<ReturnType<typeof payloadFromForm> | null>(null);
  const base = `/api/admin/users/${encodeURIComponent(username)}/server-grants`;

  const toggleProtocolProfile = (profile: ManagedGrantProtocolProfile) => {
    const nextProfiles = form.allowedProtocolProfiles.length === 0
      ? [profile]
      : form.allowedProtocolProfiles.includes(profile)
        ? form.allowedProtocolProfiles.filter((item) => item !== profile)
        : [...form.allowedProtocolProfiles, profile];
    setError(nextProfiles.length === 0 ? "请选择至少一个协议组合，或选择“全部组合”" : "");
    setForm({ ...form, allowedProtocolProfiles: nextProfiles, protocolProfilesExplicit: true });
  };

  const toggleProtocolFamily = (protocol: ManagedGrantProtocol) => {
    const familyProfiles = managedGrantProtocolGroups.find((group) => group.value === protocol)?.profiles.map((profile) => profile.value) ?? [];
    const selected = new Set(form.allowedProtocolProfiles);
    const entireFamilySelected = form.allowedProtocolProfiles.length > 0 && familyProfiles.every((profile) => selected.has(profile));
    const nextProfiles = form.allowedProtocolProfiles.length === 0
      ? familyProfiles
      : entireFamilySelected
        ? form.allowedProtocolProfiles.filter((profile) => !familyProfiles.includes(profile))
        : [...form.allowedProtocolProfiles, ...familyProfiles.filter((profile) => !selected.has(profile))];
    setError(nextProfiles.length === 0 ? "请选择至少一个协议组合，或选择“全部组合”" : "");
    setForm({ ...form, allowedProtocolProfiles: nextProfiles, protocolProfilesExplicit: true });
  };

  const save = async (payload: ReturnType<typeof payloadFromForm>) => {
    setWorking(true);
    try {
      if (grant) await api.put(`${base}/${grant.id}`, payload);
      else await api.post(base, payload);
      onSaved(grant ? `${grant.server_name} 的授权已更新` : "服务器授权已创建");
    } catch (reason) {
      setError(messageOf(reason, "授权保存失败"));
    } finally {
      setWorking(false);
      setPendingNarrowedPayload(null);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!form.serverID) return setError("请选择服务器");
    if (!form.startsAt) return setError("请选择生效时间");
    if (form.expiresAt && new Date(form.expiresAt) <= new Date(form.startsAt)) return setError("到期时间必须晚于生效时间");
    if (form.protocolProfilesExplicit && form.allowedProtocolProfiles.length === 0) return setError("请选择至少一个协议组合，或选择“全部组合”");
    const payload = payloadFromForm(form, grant?.version ?? 1);
    if (grant && protocolScopeNarrows(
      grant.allowed_protocols ?? [],
      grant.allowed_protocol_profiles ?? [],
      payload.allowed_protocols,
      payload.allowed_protocol_profiles,
    )) {
      setPendingNarrowedPayload(payload);
      return;
    }
    void save(payload);
  };

  const allProtocolProfilesAllowed = !form.protocolProfilesExplicit && form.allowedProtocols.length === 0 && form.allowedProtocolProfiles.length === 0;

  return <><Dialog title={grant ? `编辑 ${grant.server_name} 授权` : "新增服务器授权"} description="0 表示不限；到期后用户节点会立即从订阅排除" onClose={onClose} wide>
    <form className="form-stack sg-editor" onSubmit={submit}>
      {error ? <ErrorState message={error} /> : null}
      <div className="sg-form-grid">
        <Field label="授权服务器"><select required disabled={Boolean(grant)} value={form.serverID} onChange={(event) => setForm({ ...form, serverID: event.target.value })}><option value="">请选择服务器</option>{servers.map((server) => <option key={server.id} value={server.id}>{server.name}{server.status === "connected" || server.status === "online" ? " · 在线" : " · 离线"}</option>)}</select></Field>
        <div className="sg-toggle-field"><Toggle checked={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })} label="允许创建和使用节点" /></div>
        <Field label="生效时间"><input required type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} /></Field>
        <Field label="到期时间" hint="留空表示长期有效"><input type="datetime-local" value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} /></Field>
        <Field label="最大已开通节点" hint="0 表示不限"><input type="number" min="0" step="1" value={form.maxNodes} onChange={(event) => setForm({ ...form, maxNodes: event.target.value })} /></Field>
        <Field label="限速 (Mbps)" hint="0 表示不限速"><input type="number" min="0" step="0.1" value={form.speed} onChange={(event) => setForm({ ...form, speed: event.target.value })} /></Field>
        <Field label="并发连接数" hint="0 表示不限"><input type="number" min="0" step="1" value={form.connections} onChange={(event) => setForm({ ...form, connections: event.target.value })} /></Field>
        <Field label="流量额度 (GB)" hint="0 表示不限"><input type="number" min="0" step="0.01" value={form.trafficGB} onChange={(event) => setForm({ ...form, trafficGB: event.target.value })} /></Field>
      </div>
      <fieldset className="sg-protocol-fieldset">
        <legend>允许使用的协议组合</legend>
        <p>可精确到传输与加密组合；选择“全部组合”表示不限制。收窄范围会立即停用未选组合的已有节点。</p>
        <label className={`sg-protocol-all ${allProtocolProfilesAllowed ? "is-selected" : ""}`}>
          <input type="checkbox" aria-label="全部协议组合" checked={allProtocolProfilesAllowed} onChange={() => { setError(""); setForm({ ...form, allowedProtocols: [], allowedProtocolProfiles: [], protocolProfilesExplicit: false }); }} />
          <span><strong>全部组合</strong><small>不限制协议、传输或加密方式</small></span>
        </label>
        <div className="sg-protocol-groups" aria-label="允许创建的协议组合">
          {managedGrantProtocolGroups.map((group) => {
            const allAllowed = form.allowedProtocolProfiles.length > 0 && group.profiles.every((profile) => form.allowedProtocolProfiles.includes(profile.value));
            return <section key={group.value} className={allAllowed ? "is-selected" : ""}>
              <label className="sg-protocol-group-head">
                <input type="checkbox" aria-label={`${group.label} 全部组合`} checked={allAllowed} onChange={() => toggleProtocolFamily(group.value)} />
                <strong>{group.label}</strong><small>全部组合</small>
              </label>
              <div className="sg-protocol-options">
                {group.profiles.map((profile) => {
                  const selected = form.allowedProtocolProfiles.includes(profile.value);
                  return <label key={profile.value} className={selected ? "is-selected" : ""}>
                    <input type="checkbox" aria-label={`${group.label} ${profile.label}`} checked={selected} onChange={() => toggleProtocolProfile(profile.value)} />
                    <span><strong>{profile.label}</strong><small>{profile.detail}</small></span>
                  </label>;
                })}
              </div>
            </section>;
          })}
        </div>
      </fieldset>
      <Field label="流量计算方向"><div className="sg-choice" role="group" aria-label="流量计算方向"><button type="button" className={form.billing === "download" ? "is-active" : ""} onClick={() => setForm({ ...form, billing: "download" })}>仅下行</button><button type="button" className={form.billing === "both" ? "is-active" : ""} onClick={() => setForm({ ...form, billing: "both" })}>上下行</button></div></Field>
      <div className="sg-form-grid"><Field label="额度重置"><select value={form.resetPolicy} onChange={(event) => setForm({ ...form, resetPolicy: event.target.value as GrantFormValue["resetPolicy"] })}><option value="none">不自动重置</option><option value="monthly">每月重置</option></select></Field>{form.resetPolicy === "monthly" ? <Field label="每月重置日"><input type="number" min="1" max="28" value={form.resetDay} onChange={(event) => setForm({ ...form, resetDay: event.target.value })} /></Field> : <span />}</div>
      <div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={working}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在保存" /> : <><Server size={16} />保存授权</>}</Button></div>
    </form>
  </Dialog>{pendingNarrowedPayload ? <ConfirmDialog title="确认收窄协议组合" description="保存后，已有的未选协议组合节点会立即停用；即使以后重新允许这些组合，用户也需要重新开通对应节点。" confirmLabel="确认收窄并保存" working={working} onCancel={() => setPendingNarrowedPayload(null)} onConfirm={() => void save(pendingNarrowedPayload)} /> : null}</>;
}

function SelectionLimitsDialog({ username, node, onClose, onSaved }: { username: string; node: ManagedNodeSelection; onClose: () => void; onSaved: () => void }) {
  const [speed, setSpeed] = useState(node.speed_limit_override_mbps == null ? "" : String(node.speed_limit_override_mbps));
  const [connections, setConnections] = useState(node.connection_limit_override == null ? "" : String(node.connection_limit_override));
  const [billing, setBilling] = useState<"" | ManagedBillingMode>(node.billing_mode_override ?? "");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      await api.put(`/api/admin/users/${encodeURIComponent(username)}/managed-nodes/${node.id}/limits`, {
        speed_limit_override_mbps: speed === "" ? null : limitedNumber(speed),
        connection_limit_override: connections === "" ? null : Math.floor(limitedNumber(connections)),
        billing_mode_override: billing || null,
      });
      onSaved();
    } catch (reason) { setError(messageOf(reason, "节点限制保存失败")); }
    finally { setWorking(false); }
  };
  return <Dialog title={`节点限制 · ${node.node_name}`} description="留空继承服务器授权；填写 0 表示显式不限" onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<Field label="限速覆盖 (Mbps)" hint={`当前生效：${node.effective_speed_limit_mbps ? `${node.effective_speed_limit_mbps} Mbps` : "不限速"}`}><input type="number" min="0" step="0.1" value={speed} onChange={(event) => setSpeed(event.target.value)} placeholder="继承服务器授权" /></Field><Field label="并发连接覆盖" hint={`当前生效：${node.effective_connection_limit || "不限"}`}><input type="number" min="0" step="1" value={connections} onChange={(event) => setConnections(event.target.value)} placeholder="继承服务器授权" /></Field><Field label="计费方向覆盖"><select value={billing} onChange={(event) => setBilling(event.target.value as typeof billing)}><option value="">继承服务器授权（{billingLabel(node.effective_billing_mode)}）</option><option value="download">仅下行</option><option value="both">上下行</option></select></Field><div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={working}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在保存" /> : <><Settings2 size={16} />保存限制</>}</Button></div></form>
  </Dialog>;
}
