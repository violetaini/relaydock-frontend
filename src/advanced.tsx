import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bot,
  Cable,
  Cloud,
  Copy,
  Database,
  Download,
  FileClock,
  FileText,
  Globe2,
  Link2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Share2,
  ShieldCheck,
  Square,
  TicketCheck,
  Trash2,
  Unplug,
  Upload,
  X,
} from "lucide-react";
import { api, getToken, request } from "./api";
import type {
  RemoteServer,
  ServerListResponse,
  SharedServerToken,
  TunnelChain,
  TunnelHop,
  TunnelInfo,
  TunnelsResponse,
} from "./types";
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
import "./advanced-ops.css";

type Notify = (message: string, tone?: "success" | "error") => void;
type AdvancedTab = "tunnels" | "warp" | "federation" | "backup" | "debug" | "invites";

const advancedTabs: Array<{ key: AdvancedTab; label: string; icon: typeof Cable }> = [
  { key: "tunnels", label: "隧道", icon: Cable },
  { key: "warp", label: "WARP", icon: Cloud },
  { key: "federation", label: "联邦分享", icon: Share2 },
  { key: "backup", label: "备份恢复", icon: Database },
  { key: "debug", label: "Debug 日志", icon: FileText },
  { key: "invites", label: "TG 邀请码", icon: Bot },
];

function formatDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function readString(value: Record<string, unknown> | null, keys: string[]): string {
  if (!value) return "";
  for (const key of keys) {
    const item = value[key];
    if (typeof item === "string" && item.trim()) return item;
  }
  return "";
}

function advancedLocation(): { tab: AdvancedTab; serverID: number } {
  const query = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const candidate = query.get("tab") as AdvancedTab | null;
  const serverID = Number(query.get("server"));
  return {
    tab: candidate && advancedTabs.some((item) => item.key === candidate) ? candidate : "tunnels",
    serverID: Number.isInteger(serverID) && serverID > 0 ? serverID : 0,
  };
}

export function AdvancedPage({ notify }: { notify: Notify }) {
  const initial = advancedLocation();
  const [tab, setTab] = useState<AdvancedTab>(initial.tab);
  return (
    <>
      <PageHeader title="高级管理" description="跨服务器网络、共享与系统运维能力" />
      <div className="advanced-tabs" role="tablist" aria-label="高级管理分类">
        {advancedTabs.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "is-active" : ""} onClick={() => setTab(key)}>
            <Icon size={17} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      {tab === "tunnels" ? <TunnelsPanel notify={notify} /> : null}
      {tab === "warp" ? <WarpPanel notify={notify} initialServerID={initial.serverID} /> : null}
      {tab === "federation" ? <FederationPanel notify={notify} /> : null}
      {tab === "backup" ? <BackupPanel notify={notify} /> : null}
      {tab === "debug" ? <DebugLogsPanel notify={notify} /> : null}
      {tab === "invites" ? <TGBotInvitesPanel notify={notify} /> : null}
    </>
  );
}

type RemoteActionResponse = { success?: boolean; message?: string; error?: string; warning?: string; runtime_warning?: string };

function assertRemoteActionSucceeded(response: RemoteActionResponse, fallback: string) {
  if (response.success !== true) throw new Error(response.error || response.message || fallback);
  if (response.runtime_warning?.trim() || response.warning?.trim()) {
    throw new Error(response.runtime_warning?.trim() || response.message?.trim() || response.warning?.trim() || fallback);
  }
}

function tunnelNetworkLabel(network: string): string {
  const values = new Set(network.toLowerCase().split(/[,_]/).map((value) => value.trim()).filter(Boolean));
  if (values.has("tcp") && values.has("udp")) return "TCP + UDP";
  if (values.has("udp")) return "UDP";
  return "TCP";
}

