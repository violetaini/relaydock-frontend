import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Cable,
  Check,
  ChevronDown,
  Clock3,
  Clipboard,
  Copy,
  Download,
  Edit3,
  Eye,
  FileDown,
  Gauge,
  Globe2,
  HardDriveDownload,
  History,
  KeyRound,
  Link2,
  ListFilter,
  MapPin,
  MoreHorizontal,
  Network,
  Play,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  RotateCcw,
  Route,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Shuffle,
  Tag,
  Terminal,
  Trash2,
  Upload,
  UserRound,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import { api } from "./api";
import { TunnelsPanel } from "./advanced";
import { SelfServiceNodes } from "./self-service-nodes";
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
import "./nodes-workbench.css";

export type NodesWorkbenchNotify = (message: string, tone?: "success" | "error") => void;

export interface NodesWorkbenchProps {
  isAdmin: boolean;
  notify: NodesWorkbenchNotify;
}

export interface WorkbenchNode {
  id: number;
  raw_url: string;
  node_name: string;
  protocol: string;
  parsed_config: string;
  clash_config: string;
  enabled: boolean;
  tag: string;
  tags?: string[];
  original_server: string;
  original_domain: string;
  inbound_tag: string;
  chain_proxy_node_id?: number | null;
  node_type?: string;
  parent_node_id?: number | null;
  routed_outbound_tag?: string;
  routed_owner?: string;
  created_by?: string;
  relay_orig_server?: string;
  relay_orig_port?: number;
  created_at?: string;
  updated_at?: string;
}

interface SpeedResult {
  id: number;
  node_id: number;
  node_name: string;
  source: "master_local" | "home_tester" | string;
  down_mbps: number;
  latency_ms: number;
  test_bytes: number;
  status: "running" | "ok" | "failed" | string;
  error?: string;
  egress_ip?: string;
  tested_by?: string;
  created_at: string;
}

interface SpeedTester {
  id: number;
  name: string;
  created_by?: string;
  online: boolean;
  last_seen?: string;
  created_at?: string;
}

interface TCPingResult {
  success: boolean;
  latency: number;
  error?: string;
  loading?: boolean;
}

interface NodeURI {
  username: string;
  node_id: number;
  node_name: string;
  protocol: string;
  node_type: string;
  uri: string;
}

interface ExternalSubscription {
  id: number;
  username?: string;
  name: string;
  url: string;
  user_agent: string;
  node_count: number;
  last_sync_at?: string | null;
  upload: number;
  download: number;
  total: number;
  expire?: string | null;
  traffic_mode: string;
  created_at?: string;
  updated_at?: string;
}

interface ParseNodesResponse {
  proxies?: Record<string, unknown>[];
  suggested_tag?: string;
}

interface TempSubscriptionResponse {
  id: string;
  url: string;
  max_access: number;
  expire_at: string;
}

type SortMode = "recent" | "custom" | "name" | "protocol" | "server" | "latency" | "speed";
type WorkbenchDialog =
  | { kind: "create" }
  | { kind: "edit"; node: WorkbenchNode }
  | { kind: "config"; node: WorkbenchNode }
  | { kind: "import" }
  | { kind: "relay"; node: WorkbenchNode }
  | { kind: "chain"; node: WorkbenchNode }
  | { kind: "resolve"; node: WorkbenchNode }
  | { kind: "region"; node: WorkbenchNode }
  | { kind: "rename"; nodes: WorkbenchNode[] }
  | { kind: "tags"; nodes: WorkbenchNode[] }
  | { kind: "speed"; nodeIDs: number[] }
  | { kind: "history"; nodeID?: number }
  | { kind: "uris" }
  | { kind: "subscriptions" }
  | { kind: "testers" }
  | { kind: "tunnels" }
  | { kind: "route"; node: WorkbenchNode }
  | { kind: "temp-sub"; nodes: WorkbenchNode[] }
  | null;

interface PendingAction {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "primary";
  run: () => Promise<void>;
}

interface UserNodeConfig extends Record<string, unknown> {
  node_order?: number[];
}

interface UserRoutedOutboundStatus {
  items?: WorkbenchNode[];
  enabled: boolean;
  quota: { used: number; max: number };
  daily: { used: number; max: number };
}

export interface ManagedNodeOffer {
  id: number;
  node_id: number;
  server_id: number;
  inbound_tag: string;
  enabled: boolean;
  sort_order: number;
}

const protocols = ["vmess", "vless", "trojan", "ss", "socks5", "hysteria", "hysteria2", "tuic", "anytls", "wireguard", "snell"];

