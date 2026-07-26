import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
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
  Shield,
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
import {
  buildManagedInboundRequest,
  buildManagedWireGuardClientConfig,
  buildManagedWireGuardInbound,
  isManagedGRPCProtocol,
  isManagedPlainWSProtocol,
  isManagedRealityProtocol,
  isManagedUUIDProtocol,
  isManagedWSSProtocol,
  isShadowsocks2022Cipher,
  managedInboundSupportsPublishing,
  managedProtocolOptions,
  newManagedInboundDraft,
  protocolDefaults,
  randomBase64,
  createManagedUUID,
  randomHex,
  type ManagedInboundDraft,
  type ManagedProtocol,
  type ManagedProtocolFamily,
} from "./managed-node-presets";
import { generateWireGuardKeyPair } from "./xray-inbound-presets";
import { SelfServiceNodes } from "./self-service-nodes";
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

interface LineSpeedtestResult {
  ping_ms?: number;
  download_mbps?: number;
  upload_mbps?: number;
  jitter_ms?: number;
  packet_loss_percent?: number;
  isp?: string;
  test_server?: string;
  server_name?: string;
  server_location?: string;
  egress_ip?: string;
  created_at?: string;
  timestamp?: string;
}

interface LineSpeedtestTarget {
  key: string;
  kind: "master" | "remote";
  server_id?: number;
  name: string;
  online: boolean;
  installed: boolean;
  managed: boolean;
  owned?: boolean;
  license_accepted?: boolean;
  supported?: boolean;
  upgrade_required?: boolean;
  implementation?: string;
  version?: string;
  running: boolean;
  last_result?: LineSpeedtestResult;
  last_job?: LineSpeedtestJob;
  error?: string;
}

interface LineSpeedtestJob {
  id?: string | number;
  job_id?: string | number;
  status?: string;
  error?: string;
  result?: LineSpeedtestResult;
  created_at?: string;
  completed_at?: string;
}

interface LineSpeedtestJobResponse extends LineSpeedtestJob {
  job?: LineSpeedtestJob;
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
type SourceFilter = "all" | "managed" | "imported" | "routed";
type WorkbenchDialog =
  | { kind: "managed-create" }
  | { kind: "inbound-resource-config"; resource: ManagedInboundResource }
  | { kind: "inbound-resource-rename"; resource: ManagedInboundResource }
  | { kind: "edit"; node: WorkbenchNode }
  | { kind: "config"; node: WorkbenchNode }
  | { kind: "import" }
  | { kind: "relay"; node: WorkbenchNode }
  | { kind: "anydoor"; node: WorkbenchNode }
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

const protocols = ["vmess", "vless", "trojan", "ss", "socks5", "http", "hysteria2", "tuic", "anytls", "wireguard", "snell"];

export interface ManagedCertificate {
  id: number;
  domain: string;
  status: string;
  expiry_date?: string | null;
  remote_server_id?: number;
  dns_names?: string[];
}

interface X25519Response {
  privateKey?: string;
  publicKey?: string;
  success?: boolean;
  error?: string;
}

interface RealityDomainProbe {
  domain: string;
  success?: boolean;
  latency_ms?: number;
}

interface ManagedCreateResponse {
  success?: boolean;
  error?: string;
  message?: string;
  warning?: string;
  runtime_warning?: string;
  node_id?: number;
  node?: WorkbenchNode;
}

interface WireGuardCreatedState {
  clientConfig: string;
  filename: string;
}

interface ManagedInboundResource {
  id: number;
  server_id: number;
  server_name: string;
  display_name: string;
  protocol: string;
  inbound_tag: string;
  endpoint_host: string;
  endpoint_port: number;
  public_metadata?: {
    server_public_key?: string;
    server_addresses?: string[];
    mtu?: number;
    peers?: Array<{
      public_key?: string;
      allowed_ips?: string[];
      keep_alive?: number;
    }>;
  };
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

interface ManagedInboundInventoryResponse {
  inbounds?: Array<{
    tag?: string;
    protocol?: string;
    port?: number;
    uplink?: number;
    downlink?: number;
  }>;
}

function readConfig(node: WorkbenchNode): Record<string, unknown> {
  for (const raw of [node.clash_config, node.parsed_config]) {
    try {
      const parsed = JSON.parse(raw || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch { /* Keep trying fallbacks. */ }
  }
  return {};
}

function managedSelfServiceConfigSupported(protocol: string, rawConfig: string): boolean {
  const normalizedProtocol = nodeProtocolKey(protocol);
  if (normalizedProtocol === "wireguard") return false;
  if (normalizedProtocol !== "ss") return true;
  try {
    const config = JSON.parse(rawConfig || "{}");
    const cipher = String(config?.cipher || config?.method || "").trim().toLowerCase();
    return cipher.startsWith("2022-");
  } catch {
    return false;
  }
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

function nodeSource(node: WorkbenchNode): Exclude<SourceFilter, "all"> {
  if (node.node_type === "routed") return "routed";
  if (node.original_server && node.inbound_tag) return "managed";
  return "imported";
}

function nodeProtocolKey(protocol: string): string {
  switch (protocol.trim().toLowerCase()) {
    case "shadowsocks": return "ss";
    case "socks": return "socks5";
    case "hysteria":
    case "hy2": return "hysteria2";
    default: return protocol.trim().toLowerCase();
  }
}

function isTunnelNode(node: WorkbenchNode | undefined): boolean {
  return Boolean(node && node.node_type !== "routed" && node.inbound_tag.trim().toLowerCase().startsWith("anydoor-"));
}

function displayedNodeProtocol(node: WorkbenchNode): string {
  return isTunnelNode(node) ? "tunnel" : nodeProtocolKey(node.protocol);
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

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function NodesWorkbench({ isAdmin, notify }: NodesWorkbenchProps) {
  const [nodes, setNodes] = useState<WorkbenchNode[]>([]);
  const [inboundResources, setInboundResources] = useState<ManagedInboundResource[]>([]);
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
  const [source, setSource] = useState<SourceFilter>("all");
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
  const toolMenuRef = useRef<HTMLDivElement>(null);
  const toolButtonRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const [nodeResponse, speedResponse, configResponse, routedResponse, offerResponse, inboundResourceResponse] = await Promise.all([
        api.get<{ nodes?: WorkbenchNode[] }>("/api/admin/nodes"),
        isAdmin
          ? api.get<{ results?: SpeedResult[] | null }>("/api/admin/speedtest/results?latest=1").catch(() => ({ results: [] }))
          : Promise.resolve({ results: [] as SpeedResult[] }),
        api.get<UserNodeConfig>("/api/user/config"),
        isAdmin ? Promise.resolve(null) : api.get<UserRoutedOutboundStatus>("/api/user/routed-outbound"),
        isAdmin
          ? api.get<{ offers?: ManagedNodeOffer[] } | ManagedNodeOffer[]>("/api/admin/managed-node-offers").catch(() => ({ offers: [] }))
          : Promise.resolve({ offers: [] as ManagedNodeOffer[] }),
        isAdmin
          ? api.get<{ resources?: ManagedInboundResource[] }>("/api/admin/managed-inbound-resources").catch(() => ({ resources: [] }))
          : Promise.resolve({ resources: [] as ManagedInboundResource[] }),
      ]);
      const list = nodeResponse.nodes ?? [];
      setNodes(list);
      setInboundResources(inboundResourceResponse.resources ?? []);
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
  useEffect(() => {
    if (!showTools) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!toolMenuRef.current?.contains(event.target as Node)) setShowTools(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowTools(false);
      window.requestAnimationFrame(() => toolButtonRef.current?.focus());
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showTools]);
  const focusToolItem = useCallback((last = false) => {
    window.requestAnimationFrame(() => {
      const items = Array.from(toolMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
      if (!items.length) return;
      (last ? items[items.length - 1] : items[0]).focus();
    });
  }, []);
  const openTools = useCallback((last = false) => {
    setShowTools(true);
    focusToolItem(last);
  }, [focusToolItem]);
  const chooseTool = useCallback((next: Exclude<WorkbenchDialog, null>) => {
    // Dialog focus restoration uses the active trigger as its opener.
    toolButtonRef.current?.focus();
    setShowTools(false);
    setDialog(next);
  }, []);
  const onToolMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        items[(current + 1 + items.length) % items.length].focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        items[(current - 1 + items.length) % items.length].focus();
        break;
      case "Home":
        event.preventDefault();
        items[0].focus();
        break;
      case "End":
        event.preventDefault();
        items[items.length - 1].focus();
        break;
      case "Escape":
        event.preventDefault();
        setShowTools(false);
        toolButtonRef.current?.focus();
        break;
      case "Tab":
        setShowTools(false);
        break;
      default:
        break;
    }
  };
  const hasRunning = Object.values(latest).some((result) => result.status === "running");
  useEffect(() => {
    if (!hasRunning) return;
    const timer = window.setInterval(() => void load(true), 1800);
    return () => window.clearInterval(timer);
  }, [hasRunning, load]);

  const sourceScopedNodes = useMemo(() => source === "all" ? nodes : nodes.filter((node) => nodeSource(node) === source), [nodes, source]);
  const protocolCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const node of sourceScopedNodes) counts[displayedNodeProtocol(node)] = (counts[displayedNodeProtocol(node)] || 0) + 1;
    return counts;
  }, [sourceScopedNodes]);
  const protocolFilterOptions = useMemo(() => Array.from(new Set([...protocols, ...Object.keys(protocolCounts)])).filter((item) => protocolCounts[item]), [protocolCounts]);
  const protocolScopedNodes = useMemo(() => protocol === "all" ? sourceScopedNodes : sourceScopedNodes.filter((node) => displayedNodeProtocol(node) === protocol), [protocol, sourceScopedNodes]);
  const allTags = useMemo(() => Array.from(new Set(protocolScopedNodes.flatMap(nodeTags))).sort((a, b) => a.localeCompare(b, "zh-CN")), [protocolScopedNodes]);
  const sourceCounts = useMemo(() => {
    const counts: Record<Exclude<SourceFilter, "all">, number> = { managed: 0, imported: 0, routed: 0 };
    for (const node of nodes) counts[nodeSource(node)] += 1;
    return counts;
  }, [nodes]);
  useEffect(() => {
    if (protocol !== "all" && !protocolCounts[protocol]) setProtocol("all");
  }, [protocol, protocolCounts]);
  useEffect(() => {
    if (tag !== "all" && !allTags.includes(tag)) setTag("all");
  }, [allTags, tag]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = nodes.filter((node) => {
      if (source !== "all" && nodeSource(node) !== source) return false;
      if (protocol !== "all" && displayedNodeProtocol(node) !== protocol) return false;
      if (tag !== "all" && !nodeTags(node).includes(tag)) return false;
      if (enabledOnly && !node.enabled) return false;
      if (!query) return true;
      const address = nodeAddress(node);
      return [node.node_name, node.protocol, displayedNodeProtocol(node), node.original_server, node.inbound_tag, address.host, ...nodeTags(node)]
        .some((value) => value?.toLowerCase().includes(query));
    });
    const orderIndex = new Map(manualOrder.map((id, index) => [id, index]));
    return filtered.sort((a, b) => {
      if (sort === "custom") return (orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER);
      if (sort === "name") return a.node_name.localeCompare(b.node_name, "zh-CN");
      if (sort === "protocol") return displayedNodeProtocol(a).localeCompare(displayedNodeProtocol(b)) || a.node_name.localeCompare(b.node_name, "zh-CN");
      if (sort === "server") return nodeAddress(a).host.localeCompare(nodeAddress(b).host) || a.node_name.localeCompare(b.node_name, "zh-CN");
      if (sort === "latency") return (latest[a.id]?.latency_ms || Number.MAX_SAFE_INTEGER) - (latest[b.id]?.latency_ms || Number.MAX_SAFE_INTEGER);
      if (sort === "speed") return (latest[b.id]?.down_mbps || -1) - (latest[a.id]?.down_mbps || -1);
      return new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime();
    });
  }, [enabledOnly, latest, manualOrder, nodes, protocol, search, sort, source, tag]);

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