export function TunnelsPanel({ notify }: { notify: Notify }) {
  const [tunnels, setTunnels] = useState<TunnelInfo[]>([]);
  const [chains, setChains] = useState<TunnelChain[]>([]);
  const [servers, setServers] = useState<RemoteServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ tunnel?: TunnelInfo; chain?: TunnelChain } | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [tunnelResponse, serverResponse] = await Promise.all([
        api.get<TunnelsResponse>("/api/admin/tunnels"),
        api.get<ServerListResponse>("/api/admin/remote-servers"),
      ]);
      setTunnels(tunnelResponse.tunnels ?? []);
      setChains(tunnelResponse.chains ?? []);
      setServers(serverResponse.servers ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "隧道列表加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const removeInbound = async (hop: Pick<TunnelHop, "server_id" | "tag">) => {
    const response = await api.post<RemoteActionResponse>(`/api/admin/remote/inbounds?server_id=${hop.server_id}`, { action: "remove", tag: hop.tag });
    assertRemoteActionSucceeded(response, `删除 ${hop.tag} 失败`);
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setWorking(true);
    try {
      if (pendingDelete.chain) {
        let removed = 0;
        const failures: string[] = [];
        for (const hop of [...pendingDelete.chain.hops].reverse()) {
          try {
            await removeInbound(hop);
            removed++;
          } catch {
            failures.push(hop.server_name);
          }
        }
        setPendingDelete(null);
        await load();
        if (failures.length > 0) {
          notify(`已移除 ${removed}/${pendingDelete.chain.hops.length} 个可达跳点；请检查 ${failures.join("、")}`, "error");
          return;
        }
        notify(`已移除 ${removed} 个当前可达跳点`);
        return;
      } else if (pendingDelete.tunnel?.kind === "inbound") {
        await removeInbound(pendingDelete.tunnel);
      } else if (pendingDelete.tunnel) {
        const tunnel = pendingDelete.tunnel;
        const routing = await api.get<RemoteActionResponse & { routing?: { rules?: Array<{ outboundTag?: string }> } }>(`/api/admin/remote/routing?server_id=${tunnel.server_id}`);
        assertRemoteActionSucceeded(routing, `读取 ${tunnel.tag} 路由失败`);
        const index = (routing.routing?.rules ?? []).findIndex((rule) => rule.outboundTag === tunnel.tag);
        if (index >= 0) {
          const routingResponse = await api.post<RemoteActionResponse>(`/api/admin/remote/routing?server_id=${tunnel.server_id}`, { action: "remove_rule", index });
          assertRemoteActionSucceeded(routingResponse, `删除 ${tunnel.tag} 路由规则失败`);
        }
        const outboundResponse = await api.post<RemoteActionResponse>(`/api/admin/remote/outbounds?server_id=${tunnel.server_id}`, { action: "remove", tag: tunnel.tag });
        assertRemoteActionSucceeded(outboundResponse, `删除 ${tunnel.tag} 出站失败`);
      }
      notify("隧道已删除");
      setPendingDelete(null);
      await load();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "删除隧道失败", "error");
    } finally {
      setWorking(false);
    }
  };

  const connectedServers = servers.filter((server) => server.ws_connected || server.status === "connected" || server.status === "online");
  return (
    <div className="advanced-stack">
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      <div className="advanced-summary">
        <span><strong>{chains.length}</strong><small>链式转发</small></span>
        <span><strong>{tunnels.length}</strong><small>单跳隧道</small></span>
        <span><strong>{connectedServers.length}</strong><small>可用服务器</small></span>
        <Button onClick={() => setShowCreate(true)} disabled={connectedServers.length < 2}><Plus size={16} />创建链路</Button>
      </div>

      <Surface className="table-surface advanced-surface">
        <div className="surface-heading"><div><h2>链式端口转发</h2></div><IconButton label="刷新隧道" onClick={() => void load()}><RefreshCw size={17} /></IconButton></div>
        {loading ? <div className="center-state"><Spinner /></div> : chains.length === 0 ? <EmptyState icon={<Cable size={22} />} title="暂无链式隧道" /> : (
          <div className="table-wrap"><table><thead><tr><th>名称</th><th>链路</th><th>入口</th><th>最终目标</th><th aria-label="操作" /></tr></thead><tbody>{chains.map((chain) => (
            <tr key={chain.id || `${chain.label}-${chain.hops.map((hop) => `${hop.server_id}:${hop.tag}`).join("-")}`}>
              <td><strong>{chain.label}</strong><small className="cell-note">{chain.hops.length} 跳</small></td>
              <td><div className="chain-path">{chain.hops.map((hop, index) => <span key={hop.tag}><span>{hop.server_name}</span>{index < chain.hops.length - 1 ? <ArrowRight size={13} /> : null}</span>)}</div></td>
              <td><code className="inline-code">:{chain.entry_port}</code></td>
              <td><code className="inline-code">{chain.final_target}</code></td>
              <td className="actions-cell"><IconButton label={`删除链路 ${chain.label} ${chain.hops[0]?.server_name || chain.entry_server}:${chain.entry_port}`} onClick={() => setPendingDelete({ chain })}><Trash2 size={17} /></IconButton></td>
            </tr>
          ))}</tbody></table></div>
        )}
      </Surface>

      <Surface className="table-surface advanced-surface">
        <div className="surface-heading"><div><h2>独立隧道</h2></div></div>
        {loading ? <div className="center-state"><Spinner /></div> : tunnels.length === 0 ? <EmptyState icon={<Unplug size={22} />} title="暂无独立隧道" /> : (
          <div className="table-wrap"><table><thead><tr><th>标签</th><th>服务器</th><th>入口</th><th>目标</th><th>类型</th><th aria-label="操作" /></tr></thead><tbody>{tunnels.map((tunnel) => (
            <tr key={`${tunnel.server_id}-${tunnel.tag}`}>
              <td><strong>{tunnel.tag}</strong></td>
              <td>{tunnel.server_name}{tunnel.is_federated ? <small className="cell-note">联邦服务器</small> : null}</td>
              <td><code className="inline-code">:{tunnel.listen_port || "-"}</code></td>
              <td><code className="inline-code">{tunnel.target_address || "-"}:{tunnel.target_port || "-"}</code></td>
              <td><Badge tone={tunnel.kind === "inbound" ? "info" : "neutral"}>{tunnel.kind === "inbound" ? `任意门 · ${tunnelNetworkLabel(tunnel.network || "tcp")}` : "路由"}</Badge></td>
              <td className="actions-cell"><IconButton label={`删除隧道 ${tunnel.tag}`} onClick={() => setPendingDelete({ tunnel })}><Trash2 size={17} /></IconButton></td>
            </tr>
          ))}</tbody></table></div>
        )}
      </Surface>

      {showCreate ? <CreateTunnelDialog servers={connectedServers} onClose={() => setShowCreate(false)} onCreated={async () => { setShowCreate(false); notify("链式隧道已创建"); await load(); }} /> : null}
      {pendingDelete ? <ConfirmDialog title={pendingDelete.chain ? "删除链式隧道" : "删除隧道"} description={pendingDelete.chain ? `将移除入口服务器 ${pendingDelete.chain.hops[0]?.server_name || pendingDelete.chain.entry_server}:${pendingDelete.chain.entry_port} 的 ${pendingDelete.chain.hops.length} 个可达跳点；离线服务器不会出现在本次结果中，恢复连接后仍需复查。` : `将从 ${pendingDelete.tunnel?.server_name ?? "服务器"} 删除“${pendingDelete.tunnel?.tag ?? ""}”及其路由配置。`} confirmLabel="确认删除" working={working} onCancel={() => setPendingDelete(null)} onConfirm={() => void remove()} /> : null}
    </div>
  );
}

function CreateTunnelDialog({ servers, onClose, onCreated }: { servers: RemoteServer[]; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ label: "", entry_port: "", target_address: "", target_port: "" });
  const [selected, setSelected] = useState<number[]>([]);
  const [candidate, setCandidate] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const available = servers.filter((server) => !selected.includes(server.id));
  const move = (index: number, direction: -1 | 1) => {
    const next = [...selected];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setSelected(next);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!/^[A-Za-z0-9-]{2,32}$/.test(form.label.trim())) return setError("名称只能包含字母、数字和短横线，长度 2-32");
    if (selected.length < 2) return setError("至少选择两台服务器");
    setWorking(true);
    try {
      await api.post("/api/admin/tunnel-chains", {
        label: form.label.trim(),
        server_ids: selected,
        entry_port: Number(form.entry_port) || 0,
        target_address: form.target_address.trim(),
        target_port: Number(form.target_port),
      });
      onCreated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建链路失败");
    } finally {
      setWorking(false);
    }
  };
  return (
    <Dialog title="创建链式端口转发" description="按顺序在多台服务器间建立 TCP/UDP 转发" onClose={onClose} wide>
      <form className="form-stack" onSubmit={submit}>
        {error ? <ErrorState message={error} /> : null}
        <div className="form-grid"><Field label="链路名称"><input autoFocus required value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="hk-us-exit" /></Field><Field label="全链路端口" hint="所有服务器共用；留空自动选择"><input type="number" min="1024" max="65535" value={form.entry_port} onChange={(event) => setForm({ ...form, entry_port: event.target.value })} /></Field></div>
        <div className="form-grid"><Field label="最终目标地址"><input required value={form.target_address} onChange={(event) => setForm({ ...form, target_address: event.target.value })} placeholder="example.com" /></Field><Field label="最终目标端口"><input required type="number" min="1" max="65535" value={form.target_port} onChange={(event) => setForm({ ...form, target_port: event.target.value })} placeholder="443" /></Field></div>
        <Field label="添加服务器"><div className="inline-form"><select value={candidate} onChange={(event) => setCandidate(event.target.value)}><option value="">选择服务器</option>{available.map((server) => <option key={server.id} value={server.id}>{server.name} · {server.ip_address}</option>)}</select><Button type="button" variant="secondary" disabled={!candidate} onClick={() => { setSelected([...selected, Number(candidate)]); setCandidate(""); }}><Plus size={16} />加入</Button></div></Field>
        <div className="route-order">{selected.length === 0 ? <span className="muted">尚未选择服务器</span> : selected.map((id, index) => { const server = servers.find((item) => item.id === id); return <div key={id}><span className="route-index">{index + 1}</span><span><strong>{server?.name}</strong><small>{server?.ip_address}</small></span><div><IconButton type="button" label="上移" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></IconButton><IconButton type="button" label="下移" disabled={index === selected.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></IconButton><IconButton type="button" label="移除" onClick={() => setSelected(selected.filter((value) => value !== id))}><X size={16} /></IconButton></div></div>; })}</div>
        <div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working || selected.length < 2}>{working ? <Spinner label="正在创建" /> : <><Cable size={16} />创建链路</>}</Button></div>
      </form>
    </Dialog>
  );
}