function readConfig(node: WorkbenchNode): Record<string, unknown> {
  for (const raw of [node.clash_config, node.parsed_config]) {
    try {
      const parsed = JSON.parse(raw || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch { /* Keep trying fallbacks. */ }
  }
  return {};
}

function nodeAddress(node: WorkbenchNode): { host: string; port: number } {
  const config = readConfig(node);
  return { host: typeof config.server === "string" ? config.server : "", port: Number(config.port) || 0 };
}

function isIPHost(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

function nodeTags(node: WorkbenchNode): string[] {
  const tags = Array.isArray(node.tags) ? node.tags.filter(Boolean) : [];
  if (tags.length) return tags;
  return node.tag ? [node.tag] : [];
}

function nodePayload(node: WorkbenchNode, patch: Partial<WorkbenchNode> = {}) {
  const next = { ...node, ...patch };
  const renameConfig = (raw: string) => {
    if (!patch.node_name || patch.node_name === node.node_name) return raw;
    try {
      const parsed = JSON.parse(raw || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return raw;
      parsed.name = patch.node_name;
      return JSON.stringify(parsed);
    } catch { return raw; }
  };
  return {
    raw_url: next.raw_url || "",
    node_name: next.node_name,
    protocol: next.protocol,
    parsed_config: renameConfig(next.parsed_config),
    clash_config: renameConfig(next.clash_config),
    enabled: next.enabled,
    tag: next.tag || nodeTags(next)[0] || "",
    tags: nodeTags(next),
    inbound_tag: next.inbound_tag || "",
    chain_proxy_node_id: next.chain_proxy_node_id ?? null,
  };
}

function reconcileNodeOrder(order: number[] | undefined, nodes: WorkbenchNode[]): number[] {
  const visibleIDs = new Set(nodes.map((node) => node.id));
  const seen = new Set<number>();
  const result: number[] = [];
  for (const id of order ?? []) {
    if (!visibleIDs.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  for (const node of nodes) if (!seen.has(node.id)) result.push(node.id);
  return result;
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : value;
}

function speedTone(result?: SpeedResult): "good" | "warn" | "bad" | "neutral" {
  if (result?.status === "ok") return "good";
  if (result?.status === "running") return "warn";
  if (result?.status === "failed") return "bad";
  return "neutral";
}

function resultLabel(result?: SpeedResult): string {
  if (!result) return "未测速";
  if (result.status === "running") return "进行中";
  if (result.status === "failed") return "失败";
  return result.down_mbps > 0 ? `${result.down_mbps.toFixed(1)} Mbps` : `${result.latency_ms} ms`;
}

async function copyText(value: string): Promise<void> {
  if (!navigator.clipboard) throw new Error("clipboard unavailable");
  await navigator.clipboard.writeText(value);
}

export function NodesWorkbench({ isAdmin, notify }: NodesWorkbenchProps) {
  const [nodes, setNodes] = useState<WorkbenchNode[]>([]);
  const [offers, setOffers] = useState<ManagedNodeOffer[]>([]);
  const [latest, setLatest] = useState<Record<number, SpeedResult>>({});
  const [tcping, setTCPing] = useState<Record<number, TCPingResult>>({});
  const [userConfig, setUserConfig] = useState<UserNodeConfig | null>(null);
  const [userRouted, setUserRouted] = useState<UserRoutedOutboundStatus | null>(null);
  const [manualOrder, setManualOrder] = useState<number[]>([]);
  const [orderDirty, setOrderDirty] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const orderDirtyRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [protocol, setProtocol] = useState("all");
  const [tag, setTag] = useState("all");
  const [sort, setSort] = useState<SortMode>("recent");
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState<WorkbenchDialog>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [working, setWorking] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [userView, setUserView] = useState<"mine" | "catalog">("mine");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const [nodeResponse, speedResponse, configResponse, routedResponse, offerResponse] = await Promise.all([
        api.get<{ nodes?: WorkbenchNode[] }>("/api/admin/nodes"),
        isAdmin
          ? api.get<{ results?: SpeedResult[] | null }>("/api/admin/speedtest/results?latest=1").catch(() => ({ results: [] }))
          : Promise.resolve({ results: [] as SpeedResult[] }),
        api.get<UserNodeConfig>("/api/user/config"),
        isAdmin ? Promise.resolve(null) : api.get<UserRoutedOutboundStatus>("/api/user/routed-outbound"),
        isAdmin
          ? api.get<{ offers?: ManagedNodeOffer[] } | ManagedNodeOffer[]>("/api/admin/managed-node-offers").catch(() => ({ offers: [] }))
          : Promise.resolve({ offers: [] as ManagedNodeOffer[] }),
      ]);
      const list = nodeResponse.nodes ?? [];
      setNodes(list);
      setOffers(Array.isArray(offerResponse) ? offerResponse : offerResponse.offers ?? []);
      setUserConfig(configResponse);
      setUserRouted(routedResponse);
      setManualOrder((current) => reconcileNodeOrder(orderDirtyRef.current ? current : configResponse.node_order, list));
      setLatest(Object.fromEntries((speedResponse.results ?? []).map((item) => [item.node_id, item])));
      setSelected((current) => new Set([...current].filter((id) => list.some((node) => node.id === id))));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "节点列表加载失败");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { void load(); }, [load]);
  const hasRunning = Object.values(latest).some((result) => result.status === "running");
  useEffect(() => {
    if (!hasRunning) return;
    const timer = window.setInterval(() => void load(true), 1800);
    return () => window.clearInterval(timer);
  }, [hasRunning, load]);

  const allTags = useMemo(() => Array.from(new Set(nodes.flatMap(nodeTags))).sort((a, b) => a.localeCompare(b, "zh-CN")), [nodes]);
  const protocolCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const node of nodes) counts[node.protocol.toLowerCase()] = (counts[node.protocol.toLowerCase()] || 0) + 1;
    return counts;
  }, [nodes]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = nodes.filter((node) => {
      if (protocol !== "all" && node.protocol.toLowerCase() !== protocol) return false;
      if (tag !== "all" && !nodeTags(node).includes(tag)) return false;
      if (enabledOnly && !node.enabled) return false;
      if (!query) return true;
      const address = nodeAddress(node);
      return [node.node_name, node.protocol, node.original_server, node.inbound_tag, address.host, ...nodeTags(node)]
        .some((value) => value?.toLowerCase().includes(query));
    });
    const orderIndex = new Map(manualOrder.map((id, index) => [id, index]));
    return filtered.sort((a, b) => {
      if (sort === "custom") return (orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER);
      if (sort === "name") return a.node_name.localeCompare(b.node_name, "zh-CN");
      if (sort === "protocol") return a.protocol.localeCompare(b.protocol) || a.node_name.localeCompare(b.node_name, "zh-CN");
      if (sort === "server") return nodeAddress(a).host.localeCompare(nodeAddress(b).host) || a.node_name.localeCompare(b.node_name, "zh-CN");
      if (sort === "latency") return (latest[a.id]?.latency_ms || Number.MAX_SAFE_INTEGER) - (latest[b.id]?.latency_ms || Number.MAX_SAFE_INTEGER);
      if (sort === "speed") return (latest[b.id]?.down_mbps || -1) - (latest[a.id]?.down_mbps || -1);
      return new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime();
    });
  }, [enabledOnly, latest, manualOrder, nodes, protocol, search, sort, tag]);

  const selectedNodes = useMemo(() => nodes.filter((node) => selected.has(node.id)), [nodes, selected]);
  const allVisibleSelected = visible.length > 0 && visible.every((node) => selected.has(node.id));
  const toggleSelection = (id: number) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleVisible = () => setSelected((current) => {
    const next = new Set(current);
    if (allVisibleSelected) visible.forEach((node) => next.delete(node.id)); else visible.forEach((node) => next.add(node.id));
    return next;
  });

  const update = async (node: WorkbenchNode, patch: Partial<WorkbenchNode>, successMessage: string) => {
    await api.put(`/api/admin/nodes/${node.id}`, nodePayload(node, patch));
    notify(successMessage);
    await load(true);
  };

  const moveManualNode = (id: number, direction: -1 | 1) => {
    orderDirtyRef.current = true;
    setOrderDirty(true);
    setManualOrder((current) => {
      const index = current.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const saveManualOrder = async () => {
    if (!userConfig) return notify("用户配置尚未加载，无法安全保存节点顺序", "error");
    setSavingOrder(true);
    try {
      const payload: UserNodeConfig = { ...userConfig, node_order: manualOrder };
      const saved = await api.put<UserNodeConfig>("/api/user/config", payload);
      setUserConfig(saved && typeof saved === "object" ? saved : payload);
      orderDirtyRef.current = false;
      setOrderDirty(false);
      notify("节点顺序已保存");
    } catch (reason) { notify(reasonMessage(reason, "节点顺序保存失败"), "error"); }
    finally { setSavingOrder(false); }
  };

  const runPending = async () => {
    if (!pending) return;
    setWorking(true);
    try { await pending.run(); setPending(null); }
    catch (reason) { notify(reason instanceof Error ? reason.message : "操作失败", "error"); }
    finally { setWorking(false); }
  };

  const removeNode = (node: WorkbenchNode) => setPending({
    title: "删除节点",
    description: `将删除“${node.node_name}”，并同步清理关联订阅与可定位的远程配置。此操作无法撤销。`,
    confirmLabel: "确认删除",
    run: async () => { await api.delete(`/api/admin/nodes/${node.id}`); notify("节点已删除"); await load(true); },
  });

  const removeUserRouted = (node: WorkbenchNode) => setPending({
    title: "删除私有路由出站",
    description: `将删除“${node.node_name}”，并从对应 Agent 清理客户端、出站与路由规则。此操作计入今日操作次数。`,
    confirmLabel: "确认删除",
    run: async () => {
      await api.delete(`/api/user/routed-outbound?id=${encodeURIComponent(node.id)}`);
      notify("私有路由出站已删除");
      await load(true);
    },
  });

  const batchStatus = (enabled: boolean) => setPending({
    title: enabled ? "批量启用节点" : "批量停用节点",
    description: `将${enabled ? "启用" : "停用"}选中的 ${selectedNodes.length} 个节点，并同步订阅可用状态。`,
    confirmLabel: enabled ? "确认启用" : "确认停用",
    tone: "primary",
    run: async () => {
      await Promise.all(selectedNodes.map((node) => api.put(`/api/admin/nodes/${node.id}`, nodePayload(node, { enabled }))));
      notify(`已${enabled ? "启用" : "停用"} ${selectedNodes.length} 个节点`);
      await load(true);
    },
  });

  const batchDelete = () => setPending({
    title: "批量删除节点",
    description: `将删除选中的 ${selectedNodes.length} 个节点，相关订阅和可定位的远程入站也会被清理。此操作无法撤销。`,
    confirmLabel: `删除 ${selectedNodes.length} 个节点`,
    run: async () => {
      const result = await api.post<{ deleted?: number; total?: number }>("/api/admin/nodes/batch-delete", { node_ids: selectedNodes.map((node) => node.id) });
      notify(`已删除 ${result.deleted ?? selectedNodes.length}/${result.total ?? selectedNodes.length} 个节点`);
      setSelected(new Set());
      await load(true);
    },
  });

  const pingOne = async (node: WorkbenchNode) => {
    const address = nodeAddress(node);
    if (!address.host || !address.port) return notify("节点缺少有效的服务器地址", "error");
    setTCPing((current) => ({ ...current, [node.id]: { success: false, latency: 0, loading: true } }));
    try {
      const result = await api.post<TCPingResult>("/api/admin/tcping", { host: address.host, port: address.port, timeout: 5000, protocol: node.protocol });
      setTCPing((current) => ({ ...current, [node.id]: result }));
    } catch (reason) {
      setTCPing((current) => ({ ...current, [node.id]: { success: false, latency: 0, error: reason instanceof Error ? reason.message : "测试失败" } }));
    }
  };

  const pingBatch = async () => {
    const targets = selectedNodes.length ? selectedNodes : visible;
    const valid = targets.filter((node) => { const address = nodeAddress(node); return address.host && address.port; });
    if (!valid.length) return notify("当前节点没有有效服务器地址", "error");
    setTCPing((current) => ({ ...current, ...Object.fromEntries(valid.map((node) => [node.id, { success: false, latency: 0, loading: true }])) }));
    try {
      const results = await api.post<TCPingResult[]>("/api/admin/tcping/batch", valid.map((node) => {
        const address = nodeAddress(node);
        return { host: address.host, port: address.port, timeout: 5000, protocol: node.protocol };
      }));
      setTCPing((current) => ({ ...current, ...Object.fromEntries(valid.map((node, index) => [node.id, results[index]])) }));
      notify(`延迟测试完成：成功 ${results.filter((result) => result.success).length}，失败 ${results.filter((result) => !result.success).length}`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "批量延迟测试失败", "error");
      setTCPing((current) => ({ ...current, ...Object.fromEntries(valid.map((node) => [node.id, { success: false, latency: 0, error: "批量测试失败" }])) }));
    }
  };

  const restoreDomain = (node: WorkbenchNode) => setPending({
    title: "恢复原始域名",
    description: `将“${node.node_name}”当前服务器地址恢复为 ${node.original_domain}。`,
    confirmLabel: "确认恢复",
    tone: "primary",
    run: async () => { await api.put(`/api/admin/nodes/${node.id}/restore-server`, {}); notify("已恢复原始域名"); await load(true); },
  });

  const cancelRelay = (node: WorkbenchNode) => setPending({
    title: "取消节点中转",
    description: `将“${node.node_name}”恢复直连 ${node.relay_orig_server}:${node.relay_orig_port || "原端口"}，当前中转立即失效。`,
    confirmLabel: "取消中转",
    run: async () => { await api.delete(`/api/admin/nodes/${node.id}/relay`); notify("已取消节点中转"); await load(true); },
  });

  const deleteDuplicates = () => {
    const groups = new Map<string, WorkbenchNode[]>();
    for (const node of nodes) {
      const config = { ...readConfig(node) };
      delete config.name;
      const key = JSON.stringify(config);
      groups.set(key, [...(groups.get(key) ?? []), node]);
    }
    const duplicates = [...groups.values()].filter((items) => items.length > 1).flatMap((items) => items.slice(1));
    if (!duplicates.length) return notify("未发现重复节点");
    setPending({
      title: "删除重复节点",
      description: `发现 ${duplicates.length} 个重复节点。每组保留列表中最早的一项，其余项将被删除。`,
      confirmLabel: `删除 ${duplicates.length} 个重复节点`,
      run: async () => { await api.post("/api/admin/nodes/batch-delete", { node_ids: duplicates.map((node) => node.id) }); notify(`已删除 ${duplicates.length} 个重复节点`); await load(true); },
    });
  };

  const closeDialog = () => setDialog(null);
  return (
    <div className="nodes-workbench">
      <PageHeader
        title="节点管理"
        description={isAdmin
          ? `${nodes.length} 个节点 · ${nodes.filter((node) => node.enabled).length} 个启用 · 管理、连通性与测速工作台`
          : userView === "mine" ? `${nodes.length} 个可用节点 · ${nodes.filter((node) => node.enabled).length} 个启用` : "按服务器授权开通独立节点凭据"}
        actions={isAdmin || userView === "mine" ? <>
          <IconButton label="刷新节点数据" onClick={() => void load()} disabled={loading}><RefreshCw size={18} /></IconButton>
          <Button variant="secondary" onClick={() => setDialog({ kind: "import" })}><Upload size={17} />导入</Button>
          {isAdmin ? <Button onClick={() => setDialog({ kind: "create" })}><Plus size={17} />添加节点</Button> : null}
        </> : undefined}
      />

      {!isAdmin ? <div className="nw-user-views segmented-control" role="tablist" aria-label="用户节点视图"><button role="tab" aria-selected={userView === "mine"} className={userView === "mine" ? "is-active" : ""} onClick={() => setUserView("mine")}><Route size={15} />我的节点</button><button role="tab" aria-selected={userView === "catalog"} className={userView === "catalog" ? "is-active" : ""} onClick={() => setUserView("catalog")}><Plus size={15} />可开通节点</button></div> : null}

      {!isAdmin && userView === "catalog" ? <SelfServiceNodes view="catalog" notify={notify} onChanged={() => load(true)} /> : <>
      {!isAdmin ? <SelfServiceNodes view="mine" notify={notify} onChanged={() => load(true)} /> : null}
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      <Surface className="nw-command-surface">
        <div className="nw-command-row">
          <div className="search-box nw-search"><Search size={17} /><input aria-label="搜索节点" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="名称、地址、协议、标签或服务器" /></div>
          <Field label="排序"><select aria-label="节点排序" value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="recent">最近更新</option><option value="custom">自定义顺序</option><option value="name">节点名称</option><option value="protocol">协议</option><option value="server">服务器地址</option><option value="latency">延迟</option><option value="speed">下载速度</option></select></Field>
          <label className="nw-compact-check"><input type="checkbox" checked={enabledOnly} onChange={(event) => setEnabledOnly(event.target.checked)} />仅启用</label>
          <div className="nw-tool-menu">
            <Button variant="secondary" onClick={() => setShowTools((value) => !value)}><Settings2 size={16} />工具<ChevronDown size={14} /></Button>
            {showTools ? <div className="nw-tool-popover">
              {isAdmin ? <button onClick={() => { setDialog({ kind: "speed", nodeIDs: selectedNodes.map((node) => node.id) }); setShowTools(false); }}><Gauge size={16} />节点测速</button> : null}
              {isAdmin ? <button onClick={() => { setDialog({ kind: "history" }); setShowTools(false); }}><History size={16} />测速结果</button> : null}
              {isAdmin ? <button onClick={() => { setDialog({ kind: "testers" }); setShowTools(false); }}><Wifi size={16} />测速端管理</button> : null}
              {isAdmin ? <button onClick={() => { setDialog({ kind: "uris" }); setShowTools(false); }}><Link2 size={16} />URI 管理器</button> : null}
              <button onClick={() => { setDialog({ kind: "subscriptions" }); setShowTools(false); }}><Globe2 size={16} />外部订阅</button>
              {isAdmin ? <button onClick={() => { setDialog({ kind: "tunnels" }); setShowTools(false); }}><Cable size={16} />Tunnel 管理</button> : null}
              {isAdmin ? <button onClick={() => { deleteDuplicates(); setShowTools(false); }}><ListFilter size={16} />删除重复</button> : null}
              {!isAdmin && userRouted ? <span className="nw-tool-status"><Route size={15} />私有出站 {userRouted.quota.used}/{userRouted.quota.max} · 今日 {userRouted.daily.used}/{userRouted.daily.max}</span> : null}
            </div> : null}
          </div>
        </div>
        <div className="nw-filter-group" aria-label="协议筛选">
          <button className={protocol === "all" ? "is-active" : ""} onClick={() => setProtocol("all")}>全部 <span>{nodes.length}</span></button>
          {protocols.filter((item) => protocolCounts[item]).map((item) => <button key={item} className={protocol === item ? "is-active" : ""} onClick={() => setProtocol(item)}>{item.toUpperCase()} <span>{protocolCounts[item]}</span></button>)}
        </div>
        {allTags.length ? <div className="nw-filter-group nw-tag-filters" aria-label="标签筛选"><button className={tag === "all" ? "is-active" : ""} onClick={() => setTag("all")}>全部标签</button>{allTags.map((item) => <button key={item} className={tag === item ? "is-active" : ""} onClick={() => setTag(item)}><Tag size={12} />{item}</button>)}</div> : null}
        {sort === "custom" ? <div className="nw-order-toolbar"><span><ArrowUp size={15} />使用每行的上下箭头调整订阅节点顺序</span><Button variant={orderDirty ? "primary" : "secondary"} disabled={savingOrder || !orderDirty} onClick={() => void saveManualOrder()}>{savingOrder ? <Spinner label="正在保存" /> : <><Check size={15} />保存节点顺序</>}</Button></div> : null}
      </Surface>

      {selectedNodes.length ? <div className="nw-batchbar" role="toolbar" aria-label="批量操作">
        <strong>已选 {selectedNodes.length} 项</strong>
        <Button variant="ghost" onClick={() => setDialog({ kind: "rename", nodes: selectedNodes })}><Edit3 size={15} />改名</Button>
        {isAdmin ? <Button variant="ghost" onClick={() => setDialog({ kind: "tags", nodes: selectedNodes })}><Tag size={15} />标签</Button> : null}
        <Button variant="ghost" onClick={() => void pingBatch()}><Zap size={15} />延迟</Button>
        {isAdmin ? <Button variant="ghost" onClick={() => setDialog({ kind: "speed", nodeIDs: selectedNodes.map((node) => node.id) })}><Gauge size={15} />测速</Button> : null}
        <Button variant="ghost" onClick={() => setDialog({ kind: "temp-sub", nodes: selectedNodes })}><Link2 size={15} />临时订阅</Button>
        {isAdmin ? <Button variant="ghost" onClick={() => batchStatus(true)}><Power size={15} />启用</Button> : null}
        {isAdmin ? <Button variant="ghost" onClick={() => batchStatus(false)}><PowerOff size={15} />停用</Button> : null}
        {isAdmin ? <Button variant="danger" onClick={batchDelete}><Trash2 size={15} />删除</Button> : null}
        <IconButton label="清除选择" onClick={() => setSelected(new Set())}><X size={16} /></IconButton>
      </div> : null}

      <Surface className="table-surface nw-node-surface">
        {loading ? <div className="center-state"><Spinner label="正在加载节点" /></div> : visible.length === 0 ? <EmptyState icon={<Route size={24} />} title={nodes.length ? "没有匹配的节点" : "暂无节点"} description={nodes.length ? "调整筛选条件后重试" : "导入分享链接、Clash 配置或手工添加节点"} action={!nodes.length ? <Button onClick={() => setDialog({ kind: "import" })}><Upload size={16} />导入节点</Button> : undefined} /> : <div className="table-wrap"><table className="nw-node-table"><thead><tr><th className="nw-check-col"><input aria-label="选择当前结果" type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} /></th>{sort === "custom" ? <th className="nw-order-col">顺序</th> : null}<th>协议 / 节点</th><th>标签与归属</th><th>服务器地址</th><th>连通性</th><th>测速结果</th><th>状态</th><th aria-label="操作" /></tr></thead><tbody>{visible.map((node) => {
          const address = nodeAddress(node);
          const ping = tcping[node.id];
          const speed = latest[node.id];
          const offer = offers.find((item) => item.node_id === node.id);
          const orderIndex = manualOrder.indexOf(node.id);
          return <tr key={node.id} className={selected.has(node.id) ? "is-selected" : ""}>
            <td><input aria-label={`选择 ${node.node_name}`} type="checkbox" checked={selected.has(node.id)} onChange={() => toggleSelection(node.id)} /></td>
            {sort === "custom" ? <td className="nw-order-col"><span>{orderIndex + 1}</span><IconButton label={`上移 ${node.node_name}`} disabled={orderIndex <= 0} onClick={() => moveManualNode(node.id, -1)}><ArrowUp size={14} /></IconButton><IconButton label={`下移 ${node.node_name}`} disabled={orderIndex < 0 || orderIndex >= manualOrder.length - 1} onClick={() => moveManualNode(node.id, 1)}><ArrowDown size={14} /></IconButton></td> : null}
            <td><div className="nw-node-primary"><Badge tone="info">{node.protocol.toUpperCase() || "UNKNOWN"}</Badge><span><strong>{node.node_name}</strong><small>#{node.id}{node.node_type === "routed" ? " · 路由出站" : ""}{node.relay_orig_server ? " · 已中转" : ""}</small></span></div></td>
            <td><div className="nw-node-tags">{offer?.enabled ? <Badge tone="good">自助发布</Badge> : null}{nodeTags(node).length ? nodeTags(node).slice(0, 3).map((item) => <Badge key={item}>{item}</Badge>) : <span className="muted">未分类</span>}</div><small className="cell-note">{node.original_server || node.created_by || "外部导入"}{node.inbound_tag ? ` · ${node.inbound_tag}` : ""}</small></td>
            <td><code className="nw-address">{address.host || "-"}:{address.port || "-"}</code>{node.relay_orig_server ? <small className="cell-note">原站 {node.relay_orig_server}:{node.relay_orig_port || "-"}</small> : node.original_domain ? <small className="cell-note">原域名 {node.original_domain}</small> : null}</td>
            <td><button className={`nw-result-button ${ping?.success ? "is-good" : ping?.error ? "is-bad" : ""}`} disabled={ping?.loading} title={ping?.error || "点击测试 TCP/UDP 连通延迟"} onClick={() => void pingOne(node)}>{ping?.loading ? <Spinner label="" /> : <Zap size={14} />}{ping?.loading ? "测试中" : ping?.success ? `${ping.latency.toFixed(1)} ms` : ping?.error ? "失败" : "测延迟"}</button></td>
            <td>{isAdmin ? <button className="nw-speed-cell" title={speed?.error || "打开节点测速"} onClick={() => setDialog({ kind: "speed", nodeIDs: [node.id] })}><Badge tone={speedTone(speed)}>{resultLabel(speed)}</Badge>{speed?.egress_ip ? <small>{speed.egress_ip}</small> : null}</button> : <Badge tone="neutral">管理员功能</Badge>}</td>
            <td>{isAdmin ? <button className="nw-status-button" title={`点击${node.enabled ? "停用" : "启用"}`} onClick={() => void update(node, { enabled: !node.enabled }, node.enabled ? "节点已停用" : "节点已启用")}><span className={node.enabled ? "is-on" : ""} />{node.enabled ? "启用" : "停用"}</button> : <Badge tone={node.enabled ? "good" : "neutral"}>{node.enabled ? "启用" : "停用"}</Badge>}</td>
            <td><NodeActions node={node} isAdmin={isAdmin} userRouted={userRouted} onEdit={() => setDialog({ kind: "edit", node })} onConfig={() => setDialog({ kind: "config", node })} onRelay={() => setDialog({ kind: "relay", node })} onCancelRelay={() => cancelRelay(node)} onChain={() => setDialog({ kind: "chain", node })} onResolve={() => setDialog({ kind: "resolve", node })} onRegion={() => setDialog({ kind: "region", node })} onRestore={() => restoreDomain(node)} onRoute={() => setDialog({ kind: "route", node })} onTempSub={() => setDialog({ kind: "temp-sub", nodes: [node] })} onDelete={() => isAdmin ? removeNode(node) : removeUserRouted(node)} /></td>
          </tr>;
        })}</tbody></table></div>}
      </Surface>
      </>}

      {dialog?.kind === "create" ? <NodeEditor onClose={closeDialog} onComplete={async (message) => { closeDialog(); notify(message); await load(true); }} /> : null}
      {dialog?.kind === "edit" ? <NodeEditor node={dialog.node} offer={offers.find((item) => item.node_id === dialog.node.id)} onClose={closeDialog} onComplete={async (message) => { closeDialog(); notify(message); await load(true); }} /> : null}
      {dialog?.kind === "config" ? <ConfigDialog node={dialog.node} editable={isAdmin} onClose={closeDialog} onComplete={async () => { closeDialog(); notify("节点配置已更新"); await load(true); }} /> : null}
      {dialog?.kind === "import" ? <ImportDialog onClose={closeDialog} onComplete={async (count) => { closeDialog(); notify(`已导入 ${count} 个节点`); await load(true); }} /> : null}
      {dialog?.kind === "relay" ? <RelayDialog node={dialog.node} onClose={closeDialog} onComplete={async () => { closeDialog(); notify("节点中转已更新"); await load(true); }} /> : null}
      {dialog?.kind === "chain" ? <ChainProxyDialog node={dialog.node} nodes={nodes} onClose={closeDialog} onComplete={async () => { closeDialog(); notify("链式代理已更新"); await load(true); }} /> : null}
      {dialog?.kind === "resolve" ? <ResolveIPDialog node={dialog.node} onClose={closeDialog} onComplete={async () => { closeDialog(); notify("节点服务器地址已更新"); await load(true); }} /> : null}
      {dialog?.kind === "region" ? <RegionEmojiDialog node={dialog.node} onClose={closeDialog} onComplete={async () => { closeDialog(); notify("节点地区标识已更新"); await load(true); }} /> : null}
      {dialog?.kind === "rename" ? <BatchRenameDialog nodes={dialog.nodes} onClose={closeDialog} onComplete={async (count) => { closeDialog(); notify(`已修改 ${count} 个节点名称`); await load(true); }} /> : null}
      {dialog?.kind === "tags" ? <BatchTagsDialog nodes={dialog.nodes} available={allTags} onClose={closeDialog} onComplete={async (count) => { closeDialog(); notify(`已更新 ${count} 个节点标签`); await load(true); }} /> : null}
      {dialog?.kind === "speed" ? <SpeedDialog nodes={nodes} initialNodeIDs={dialog.nodeIDs} latest={latest} notify={notify} onClose={closeDialog} onRefresh={() => load(true)} onOpenHistory={(nodeID) => setDialog({ kind: "history", nodeID })} onManageTesters={() => setDialog({ kind: "testers" })} /> : null}
      {dialog?.kind === "history" ? <SpeedHistoryDialog initialNodeID={dialog.nodeID} onClose={closeDialog} /> : null}
      {dialog?.kind === "testers" ? <TestersDialog notify={notify} onClose={closeDialog} /> : null}
      {dialog?.kind === "uris" ? <URIManagerDialog notify={notify} onClose={closeDialog} /> : null}
      {dialog?.kind === "subscriptions" ? <ExternalSubscriptionsDialog notify={notify} onClose={closeDialog} onNodesChanged={() => load(true)} /> : null}
      {dialog?.kind === "tunnels" ? <Dialog title="Tunnel 管理" description="跨节点服务器管理端口转发与链式隧道" onClose={closeDialog} wide><TunnelsPanel notify={notify} /></Dialog> : null}
      {dialog?.kind === "route" ? <RoutedOutboundDialog node={dialog.node} nodes={nodes} isAdmin={isAdmin} userStatus={userRouted} onClose={closeDialog} onComplete={async () => { closeDialog(); notify(isAdmin ? "路由出站已创建" : "私有路由出站已创建"); await load(true); }} /> : null}
      {dialog?.kind === "temp-sub" ? <TempSubscriptionDialog nodes={dialog.nodes} notify={notify} onClose={closeDialog} /> : null}
      {pending ? <ConfirmDialog title={pending.title} description={pending.description} confirmLabel={pending.confirmLabel} tone={pending.tone} working={working} onCancel={() => !working && setPending(null)} onConfirm={() => void runPending()} /> : null}
    </div>
  );
}

function NodeActions({ node, isAdmin, userRouted, onEdit, onConfig, onRelay, onCancelRelay, onChain, onResolve, onRegion, onRestore, onRoute, onTempSub, onDelete }: {
  node: WorkbenchNode;
  isAdmin: boolean;
  userRouted: UserRoutedOutboundStatus | null;
  onEdit: () => void;
  onConfig: () => void;
  onRelay: () => void;
  onCancelRelay: () => void;
  onChain: () => void;
  onResolve: () => void;
  onRegion: () => void;
  onRestore: () => void;
  onRoute: () => void;
  onTempSub: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const userQuotaAvailable = Boolean(userRouted?.enabled)
    && (userRouted?.quota.max ?? 0) > (userRouted?.quota.used ?? 0)
    && (userRouted?.daily.max ?? 0) > (userRouted?.daily.used ?? 0);
  const canCreateRoute = node.node_type !== "routed" && Boolean(node.original_server && node.inbound_tag) && (isAdmin || userQuotaAvailable);
  const canDeleteUserRoute = !isAdmin && node.node_type === "routed" && node.routed_owner === "user";
  return <div className="nw-row-actions"><IconButton label={`查看 ${node.node_name} 配置`} onClick={onConfig}><Eye size={16} /></IconButton>{isAdmin ? <IconButton label={`编辑 ${node.node_name}`} onClick={onEdit}><Edit3 size={16} /></IconButton> : null}<div className="nw-row-menu"><IconButton label={`更多 ${node.node_name} 操作`} onClick={() => setOpen((value) => !value)}><MoreHorizontal size={17} /></IconButton>{open ? <div className="nw-row-popover">
    <button onClick={() => { onTempSub(); setOpen(false); }}><Link2 size={15} />临时订阅</button>
    {isAdmin ? <button onClick={() => { onRelay(); setOpen(false); }}><Shuffle size={15} />{node.relay_orig_server ? "修改中转" : "设置中转"}</button> : null}
    {isAdmin && node.relay_orig_server ? <button onClick={() => { onCancelRelay(); setOpen(false); }}><RotateCcw size={15} />取消中转</button> : null}
    {isAdmin ? <button onClick={() => { onChain(); setOpen(false); }}><Route size={15} />{node.chain_proxy_node_id ? "修改链式代理" : "设置链式代理"}</button> : null}
    {isAdmin && nodeAddress(node).host && !isIPHost(nodeAddress(node).host) ? <button onClick={() => { onResolve(); setOpen(false); }}><Network size={15} />解析域名为 IP</button> : null}
    {isAdmin ? <button onClick={() => { onRegion(); setOpen(false); }}><MapPin size={15} />地区 Emoji</button> : null}
    {isAdmin && node.original_domain ? <button onClick={() => { onRestore(); setOpen(false); }}><Globe2 size={15} />恢复原域名</button> : null}
    {canCreateRoute ? <button onClick={() => { onRoute(); setOpen(false); }}><Route size={15} />{isAdmin ? "创建路由出站" : "创建私有路由出站"}</button> : null}
    {isAdmin || canDeleteUserRoute ? <button className="is-danger" onClick={() => { onDelete(); setOpen(false); }}><Trash2 size={15} />{canDeleteUserRoute ? "删除私有路由出站" : "删除节点"}</button> : null}
  </div> : null}</div></div>;
}

export function NodeEditor({ node, offer, onClose, onComplete }: { node?: WorkbenchNode; offer?: ManagedNodeOffer; onClose: () => void; onComplete: (message: string) => void }) {
  const initial = node ? readConfig(node) : { name: "", type: "vless", server: "", port: 443 };
  const [form, setForm] = useState({
    name: node?.node_name || String(initial.name || ""),
    protocol: node?.protocol || String(initial.type || "vless"),
    server: String(initial.server || ""),
    port: String(initial.port || 443),
    tags: nodeTags(node ?? {} as WorkbenchNode).join(", "),
    rawURL: node?.raw_url || "",
    enabled: node?.enabled ?? true,
    selfService: offer?.enabled ?? false,
    offerOrder: String(offer?.sort_order ?? 0),
    config: JSON.stringify(initial, null, 2),
  });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const config = JSON.parse(form.config || "{}");
      if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Clash 配置必须是 JSON 对象");
      config.name = form.name.trim();
      config.type = form.protocol.trim().toLowerCase();
      config.server = form.server.trim();
      config.port = Number(form.port);
      if (!config.name || !config.type || !config.server || !config.port) throw new Error("名称、协议、服务器地址和端口均为必填项");
      if (config.port < 1 || config.port > 65535) throw new Error("端口必须在 1-65535 之间");
      const configJSON = JSON.stringify(config);
      const tags = form.tags.split(/[,，\n]/).map((value) => value.trim()).filter(Boolean);
      const payload = {
        raw_url: form.rawURL.trim(),
        node_name: form.name.trim(),
        protocol: form.protocol.trim().toLowerCase(),
        parsed_config: configJSON,
        clash_config: configJSON,
        enabled: form.enabled,
        tag: tags[0] || "",
        tags,
        inbound_tag: node?.inbound_tag || "",
        chain_proxy_node_id: node?.chain_proxy_node_id ?? null,
      };
      if (node) await api.put(`/api/admin/nodes/${node.id}`, payload);
      else await api.post("/api/admin/nodes", payload);
      if (node && offer) {
        await api.put(`/api/admin/managed-node-offers/${offer.id}`, {
          enabled: form.selfService,
          sort_order: Math.max(0, Math.floor(Number(form.offerOrder) || 0)),
        });
      } else if (node && form.selfService) {
        await api.post("/api/admin/managed-node-offers", {
          node_id: node.id,
          enabled: true,
          sort_order: Math.max(0, Math.floor(Number(form.offerOrder) || 0)),
        });
      }
      onComplete(node ? "节点已更新" : "节点已创建");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally { setWorking(false); }
  };
  return <Dialog title={node ? `编辑 ${node.node_name}` : "手工添加节点"} description="基础字段会同步写回完整 Clash JSON 配置" onClose={onClose} wide>
    <form className="form-stack" onSubmit={submit}>
      {error ? <ErrorState message={error} /> : null}
      <div className="form-grid"><Field label="节点名称"><input autoFocus required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field label="协议"><select value={form.protocol} onChange={(event) => setForm({ ...form, protocol: event.target.value })}>{protocols.map((item) => <option value={item} key={item}>{item.toUpperCase()}</option>)}</select></Field></div>
      <div className="form-grid"><Field label="服务器地址"><input required value={form.server} onChange={(event) => setForm({ ...form, server: event.target.value })} placeholder="example.com 或 IP" /></Field><Field label="端口"><input required type="number" min="1" max="65535" value={form.port} onChange={(event) => setForm({ ...form, port: event.target.value })} /></Field></div>
      <Field label="标签" hint="多个标签使用逗号分隔"><input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="香港, 高级线路" /></Field>
      <Field label="原始 URI（可选）"><input value={form.rawURL} onChange={(event) => setForm({ ...form, rawURL: event.target.value })} placeholder="vless://..." /></Field>
      {node?.original_server ? <div className="nw-inline-note"><Server size={16} /><span>受管服务器：<strong>{node.original_server}</strong>{node.inbound_tag ? ` · 入站 ${node.inbound_tag}` : ""}</span></div> : null}
      <Field label="Clash JSON 配置" hint="保存前会校验 JSON，并以顶部基础字段覆盖 name/type/server/port"><textarea className="nw-code-editor" rows={14} spellCheck={false} value={form.config} onChange={(event) => setForm({ ...form, config: event.target.value })} /></Field>
      <Toggle checked={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })} label="启用节点" />
      {node ? <div className="nw-managed-offer"><Toggle checked={form.selfService} disabled={!offer && (!node.original_server || !node.inbound_tag)} onChange={(selfService) => setForm({ ...form, selfService })} label="允许获授权用户自助开通" />{form.selfService ? <Field label="目录排序" hint="数值越小越靠前"><input type="number" min="0" step="1" value={form.offerOrder} onChange={(event) => setForm({ ...form, offerOrder: event.target.value })} /></Field> : null}{!node.original_server || !node.inbound_tag ? <small>需要受管服务器和入站标签后才能发布。</small> : <small>保存时会校验 Agent 的开通、到期和限速能力。</small>}</div> : null}
      <div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={working}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在保存" /> : <><Check size={16} />保存节点</>}</Button></div>
    </form>
  </Dialog>;
}