  const removeInboundResource = (resource: ManagedInboundResource) => setPending({
    title: "删除 WireGuard 入站",
    description: `将从“${resource.server_name}”删除“${resource.display_name}”及对应远程入站。Agent 离线时不会移除本地记录，可恢复在线后重试。`,
    confirmLabel: "确认删除",
    run: async () => {
      await api.delete(`/api/admin/managed-inbound-resources/${resource.id}`);
      notify("WireGuard 入站已删除");
      await load(true);
    },
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
          ? `${nodes.length} 个订阅节点 · ${inboundResources.length} 个仅管理入站 · 管理、连通性与测速工作台`
          : userView === "mine" ? `${nodes.length} 个可用节点 · ${nodes.filter((node) => node.enabled).length} 个启用` : "按服务器授权开通独立节点凭据"}
        actions={isAdmin || userView === "mine" ? <>
          <IconButton label="刷新节点数据" onClick={() => void load()} disabled={loading}><RefreshCw size={18} /></IconButton>
          <Button variant="secondary" onClick={() => { location.hash = "/forwarding"; }}><Network size={17} />转发管理</Button>
          <Button variant="secondary" onClick={() => setDialog({ kind: "import" })}><Upload size={17} />导入已有节点</Button>
          {isAdmin ? <Button onClick={() => setDialog({ kind: "managed-create" })}><Server size={17} />在服务器创建</Button> : null}
        </> : undefined}
      />

      {!isAdmin ? <div className="nw-user-views segmented-control" role="tablist" aria-label="用户节点视图"><button role="tab" aria-selected={userView === "mine"} className={userView === "mine" ? "is-active" : ""} onClick={() => setUserView("mine")}><Route size={15} />我的节点</button><button role="tab" aria-selected={userView === "catalog"} className={userView === "catalog" ? "is-active" : ""} onClick={() => setUserView("catalog")}><Plus size={15} />可开通节点</button><button role="tab" aria-selected={false} onClick={() => { location.hash = "/forwarding"; }}><Network size={15} />转发管理</button></div> : null}

      {!isAdmin && userView === "catalog" ? <SelfServiceNodes view="catalog" notify={notify} onChanged={() => load(true)} /> : <>
      {!isAdmin ? <SelfServiceNodes view="mine" notify={notify} onChanged={() => load(true)} /> : null}
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      <Surface className="nw-command-surface">
        <div className="nw-command-row">
          <div className="search-box nw-search"><Search size={17} /><input aria-label="搜索节点" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="名称、地址、协议、标签或服务器" /></div>
          <Field label="排序"><select aria-label="节点排序" value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="recent">最近更新</option><option value="custom">自定义顺序</option><option value="name">节点名称</option><option value="protocol">协议</option><option value="server">服务器地址</option><option value="latency">延迟</option><option value="speed">下载速度</option></select></Field>
          <label className="nw-compact-check"><input type="checkbox" checked={enabledOnly} onChange={(event) => setEnabledOnly(event.target.checked)} />仅启用</label>
          <div className="nw-tool-menu" ref={toolMenuRef}>
            <button ref={toolButtonRef} type="button" className="button button-secondary" aria-haspopup="menu" aria-expanded={showTools} onClick={() => showTools ? setShowTools(false) : openTools()} onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                openTools(event.key === "ArrowUp");
              }
            }}><Settings2 size={16} />工具<ChevronDown size={14} /></button>
            {showTools ? <div className="nw-tool-popover" role="menu" aria-label="节点工具" onKeyDown={onToolMenuKeyDown}>
              {isAdmin ? <button role="menuitem" onClick={() => chooseTool({ kind: "speed", nodeIDs: selectedNodes.map((node) => node.id) })}><Gauge size={16} />节点测速</button> : null}
              {isAdmin ? <button role="menuitem" onClick={() => chooseTool({ kind: "history" })}><History size={16} />测速结果</button> : null}
              {isAdmin ? <button role="menuitem" onClick={() => chooseTool({ kind: "testers" })}><Wifi size={16} />测速端管理</button> : null}
              {isAdmin ? <button role="menuitem" onClick={() => chooseTool({ kind: "uris" })}><Link2 size={16} />URI 管理器</button> : null}
              <button role="menuitem" onClick={() => chooseTool({ kind: "subscriptions" })}><Globe2 size={16} />外部订阅</button>
              {isAdmin ? <button role="menuitem" onClick={() => chooseTool({ kind: "tunnels" })}><Cable size={16} />Tunnel 管理</button> : null}
              {isAdmin ? <button role="menuitem" onClick={() => { toolButtonRef.current?.focus(); setShowTools(false); deleteDuplicates(); }}><ListFilter size={16} />删除重复</button> : null}
              {!isAdmin && userRouted ? <span className="nw-tool-status"><Route size={15} />私有出站 {userRouted.quota.used}/{userRouted.quota.max} · 今日 {userRouted.daily.used}/{userRouted.daily.max}</span> : null}
            </div> : null}
          </div>
        </div>
        {isAdmin ? <div className="nw-parity-actions" role="toolbar" aria-label="节点快捷操作">
          <Button aria-label="切换节点自定义排序" variant={sort === "custom" ? "primary" : "secondary"} onClick={() => setSort(sort === "custom" ? "recent" : "custom")}><ListFilter size={16} />排序模式</Button>
          <Button aria-label="打开 Tunnel 工作台" variant="secondary" onClick={() => setDialog({ kind: "tunnels" })}><Cable size={16} />Tunnel 管理</Button>
          <Button aria-label="创建节点路由出站" variant="secondary" onClick={() => selectedNodes.length === 1 ? setDialog({ kind: "route", node: selectedNodes[0] }) : notify("请先选择一个基础节点创建路由出站", "error")}><Route size={16} />路由出站</Button>
          <Button aria-label="打开测速工作台" variant="secondary" onClick={() => setDialog({ kind: "speed", nodeIDs: selectedNodes.map((node) => node.id) })}><Gauge size={16} />节点测速</Button>
          <Button aria-label="打开分享 URI 工具" variant="secondary" onClick={() => setDialog({ kind: "uris" })}><Link2 size={16} />URI 管理</Button>
          <Button aria-label="打开订阅同步工作台" variant="secondary" onClick={() => setDialog({ kind: "subscriptions" })}><Globe2 size={16} />同步外部订阅</Button>
        </div> : null}
        <div className="nw-filter-group nw-source-filter" aria-label="节点来源">
          <button className={source === "all" ? "is-active" : ""} onClick={() => setSource("all")}><ListFilter size={13} />全部节点 <span>{nodes.length}</span></button>
          <button className={source === "managed" ? "is-active" : ""} onClick={() => setSource("managed")}><Server size={13} />服务器创建 <span>{sourceCounts.managed}</span></button>
          <button className={source === "imported" ? "is-active" : ""} onClick={() => setSource("imported")}><Upload size={13} />外部导入 <span>{sourceCounts.imported}</span></button>
          <button className={source === "routed" ? "is-active" : ""} onClick={() => setSource("routed")}><Route size={13} />路由出站 <span>{sourceCounts.routed}</span></button>
        </div>
        <div className="nw-filter-group" aria-label="协议筛选">
          <button className={protocol === "all" ? "is-active" : ""} onClick={() => setProtocol("all")}>全部协议 <span>{sourceScopedNodes.length}</span></button>
          {protocolFilterOptions.map((item) => <button key={item} className={protocol === item ? "is-active" : ""} onClick={() => setProtocol(item)}>{item.toUpperCase()} <span>{protocolCounts[item]}</span></button>)}
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

      {isAdmin && inboundResources.length ? <Surface className="table-surface nw-inbound-resource-surface">
        <div className="nw-inbound-resource-heading"><span><Shield size={18} /><span><strong>仅管理入站</strong><small>用于管理服务器上的 WireGuard；不进入订阅、套餐、测速或批量操作。</small></span></span><Badge tone="info">{inboundResources.length} 项</Badge></div>
        <div className="table-wrap"><table className="nw-inbound-resource-table"><thead><tr><th>协议 / 名称</th><th>服务器与 Tag</th><th>公网 Endpoint</th><th>隧道参数</th><th>状态</th><th aria-label="操作" /></tr></thead><tbody>{inboundResources.map((resource) => {
          const endpointHost = resource.endpoint_host?.includes(":") && !resource.endpoint_host.startsWith("[") ? `[${resource.endpoint_host}]` : resource.endpoint_host;
          const peer = resource.public_metadata?.peers?.[0];
          return <tr key={resource.id}>
            <td><div className="nw-node-primary"><Badge tone="info">{resource.protocol.toUpperCase()}</Badge><span><strong>{resource.display_name}</strong><small>管理资源 #{resource.id}</small></span></div></td>
            <td><strong className="nw-resource-server">{resource.server_name || `服务器 #${resource.server_id}`}</strong><small className="cell-note"><code>{resource.inbound_tag}</code></small></td>
            <td><code className="nw-address">{endpointHost || "-"}:{resource.endpoint_port || "-"}/UDP</code></td>
            <td><span className="nw-resource-parameters">{resource.public_metadata?.server_addresses?.join(", ") || "-"}<small>MTU {resource.public_metadata?.mtu || "-"} · Peer {peer?.allowed_ips?.join(", ") || "-"}</small></span></td>
            <td><Badge tone="good">已创建</Badge><small className="cell-note">不进入订阅</small></td>
            <td><div className="nw-row-actions"><IconButton label={`查看 ${resource.display_name} 公开配置`} onClick={() => setDialog({ kind: "inbound-resource-config", resource })}><Eye size={16} /></IconButton><IconButton label={`重命名 ${resource.display_name}`} onClick={() => setDialog({ kind: "inbound-resource-rename", resource })}><Edit3 size={16} /></IconButton><IconButton label={`删除 ${resource.display_name}`} onClick={() => removeInboundResource(resource)}><Trash2 size={16} /></IconButton></div></td>
          </tr>;
        })}</tbody></table></div>
      </Surface> : null}