export function WarpPanel({ notify, initialServerID = 0 }: { notify?: Notify; initialServerID?: number } = {}) {
  const [servers, setServers] = useState<RemoteServer[]>([]);
  const [serverID, setServerID] = useState(initialServerID);
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusLoading, setStatusLoading] = useState(false);
  const [working, setWorking] = useState<"install" | "license" | "remove" | null>(null);
  const [pendingAction, setPendingAction] = useState<"install" | "remove" | null>(null);
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [license, setLicense] = useState("");
  const [error, setError] = useState("");
  const statusRequest = useRef(0);

  const loadServers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get<ServerListResponse>("/api/admin/remote-servers");
      const list = (response.servers ?? []).filter((server) => !server.is_federated);
      setServers(list);
      setServerID((current) => current && list.some((server) => server.id === current) ? current : list[0]?.id || 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "服务器列表加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    const requestID = ++statusRequest.current;
    setStatus(null);
    if (!serverID) {
      setStatusLoading(false);
      return;
    }
    setStatusLoading(true);
    setError("");
    try {
      const response = await api.get<Record<string, unknown>>(`/api/admin/remote/warp/status?server_id=${serverID}`);
      if (statusRequest.current === requestID) setStatus(response);
    } catch (reason) {
      if (statusRequest.current === requestID) setError(reason instanceof Error ? reason.message : "WARP 状态加载失败");
    } finally {
      if (statusRequest.current === requestID) setStatusLoading(false);
    }
  }, [serverID]);

  useEffect(() => { void loadServers(); }, [loadServers]);
  useEffect(() => {
    setLicense("");
    setLicenseOpen(false);
    setPendingAction(null);
  }, [serverID]);
  useEffect(() => {
    void loadStatus();
    return () => { statusRequest.current++; };
  }, [loadStatus]);

  const closeLicense = () => {
    setLicense("");
    setLicenseOpen(false);
  };

  const runAction = async (action: "install" | "license" | "remove") => {
    if (!serverID || working) return;
    setWorking(action);
    setError("");
    try {
      const body = action === "license" ? { license: license.trim() } : undefined;
      const response = await api.post<RemoteActionResponse>(`/api/admin/remote/warp/${action}?server_id=${serverID}`, body);
      assertRemoteActionSucceeded(response, "WARP 操作失败");
      setPendingAction(null);
      if (action === "license") {
        closeLicense();
      }
      await loadStatus();
      notify?.(action === "install" ? "WARP 已安装" : action === "license" ? "WARP License 已更新" : "WARP 已移除");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "WARP 操作失败";
      setPendingAction(null);
      if (action === "license") closeLicense();
      await loadStatus();
      setError(message);
    } finally {
      setWorking(null);
    }
  };

  const selectedServer = servers.find((server) => server.id === serverID);
  const installed = Boolean(status?.installed ?? status?.warp_installed ?? status?.registered ?? status?.enabled ?? selectedServer?.warp_installed);
  const addressV4 = readString(status, ["addr_v4", "ipv4", "warp_ipv4", "address_v4"]);
  const addressV6 = readString(status, ["addr_v6", "ipv6", "warp_ipv6", "address_v6"]);
  const account = status?.license_active === true ? "License 已配置" : readString(status, ["account_type", "plan", "account"]) || (installed ? "标准账户" : "");
  const stateLabel = readString(status, ["status", "state", "message"]);
  return (
    <div className="advanced-stack">
      {error ? <ErrorState message={error} onRetry={() => void (servers.length ? loadStatus() : loadServers())} /> : null}
      <Surface className="advanced-surface warp-surface">
        <div className="surface-heading control-heading"><div><h2>WARP 出站</h2></div><div className="surface-actions"><Field label="服务器"><select value={serverID} onChange={(event) => setServerID(Number(event.target.value))}>{servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}</select></Field><IconButton label="刷新 WARP 状态" onClick={() => void loadStatus()}><RefreshCw size={17} /></IconButton></div></div>
        {loading || statusLoading ? <div className="center-state"><Spinner /></div> : servers.length === 0 ? <EmptyState icon={<Server size={22} />} title="暂无可管理服务器" /> : (
          <div className="warp-layout">
            <div className={`warp-state ${installed ? "is-ready" : ""}`}><span><Cloud size={30} /></span><div><Badge tone={installed ? "good" : "neutral"}>{installed ? "已注册" : "未注册"}</Badge><h3>{selectedServer?.name}</h3><p>{stateLabel || (installed ? "WARP 账户已注册" : "尚未注册 WARP")}</p></div></div>
            <div className="warp-facts"><div><small>IPv4</small><strong>{addressV4 || "-"}</strong></div><div><small>IPv6</small><strong>{addressV6 || "-"}</strong></div><div><small>账户类型</small><strong>{account || "-"}</strong></div></div>
            <div className="warp-actions">
              {!installed ? <Button disabled={working !== null || selectedServer?.status !== "connected"} onClick={() => setPendingAction("install")}><Cloud size={16} />安装 WARP</Button> : <>
                <Button variant="secondary" disabled={working !== null} onClick={() => setLicenseOpen(true)}><TicketCheck size={16} />更新 License</Button>
                <Button variant="danger" disabled={working !== null} onClick={() => setPendingAction("remove")}><Trash2 size={16} />移除 WARP</Button>
              </>}
            </div>
          </div>
        )}
      </Surface>
      {licenseOpen ? <Dialog title="更新 WARP License" description={`应用到 ${selectedServer?.name ?? "当前服务器"}`} onClose={closeLicense} dismissible={working !== "license"}>
        <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void runAction("license"); }}>
          <Field label="License Key" hint="密钥只会发送给当前服务器，不会显示在状态页"><input autoFocus required type="password" autoComplete="off" value={license} onChange={(event) => setLicense(event.target.value)} /></Field>
          <div className="dialog-actions"><Button type="button" variant="secondary" disabled={working !== null} onClick={closeLicense}>取消</Button><Button type="submit" disabled={working !== null || !license.trim()}>{working === "license" ? <Spinner label="正在更新" /> : "确认更新"}</Button></div>
        </form>
      </Dialog> : null}
      {pendingAction ? <ConfirmDialog
        title={pendingAction === "install" ? "安装 WARP" : "移除 WARP"}
        description={pendingAction === "install" ? `将在 ${selectedServer?.name ?? "当前服务器"} 注册 WARP，并写入 warp-v4 与 warp-v6 出站。` : `将从 ${selectedServer?.name ?? "当前服务器"} 注销 WARP，并移除对应 Xray 出站。使用这些出站的路由会失效。`}
        confirmLabel={pendingAction === "install" ? "确认安装" : "确认移除"}
        tone={pendingAction === "install" ? "primary" : "danger"}
        working={working !== null}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => void runAction(pendingAction)}
      /> : null}
    </div>
  );
}