function ConfigDialog({ node, editable, onClose, onComplete }: { node: WorkbenchNode; editable: boolean; onClose: () => void; onComplete: () => void }) {
  const [config, setConfig] = useState(() => {
    try { return JSON.stringify(JSON.parse(node.clash_config || "{}"), null, 2); } catch { return node.clash_config || "{}"; }
  });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setWorking(true); setError("");
    try {
      const parsed = JSON.parse(config);
      for (const key of ["name", "type", "server", "port"]) if (parsed[key] === undefined || parsed[key] === "") throw new Error(`配置缺少必需字段：${key}`);
      await api.put(`/api/admin/nodes/${node.id}/config`, { clash_config: JSON.stringify(parsed) });
      onComplete();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "配置保存失败"); }
    finally { setWorking(false); }
  };
  const copy = async () => {
    try { await copyText(config); } catch { setError("复制失败，请手动选择配置"); }
  };
  return <Dialog title={`Clash 配置 · ${node.node_name}`} description={editable ? "修改后会同步节点名称和共享订阅" : "当前账户仅可查看配置"} onClose={onClose} wide>
    <div className="form-stack">{error ? <ErrorState message={error} /> : null}<Field label="JSON 配置"><textarea className="nw-code-editor" aria-label="Clash JSON 配置" rows={20} readOnly={!editable} spellCheck={false} value={config} onChange={(event) => setConfig(event.target.value)} /></Field><div className="dialog-actions"><Button variant="secondary" onClick={() => void copy()}><Copy size={16} />复制</Button><Button variant="secondary" onClick={onClose}>关闭</Button>{editable ? <Button onClick={() => void save()} disabled={working}>{working ? <Spinner label="正在保存" /> : <><Check size={16} />保存配置</>}</Button> : null}</div></div>
  </Dialog>;
}