      <Surface className="table-surface nw-node-surface">
        {loading ? <div className="center-state"><Spinner label="正在加载节点" /></div> : visible.length === 0 ? <EmptyState icon={<Route size={24} />} title={nodes.length ? "没有匹配的节点" : "暂无节点"} description={nodes.length ? "调整筛选条件后重试" : "从受管服务器创建节点，或导入已经建好的外部节点"} action={!nodes.length ? <Button onClick={() => isAdmin ? setDialog({ kind: "managed-create" }) : setDialog({ kind: "import" })}>{isAdmin ? <Server size={16} /> : <Upload size={16} />}{isAdmin ? "在服务器创建" : "导入节点"}</Button> : undefined} /> : <div className="table-wrap"><table className="nw-node-table"><thead><tr><th className="nw-check-col"><input aria-label="选择当前结果" type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} /></th>{sort === "custom" ? <th className="nw-order-col">顺序</th> : null}<th>协议 / 节点</th><th>标签与归属</th><th>服务器地址</th><th>连通性</th><th>测速结果</th><th>状态</th><th aria-label="操作" /></tr></thead><tbody>{visible.map((node) => {
          const address = nodeAddress(node);
          const ping = tcping[node.id];
          const speed = latest[node.id];
          const offer = offers.find((item) => item.node_id === node.id);
          const orderIndex = manualOrder.indexOf(node.id);
          return <tr key={node.id} className={selected.has(node.id) ? "is-selected" : ""}>
            <td className="nw-cell-check"><input aria-label={`选择 ${node.node_name}`} type="checkbox" checked={selected.has(node.id)} onChange={() => toggleSelection(node.id)} /></td>
            {sort === "custom" ? <td className="nw-order-col nw-cell-order" data-label="顺序"><span>{orderIndex + 1}</span><IconButton label={`上移 ${node.node_name}`} disabled={orderIndex <= 0} onClick={() => moveManualNode(node.id, -1)}><ArrowUp size={14} /></IconButton><IconButton label={`下移 ${node.node_name}`} disabled={orderIndex < 0 || orderIndex >= manualOrder.length - 1} onClick={() => moveManualNode(node.id, 1)}><ArrowDown size={14} /></IconButton></td> : null}
            <td className="nw-cell-primary"><div className="nw-node-primary"><Badge tone="info">{displayedNodeProtocol(node).toUpperCase() || "UNKNOWN"}</Badge><span><strong>{node.node_name}</strong><small>#{node.id}{isTunnelNode(node) ? ` · 目标协议 ${node.protocol.toUpperCase()}` : node.node_type === "routed" ? " · 路由出站" : ""}{node.relay_orig_server ? " · 已中转" : ""}</small></span></div></td>
            <td className="nw-cell-owner"><div className="nw-node-tags">{offer?.enabled ? <Badge tone="good">自助发布</Badge> : null}{nodeTags(node).length ? nodeTags(node).slice(0, 3).map((item) => <Badge key={item}>{item}</Badge>) : <span className="muted">未分类</span>}</div><small className="cell-note">{node.original_server || node.created_by || "外部导入"}{node.inbound_tag ? ` · ${node.inbound_tag}` : ""}</small></td>
            <td className="nw-cell-address" data-label="服务器"><code className="nw-address">{address.host || "-"}:{address.port || "-"}</code>{node.relay_orig_server ? <small className="cell-note">原站 {node.relay_orig_server}:{node.relay_orig_port || "-"}</small> : node.original_domain ? <small className="cell-note">原域名 {node.original_domain}</small> : null}</td>
            <td className="nw-cell-latency" data-label="连通性"><button className={`nw-result-button ${ping?.success ? "is-good" : ping?.error ? "is-bad" : ""}`} disabled={ping?.loading} title={ping?.error || "点击测试 TCP/UDP 连通延迟"} onClick={() => void pingOne(node)}>{ping?.loading ? <Spinner label="" /> : <Zap size={14} />}{ping?.loading ? "测试中" : ping?.success ? `${ping.latency.toFixed(1)} ms` : ping?.error ? "失败" : "测延迟"}</button></td>
            <td className="nw-cell-speed" data-label="测速">{isAdmin ? <button className="nw-speed-cell" title={speed?.error || "打开节点测速"} onClick={() => setDialog({ kind: "speed", nodeIDs: [node.id] })}><Badge tone={speedTone(speed)}>{resultLabel(speed)}</Badge>{speed?.egress_ip ? <small>{speed.egress_ip}</small> : null}</button> : <Badge tone="neutral">管理员功能</Badge>}</td>
            <td className="nw-cell-status" data-label="状态">{isAdmin ? <button className="nw-status-button" title={`点击${node.enabled ? "停用" : "启用"}`} onClick={() => void update(node, { enabled: !node.enabled }, node.enabled ? "节点已停用" : "节点已启用")}><span className={node.enabled ? "is-on" : ""} />{node.enabled ? "启用" : "停用"}</button> : <Badge tone={node.enabled ? "good" : "neutral"}>{node.enabled ? "启用" : "停用"}</Badge>}</td>
            <td className="nw-cell-actions"><NodeActions node={node} isAdmin={isAdmin} userRouted={userRouted} onEdit={() => setDialog({ kind: "edit", node })} onConfig={() => setDialog({ kind: "config", node })} onRelay={() => setDialog({ kind: "relay", node })} onAnyDoor={() => setDialog({ kind: "anydoor", node })} onCancelRelay={() => cancelRelay(node)} onChain={() => setDialog({ kind: "chain", node })} onResolve={() => setDialog({ kind: "resolve", node })} onRegion={() => setDialog({ kind: "region", node })} onRestore={() => restoreDomain(node)} onRoute={() => setDialog({ kind: "route", node })} onTempSub={() => setDialog({ kind: "temp-sub", nodes: [node] })} onDelete={() => isAdmin ? removeNode(node) : removeUserRouted(node)} /></td>
          </tr>;
        })}</tbody></table></div>}
      </Surface>
      </>}

      {dialog?.kind === "managed-create" ? <ManagedNodeWizard nodes={nodes} onClose={closeDialog} onComplete={async (message, tone) => { closeDialog(); if (tone) notify(message, tone); else notify(message); await load(true); }} /> : null}
      {dialog?.kind === "inbound-resource-config" ? <ManagedInboundResourceConfigDialog resource={dialog.resource} onClose={closeDialog} /> : null}
      {dialog?.kind === "inbound-resource-rename" ? <ManagedInboundResourceRenameDialog resource={dialog.resource} onClose={closeDialog} onComplete={async () => { closeDialog(); notify("WireGuard 入站名称已更新"); await load(true); }} /> : null}
      {dialog?.kind === "edit" ? <NodeEditor node={dialog.node} offer={offers.find((item) => item.node_id === dialog.node.id)} onClose={closeDialog} onComplete={async (message) => { closeDialog(); notify(message); await load(true); }} /> : null}
      {dialog?.kind === "config" ? <ConfigDialog node={dialog.node} editable={isAdmin} onClose={closeDialog} onComplete={async () => { closeDialog(); notify("节点配置已更新"); await load(true); }} /> : null}
      {dialog?.kind === "import" ? <ImportDialog onClose={closeDialog} onComplete={async (count) => { closeDialog(); notify(`已导入 ${count} 个节点`); await load(true); }} /> : null}
      {dialog?.kind === "relay" ? <RelayDialog node={dialog.node} onClose={closeDialog} onComplete={async () => { closeDialog(); notify("节点中转已更新"); await load(true); }} /> : null}
      {dialog?.kind === "anydoor" ? <AnyDoorForwardDialog node={dialog.node} onClose={closeDialog} onComplete={async () => { closeDialog(); notify("任意门转发已创建"); await load(true); }} /> : null}
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

function ManagedInboundResourceConfigDialog({ resource, onClose }: { resource: ManagedInboundResource; onClose: () => void }) {
  const publicView = {
    protocol: resource.protocol,
    server: resource.endpoint_host,
    port: resource.endpoint_port,
    inbound_tag: resource.inbound_tag,
    ...resource.public_metadata,
  };
  return <Dialog title={resource.display_name} description="WireGuard 公开管理参数；客户端私钥不会存储在控制端。" onClose={onClose} wide>
    <div className="form-stack">
      <div className="nw-inline-note"><ShieldCheck size={16} /><span>此资源只管理远程入站，不会进入用户订阅、套餐或节点测速。</span></div>
      <Field label="公开配置"><textarea className="nw-code-editor" aria-label="WireGuard 公开配置" readOnly value={JSON.stringify(publicView, null, 2)} /></Field>
      <div className="dialog-actions"><Button type="button" variant="secondary" onClick={() => void copyText(JSON.stringify(publicView, null, 2))}><Copy size={16} />复制</Button><Button type="button" onClick={onClose}><Check size={16} />关闭</Button></div>
    </div>
  </Dialog>;
}

function ManagedInboundResourceRenameDialog({ resource, onClose, onComplete }: { resource: ManagedInboundResource; onClose: () => void; onComplete: () => void | Promise<void> }) {
  const [displayName, setDisplayName] = useState(resource.display_name);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = displayName.trim();
    if (!normalized) return setError("名称不能为空");
    setWorking(true);
    setError("");
    try {
      await api.patch(`/api/admin/managed-inbound-resources/${resource.id}`, { display_name: normalized });
      await onComplete();
    } catch (reason) {
      setError(reasonMessage(reason, "WireGuard 入站改名失败"));
    } finally {
      setWorking(false);
    }
  };
  return <Dialog title="重命名 WireGuard 入站" description={`${resource.server_name} · ${resource.inbound_tag}`} onClose={onClose} dismissible={!working}>
    <form className="form-stack" onSubmit={submit}>
      {error ? <ErrorState message={error} /> : null}
      <Field label="显示名称"><input autoFocus maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></Field>
      <div className="dialog-actions"><Button type="button" variant="secondary" disabled={working} onClick={onClose}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在保存" /> : <><Check size={16} />保存</>}</Button></div>
    </form>
  </Dialog>;
}

function NodeActions({ node, isAdmin, userRouted, onEdit, onConfig, onRelay, onAnyDoor, onCancelRelay, onChain, onResolve, onRegion, onRestore, onRoute, onTempSub, onDelete }: {
  node: WorkbenchNode;
  isAdmin: boolean;
  userRouted: UserRoutedOutboundStatus | null;
  onEdit: () => void;
  onConfig: () => void;
  onRelay: () => void;
  onAnyDoor: () => void;
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
    {isAdmin && nodeAddress(node).host && nodeAddress(node).port ? <button onClick={() => { onAnyDoor(); setOpen(false); }}><Cable size={15} />任意门转发</button> : null}
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
  const tunnelNode = isTunnelNode(node);
  const selfServiceProtocolReady = !tunnelNode && managedSelfServiceConfigSupported(form.protocol, form.config);
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
      if (form.selfService && tunnelNode) throw new Error("Tunnel 转发节点不能发布到用户自助目录");
      if (form.selfService && !managedSelfServiceConfigSupported(form.protocol, JSON.stringify(config))) throw new Error(nodeProtocolKey(form.protocol) === "wireguard" ? "WireGuard 客户端私钥不能进入用户目录或订阅" : "经典 Shadowsocks 使用共享密码，不能发布到用户自助目录；请改用 Shadowsocks 2022");
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
      {node ? <div className="nw-managed-offer"><Toggle checked={form.selfService} disabled={(!offer && (!node.original_server || !node.inbound_tag)) || (!selfServiceProtocolReady && !form.selfService)} onChange={(selfService) => setForm({ ...form, selfService })} label="允许获授权用户自助开通" />{form.selfService ? <Field label="目录排序" hint="数值越小越靠前"><input type="number" min="0" step="1" value={form.offerOrder} onChange={(event) => setForm({ ...form, offerOrder: event.target.value })} /></Field> : null}{!node.original_server || !node.inbound_tag ? <small>需要受管服务器和入站标识（Tag）后才能发布。</small> : tunnelNode ? <small>Tunnel 转发节点复用目标节点凭据，不能单独发布到用户目录。</small> : !selfServiceProtocolReady ? <small>{nodeProtocolKey(form.protocol) === "wireguard" ? "WireGuard 客户端私钥不能安全写入用户目录或订阅。" : "经典 Shadowsocks 只有共享密码，不能安全分配给独立用户；请改用 Shadowsocks 2022。"}</small> : <small>保存时会校验 Agent 的开通、到期和限速能力。</small>}</div> : null}
      <div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={working}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在保存" /> : <><Check size={16} />保存节点</>}</Button></div>
    </form>
  </Dialog>;
}

function serverReady(server: RemoteServer): boolean {
  return Boolean(server.xray_running && (server.ws_connected || server.status === "online" || server.status === "connected"));
}

function managedCertificateUsable(certificate: ManagedCertificate): boolean {
  if (certificate.status.toLowerCase() !== "valid") return false;
  if (!certificate.expiry_date) return true;
  const expiry = Date.parse(certificate.expiry_date);
  return Number.isFinite(expiry) && expiry > Date.now();
}

export function managedCertificateNameMatchesHost(name: string, hostname: string): boolean {
  const normalizedName = name.trim().toLowerCase().replace(/\.$/, "");
  const normalizedHost = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!normalizedName || !normalizedHost) return false;
  if (normalizedName === normalizedHost) return true;
  if (!normalizedName.startsWith("*.")) return false;
  const suffix = normalizedName.slice(2);
  return normalizedHost.endsWith(`.${suffix}`) && normalizedHost.split(".").length === suffix.split(".").length + 1;
}

export function managedCertificateMatchesServer(certificate: ManagedCertificate, server: RemoteServer | undefined): boolean {
  const serverDomain = server?.domain?.trim().toLowerCase();
  if (!server || !serverDomain || !managedCertificateUsable(certificate)) return false;
  const certificateServerID = Number(certificate.remote_server_id) || 0;
  const certificateNames = managedCertificateNames(certificate);
  return (certificateServerID === 0 || certificateServerID === server.id) &&
    certificateNames.some((name) => managedCertificateNameMatchesHost(name, serverDomain));
}