function FederationPanel({ notify }: { notify: Notify }) {
  const [servers, setServers] = useState<RemoteServer[]>([]);
  const [serverID, setServerID] = useState(0);
  const [shares, setShares] = useState<SharedServerToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [secret, setSecret] = useState("");
  const [pendingRevoke, setPendingRevoke] = useState<SharedServerToken | null>(null);
  const [pendingRemove, setPendingRemove] = useState<RemoteServer | null>(null);
  const [working, setWorking] = useState(false);
  const shareRequest = useRef(0);

  const loadServers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get<ServerListResponse>("/api/admin/remote-servers");
      const list = response.servers ?? [];
      setServers(list);
      const owned = list.filter((server) => !server.is_federated);
      setServerID((current) => current && owned.some((server) => server.id === current) ? current : owned[0]?.id || 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "联邦服务器加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadShares = useCallback(async () => {
    const requestID = ++shareRequest.current;
    setShares([]);
    if (!serverID) return;
    try {
      const response = await api.get<{ shares: SharedServerToken[] | null }>(`/api/admin/server-share/list?server_id=${serverID}`);
      if (shareRequest.current === requestID) setShares(response.shares ?? []);
    } catch (reason) {
      if (shareRequest.current === requestID) setError(reason instanceof Error ? reason.message : "分享列表加载失败");
    }
  }, [serverID]);

  useEffect(() => { void loadServers(); }, [loadServers]);
  useEffect(() => {
    void loadShares();
    return () => { shareRequest.current++; };
  }, [loadShares]);

  const revoke = async () => {
    if (!pendingRevoke) return;
    setWorking(true);
    try {
      await api.post("/api/admin/server-share/revoke", { id: pendingRevoke.id });
      notify("分享令牌已吊销");
      setPendingRevoke(null);
      await loadShares();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "吊销失败", "error");
    } finally {
      setWorking(false);
    }
  };

  const removeReceived = async () => {
    if (!pendingRemove) return;
    setWorking(true);
    try {
      const response = await api.post<{ success: boolean; message?: string }>("/api/admin/remote-servers/delete", { id: pendingRemove.id });
      if (!response.success) throw new Error(response.message || "移除失败");
      notify("已移除接收的服务器");
      setPendingRemove(null);
      await loadServers();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "移除失败", "error");
    } finally {
      setWorking(false);
    }
  };

  const owned = servers.filter((server) => !server.is_federated);
  const received = servers.filter((server) => server.is_federated);
  return (
    <div className="advanced-stack">
      {error ? <ErrorState message={error} onRetry={() => void loadServers()} /> : null}
      <Surface className="table-surface advanced-surface">
        <div className="surface-heading control-heading"><div><h2>我分享的服务器</h2></div><div className="surface-actions"><Field label="服务器"><select value={serverID} onChange={(event) => setServerID(Number(event.target.value))}>{owned.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}</select></Field><Button onClick={() => setShowCreate(true)} disabled={!serverID}><Plus size={16} />创建分享</Button></div></div>
        {loading ? <div className="center-state"><Spinner /></div> : shares.length === 0 ? <EmptyState icon={<Share2 size={22} />} title="暂无有效分享" /> : <div className="table-wrap"><table><thead><tr><th>标签</th><th>服务器</th><th>创建时间</th><th>状态</th><th aria-label="操作" /></tr></thead><tbody>{shares.map((share) => <tr key={share.id}><td><strong>{share.label || `分享 #${share.id}`}</strong></td><td>{owned.find((server) => server.id === share.server_id)?.name ?? share.server_id}</td><td>{formatDate(share.created_at)}</td><td><Badge tone="good">有效</Badge></td><td className="actions-cell"><IconButton label={`吊销 ${share.label || share.id}`} onClick={() => setPendingRevoke(share)}><Trash2 size={17} /></IconButton></td></tr>)}</tbody></table></div>}
      </Surface>
      <Surface className="table-surface advanced-surface">
        <div className="surface-heading"><div><h2>已接收的服务器</h2></div><Button variant="secondary" onClick={() => setShowReceive(true)}><Link2 size={16} />接入分享</Button></div>
        {loading ? <div className="center-state"><Spinner /></div> : received.length === 0 ? <EmptyState icon={<Globe2 size={22} />} title="尚未接入分享服务器" /> : <div className="table-wrap"><table><thead><tr><th>服务器</th><th>地址</th><th>状态</th><th aria-label="操作" /></tr></thead><tbody>{received.map((server) => <tr key={server.id}><td><strong>{server.name}</strong></td><td>{server.ip_address || "-"}</td><td><Badge tone={server.status === "connected" ? "good" : "warn"}>{server.status || "未知"}</Badge></td><td className="actions-cell"><IconButton label={`移除 ${server.name}`} onClick={() => setPendingRemove(server)}><Trash2 size={17} /></IconButton></td></tr>)}</tbody></table></div>}
      </Surface>
      {showCreate ? <CreateShareDialog serverID={serverID} onClose={() => setShowCreate(false)} onCreated={async (token) => { setShowCreate(false); setSecret(token); await loadShares(); }} /> : null}
      {showReceive ? <ReceiveShareDialog onClose={() => setShowReceive(false)} onCreated={async () => { setShowReceive(false); notify("共享服务器已接入"); await loadServers(); }} /> : null}
      {secret ? <SecretDialog title="分享令牌" description="令牌仅显示这一次" secret={secret} onClose={() => setSecret("")} notify={notify} /> : null}
      {pendingRevoke ? <ConfirmDialog title="吊销分享令牌" description={`吊销“${pendingRevoke.label || `分享 #${pendingRevoke.id}`}”后，使用该令牌接入的其他主控将立即失去访问权限。`} confirmLabel="确认吊销" working={working} onCancel={() => setPendingRevoke(null)} onConfirm={() => void revoke()} /> : null}
      {pendingRemove ? <ConfirmDialog title="移除共享服务器" description={`只会从当前控制端移除“${pendingRemove.name}”，不会删除拥有方服务器上的 Agent 或配置。`} confirmLabel="确认移除" working={working} onCancel={() => setPendingRemove(null)} onConfirm={() => void removeReceived()} /> : null}
    </div>
  );
}

function CreateShareDialog({ serverID, onClose, onCreated }: { serverID: number; onClose: () => void; onCreated: (token: string) => void }) {
  const [label, setLabel] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const response = await api.post<{ share_token: string }>("/api/admin/server-share/create", { server_id: serverID, label: label.trim() });
      onCreated(response.share_token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建分享失败");
    } finally {
      setWorking(false);
    }
  };
  return <Dialog title="创建服务器分享" onClose={onClose}><form className="form-stack" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<Field label="分享标签"><input autoFocus required value={label} onChange={(event) => setLabel(event.target.value)} placeholder="合作方或用途" /></Field><div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working || !label.trim()}>{working ? <Spinner label="正在创建" /> : <><Share2 size={16} />创建分享</>}</Button></div></form></Dialog>;
}

function ReceiveShareDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ owner_url: "", share_token: "", name: "" });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      await api.post("/api/admin/remote-servers/add-shared", { owner_url: form.owner_url.trim(), share_token: form.share_token.trim(), name: form.name.trim() });
      onCreated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "接入分享失败");
    } finally {
      setWorking(false);
    }
  };
  return <Dialog title="接入共享服务器" onClose={onClose}><form className="form-stack" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<Field label="拥有方控制端"><input autoFocus required type="url" value={form.owner_url} onChange={(event) => setForm({ ...form, owner_url: event.target.value })} placeholder="https://console.example.com" /></Field><Field label="分享令牌"><input required type="password" autoComplete="off" value={form.share_token} onChange={(event) => setForm({ ...form, share_token: event.target.value })} /></Field><Field label="显示名称" hint="留空使用拥有方服务器名称"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working || !form.owner_url.trim() || !form.share_token.trim()}>{working ? <Spinner label="正在接入" /> : <><Link2 size={16} />接入</>}</Button></div></form></Dialog>;
}

export function SecretDialog({ title, description, secret, onClose, notify }: { title: string; description: string; secret: string; onClose: () => void; notify: Notify }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setCopyFailed(false);
      notify("已复制到剪贴板");
    } catch {
      setCopyFailed(true);
      notify("复制失败，请手动保存令牌", "error");
    }
  };
  return <Dialog title={title} description={description} onClose={onClose} wide dismissible={false}><div className="secret-box"><code>{secret}</code><IconButton label="复制令牌" onClick={() => void copy()}><Copy size={18} /></IconButton></div>{copyFailed ? <ErrorState message="无法访问剪贴板，请手动选择并保存上方令牌。" /> : null}<div className="dialog-actions">{copyFailed ? <Button variant="secondary" onClick={onClose}><ShieldCheck size={16} />已手动保存</Button> : null}<Button onClick={copied ? onClose : () => void copy()} disabled={!copied && !copyFailed}><ShieldCheck size={16} />{copied ? "已复制并保存" : copyFailed ? "重试复制" : "请先复制令牌"}</Button></div></Dialog>;
}

function operationError(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function downloadFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded.replace(/^"|"$/g, "")); } catch { /* Use the regular filename fallback. */ }
  }
  return disposition.match(/filename="?([^";]+)"?/i)?.[1]?.trim() || fallback;
}

async function responseFailure(response: Response, fallback: string): Promise<Error> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    return new Error(body?.error || body?.message || fallback);
  }
  const body = await response.text().catch(() => "");
  return new Error(body.trim() || fallback);
}

async function downloadAuthenticated(path: string, fallbackName: string, extraHeaders?: Record<string, string>): Promise<string> {
  const headers = new Headers(extraHeaders);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(path, { method: "GET", headers });
  } catch {
    throw new Error("无法连接控制端，请检查网络或服务状态");
  }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new CustomEvent("arcway:unauthorized"));
    throw await responseFailure(response, `下载失败 (${response.status})`);
  }
  const blob = await response.blob();
  const filename = downloadFilename(response, fallbackName);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return filename;
}

type ValidatedBackup = { encrypted: boolean; description: string };

export async function validateBackupFile(file: File): Promise<ValidatedBackup> {
  if (!/\.zip(?:\.enc)?$/i.test(file.name)) throw new Error("仅支持 .zip.enc 加密备份或旧版 .zip 备份");
  if (file.size === 0) throw new Error("备份文件为空");
  if (file.size > 100 * 1024 * 1024) throw new Error("备份文件不能超过 100 MB");
  const prefix = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const magic = new TextDecoder().decode(prefix);
  if (magic === "RLDKBKP1") {
    if (file.size < 52) throw new Error("加密备份头不完整，文件可能已损坏");
    return { encrypted: true, description: "Arcway 加密备份" };
  }
  if (prefix[0] === 0x50 && prefix[1] === 0x4b && file.name.toLowerCase().endsWith(".zip")) {
    return { encrypted: false, description: "旧版明文 ZIP 备份" };
  }
  throw new Error("文件头与 Arcway 备份格式不匹配");
}