function ImportDialog({ onClose, onComplete }: { onClose: () => void; onComplete: (count: number) => void }) {
  const [mode, setMode] = useState<"content" | "url">("content");
  const [content, setContent] = useState("");
  const [url, setURL] = useState("");
  const [userAgent, setUserAgent] = useState("clash-meta/2.4.0");
  const [tag, setTag] = useState("");
  const [skipCert, setSkipCert] = useState(false);
  const [proxies, setProxies] = useState<Record<string, unknown>[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const parse = async () => {
    setWorking(true); setError("");
    try {
      const response = mode === "url"
        ? await api.post<ParseNodesResponse>("/api/admin/nodes/fetch-subscription", { url: url.trim(), user_agent: userAgent.trim(), force_node_skip_cert: skipCert })
        : await api.post<ParseNodesResponse>("/api/admin/nodes/parse-uris", { content, force_node_skip_cert: skipCert });
      setProxies(response.proxies ?? []);
      if (!tag && response.suggested_tag) setTag(response.suggested_tag);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "解析失败"); }
    finally { setWorking(false); }
  };
  const save = async () => {
    setWorking(true); setError("");
    try {
      const tags = tag.trim() ? [tag.trim()] : [];
      const nodes = proxies.map((proxy, index) => {
        const normalized: Record<string, unknown> = { ...proxy, name: String(proxy.name || `未命名节点 ${index + 1}`) };
        return { raw_url: "", node_name: normalized.name, protocol: String(normalized.type || "unknown"), parsed_config: JSON.stringify(normalized), clash_config: JSON.stringify(normalized), enabled: true, tag: tags[0] || "", tags };
      });
      const response = await api.post<{ nodes?: WorkbenchNode[] }>("/api/admin/nodes/batch", { nodes });
      onComplete(response.nodes?.length ?? nodes.length);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "导入失败"); }
    finally { setWorking(false); }
  };
  return <Dialog title="导入外部节点" description="支持分享链接、Clash YAML、Base64、Surge 行与订阅 URL" onClose={onClose} wide>
    <div className="form-stack">{error ? <ErrorState message={error} /> : null}<div className="nw-tabs" role="tablist"><button role="tab" aria-selected={mode === "content"} className={mode === "content" ? "is-active" : ""} onClick={() => { setMode("content"); setProxies([]); }}><Clipboard size={16} />粘贴内容</button><button role="tab" aria-selected={mode === "url"} className={mode === "url" ? "is-active" : ""} onClick={() => { setMode("url"); setProxies([]); }}><Globe2 size={16} />订阅 URL</button></div>
      {!proxies.length ? <>
        {mode === "content" ? <Field label="节点内容"><textarea autoFocus rows={12} value={content} onChange={(event) => setContent(event.target.value)} placeholder="vless://...&#10;trojan://...&#10;或粘贴完整 Clash YAML" /></Field> : <><Field label="订阅地址"><input autoFocus required type="url" value={url} onChange={(event) => setURL(event.target.value)} placeholder="https://example.com/subscribe" /></Field><Field label="User-Agent"><input value={userAgent} onChange={(event) => setUserAgent(event.target.value)} /></Field></>}
        <div className="form-grid"><Field label="分类标签"><input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="例如：机场 A" /></Field><div className="field toggle-field"><span className="field-label">TLS 选项</span><Toggle checked={skipCert} onChange={setSkipCert} label="强制跳过证书校验" /></div></div>
        <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>取消</Button><Button disabled={working || (mode === "content" ? !content.trim() : !url.trim())} onClick={() => void parse()}>{working ? <Spinner label="正在解析" /> : <><ListFilter size={16} />解析并预览</>}</Button></div>
      </> : <>
        <div className="nw-import-summary"><span><strong>识别到 {proxies.length} 个节点</strong><small>保存前可返回修改来源、标签与证书选项</small></span><Badge tone="good">解析成功</Badge></div>
        <div className="nw-preview-list">{proxies.slice(0, 100).map((proxy, index) => <div key={`${String(proxy.name)}-${index}`}><span><strong>{String(proxy.name || `未命名 ${index + 1}`)}</strong><small>{String(proxy.server || "-")}:{String(proxy.port || "-")}</small></span><Badge tone="info">{String(proxy.type || "unknown").toUpperCase()}</Badge></div>)}</div>
        <div className="dialog-actions"><Button variant="secondary" onClick={() => setProxies([])}>返回修改</Button><Button disabled={working} onClick={() => void save()}>{working ? <Spinner label="正在导入" /> : <><Upload size={16} />保存 {proxies.length} 个节点</>}</Button></div>
      </>}
    </div>
  </Dialog>;
}

function RelayDialog({ node, onClose, onComplete }: { node: WorkbenchNode; onClose: () => void; onComplete: () => void }) {
  const address = nodeAddress(node);
  const [server, setServer] = useState(node.relay_orig_server ? address.host : "");
  const [port, setPort] = useState(node.relay_orig_server ? String(address.port) : "");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError("");
    try { await api.put(`/api/admin/nodes/${node.id}/relay`, { relay_server: server.trim(), relay_port: Number(port) || 0 }); onComplete(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "中转配置失败"); }
    finally { setWorking(false); }
  };
  return <Dialog title={`${node.relay_orig_server ? "修改" : "设置"}节点中转`} description={`节点 ${node.node_name} 的客户端连接地址将切换到中转服务器`} onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<div className="nw-inline-note"><Network size={16} /><span>当前目标：<code>{address.host}:{address.port}</code>{node.relay_orig_server ? ` · 原站 ${node.relay_orig_server}:${node.relay_orig_port}` : ""}</span></div><Field label="中转服务器"><input autoFocus required value={server} onChange={(event) => setServer(event.target.value)} placeholder="relay.example.com 或 IP" /></Field><Field label="中转端口" hint="留空沿用节点端口"><input type="number" min="1" max="65535" value={port} onChange={(event) => setPort(event.target.value)} /></Field><div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在更新" /> : <><Shuffle size={16} />应用中转</>}</Button></div></form>
  </Dialog>;
}

export function ChainProxyDialog({ node, nodes, onClose, onComplete }: {
  node: WorkbenchNode;
  nodes: WorkbenchNode[];
  onClose: () => void;
  onComplete: () => void | Promise<void>;
}) {
  const targets = useMemo(() => nodes.filter((item) => item.id !== node.id), [node.id, nodes]);
  const [targetID, setTargetID] = useState(targets.some((item) => item.id === node.chain_proxy_node_id) ? String(node.chain_proxy_node_id) : "");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true); setError("");
    try {
      const chainProxyNodeID = targetID ? Number(targetID) : null;
      if (chainProxyNodeID === node.id || (chainProxyNodeID && !targets.some((item) => item.id === chainProxyNodeID))) throw new Error("请选择有效的前置代理节点");
      await api.put(`/api/admin/nodes/${node.id}`, nodePayload(node, { chain_proxy_node_id: chainProxyNodeID }));
      await onComplete();
    } catch (reason) { setError(reasonMessage(reason, "链式代理更新失败")); }
    finally { setWorking(false); }
  };
  const selectedTarget = targets.find((item) => item.id === Number(targetID));
  return <Dialog title={`链式代理 · ${node.node_name}`} description="让当前节点先通过另一个节点拨号，订阅会自动注入 dialer-proxy" onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      {error ? <ErrorState message={error} /> : null}
      <div className="nw-inline-note"><Route size={16} /><span>当前节点不会出现在候选列表中，选择“直接连接”可清除已有链式代理。</span></div>
      <Field label="前置代理节点"><select aria-label="前置代理节点" value={targetID} onChange={(event) => setTargetID(event.target.value)}><option value="">直接连接（不使用链式代理）</option>{targets.map((item) => { const address = nodeAddress(item); return <option key={item.id} value={item.id}>{item.node_name} · {item.protocol.toUpperCase()} · {address.host || "地址未知"}{item.enabled ? "" : "（已停用）"}</option>; })}</select></Field>
      {selectedTarget ? <div className="nw-chain-preview"><Badge tone="info">{selectedTarget.protocol.toUpperCase()}</Badge><span><strong>{node.node_name}</strong><small>经由 {selectedTarget.node_name} 建立连接</small></span></div> : null}
      {!targets.length ? <ErrorState message="没有其他节点可作为前置代理" /> : null}
      <div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={working}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在保存" /> : <><Check size={16} />保存链式代理</>}</Button></div>
    </form>
  </Dialog>;
}