function managedCertificateNames(certificate: ManagedCertificate): string[] {
  return certificate.dns_names?.length ? certificate.dns_names : [certificate.domain];
}

export function managedTLSHostnameForCertificate(certificate: ManagedCertificate | undefined, server: RemoteServer | undefined, current: string): string {
  if (!certificate) return current;
  const names = managedCertificateNames(certificate);
  const serverDomain = server?.domain?.trim().toLowerCase() || "";
  if (serverDomain && names.some((name) => managedCertificateNameMatchesHost(name, serverDomain))) return serverDomain;
  const currentDomain = current.trim().toLowerCase();
  if (currentDomain && names.some((name) => managedCertificateNameMatchesHost(name, currentDomain))) return currentDomain;
  return names.find((name) => !name.trim().startsWith("*."))?.trim().toLowerCase() || "";
}

function protocolLabel(value: ManagedProtocol): string {
  return managedProtocolOptions.find((item) => item.value === value)?.label ?? value;
}

const managedProtocolFamilies = Array.from(new Map(managedProtocolOptions.map((item) => [item.family, item.familyLabel])).entries());

function availableInboundPort(server: RemoteServer | undefined, protocol: ManagedProtocol): string {
  // WSS is multiplexed by the server's Nginx listener; its public port remains 443.
  if (isManagedWSSProtocol(protocol)) return "443";
  const used = new Set((server?.inbounds ?? []).map((inbound) => Number(inbound.port)).filter(Boolean));
  const preferred = protocol === "anydoor"
    ? [2033]
    : protocol === "wireguard"
    ? [51820, 51821, 51822]
    : protocol === "hysteria2"
    ? [8443, 24443]
    : isManagedPlainWSProtocol(protocol)
      ? [8080, 2082, 8880, 8081, 2052]
      : [443, 8443, 10443, 18443, 24443];
  const selected = preferred.find((port) => !used.has(port));
  if (selected) return String(selected);
  for (let port = 20000; port <= 60000; port += 1) if (!used.has(port)) return String(port);
  return "443";
}