export function BackupPanel({ notify }: { notify: Notify }) {
  const [downloadPassphrase, setDownloadPassphrase] = useState("");
  const [downloadConfirm, setDownloadConfirm] = useState("");
  const [downloadWorking, setDownloadWorking] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreKind, setRestoreKind] = useState<ValidatedBackup | null>(null);
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [restoreWorking, setRestoreWorking] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const restoreInput = useRef<HTMLInputElement>(null);

  const createBackup = async (event: FormEvent) => {
    event.preventDefault();
    setDownloadError("");
    if (downloadPassphrase.length < 8) return setDownloadError("备份口令至少需要 8 位");
    if (downloadPassphrase !== downloadConfirm) return setDownloadError("两次输入的备份口令不一致");
    setDownloadWorking(true);
    try {
      const filename = await downloadAuthenticated("/api/admin/backup/download", "arcway-backup.zip.enc", {
        "X-Backup-Passphrase": downloadPassphrase,
      });
      notify(`加密备份已下载：${filename}`);
      setDownloadPassphrase("");
      setDownloadConfirm("");
    } catch (reason) {
      setDownloadError(operationError(reason, "备份下载失败"));
    } finally {
      setDownloadWorking(false);
    }
  };

  const chooseBackup = async (file: File | null) => {
    setRestoreFile(file);
    setRestoreKind(null);
    setRestoreError("");
    if (!file) return;
    try {
      setRestoreKind(await validateBackupFile(file));
    } catch (reason) {
      setRestoreError(operationError(reason, "备份文件校验失败"));
    }
  };

  const requestRestore = async (event: FormEvent) => {
    event.preventDefault();
    setRestoreError("");
    if (!restoreFile) return setRestoreError("请选择备份文件");
    try {
      const validated = await validateBackupFile(restoreFile);
      setRestoreKind(validated);
      if (validated.encrypted && !restorePassphrase) return setRestoreError("加密备份需要输入原备份口令");
      setConfirmRestore(true);
    } catch (reason) {
      setRestoreError(operationError(reason, "备份文件校验失败"));
    }
  };

  const restore = async () => {
    if (!restoreFile) return;
    setRestoreWorking(true);
    setRestoreError("");
    try {
      const form = new FormData();
      form.set("backup", restoreFile);
      if (restorePassphrase) form.set("passphrase", restorePassphrase);
      const response = await request<{ message?: string }>("/api/admin/backup/restore", { method: "POST", body: form });
      notify(response.message || "备份恢复成功，请刷新页面确认数据");
      setConfirmRestore(false);
      setRestoreFile(null);
      setRestoreKind(null);
      setRestorePassphrase("");
      if (restoreInput.current) restoreInput.current.value = "";
    } catch (reason) {
      setRestoreError(operationError(reason, "备份恢复失败"));
      setConfirmRestore(false);
    } finally {
      setRestoreWorking(false);
    }
  };

  return (
    <div className="advanced-stack">
      <div className="ops-two-column">
        <Surface className="ops-card">
          <div className="surface-heading"><div><h2><Download size={17} />数据备份</h2><small>数据、订阅文件会使用现场口令加密</small></div></div>
          <form className="ops-form" onSubmit={createBackup}>
            {downloadError ? <ErrorState message={downloadError} /> : null}
            <Field label="备份加密口令" hint="至少 8 位；口令不会保存，恢复时必须再次提供"><input type="password" minLength={8} autoComplete="new-password" value={downloadPassphrase} onChange={(event) => setDownloadPassphrase(event.target.value)} /></Field>
            <Field label="确认备份口令"><input type="password" minLength={8} autoComplete="new-password" value={downloadConfirm} onChange={(event) => setDownloadConfirm(event.target.value)} /></Field>
            <div className="ops-card-actions"><Button type="submit" disabled={downloadWorking}>{downloadWorking ? <Spinner label="正在创建并加密" /> : <><Download size={16} />下载加密备份</>}</Button></div>
          </form>
        </Surface>

        <Surface className="ops-card ops-danger-card">
          <div className="surface-heading"><div><h2><Upload size={17} />恢复备份</h2><small>恢复会覆盖当前 data 与 subscribes 中的同名文件</small></div></div>
          <form className="ops-form" onSubmit={requestRestore}>
            {restoreError ? <ErrorState message={restoreError} /> : null}
            <Field label="备份文件" hint="最大 100 MB；支持 .zip.enc 和旧版 .zip"><input ref={restoreInput} type="file" accept=".zip,.enc,.zip.enc" onChange={(event) => void chooseBackup(event.target.files?.[0] ?? null)} /></Field>
            {restoreFile && restoreKind ? <div className="ops-file-check"><ShieldCheck size={17} /><span><strong>{restoreFile.name}</strong><small>{restoreKind.description} · {formatBytes(restoreFile.size)}</small></span></div> : null}
            <Field label="原备份口令" hint={restoreKind?.encrypted ? "此文件已加密，必须填写" : "旧版明文 ZIP 可留空"}><input type="password" autoComplete="off" value={restorePassphrase} onChange={(event) => setRestorePassphrase(event.target.value)} /></Field>
            <div className="ops-card-actions"><Button type="submit" variant="danger" disabled={restoreWorking || !restoreFile}>{restoreWorking ? <Spinner label="正在恢复" /> : <><Upload size={16} />校验并恢复</>}</Button></div>
          </form>
        </Surface>
      </div>
      {confirmRestore && restoreFile ? <ConfirmDialog title="恢复数据备份" description={`即将恢复“${restoreFile.name}”（${formatBytes(restoreFile.size)}）。当前同名数据会被覆盖，操作完成后应立即刷新并核对节点、用户和订阅。`} confirmLabel="确认恢复" working={restoreWorking} onCancel={() => setConfirmRestore(false)} onConfirm={() => void restore()} /> : null}
    </div>
  );
}

interface DebugStatus {
  enabled: boolean;
  log_path?: string;
  started_at?: string;
  file_size?: string;
  duration_seconds?: number;
  duration?: string;
}

interface DebugActionResponse {
  status?: string;
  log_path?: string;
  started_at?: string;
  download_url?: string;
}