export function ResolveIPDialog({ node, onClose, onComplete }: {
  node: WorkbenchNode;
  onClose: () => void;
  onComplete: () => void | Promise<void>;
}) {
  const hostname = nodeAddress(node).host;
  const [ips, setIPs] = useState<string[]>([]);
  const [selectedIP, setSelectedIP] = useState("");
  const [resolving, setResolving] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const resolve = async () => {
    if (!hostname) return setError("节点缺少服务器域名");
    setResolving(true); setError(""); setIPs([]); setSelectedIP("");
    try {
      const response = await api.get<{ ips?: string[] }>(`/api/dns/resolve?hostname=${encodeURIComponent(hostname)}`);
      const resolved = Array.from(new Set((response.ips ?? []).filter(Boolean)));
      if (!resolved.length) throw new Error("DNS 未返回可用 IP");
      setIPs(resolved); setSelectedIP(resolved[0]);
    } catch (reason) { setError(reasonMessage(reason, "域名解析失败")); }
    finally { setResolving(false); }
  };
  const apply = async () => {
    if (!selectedIP) return setError("请先选择一个解析结果");
    setWorking(true); setError("");
    try {
      await api.put(`/api/admin/nodes/${node.id}/server`, { server: selectedIP });
      await onComplete();
    } catch (reason) { setError(reasonMessage(reason, "服务器地址更新失败")); }
    finally { setWorking(false); }
  };
  return <Dialog title={`解析域名为 IP · ${node.node_name}`} description="固定节点服务器地址；原域名会被保留，可随时从更多菜单恢复" onClose={onClose}>
    <div className="form-stack">
      {error ? <ErrorState message={error} /> : null}
      <div className="nw-inline-note"><Globe2 size={16} /><span>待解析域名：<code>{hostname || "-"}</code></span></div>
      <Button variant="secondary" onClick={() => void resolve()} disabled={resolving || working || !hostname}>{resolving ? <Spinner label="正在解析" /> : <><Network size={16} />解析域名</>}</Button>
      {ips.length ? <fieldset className="nw-ip-list"><legend>选择服务器 IP</legend>{ips.map((ip) => <label key={ip}><input type="radio" name="resolved-ip" aria-label={`使用 ${ip}`} checked={selectedIP === ip} onChange={() => setSelectedIP(ip)} /><span><code>{ip}</code><Badge tone="neutral">{ip.includes(":") ? "IPv6" : "IPv4"}</Badge></span></label>)}</fieldset> : null}
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose} disabled={working}>取消</Button><Button onClick={() => void apply()} disabled={working || !selectedIP}>{working ? <Spinner label="正在应用" /> : <><Check size={16} />应用 IP</>}</Button></div>
    </div>
  </Dialog>;
}

const regionEmojis = [
  { emoji: "🇭🇰", label: "香港" }, { emoji: "🇹🇼", label: "台湾" }, { emoji: "🇯🇵", label: "日本" },
  { emoji: "🇸🇬", label: "新加坡" }, { emoji: "🇰🇷", label: "韩国" }, { emoji: "🇺🇸", label: "美国" },
  { emoji: "🇬🇧", label: "英国" }, { emoji: "🇩🇪", label: "德国" }, { emoji: "🇫🇷", label: "法国" },
  { emoji: "🇨🇦", label: "加拿大" }, { emoji: "🇦🇺", label: "澳大利亚" }, { emoji: "🇮🇳", label: "印度" },
  { emoji: "🌐", label: "全球" },
] as const;

function withoutRegionEmoji(name: string): string {
  const trimmed = name.trim();
  const prefix = regionEmojis.find((item) => trimmed.startsWith(item.emoji));
  return prefix ? trimmed.slice(prefix.emoji.length).trimStart() : trimmed;
}

export function RegionEmojiDialog({ node, onClose, onComplete }: {
  node: WorkbenchNode;
  onClose: () => void;
  onComplete: () => void | Promise<void>;
}) {
  const current = regionEmojis.find((item) => node.node_name.trim().startsWith(item.emoji))?.emoji ?? "";
  const [emoji, setEmoji] = useState(current);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const baseName = withoutRegionEmoji(node.node_name);
  const nextName = emoji ? `${emoji} ${baseName}` : baseName;
  const save = async () => {
    if (!nextName) return setError("节点名称不能为空");
    setWorking(true); setError("");
    try {
      await api.put(`/api/admin/nodes/${node.id}`, nodePayload(node, { node_name: nextName }));
      await onComplete();
    } catch (reason) { setError(reasonMessage(reason, "地区标识更新失败")); }
    finally { setWorking(false); }
  };
  return <Dialog title={`地区 Emoji · ${node.node_name}`} description="为节点名称添加或替换统一的地区前缀" onClose={onClose}>
    <div className="form-stack">
      {error ? <ErrorState message={error} /> : null}
      <div className="nw-region-grid"><button type="button" className={!emoji ? "is-active" : ""} onClick={() => setEmoji("")}><span>—</span><small>无标识</small></button>{regionEmojis.map((item) => <button type="button" key={item.emoji} aria-label={`${item.label} ${item.emoji}`} className={emoji === item.emoji ? "is-active" : ""} onClick={() => setEmoji(item.emoji)}><span>{item.emoji}</span><small>{item.label}</small></button>)}</div>
      <div className="nw-inline-note"><MapPin size={16} /><span>名称预览：<strong>{nextName}</strong></span></div>
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose} disabled={working}>取消</Button><Button onClick={() => void save()} disabled={working}>{working ? <Spinner label="正在保存" /> : <><Check size={16} />保存地区标识</>}</Button></div>
    </div>
  </Dialog>;
}

function BatchRenameDialog({ nodes, onClose, onComplete }: { nodes: WorkbenchNode[]; onClose: () => void; onComplete: (count: number) => void }) {
  const [names, setNames] = useState(nodes.map((node) => node.node_name));
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const applyNames = async () => {
    if (names.length !== nodes.length || names.some((name) => !name.trim())) return setError(`名称必须正好 ${nodes.length} 行且不能为空`);
    setWorking(true); setError("");
    try {
      const result = await api.post<{ success?: number; failed?: number }>("/api/admin/nodes/batch-rename", { updates: nodes.map((node, index) => ({ node_id: node.id, new_name: names[index].trim() })) });
      if (result.failed) setError(`${result.failed} 个节点改名失败`);
      else onComplete(result.success ?? nodes.length);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "批量改名失败"); }
    finally { setWorking(false); }
  };
  return <Dialog title="批量修改节点名称" description={`按当前选择顺序修改 ${nodes.length} 个节点`} onClose={onClose} wide><div className="form-stack">{error ? <ErrorState message={error} /> : null}<div className="nw-rename-tools"><Field label="查找"><input value={find} onChange={(event) => setFind(event.target.value)} /></Field><Field label="替换为"><input value={replace} onChange={(event) => setReplace(event.target.value)} /></Field><Button variant="secondary" disabled={!find} onClick={() => setNames(names.map((name) => name.split(find).join(replace)))}>替换</Button></div><div className="nw-rename-tools"><Field label="前缀"><input value={prefix} onChange={(event) => setPrefix(event.target.value)} /></Field><Field label="后缀"><input value={suffix} onChange={(event) => setSuffix(event.target.value)} /></Field><Button variant="secondary" disabled={!prefix && !suffix} onClick={() => setNames(names.map((name) => `${prefix}${name}${suffix}`))}>应用</Button></div><Field label={`节点名称（每行一个，共 ${nodes.length} 行）`}><textarea rows={Math.min(16, Math.max(6, nodes.length + 1))} value={names.join("\n")} onChange={(event) => setNames(event.target.value.split("\n"))} /></Field><div className="dialog-actions"><Button variant="secondary" onClick={onClose}>取消</Button><Button disabled={working} onClick={() => void applyNames()}>{working ? <Spinner label="正在修改" /> : <><Edit3 size={16} />确认修改</>}</Button></div></div></Dialog>;
}

function BatchTagsDialog({ nodes, available, onClose, onComplete }: { nodes: WorkbenchNode[]; available: string[]; onClose: () => void; onComplete: (count: number) => void }) {
  const same = nodes.length && nodes.every((node) => JSON.stringify(nodeTags(node)) === JSON.stringify(nodeTags(nodes[0])));
  const [tags, setTags] = useState<string[]>(same ? nodeTags(nodes[0]) : []);
  const [input, setInput] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const add = (value: string) => { const clean = value.trim(); if (clean && !tags.includes(clean)) setTags([...tags, clean]); setInput(""); };
  const save = async () => {
    setWorking(true); setError("");
    try {
      await Promise.all(nodes.map((node) => api.put(`/api/admin/nodes/${node.id}`, nodePayload(node, { tags, tag: tags[0] || "" }))));
      onComplete(nodes.length);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "标签更新失败"); }
    finally { setWorking(false); }
  };
  return <Dialog title={nodes.length === 1 ? `修改 ${nodes[0].node_name} 标签` : "批量修改标签"} description={`标签将覆盖选中的 ${nodes.length} 个节点`} onClose={onClose}><div className="form-stack">{error ? <ErrorState message={error} /> : null}<Field label="标签"><div className="nw-chip-input">{tags.map((item) => <span key={item}>{item}<button aria-label={`移除标签 ${item}`} onClick={() => setTags(tags.filter((tag) => tag !== item))}><X size={12} /></button></span>)}<input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(input); } }} onBlur={() => add(input)} placeholder={tags.length ? "继续输入" : "输入标签后按回车"} /></div></Field>{available.length ? <div className="nw-tag-choices">{available.map((item) => <button key={item} className={tags.includes(item) ? "is-active" : ""} onClick={() => tags.includes(item) ? setTags(tags.filter((tag) => tag !== item)) : setTags([...tags, item])}>{item}</button>)}</div> : null}<div className="dialog-actions"><Button variant="secondary" onClick={onClose}>取消</Button><Button disabled={working} onClick={() => void save()}>{working ? <Spinner label="正在保存" /> : <><Tag size={16} />保存标签</>}</Button></div></div></Dialog>;
}

function reasonMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function DialogStatusBar({ children }: { children: ReactNode }) {
  return <div className="nw-dialog-status">{children}</div>;
}