function ManagedNodeWizard({ nodes, onClose, onComplete }: { nodes: WorkbenchNode[]; onClose: () => void; onComplete: (message: string, tone?: "success" | "error") => void }) {
  const wizardRef = useRef<HTMLDivElement>(null);
  const inventoryRequestRef = useRef(0);
  const realityDomainsRequestRef = useRef(0);
  const wireGuardKeyGenerationRef = useRef(0);
  const [step, setStep] = useState(1);
  const [servers, setServers] = useState<RemoteServer[]>([]);
  const [certificates, setCertificates] = useState<ManagedCertificate[]>([]);
  const [serverID, setServerID] = useState("");
  const [draft, setDraft] = useState<ManagedInboundDraft>(() => newManagedInboundDraft());
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [keyWorking, setKeyWorking] = useState(false);
  const [wireGuardKeyWorking, setWireGuardKeyWorking] = useState(false);
  const [domainWorking, setDomainWorking] = useState(false);
  const [inventoryWorking, setInventoryWorking] = useState(false);
  const [inventoryServerID, setInventoryServerID] = useState("");
  const [realityDomains, setRealityDomains] = useState<RealityDomainProbe[]>([]);
  const [wireGuardCreated, setWireGuardCreated] = useState<WireGuardCreatedState | null>(null);
  const [error, setError] = useState("");
  const selectedServer = servers.find((server) => String(server.id) === serverID);
  const readyServers = servers.filter(serverReady);
  const selectedProtocol = managedProtocolOptions.find((item) => item.value === draft.protocol);
  const selectedFamily = selectedProtocol?.family ?? "vless";
  const familyProtocols = managedProtocolOptions.filter((item) => item.family === selectedFamily);
  const forwardingCandidates = nodes.filter((node) => {
    const address = nodeAddress(node);
    return Boolean(address.host && address.port);
  });
  const selectedForwardNode = forwardingCandidates.find((node) => String(node.id) === draft.forwardNodeId);
  const validCertificates = certificates.filter((certificate) => {
    const certificateServerID = Number(certificate.remote_server_id) || 0;
    return managedCertificateUsable(certificate) && (certificateServerID === 0 || certificateServerID === selectedServer?.id);
  });
  const matchingWSSCertificates = certificates.filter((certificate) => managedCertificateMatchesServer(certificate, selectedServer));
  const isWSS = isManagedWSSProtocol(draft.protocol);
  const wssReady = Boolean(selectedServer?.domain?.trim() && matchingWSSCertificates.length);
  const isPlainWS = isManagedPlainWSProtocol(draft.protocol);
  const isReality = isManagedRealityProtocol(draft.protocol);
  const isGRPC = isManagedGRPCProtocol(draft.protocol);
  const isTunnel = draft.protocol === "anydoor";
  const isWireGuard = draft.protocol === "wireguard";
  const wireGuardEndpoint = selectedServer?.domain?.trim() || selectedServer?.ip_address?.trim() || selectedServer?.ip_address_v6?.trim() || "";
  const isClassicShadowsocks = draft.protocol === "shadowsocks" && !isShadowsocks2022Cipher(draft.ssCipher);
  const canPublish = selectedServer?.xray_mode === "embedded" && managedInboundSupportsPublishing(draft);
  const publishDisabledReason = isTunnel
    ? "任意门是端口转发入站，不提供独立用户凭据，不能发布到用户目录。"
    : isWireGuard
    ? "WireGuard 客户端私钥只在本次浏览器会话保留，不能进入订阅或用户目录。"
    : isClassicShadowsocks
    ? "经典 Shadowsocks 只有一组共享密码，不能安全下发独立用户凭据；请使用 SS2022 后再发布。"
    : "该服务器为外置 Xray 模式，只能创建管理员节点，不能安全提供多用户凭据。";

  useEffect(() => {
    const dialogBody = wizardRef.current?.closest<HTMLElement>(".dialog-body");
    if (dialogBody) dialogBody.scrollTop = 0;
  }, [step]);

  const generateRealityKeys = useCallback(async () => {
    setKeyWorking(true);
    setError("");
    try {
      const response = await api.post<X25519Response>("/api/admin/xray/generate-x25519");
      if (!response.privateKey || !response.publicKey) throw new Error(response.error || "服务端未返回完整的 X25519 密钥对");
      setDraft((current) => ({ ...current, privateKey: response.privateKey ?? "", publicKey: response.publicKey ?? "" }));
    } catch (reason) { setError(reasonMessage(reason, "Reality 密钥生成失败")); }
    finally { setKeyWorking(false); }
  }, []);

  const generateWireGuardKeys = useCallback(async () => {
    const generation = ++wireGuardKeyGenerationRef.current;
    setWireGuardKeyWorking(true);
    setError("");
    try {
      const [serverPair, clientPair] = await Promise.all([
        generateWireGuardKeyPair(),
        generateWireGuardKeyPair(),
      ]);
      if (wireGuardKeyGenerationRef.current !== generation) return;
      setDraft((current) => ({
        ...current,
        wireGuardServerPrivateKey: serverPair.privateKey,
        wireGuardServerPublicKey: serverPair.publicKey,
        wireGuardClientPrivateKey: clientPair.privateKey,
        wireGuardClientPublicKey: clientPair.publicKey,
      }));
    } catch (reason) {
      if (wireGuardKeyGenerationRef.current === generation) setError(reasonMessage(reason, "WireGuard 密钥生成失败"));
    } finally {
      if (wireGuardKeyGenerationRef.current === generation) setWireGuardKeyWorking(false);
    }
  }, []);

  const loadRealityDomains = useCallback(async (id: string) => {
    if (!id) return;
    const requestID = realityDomainsRequestRef.current + 1;
    realityDomainsRequestRef.current = requestID;
    setDomainWorking(true);
    try {
      const response = await api.get<{ domains?: RealityDomainProbe[] }>(`/api/admin/remote/reality-domains?server_id=${id}`);
      if (realityDomainsRequestRef.current !== requestID) return;
      const domains = response.domains ?? [];
      setRealityDomains(domains);
    } catch {
      if (realityDomainsRequestRef.current === requestID) setRealityDomains([]);
    } finally {
      if (realityDomainsRequestRef.current === requestID) setDomainWorking(false);
    }
  }, []);

  const loadInboundInventory = useCallback(async (server: RemoteServer) => {
    const requestID = inventoryRequestRef.current + 1;
    inventoryRequestRef.current = requestID;
    setInventoryWorking(true);
    setInventoryServerID("");
    try {
      const response = await api.get<ManagedInboundInventoryResponse>(`/api/admin/remote/inbounds?server_id=${server.id}`);
      if (inventoryRequestRef.current !== requestID) return;
      const inbounds = (response.inbounds ?? []).map((inbound) => ({
        tag: inbound.tag ?? "",
        protocol: inbound.protocol ?? "",
        port: Number(inbound.port) || 0,
        uplink: Number(inbound.uplink) || 0,
        downlink: Number(inbound.downlink) || 0,
      }));
      const enrichedServer = { ...server, inbounds };
      setServers((current) => current.map((item) => item.id === server.id ? enrichedServer : item));
      setDraft((current) => ({ ...current, port: availableInboundPort(enrichedServer, current.protocol) }));
      setInventoryServerID(String(server.id));
    } catch (reason) {
      if (inventoryRequestRef.current === requestID) setError(reasonMessage(reason, "读取服务器入站端口失败，请重新选择服务器后重试"));
    } finally {
      if (inventoryRequestRef.current === requestID) setInventoryWorking(false);
    }
  }, []);

  const chooseServer = useCallback((server: RemoteServer) => {
    setError("");
    setServerID(String(server.id));
    setDraft((current) => ({
      ...current,
      domain: isManagedWSSProtocol(current.protocol)
        ? server.domain?.trim() || ""
        : isManagedRealityProtocol(current.protocol)
          ? ""
          : current.domain,
    }));
    void loadInboundInventory(server);
  }, [loadInboundInventory]);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get<ServerListResponse>("/api/admin/remote-servers"),
      api.get<{ certificates?: ManagedCertificate[] }>("/api/admin/certificates").catch(() => ({ certificates: [] })),
    ]).then(([serverResponse, certificateResponse]) => {
      if (!active) return;
      const nextServers = serverResponse.servers ?? [];
      setServers(nextServers);
      setCertificates(certificateResponse.certificates ?? []);
      const preferred = nextServers.find(serverReady);
      if (preferred) chooseServer(preferred);
    }).catch((reason) => active && setError(reasonMessage(reason, "创建资源加载失败"))).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [chooseServer]);

  useEffect(() => {
    if (!serverID || !isManagedRealityProtocol(draft.protocol)) return;
    void loadRealityDomains(serverID);
    if (!draft.privateKey || !draft.publicKey) void generateRealityKeys();
  // The protocol or selected server is the workflow trigger; key changes must not re-run it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.protocol, serverID]);

  useEffect(() => {
    if (draft.protocol !== "wireguard") return;
    if (draft.wireGuardServerPrivateKey && draft.wireGuardServerPublicKey && draft.wireGuardClientPrivateKey && draft.wireGuardClientPublicKey) return;
    void generateWireGuardKeys();
  }, [draft.protocol, draft.wireGuardClientPrivateKey, draft.wireGuardClientPublicKey, draft.wireGuardServerPrivateKey, draft.wireGuardServerPublicKey, generateWireGuardKeys]);

  useEffect(() => () => { wireGuardKeyGenerationRef.current += 1; }, []);

  useEffect(() => {
    if (!selectedServer) return;
    if (isManagedWSSProtocol(draft.protocol)) setDraft((current) => ({ ...current, domain: selectedServer.domain?.trim() || "" }));
    if ((selectedServer.xray_mode !== "embedded" || !managedInboundSupportsPublishing(draft)) && draft.publish) setDraft((current) => ({ ...current, publish: false }));
  }, [draft.protocol, draft.publish, draft.ssCipher, selectedServer]);

  const chooseProtocol = (protocol: ManagedProtocol) => {
    const defaults = protocolDefaults(protocol);
    setDraft((current) => {
      const forwardNode = forwardingCandidates.find((node) => String(node.id) === current.forwardNodeId) ?? forwardingCandidates[0];
      const forwardAddress = forwardNode ? nodeAddress(forwardNode) : { host: "", port: 0 };
      const ssCipher = defaults.ssCipher ?? current.ssCipher;
      const ssKeyLength = ssCipher === "2022-blake3-aes-128-gcm" ? 16 : 32;
      const next = {
        ...current,
        ...defaults,
        tag: `${defaults.tag ?? protocol}-${randomHex(6)}`,
        port: availableInboundPort(selectedServer, protocol),
        uuid: isManagedUUIDProtocol(protocol) ? current.uuid || createManagedUUID() : current.uuid,
        password: protocol === "shadowsocks" ? randomBase64(ssKeyLength) : current.password || createManagedUUID(),
        ssUserPassword: protocol === "shadowsocks" ? randomBase64(ssKeyLength) : current.ssUserPassword,
        domain: isManagedWSSProtocol(protocol)
          ? selectedServer?.domain?.trim() || ""
          : isManagedPlainWSProtocol(protocol) || (isManagedRealityProtocol(protocol) && !isManagedRealityProtocol(current.protocol))
            ? ""
            : current.domain,
        forwardNodeId: protocol === "anydoor" ? String(forwardNode?.id || "") : current.forwardNodeId,
        targetAddress: protocol === "anydoor" ? forwardAddress.host : current.targetAddress,
        targetPort: protocol === "anydoor" ? String(forwardAddress.port || 2033) : current.targetPort,
      };
      return { ...next, publish: managedInboundSupportsPublishing(next) ? current.publish : false };
    });
  };

  const chooseForwardNode = (nodeID: string) => {
    const node = forwardingCandidates.find((item) => String(item.id) === nodeID);
    const address = node ? nodeAddress(node) : { host: "", port: 0 };
    setDraft((current) => ({
      ...current,
      forwardNodeId: nodeID,
      targetAddress: address.host,
      targetPort: address.port ? String(address.port) : "",
    }));
  };

  const chooseSSCipher = (cipher: ManagedInboundDraft["ssCipher"]) => {
    const is2022 = isShadowsocks2022Cipher(cipher);
    const keyLength = cipher === "2022-blake3-aes-128-gcm" ? 16 : 32;
    setDraft((current) => ({
      ...current,
      ssCipher: cipher,
      password: randomBase64(is2022 ? keyLength : 32),
      ssUserPassword: is2022 ? randomBase64(keyLength) : current.ssUserPassword,
      publish: is2022 ? current.publish : false,
    }));
  };

  const validateStep = () => {
    setError("");
    try {
      if (step === 1) {
        if (!selectedServer) throw new Error("请选择目标服务器");
        if (!serverReady(selectedServer)) throw new Error("目标服务器或 Xray 当前不在线");
        if (inventoryServerID !== serverID) throw new Error("服务器入站端口尚未读取完成，请稍后重试");
        setStep(2);
        return;
      }
      if (step === 2) {
        if (isWSS && !selectedServer?.domain?.trim()) throw new Error(`${protocolLabel(draft.protocol)} 需要先在服务器设置节点域名`);
        if (isWSS && matchingWSSCertificates.length === 0) throw new Error(`${protocolLabel(draft.protocol)} 需要一张覆盖节点域名且未过期的托管证书`);
        if (isReality && (!draft.privateKey || !draft.publicKey)) throw new Error("Reality 密钥尚未生成完成");
        if (isWireGuard && (!draft.wireGuardServerPrivateKey || !draft.wireGuardServerPublicKey || !draft.wireGuardClientPrivateKey || !draft.wireGuardClientPublicKey)) throw new Error("WireGuard 密钥尚未生成完成");
        if (selectedProtocol?.requiresCertificate && validCertificates.length === 0) throw new Error("该协议需要托管 TLS 证书，请先到证书管理申请或上传证书");
        setStep(3);
        return;
      }
      if (isWireGuard) {
        buildManagedWireGuardInbound(draft);
        buildManagedWireGuardClientConfig(draft, wireGuardEndpoint);
      } else {
        buildManagedInboundRequest(draft);
      }
      setStep(4);
    } catch (reason) { setError(reasonMessage(reason, "请补全当前步骤")); }
  };

  const submit = async () => {
    if (!selectedServer) return;
    setWorking(true);
    setError("");
    try {
      if (isWireGuard) {
        const inbound = buildManagedWireGuardInbound(draft);
        const clientConfig = buildManagedWireGuardClientConfig(draft, wireGuardEndpoint);
        const response = await api.post<{ success?: boolean; error?: string; message?: string; resource?: ManagedInboundResource }>(`/api/admin/managed-inbound-resources/wireguard?server_id=${selectedServer.id}`, {
          action: "add",
          display_name: draft.name.trim(),
          inbound,
        });
        if (response.success !== true) throw new Error(response.error || response.message || "WireGuard 入站创建失败：服务端未确认创建成功");
        setWireGuardCreated({
          clientConfig,
          filename: `${draft.name.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "wireguard"}.conf`,
        });
        return;
      }
      const payload = buildManagedInboundRequest(draft);
      const willPublish = draft.publish && canPublish;
      const response = await api.post<ManagedCreateResponse>(`/api/admin/managed-nodes/create?server_id=${selectedServer.id}`, payload);
      if (isTunnel && response.success !== true) throw new Error(response.error || response.message || "任意门转发创建失败：服务端未确认事务成功");
      if (isTunnel && (response.runtime_warning?.trim() || response.warning?.trim())) throw new Error(response.runtime_warning?.trim() || response.message?.trim() || response.warning?.trim() || "任意门转发创建失败");
      const nodeID = response.node_id ?? response.node?.id;
      if (!nodeID) throw new Error(response.message || "节点创建完成但控制端未返回节点记录");
      if (willPublish) {
        try {
          await api.post("/api/admin/managed-node-offers", {
            node_id: nodeID,
            enabled: true,
            sort_order: Math.max(0, Math.floor(Number(draft.sortOrder) || 0)),
          });
        } catch (reason) {
          onComplete(`节点已创建，但发布到用户目录失败：${reasonMessage(reason, "请在节点编辑中重试发布")}`, "error");
          return;
        }
      }
      onComplete(isTunnel ? "任意门转发已创建" : willPublish ? "受管节点已创建并发布给用户" : "受管节点已创建");
    } catch (reason) { setError(reasonMessage(reason, isTunnel ? "任意门转发创建失败" : isWireGuard ? "WireGuard 入站创建失败" : "受管节点创建失败")); }
    finally { setWorking(false); }
  };

  if (wireGuardCreated) {
    return <Dialog title="保存 WireGuard 客户端配置" description="客户端私钥只保留在当前浏览器；关闭后不能从订阅或控制端恢复。" onClose={() => onComplete("WireGuard 入站已创建，请妥善保存客户端配置")} extraWide>
      <div className="form-stack nw-wireguard-created">
        {error ? <ErrorState message={error} /> : null}
        <div className="nw-inline-note"><KeyRound size={16} /><span>WireGuard 入站已创建。下载或复制配置后再关闭此窗口。</span></div>
        <Field label="WireGuard 客户端配置"><textarea className="nw-code-editor" aria-label="WireGuard 客户端配置" readOnly value={wireGuardCreated.clientConfig} /></Field>
        <div className="dialog-actions"><Button variant="secondary" onClick={() => void copyText(wireGuardCreated.clientConfig).catch((reason) => setError(reasonMessage(reason, "复制客户端配置失败")))}><Copy size={16} />复制</Button><Button variant="secondary" onClick={() => { try { downloadText(wireGuardCreated.filename, wireGuardCreated.clientConfig); } catch (reason) { setError(reasonMessage(reason, "下载客户端配置失败")); } }}><FileDown size={16} />下载 .conf</Button><Button onClick={() => onComplete("WireGuard 入站已创建，请妥善保存客户端配置")}><Check size={16} />完成</Button></div>
      </div>
    </Dialog>;
  }

  return <Dialog title="在服务器创建节点" description="选择受管服务器后创建真实入站；WireGuard 使用一次性客户端配置。" onClose={onClose} wide dismissible={!working}>
    <div className="managed-node-wizard" ref={wizardRef}>
      <ol className="managed-stepper" aria-label="创建进度">
        {["服务器", "协议", "配置", "确认"].map((label, index) => <li key={label} className={step === index + 1 ? "is-active" : step > index + 1 ? "is-done" : ""}><span>{step > index + 1 ? <Check size={14} /> : index + 1}</span><strong>{label}</strong></li>)}
      </ol>
      {error ? <ErrorState message={error} /> : null}
      {loading ? <div className="center-state"><Spinner label="正在读取服务器与证书" /></div> : step === 1 ? <section className="managed-wizard-step">
        <div className="managed-step-heading"><span><Server size={19} /></span><div><h3>选择运行节点的服务器</h3><p>地址由服务器配置自动生成，不需要手工填写 IP 或域名。</p></div></div>
        {servers.length ? <div className="managed-server-grid">{servers.map((server) => {
          const ready = serverReady(server);
          return <button key={server.id} type="button" aria-pressed={serverID === String(server.id)} className={serverID === String(server.id) ? "is-selected" : ""} disabled={!ready} onClick={() => chooseServer(server)}>
            <span className={`managed-server-icon ${ready ? "is-online" : ""}`}><Server size={18} /></span><span><strong>{server.name}</strong><small>{server.domain || server.ip_address || "地址待上报"}</small></span><Badge tone={ready ? "good" : "bad"}>{serverID === String(server.id) && inventoryWorking ? "读取配置" : ready ? "Xray 在线" : "不可创建"}</Badge>
          </button>;
        })}</div> : <EmptyState icon={<Server size={23} />} title="还没有受管服务器" description="先在服务器管理添加并安装 Agent。" />}
        {!readyServers.length && servers.length ? <div className="nw-inline-note"><Activity size={16} /><span>当前没有 Xray 在线的服务器，恢复在线后才能继续。</span></div> : null}
      </section> : step === 2 ? <section className="managed-wizard-step">
        <div className="managed-step-heading"><span><Network size={19} /></span><div><h3>选择协议与安全组合</h3><p>仅显示当前 Agent 可安全创建的协议组合。</p></div></div>
        <div className="form-grid"><Field label="协议"><select aria-label="节点协议" value={selectedFamily} onChange={(event) => { const family = event.target.value as ManagedProtocolFamily; const first = managedProtocolOptions.find((item) => item.family === family); if (first) chooseProtocol(first.value); }}>{managedProtocolFamilies.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="传输与安全预设"><select aria-label="节点传输与安全预设" value={draft.protocol} onChange={(event) => chooseProtocol(event.target.value as ManagedProtocol)}>{familyProtocols.map((option) => { const wssOption = isManagedWSSProtocol(option.value); const disabled = wssOption && !wssReady; const reason = !selectedServer?.domain?.trim() ? "服务器未配置域名" : "缺少匹配的有效证书"; return <option key={option.value} value={option.value} disabled={disabled}>{option.label}{disabled ? `（${reason}）` : ""}</option>; })}</select></Field></div>
        <div className="managed-import-only"><span><Shield size={16} /></span><div><strong>{selectedProtocol?.label}</strong><small>{selectedProtocol?.detail}</small></div></div>
        <div className="managed-import-only"><span><Upload size={16} /></span><div><strong>TUIC 与自定义协议</strong><small>已有节点请使用“导入已有节点”；AnyTLS、Snell 可在服务器的高级入站中配置。</small></div></div>
      </section> : step === 3 ? <section className="managed-wizard-step">
        <div className="managed-step-heading"><span><Settings2 size={19} /></span><div><h3>配置 {protocolLabel(draft.protocol)}</h3><p>界面只展示当前协议需要的字段。</p></div></div>
        <div className="form-grid"><Field label="节点名称"><input autoFocus required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={`${selectedServer?.name || "节点"} ${protocolLabel(draft.protocol)}`} /></Field><Field label="入站标识（Tag）" hint="Xray 内部唯一标识，同一服务器不可重复"><input required value={draft.tag} onChange={(event) => setDraft({ ...draft, tag: event.target.value })} /></Field></div>
        <div className="form-grid"><Field label="监听端口"><input required type="number" min="1" max="65535" value={draft.port} onChange={(event) => setDraft({ ...draft, port: event.target.value })} /></Field>{isTunnel ? <Field label="转发网络"><input readOnly value="TCP + UDP" /></Field> : isWireGuard ? <Field label="客户端 Endpoint"><input readOnly value={wireGuardEndpoint ? `${wireGuardEndpoint.includes(":") && !wireGuardEndpoint.startsWith("[") ? `[${wireGuardEndpoint}]` : wireGuardEndpoint}:${draft.port}` : "服务器尚未上报可连接地址"} /></Field> : <Field label="客户端地址"><select value={draft.ipVersion} onChange={(event) => setDraft({ ...draft, ipVersion: event.target.value as ManagedInboundDraft["ipVersion"] })}><option value="v4">IPv4</option>{selectedServer?.ipv6_enabled && selectedServer.ip_address_v6 ? <option value="v6">IPv6</option> : null}{selectedServer?.ipv6_enabled && selectedServer.ip_address_v6 ? <option value="both">IPv4 + IPv6</option> : null}</select></Field>}</div>
        {isTunnel ? <><div className="form-grid"><Field label="目标节点"><select value={draft.forwardNodeId} onChange={(event) => chooseForwardNode(event.target.value)}><option value="">请选择已有节点</option>{forwardingCandidates.map((node) => { const address = nodeAddress(node); return <option key={node.id} value={node.id}>{node.node_name} · {address.host}:{address.port}</option>; })}</select></Field><Field label="目标地址"><input readOnly value={draft.targetAddress && draft.targetPort ? `${draft.targetAddress}:${draft.targetPort}` : ""} /></Field></div>{forwardingCandidates.length ? <div className="nw-inline-note"><Cable size={16} /><span><strong>TCP + UDP</strong> · {selectedForwardNode ? <code>{draft.targetAddress}:{draft.targetPort}</code> : "请选择目标节点"}</span></div> : <ErrorState message="当前没有可转发的目标节点，请先创建或导入一个节点" />}</> : null}
        {isWireGuard ? <><div className="form-grid"><Field label="服务端隧道地址"><input aria-label="WireGuard 服务端地址" value={draft.wireGuardServerAddress} onChange={(event) => setDraft({ ...draft, wireGuardServerAddress: event.target.value })} placeholder="10.66.66.1/32" /></Field><Field label="客户端隧道地址"><input aria-label="WireGuard 客户端地址" value={draft.wireGuardClientAddress} onChange={(event) => setDraft({ ...draft, wireGuardClientAddress: event.target.value })} placeholder="10.66.66.2/32" /></Field></div><div className="form-grid three"><Field label="客户端 DNS"><input aria-label="WireGuard 客户端 DNS" value={draft.wireGuardDNS} onChange={(event) => setDraft({ ...draft, wireGuardDNS: event.target.value })} /></Field><Field label="MTU"><input type="number" min="576" max="9000" aria-label="WireGuard MTU" value={draft.wireGuardMTU} onChange={(event) => setDraft({ ...draft, wireGuardMTU: event.target.value })} /></Field><Field label="Keepalive"><input type="number" min="0" max="65535" aria-label="WireGuard Keepalive" value={draft.wireGuardKeepAlive} onChange={(event) => setDraft({ ...draft, wireGuardKeepAlive: event.target.value })} /></Field></div><div className="managed-key-state"><span><KeyRound size={16} /><span><strong>本地 WireGuard 密钥</strong><small>{draft.wireGuardServerPrivateKey && draft.wireGuardClientPrivateKey ? "两组密钥已生成；客户端私钥不会发送到控制端" : "等待在浏览器中生成"}</small></span></span><Button type="button" variant="secondary" disabled={wireGuardKeyWorking} onClick={() => void generateWireGuardKeys()}>{wireGuardKeyWorking ? <Spinner label="正在生成" /> : <><RefreshCw size={15} />重新生成</>}</Button></div></> : null}
        {draft.protocol === "vless-reality" ? <div className="form-grid"><Field label="客户端 UUID"><div className="nw-copy-field"><input value={draft.uuid} onChange={(event) => setDraft({ ...draft, uuid: event.target.value })} /><IconButton label="重新生成 UUID" onClick={() => setDraft({ ...draft, uuid: createManagedUUID() })}><RefreshCw size={15} /></IconButton></div></Field><Field label="流控"><select aria-label="Reality 流控" value={draft.flow} onChange={(event) => setDraft({ ...draft, flow: event.target.value as ManagedInboundDraft["flow"] })}><option value="xtls-rprx-vision">xtls-rprx-vision（推荐）</option><option value="">无流控</option></select></Field></div> : draft.protocol === "trojan-reality" ? <Field label="认证密码"><input value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} /></Field> : null}
        {isReality ? <>
          <div className="form-grid"><Field label="伪装目标域名 / SNI" hint="必须明确选择；优先使用同 ASN 且证书覆盖该 SNI 的 TLS 站点"><div className="nw-copy-field"><input list="managed-reality-domains" value={draft.domain} onChange={(event) => setDraft({ ...draft, domain: event.target.value })} placeholder="www.example.com" /><IconButton label="重新探测 Reality 目标域名" disabled={domainWorking} onClick={() => void loadRealityDomains(serverID)}><RefreshCw size={15} /></IconButton></div></Field><Field label="Short ID" hint="2-16 位偶数长度十六进制"><input value={draft.shortId} onChange={(event) => setDraft({ ...draft, shortId: event.target.value })} /></Field></div>
          <datalist id="managed-reality-domains">{realityDomains.map((item) => <option key={item.domain} value={item.domain}>{item.success ? `443 可达 · ${item.latency_ms ?? "-"} ms` : "探测失败"}</option>)}</datalist>
          <div className="managed-key-state"><span><KeyRound size={16} /><span><strong>X25519 密钥</strong><small>{draft.privateKey && draft.publicKey ? "已安全生成" : "等待生成"}</small></span></span><Button type="button" variant="secondary" disabled={keyWorking} onClick={() => void generateRealityKeys()}>{keyWorking ? <Spinner label="正在生成" /> : <><RefreshCw size={15} />重新生成</>}</Button></div>
        </> : null}
        {draft.protocol === "vless-tls" ? <div className="form-grid"><Field label="客户端 UUID"><div className="nw-copy-field"><input value={draft.uuid} onChange={(event) => setDraft({ ...draft, uuid: event.target.value })} /><IconButton label="重新生成 UUID" onClick={() => setDraft({ ...draft, uuid: createManagedUUID() })}><RefreshCw size={15} /></IconButton></div></Field><Field label="流控"><select aria-label="VLESS TLS 流控" value={draft.flow} onChange={(event) => setDraft({ ...draft, flow: event.target.value as ManagedInboundDraft["flow"] })}><option value="xtls-rprx-vision">XTLS Vision（推荐）</option><option value="">无流控</option></select></Field></div> : draft.protocol === "vless-grpc-tls" || draft.protocol === "vless-ws" || draft.protocol === "vless-wss" ? <Field label="客户端 UUID"><div className="nw-copy-field"><input value={draft.uuid} onChange={(event) => setDraft({ ...draft, uuid: event.target.value })} /><IconButton label="重新生成 UUID" onClick={() => setDraft({ ...draft, uuid: createManagedUUID() })}><RefreshCw size={15} /></IconButton></div></Field> : null}
        {draft.protocol === "vmess" || draft.protocol === "vmess-tls" || draft.protocol === "vmess-grpc-tls" || draft.protocol === "vmess-ws" || draft.protocol === "vmess-wss" ? <div className="form-grid"><Field label="客户端 UUID"><div className="nw-copy-field"><input value={draft.uuid} onChange={(event) => setDraft({ ...draft, uuid: event.target.value })} /><IconButton label="重新生成 UUID" onClick={() => setDraft({ ...draft, uuid: createManagedUUID() })}><RefreshCw size={15} /></IconButton></div></Field><Field label="客户端加密"><select value={draft.vmessCipher} onChange={(event) => setDraft({ ...draft, vmessCipher: event.target.value as ManagedInboundDraft["vmessCipher"] })}><option value="auto">Auto（推荐）</option><option value="aes-128-gcm">AES-128-GCM</option><option value="chacha20-poly1305">ChaCha20-Poly1305</option></select></Field></div> : null}
        {draft.protocol === "trojan-wss" ? <Field label="认证密码"><input value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} /></Field> : null}
        {isGRPC ? <Field label="gRPC Service Name" hint="客户端必须填写相同值；无需以 / 开头"><input value={draft.wsPath} onChange={(event) => setDraft({ ...draft, wsPath: event.target.value })} placeholder="grpc-service" /></Field> : null}
        {isWSS ? <div className="form-grid"><Field label="TLS 节点域名" hint="由服务器域名和 Nginx 提供 TLS"><input readOnly value={draft.domain} /></Field><Field label="WebSocket 路径"><input value={draft.wsPath} onChange={(event) => setDraft({ ...draft, wsPath: event.target.value })} /></Field></div> : isPlainWS ? <div className="form-grid"><Field label="WebSocket Host（可选）" hint="留空即可直接使用服务器 IP 或节点地址"><input value={draft.domain} onChange={(event) => setDraft({ ...draft, domain: event.target.value })} placeholder="可留空" /></Field><Field label="WebSocket 路径"><input value={draft.wsPath} onChange={(event) => setDraft({ ...draft, wsPath: event.target.value })} /></Field></div> : null}
        {draft.protocol === "vless-ws" ? <div className="nw-inline-note"><Shield size={16} /><span>VLESS WS 未启用传输加密，适合受信或私有链路；公网优先使用 Reality 或 WSS。</span></div> : null}
        {draft.protocol === "shadowsocks" ? <><Field label="加密方式"><select aria-label="Shadowsocks 加密方式" value={draft.ssCipher} onChange={(event) => chooseSSCipher(event.target.value as ManagedInboundDraft["ssCipher"])}><optgroup label="经典 AEAD"><option value="aes-128-gcm">AES-128-GCM</option><option value="aes-256-gcm">AES-256-GCM</option><option value="chacha20-ietf-poly1305">ChaCha20-IETF-Poly1305</option></optgroup><optgroup label="Shadowsocks 2022（多用户）"><option value="2022-blake3-aes-128-gcm">2022 BLAKE3 AES-128-GCM</option><option value="2022-blake3-aes-256-gcm">2022 BLAKE3 AES-256-GCM</option></optgroup></select></Field>{isShadowsocks2022Cipher(draft.ssCipher) ? <div className="form-grid"><Field label="服务端主密钥" hint="切换加密方式时自动生成"><input value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value.trim() })} /></Field><Field label="初始用户密钥" hint="管理员节点凭据"><input value={draft.ssUserPassword} onChange={(event) => setDraft({ ...draft, ssUserPassword: event.target.value.trim() })} /></Field></div> : <Field label="节点密码" hint="经典 Shadowsocks 使用一组共享密码"><input value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} /></Field>}</> : null}
        {draft.protocol === "socks5" || draft.protocol === "http" ? <div className="form-grid"><Field label="初始用户名"><input value={draft.accountUsername} onChange={(event) => setDraft({ ...draft, accountUsername: event.target.value.trim() })} /></Field><Field label="初始密码"><input value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} /></Field></div> : null}
        {selectedProtocol?.requiresCertificate ? <>{isManagedUUIDProtocol(draft.protocol) ? <Field label="托管证书"><select value={draft.certificateId} onChange={(event) => { const certificate = validCertificates.find((item) => String(item.id) === event.target.value); setDraft({ ...draft, certificateId: event.target.value, domain: managedTLSHostnameForCertificate(certificate, selectedServer, draft.domain) }); }}><option value="">请选择证书</option>{validCertificates.map((item) => <option value={item.id} key={item.id}>{item.domain}</option>)}</select></Field> : <div className="form-grid"><Field label="认证密码"><input value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} /></Field><Field label="托管证书"><select value={draft.certificateId} onChange={(event) => { const certificate = validCertificates.find((item) => String(item.id) === event.target.value); setDraft({ ...draft, certificateId: event.target.value, domain: managedTLSHostnameForCertificate(certificate, selectedServer, draft.domain) }); }}><option value="">请选择证书</option>{validCertificates.map((item) => <option value={item.id} key={item.id}>{item.domain}</option>)}</select></Field></div>}<Field label="TLS SNI"><input value={draft.domain} onChange={(event) => setDraft({ ...draft, domain: event.target.value })} placeholder="edge.example.com" /></Field><Toggle checked={draft.skipCertVerify} onChange={(skipCertVerify) => setDraft({ ...draft, skipCertVerify })} label="客户端跳过证书校验" /></> : null}
        {!isTunnel ? <div className="managed-publish-panel"><Toggle checked={draft.publish && canPublish} disabled={!canPublish} onChange={(publish) => setDraft({ ...draft, publish })} label="创建后发布到用户自助目录" />{draft.publish && canPublish ? <Field label="目录排序" hint="数值越小越靠前"><input type="number" min="0" value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })} /></Field> : <small>{canPublish ? "稍后也可以在节点编辑中发布。" : publishDisabledReason}</small>}</div> : null}
      </section> : <section className="managed-wizard-step">
        <div className="managed-step-heading"><span><ShieldCheck size={19} /></span><div><h3>确认创建</h3><p>{isWireGuard ? "创建会写入远程 Xray，并在当前浏览器提供一次性客户端配置。" : "创建会写入远程 Xray，并在控制端生成对应节点。"}</p></div></div>
        <dl className="managed-review"><div><dt>服务器</dt><dd>{selectedServer?.name}</dd></div><div><dt>节点名称</dt><dd>{draft.name}</dd></div><div><dt>协议</dt><dd>{protocolLabel(draft.protocol)}</dd></div><div><dt>监听</dt><dd>{draft.port} · {isTunnel ? "TCP + UDP" : isWireGuard ? "UDP · 一次性配置" : draft.ipVersion.toUpperCase()}</dd></div><div><dt>入站标识（Tag）</dt><dd><code>{draft.tag}</code></dd></div>{isTunnel ? <div><dt>目标节点</dt><dd>{selectedForwardNode?.node_name} · <code>{draft.targetAddress}:{draft.targetPort}</code></dd></div> : <div><dt>用户目录</dt><dd>{isWireGuard ? "不支持" : draft.publish && canPublish ? "创建后发布" : "暂不发布"}</dd></div>}</dl>
        <details className="secure-inbound-preview"><summary>查看将提交的 Xray JSON</summary><textarea className="nw-code-editor" aria-label="受管节点 Xray JSON" readOnly value={JSON.stringify((isWireGuard ? buildManagedWireGuardInbound(draft) : buildManagedInboundRequest(draft).inbound), null, 2)} /></details>
      </section>}
      {!loading ? <div className="dialog-actions managed-wizard-actions"><Button type="button" variant="secondary" onClick={step === 1 ? onClose : () => { setError(""); setStep((current) => current - 1); }} disabled={working}><ArrowLeft size={16} />{step === 1 ? "取消" : "上一步"}</Button>{step < 4 ? <Button type="button" onClick={validateStep} disabled={working || (step === 1 && (!readyServers.length || inventoryWorking || inventoryServerID !== serverID)) || keyWorking || wireGuardKeyWorking}>下一步<ArrowRight size={16} /></Button> : <Button type="button" onClick={() => void submit()} disabled={working}>{working ? <Spinner label="正在创建并校验" /> : <><Server size={16} />{isWireGuard ? "创建 WireGuard 入站" : "创建节点"}</>}</Button>}</div> : null}
    </div>
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