export function DebugLogsPanel({ notify }: { notify: Notify }) {
  const [status, setStatus] = useState<DebugStatus | null>(null);
  const [tail, setTail] = useState("");
  const [lineLimit, setLineLimit] = useState("200");
  const [filter, setFilter] = useState("");
  const [downloadURL, setDownloadURL] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const current = await api.get<DebugStatus>("/api/user/debug/status");
      setStatus(current);
      if (current.enabled) {
        const response = await api.get<{ lines?: string; total_size?: number }>(`/api/user/debug/tail?lines=${lineLimit}`);
        setTail(response.lines ?? "");
      } else {
        setTail("");
      }
    } catch (reason) {
      setError(operationError(reason, "Debug 日志加载失败"));
    } finally {
      setLoading(false);
    }
  }, [lineLimit]);

  useEffect(() => { void load(); }, [load]);

  const enable = async () => {
    setWorking(true);
    setError("");
    try {
      await api.post<DebugActionResponse>("/api/user/debug/enable");
      setDownloadURL("");
      notify("Debug 日志已开启，将在 5 分钟后自动停止");
      await load();
    } catch (reason) {
      setError(operationError(reason, "开启 Debug 日志失败"));
    } finally {
      setWorking(false);
    }
  };

  const downloadLog = async (path: string) => {
    try {
      const filename = await downloadAuthenticated(path, "arcway-debug-log.txt");
      setDownloadURL("");
      notify(`日志已下载：${filename}；服务端副本将自动清理`);
    } catch (reason) {
      setError(operationError(reason, "Debug 日志下载失败"));
    }
  };

  const disable = async (downloadAfter: boolean) => {
    setWorking(true);
    setError("");
    try {
      const response = await api.post<DebugActionResponse>("/api/user/debug/disable");
      const path = response.download_url ?? "";
      setDownloadURL(path);
      setStatus({ enabled: false });
      setTail("");
      notify("Debug 日志已停止");
      if (downloadAfter && path) await downloadLog(path);
    } catch (reason) {
      setError(operationError(reason, "停止 Debug 日志失败"));
    } finally {
      setWorking(false);
    }
  };

  const visibleTail = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return tail;
    return tail.split("\n").filter((line) => line.toLowerCase().includes(query)).join("\n");
  }, [filter, tail]);

  return (
    <div className="advanced-stack">
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      <Surface className="ops-debug-surface">
        <div className="surface-heading ops-debug-heading">
          <div><h2><FileText size={17} />Debug / Agent 日志</h2><small>临时捕获详细运行日志，最长持续 5 分钟</small></div>
          <div className="ops-inline-actions">
            <IconButton label="刷新 Debug 日志" onClick={() => void load()} disabled={loading}><RefreshCw size={17} /></IconButton>
            {status?.enabled ? <><Button variant="secondary" onClick={() => void disable(false)} disabled={working}><Square size={15} />停止记录</Button><Button onClick={() => void disable(true)} disabled={working}><Download size={15} />停止并下载</Button></> : <Button onClick={() => void enable()} disabled={working || loading}><Play size={15} />开始记录</Button>}
          </div>
        </div>
        {loading && !status ? <div className="center-state"><Spinner /></div> : (
          <>
            <div className="ops-debug-meta">
              <span><small>状态</small><Badge tone={status?.enabled ? "warn" : "neutral"}>{status?.enabled ? "记录中" : "已停止"}</Badge></span>
              <span><small>开始时间</small><strong>{formatDate(status?.started_at)}</strong></span>
              <span><small>持续时间</small><strong>{status?.duration || (status?.duration_seconds != null ? `${status.duration_seconds} 秒` : "-")}</strong></span>
              <span><small>文件大小</small><strong>{status?.file_size || "-"}</strong></span>
            </div>
            {downloadURL ? <div className="ops-download-ready"><FileClock size={18} /><span><strong>本次日志已停止</strong><small>下载成功后服务端会自动删除该文件</small></span><Button onClick={() => void downloadLog(downloadURL)} disabled={working}><Download size={15} />下载并清理服务端副本</Button></div> : null}
            <div className="ops-log-toolbar">
              <label className="search-box"><Search size={16} /><input aria-label="筛选日志" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="筛选关键字" /></label>
              <Field label="日志行数"><select value={lineLimit} onChange={(event) => setLineLimit(event.target.value)}><option value="100">最近 100 行</option><option value="200">最近 200 行</option><option value="500">最近 500 行</option><option value="1000">最近 1000 行</option></select></Field>
            </div>
            <pre className="ops-log-view" aria-label="Debug 日志内容">{visibleTail || (status?.enabled ? "暂时没有匹配的日志" : "开启记录后可在这里查看实时日志")}</pre>
          </>
        )}
      </Surface>
    </div>
  );
}

interface TGBotInvite {
  code: string;
  kind: "new" | "bind" | string;
  bind_username?: string;
  created_by?: string;
  package_id?: number;
  max_uses: number;
  used_count: number;
  expires_at?: string;
  revoked: boolean;
  remark?: string;
  created_at?: string;
  usable: boolean;
  duration_months?: number;
}

export function normalizeInviteList(response: unknown): TGBotInvite[] {
  if (Array.isArray(response)) return response as TGBotInvite[];
  if (!response || typeof response !== "object") return [];
  const record = response as Record<string, unknown>;
  if (Array.isArray(record.items)) return record.items as TGBotInvite[];
  if (Array.isArray(record.invites)) return record.invites as TGBotInvite[];
  for (const candidate of [record.items, record.data]) {
    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      if (Array.isArray(nested.items)) return nested.items as TGBotInvite[];
      if (Array.isArray(nested.invites)) return nested.invites as TGBotInvite[];
    }
  }
  return [];
}

function inviteState(invite: TGBotInvite): { label: string; tone: "good" | "warn" | "bad" | "neutral"; usable: boolean } {
  if (invite.revoked) return { label: "已撤销", tone: "bad", usable: false };
  if (invite.max_uses > 0 && invite.used_count >= invite.max_uses) return { label: "已用尽", tone: "neutral", usable: false };
  if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) return { label: "已过期", tone: "warn", usable: false };
  if (!invite.usable) return { label: "不可用", tone: "neutral", usable: false };
  return { label: "可用", tone: "good", usable: true };
}

type InvitePendingAction = { kind: "revoke" | "delete"; invite: TGBotInvite };