export function SpeedDialog({ nodes, initialNodeIDs, latest, notify, onClose, onRefresh, onOpenHistory, onManageTesters }: {
  nodes: WorkbenchNode[];
  initialNodeIDs: number[];
  latest: Record<number, SpeedResult>;
  notify: NodesWorkbenchNotify;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onOpenHistory: (nodeID: number) => void;
  onManageTesters: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(initialNodeIDs));
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("master");
  const [threads, setThreads] = useState("1");
  const [bytes, setBytes] = useState("0");
  const [url, setURL] = useState("");
  const [latencyOnly, setLatencyOnly] = useState(false);
  const [testers, setTesters] = useState<SpeedTester[]>([]);
  const [mihomoReady, setMihomoReady] = useState<boolean | null>(null);
  const [loadingTools, setLoadingTools] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const loadTools = useCallback(async () => {
    setLoadingTools(true);
    try {
      const [testerResponse, statusResponse] = await Promise.all([
        api.get<{ testers?: SpeedTester[] }>("/api/admin/speedtest/testers"),
        api.get<{ ready?: boolean }>("/api/admin/speedtest/mihomo-status").catch(() => ({ ready: false })),
      ]);
      setTesters(testerResponse.testers ?? []);
      setMihomoReady(Boolean(statusResponse.ready));
    } catch (reason) {
      setError(reasonMessage(reason, "测速能力加载失败"));
    } finally { setLoadingTools(false); }
  }, []);

  useEffect(() => { void loadTools(); }, [loadTools]);
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return nodes.filter((node) => {
      if (!query) return true;
      const address = nodeAddress(node);
      return [node.node_name, node.protocol, address.host].some((value) => value.toLowerCase().includes(query));
    });
  }, [nodes, search]);
  const allVisibleSelected = rows.length > 0 && rows.every((node) => selected.has(node.id));
  const toggleVisible = () => setSelected((current) => {
    const next = new Set(current);
    if (allVisibleSelected) rows.forEach((node) => next.delete(node.id)); else rows.forEach((node) => next.add(node.id));
    return next;
  });
  const toggleOne = (id: number) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const run = async (nodeIDs = [...selected]) => {
    if (!nodeIDs.length) return setError("请至少选择一个节点");
    const testerID = source === "master" ? 0 : Number(source);
    if (testerID && !testers.some((tester) => tester.id === testerID && tester.online)) return setError("选择的测速端当前不在线");
    setWorking(true);
    setError("");
    try {
      const payload = {
        bytes: Number(bytes),
        threads: Number(threads),
        latency_only: latencyOnly,
        ...(url.trim() && !latencyOnly ? { url: url.trim() } : {}),
        ...(testerID ? { tester_id: testerID } : {}),
      };
      await Promise.all(nodeIDs.map((nodeID) => api.post("/api/admin/speedtest/run", { ...payload, node_id: nodeID })));
      notify(nodeIDs.length === 1 ? "节点测速已开始" : `已提交 ${nodeIDs.length} 个节点测速`);
      await onRefresh();
    } catch (reason) {
      setError(reasonMessage(reason, "测速任务提交失败"));
    } finally { setWorking(false); }
  };

  return <Dialog title="节点测速工作台" description="选择测速来源、线程与节点；任务在后台执行，关闭窗口不会中断" onClose={onClose} wide>
    <div className="form-stack nw-speed-dialog">
      {error ? <ErrorState message={error} /> : null}
      <div className="nw-speed-controls">
        <Field label="测速来源"><select aria-label="测速来源" value={source} onChange={(event) => setSource(event.target.value)}><option value="master">主控本机{mihomoReady === false ? "（首次运行会安装内核）" : ""}</option>{testers.map((tester) => <option key={tester.id} value={String(tester.id)} disabled={!tester.online}>{tester.name || `测速端 #${tester.id}`}{tester.online ? "" : "（离线）"}</option>)}</select></Field>
        <Field label="并发线程"><select aria-label="并发线程" value={threads} onChange={(event) => setThreads(event.target.value)} disabled={latencyOnly}><option value="1">单线程</option><option value="4">4 线程</option><option value="8">8 线程</option></select></Field>
        <Field label="流量上限"><select aria-label="流量上限" value={bytes} onChange={(event) => setBytes(event.target.value)} disabled={latencyOnly}><option value="0">按 8 秒计时</option><option value={String(25 * 1024 ** 2)}>25 MB</option><option value={String(100 * 1024 ** 2)}>100 MB</option><option value={String(500 * 1024 ** 2)}>500 MB</option></select></Field>
        <div className="nw-speed-control-actions"><Button variant="secondary" onClick={onManageTesters}><Settings2 size={16} />管理测速端</Button><IconButton label="刷新测速能力" onClick={() => void loadTools()} disabled={loadingTools}><RefreshCw size={17} /></IconButton></div>
      </div>
      <div className="nw-speed-options"><Toggle checked={latencyOnly} onChange={setLatencyOnly} label="仅测试真实连接延迟" /><Field label="自定义下载地址（可选）"><input type="url" value={url} disabled={latencyOnly} onChange={(event) => setURL(event.target.value)} placeholder="留空使用内置测速地址" /></Field></div>
      <div className="nw-list-toolbar"><div className="search-box"><Search size={16} /><input aria-label="搜索测速节点" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索节点或服务器" /></div><span>{selected.size} 个已选</span>{selected.size ? <Button onClick={() => void run()} disabled={working}>{working ? <Spinner label="正在提交" /> : <><Gauge size={16} />开始测速</>}</Button> : null}</div>
      <div className="nw-dialog-table"><table><thead><tr><th className="nw-check-col"><input aria-label="选择全部测速节点" type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} /></th><th>协议 / 节点</th><th>服务器</th><th>最新速度</th><th>延迟</th><th aria-label="操作" /></tr></thead><tbody>{rows.map((node) => { const result = latest[node.id]; const address = nodeAddress(node); return <tr key={node.id}><td><input aria-label={`选择测速 ${node.node_name}`} type="checkbox" checked={selected.has(node.id)} onChange={() => toggleOne(node.id)} /></td><td><div className="nw-node-primary"><Badge tone="info">{node.protocol.toUpperCase()}</Badge><strong>{node.node_name}</strong></div></td><td><code className="nw-address">{address.host}:{address.port}</code></td><td><Badge tone={speedTone(result)}>{resultLabel(result)}</Badge>{result?.error ? <small className="cell-note" title={result.error}>{result.error}</small> : null}</td><td>{result?.status === "ok" ? `${result.latency_ms} ms` : "-"}</td><td><div className="nw-row-actions"><IconButton label={`查看 ${node.node_name} 测速历史`} onClick={() => onOpenHistory(node.id)}><History size={16} /></IconButton><IconButton label={`测试 ${node.node_name}`} disabled={working || result?.status === "running"} onClick={() => void run([node.id])}>{result?.status === "running" ? <Activity size={16} /> : <Play size={16} />}</IconButton></div></td></tr>; })}</tbody></table></div>
      {!rows.length ? <EmptyState icon={<Gauge size={22} />} title="没有匹配节点" description="调整搜索条件后重试" /> : null}
      <DialogStatusBar><span><ShieldCheck size={15} />主控测速会串行运行，避免多个节点争抢带宽</span><Button variant="secondary" onClick={onClose}>关闭</Button></DialogStatusBar>
    </div>
  </Dialog>;
}