export function AnyDoorForwardDialog({ node, onClose, onComplete }: {
  node: WorkbenchNode;
  onClose: () => void;
  onComplete: () => void | Promise<void>;
}) {
  const target = nodeAddress(node);
  const [servers, setServers] = useState<RemoteServer[]>([]);
  const [serverID, setServerID] = useState(0);
  const [tag, setTag] = useState(`anydoor-node-${node.id}`);
  const [port, setPort] = useState("2033");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await api.get<ServerListResponse>("/api/admin/remote-servers");
        if (!active) return;
        const ready = (response.servers ?? []).filter(serverReady);
        setServers(ready);
        setServerID(ready[0]?.id || 0);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "服务器列表加载失败");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const listenPort = Number(port);
  const valid = Boolean(serverID && target.host && target.port && /^[A-Za-z0-9_-]{2,64}$/.test(tag.trim()) && Number.isInteger(listenPort) && listenPort >= 1 && listenPort <= 65535);
  const tunnelNodeName = `${node.node_name.trim() || `节点 ${node.id}`} | Tunnel`;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setWorking(true);
    setError("");
    try {
      const response = await api.post<ManagedCreateResponse>(`/api/admin/managed-nodes/create?server_id=${serverID}`, {
        action: "add",
        node_name: tunnelNodeName,
        forward_node_id: node.id,
        inbound: {
          tag: tag.trim(),
          protocol: "tunnel",
          port: listenPort,
          settings: { address: target.host, port: target.port, network: "tcp,udp" },
        },
      });
      if (response.success !== true) throw new Error(response.error || response.message || "任意门转发创建失败：服务端未确认事务成功");
      const runtimeWarning = response.runtime_warning?.trim();
      const warning = response.warning?.trim();
      if (runtimeWarning || warning) throw new Error(runtimeWarning || response.message?.trim() || warning || "任意门转发创建失败");
      const hasNodeID = (response.node_id ?? 0) > 0 || (response.node?.id ?? 0) > 0;
      if (!hasNodeID) throw new Error("任意门转发创建失败：服务端未返回有效节点记录");
      await onComplete();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "任意门转发创建失败");
    } finally {
      setWorking(false);
    }
  };

  return <Dialog title={`任意门转发 · ${node.node_name}`} description={`将入口同时转发 TCP 与 UDP 到 ${target.host}:${target.port}`} onClose={onClose} dismissible={!working}>
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
      {error ? <ErrorState message={error} /> : null}
      <Field label="入口服务器"><select autoFocus value={serverID || ""} disabled={loading || working} onChange={(event) => setServerID(Number(event.target.value))}><option value="">选择在线服务器</option>{servers.map((server) => <option key={server.id} value={server.id}>{server.name} · {server.domain || server.ip_address || "地址待上报"}</option>)}</select></Field>
      <div className="form-grid"><Field label="入站标识（Tag）" hint="Xray 内部唯一标识，同一服务器不可重复"><input required value={tag} onChange={(event) => setTag(event.target.value)} /></Field><Field label="监听端口"><input required type="number" min="1" max="65535" value={port} onChange={(event) => setPort(event.target.value)} /></Field></div>
      <div className="nw-inline-note"><Cable size={16} /><span><strong>TCP + UDP</strong> · <code>{target.host}:{target.port}</code></span></div>
      {!loading && servers.length === 0 ? <ErrorState message="没有可用的在线受管服务器" /> : null}
      <div className="dialog-actions"><Button type="button" variant="secondary" disabled={working} onClick={onClose}>取消</Button><Button type="submit" disabled={!valid || loading || working}>{working ? <Spinner label="正在创建" /> : <><Cable size={16} />创建任意门</>}</Button></div>
    </form>
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