export function TGBotInvitesPanel({ notify }: { notify: Notify }) {
  const [invites, setInvites] = useState<TGBotInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "usable" | "unavailable">("all");
  const [showCreate, setShowCreate] = useState(false);
  const [pending, setPending] = useState<InvitePendingAction | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get<unknown>("/api/admin/tgbot/invites");
      const record = response && typeof response === "object" && !Array.isArray(response) ? response as RemoteActionResponse : null;
      if (record?.success === false) throw new Error(record.error || record.message || "邀请码列表加载失败");
      setInvites(normalizeInviteList(response));
    } catch (reason) {
      setError(operationError(reason, "邀请码列表加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return invites.filter((invite) => {
      const state = inviteState(invite);
      if (filter === "usable" && !state.usable) return false;
      if (filter === "unavailable" && state.usable) return false;
      return !query || [invite.code, invite.bind_username, invite.remark, invite.created_by].some((value) => value?.toLowerCase().includes(query));
    });
  }, [filter, invites, search]);

  const runPending = async () => {
    if (!pending) return;
    setWorking(true);
    try {
      const path = pending.kind === "revoke" ? "/api/admin/tgbot/invites/revoke" : "/api/admin/tgbot/invites/delete";
      const response = await api.post<RemoteActionResponse>(path, { code: pending.invite.code });
      assertRemoteActionSucceeded(response, pending.kind === "revoke" ? "撤销邀请码失败" : "删除邀请码失败");
      notify(pending.kind === "revoke" ? "邀请码已撤销" : "邀请码已删除");
      setPending(null);
      await load();
    } catch (reason) {
      notify(operationError(reason, pending.kind === "revoke" ? "撤销邀请码失败" : "删除邀请码失败"), "error");
    } finally {
      setWorking(false);
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      notify("邀请码已复制");
    } catch {
      notify("复制失败，请手动复制邀请码", "error");
    }
  };

  return (
    <div className="advanced-stack">
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      <Surface className="table-surface advanced-surface">
        <div className="surface-heading ops-invite-heading">
          <div><h2><TicketCheck size={17} />TG Bot 邀请码</h2><small>{invites.filter((invite) => inviteState(invite).usable).length} 个当前可用</small></div>
          <div className="ops-inline-actions"><IconButton label="刷新邀请码" onClick={() => void load()}><RefreshCw size={17} /></IconButton><Button onClick={() => setShowCreate(true)}><Plus size={16} />创建邀请码</Button></div>
        </div>
        <div className="ops-list-filters">
          <label className="search-box"><Search size={16} /><input aria-label="搜索邀请码" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="代码、账号或备注" /></label>
          <Field label="邀请码状态"><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">全部状态</option><option value="usable">仅可用</option><option value="unavailable">仅不可用</option></select></Field>
        </div>
        {loading ? <div className="center-state"><Spinner /></div> : visible.length === 0 ? <EmptyState icon={<TicketCheck size={22} />} title={invites.length ? "没有匹配的邀请码" : "暂无邀请码"} action={<Button onClick={() => setShowCreate(true)}><Plus size={16} />创建邀请码</Button>} /> : (
          <div className="table-wrap"><table className="invite-table"><thead><tr><th>邀请码</th><th>用途</th><th>使用次数</th><th>有效期</th><th>状态</th><th>备注</th><th aria-label="操作" /></tr></thead><tbody>{visible.map((invite) => { const state = inviteState(invite); return (
            <tr key={invite.code}>
              <td data-label="邀请码"><div className="ops-code-cell"><code className="inline-code">{invite.code}</code><IconButton label={`复制邀请码 ${invite.code}`} onClick={() => void copyCode(invite.code)}><Copy size={15} /></IconButton></div><small className="cell-note">{formatDate(invite.created_at)}</small></td>
              <td data-label="用途"><strong>{invite.kind === "bind" ? "绑定已有账号" : "注册新账号"}</strong>{invite.kind === "bind" ? <small className="cell-note">{invite.bind_username || "未指定账号"}</small> : invite.package_id ? <small className="cell-note">套餐 #{invite.package_id}{invite.duration_months ? ` · ${invite.duration_months} 个月` : ""}</small> : null}</td>
              <td data-label="使用次数">{invite.used_count} / {invite.max_uses || "不限"}</td>
              <td data-label="有效期">{invite.expires_at ? formatDate(invite.expires_at) : "长期有效"}</td>
              <td data-label="状态"><Badge tone={state.tone}>{state.label}</Badge></td>
              <td data-label="备注">{invite.remark || "-"}</td>
              <td data-label="操作" className="actions-cell"><div className="ops-row-actions">{state.usable ? <IconButton label={`撤销邀请码 ${invite.code}`} onClick={() => setPending({ kind: "revoke", invite })}><X size={16} /></IconButton> : <IconButton label={`删除邀请码 ${invite.code}`} onClick={() => setPending({ kind: "delete", invite })}><Trash2 size={16} /></IconButton>}</div></td>
            </tr>
          ); })}</tbody></table></div>
        )}
      </Surface>
      {showCreate ? <CreateInviteDialog onClose={() => setShowCreate(false)} onCreated={async (code) => { setShowCreate(false); notify(`邀请码已创建：${code}`); await load(); }} /> : null}
      {pending ? <ConfirmDialog title={pending.kind === "revoke" ? "撤销邀请码" : "删除邀请码"} description={pending.kind === "revoke" ? `撤销“${pending.invite.code}”后将无法继续使用，但会保留历史记录。` : `将永久删除“${pending.invite.code}”及其使用记录，此操作不可恢复。`} confirmLabel={pending.kind === "revoke" ? "确认撤销" : "确认删除"} working={working} onCancel={() => setPending(null)} onConfirm={() => void runPending()} /> : null}
    </div>
  );
}

function CreateInviteDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string) => void }) {
  const [form, setForm] = useState({ kind: "new", bind_username: "", package_id: "", max_uses: "1", expires_at: "", remark: "", duration_months: "0" });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (form.kind === "bind" && !form.bind_username.trim()) return setError("绑定已有账号时必须填写用户名");
    if (Number(form.max_uses) < 1) return setError("最大使用次数至少为 1");
    setWorking(true);
    try {
      const response = await api.post<RemoteActionResponse & { code?: string }>("/api/admin/tgbot/invites", {
        kind: form.kind,
        bind_username: form.kind === "bind" ? form.bind_username.trim() : "",
        package_id: form.kind === "new" && form.package_id ? Number(form.package_id) : null,
        max_uses: Number(form.max_uses),
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : "",
        remark: form.remark.trim(),
        duration_months: form.kind === "new" ? Math.max(0, Number(form.duration_months) || 0) : 0,
      });
      assertRemoteActionSucceeded(response, "创建邀请码失败");
      if (!response.code) throw new Error("服务器未返回邀请码");
      onCreated(response.code);
    } catch (reason) {
      setError(operationError(reason, "创建邀请码失败"));
    } finally {
      setWorking(false);
    }
  };
  return (
    <Dialog title="创建 TG Bot 邀请码" description="邀请码可用于新账号注册或绑定现有账号" onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        {error ? <ErrorState message={error} /> : null}
        <Field label="用途"><select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value, bind_username: "", package_id: "" })}><option value="new">注册新账号</option><option value="bind">绑定已有账号</option></select></Field>
        {form.kind === "bind" ? <Field label="绑定用户名"><input autoFocus required value={form.bind_username} onChange={(event) => setForm({ ...form, bind_username: event.target.value })} /></Field> : <div className="form-grid"><Field label="套餐 ID" hint="可选；注册成功后自动分配"><input type="number" min="1" value={form.package_id} onChange={(event) => setForm({ ...form, package_id: event.target.value })} /></Field><Field label="账号有效月数" hint="0 表示沿用套餐周期"><input type="number" min="0" max="120" value={form.duration_months} onChange={(event) => setForm({ ...form, duration_months: event.target.value })} /></Field></div>}
        <div className="form-grid"><Field label="最大使用次数"><input required type="number" min="1" max="10000" value={form.max_uses} onChange={(event) => setForm({ ...form, max_uses: event.target.value })} /></Field><Field label="过期时间" hint="留空表示长期有效"><input type="datetime-local" value={form.expires_at} onChange={(event) => setForm({ ...form, expires_at: event.target.value })} /></Field></div>
        <Field label="备注"><input value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} placeholder="用途或发放对象" /></Field>
        <div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={working}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在创建" /> : <><Plus size={16} />创建邀请码</>}</Button></div>
      </form>
    </Dialog>
  );
}