export function SpeedHistoryDialog({ initialNodeID, onClose }: { initialNodeID?: number; onClose: () => void }) {
  const [nodeID, setNodeID] = useState(initialNodeID ? String(initialNodeID) : "all");
  const [results, setResults] = useState<SpeedResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const query = nodeID === "all" ? "limit=200" : `node_id=${encodeURIComponent(nodeID)}&limit=100`;
      const response = await api.get<{ results?: SpeedResult[] | null }>(`/api/admin/speedtest/results?${query}`);
      setResults(response.results ?? []);
    } catch (reason) { setError(reasonMessage(reason, "测速记录加载失败")); }
    finally { if (!quiet) setLoading(false); }
  }, [nodeID]);
  useEffect(() => { void load(); }, [load]);
  const running = results.some((result) => result.status === "running");
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void load(true), 3000);
    return () => window.clearInterval(timer);
  }, [load, running]);
  const nodes = useMemo(() => Array.from(new Map(results.map((result) => [result.node_id, result.node_name])).entries()), [results]);
  return <Dialog title="测速结果" description="保留每个节点的测速来源、出口地址、流量与失败原因" onClose={onClose} wide><div className="form-stack">
    {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
    <div className="nw-list-toolbar"><Field label="节点筛选"><select aria-label="测速历史节点" value={nodeID} onChange={(event) => setNodeID(event.target.value)}><option value="all">全部节点</option>{initialNodeID && !nodes.some(([id]) => id === initialNodeID) ? <option value={String(initialNodeID)}>节点 #{initialNodeID}</option> : null}{nodes.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}</select></Field><span>{results.length} 条记录</span><IconButton label="刷新测速记录" onClick={() => void load()} disabled={loading}><RefreshCw size={17} /></IconButton></div>
    {loading ? <div className="center-state"><Spinner label="正在加载测速记录" /></div> : results.length ? <div className="nw-dialog-table"><table><thead><tr><th>节点</th><th>来源</th><th>下载速度</th><th>延迟</th><th>测试流量</th><th>出口 IP</th><th>状态</th><th>时间</th></tr></thead><tbody>{results.map((result) => <tr key={result.id}><td><strong>{result.node_name}</strong><small className="cell-note">#{result.node_id}</small></td><td>{result.source === "home_tester" ? "家用测速端" : "主控本机"}</td><td>{result.down_mbps > 0 ? `${result.down_mbps.toFixed(1)} Mbps` : "-"}</td><td>{result.latency_ms > 0 ? `${result.latency_ms} ms` : "-"}</td><td>{formatBytes(result.test_bytes)}</td><td><code className="nw-address">{result.egress_ip || "-"}</code></td><td><Badge tone={speedTone(result)}>{result.status === "ok" ? "完成" : result.status === "running" ? "进行中" : "失败"}</Badge>{result.error ? <small className="cell-note nw-error-note" title={result.error}>{result.error}</small> : null}</td><td>{formatDate(result.created_at)}</td></tr>)}</tbody></table></div> : <EmptyState icon={<History size={22} />} title="暂无测速记录" />}
    <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>关闭</Button></div>
  </div></Dialog>;
}

interface TesterCredential {
  token: string;
  name: string;
}

export function TestersDialog({ notify, onClose }: { notify: NodesWorkbenchNotify; onClose: () => void }) {
  const [testers, setTesters] = useState<SpeedTester[]>([]);
  const [name, setName] = useState("");
  const [credential, setCredential] = useState<TesterCredential | null>(null);
  const [loading, setLoading] = useState(true);
  const [workingID, setWorkingID] = useState<number | "create" | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<number | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try { const response = await api.get<{ testers?: SpeedTester[] }>("/api/admin/speedtest/testers"); setTesters(response.testers ?? []); }
    catch (reason) { setError(reasonMessage(reason, "测速端列表加载失败")); }
    finally { if (!quiet) setLoading(false); }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 5000);
    return () => window.clearInterval(timer);
  }, [load]);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    setWorkingID("create"); setError("");
    const testerName = name.trim() || "home-tester";
    try {
      const response = await api.post<{ id: number; token: string }>("/api/admin/speedtest/testers/create", { name: testerName });
      setCredential({ token: response.token, name: testerName }); setName(""); notify("测速端已创建，请立即保存配对命令"); await load(true);
    } catch (reason) { setError(reasonMessage(reason, "测速端创建失败")); }
    finally { setWorkingID(null); }
  };
  const rotate = async (tester: SpeedTester) => {
    setWorkingID(tester.id); setError("");
    try {
      const response = await api.post<{ token: string }>("/api/admin/speedtest/testers/rotate-token", { id: tester.id });
      setCredential({ token: response.token, name: tester.name || `tester-${tester.id}` }); notify("配对令牌已轮换，旧令牌已失效");
    } catch (reason) { setError(reasonMessage(reason, "令牌轮换失败")); }
    finally { setWorkingID(null); }
  };
  const revoke = async (tester: SpeedTester) => {
    setWorkingID(tester.id); setError("");
    try { await api.post("/api/admin/speedtest/testers/revoke", { id: tester.id }); setConfirmRevoke(null); notify("测速端已删除"); await load(true); }
    catch (reason) { setError(reasonMessage(reason, "测速端删除失败")); }
    finally { setWorkingID(null); }
  };
  const masterURL = typeof window === "undefined" ? "https://your-panel.example" : window.location.origin;
  const scriptBase = "https://raw.githubusercontent.com/mmwx-group/mmwX-plugins/refs/heads/main/speedtest/scripts";
  const commands = credential ? [
    { label: "Linux", value: `curl -fsSL ${scriptBase}/install.sh | bash -s -- -master ${masterURL} -token ${credential.token}` },
    { label: "Windows PowerShell", value: `irm ${scriptBase}/install.ps1 -OutFile install.ps1; .\\install.ps1 -Master ${masterURL} -Token ${credential.token}` },
    { label: "Docker", value: `docker run -d --name mmwx-speedtester --restart unless-stopped -e MMWX_MASTER=${masterURL} -e MMWX_SPEEDTEST_TOKEN=${credential.token} -e MMWX_SPEEDTEST_NAME=${credential.name} -v mmwx-speedtester-data:/data ghcr.io/mmwx-group/mmwx-speedtester:latest` },
  ] : [];
  const copy = async (value: string) => {
    try { await copyText(value); notify("已复制配对信息"); }
    catch { setError("无法访问剪贴板，请手动选择并保存"); }
  };
  return <Dialog title="测速端管理" description="配对家中或其他网络的测速端，以真实用户出口测试节点" onClose={onClose} wide><div className="form-stack">
    {error ? <ErrorState message={error} /> : null}
    <form className="nw-inline-create" onSubmit={create}><Field label="测速端名称"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="home-tester" /></Field><Button type="submit" disabled={workingID !== null}>{workingID === "create" ? <Spinner label="正在创建" /> : <><Plus size={16} />创建测速端</>}</Button></form>
    {credential ? <section className="nw-secret-panel"><div className="nw-secret-heading"><KeyRound size={18} /><span><strong>一次性配对信息</strong><small>令牌只会显示这一次；丢失后需要轮换</small></span><Button variant="ghost" onClick={() => setCredential(null)}>已保存</Button></div><Field label="配对令牌"><div className="nw-copy-field"><input readOnly value={credential.token} /><IconButton label="复制配对令牌" onClick={() => void copy(credential.token)}><Copy size={16} /></IconButton></div></Field>{commands.map((command) => <Field key={command.label} label={command.label}><div className="nw-command-copy"><code>{command.value}</code><IconButton label={`复制 ${command.label} 安装命令`} onClick={() => void copy(command.value)}><Copy size={16} /></IconButton></div></Field>)}</section> : null}
    <div className="nw-list-heading"><span><Wifi size={17} /><strong>已配对测速端</strong></span><IconButton label="刷新测速端" onClick={() => void load()} disabled={loading}><RefreshCw size={17} /></IconButton></div>
    {loading ? <div className="center-state"><Spinner label="正在加载测速端" /></div> : testers.length ? <div className="nw-tester-list">{testers.map((tester) => <div key={tester.id}><span className={`nw-online-dot ${tester.online ? "is-online" : ""}`} /><span className="nw-tester-info"><strong>{tester.name || `测速端 #${tester.id}`}</strong><small>#{tester.id} · {tester.online ? "当前在线" : `最后在线 ${formatDate(tester.last_seen)}`}{tester.created_by ? ` · ${tester.created_by}` : ""}</small></span><Badge tone={tester.online ? "good" : "neutral"}>{tester.online ? "在线" : "离线"}</Badge><Button variant="secondary" disabled={workingID !== null || tester.online} title={tester.online ? "在线测速端无需重新配对" : "生成新令牌，旧令牌立即失效"} onClick={() => void rotate(tester)}><RotateCcw size={15} />重新配对</Button>{confirmRevoke === tester.id ? <><Button variant="danger" disabled={workingID !== null} onClick={() => void revoke(tester)}>确认删除</Button><Button variant="ghost" onClick={() => setConfirmRevoke(null)}>取消</Button></> : <IconButton label={`删除测速端 ${tester.name}`} onClick={() => setConfirmRevoke(tester.id)}><Trash2 size={16} /></IconButton>}</div>)}</div> : <EmptyState icon={<Wifi size={22} />} title="还没有测速端" description="创建后在目标设备运行配对命令" />}
    <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>关闭</Button></div>
  </div></Dialog>;
}

export function URIManagerDialog({ notify, onClose }: { notify: NodesWorkbenchNotify; onClose: () => void }) {
  const [items, setItems] = useState<NodeURI[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [username, setUsername] = useState("all");
  const [protocol, setProtocol] = useState("all");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const response = await api.get<{ items?: NodeURI[] }>("/api/admin/node-uris"); setItems(response.items ?? []); }
    catch (reason) { setError(reasonMessage(reason, "URI 列表加载失败")); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const usernames = useMemo(() => Array.from(new Set(items.map((item) => item.username))).sort(), [items]);
  const protocols = useMemo(() => Array.from(new Set(items.map((item) => item.protocol))).sort(), [items]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => (username === "all" || item.username === username) && (protocol === "all" || item.protocol === protocol) && (!query || [item.username, item.node_name, item.protocol, item.uri].some((value) => value.toLowerCase().includes(query))));
  }, [items, protocol, search, username]);
  const copy = async (value: string, message: string) => {
    try { await copyText(value); notify(message); }
    catch { setError("无法访问剪贴板，请手动选择 URI"); }
  };
  return <Dialog title="URI 管理器" description="按用户生成已注入专属凭据的节点分享链接" onClose={onClose} wide><div className="form-stack">
    {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
    <div className="nw-uri-filters"><div className="search-box"><Search size={16} /><input aria-label="搜索 URI" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="用户、节点、协议或链接" /></div><Field label="用户"><select aria-label="URI 用户" value={username} onChange={(event) => setUsername(event.target.value)}><option value="all">全部用户</option>{usernames.map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="协议"><select aria-label="URI 协议" value={protocol} onChange={(event) => setProtocol(event.target.value)}><option value="all">全部协议</option>{protocols.map((item) => <option key={item}>{item.toUpperCase()}</option>)}</select></Field><Button variant="secondary" disabled={!visible.length} onClick={() => void copy(visible.map((item) => item.uri).join("\n"), `已复制 ${visible.length} 条 URI`)}><FileDown size={16} />复制当前结果</Button></div>
    {loading ? <div className="center-state"><Spinner label="正在生成 URI" /></div> : visible.length ? <div className="nw-dialog-table"><table><thead><tr><th>用户</th><th>协议 / 节点</th><th>类型</th><th>分享 URI</th><th aria-label="操作" /></tr></thead><tbody>{visible.map((item) => <tr key={`${item.username}-${item.node_id}`}><td><span className="nw-user-cell"><UserRound size={15} />{item.username}</span></td><td><div className="nw-node-primary"><Badge tone="info">{item.protocol.toUpperCase()}</Badge><strong>{item.node_name}</strong></div></td><td><Badge>{item.node_type === "routed" ? "路由出站" : "物理节点"}</Badge></td><td><code className="nw-uri-value" title={item.uri}>{item.uri}</code></td><td><IconButton label={`复制 ${item.username} 的 ${item.node_name} URI`} onClick={() => void copy(item.uri, "URI 已复制")}><Copy size={16} /></IconButton></td></tr>)}</tbody></table></div> : <EmptyState icon={<Link2 size={22} />} title={items.length ? "没有匹配 URI" : "暂无可用 URI"} description={items.length ? "调整筛选条件后重试" : "用户需要拥有套餐节点或可见的专属节点"} />}
    <DialogStatusBar><span>{visible.length} / {items.length} 条 URI</span><Button variant="secondary" onClick={onClose}>关闭</Button></DialogStatusBar>
  </div></Dialog>;
}

interface ExternalSubscriptionForm {
  name: string;
  url: string;
  user_agent: string;
  traffic_mode: string;
}

const emptyExternalForm: ExternalSubscriptionForm = {
  name: "",
  url: "",
  user_agent: "clash-meta/2.4.0",
  traffic_mode: "both",
};

export function ExternalSubscriptionsDialog({ notify, onClose, onNodesChanged }: { notify: NodesWorkbenchNotify; onClose: () => void; onNodesChanged: () => Promise<void> }) {
  const [subscriptions, setSubscriptions] = useState<ExternalSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<ExternalSubscription | "create" | null>(null);
  const [form, setForm] = useState<ExternalSubscriptionForm>(emptyExternalForm);
  const [working, setWorking] = useState<string | number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await api.get<ExternalSubscription[]>("/api/user/external-subscriptions");
      setSubscriptions(Array.isArray(response) ? response : []);
    } catch (reason) { setError(reasonMessage(reason, "外部订阅加载失败")); }
    finally { if (!quiet) setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return subscriptions.filter((item) => !query || [item.name, item.url, item.username || ""].some((value) => value.toLowerCase().includes(query)));
  }, [search, subscriptions]);
  const openEditor = (item?: ExternalSubscription) => {
    setEditor(item ?? "create");
    setForm(item ? { name: item.name, url: item.url, user_agent: item.user_agent || "clash-meta/2.4.0", traffic_mode: item.traffic_mode || "both" } : { ...emptyExternalForm });
    setError("");
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.url.trim()) return setError("名称和订阅 URL 均为必填项");
    setWorking("save"); setError("");
    try {
      const payload = { ...form, name: form.name.trim(), url: form.url.trim(), user_agent: form.user_agent.trim() };
      if (editor && editor !== "create") await api.put(`/api/user/external-subscriptions?id=${editor.id}`, payload);
      else await api.post("/api/user/external-subscriptions", payload);
      notify(editor === "create" ? "外部订阅已添加" : "外部订阅已更新");
      setEditor(null); await load(true);
    } catch (reason) { setError(reasonMessage(reason, "外部订阅保存失败")); }
    finally { setWorking(null); }
  };
  const sync = async (item: ExternalSubscription) => {
    setWorking(item.id); setError("");
    try {
      const response = await api.post<{ message?: string; node_count?: number }>(`/api/user/sync-external-subscription?id=${item.id}`, {});
      notify(response.message || `“${item.name}”已同步 ${response.node_count ?? 0} 个节点`);
      await Promise.all([load(true), onNodesChanged()]);
    } catch (reason) { setError(reasonMessage(reason, `“${item.name}”同步失败`)); }
    finally { setWorking(null); }
  };
  const syncAll = async () => {
    if (!subscriptions.length) return;
    setWorking("all"); setError("");
    let success = 0;
    const failures: string[] = [];
    for (const item of subscriptions) {
      try { await api.post(`/api/user/sync-external-subscription?id=${item.id}`, {}); success += 1; }
      catch { failures.push(item.name); }
    }
    if (success) notify(`已同步 ${success}/${subscriptions.length} 个外部订阅`);
    if (failures.length) setError(`同步失败：${failures.join("、")}`);
    await Promise.all([load(true), onNodesChanged()]);
    setWorking(null);
  };
  const remove = async (item: ExternalSubscription) => {
    setWorking(item.id); setError("");
    try { await api.delete(`/api/user/external-subscriptions?id=${item.id}`); setConfirmDelete(null); notify("外部订阅已删除"); await Promise.all([load(true), onNodesChanged()]); }
    catch (reason) { setError(reasonMessage(reason, "外部订阅删除失败")); }
    finally { setWorking(null); }
  };
  const usedTraffic = (item: ExternalSubscription) => item.traffic_mode === "download" ? item.download : item.traffic_mode === "upload" ? item.upload : item.upload + item.download;
  return <Dialog title="外部订阅" description="管理外部来源、流量信息与节点同步" onClose={onClose} wide><div className="form-stack">
    {error ? <ErrorState message={error} /> : null}
    {editor ? <form className="nw-editor-panel" onSubmit={save}><div className="nw-editor-heading"><span><Globe2 size={17} /><strong>{editor === "create" ? "添加外部订阅" : `编辑 ${editor.name}`}</strong></span><IconButton label="关闭订阅编辑" type="button" onClick={() => setEditor(null)}><X size={16} /></IconButton></div><div className="form-grid"><Field label="订阅名称"><input autoFocus required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field label="流量统计"><select value={form.traffic_mode} onChange={(event) => setForm({ ...form, traffic_mode: event.target.value })}><option value="both">上传 + 下载</option><option value="download">仅下载</option><option value="upload">仅上传</option></select></Field></div><Field label="订阅 URL"><input required type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://example.com/subscription" /></Field><Field label="User-Agent"><input value={form.user_agent} onChange={(event) => setForm({ ...form, user_agent: event.target.value })} /></Field><div className="dialog-actions"><Button type="button" variant="secondary" onClick={() => setEditor(null)}>取消</Button><Button type="submit" disabled={working !== null}>{working === "save" ? <Spinner label="正在保存" /> : <><Check size={16} />保存订阅</>}</Button></div></form> : null}
    <div className="nw-list-toolbar"><div className="search-box"><Search size={16} /><input aria-label="搜索外部订阅" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="名称、归属或 URL" /></div><span>{subscriptions.length} 个来源</span><Button variant="secondary" disabled={!subscriptions.length || working !== null} onClick={() => void syncAll()}>{working === "all" ? <Spinner label="正在同步" /> : <><RefreshCw size={16} />同步全部</>}</Button><Button onClick={() => openEditor()} disabled={working !== null}><Plus size={16} />添加订阅</Button></div>
    {loading ? <div className="center-state"><Spinner label="正在加载外部订阅" /></div> : visible.length ? <div className="nw-subscription-list">{visible.map((item) => { const used = usedTraffic(item); const percent = item.total > 0 ? Math.min(100, used / item.total * 100) : 0; return <article key={item.id}><header><span><strong>{item.name}</strong><small>{item.username ? `归属 ${item.username} · ` : ""}{item.node_count} 个节点</small></span><Badge tone={item.expire && new Date(item.expire).getTime() < Date.now() ? "bad" : "info"}>{item.expire ? `到期 ${formatDate(item.expire)}` : "长期有效"}</Badge></header><code className="nw-sub-url" title={item.url}>{item.url}</code><div className="nw-sub-facts"><span><small>已用流量</small><strong>{formatBytes(used)}</strong></span><span><small>总流量</small><strong>{item.total > 0 ? formatBytes(item.total) : "未提供"}</strong></span><span><small>最后同步</small><strong>{formatDate(item.last_sync_at)}</strong></span></div>{item.total > 0 ? <div className="nw-progress" aria-label={`已使用 ${percent.toFixed(1)}%`}><span style={{ width: `${percent}%` }} /></div> : null}<footer><Button variant="ghost" disabled={working !== null} onClick={() => openEditor(item)}><Edit3 size={15} />编辑</Button><Button variant="secondary" disabled={working !== null} onClick={() => void sync(item)}>{working === item.id ? <Spinner label="同步中" /> : <><Download size={15} />立即同步</>}</Button>{confirmDelete === item.id ? <><Button variant="danger" disabled={working !== null} onClick={() => void remove(item)}>确认删除</Button><Button variant="ghost" onClick={() => setConfirmDelete(null)}>取消</Button></> : <IconButton label={`删除外部订阅 ${item.name}`} disabled={working !== null} onClick={() => setConfirmDelete(item.id)}><Trash2 size={16} /></IconButton>}</footer></article>; })}</div> : <EmptyState icon={<Globe2 size={22} />} title={subscriptions.length ? "没有匹配订阅" : "还没有外部订阅"} description={subscriptions.length ? "调整搜索条件后重试" : "添加订阅来源后即可同步节点和流量信息"} action={!subscriptions.length ? <Button onClick={() => openEditor()}><Plus size={16} />添加订阅</Button> : undefined} />}
    <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>关闭</Button></div>
  </div></Dialog>;
}

type JsonObject = Record<string, any>;
const routedProtocols = new Set(["vless", "vmess", "trojan", "ss", "shadowsocks", "socks5", "http"]);

function clashToXrayOutbound(config: JsonObject): JsonObject {
  const type = String(config.type || "").toLowerCase();
  if (!routedProtocols.has(type)) throw new Error(`暂不支持把 ${type || "未知"} 协议转换为 Xray 出站，请使用自定义 JSON`);
  const address = String(config.server || "");
  const port = Number(config.port);
  if (!address || !port) throw new Error("目标节点缺少 server 或 port");
  const protocol = type === "ss" ? "shadowsocks" : type;
  const outbound: JsonObject = { protocol, settings: {} };
  if (type === "vless" || type === "vmess") {
    const user: JsonObject = { id: String(config.uuid || "") };
    if (!user.id) throw new Error("目标节点缺少 UUID");
    if (type === "vless") user.encryption = String(config.encryption || "none");
    else { user.alterId = Number(config.alterId || config["alter-id"] || 0); user.security = String(config.cipher || "auto"); }
    if (config.flow) user.flow = config.flow;
    outbound.settings = { vnext: [{ address, port, users: [user] }] };
  } else if (type === "trojan") {
    if (!config.password) throw new Error("目标 Trojan 节点缺少密码");
    outbound.settings = { servers: [{ address, port, password: config.password, ...(config.flow ? { flow: config.flow } : {}) }] };
  } else if (type === "ss" || type === "shadowsocks") {
    outbound.settings = { servers: [{ address, port, method: config.cipher || config.method, password: config.password }] };
  } else {
    const server: JsonObject = { address, port };
    if (config.username || config.password) server.users = [{ user: String(config.username || ""), pass: String(config.password || "") }];
    outbound.settings = { servers: [server] };
  }
  const network = String(config.network || "tcp").toLowerCase();
  const reality = config.reality === true || Boolean(config["reality-opts"]);
  const tls = config.tls === true || config.tls === "true";
  const stream: JsonObject = { network };
  if (network === "ws") {
    const options = config["ws-opts"] || {};
    stream.wsSettings = { path: options.path || "/", ...(options.headers ? { headers: options.headers } : {}) };
  } else if (network === "grpc") {
    stream.grpcSettings = { serviceName: (config["grpc-opts"] || {})["grpc-service-name"] || "" };
  } else if (network === "h2" || network === "http") {
    stream.network = "http";
    const options = config["h2-opts"] || {};
    stream.httpSettings = { path: options.path || "/", ...(options.host ? { host: options.host } : {}) };
  } else if (network === "httpupgrade") {
    const options = config["http-upgrade-opts"] || {};
    stream.httpupgradeSettings = { path: options.path || config.path || "/", host: options.host || config.host || "" };
  } else if (network === "splithttp" || network === "xhttp") {
    stream.network = "xhttp";
    const options = config["xhttp-opts"] || {};
    stream.xhttpSettings = { path: options.path || config.path || "/", host: options.host || config.host || "", mode: options.mode || "auto" };
  }
  if (reality) {
    const options = config["reality-opts"] || {};
    stream.security = "reality";
    stream.realitySettings = {
      serverName: options["server-name"] || config.sni || address,
      publicKey: options["public-key"] || "",
      shortId: options["short-id"] || "",
      fingerprint: config.fingerprint || "chrome",
    };
  } else if (tls) {
    stream.security = "tls";
    stream.tlsSettings = {
      serverName: config.sni || config.servername || address,
      ...(Array.isArray(config.alpn) && config.alpn.length ? { alpn: config.alpn } : {}),
      ...(config.fingerprint ? { fingerprint: config.fingerprint } : {}),
    };
  }
  outbound.streamSettings = stream;
  return outbound;
}

export function RoutedOutboundDialog({ node, nodes, isAdmin = true, userStatus = null, onClose, onComplete }: {
  node: WorkbenchNode;
  nodes: WorkbenchNode[];
  isAdmin?: boolean;
  userStatus?: UserRoutedOutboundStatus | null;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const targets = useMemo(() => nodes.filter((item) => item.id !== node.id && item.node_type !== "routed" && routedProtocols.has(item.protocol.toLowerCase()) && Boolean(item.clash_config)), [node.id, nodes]);
  const [mode, setMode] = useState<"target" | "direct" | "custom">(targets.length || !isAdmin ? "target" : "direct");
  const [targetID, setTargetID] = useState(targets[0] ? String(targets[0].id) : "");
  const [label, setLabel] = useState("");
  const [nodeName, setNodeName] = useState("");
  const [custom, setCustom] = useState(JSON.stringify({ protocol: "freedom", settings: {} }, null, 2));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const preview = useMemo(() => {
    try {
      if (mode === "direct") return { value: { protocol: "freedom", settings: {} } as JsonObject, error: "" };
      if (mode === "custom") {
        const parsed = JSON.parse(custom) as JsonObject;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !parsed.protocol) throw new Error("Outbound JSON 必须是含 protocol 的对象");
        delete parsed.tag;
        return { value: parsed, error: "" };
      }
      const target = targets.find((item) => item.id === Number(targetID));
      if (!target) throw new Error("请选择目标节点");
      const parsed = JSON.parse(target.clash_config) as JsonObject;
      return { value: clashToXrayOutbound(parsed), error: "" };
    } catch (reason) { return { value: null, error: reasonMessage(reason, "出站配置转换失败") }; }
  }, [custom, mode, targetID, targets]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanLabel = label.trim();
    if (!/^[a-zA-Z0-9-]{2,32}$/.test(cleanLabel)) return setError("Label 只允许字母、数字和短横线，长度 2-32");
    if (!preview.value) return setError(preview.error || "出站配置无效");
    const selectedTargetID = Number(targetID);
    if (!isAdmin && !selectedTargetID) return setError("请选择目标节点");
    setWorking(true); setError("");
    try {
      await api.post(isAdmin ? "/api/admin/routed-outbound" : "/api/user/routed-outbound", {
        parent_node_id: node.id,
        ...(!isAdmin ? { target_node_id: selectedTargetID } : {}),
        label: cleanLabel,
        node_name: nodeName.trim() || `${node.node_name}-${cleanLabel}`,
        outbound: preview.value,
      });
      await onComplete();
    } catch (reason) { setError(reasonMessage(reason, "路由出站创建失败")); }
    finally { setWorking(false); }
  };
  return <Dialog title={`${isAdmin ? "创建路由出站" : "创建私有路由出站"} · ${node.node_name}`} description={isAdmin ? "复用当前入站，为套餐提供独立的落地出站" : "使用自己的子账号凭据创建私有落地出站"} onClose={onClose} wide><form className="form-stack" onSubmit={submit}>
    {error || preview.error ? <ErrorState message={error || preview.error} /> : null}
    <div className="nw-inline-note"><Route size={16} /><span>父节点 <strong>{node.node_name}</strong> · {node.original_server} · 入站 <code>{node.inbound_tag}</code></span></div>
    {!isAdmin && userStatus ? <div className="nw-inline-note"><ShieldCheck size={16} /><span>数量 {userStatus.quota.used}/{userStatus.quota.max} · 今日操作 {userStatus.daily.used}/{userStatus.daily.max}</span></div> : null}
    {isAdmin ? <div className="nw-tabs" role="tablist"><button type="button" role="tab" aria-selected={mode === "target"} className={mode === "target" ? "is-active" : ""} disabled={!targets.length} onClick={() => setMode("target")}><Network size={16} />选择节点</button><button type="button" role="tab" aria-selected={mode === "direct"} className={mode === "direct" ? "is-active" : ""} onClick={() => setMode("direct")}><Globe2 size={16} />服务器直连</button><button type="button" role="tab" aria-selected={mode === "custom"} className={mode === "custom" ? "is-active" : ""} onClick={() => setMode("custom")}><Terminal size={16} />自定义 JSON</button></div> : null}
    {mode === "target" ? <Field label="目标落地节点"><select aria-label="目标落地节点" required value={targetID} onChange={(event) => setTargetID(event.target.value)}>{targets.map((item) => { const address = nodeAddress(item); return <option value={item.id} key={item.id}>{item.node_name} · {item.protocol.toUpperCase()} · {address.host}:{address.port}</option>; })}</select></Field> : null}
    <div className="form-grid"><Field label="Label" hint="2-32 位字母、数字或短横线"><input autoFocus required value={label} onChange={(event) => setLabel(event.target.value)} placeholder="HK-T4" /></Field><Field label="订阅节点名称" hint="留空自动拼接父节点名称"><input value={nodeName} onChange={(event) => setNodeName(event.target.value)} placeholder={`${node.node_name}-HK-T4`} /></Field></div>
    {mode === "custom" ? <Field label="Xray Outbound JSON" hint="tag 由后端生成，提交时会忽略自定义 tag"><textarea className="nw-code-editor" rows={14} spellCheck={false} value={custom} onChange={(event) => setCustom(event.target.value)} /></Field> : <Field label="生成的 Xray Outbound"><textarea className="nw-code-editor" rows={14} readOnly spellCheck={false} value={preview.value ? JSON.stringify(preview.value, null, 2) : ""} /></Field>}
    <DialogStatusBar><span><ShieldCheck size={15} />{isAdmin ? "创建时会同时写入 outbound、routing rule 和占位客户端" : "仅使用你的子账号，操作受数量和每日次数限制"}</span><span className="nw-dialog-actions-inline"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working || !preview.value}>{working ? <Spinner label="正在创建" /> : <><Route size={16} />{isAdmin ? "创建路由出站" : "创建私有路由出站"}</>}</Button></span></DialogStatusBar>
  </form></Dialog>;
}

export function TempSubscriptionDialog({ nodes, notify, onClose }: { nodes: WorkbenchNode[]; notify: NodesWorkbenchNotify; onClose: () => void }) {
  const [maxAccess, setMaxAccess] = useState("1");
  const [expireSeconds, setExpireSeconds] = useState("300");
  const [result, setResult] = useState<TempSubscriptionResponse | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const valid = useMemo(() => nodes.flatMap((node) => {
    try { const proxy = JSON.parse(node.clash_config || ""); return proxy && typeof proxy === "object" && !Array.isArray(proxy) ? [{ node, proxy }] : []; }
    catch { return []; }
  }), [nodes]);
  const generate = async () => {
    if (!valid.length) return setError("选中的节点没有可用 Clash 配置");
    setWorking(true); setError(""); setResult(null);
    try {
      const response = await api.post<TempSubscriptionResponse>("/api/admin/temp-subscription", { proxies: valid.map((item) => item.proxy), max_access: Number(maxAccess), expire_seconds: Number(expireSeconds) });
      setResult(response); notify("临时订阅已生成");
    } catch (reason) { setError(reasonMessage(reason, "临时订阅生成失败")); }
    finally { setWorking(false); }
  };
  const fullURL = result ? new URL(result.url, typeof window === "undefined" ? "https://your-panel.example" : window.location.origin).toString() : "";
  const copy = async () => {
    try { await copyText(fullURL); notify("临时订阅地址已复制"); }
    catch { setError("无法访问剪贴板，请手动选择订阅地址"); }
  };
  return <Dialog title="生成临时订阅" description={`已选择 ${nodes.length} 个节点，${valid.length} 个配置可用`} onClose={onClose}><div className="form-stack">
    {error ? <ErrorState message={error} /> : null}
    <div className="nw-temp-summary"><span><HardDriveDownload size={20} /><strong>{valid.length}</strong><small>可用节点</small></span><span><Clock3 size={20} /><strong>{Number(expireSeconds) / 60}</strong><small>有效分钟</small></span><span><Download size={20} /><strong>{maxAccess}</strong><small>最大访问</small></span></div>
    <div className="form-grid"><Field label="最大访问次数"><input type="number" min="1" max="100" value={maxAccess} onChange={(event) => { setMaxAccess(event.target.value); setResult(null); }} /></Field><Field label="有效时间"><select value={expireSeconds} onChange={(event) => { setExpireSeconds(event.target.value); setResult(null); }}><option value="60">1 分钟</option><option value="300">5 分钟</option><option value="600">10 分钟</option><option value="1800">30 分钟</option><option value="3600">1 小时</option></select></Field></div>
    <div className="nw-temp-node-list">{valid.map(({ node }) => <span key={node.id}><Badge tone="info">{node.protocol.toUpperCase()}</Badge>{node.node_name}</span>)}</div>
    {nodes.length !== valid.length ? <div className="nw-inline-note"><ShieldCheck size={16} /><span>{nodes.length - valid.length} 个节点因配置无法解析而不会加入订阅</span></div> : null}
    {result ? <section className="nw-secret-panel"><div className="nw-secret-heading"><Link2 size={18} /><span><strong>临时订阅已生成</strong><small>到期 {formatDate(result.expire_at)} · 最多访问 {result.max_access} 次</small></span></div><Field label="订阅地址"><div className="nw-copy-field"><input readOnly value={fullURL} /><IconButton label="复制临时订阅地址" onClick={() => void copy()}><Copy size={16} /></IconButton></div></Field></section> : null}
    <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>关闭</Button>{result ? <Button onClick={() => void generate()} disabled={working}><RefreshCw size={16} />重新生成</Button> : <Button onClick={() => void generate()} disabled={working || !valid.length}>{working ? <Spinner label="正在生成" /> : <><Link2 size={16} />生成订阅</>}</Button>}</div>
  </div></Dialog>;
}