function lineSpeedtestTargetPayload(target: LineSpeedtestTarget, acceptLicense = false): { kind: LineSpeedtestTarget["kind"]; server_id?: number; accept_license?: true } {
  const payload = target.kind === "remote" && typeof target.server_id === "number"
    ? { kind: target.kind, server_id: target.server_id }
    : { kind: target.kind };
  return acceptLicense ? { ...payload, accept_license: true } : payload;
}

function lineSpeedtestMetric(value: number | undefined, suffix: string): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? `${numeric.toFixed(1)} ${suffix}` : "-";
}

function lineSpeedtestServer(result: LineSpeedtestResult | undefined): string {
  if (!result) return "-";
  return result.test_server
    || [result.server_name, result.server_location].filter(Boolean).join(" · ")
    || "-";
}

function lineSpeedtestNeedsAgentUpgrade(target: LineSpeedtestTarget): boolean {
  return target.upgrade_required === true
    || (target.kind === "remote" && /(?:升级|upgrade).{0,12}agent|agent.{0,12}(?:过旧|upgrade)|\b404\b/i.test(target.error || ""));
}

function lineSpeedtestJobState(response: LineSpeedtestJobResponse): { status: string; error: string; result?: LineSpeedtestResult; job: LineSpeedtestJob } {
  const job = response.job ?? response;
  return {
    status: String(job.status || response.status || "running").trim().toLowerCase(),
    error: String(job.error || response.error || "").trim(),
    result: response.result ?? job.result,
    job,
  };
}

function LineSpeedtestView({ notify }: { notify: NodesWorkbenchNotify }) {
  const [targets, setTargets] = useState<LineSpeedtestTarget[]>([]);
  const [activeJobs, setActiveJobs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<{ key: string; action: "install" | "remove" | "run" } | null>(null);
  const [pendingInstall, setPendingInstall] = useState<LineSpeedtestTarget | null>(null);
  const [pendingRemove, setPendingRemove] = useState<LineSpeedtestTarget | null>(null);
  const [licenseAccepted, setLicenseAccepted] = useState(false);
  const [error, setError] = useState("");
  const targetNamesRef = useRef<Record<string, string>>({});

  const loadTargets = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await api.get<{ targets?: LineSpeedtestTarget[] | null }>("/api/admin/line-speedtest/targets");
      setTargets(response.targets ?? []);
    } catch (reason) {
      setError(reasonMessage(reason, "线路测速目标加载失败"));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => { void loadTargets(); }, [loadTargets]);
  useEffect(() => {
    targetNamesRef.current = Object.fromEntries(targets.map((target) => [target.key, target.name]));
  }, [targets]);

  useEffect(() => {
    const jobs = Object.entries(activeJobs);
    if (!jobs.length) return;
    let cancelled = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      const responses = await Promise.all(jobs.map(async ([key, jobID]): Promise<{ key: string; response: LineSpeedtestJobResponse } | { key: string; error: string }> => {
        try {
          const response = await api.get<LineSpeedtestJobResponse>(`/api/admin/line-speedtest/jobs/${encodeURIComponent(jobID)}`);
          return { key, response };
        } catch (reason) {
          return { key, error: reasonMessage(reason, "任务状态刷新失败") };
        }
      }));
      if (cancelled) { polling = false; return; }
      const states = new Map<string, { status: string; error: string; result?: LineSpeedtestResult; job?: LineSpeedtestJob }>(responses.map((item) => [item.key, "response" in item ? lineSpeedtestJobState(item.response) : { status: "running", error: item.error }]));
      const succeeded = new Set<string>();
      const failed = new Map<string, string>();
      for (const [key, state] of states) {
        if (["completed", "complete", "ok", "success", "succeeded", "done"].includes(state.status)) succeeded.add(key);
        if (["failed", "error", "cancelled", "canceled"].includes(state.status)) failed.set(key, state.error || "线路测速失败");
      }
      setTargets((current) => current.map((target) => {
        const state = states.get(target.key);
        if (!state) return target;
        if (succeeded.has(target.key)) return { ...target, running: false, error: "", last_result: state.result ?? target.last_result, last_job: state.job ?? target.last_job };
        if (failed.has(target.key)) return { ...target, running: false, error: failed.get(target.key), last_job: state.job ?? target.last_job };
        return { ...target, running: true, error: state.error || "", last_job: state.job ?? target.last_job };
      }));
      if (succeeded.size || failed.size) {
        setActiveJobs((current) => {
          const next = { ...current };
          for (const key of succeeded) delete next[key];
          for (const key of failed.keys()) delete next[key];
          return next;
        });
        for (const key of succeeded) notify(`${targetNamesRef.current[key] || "线路"}测速完成`);
        for (const [key, message] of failed) notify(`${targetNamesRef.current[key] || "线路"}：${message}`, "error");
      }
      polling = false;
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [activeJobs, notify]);

  const hasUntrackedRunningTarget = targets.some((target) => target.running && !activeJobs[target.key]);
  useEffect(() => {
    if (!hasUntrackedRunningTarget) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      await loadTargets(true);
      if (!cancelled) timer = window.setTimeout(() => void poll(), 2500);
    };
    timer = window.setTimeout(() => void poll(), 2500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [hasUntrackedRunningTarget, loadTargets]);

  const changeInstallation = async (target: LineSpeedtestTarget, action: "install" | "remove", acceptLicense = false) => {
    setWorking({ key: target.key, action });
    setError("");
    try {
      await api.post(`/api/admin/line-speedtest/${action}`, lineSpeedtestTargetPayload(target, acceptLicense));
      setPendingInstall(null);
      setPendingRemove(null);
      notify(`${target.name} Ookla Speedtest ${action === "install" ? (target.installed ? "许可已确认" : "安装完成") : "已卸载"}`);
      await loadTargets(true);
    } catch (reason) {
      if (action === "install") setPendingInstall(null);
      if (action === "remove") setPendingRemove(null);
      setError(reasonMessage(reason, action === "install" ? "Ookla Speedtest 安装失败" : "Ookla Speedtest 卸载失败"));
    } finally {
      setWorking(null);
    }
  };

  const run = async (target: LineSpeedtestTarget) => {
    setWorking({ key: target.key, action: "run" });
    setError("");
    try {
      const response = await api.post<LineSpeedtestJobResponse>("/api/admin/line-speedtest/run", lineSpeedtestTargetPayload(target));
      const jobID = String(response.job_id ?? response.job?.job_id ?? response.id ?? response.job?.id ?? "").trim();
      if (!jobID) throw new Error("服务端未返回线路测速任务编号");
      const startedJob = response.job ?? response;
      setTargets((current) => current.map((item) => item.key === target.key ? {
        ...item,
        running: true,
        error: "",
        last_job: { ...startedJob, id: startedJob.id ?? jobID, status: startedJob.status || response.status || "running" },
      } : item));
      setActiveJobs((current) => ({ ...current, [target.key]: jobID }));
      notify(`${target.name}线路测速已开始`);
    } catch (reason) {
      setError(reasonMessage(reason, "线路测速启动失败"));
    } finally {
      setWorking(null);
    }
  };

  return <div className="nw-line-speedtest">
    {error ? <ErrorState message={error} onRetry={() => void loadTargets()} /> : null}
    <div className="nw-list-heading"><span><Server size={17} /><strong>线路测速目标</strong></span><IconButton label="刷新线路测速目标" onClick={() => void loadTargets()} disabled={loading || Boolean(working)}><RefreshCw size={17} /></IconButton></div>
    {loading ? <div className="center-state"><Spinner label="正在加载线路测速能力" /></div> : targets.length ? <div className="nw-dialog-table nw-line-speed-table"><table aria-label="线路测速目标"><colgroup><col className="nw-line-col-target" /><col className="nw-line-col-status" /><col className="nw-line-col-implementation" /><col className="nw-line-col-latency" /><col className="nw-line-col-throughput" /><col className="nw-line-col-endpoint" /><col className="nw-line-col-time" /><col className="nw-line-col-actions" /></colgroup><thead><tr><th>执行端</th><th>状态</th><th>实现</th><th>Ping / 抖动</th><th>下载 / 上传</th><th>测试点 / 出口</th><th>时间</th><th aria-label="操作" /></tr></thead><tbody>{targets.map((target) => {
      const result = target.last_result;
      const lastJobStatus = String(target.last_job?.status || "").toLowerCase();
      const latestFailed = ["failed", "error", "cancelled", "canceled"].includes(lastJobStatus);
      const targetWorking = working?.key === target.key;
      const testing = target.running || activeJobs[target.key] !== undefined || (targetWorking && working.action === "run");
      const needsAgentUpgrade = lineSpeedtestNeedsAgentUpgrade(target);
      const statusUnavailable = target.online && target.supported === undefined && Boolean(target.error);
      const needsLicense = target.license_accepted === false;
      return <tr key={target.key}>
        <td><div className="nw-node-primary"><Badge tone={target.kind === "master" ? "info" : "neutral"}>{target.kind === "master" ? "主控" : "服务器"}</Badge><span><strong>{target.name}</strong>{target.kind === "remote" && target.server_id ? <small>#{target.server_id}</small> : null}</span></div></td>
        <td><div className="nw-line-status"><Badge tone={target.online ? "good" : "neutral"}>{target.online ? "在线" : "离线"}</Badge><Badge tone={target.installed ? "info" : "neutral"}>{target.installed ? "CLI 就绪" : "未安装"}</Badge>{needsLicense ? <Badge tone="warn">需确认许可</Badge> : null}{needsAgentUpgrade ? <Badge tone="warn">需升级 Agent</Badge> : null}{statusUnavailable ? <Badge tone="warn">状态不可用</Badge> : null}{latestFailed ? <Badge tone="bad">最近测速失败</Badge> : null}{testing ? <Badge tone="warn">测试中</Badge> : null}</div>{target.error ? <small className="cell-note nw-error-note" title={target.error}>{target.error}</small> : null}</td>
        <td><div className="nw-line-implementation"><strong title={target.implementation || "Ookla Speedtest"}>{target.implementation || "Ookla Speedtest"}</strong><small className="cell-note">{target.version || "-"}</small></div></td>
        <td><div className="nw-line-metrics"><span><small>Ping</small><strong>{lineSpeedtestMetric(result?.ping_ms, "ms")}</strong></span><span><small>抖动</small><strong>{lineSpeedtestMetric(result?.jitter_ms, "ms")}</strong></span>{typeof result?.packet_loss_percent === "number" ? <span><small>丢包</small><strong>{lineSpeedtestMetric(result.packet_loss_percent, "%")}</strong></span> : null}</div></td>
        <td><div className="nw-line-metrics nw-line-throughput"><span><small>下载</small><strong>↓ {lineSpeedtestMetric(result?.download_mbps, "Mbps")}</strong></span><span><small>上传</small><strong>↑ {lineSpeedtestMetric(result?.upload_mbps, "Mbps")}</strong></span></div></td>
        <td><div className="nw-line-endpoint"><strong title={lineSpeedtestServer(result)}>{lineSpeedtestServer(result)}</strong><small className="cell-note" title={`${result?.isp || "-"}${result?.egress_ip ? ` · ${result.egress_ip}` : ""}`}>{result?.isp || "-"}{result?.egress_ip ? ` · ${result.egress_ip}` : ""}</small></div></td>
        <td className="nw-line-time">{formatDate(latestFailed ? target.last_job?.completed_at || target.last_job?.created_at : result?.created_at || result?.timestamp)}</td>
        <td className="nw-line-actions"><div className="nw-row-actions">{!target.installed || needsLicense ? needsAgentUpgrade || !target.online || statusUnavailable ? <Button aria-label={`${needsLicense ? "确认 Ookla Speedtest 许可" : "安装 Ookla Speedtest"} 到 ${target.name}`} variant="secondary" disabled><HardDriveDownload size={15} />{needsLicense ? "确认许可" : "安装"}</Button> : target.managed ? <Button aria-label={`${needsLicense ? "确认 Ookla Speedtest 许可" : "安装 Ookla Speedtest"} 到 ${target.name}`} variant="secondary" disabled={Boolean(working)} onClick={() => { setLicenseAccepted(false); setPendingInstall(target); }}>{targetWorking && working.action === "install" ? <Spinner label="安装中" /> : <><HardDriveDownload size={15} />{needsLicense ? "确认许可" : "安装"}</>}</Button> : <Badge tone="neutral">手动安装</Badge> : <><Button aria-label={`测速 ${target.name} 线路`} variant="secondary" disabled={needsAgentUpgrade || statusUnavailable || !target.online || testing || Boolean(working)} onClick={() => void run(target)}>{testing ? <Spinner label="测试中" /> : <><Play size={15} />测速</>}</Button>{(target.owned ?? target.managed) ? <IconButton label={`卸载 ${target.name} Ookla Speedtest`} disabled={needsAgentUpgrade || statusUnavailable || !target.online || testing || Boolean(working)} onClick={() => setPendingRemove(target)}><Trash2 size={16} /></IconButton> : null}</>}</div></td>
      </tr>;
    })}</tbody></table></div> : <EmptyState icon={<Gauge size={22} />} title="暂无线路测速目标" description="接入主控或在线受管服务器后可进行线路测速" />}
    {pendingInstall ? <Dialog title={pendingInstall.installed ? "确认 Ookla Speedtest 许可" : "安装 Ookla Speedtest"} description={pendingInstall.installed ? `将为 ${pendingInstall.name} 确认 Ookla Speedtest 许可。` : `将把官方测速程序安装到 ${pendingInstall.name} 的面板管理目录。`} onClose={() => !working && setPendingInstall(null)} dismissible={!working}>
      <div className="form-stack nw-speed-license-dialog">
        <label className="nw-speed-license-consent"><input type="checkbox" checked={licenseAccepted} onChange={(event) => setLicenseAccepted(event.target.checked)} /><span>我确认本次使用符合 Ookla 个人、非商业用途的许可范围；商业或多租户使用已另行获得授权，并已阅读和接受其 <a href="https://www.speedtest.net/about/eula" target="_blank" rel="noreferrer">最终用户许可协议</a> 与 <a href="https://www.speedtest.net/about/privacy" target="_blank" rel="noreferrer">隐私政策</a>。</span></label>
        <div className="dialog-actions"><Button type="button" variant="secondary" disabled={Boolean(working)} onClick={() => setPendingInstall(null)}>取消</Button><Button type="button" disabled={!licenseAccepted || Boolean(working)} onClick={() => void changeInstallation(pendingInstall, "install", true)}>{working?.key === pendingInstall.key && working.action === "install" ? <Spinner label="安装中" /> : <><HardDriveDownload size={16} />同意并安装</>}</Button></div>
      </div>
    </Dialog> : null}
    {pendingRemove ? <ConfirmDialog title="卸载 Ookla Speedtest" description={`将从 ${pendingRemove.name} 移除由面板管理的 Ookla Speedtest。`} confirmLabel="确认卸载" working={working?.key === pendingRemove.key && working.action === "remove"} onCancel={() => !working && setPendingRemove(null)} onConfirm={() => void changeInstallation(pendingRemove, "remove")} /> : null}
  </div>;
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
  const [view, setView] = useState<"nodes" | "line">("nodes");
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

  return <Dialog title="测速工作台" description="测试代理节点表现，或直接检查主控与受管服务器的公网线路" onClose={onClose} wide extraWide>
    <div className="form-stack nw-speed-dialog">
      <div className="nw-speed-tabs" role="tablist" aria-label="测速类型"><button type="button" role="tab" aria-selected={view === "nodes"} className={view === "nodes" ? "is-active" : ""} onClick={() => setView("nodes")}><Route size={16} />节点测速</button><button type="button" role="tab" aria-selected={view === "line"} className={view === "line" ? "is-active" : ""} onClick={() => setView("line")}><Gauge size={16} />线路 Ookla Speedtest</button></div>
      {view === "nodes" ? <>
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
      </> : <LineSpeedtestView notify={notify} />}
      <DialogStatusBar><span><ShieldCheck size={15} />{view === "nodes" ? "主控测速会串行运行，避免多个节点争抢带宽" : "线路测速直接使用目标服务器公网出口，不经过代理节点"}</span><Button variant="secondary" onClick={onClose}>关闭</Button></DialogStatusBar>
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
