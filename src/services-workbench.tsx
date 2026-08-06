import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  Clipboard,
  Cloud,
  Code2,
  Copy,
  Cpu,
  Download,
  Eye,
  FileKey2,
  Gauge,
  Grid2X2,
  GripVertical,
  HardDrive,
  HardDriveDownload,
  KeyRound,
  List,
  MemoryStick,
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
  TriangleAlert,
  UploadCloud,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { api, openDashboardSocket, requestStream } from "./api";
import { CountryFlag } from "./country-flag";
import type { NginxMode, RealtimeMessage, RemoteServer, ServerListResponse, SharedServerToken } from "./types";
import {
  buildTrojanInbound,
  buildWireGuardClientProfile,
  buildWireGuardClientConfig,
  buildWireGuardInbound,
  generateWireGuardKeyPair,
  type TrojanCombination,
  type TrojanInboundFields,
  type WireGuardInboundFields,
} from "./xray-inbound-presets";
import {
  applyXrayBasicDefaults,
  freedomDomainStrategies,
  readXrayBasicSettings,
  routingDomainStrategies,
  setXrayBasicRule,
  setXrayFreedomStrategy,
  setXrayLog,
  setXrayRoutingStrategy,
  setXrayTorrentBlocked,
  xrayBlockedDomainPresets,
  xrayDirectDomainPresets,
  xrayIPPresets,
  xrayServicePresets,
  type XrayPresetOption,
} from "./xray-basic-config";
import { WarpManagement } from "./warp-management";
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

// Keep the service-management fallback responsive when the dashboard WebSocket
// is unavailable. Individual refreshes are deduplicated below, so a slow
// controller never turns this cadence into overlapping requests.
const serviceManagementRefreshIntervalMs = 1_000;

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

interface WireGuardCreateResponse extends ActionResponse {
  node_id?: number;
  node?: { id?: number };
  client_config?: string;
}

interface DeleteImpactCounts {
  nodes?: number;
  subaccounts?: number;
  inbound_configs?: number;
  outbounds?: number;
  xray_snapshots?: number;
  batch_inbounds?: number;
  batch_outbounds?: number;
  node_traffic?: number;
  user_traffic?: number;
  user_email_traffic?: number;
  traffic_snapshots?: number;
  node_traffic_snapshots?: number;
  user_traffic_snapshots?: number;
  system_traffic_snapshots?: number;
  stat_records?: number;
  total?: number;
}

type DeleteTaskStatus = "pending" | "dispatched" | "agent_uninstalled" | "failed";

interface DeleteImpact {
  server?: {
    id?: number;
    name?: string;
    ownership?: "owned" | "shared";
    online?: boolean;
    agent_uninstall_v2?: boolean | null;
    xray_mode?: string;
    warp_installed?: boolean;
  };
  counts?: DeleteImpactCounts;
  blocker?: string | null;
  deletion_task?: {
    status?: DeleteTaskStatus;
    last_error?: string;
    message?: string;
    retry_message?: string;
    expires_at?: string;
  };
}

interface DeleteImpactResponse extends ActionResponse, DeleteImpact {
  impact?: DeleteImpact;
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

interface CachedServiceStatus extends ServiceStatusResponse {
  loading: boolean;
  loaded: boolean;
}

interface ServiceTerminalState {
  title: string;
  description: string;
  output: string;
  running: boolean;
  outcome: "running" | "success" | "error";
}

interface RemoteStreamEvent {
  type?: string;
  data?: string;
  message?: string;
  output?: string;
  error?: string;
  hint?: string;
  success?: boolean;
}

interface AgentVersionResponse {
  server_id: number;
  current: string;
  latest: string;
  upgrade_available: boolean;
  current_error?: string;
  latest_error?: string;
}

interface CachedAgentVersion extends Partial<AgentVersionResponse> {
  loading: boolean;
  loaded: boolean;
}

type XrayQuickAction = "start" | "stop" | "restart" | "install" | "update";

interface QuickXrayConfirmation {
  server: ManagedServer;
  action: "stop" | "update";
}

interface XrayReleaseOption {
  version: string;
  name?: string;
  prerelease: boolean;
  published_at?: string;
}

interface XrayVersionsResponse extends ActionResponse {
  versions?: XrayReleaseOption[];
  releases?: XrayReleaseOption[];
  latest?: string;
  latest_stable?: string;
  version_selection_supported?: boolean;
  support_error?: string;
  stale?: boolean;
  warning?: string;
}

interface XrayUpdateCheck {
  checking: boolean;
  checked: boolean;
  supported: boolean;
  latestStable: string;
  error: string;
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

interface ManagedCertificateOption {
  id: number;
  domain: string;
  dns_names?: string[];
  remote_server_id?: number;
  remote_server_name?: string;
}

interface ValidCertificatesResponse extends ActionResponse {
  certificates?: ManagedCertificateOption[];
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

interface AgentUpgradeCandidate {
  server: ManagedServer;
  current: string;
  latest: string;
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
  nginxMode: NginxMode;
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
  nginxMode: "managed",
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

function parseXrayConfigObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function xrayConfigSection(value: string, key: string): Record<string, unknown> {
  const parsed = parseXrayConfigObject(value);
  const section = parsed?.[key];
  return section && typeof section === "object" && !Array.isArray(section) ? section as Record<string, unknown> : {};
}

function xrayConfigArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
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

function lineSpeedtestJobState(response: LineSpeedtestJobResponse): { status: string; error: string; result?: LineSpeedtestResult; job: LineSpeedtestJob } {
  const job = response.job ?? response;
  return {
    status: String(job.status || response.status || "running").trim().toLowerCase(),
    error: String(job.error || response.error || "").trim(),
    result: response.result ?? job.result,
    job,
  };
}

function lineSpeedtestNeedsAgentUpgrade(target: LineSpeedtestTarget): boolean {
  return target.upgrade_required === true
    || /(?:升级|upgrade).{0,12}agent|agent.{0,12}(?:过旧|upgrade)|\b404\b/i.test(target.error || "");
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

export function parseSSELog(raw: string): string {
  if (!raw.trim()) return "操作已完成";
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const messages: string[] = [];
  for (const line of lines) {
    const value = line.startsWith("data:") ? line.slice(5).trim() : line;
    let parsed: RemoteStreamEvent;
    try {
      parsed = JSON.parse(value) as typeof parsed;
    } catch {
      if (!value.startsWith("event:")) messages.push(value);
      continue;
    }
    const resultText = parsed.error || parsed.message || parsed.data || parsed.output || parsed.hint;
    if (resultText) messages.push(resultText);
    if (parsed.success === false || parsed.type?.toLowerCase() === "error") throw new Error(resultText || "远端操作失败");
  }
  return messages.slice(-4).join("\n") || "操作已完成";
}

function stripTerminalControlCodes(value: string): string {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/gi, "").replace(/\r/g, "");
}

export async function consumeRemoteServiceStream(response: Response, onOutput: (output: string) => void): Promise<string> {
  if (!response.body) throw new Error("远端未返回可读取的执行日志");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  let completionMessage = "操作已完成";

  const processFrame = (frame: string) => {
    const payload = frame.split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!payload) return;

    let event: RemoteStreamEvent;
    try {
      event = JSON.parse(payload) as RemoteStreamEvent;
    } catch {
      onOutput(stripTerminalControlCodes(payload));
      return;
    }

    const type = event.type?.toLowerCase() ?? "";
    const message = stripTerminalControlCodes(event.error || event.message || event.hint || "");
    if (type === "error" || event.success === false) throw new Error(message || "远端操作失败");
    if (type === "complete") {
      if (event.success !== true) throw new Error(message || "远端未确认操作成功");
      completed = true;
      completionMessage = message || "操作已完成";
      return;
    }

    const output = stripTerminalControlCodes(event.data || event.output || event.message || event.hint || "");
    if (output) onOutput(output);
  };

  const flushFrames = (flushRemainder = false) => {
    buffer = buffer.replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      processFrame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
    if (flushRemainder && buffer.trim()) {
      processFrame(buffer);
      buffer = "";
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      flushFrames();
    }
    buffer += decoder.decode();
    flushFrames(true);
    if (!completed) throw new Error("远端日志流在确认完成前中断");
    return completionMessage;
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // Preserve the operation error when stream cleanup also fails.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
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

type InboundCreationPreset = "reality" | "wss" | "wireguard" | "trojan" | "advanced";
type VlessInboundCreationPreset = Extract<InboundCreationPreset, "reality" | "wss">;

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

type TrojanInboundDraft = Omit<TrojanInboundFields, "tag" | "port">;
type WireGuardInboundDraft = Omit<WireGuardInboundFields, "tag" | "port">;

interface WireGuardCreatedState {
  serverPublicKey: string;
  clientConfig: string;
}

function certificateNameMatchesHost(name: string, host: string): boolean {
  const normalizedName = name.trim().toLowerCase().replace(/\.$/, "");
  const normalizedHost = host.trim().toLowerCase().replace(/\.$/, "");
  if (!normalizedName || !normalizedHost) return false;
  if (!normalizedName.startsWith("*.")) return normalizedName === normalizedHost;
  const suffix = normalizedName.slice(2);
  return normalizedHost.endsWith(`.${suffix}`) && normalizedHost.split(".").length === suffix.split(".").length + 1;
}

function certificateMatchesHost(certificate: ManagedCertificateOption, host: string): boolean {
  const names = certificate.dns_names?.length ? certificate.dns_names : [certificate.domain];
  return names.some((name) => certificateNameMatchesHost(name, host));
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

function newTrojanInboundDraft(serverDomain = ""): TrojanInboundDraft {
  return {
    password: randomHex(32),
    domain: serverDomain.trim().toLowerCase(),
    combination: "tcp-tls",
    certificateId: "",
    path: `/trojan/${randomHex(10)}`,
    serviceName: `trojan-${randomHex(8)}`,
    privateKey: "",
    publicKey: "",
    shortId: randomHex(16),
  };
}

function newWireGuardInboundDraft(): WireGuardInboundDraft {
  return {
    serverPrivateKey: "",
    serverPublicKey: "",
    clientPrivateKey: "",
    clientPublicKey: "",
    serverAddress: "10.66.66.1/32",
    clientAddress: "10.66.66.2/32",
    dns: "1.1.1.1, 1.0.0.1",
    mtu: "1420",
    keepAlive: "25",
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

function validWireGuardKey(value: string): boolean {
  return /^[A-Za-z0-9+/]{43}=$/.test(value);
}

function validXrayWireGuardKey(value: string): boolean {
  const key = value.trim();
  if (/^[0-9a-f]{64}$/i.test(key)) return true;
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(key)) return false;
  try {
    const decoded = atob(key.replace(/-/g, "+").replace(/_/g, "/").padEnd(44, "="));
    return decoded.length === 32;
  } catch {
    return false;
  }
}

function validWireGuardEndpoint(value: string): boolean {
  const endpoint = value.trim();
  const match = endpoint.startsWith("[")
    ? endpoint.match(/^\[([^\]]+)]:(\d+)$/)
    : endpoint.match(/^([^\s:/]+):(\d+)$/);
  if (!match || !match[1].trim()) return false;
  const port = Number(match[2]);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function buildSecureInbound(
  preset: VlessInboundCreationPreset,
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

const xrayRoutingProtocols = ["http", "tls", "bittorrent", "quic"];

function RoutingFormRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="routing-compact-row">
    <span className="routing-compact-label">{label}{hint ? <span className="routing-field-help" title={hint} aria-label={`${label}说明`}>?</span> : null}</span>
    <div className="routing-compact-control">{children}</div>
  </div>;
}

function RoutingMultiSelect({ ariaLabel, values, options, onChange, placeholder }: {
  ariaLabel: string;
  values: string[];
  options: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [openAbove, setOpenAbove] = useState(false);
  const [optionsMaxHeight, setOptionsMaxHeight] = useState(220);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  const toggle = (option: string, checked: boolean) => {
    onChange(checked ? [...values, option] : values.filter((value) => value !== option));
  };

  const toggleOpen = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const root = rootRef.current?.getBoundingClientRect();
    const dialogBody = rootRef.current?.closest(".dialog-body")?.getBoundingClientRect();
    if (root && dialogBody) {
      const estimatedHeight = Math.min(220, Math.max(44, options.length * 34 + 12));
      const spaceBelow = Math.max(0, dialogBody.bottom - root.bottom - 6);
      const spaceAbove = Math.max(0, root.top - dialogBody.top - 6);
      const shouldOpenAbove = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
      setOpenAbove(shouldOpenAbove);
      setOptionsMaxHeight(Math.max(44, Math.min(220, shouldOpenAbove ? spaceAbove : spaceBelow)));
    } else {
      setOpenAbove(false);
      setOptionsMaxHeight(220);
    }
    setOpen(true);
  };

  return <div
    className={`routing-multi-select ${open ? "is-open" : ""} ${openAbove ? "opens-up" : ""}`}
    ref={rootRef}
    style={{ "--routing-options-max-height": `${optionsMaxHeight}px` } as CSSProperties}
  >
    <button ref={triggerRef} type="button" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={toggleOpen}>
      <span className={values.length ? "" : "is-placeholder"}>{values.length ? values.join(", ") : placeholder}</span>
      <ChevronDown size={15} />
    </button>
    {open ? <div className="routing-multi-options" role="listbox" aria-label={`${ariaLabel}选项`} aria-multiselectable="true">
      {options.length ? options.map((option) => <button key={option} type="button" role="option" aria-selected={values.includes(option)} onClick={() => toggle(option, !values.includes(option))}>
        <span className="routing-option-check" aria-hidden="true">{values.includes(option) ? <Check size={12} /> : null}</span>
        <span>{option}</span>
      </button>) : <small>暂无可选项</small>}
    </div> : null}
  </div>;
}

type OutboundEditorTab = "basics" | "json";

type OutboundEditorFields = {
  protocol: string;
  tag: string;
  sendThrough: string;
  address: string;
  port: string;
  id: string;
  email: string;
  password: string;
  method: string;
  encryption: string;
  flow: string;
  network: string;
  security: string;
  serverName: string;
  fingerprint: string;
  publicKey: string;
  shortId: string;
  spiderX: string;
  path: string;
  host: string;
  serviceName: string;
  responseType: string;
  domainStrategy: string;
  socksUser: string;
  socksPassword: string;
  secretKey: string;
  tunnelAddress: string;
  peerPublicKey: string;
  peerEndpoint: string;
  allowedIPs: string;
  keepAlive: string;
  mtu: string;
  xhttpMode: string;
  kcpMtu: string;
  kcpTti: string;
  kcpUplinkCapacity: string;
  kcpDownlinkCapacity: string;
  kcpCwndMultiplier: string;
  kcpMaxSendingWindow: string;
};

const xrayOutboundProtocols = [
  "freedom", "blackhole", "dns", "loopback", "socks", "http", "shadowsocks", "vless", "vmess", "trojan", "wireguard",
] as const;

// QUIC was removed from current Xray transport support. Reality is accepted
// only by the TCP/RAW, gRPC, and XHTTP stream implementations.
const xrayOutboundNetworks = ["tcp", "ws", "grpc", "httpupgrade", "xhttp", "kcp"];
const xrayRealityOutboundNetworks = ["tcp", "grpc", "xhttp"];
const xrayOutboundSecurities = ["none", "tls", "reality"];
const xrayVMessSecurities = ["auto", "aes-128-gcm", "chacha20-poly1305"];
const xrayVlessFlows = ["", "xtls-rprx-vision", "xtls-rprx-vision-udp443"];
const xrayShadowsocksMethods = [
  "2022-blake3-aes-128-gcm",
  "2022-blake3-aes-256-gcm",
  "2022-blake3-chacha20-poly1305",
  "aes-128-gcm",
  "aes-256-gcm",
  "chacha20-poly1305",
  "chacha20-ietf-poly1305",
  "xchacha20-poly1305",
  "xchacha20-ietf-poly1305",
];
const xrayFingerprints = ["chrome", "firefox", "safari", "ios", "android", "edge", "360", "qq", "random", "randomized", "unsafe"];

function xrayResourceEmails(resources: XrayResource[]): string[] {
  const emails = new Set<string>();
  const visit = (value: unknown, depth = 0) => {
    if (depth > 6 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (key === "email" && typeof nested === "string" && nested.trim()) emails.add(nested.trim());
      else visit(nested, depth + 1);
    }
  };
  resources.forEach((resource) => visit(resource));
  return [...emails].sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function outboundEditorDefaults(protocol = "freedom"): OutboundEditorFields {
  return {
    protocol, tag: "", sendThrough: "", address: "", port: "", id: "", email: "", password: "", method: "aes-128-gcm", encryption: "none", flow: "",
    network: "tcp", security: "none", serverName: "", fingerprint: "chrome", publicKey: "", shortId: "", spiderX: "/", path: "/", host: "", serviceName: "grpc", responseType: "none", domainStrategy: "AsIs",
    socksUser: "", socksPassword: "", secretKey: "", tunnelAddress: "", peerPublicKey: "", peerEndpoint: "", allowedIPs: "0.0.0.0/0, ::/0", keepAlive: "0", mtu: "1420",
    xhttpMode: "auto", kcpMtu: "1350", kcpTti: "20", kcpUplinkCapacity: "5", kcpDownlinkCapacity: "20", kcpCwndMultiplier: "1", kcpMaxSendingWindow: "2097152",
  };
}

function outboundNestedObject(resource: XrayResource, key: string): XrayResource {
  const value = resource[key];
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as XrayResource) } : {};
}

function outboundFirstServer(resource: XrayResource): XrayResource {
  const settings = outboundNestedObject(resource, "settings");
  const list = Array.isArray(settings.servers) ? settings.servers : [];
  return list[0] && typeof list[0] === "object" ? { ...(list[0] as XrayResource) } : {};
}

function outboundFirstVnext(resource: XrayResource): XrayResource {
  const settings = outboundNestedObject(resource, "settings");
  const list = Array.isArray(settings.vnext) ? settings.vnext : [];
  return list[0] && typeof list[0] === "object" ? { ...(list[0] as XrayResource) } : {};
}

function outboundFirstUser(resource: XrayResource): XrayResource {
  const target = outboundFirstVnext(resource);
  const users = Array.isArray(target.users) ? target.users : [];
  return users[0] && typeof users[0] === "object" ? { ...(users[0] as XrayResource) } : {};
}

function outboundEditorFieldsFrom(resource: XrayResource): OutboundEditorFields {
  const protocol = xrayResourceProtocol(resource).toLowerCase() || "freedom";
  const fields = outboundEditorDefaults(protocol);
  const settings = outboundNestedObject(resource, "settings");
  const server = outboundFirstServer(resource);
  const vnext = outboundFirstVnext(resource);
  const user = outboundFirstUser(resource);
  const stream = outboundNestedObject(resource, "streamSettings");
  const tls = outboundNestedObject(stream, "tlsSettings");
  const reality = outboundNestedObject(stream, "realitySettings");
  const ws = outboundNestedObject(stream, "wsSettings");
  const httpUpgrade = outboundNestedObject(stream, "httpupgradeSettings");
  const xhttp = outboundNestedObject(stream, "xhttpSettings");
  const grpc = outboundNestedObject(stream, "grpcSettings");
  const kcp = outboundNestedObject(stream, "kcpSettings");
  const wireguardPeers = Array.isArray(settings.peers) ? settings.peers : [];
  const peer = wireguardPeers[0] && typeof wireguardPeers[0] === "object" ? wireguardPeers[0] as XrayResource : {};
  const serverUsers = Array.isArray(server.users) ? server.users : [];
  const serverUser = serverUsers[0] && typeof serverUsers[0] === "object" ? serverUsers[0] as XrayResource : {};
  const read = (obj: XrayResource, key: string) => obj[key] === undefined || obj[key] === null ? "" : String(obj[key]);
  const arrayText = (value: unknown) => Array.isArray(value) ? value.map(String).join(", ") : value === undefined || value === null ? "" : String(value);
  const wsHeaders = ws.headers && typeof ws.headers === "object" && !Array.isArray(ws.headers) ? ws.headers as XrayResource : {};
  const legacyWSHost = Object.entries(wsHeaders).find(([key]) => key.toLowerCase() === "host")?.[1];
  const direct = settings.address !== undefined && settings.address !== null;
  const target = direct ? settings : protocol === "vless" || protocol === "vmess" ? vnext : server;
  const account = direct ? settings : protocol === "vless" || protocol === "vmess" ? user : server;
  return {
    ...fields,
    tag: xrayResourceTag(resource),
    sendThrough: read(resource, "sendThrough"),
    address: protocol === "loopback" ? read(settings, "inboundTag") : read(target, "address"),
    port: read(target, "port"),
    id: read(account, "id") || read(account, "password"),
    email: read(account, "email"),
    password: read(account, "password"),
    method: read(account, "method"),
    encryption: protocol === "vmess" ? read(account, "security") || "auto" : read(account, "encryption") || "none",
    flow: read(account, "flow"),
    network: protocol === "dns" ? read(settings, "network") || "tcp" : read(stream, "network") || "tcp",
    security: read(stream, "security") || "none",
    serverName: read(tls, "serverName") || read(reality, "serverName"),
    fingerprint: read(tls, "fingerprint") || read(reality, "fingerprint") || "chrome",
    publicKey: read(reality, "password") || read(reality, "publicKey"),
    shortId: read(reality, "shortId"),
    spiderX: read(reality, "spiderX") || "/",
    path: read(ws, "path") || read(httpUpgrade, "path") || read(xhttp, "path") || read(stream, "path") || "/",
    host: read(ws, "host") || read(httpUpgrade, "host") || read(xhttp, "host") || arrayText(legacyWSHost),
    serviceName: read(grpc, "serviceName") || "grpc",
    responseType: read(outboundNestedObject(settings, "response"), "type") || "none",
    domainStrategy: read(settings, "domainStrategy") || "AsIs",
    socksUser: direct ? read(settings, "user") : read(serverUser, "user"),
    socksPassword: direct ? read(settings, "pass") : read(serverUser, "pass"),
    secretKey: read(settings, "secretKey"),
    tunnelAddress: arrayText(settings.address),
    peerPublicKey: read(peer, "publicKey"),
    peerEndpoint: read(peer, "endpoint"),
    allowedIPs: arrayText(peer.allowedIPs) || fields.allowedIPs,
    keepAlive: read(peer, "keepAlive"),
    mtu: read(settings, "mtu"),
    xhttpMode: read(xhttp, "mode") || "auto",
    kcpMtu: read(kcp, "mtu") || fields.kcpMtu,
    kcpTti: read(kcp, "tti") || fields.kcpTti,
    kcpUplinkCapacity: read(kcp, "uplinkCapacity") || fields.kcpUplinkCapacity,
    kcpDownlinkCapacity: read(kcp, "downlinkCapacity") || fields.kcpDownlinkCapacity,
    kcpCwndMultiplier: read(kcp, "cwndMultiplier") || fields.kcpCwndMultiplier,
    kcpMaxSendingWindow: read(kcp, "maxSendingWindow") || fields.kcpMaxSendingWindow,
  };
}

function buildOutboundFromEditor(fields: OutboundEditorFields, draft: string): XrayResource {
  let parsed: XrayResource = {};
  try {
    const candidate = JSON.parse(draft) as unknown;
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) parsed = cleanXrayResource(candidate as XrayResource);
  } catch {
    throw new Error("出站高级 JSON 必须是有效的 JSON 对象");
  }
  const originalProtocol = typeof parsed.protocol === "string" ? parsed.protocol.trim().toLowerCase() : "";
  const protocol = fields.protocol.trim().toLowerCase();
  const tag = fields.tag.trim();
  if (!tag) throw new Error("Tag 不能为空");
  if (!protocol) throw new Error("协议不能为空");
  parsed.tag = tag;
  parsed.protocol = protocol;
  if (fields.sendThrough.trim()) parsed.sendThrough = fields.sendThrough.trim();
  else delete parsed.sendThrough;

  const protocolChanged = Boolean(originalProtocol && originalProtocol !== protocol);
  const settings = protocolChanged ? {} : outboundNestedObject(parsed, "settings");
  const stream = outboundNestedObject(parsed, "streamSettings");
  if (protocol === "freedom") {
    settings.domainStrategy = fields.domainStrategy || "AsIs";
    parsed.settings = settings;
    delete parsed.streamSettings;
    return parsed;
  }
  if (protocol === "blackhole") {
    if (fields.responseType && fields.responseType !== "none") settings.response = { type: fields.responseType };
    else delete settings.response;
    parsed.settings = settings;
    delete parsed.streamSettings;
    return parsed;
  }
  if (protocol === "dns") {
    if (fields.address.trim()) {
      settings.network = fields.network === "udp" ? "udp" : "tcp";
      settings.address = fields.address.trim();
    } else {
      delete settings.network;
      delete settings.address;
    }
    const parsedPort = Number(fields.port);
    if (Number.isInteger(parsedPort) && parsedPort > 0) settings.port = parsedPort;
    else delete settings.port;
    parsed.settings = settings;
    delete parsed.streamSettings;
    return parsed;
  }
  if (protocol === "loopback") {
    if (!fields.address.trim()) throw new Error("Loopback 需要填写入站 Tag");
    settings.inboundTag = fields.address.trim();
    parsed.settings = settings;
    delete parsed.streamSettings;
    return parsed;
  }
  if (protocol === "wireguard") {
    if (!validXrayWireGuardKey(fields.secretKey)) throw new Error("WireGuard Secret key 必须是有效的 32 字节密钥");
    if (!validXrayWireGuardKey(fields.peerPublicKey)) throw new Error("WireGuard Peer public key 必须是有效的 32 字节密钥");
    if (!validWireGuardEndpoint(fields.peerEndpoint)) throw new Error("WireGuard Peer endpoint 必须使用 host:port；IPv6 请使用 [address]:port");
    settings.secretKey = fields.secretKey.trim();
    const addresses = parseRoutingValues(fields.tunnelAddress);
    if (addresses.length) settings.address = addresses;
    else delete settings.address;
    const existingPeers = Array.isArray(settings.peers) ? settings.peers.filter((item): item is XrayResource => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
    const peer: XrayResource = { ...(existingPeers[0] ?? {}), publicKey: fields.peerPublicKey.trim(), endpoint: fields.peerEndpoint.trim() };
    const allowedIPs = parseRoutingValues(fields.allowedIPs);
    if (allowedIPs.length) peer.allowedIPs = allowedIPs;
    else delete peer.allowedIPs;
    const keepAlive = Number(fields.keepAlive);
    if (Number.isFinite(keepAlive) && keepAlive > 0) peer.keepAlive = keepAlive;
    else delete peer.keepAlive;
    settings.peers = [peer, ...existingPeers.slice(1)];
    const mtu = Number(fields.mtu);
    if (Number.isFinite(mtu) && mtu > 0) settings.mtu = mtu;
    else delete settings.mtu;
    parsed.settings = settings;
    delete parsed.streamSettings;
    return parsed;
  }

  const remoteProtocol = ["vless", "vmess"].includes(protocol);
  const directStyle = settings.address !== undefined && settings.address !== null;
  const existingVnext = !protocolChanged && Array.isArray(settings.vnext)
    ? settings.vnext.filter((item): item is XrayResource => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
  const existingServers = !protocolChanged && Array.isArray(settings.servers)
    ? settings.servers.filter((item): item is XrayResource => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
  const target: XrayResource = remoteProtocol ? { ...(existingVnext[0] ?? {}) } : { ...(existingServers[0] ?? {}) };
  if (!fields.address.trim()) throw new Error("目标地址不能为空");
  const parsedPort = Number(fields.port);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) throw new Error("目标端口必须在 1 到 65535 之间");
  target.address = fields.address.trim();
  target.port = parsedPort;
  if (remoteProtocol) {
    if (!fields.id.trim()) throw new Error(`${protocol.toUpperCase()} 需要填写 ID`);
    if (directStyle) {
      settings.address = fields.address.trim();
      settings.port = parsedPort;
      settings.id = fields.id.trim();
      if (fields.email.trim()) settings.email = fields.email.trim(); else delete settings.email;
      if (protocol === "vless") {
        settings.encryption = fields.encryption || "none";
        if (fields.flow.trim()) settings.flow = fields.flow.trim(); else delete settings.flow;
      } else {
        settings.security = fields.encryption || "auto";
        delete settings.flow;
      }
      delete settings.vnext;
    } else {
      const existingUsers = Array.isArray(target.users)
        ? target.users.filter((item): item is XrayResource => Boolean(item && typeof item === "object" && !Array.isArray(item)))
        : [];
      const outboundUser = { ...(existingUsers[0] ?? {}) };
      outboundUser.id = fields.id.trim();
      if (fields.email.trim()) outboundUser.email = fields.email.trim(); else delete outboundUser.email;
      if (protocol === "vless") {
        outboundUser.encryption = fields.encryption || "none";
        if (fields.flow.trim()) outboundUser.flow = fields.flow.trim(); else delete outboundUser.flow;
      } else {
        outboundUser.security = fields.encryption || "auto";
        delete outboundUser.flow;
      }
      target.users = [outboundUser, ...existingUsers.slice(1)];
      settings.vnext = [target, ...existingVnext.slice(1)];
    }
  } else {
    const destination = directStyle ? settings : target;
    destination.address = fields.address.trim();
    destination.port = parsedPort;
    if (protocol === "shadowsocks") {
      destination.method = fields.method.trim() || "aes-128-gcm";
      destination.password = fields.password.trim();
      if (!destination.password) throw new Error("Shadowsocks 需要填写密码");
    } else if (protocol === "trojan") {
      destination.password = fields.password.trim();
      if (!destination.password) throw new Error("Trojan 需要填写密码");
      if (fields.email.trim()) destination.email = fields.email.trim(); else delete destination.email;
      delete destination.flow;
    } else if (protocol === "socks" || protocol === "http") {
      if (directStyle) {
        if (fields.socksUser.trim()) destination.user = fields.socksUser.trim(); else delete destination.user;
        if (fields.socksPassword.trim()) destination.pass = fields.socksPassword.trim(); else delete destination.pass;
      } else if (fields.socksUser.trim() || fields.socksPassword.trim()) {
        const existingUsers = Array.isArray(target.users) ? target.users : [];
        const existingUser = existingUsers[0] && typeof existingUsers[0] === "object" ? existingUsers[0] as XrayResource : {};
        target.users = [{ ...existingUser, user: fields.socksUser.trim(), pass: fields.socksPassword.trim() }, ...existingUsers.slice(1)];
      } else delete target.users;
    }
    if (directStyle) delete settings.servers;
    else settings.servers = [target, ...existingServers.slice(1)];
  }
  parsed.settings = settings;
  stream.network = fields.network || "tcp";
  stream.security = fields.security || "none";
  if (stream.security === "reality") {
    if (!xrayRealityOutboundNetworks.includes(String(stream.network))) throw new Error("Reality 仅支持 TCP、gRPC 或 XHTTP 传输");
    if (!validRealityKey(fields.publicKey.trim())) throw new Error("Reality Public key 必须是有效的 43 位 X25519 公钥");
    if (fields.shortId.trim() && (!/^[0-9a-f]{2,16}$/i.test(fields.shortId.trim()) || fields.shortId.trim().length % 2 !== 0)) throw new Error("Reality Short ID 必须是 2 到 16 位偶数长度十六进制");
  }
  const writePathHostTransport = (key: "wsSettings" | "httpupgradeSettings" | "xhttpSettings") => {
    const transport = outboundNestedObject(stream, key);
    const headers = outboundNestedObject(transport, "headers");
    for (const key of Object.keys(headers)) if (key.toLowerCase() === "host") delete headers[key];
    transport.path = fields.path || "/";
    if (fields.host.trim()) transport.host = fields.host.trim(); else delete transport.host;
    if (Object.keys(headers).length) transport.headers = headers; else delete transport.headers;
    if (key === "xhttpSettings") transport.mode = fields.xhttpMode || "auto";
    stream[key] = transport;
  };
  if (stream.network === "ws") writePathHostTransport("wsSettings");
  else delete stream.wsSettings;
  if (stream.network === "httpupgrade") writePathHostTransport("httpupgradeSettings");
  else delete stream.httpupgradeSettings;
  if (stream.network === "xhttp") writePathHostTransport("xhttpSettings");
  else delete stream.xhttpSettings;
  if (stream.network === "grpc") stream.grpcSettings = { ...(outboundNestedObject(stream, "grpcSettings")), serviceName: fields.serviceName || "grpc" };
  else delete stream.grpcSettings;
  if (stream.network === "kcp") {
    const kcpSettings = outboundNestedObject(stream, "kcpSettings");
    const setKCPNumber = (key: string, value: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER) => {
      const parsedValue = Number(value);
      if (!Number.isInteger(parsedValue) || parsedValue < minimum || parsedValue > maximum) throw new Error(`mKCP ${key} 参数无效`);
      kcpSettings[key] = parsedValue;
    };
    setKCPNumber("mtu", fields.kcpMtu, 576, 1460);
    setKCPNumber("tti", fields.kcpTti, 10, 1000);
    setKCPNumber("uplinkCapacity", fields.kcpUplinkCapacity, 0);
    setKCPNumber("downlinkCapacity", fields.kcpDownlinkCapacity, 0);
    setKCPNumber("cwndMultiplier", fields.kcpCwndMultiplier, 1);
    setKCPNumber("maxSendingWindow", fields.kcpMaxSendingWindow, 0);
    delete kcpSettings.header;
    delete kcpSettings.seed;
    stream.kcpSettings = kcpSettings;
  } else delete stream.kcpSettings;
  if (stream.security === "tls") stream.tlsSettings = { ...(outboundNestedObject(stream, "tlsSettings")), serverName: fields.serverName || fields.address, fingerprint: fields.fingerprint || "chrome" };
  else delete stream.tlsSettings;
  if (stream.security === "reality") {
    const spiderX = fields.spiderX || "/";
    if (!spiderX.startsWith("/")) throw new Error("Reality Spider X 必须以 / 开头");
    const realitySettings: XrayResource = { ...(outboundNestedObject(stream, "realitySettings")), serverName: fields.serverName || fields.address, password: fields.publicKey.trim(), shortId: fields.shortId.trim(), fingerprint: fields.fingerprint || "chrome", spiderX };
    delete realitySettings.publicKey;
    stream.realitySettings = realitySettings;
  } else delete stream.realitySettings;
  parsed.streamSettings = stream;
  return parsed;
}

function outboundTargetSummary(resource: XrayResource): string {
  const protocol = xrayResourceProtocol(resource).toLowerCase();
  const settings = outboundNestedObject(resource, "settings");
  if (protocol === "freedom") return String(settings.domainStrategy || "AsIs");
  if (protocol === "blackhole") return "拒绝流量";
  if (protocol === "dns") {
    const address = String(settings.address || "系统 DNS");
    return settings.port ? `${address}:${String(settings.port)}` : address;
  }
  if (protocol === "loopback") return String(settings.inboundTag || "未指定入站");
  if (protocol === "wireguard") {
    const peers = Array.isArray(settings.peers) ? settings.peers : [];
    const peer = peers[0] && typeof peers[0] === "object" ? peers[0] as XrayResource : {};
    return String(peer.endpoint || "WireGuard peer");
  }
  const direct = settings.address !== undefined && settings.address !== null;
  const target = direct ? settings : protocol === "vless" || protocol === "vmess" ? outboundFirstVnext(resource) : outboundFirstServer(resource);
  const address = String(target.address || "未配置地址");
  return target.port ? `${address}:${String(target.port)}` : address;
}

function outboundTransportSummary(resource: XrayResource): { network: string; security: string } {
  const protocol = xrayResourceProtocol(resource).toLowerCase();
  const settings = outboundNestedObject(resource, "settings");
  const stream = outboundNestedObject(resource, "streamSettings");
  return {
    network: String(protocol === "dns" ? settings.network || "tcp" : stream.network || "tcp").toUpperCase(),
    security: String(stream.security || "none").toUpperCase(),
  };
}

export function ServicesWorkbenchPage({ notify }: { notify: Notify }) {
  const [servers, setServers] = useState<ManagedServer[]>([]);
  const [serviceStatuses, setServiceStatuses] = useState<Record<number, CachedServiceStatus>>({});
  const [agentVersions, setAgentVersions] = useState<Record<number, CachedAgentVersion>>({});
  const [dashboardConnected, setDashboardConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [view, setView] = useState<ViewMode>(() => localStorage.getItem("arcway-services-view") === "list" ? "list" : "cards");
  const [selected, setSelected] = useState<number[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [sharedOpen, setSharedOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedServer | null>(null);
  const [details, setDetails] = useState<{ server: ManagedServer; initialTab: OperationTab } | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [credentialsLoading, setCredentialsLoading] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<ManagedServer | null>(null);
  const [deleteWorking, setDeleteWorking] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteRefreshVersion, setDeleteRefreshVersion] = useState(0);
  const [upgrade, setUpgrade] = useState<UpgradeState | null>(null);
  const [upgradeConfirm, setUpgradeConfirm] = useState<AgentUpgradeCandidate[] | null>(null);
  const [quickWorking, setQuickWorking] = useState<{ serverId: number; action: XrayQuickAction } | null>(null);
  const [quickConfirm, setQuickConfirm] = useState<QuickXrayConfirmation | null>(null);
  const [quickTerminal, setQuickTerminal] = useState<ServiceTerminalState | null>(null);
  const serverListRefresh = useRef<Promise<void> | null>(null);
  const serviceRefreshes = useRef(new Set<number>());

  const load = useCallback(async (quiet = false) => {
    const inFlight = serverListRefresh.current;
    if (inFlight) {
      if (!quiet) await inFlight;
      return;
    }

    const refresh = (async () => {
      if (!quiet) {
        setLoading(true);
        setError("");
      }
      try {
        const response = assertSuccess(await api.get<ServerListResponse>("/api/admin/remote-servers"), "服务器列表加载失败");
        setServers((response.servers ?? []) as ManagedServer[]);
        setSelected((current) => current.filter((id) => (response.servers ?? []).some((server) => server.id === id)));
      } catch (reason) {
        if (!quiet) setError(messageFrom(reason, "服务器列表加载失败"));
      } finally {
        if (!quiet) setLoading(false);
      }
    })();
    serverListRefresh.current = refresh;
    try {
      await refresh;
    } finally {
      if (serverListRefresh.current === refresh) serverListRefresh.current = null;
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const refreshServiceStatuses = useCallback(async (serverIDs: number[]) => {
    const targets = [...new Set(serverIDs)].filter((id) => !serviceRefreshes.current.has(id));
    if (!targets.length) return;
    for (const id of targets) serviceRefreshes.current.add(id);
    setServiceStatuses((current) => {
      const next = { ...current };
      for (const id of targets) {
        const previous = current[id];
        next[id] = { ...previous, loading: !previous?.loaded, loaded: previous?.loaded ?? false };
      }
      return next;
    });
    try {
      const results = await Promise.all(targets.map(async (id) => {
        try {
          const status = assertSuccess(await api.get<ServiceStatusResponse>(`/api/admin/remote/services/status?server_id=${id}`), "读取服务状态失败");
          return { id, status };
        } catch {
          return { id, status: null };
        }
      }));
      setServiceStatuses((current) => {
        const next = { ...current };
        for (const result of results) {
          const previous = current[result.id];
          next[result.id] = result.status
            ? { ...result.status, loading: false, loaded: true }
            : { ...previous, loading: false, loaded: previous?.loaded ?? false };
        }
        return next;
      });
    } finally {
      for (const id of targets) serviceRefreshes.current.delete(id);
    }
  }, []);

  const refreshAgentVersions = useCallback(async (serverIDs: number[]) => {
    if (!serverIDs.length) return;
    setAgentVersions((current) => {
      const next = { ...current };
      for (const id of serverIDs) {
        const previous = current[id];
        next[id] = { ...previous, loading: !previous?.loaded, loaded: previous?.loaded ?? false };
      }
      return next;
    });
    const results = await Promise.all(serverIDs.map(async (id) => {
      try {
        return { id, version: await api.get<AgentVersionResponse>(`/api/admin/remote/agent/version-info?server_id=${id}`) };
      } catch {
        return { id, version: null };
      }
    }));
    setAgentVersions((current) => {
      const next = { ...current };
      for (const result of results) {
        const previous = current[result.id];
        next[result.id] = result.version
          ? { ...result.version, loading: false, loaded: true }
          : { ...previous, loading: false, loaded: previous?.loaded ?? false };
      }
      return next;
    });
  }, []);

  useEffect(() => openDashboardSocket((payload) => {
    const message = payload as RealtimeMessage;
    if (message.type === "realtime" && message.servers) {
      setServers(message.servers as ManagedServer[]);
      return;
    }
    if (message.type === "server-status" && message.serverId && message.services?.success !== false) {
      setServiceStatuses((current) => ({
        ...current,
        [message.serverId as number]: {
          xray: message.services?.xray,
          nginx: message.services?.nginx,
          loading: false,
          loaded: true,
        },
      }));
    }
  }, {
    onOpen: () => setDashboardConnected(true),
    onClose: () => setDashboardConnected(false),
  }), []);

  useEffect(() => {
    if (dashboardConnected) return;
    const timer = window.setInterval(() => { void load(true); }, serviceManagementRefreshIntervalMs);
    return () => window.clearInterval(timer);
  }, [dashboardConnected, load]);

  const connectedKey = servers.filter(isConnected).map((server) => server.id).sort((a, b) => a - b).join(",");
  const fallbackStatusKey = servers
    .filter((server) => isConnected(server) && (!dashboardConnected || !server.ws_connected))
    .map((server) => server.id)
    .sort((a, b) => a - b)
    .join(",");
  const versionTargetKey = servers
    .filter((server) => isConnected(server) && !server.is_federated)
    .map((server) => server.id)
    .sort((a, b) => a - b)
    .join(",");

  useEffect(() => {
    const connectedIDs = connectedKey.split(",").map(Number).filter(Boolean);
    const connectedSet = new Set(connectedIDs);
    setServiceStatuses((current) => Object.fromEntries(Object.entries(current).filter(([id]) => connectedSet.has(Number(id)))));
    if (!connectedIDs.length) return;
    void refreshServiceStatuses(connectedIDs);
  }, [connectedKey, refreshServiceStatuses]);

  useEffect(() => {
    const fallbackIDs = fallbackStatusKey.split(",").map(Number).filter(Boolean);
    if (!fallbackIDs.length) return;
    const timer = window.setInterval(() => { void refreshServiceStatuses(fallbackIDs); }, serviceManagementRefreshIntervalMs);
    return () => window.clearInterval(timer);
  }, [fallbackStatusKey, refreshServiceStatuses]);

  useEffect(() => {
    const targetIDs = versionTargetKey.split(",").map(Number).filter(Boolean);
    const targetSet = new Set(targetIDs);
    setAgentVersions((current) => Object.fromEntries(Object.entries(current).filter(([id]) => targetSet.has(Number(id)))));
    if (!targetIDs.length) return;
    void refreshAgentVersions(targetIDs);
    const timer = window.setInterval(() => { void refreshAgentVersions(targetIDs); }, 10 * 60_000);
    return () => window.clearInterval(timer);
  }, [refreshAgentVersions, versionTargetKey]);

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
  const onlineOwned = online.filter((server) => !server.is_federated);
  const selectedOnline = servers.filter((server) => selected.includes(server.id) && isConnected(server) && !server.is_federated);
  const hasSelection = selected.length > 0;
  const upgradePool = hasSelection ? selectedOnline : onlineOwned;
  const upgradeTargets = upgradePool.filter((server) => canUpgradeAgent(agentVersions[server.id]));
  const allTargetVersionsCurrent = upgradePool.length > 0 && upgradePool.every((server) => agentVersionIsCurrent(agentVersions[server.id]));
  const upgradeLabel = hasSelection
    ? `升级选中 Agent (${upgradeTargets.length}/${selected.length})`
    : upgradeTargets.length
      ? `批量升级 Agent (${upgradeTargets.length})`
      : allTargetVersionsCurrent ? "Agent 已是最新版" : "暂无可用 Agent 更新";

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

  const openDeleteServer = (server: ManagedServer) => {
    setDeleting(server);
    setDeleteError("");
    setDeleteRefreshVersion(0);
  };

  const closeDeleteServer = () => {
    if (deleteWorking) return;
    setDeleting(null);
    setDeleteError("");
    setDeleteRefreshVersion(0);
  };

  const deleteServer = async (shared = Boolean(deleting?.is_federated)) => {
    if (!deleting) return;
    setDeleteWorking(true);
    setDeleteError("");
    try {
      const payload = shared ? { id: deleting.id } : { id: deleting.id, uninstall_agent: true };
      const response = assertSuccess(await api.post<ActionResponse>("/api/admin/remote-servers/delete", payload), "删除服务器失败");
      notify(response.message || (shared ? `已解除 ${deleting.name} 的共享接入` : `已卸载 ${deleting.name} 的 Agent 并删除关联数据`));
      setDeleting(null);
      setDeleteError("");
      setDeleteRefreshVersion(0);
      await load();
    } catch (reason) {
      const message = messageFrom(reason, "删除服务器失败");
      setDeleteError(message);
      setDeleteRefreshVersion((version) => version + 1);
      notify(message, "error");
    } finally {
      setDeleteWorking(false);
    }
  };

  const requestAgentUpgrade = (targets: ManagedServer[], overrideVersion?: AgentVersionResponse) => {
    const candidates = targets.flatMap((server) => {
      const cachedVersion = agentVersions[server.id];
      const usesOverride = Boolean(overrideVersion && targets.length === 1);
      const version = usesOverride ? overrideVersion : cachedVersion;
      if (!version?.upgrade_available || (!usesOverride && !canUpgradeAgent(cachedVersion))) return [];
      const latest = cleanVersion(version.latest);
      if (!latest || version.latest_error) return [];
      return [{ server, current: cleanVersion(version.current) || "未知", latest }];
    });
    if (!candidates.length) {
      notify("没有检测到可用的 Agent 更新", "error");
      return;
    }
    setUpgradeConfirm(candidates);
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
        const response = await requestStream(`/api/admin/remote/agent/upgrade-stream?server_id=${server.id}`, {
          method: "POST",
          headers: { Accept: "text/event-stream" },
        });
        let liveOutput = "";
        const result = await consumeRemoteServiceStream(response, (output) => {
          liveOutput += `${liveOutput && !liveOutput.endsWith("\n") ? "\n" : ""}${output}${output.endsWith("\n") ? "" : "\n"}`;
          setUpgrade({ ...state, current: index, done, failed, logs: [...logs, `${server.name}\n${liveOutput}`], running: true });
        });
        logs.push(`${server.name}\n${liveOutput}${liveOutput && !liveOutput.endsWith("\n") ? "\n" : ""}[完成] ${result}`);
        done++;
      } catch (reason) {
        logs.push(`${server.name}\n[失败] ${messageFrom(reason, "升级失败")}`);
        failed++;
      }
    }
    setUpgrade({ ...state, current: targets.length, done, failed, logs, running: false });
    notify(failed ? `Agent 升级完成：${done} 成功，${failed} 失败` : `${done} 台 Agent 已完成升级`, failed ? "error" : "success");
    await Promise.all([load(true), refreshAgentVersions(targets.map((server) => server.id))]);
  };

  const executeXrayAction = async (server: ManagedServer, action: XrayQuickAction, version?: string) => {
    const actionLabel = action === "install" ? "安装" : action === "update" ? "更新" : action === "start" ? "开启" : action === "stop" ? "暂停" : "重启";
    const streamed = action === "install" || action === "update";
    let streamCompleted = false;
    setQuickWorking({ serverId: server.id, action });
    setQuickConfirm(null);
    if (streamed) {
      setQuickTerminal({
        title: `${actionLabel} Xray`,
        description: `${server.name} · 远端实时执行日志`,
        output: `正在连接 ${server.name}...\n`,
        running: true,
        outcome: "running",
      });
    }
    try {
      if (streamed) {
        const response = await requestStream(`/api/admin/remote/xray/install-stream?server_id=${server.id}`, {
          method: "POST",
          headers: { Accept: "text/event-stream" },
          body: action === "update" && version ? JSON.stringify({ version }) : undefined,
        });
        const completionMessage = await consumeRemoteServiceStream(response, (output) => {
          setQuickTerminal((current) => current ? {
            ...current,
            output: `${current.output}${current.output.endsWith("\n") ? "" : "\n"}${output}${output.endsWith("\n") ? "" : "\n"}`,
          } : current);
        });
        streamCompleted = true;
        setQuickTerminal((current) => current ? {
          ...current,
          output: `${current.output}${current.output.endsWith("\n") ? "" : "\n"}[完成] ${completionMessage}\n`,
          running: false,
          outcome: "success",
        } : current);
      } else {
        assertSuccess(await api.post<ActionResponse>(`/api/admin/remote/services/control?server_id=${server.id}`, { service: "xray", action }), `Xray ${actionLabel}失败`);
      }
      notify(`Xray ${actionLabel}完成`);
      await Promise.all([refreshServiceStatuses([server.id]), load(true)]);
    } catch (reason) {
      const message = messageFrom(reason, `Xray ${actionLabel}失败`);
      if (streamed && !streamCompleted) {
        setQuickTerminal((current) => current ? {
          ...current,
          output: `${current.output}${current.output.endsWith("\n") ? "" : "\n"}[失败] ${message}\n`,
          running: false,
          outcome: "error",
        } : current);
      }
      notify(message, "error");
    } finally {
      setQuickWorking(null);
    }
  };

  const requestXrayAction = (server: ManagedServer, action: XrayQuickAction) => {
    if (!isConnected(server)) {
      notify(`${server.name} 的 Agent 当前离线`, "error");
      return;
    }
    if (server.is_federated) {
      notify("共享服务器只能查看 Xray 状态", "error");
      return;
    }
    if (action === "stop" || action === "update") {
      setQuickConfirm({ server, action });
      return;
    }
    void executeXrayAction(server, action);
  };

  const detailsServer = details ? servers.find((server) => server.id === details.server.id) ?? details.server : null;

  return (
    <div className="services-workbench">
      <PageHeader
        eyebrow="Infrastructure"
        title="服务管理"
        description={`${servers.length} 台服务器 · ${online.length} 台在线 · ${servers.length - online.length} 台离线`}
        actions={<>
          <IconButton label="刷新服务器" onClick={() => void load()} disabled={loading}><RefreshCw size={18} /></IconButton>
          <Button variant="secondary" title={upgradeTargets.length ? `检测到 ${upgradeTargets.length} 台 Agent 可升级` : allTargetVersionsCurrent ? "目标 Agent 均已是最新版" : "未检测到可用的新版本"} onClick={() => requestAgentUpgrade(upgradeTargets)} disabled={!upgradeTargets.length || Boolean(upgrade?.running)}><UploadCloud size={17} />{upgradeLabel}</Button>
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
        <span className={`services-live-state ${dashboardConnected ? "is-live" : "is-fallback"}`} title={dashboardConnected ? "服务器、速率和流量由控制端实时推送" : "实时通道重连中，当前使用 15 秒回退刷新"}><i />{dashboardConnected ? "实时同步" : "回退刷新"}</span>
        <div className="services-view-switch" role="group" aria-label="服务视图">
          <IconButton className={view === "cards" ? "is-active" : ""} label="卡片视图" onClick={() => changeView("cards")}><Grid2X2 size={17} /></IconButton>
          <IconButton className={view === "list" ? "is-active" : ""} label="列表视图" onClick={() => changeView("list")}><List size={18} /></IconButton>
        </div>
      </Surface>

      {loading ? <Surface className="center-state"><Spinner label="正在加载服务器" /></Surface> : visible.length === 0 ? (
        <Surface><EmptyState icon={<Server size={24} />} title={servers.length ? "没有匹配的服务器" : "尚未接入服务器"} description={servers.length ? "调整搜索词或状态筛选" : "创建服务器后会得到 Agent 安装命令"} action={!servers.length ? <Button onClick={() => setCreateOpen(true)}><Plus size={16} />添加服务器</Button> : undefined} /></Surface>
      ) : view === "cards" ? (
        <div className="services-card-grid">
          {visible.map((server, index) => <ServerCard
            key={server.id}
            server={server}
            serviceStatus={serviceStatuses[server.id]}
            agentVersion={agentVersions[server.id]}
            checked={selected.includes(server.id)}
            credentialsLoading={credentialsLoading === server.id}
            xrayWorking={quickWorking?.serverId === server.id}
            agentWorking={Boolean(upgrade?.running && upgrade.serverIDs.includes(server.id))}
            style={{ "--service-card-index": Math.min(index, 8) } as CSSProperties}
            onCheck={(checked) => setSelected((current) => checked ? [...new Set([...current, server.id])] : current.filter((id) => id !== server.id))}
            onOpen={(initialTab) => setDetails({ server, initialTab })}
            onXrayAction={(action) => requestXrayAction(server, action)}
            onAgentUpgrade={() => requestAgentUpgrade([server])}
            onEdit={() => setEditing(server)}
            onCredentials={() => void revealCredentials(server)}
            onDelete={() => openDeleteServer(server)}
          />)}
        </div>
      ) : (
        <ServerTable servers={visible} serviceStatuses={serviceStatuses} agentVersions={agentVersions} selected={selected} credentialsLoading={credentialsLoading} quickWorking={quickWorking} upgrade={upgrade} onSelect={setSelected} onOpen={(server) => setDetails({ server, initialTab: "overview" })} onXrayAction={requestXrayAction} onAgentUpgrade={(server) => requestAgentUpgrade([server])} onEdit={setEditing} onCredentials={(server) => void revealCredentials(server)} onDelete={openDeleteServer} />
      )}

      {createOpen ? <CreateServerDialog onClose={() => setCreateOpen(false)} onCreated={async (result) => { setCreateOpen(false); await load(); if (result.server && result.install_command) setCredentials({ server: result.server, token: result.server.token ?? "", pullToken: result.server.pull_token ?? "", agentToken: result.server.agent_token ?? "", command: result.install_command }); notify("服务器已创建"); }} /> : null}
      {sharedOpen ? <AddSharedServerDialog onClose={() => setSharedOpen(false)} onCreated={async () => { setSharedOpen(false); notify("共享服务器已接入"); await load(); }} /> : null}
      {editing ? <EditServerDialog server={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); notify("服务器设置已保存"); await load(); }} /> : null}
      {details && detailsServer ? <ServerOperationsDialog key={`${details.server.id}-${details.initialTab}`} server={detailsServer} initialTab={details.initialTab} notify={notify} onClose={() => setDetails(null)} onChanged={() => load(true)} onUpgrade={(version) => requestAgentUpgrade([detailsServer], version)} /> : null}
      {credentials ? <CredentialsDialog value={credentials} notify={notify} onClose={() => setCredentials(null)} /> : null}
      {deleting ? <DeleteServerDialog server={deleting} working={deleteWorking} error={deleteError} refreshVersion={deleteRefreshVersion} onCancel={closeDeleteServer} onConfirm={(shared) => void deleteServer(shared)} /> : null}
      {upgradeConfirm ? <ConfirmDialog title="升级 Agent" description={upgradeConfirm.length === 1 ? `${upgradeConfirm[0].server.name} 将从 ${upgradeConfirm[0].current === "未知" ? "未知版本" : `v${upgradeConfirm[0].current}`} 升级到 v${upgradeConfirm[0].latest}。升级期间 Agent 会短暂重启。` : `将把 ${upgradeConfirm.length} 台 Agent 升级到 ${[...new Set(upgradeConfirm.map((candidate) => `v${candidate.latest}`))].join("、")}。升级期间 Agent 会依次短暂重启。`} confirmLabel="确认升级" tone="primary" onCancel={() => setUpgradeConfirm(null)} onConfirm={() => { const targets = upgradeConfirm.map((candidate) => candidate.server); setUpgradeConfirm(null); void runUpgrade(targets); }} /> : null}
      {upgrade ? <UpgradeDialog state={upgrade} servers={servers} onClose={() => !upgrade.running && setUpgrade(null)} /> : null}
      {quickConfirm?.action === "update" ? <XrayVersionDialog server={quickConfirm.server} currentVersion={serviceStatuses[quickConfirm.server.id]?.xray?.version || quickConfirm.server.xray_version} working={Boolean(quickWorking)} onCancel={() => !quickWorking && setQuickConfirm(null)} onConfirm={(version) => void executeXrayAction(quickConfirm.server, "update", version)} /> : null}
      {quickConfirm?.action === "stop" ? <ConfirmDialog title="暂停 Xray" description={`暂停 ${quickConfirm.server.name} 上的 Xray 会立即中断由它承载的连接。`} confirmLabel="确认暂停" working={Boolean(quickWorking)} onCancel={() => !quickWorking && setQuickConfirm(null)} onConfirm={() => void executeXrayAction(quickConfirm.server, "stop")} /> : null}
      {quickTerminal ? <RemoteServiceTerminalDialog terminal={quickTerminal} onClose={() => !quickTerminal.running && setQuickTerminal(null)} /> : null}
    </div>
  );
}

function DeleteServerDialog({ server, working, error, refreshVersion, onCancel, onConfirm }: {
  server: ManagedServer;
  working: boolean;
  error: string;
  refreshVersion: number;
  onCancel: () => void;
  onConfirm: (shared: boolean) => void;
}) {
  const [impact, setImpact] = useState<DeleteImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(true);
  const [impactError, setImpactError] = useState("");
  const [impactReload, setImpactReload] = useState(0);

  useEffect(() => {
    let current = true;
    setImpactLoading(true);
    setImpactError("");
    void api.get<DeleteImpactResponse>(`/api/admin/remote-servers/delete-impact?server_id=${server.id}`)
      .then((response) => {
        if (!current) return;
        const checked = assertSuccess(response, "读取删除影响失败");
        setImpact(checked.impact ?? checked);
      })
      .catch((reason) => {
        if (!current) return;
        setImpact(null);
        setImpactError(messageFrom(reason, "无法核对删除范围"));
      })
      .finally(() => {
        if (current) setImpactLoading(false);
      });
    return () => { current = false; };
  }, [impactReload, refreshVersion, server.id]);

  const ownership = impact?.server?.ownership ?? (server.is_federated ? "shared" : "owned");
  const shared = ownership === "shared";
  const online = impact?.server?.online ?? isConnected(server);
  const uninstallSupport = impact?.server?.agent_uninstall_v2 ?? server.agent_uninstall_v2;
  const xrayMode = impact?.server?.xray_mode ?? server.xray_mode;
  const taskStatus = impact?.deletion_task?.status;
  const remoteAlreadyUninstalled = taskStatus === "agent_uninstalled";
  const taskAlreadyRunning = taskStatus === "pending" || taskStatus === "dispatched";
  const capabilityBlocker = impact?.blocker
    || (!shared && !remoteAlreadyUninstalled && !taskAlreadyRunning
      ? !online
        ? "Agent 当前离线，无法安全完成删除。请先恢复 Agent 在线后重试。"
        : uninstallSupport === false
          ? "当前 Agent 版本或运行环境不支持安全卸载。请先升级 Agent 或修复运行环境后重试。"
          : ""
      : "");
  const confirmDisabled = working || impactLoading || Boolean(impactError) || Boolean(capabilityBlocker);
  const counts = impact?.counts;
  const trafficCount = typeof counts?.stat_records === "number" ? counts.stat_records : sumKnownCounts(counts, [
    "node_traffic", "user_traffic", "user_email_traffic", "traffic_snapshots", "node_traffic_snapshots",
    "user_traffic_snapshots", "system_traffic_snapshots",
  ]);
  const batchCount = sumKnownCounts(counts, ["batch_inbounds", "batch_outbounds"]);
  const displayedCount = sumNumbers([
    counts?.nodes, counts?.subaccounts, counts?.inbound_configs, counts?.outbounds,
    counts?.xray_snapshots, batchCount, trafficCount,
  ]);
  const otherCount = typeof counts?.total === "number"
    ? Math.max(0, counts.total - displayedCount)
    : undefined;
  const metrics: Array<[string, number | undefined]> = [
    ["节点", counts?.nodes],
    ["节点子账号", counts?.subaccounts],
    ["入站", counts?.inbound_configs],
    ["出站", counts?.outbounds],
    ["配置快照", counts?.xray_snapshots],
    ["批量记录", batchCount],
    ["流量与统计", trafficCount],
    ["其他关联", otherCount],
  ];
  const taskMessage = impact?.deletion_task?.retry_message || impact?.deletion_task?.message || impact?.deletion_task?.last_error;
  const confirmLabel = shared
    ? "解除共享接入"
    : taskStatus === "agent_uninstalled"
      ? "完成删除"
      : taskStatus === "failed"
        ? "重新卸载并删除"
        : taskStatus === "pending" || taskStatus === "dispatched"
          ? "继续等待并删除"
          : "卸载 Agent 并删除";

  return (
    <Dialog
      title={shared ? "解除共享接入" : "删除服务器"}
      description={shared ? "仅解除当前控制端与共享服务器的关联。" : "将卸载远端 Agent，并永久删除控制端关联数据。"}
      onClose={onCancel}
      dismissible={!working}
      wide
    >
      <div className={`service-delete-summary ${shared ? "is-shared" : ""}`}>
        <span>{shared ? <Cloud size={22} /> : <TriangleAlert size={22} />}</span>
        <div>
          <strong>{shared ? `解除“${server.name}”的共享接入` : `永久删除“${server.name}”`}</strong>
          <p>{shared ? "本地的共享映射与关联数据将被移除，服务器拥有方及远端服务不会受到影响。" : "此操作会先安全卸载 Arcway Agent；只有远端确认完成后，控制端才会删除关联记录。"}</p>
        </div>
      </div>

      <section className="service-delete-impact" aria-label="删除影响预览">
        <div className="service-delete-section-head">
          <span><Trash2 size={16} /><strong>控制端将永久删除</strong></span>
          {impactLoading ? <Spinner label="正在核对删除范围" /> : impactError ? <Button type="button" variant="ghost" onClick={() => setImpactReload((version) => version + 1)}><RefreshCw size={14} />重新核对</Button> : <small>{typeof counts?.total === "number" ? `共 ${counts.total} 条关联数据` : "影响范围已核对"}</small>}
        </div>
        {impactError ? <div className="service-delete-preview-error" role="alert"><TriangleAlert size={16} /><span><strong>无法读取删除影响</strong><small>{impactError}</small></span></div> : (
          <div className={`service-delete-metrics ${impactLoading ? "is-loading" : ""}`} aria-busy={impactLoading}>
            {metrics.map(([label, value]) => <span key={label}><strong>{impactLoading ? "·" : formatImpactCount(value)}</strong><small>{label}</small></span>)}
          </div>
        )}
      </section>

      {!shared ? <>
        <div className="service-delete-scope-grid">
          <section className="service-delete-scope is-cleaned">
            <span><TerminalSquare size={18} /></span>
            <div><strong>远端将清理</strong><ul><li>Arcway Agent 与到期守护服务</li><li>WARP 及 Agent 管理的出站</li><li>Arcway 创建的防火墙与端口规则</li></ul></div>
          </section>
          <section className="service-delete-scope is-preserved">
            <span><ShieldCheck size={18} /></span>
            <div><strong>远端将保留</strong><ul><li>Xray 与 Nginx 程序</li><li>证书文件</li><li>Xray/Nginx 配置与其他非 Arcway 数据</li></ul></div>
          </section>
        </div>

        <div className="service-delete-runtime-note" role="note">
          <TriangleAlert size={16} />
          <span>{xrayMode === "embedded" ? "当前为内置 Xray：卸载 Agent 后代理服务会停止，现有连接将中断，但 Xray 配置文件仍会保留。" : "当前为外置 Xray：卸载 Agent 不会停止 Xray，它仍可能继续监听并提供代理服务。"}</span>
        </div>
      </> : <div className="service-delete-shared-note"><Network size={17} /><span><strong>远端保持原状</strong><small>不会卸载服务器拥有方的 Agent，也不会修改其 Xray、Nginx、防火墙或证书。</small></span></div>}

      {!shared && taskStatus ? <div className={`service-delete-task-status is-${taskStatus}`} role="status">
        {taskStatus === "agent_uninstalled" ? <Check size={17} /> : taskStatus === "failed" ? <TriangleAlert size={17} /> : <RefreshCw className="service-spin" size={17} />}
        <span>
          <strong>{taskStatus === "agent_uninstalled" ? "远端 Agent 已卸载，仅待清理面板数据" : taskStatus === "failed" ? "上次卸载未完成" : "已有卸载任务，继续操作不会重复下发"}</strong>
          {taskMessage ? <small>{taskMessage}</small> : null}
        </span>
      </div> : null}

      {capabilityBlocker ? <div className="service-delete-blocker" role="alert"><TriangleAlert size={17} /><span><strong>暂时无法删除</strong><small>{capabilityBlocker}</small></span></div> : uninstallSupport == null && !shared && !impactLoading && !impactError ? <div className="service-delete-capability-note"><RefreshCw size={15} /><span>删除时将再次检测 Agent 的安全卸载能力。</span></div> : null}

      {error ? <div className="service-delete-error" role="alert"><TriangleAlert size={16} /><span>{error}</span></div> : null}
      <div className="dialog-actions service-delete-actions">
        <small>{shared ? "解除后可由拥有方重新分享接入" : "删除过程失败时，服务器记录会保留以便重试"}</small>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={working}>取消</Button>
        <Button type="button" variant="danger" onClick={() => onConfirm(shared)} disabled={confirmDisabled}>{working ? <Spinner label={shared ? "正在解除共享接入" : remoteAlreadyUninstalled ? "正在清理面板数据" : "正在卸载并删除"} /> : <><Trash2 size={16} />{confirmLabel}</>}</Button>
      </div>
    </Dialog>
  );
}

function sumKnownCounts(counts: DeleteImpactCounts | undefined, keys: Array<keyof DeleteImpactCounts>): number | undefined {
  if (!counts) return undefined;
  const known = keys.map((key) => counts[key]).filter((value): value is number => typeof value === "number");
  return known.length ? known.reduce((total, value) => total + value, 0) : undefined;
}

function sumNumbers(values: Array<number | undefined>): number {
  return values.reduce<number>((total, value) => total + (typeof value === "number" ? value : 0), 0);
}

function formatImpactCount(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value).toLocaleString() : "—";
}

function cleanVersion(value: string | undefined): string {
  return (value ?? "").trim().replace(/^xray\s+/i, "").replace(/^v(?=\d)/i, "");
}

function cleanXrayVersion(value: string | undefined): string {
  const match = (value ?? "").trim().match(/^xray\s+v?(\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?)/i)
    ?? (value ?? "").trim().match(/^v?(\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?)/i);
  return match?.[1] ?? "";
}

function compareVersionTags(left: string, right: string): number {
  const a = left.replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10));
  const b = right.replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function preferredStableXrayVersion(result: XrayVersionsResponse): string {
  const releases = result.versions ?? result.releases ?? [];
  return result.latest_stable || releases.find((release) => !release.prerelease)?.version || result.latest || releases[0]?.version || "";
}

function XrayVersionDialog({ server, currentVersion, working, onCancel, onConfirm }: {
  server: ManagedServer;
  currentVersion?: string;
  working: boolean;
  onCancel: () => void;
  onConfirm: (version: string) => void;
}) {
  const [result, setResult] = useState<XrayVersionsResponse | null>(null);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const current = cleanXrayVersion(currentVersion);
  const currentTag = current ? `v${current}` : "";

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void api.get<XrayVersionsResponse>(`/api/admin/remote/xray/versions?server_id=${server.id}`)
      .then((response) => {
        if (!active) return;
        const checked = assertSuccess(response, "读取 Xray 版本失败");
        const releases = checked.versions ?? checked.releases ?? [];
        const preferred = [checked.latest_stable, checked.latest, releases[0]?.version]
          .find((version) => Boolean(version && releases.some((release) => release.version === version))) ?? "";
        setResult(checked);
        setSelected(preferred);
      })
      .catch((reason) => {
        if (!active) return;
        setResult(null);
        setSelected("");
        setError(messageFrom(reason, "读取 Xray 版本失败"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [reload, server.id]);

  const releases = result?.versions ?? result?.releases ?? [];
  const selectedRelease = releases.find((release) => release.version === selected);
  const supported = result?.version_selection_supported !== false;
  const reinstall = Boolean(selected && currentTag && selected === currentTag);
  const downgrade = Boolean(selected && currentTag && compareVersionTags(selected, currentTag) < 0);
  const confirmLabel = reinstall ? `重装 ${selected}` : selected ? `更新到 ${selected}` : "选择版本";

  return <Dialog title="更新 Xray" description={`${server.name}${current ? ` · 当前 v${current}` : " · 当前版本未知"}`} onClose={onCancel} dismissible={!working} wide>
    {loading ? <div className="center-state"><Spinner label="正在读取官方版本" /></div> : null}
    {!loading && error ? <ErrorState message={error} onRetry={() => setReload((value) => value + 1)} /> : null}
    {!loading && !error && !supported ? <div className="xray-version-blocker" role="alert"><TriangleAlert size={19} /><span><strong>请先升级 Agent</strong><small>{result?.support_error || "当前 Agent 不支持指定 Xray 内核版本，已阻止不确定的更新操作。"}</small></span></div> : null}
    {!loading && !error && supported && releases.length ? <>
      <div className="xray-version-summary">
        <span><HardDriveDownload size={18} /><strong>{result?.latest_stable || result?.latest || releases[0].version}</strong><small>默认稳定版</small></span>
        {result?.latest && result.latest !== result.latest_stable ? <span><TriangleAlert size={18} /><strong>{result.latest}</strong><small>最新预览版</small></span> : null}
      </div>
      <div className="xray-version-options" role="radiogroup" aria-label="Xray 内核版本">
        {releases.map((release) => {
          const isCurrent = currentTag === release.version;
          const isLatestStable = result?.latest_stable === release.version;
          const published = release.published_at ? new Date(release.published_at).toLocaleDateString("zh-CN") : "";
          return <label key={release.version} className={selected === release.version ? "is-selected" : ""}>
            <input type="radio" name={`xray-version-${server.id}`} value={release.version} checked={selected === release.version} onChange={() => setSelected(release.version)} />
            <span><strong>{release.version}</strong><small>{published || release.name || "官方 Release"}</small></span>
            <span className="xray-version-flags">
              {isCurrent ? <Badge tone="neutral">当前</Badge> : null}
              {isLatestStable ? <Badge tone="good">稳定</Badge> : null}
              {release.prerelease ? <Badge tone="warn">预览</Badge> : null}
            </span>
          </label>;
        })}
      </div>
      {result?.stale || result?.warning ? <div className="xray-version-note" role="status"><RefreshCw size={15} /><span>{result.warning || "GitHub 暂时不可达，正在使用最近一次成功同步的官方版本列表。"}</span></div> : null}
      {selectedRelease?.prerelease || downgrade ? <div className="xray-version-warning" role="alert"><TriangleAlert size={16} /><span>{selectedRelease?.prerelease ? `${selected} 是预览版，尚未通过 Arcway 完整协议验收。` : `${selected} 低于当前 ${currentTag}，确认后将执行降级安装。`}</span></div> : null}
    </> : null}
    {!loading && !error && supported && !releases.length ? <ErrorState message="官方版本列表为空，请稍后重试" onRetry={() => setReload((value) => value + 1)} /> : null}
    <div className="dialog-actions">
      <Button type="button" variant="secondary" onClick={onCancel} disabled={working}>取消</Button>
      <Button type="button" onClick={() => onConfirm(selected)} disabled={working || loading || Boolean(error) || !supported || !selected}>
        {working ? <Spinner label="正在处理" /> : confirmLabel}
      </Button>
    </div>
  </Dialog>;
}

function connectionPolicyLabel(mode: string): string {
  if (mode === "auto") return "自动";
  if (mode === "pull") return "Pull";
  if (mode === "push" || mode === "http") return "HTTP";
  return "WebSocket";
}

function activeTransport(server: ManagedServer): "WS" | "HTTP" | "Pull" {
  if (server.ws_connected) return "WS";
  if (server.fallback_to_pull || server.connection_mode === "pull") return "Pull";
  return "HTTP";
}

function canUpgradeAgent(version?: CachedAgentVersion): boolean {
  return Boolean(version?.loaded && !version.loading && version.upgrade_available && cleanVersion(version.latest) && !version.latest_error);
}

function agentVersionIsCurrent(version?: CachedAgentVersion): boolean {
  return Boolean(version?.loaded && !version.loading && !version.upgrade_available && cleanVersion(version.latest) && !version.latest_error);
}

function AgentVersionButton({ server, version, working, compact = false, onUpgrade }: {
  server: ManagedServer;
  version?: CachedAgentVersion;
  working: boolean;
  compact?: boolean;
  onUpgrade: () => void;
}) {
  if (server.is_federated) return null;
  const current = cleanVersion(version?.current);
  const latest = cleanVersion(version?.latest);
  const checking = Boolean(version?.loading);
  const upgradeAvailable = canUpgradeAgent(version);
  const currentVersion = agentVersionIsCurrent(version);
  const label = current ? `${compact ? "" : "Agent "}v${current}` : compact ? "Agent --" : "Agent 未知";
  const title = upgradeAvailable
    ? `Agent 当前 v${current || "未知"}，上游最新 v${latest}；点击后确认升级`
    : currentVersion
      ? `Agent 当前已是上游最新版 v${latest}`
      : version?.latest_error || "尚未读取到可用的新版本";
  const ariaLabel = upgradeAvailable
    ? `升级 ${server.name} Agent`
    : currentVersion
      ? `${server.name} Agent 已是最新版`
      : `暂不可升级 ${server.name} Agent`;
  return <button type="button" className={`service-agent-version ${upgradeAvailable ? "has-update" : ""} ${compact ? "is-compact" : ""}`} aria-label={ariaLabel} title={title} disabled={!isConnected(server) || working || !upgradeAvailable} onClick={onUpgrade}>
    {working || checking ? <RefreshCw className="service-spin" size={13} /> : upgradeAvailable ? <UploadCloud size={13} /> : currentVersion ? <Check size={13} /> : <TriangleAlert size={13} />}
    <span>{working ? "Agent 更新中" : label}</span>
    {upgradeAvailable && !working ? <i aria-hidden="true" /> : null}
  </button>;
}

function XrayQuickControl({ server, status, working, compact = false, onAction }: {
  server: ManagedServer;
  status?: CachedServiceStatus;
  working: boolean;
  compact?: boolean;
  onAction: (action: XrayQuickAction) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [updateCheck, setUpdateCheck] = useState<XrayUpdateCheck>({ checking: false, checked: false, supported: true, latestStable: "", error: "" });
  const menuRef = useRef<HTMLDivElement>(null);
  const embedded = server.xray_mode === "embedded";
  const live = status?.loaded ? status.xray : undefined;
  const installed = embedded || (live?.installed ?? Boolean(server.xray_running || server.xray_version));
  const running = live?.running ?? Boolean(server.xray_running);
  const state = running ? "running" : installed ? "stopped" : "missing";
  const version = cleanXrayVersion(live?.version || server.xray_version);
  const label = state === "missing" ? "安装 Xray" : "Xray";
  const disabled = !isConnected(server) || server.is_federated || working;
  const loading = status?.loading && !status.loaded;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen || compact || embedded || !installed) return;
    let active = true;
    setUpdateCheck({ checking: true, checked: false, supported: true, latestStable: "", error: "" });
    void api.get<XrayVersionsResponse>(`/api/admin/remote/xray/versions?server_id=${server.id}`)
      .then((response) => {
        if (!active) return;
        const checked = assertSuccess(response, "检查 Xray 更新失败");
        setUpdateCheck({
          checking: false,
          checked: true,
          supported: checked.version_selection_supported !== false,
          latestStable: preferredStableXrayVersion(checked),
          error: "",
        });
      })
      .catch((reason) => {
        if (!active) return;
        setUpdateCheck({ checking: false, checked: true, supported: false, latestStable: "", error: messageFrom(reason, "检查 Xray 更新失败") });
      });
    return () => { active = false; };
  }, [compact, embedded, installed, menuOpen, server.id]);

  const choose = (action: XrayQuickAction) => {
    setMenuOpen(false);
    onAction(action);
  };
  const directAction: XrayQuickAction = !installed ? "install" : !running ? "start" : embedded ? "restart" : "update";
  const latestStable = cleanXrayVersion(updateCheck.latestStable);
  const updateAvailable = updateCheck.checked
    && updateCheck.supported
    && Boolean(version && latestStable)
    && compareVersionTags(latestStable, version) > 0;
  const updateLabel = updateCheck.checking
    ? "检查更新..."
    : updateCheck.error
      ? "检查更新失败"
      : updateCheck.checked && !updateCheck.supported
        ? "需升级 Agent"
        : !updateCheck.checked
          ? "检查更新"
          : !version
            ? "当前版本未知"
            : updateAvailable
              ? `更新到 v${latestStable}`
              : `已是最新版 v${version}`;
  const ariaLabel = loading
    ? `正在读取 ${server.name} Xray 状态`
    : !installed
      ? `安装 ${server.name} Xray`
      : compact && !running
        ? `启动 ${server.name} Xray`
        : compact && !embedded
          ? `更新 ${server.name} Xray${version ? ` v${version}` : ""}`
          : embedded
        ? `管理 ${server.name} 内嵌 Xray`
        : `管理 ${server.name} Xray${version ? ` v${version}` : ""}`;
  const versionTitle = version ? ` v${version}` : "";

  return <div ref={menuRef} className={`service-xray-quick ${compact ? "is-compact" : ""}`}>
    <button type="button" className={`service-xray-state is-${loading ? "loading" : state}`} aria-label={ariaLabel} aria-haspopup={!compact && installed ? "menu" : undefined} aria-expanded={!compact && installed ? menuOpen : undefined} title={loading ? "正在读取 Xray 状态" : `Xray${versionTitle} · ${installed ? "点击打开快捷操作" : "未安装，点击安装"}`} disabled={disabled || loading} onClick={() => compact || !installed ? choose(directAction) : setMenuOpen((open) => !open)}>
      {working || loading ? <RefreshCw className="service-spin" size={13} /> : state === "missing" ? <Download size={13} /> : <i />}
      <span className="service-xray-copy">
        <b>{working ? "处理中" : label}</b>
      </span>
      {compact && running && !embedded && !working && !loading ? <HardDriveDownload className="service-xray-update-icon" size={13} /> : null}
      {!compact && installed && !working ? <ChevronDown size={12} /> : null}
    </button>
    {menuOpen && !compact ? <div className="service-xray-menu" role="menu" aria-label={`${server.name} Xray 快捷操作`}>
      {running ? <button role="menuitem" onClick={() => choose("restart")}><RotateCw size={14} />重启 Xray</button> : <button role="menuitem" onClick={() => choose("start")}><Play size={14} />开启 Xray</button>}
      {running ? <button role="menuitem" className="is-danger" onClick={() => choose("stop")}><Square size={14} />暂停 Xray</button> : null}
      {!embedded ? <>
        <button role="menuitem" disabled={!updateAvailable} title={updateCheck.error || (!version ? "无法识别当前 Xray 版本" : undefined)} onClick={() => choose("update")}><HardDriveDownload size={14} />{updateLabel}</button>
        <button role="menuitem" onClick={() => choose("update")}><Settings2 size={14} />选择 / 重装核心</button>
      </> : null}
    </div> : null}
  </div>;
}

function ServerAddressCarousel({ server }: { server: ManagedServer }) {
  const addresses = useMemo(() => {
    const values = [
      server.ip_address ? { family: "IPv4", value: server.ip_address } : null,
      server.ipv6_enabled && server.ip_address_v6 ? { family: "IPv6", value: server.ip_address_v6 } : null,
    ].filter((item): item is { family: string; value: string } => Boolean(item));
    return values.filter((item, index) => values.findIndex((candidate) => candidate.value === item.value) === index);
  }, [server.ip_address, server.ip_address_v6, server.ipv6_enabled]);
  const addressKey = addresses.map((item) => `${item.family}:${item.value}`).join("|");
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const viewportRef = useRef<HTMLSpanElement>(null);

  useEffect(() => { setIndex(0); }, [addressKey]);
  useEffect(() => {
    if (addresses.length < 2 || paused) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % addresses.length), 3_000);
    return () => window.clearInterval(timer);
  }, [addressKey, addresses.length, paused]);

  const currentIndex = addresses.length ? index % addresses.length : 0;
  const current = addresses[currentIndex] ?? { family: "IPv4", value: "IP 未上报" };
  const count = addresses.length;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const reset = () => {
      if (typeof viewport.scrollTo === "function") viewport.scrollTo({ left: 0, behavior: "auto" });
      else viewport.scrollLeft = 0;
    };
    const measure = () => setOverflowing(viewport.scrollWidth > viewport.clientWidth + 1);
    reset();
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(viewport);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [addressKey, currentIndex]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !overflowing || paused) return;
    let timeout: number | undefined;
    const scrollTo = (left: number) => {
      if (typeof viewport.scrollTo === "function") viewport.scrollTo({ left, behavior: "smooth" });
      else viewport.scrollLeft = left;
    };
    const sweep = () => {
      const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      if (max <= 1) return;
      scrollTo(max);
      timeout = window.setTimeout(() => {
        scrollTo(0);
        timeout = window.setTimeout(sweep, Math.max(2_800, max * 24) + 1_000);
      }, Math.max(2_800, max * 24) + 1_200);
    };
    timeout = window.setTimeout(sweep, 900);
    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      if (typeof viewport.scrollTo === "function") viewport.scrollTo({ left: viewport.scrollLeft, behavior: "auto" });
    };
  }, [addressKey, currentIndex, overflowing, paused]);

  const switchAddress = () => {
    if (count > 1) setIndex((currentIndex + 1) % count);
  };

  const addressTitle = count > 1 ? `${addresses.map((item) => `${item.family}: ${item.value}`).join("\n")}\n点击切换地址` : current.family;

  return <button type="button" className={`service-address ${overflowing ? "is-overflowing" : ""}`} aria-label={`${server.name} 当前 ${current.family} ${current.value}${count > 1 ? `，第 ${currentIndex + 1} 个，共 ${count} 个，点击切换` : ""}`} title={addressTitle} disabled={count < 2} onClick={switchAddress} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
    <span ref={viewportRef} className="service-address-viewport"><span key={`${addressKey}:${currentIndex}`} className="service-address-value">{current.value}</span></span>
    {count > 1 ? <small className="service-address-count" aria-hidden="true">{currentIndex + 1}/{count}</small> : null}
  </button>;
}

function boundedUsage(value?: number, total?: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const percent = total && total > 0 ? Number(value) / total * 100 : Number(value);
  return Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : undefined;
}

function usageLabel(value?: number) {
  return value === undefined ? "--" : `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}%`;
}

function ServiceHostMetric({ icon, label, value, detail, tone = "blue" }: { icon: ReactNode; label: string; value?: number; detail?: string; tone?: "blue" | "green" | "amber" }) {
  return <div className={`service-host-metric is-${tone}`} style={{ "--service-host-meter": `${value ?? 0}%` } as CSSProperties} title={detail || `${label} 暂无 Agent 上报`}>
    <span className="service-host-metric-icon">{icon}</span>
    <span className="service-host-metric-copy"><small>{label}</small><strong>{usageLabel(value)}</strong></span>
    <i aria-hidden="true" />
  </div>;
}

function ServerCard({ server, serviceStatus, agentVersion, checked, credentialsLoading, xrayWorking, agentWorking, style, onCheck, onOpen, onXrayAction, onAgentUpgrade, onEdit, onCredentials, onDelete }: {
  server: ManagedServer;
  serviceStatus?: CachedServiceStatus;
  agentVersion?: CachedAgentVersion;
  checked: boolean;
  credentialsLoading: boolean;
  xrayWorking: boolean;
  agentWorking: boolean;
  style?: CSSProperties;
  onCheck: (checked: boolean) => void;
  onOpen: (initialTab: OperationTab) => void;
  onXrayAction: (action: XrayQuickAction) => void;
  onAgentUpgrade: () => void;
  onEdit: () => void;
  onCredentials: () => void;
  onDelete: () => void;
}) {
  const connected = isConnected(server);
  const usage = server.traffic_limit > 0 ? Math.min(100, server.traffic_used / server.traffic_limit * 100) : 0;
  const transport = connected ? activeTransport(server) : null;
  const cpuUsage = connected ? boundedUsage(server.cpu_pct) : undefined;
  const memoryUsage = connected ? boundedUsage(server.mem_used, server.mem_total) : undefined;
  const diskUsage = connected ? boundedUsage(server.disk_used, server.disk_total) : undefined;
  return (
    <Surface style={style} className={`service-card ${connected ? "is-online" : "is-offline"} ${checked ? "is-selected" : ""}`}>
      <div className="service-card-head">
        <label className="service-select" title="选择服务器"><input type="checkbox" checked={checked} onChange={(event) => onCheck(event.target.checked)} aria-label={`选择 ${server.name}`} /></label>
        <span className={`service-server-icon ${connected ? "is-online" : ""}`}>{connected ? <Wifi size={19} /> : <WifiOff size={19} />}</span>
        <div className="service-card-title"><strong><span className="service-country" title={server.country_code || "地区未知"}><CountryFlag countryCode={server.country_code} /></span><span className="service-country-name">{server.name}</span></strong>{server.domain ? <small>{server.domain}</small> : null}</div>
        <Badge tone={connected ? "good" : statusTone(server.status)}>{connected ? "在线" : "离线"}</Badge>
      </div>
      <div className="service-badges">
        {server.is_federated ? <Badge tone="info">共享</Badge> : null}
        <Badge tone="neutral">{server.xray_mode === "embedded" ? "内嵌 Xray" : "外置 Xray"}</Badge>
        {server.encrypted ? <Badge tone="good"><ShieldCheck size={12} />加密连接</Badge> : null}
        {server.warp_installed ? <Badge tone="info">WARP</Badge> : null}
      </div>
      <div className="service-runtime-row">
        <div className="service-runtime-controls">
          <ServerAddressCarousel server={server} />
          <span className={`service-transport is-${transport ? transport.toLowerCase() : "offline"}`} title={transport ? "当前连接通道（根据 Agent 在线状态推断）" : "Agent 离线，当前没有活动数据通道"}>{transport ? <Wifi size={12} /> : <WifiOff size={12} />}{transport || "--"}</span>
          <XrayQuickControl server={server} status={serviceStatus} working={xrayWorking} onAction={onXrayAction} />
          <AgentVersionButton compact server={server} version={agentVersion} working={agentWorking} onUpgrade={onAgentUpgrade} />
        </div>
      </div>
      <div className="service-live-panel">
        <div className="service-host-metrics" aria-label={`${server.name} 主机资源`}>
          <ServiceHostMetric icon={<Cpu size={13} />} label="CPU" value={cpuUsage} detail={server.loadavg ? `负载 ${server.loadavg}` : undefined} />
          <ServiceHostMetric icon={<MemoryStick size={13} />} label="内存" value={memoryUsage} detail={server.mem_used !== undefined && server.mem_total !== undefined ? `${formatBytes(server.mem_used)} / ${formatBytes(server.mem_total)}` : undefined} tone="green" />
          <ServiceHostMetric icon={<HardDrive size={13} />} label="磁盘" value={diskUsage} detail={server.disk_used !== undefined && server.disk_total !== undefined ? `${formatBytes(server.disk_used)} / ${formatBytes(server.disk_total)}` : undefined} tone="amber" />
        </div>
        <div className="service-speed-row"><span><Activity size={14} />实时网速</span><strong><i className="is-up">↑ {formatBytes(server.current_upload_speed, true)}</i><i className="is-down">↓ {formatBytes(server.current_download_speed, true)}</i></strong></div>
        <div className="service-traffic">
          <div><small>流量统计</small><strong>{formatBytes(server.traffic_used)}{server.traffic_limit > 0 ? ` / ${formatBytes(server.traffic_limit)}` : " · 不限流量"}</strong></div>
          <span className={server.traffic_limit > 0 ? "" : "is-unlimited"} aria-label={server.traffic_limit > 0 ? `已使用 ${usage.toFixed(1)}%` : "不限流量"}><i style={{ width: server.traffic_limit > 0 ? `${usage}%` : "100%" }} /></span>
          <div className="service-traffic-caption"><small>{server.traffic_reset_day ? `每月 ${server.traffic_reset_day} 日重置` : "无需重置"}</small></div>
        </div>
        <div className="service-heartbeat"><Activity size={13} /><span>最后心跳：{relativeTime(server.last_heartbeat)}</span></div>
      </div>
      <div className="service-card-actions">
        <div className="service-card-primary-actions"><Button variant="secondary" onClick={() => onOpen("xray")} disabled={!connected}><Settings2 size={16} />Xray 设置</Button><Button variant="secondary" aria-label="管理" onClick={() => onOpen("overview")}><Settings2 size={16} />Agent 管理</Button></div>
        <IconButton label={`编辑 ${server.name}`} onClick={onEdit}><Pencil size={16} /></IconButton>
        {!server.is_federated ? <IconButton label={`查看 ${server.name} 安装凭据`} onClick={onCredentials} disabled={credentialsLoading}>{credentialsLoading ? <RefreshCw className="service-spin" size={16} /> : <KeyRound size={16} />}</IconButton> : null}
        <IconButton label={`删除 ${server.name}`} onClick={onDelete}><Trash2 size={16} /></IconButton>
      </div>
    </Surface>
  );
}

function ServerTable({ servers, serviceStatuses, agentVersions, selected, credentialsLoading, quickWorking, upgrade, onSelect, onOpen, onXrayAction, onAgentUpgrade, onEdit, onCredentials, onDelete }: {
  servers: ManagedServer[];
  serviceStatuses: Record<number, CachedServiceStatus>;
  agentVersions: Record<number, CachedAgentVersion>;
  selected: number[];
  credentialsLoading: number | null;
  quickWorking: { serverId: number; action: XrayQuickAction } | null;
  upgrade: UpgradeState | null;
  onSelect: (ids: number[]) => void;
  onOpen: (server: ManagedServer) => void;
  onXrayAction: (server: ManagedServer, action: XrayQuickAction) => void;
  onAgentUpgrade: (server: ManagedServer) => void;
  onEdit: (server: ManagedServer) => void;
  onCredentials: (server: ManagedServer) => void;
  onDelete: (server: ManagedServer) => void;
}) {
  const allChecked = servers.length > 0 && servers.every((server) => selected.includes(server.id));
  return (
    <Surface className="table-surface service-table-surface"><div className="table-wrap"><table><thead><tr><th><input aria-label="选择全部服务器" type="checkbox" checked={allChecked} onChange={(event) => onSelect(event.target.checked ? Array.from(new Set([...selected, ...servers.map((server) => server.id)])) : selected.filter((id) => !servers.some((server) => server.id === id)))} /></th><th>服务器</th><th>连接</th><th>资源</th><th>实时速度</th><th>本期流量</th><th>核心 / Agent</th><th aria-label="操作" /></tr></thead><tbody>{servers.map((server) => {
      const connected = isConnected(server);
      const transport = activeTransport(server);
      const cpuUsage = connected ? boundedUsage(server.cpu_pct) : undefined;
      const memoryUsage = connected ? boundedUsage(server.mem_used, server.mem_total) : undefined;
      const diskUsage = connected ? boundedUsage(server.disk_used, server.disk_total) : undefined;
      return <tr key={server.id}>
        <td><input aria-label={`选择 ${server.name}`} type="checkbox" checked={selected.includes(server.id)} onChange={(event) => onSelect(event.target.checked ? [...new Set([...selected, server.id])] : selected.filter((id) => id !== server.id))} /></td>
        <td><button className="service-name-button" onClick={() => onOpen(server)}><span className={`service-server-icon ${connected ? "is-online" : ""}`}>{connected ? <Wifi size={16} /> : <WifiOff size={16} />}</span><span><strong><span className="service-country" title={server.country_code || "地区未知"}><CountryFlag countryCode={server.country_code} fallbackSize={13} /></span><span className="service-country-name">{server.name}</span></strong><small>{server.domain || server.ip_address || "地址待上报"}</small></span></button></td>
        <td><Badge tone={connected ? "good" : statusTone(server.status)}>{connected ? transport : server.status || "离线"}</Badge><small className="cell-note">{connectionPolicyLabel(server.connection_mode)} · {relativeTime(server.last_heartbeat)}</small></td>
        <td><div className="service-resource-compact"><span><Cpu size={12} />{usageLabel(cpuUsage)}</span><span><MemoryStick size={12} />{usageLabel(memoryUsage)}</span><span><HardDrive size={12} />{usageLabel(diskUsage)}</span></div></td>
        <td><span className="speed-pair"><small><ArrowUpFromLine size={13} />{formatBytes(server.current_upload_speed, true)}</small><small><ArrowDownToLine size={13} />{formatBytes(server.current_download_speed, true)}</small></span></td>
        <td><strong>{formatBytes(server.traffic_used)}</strong><small className="cell-note">{server.traffic_limit ? `限额 ${formatBytes(server.traffic_limit)}` : "不限额"}</small></td>
        <td><div className="service-version-stack"><XrayQuickControl compact server={server} status={serviceStatuses[server.id]} working={quickWorking?.serverId === server.id} onAction={(action) => onXrayAction(server, action)} /><AgentVersionButton compact server={server} version={agentVersions[server.id]} working={Boolean(upgrade?.running && upgrade.serverIDs.includes(server.id))} onUpgrade={() => onAgentUpgrade(server)} /></div></td>
        <td><div className="service-row-actions"><IconButton label={`管理 ${server.name}`} onClick={() => onOpen(server)}><Settings2 size={16} /></IconButton><IconButton label={`编辑 ${server.name}`} onClick={() => onEdit(server)}><Pencil size={16} /></IconButton>{!server.is_federated ? <IconButton label={`查看 ${server.name} 安装凭据`} onClick={() => onCredentials(server)} disabled={credentialsLoading === server.id}>{credentialsLoading === server.id ? <RefreshCw className="service-spin" size={16} /> : <KeyRound size={16} />}</IconButton> : null}<IconButton label={`删除 ${server.name}`} onClick={() => onDelete(server)}><Trash2 size={16} /></IconButton></div></td>
      </tr>;
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
    <fieldset className="service-nginx-mode"><legend>Nginx 管理模式</legend><div className="service-nginx-mode-options" role="radiogroup" aria-label="Nginx 管理模式"><button type="button" role="radio" aria-checked={form.nginxMode === "managed"} className={form.nginxMode === "managed" ? "is-active" : ""} onClick={() => patch("nginxMode", "managed")}><Server size={18} /><span><strong>Arcway 管理 Nginx</strong><small>由面板安装、启停、更新配置</small></span></button><button type="button" role="radio" aria-checked={form.nginxMode === "reuse_existing"} className={form.nginxMode === "reuse_existing" ? "is-active" : ""} onClick={() => patch("nginxMode", "reuse_existing")}><ShieldCheck size={18} /><span><strong>复用系统已有 Nginx</strong><small>只下发独立站点配置，不接管服务</small></span></button></div>{form.nginxMode === "reuse_existing" ? <div className="service-nginx-mode-note" role="note"><ShieldCheck size={17} /><span><strong>现有 Nginx 保持系统托管</strong><small>Arcway 不会安装、卸载、覆盖主配置或控制服务启停；部署前会预检配置，失败时由服务端回滚。</small></span></div> : null}</fieldset>
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
        nginx_mode: form.nginxMode,
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
    nginxMode: server.nginx_mode || "managed",
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
        nginx_mode: form.nginxMode,
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

function RemoteServiceTerminalDialog({ terminal, onClose }: { terminal: ServiceTerminalState; onClose: () => void }) {
  const outputRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const output = outputRef.current;
    if (output) output.scrollTop = output.scrollHeight;
  }, [terminal.output]);
  return <Dialog title={terminal.title} description={terminal.description} onClose={onClose} wide dismissible={!terminal.running}><div className={`service-terminal is-${terminal.outcome}`} aria-busy={terminal.running}><div className="service-terminal-status" role="status"><span /> <strong>{terminal.running ? "正在执行" : terminal.outcome === "success" ? "执行完成" : "执行失败"}</strong></div><pre ref={outputRef} className="service-terminal-output" role="log" aria-label="远端执行日志" aria-live="polite">{terminal.output}{terminal.running ? <span className="service-terminal-cursor">▌</span> : null}</pre><div className="dialog-actions"><Button variant="secondary" aria-label={terminal.running ? "正在执行" : "关闭"} onClick={onClose} disabled={terminal.running}>{terminal.running ? <Spinner label="正在执行" /> : "关闭"}</Button></div></div></Dialog>;
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

function XraySettingRow({ title, description, children, stacked = false }: { title: string; description?: string; children: ReactNode; stacked?: boolean }) {
  return <div className={`xray-setting-row ${stacked ? "is-stacked" : ""}`}>
    <span className="xray-setting-copy"><strong>{title}</strong>{description ? <small>{description}</small> : null}</span>
    <div className="xray-setting-control">{children}</div>
  </div>;
}

function XrayTagPicker({ label, description, ariaLabel, values, options, onChange }: { label: string; description: string; ariaLabel: string; values: string[]; options: XrayPresetOption[]; onChange: (values: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = (value: string) => {
    const additions = value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
    if (additions.length) onChange([...new Set([...values, ...additions])]);
    setDraft("");
  };
  const togglePreset = (value: string) => onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  const labelFor = (value: string) => options.find((option) => option.value === value)?.label || value;

  return <XraySettingRow title={label} description={description} stacked>
    <div className="xray-tag-picker">
      <div className="xray-chip-input">
        {values.map((value) => <span key={value} title={value}>{labelFor(value)}<button type="button" aria-label={`移除 ${labelFor(value)}`} onMouseDown={(event) => event.preventDefault()} onClick={() => onChange(values.filter((item) => item !== value))}><X size={12} /></button></span>)}
        <input aria-label={ariaLabel} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(draft); } }} onBlur={() => add(draft)} placeholder={values.length ? "继续输入" : "输入匹配值后按回车"} />
      </div>
      <div className="xray-preset-options">{options.map((option) => <button type="button" key={option.value} aria-pressed={values.includes(option.value)} title={option.value} className={values.includes(option.value) ? "is-active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => togglePreset(option.value)}>{option.label}</button>)}</div>
    </div>
  </XraySettingRow>;
}

type OperationTab = "overview" | "services" | "speedtest" | "xray" | "sharing";
type XraySettingsTab = "basic" | "routing" | "outbounds" | "dns" | "warp" | "advanced";

function ServerOperationsDialog({ server, initialTab = "overview", notify, onClose, onChanged, onUpgrade }: { server: ManagedServer; initialTab?: OperationTab; notify: Notify; onClose: () => void; onChanged: () => Promise<void>; onUpgrade: (version: AgentVersionResponse) => void }) {
  const [tab, setTab] = useState<OperationTab>(initialTab);
  const [xrayTab, setXrayTab] = useState<XraySettingsTab>("basic");
  const [status, setStatus] = useState<ServiceStatusResponse | null>(null);
  const [version, setVersion] = useState<AgentVersionResponse | null>(null);
  const [system, setSystem] = useState<SystemInfoResponse | null>(null);
  const [ddnsStatus, setDDNSStatus] = useState<DDNSStatusResponse | null>(null);
  const [ddnsPollAttempt, setDDNSPollAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [working, setWorking] = useState("");
  const [terminal, setTerminal] = useState<ServiceTerminalState | null>(null);
  const [confirm, setConfirm] = useState<{ service: "xray" | "nginx"; action: "stop" | "remove" | "update" } | null>(null);
  const [config, setConfig] = useState("");
  const [savedConfig, setSavedConfig] = useState("");
  const [configPath, setConfigPath] = useState("");
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configDirty, setConfigDirty] = useState(false);
  const [dnsDraft, setDNSDraft] = useState("{}");
  const [dnsDraftError, setDNSDraftError] = useState("");
  const [resetBasicConfirm, setResetBasicConfirm] = useState(false);
  const configLoadAttempted = useRef(false);
  const [shares, setShares] = useState<SharedServerToken[]>([]);
  const [shareLabel, setShareLabel] = useState("");
  const [newShareToken, setNewShareToken] = useState("");
  const reusesExistingNginx = server.nginx_mode === "reuse_existing";

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

  const serviceAction = async (service: "xray" | "nginx", action: "start" | "stop" | "restart" | "install" | "remove" | "update", version?: string) => {
    if (service === "nginx" && reusesExistingNginx) {
      setError("当前服务器复用系统已有 Nginx，Arcway 不会安装、卸载或控制该服务。");
      return;
    }
    const key = `${service}-${action}`;
    const serviceLabel = service === "xray" ? "Xray" : "Nginx";
    const actionLabel = action === "install" ? "安装" : action === "update" ? "更新" : action === "remove" ? "卸载" : action === "start" ? "启动" : action === "stop" ? "停止" : "重启";
    const streamed = action === "install" || action === "remove" || action === "update";
    let streamCompleted = false;
    setWorking(key);
    setError("");
    if (streamed) {
      setConfirm(null);
      setTerminal({
        title: `${actionLabel} ${serviceLabel}`,
        description: `${server.name} · 远端实时执行日志`,
        output: `正在连接 ${server.name}...\n`,
        running: true,
        outcome: "running",
      });
    }
    try {
      if (streamed) {
        const response = await requestStream(`/api/admin/remote/${service}/${action === "remove" ? "remove-stream" : "install-stream"}?server_id=${server.id}`, {
          method: "POST",
          headers: { Accept: "text/event-stream" },
          body: service === "xray" && action === "update" && version ? JSON.stringify({ version }) : undefined,
        });
        const completionMessage = await consumeRemoteServiceStream(response, (output) => {
          setTerminal((current) => current ? {
            ...current,
            output: `${current.output}${current.output.endsWith("\n") ? "" : "\n"}${output}${output.endsWith("\n") ? "" : "\n"}`,
          } : current);
        });
        streamCompleted = true;
        setTerminal((current) => current ? {
          ...current,
          output: `${current.output}${current.output.endsWith("\n") ? "" : "\n"}[完成] ${completionMessage}\n`,
          running: false,
          outcome: "success",
        } : current);
      } else {
        assertSuccess(await api.post<ActionResponse>(`/api/admin/remote/services/control?server_id=${server.id}`, { service, action }), `${service} ${action} 失败`);
      }
      notify(`${serviceLabel} ${actionLabel}完成`);
      setConfirm(null);
      await loadStatus();
      await onChanged();
    } catch (reason) {
      const message = messageFrom(reason, "远程服务操作失败");
      if (streamed && !streamCompleted) {
        setTerminal((current) => current ? {
          ...current,
          output: `${current.output}${current.output.endsWith("\n") ? "" : "\n"}[失败] ${message}\n`,
          running: false,
          outcome: "error",
        } : current);
      }
      setError(message);
      notify(message, "error");
    } finally {
      setWorking("");
    }
  };

  const loadConfig = useCallback(async () => {
    setWorking("config-load");
    setError("");
    try {
      const result = assertSuccess(await api.get<XrayConfigResponse>(`/api/admin/remote/xray/config?server_id=${server.id}`), "读取 Xray 配置失败");
      const nextConfig = result.config ?? "";
      setConfig(nextConfig);
      setSavedConfig(nextConfig);
      setConfigPath(result.path ?? "");
      setConfigLoaded(true);
      setConfigDirty(false);
      setDNSDraft(JSON.stringify(xrayConfigSection(nextConfig, "dns"), null, 2));
      setDNSDraftError("");
    } catch (reason) {
      setError(messageFrom(reason, "读取 Xray 配置失败"));
    } finally {
      setWorking("");
    }
  }, [server.id]);

  useEffect(() => {
    if (tab !== "xray" || configLoaded || configLoadAttempted.current) return;
    configLoadAttempted.current = true;
    void loadConfig();
  }, [configLoaded, loadConfig, tab]);

  const updateConfigObject = (update: (draft: Record<string, unknown>) => void) => {
    const parsed = parseXrayConfigObject(config);
    if (!parsed) {
      setError("当前 Xray 配置不是有效的 JSON 对象，请先在高级配置中修正");
      return;
    }
    update(parsed);
    setConfig(JSON.stringify(parsed, null, 2));
    setConfigDirty(true);
    setError("");
  };

  const selectXrayTab = (next: XraySettingsTab) => {
    if (next === "dns") setDNSDraft(JSON.stringify(xrayConfigSection(config, "dns"), null, 2));
    if (next !== "dns") setDNSDraftError("");
    setXrayTab(next);
  };

  const updateDNS = (value: string) => {
    setDNSDraft(value);
    try {
      const nextDNS = JSON.parse(value) as unknown;
      if (!nextDNS || typeof nextDNS !== "object" || Array.isArray(nextDNS)) throw new Error("DNS 配置必须是 JSON 对象");
      updateConfigObject((draft) => { draft.dns = nextDNS; });
      setDNSDraftError("");
    } catch (reason) {
      setDNSDraftError(messageFrom(reason, "DNS 配置不是有效的 JSON 对象"));
    }
  };

  const testConfig = async () => {
    setWorking("config-test");
    setError("");
    try {
      if (dnsDraftError) throw new Error(dnsDraftError);
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
      if (dnsDraftError) throw new Error(dnsDraftError);
      JSON.parse(config);
      assertSuccess(await api.post<ActionResponse>(`/api/admin/remote/xray/test-config?server_id=${server.id}`, { config, path: configPath }), "Xray 配置预检失败");
      assertSuccess(await api.post<ActionResponse>(`/api/admin/remote/xray/config?server_id=${server.id}`, { config, path: configPath }), "保存 Xray 配置失败");
      try {
        assertSuccess(await api.post<ActionResponse>(`/api/admin/remote/services/control?server_id=${server.id}`, { service: "xray", action: "restart" }), "Xray 重启失败");
      } catch (reason) {
        if (!savedConfig.trim()) throw new Error(`配置已写入，但 Xray 未能重启：${messageFrom(reason, "远端服务不可用")}`);
        try {
          assertSuccess(await api.post<ActionResponse>(`/api/admin/remote/xray/config?server_id=${server.id}`, { config: savedConfig, path: configPath }), "恢复旧配置失败");
          assertSuccess(await api.post<ActionResponse>(`/api/admin/remote/services/control?server_id=${server.id}`, { service: "xray", action: "restart" }), "恢复旧配置后重启失败");
          setConfig(savedConfig);
          setConfigDirty(false);
          setDNSDraft(JSON.stringify(xrayConfigSection(savedConfig, "dns"), null, 2));
          throw new Error(`新配置未能启动，已自动恢复旧配置：${messageFrom(reason, "远端服务不可用")}`);
        } catch (rollbackReason) {
          if (rollbackReason instanceof Error && rollbackReason.message.startsWith("新配置未能启动")) throw rollbackReason;
          throw new Error(`Xray 未能启动，自动恢复也失败：${messageFrom(rollbackReason, "请检查远端服务")}`);
        }
      }
      setConfigDirty(false);
      setSavedConfig(config);
      notify("Xray 配置已保存，服务已重启");
      await loadStatus();
      await onChanged();
    } catch (reason) {
      setError(messageFrom(reason, "保存 Xray 配置失败"));
    } finally {
      setWorking("");
    }
  };

  const restartXray = async () => {
    if (configDirty) {
      setError("存在未保存修改，请先保存配置再重启 Xray");
      return;
    }
    setWorking("config-restart");
    setError("");
    try {
      assertSuccess(await api.post<ActionResponse>(`/api/admin/remote/services/control?server_id=${server.id}`, { service: "xray", action: "restart" }), "Xray 重启失败");
      notify("Xray 已重启");
      await loadStatus();
      await onChanged();
    } catch (reason) {
      setError(messageFrom(reason, "Xray 重启失败"));
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
    { key: "speedtest", label: "Speedtest", icon: <Gauge size={16} /> },
    { key: "xray", label: "Xray 设置", icon: <Settings2 size={16} /> },
    ...(!server.is_federated ? [{ key: "sharing" as const, label: "服务器分享", icon: <Network size={16} /> }] : []),
  ];
  const xrayTabs: Array<{ key: XraySettingsTab; label: string; icon: ReactNode }> = [
    { key: "basic", label: "基础设置", icon: <Settings2 size={15} /> },
    { key: "routing", label: "路由规则", icon: <Network size={15} /> },
    { key: "outbounds", label: "出站规则", icon: <ArrowUpFromLine size={15} /> },
    { key: "dns", label: "DNS", icon: <Server size={15} /> },
    ...(!server.is_federated ? [{ key: "warp" as const, label: "WARP", icon: <Cloud size={15} /> }] : []),
    { key: "advanced", label: "高级配置", icon: <Code2 size={15} /> },
  ];
  const parsedConfig = parseXrayConfigObject(config);
  const basicSettings = parsedConfig ? readXrayBasicSettings(parsedConfig) : null;
  const accessLogOptions = [...new Set(["", "none", "./access.log", basicSettings?.accessLog || ""])];
  const errorLogOptions = [...new Set(["", "none", "./error.log", basicSettings?.errorLog || ""])];
  const routingConfig = xrayConfigSection(config, "routing");
  const routingRules = Array.isArray(routingConfig.rules) ? routingConfig.rules : [];
  const dnsConfig = xrayConfigSection(config, "dns");
  const dnsServers = Array.isArray(dnsConfig.servers) ? dnsConfig.servers : [];
  const confirmServiceLabel = confirm?.service === "xray" ? "Xray" : "Nginx";
  const confirmTitle = confirm?.action === "update" ? "更新 Xray" : confirm?.action === "remove" ? `卸载 ${confirmServiceLabel}` : `停止 ${confirmServiceLabel}`;
  const confirmDescription = confirm?.action === "update"
    ? `将通过目标服务器上的外置 Xray 安装程序更新或重装核心，${server.name} 的代理连接会短暂中断。`
    : confirm?.action === "remove"
      ? `将从 ${server.name} 卸载 ${confirmServiceLabel}，现有配置和节点可能立即不可用。`
      : `停止 ${confirmServiceLabel} 会中断由该服务承载的连接。`;
  const needsExtraWideDialog = tab === "xray";
  const agentUpgradeAvailable = Boolean(version?.upgrade_available && cleanVersion(version.latest) && !version.latest_error);
  const agentVersionCurrent = Boolean(version && !version.upgrade_available && cleanVersion(version.latest) && !version.latest_error);

  return <Dialog title={server.name} description={`${server.domain || server.ip_address || "地址待上报"} · ${isConnected(server) ? "Agent 在线" : "Agent 离线"}`} onClose={() => !working && onClose()} wide extraWide={needsExtraWideDialog}><div className="service-operation-tabs" role="tablist">{tabs.map((item) => <button key={item.key} role="tab" aria-selected={tab === item.key} className={tab === item.key ? "is-active" : ""} onClick={() => setTab(item.key)}>{item.icon}{item.label}</button>)}</div>{error ? <ErrorState message={error} onRetry={() => void (tab === "xray" ? loadConfig() : loadStatus())} /> : null}{loading ? <div className="center-state"><Spinner label="正在读取 Agent 状态" /></div> : null}
    {!loading && tab === "overview" ? <div className="service-overview"><div className="service-overview-grid"><InfoTile label="连接状态" value={isConnected(server) ? "在线" : "离线"} detail={server.encrypted ? "加密 WebSocket" : server.connection_mode} icon={<Wifi size={18} />} /><InfoTile label="Agent 版本" value={version?.current || system?.agent_version || "未知"} detail={version?.latest ? `最新 ${version.latest}` : version?.latest_error || "未读取最新版本"} icon={<UploadCloud size={18} />} /><InfoTile label="主机名" value={system?.hostname || server.name} detail={system?.uptime ? `运行 ${Math.floor(Number(system.uptime) / 3600)} 小时` : relativeTime(server.last_heartbeat)} icon={<Server size={18} />} /><InfoTile label="系统负载" value={system?.loadavg?.split(" ").slice(0, 3).join(" / ") || "暂无"} detail={system?.memory?.MemAvailable ? `可用内存 ${system.memory.MemAvailable}` : "Agent 未上报内存"} icon={<Gauge size={18} />} /></div><Surface className="service-address-panel"><h3>连接与流量</h3><dl><div><dt>IPv4</dt><dd>{server.ip_address || "未上报"}</dd></div><div><dt>IPv6</dt><dd>{server.ipv6_enabled ? server.ip_address_v6 || "未上报" : "已关闭"}</dd></div><div><dt>节点域名</dt><dd>{server.domain || "未设置"}</dd></div><div><dt>Agent 端口</dt><dd>{server.listen_port || 23889}</dd></div><div><dt>统计口径</dt><dd>{server.traffic_source === "system" ? "系统网卡" : "Xray 聚合"} / {server.traffic_stats_mode || "both"}</dd></div><div><dt>本期流量</dt><dd>{formatBytes(server.traffic_used)}{server.traffic_limit ? ` / ${formatBytes(server.traffic_limit)}` : "（不限）"}</dd></div></dl></Surface><DDNSOverviewPanel status={ddnsStatus} working={working === "ddns-test"} onRetry={() => void triggerDDNS()} /><div className="dialog-actions"><Button variant="secondary" onClick={() => void loadStatus()}><RefreshCw size={16} />刷新状态</Button><Button title={agentUpgradeAvailable ? `升级到 v${cleanVersion(version?.latest)}` : agentVersionCurrent ? "当前已是最新版" : version?.latest_error || "未读取到可用的新版本"} onClick={() => version && onUpgrade(version)} disabled={!isConnected(server) || !agentUpgradeAvailable}><UploadCloud size={16} />{agentUpgradeAvailable ? "升级 Agent" : agentVersionCurrent ? "已是最新版" : "暂不可升级"}</Button></div></div> : null}
    {!loading && tab === "services" ? <div className="service-control-stack">{reusesExistingNginx ? <div className="service-nginx-reuse-notice" role="note"><ShieldCheck size={18} /><span><strong>正在复用系统已有 Nginx</strong><small>Arcway 仅下发独立站点配置并执行预检与安全重载，不安装、不卸载、不覆盖主配置，也不接管服务启停。</small></span></div> : null}<ServiceControlCard name="Xray" state={status?.xray} fallbackVersion={server.xray_version} working={working} embeddedCore={server.xray_mode === "embedded"} allowCoreMaintenance={!server.is_federated} onAction={(action) => action === "stop" ? setConfirm({ service: "xray", action }) : void serviceAction("xray", action)} onUpdate={() => setConfirm({ service: "xray", action: "update" })} onRemove={() => setConfirm({ service: "xray", action: "remove" })} /><ServiceControlCard name="Nginx" state={status?.nginx} working={working} externallyManaged={reusesExistingNginx} onAction={(action) => action === "stop" ? setConfirm({ service: "nginx", action }) : void serviceAction("nginx", action)} onRemove={() => setConfirm({ service: "nginx", action: "remove" })} /></div> : null}
    {!loading && tab === "speedtest" ? <ServerSpeedtestPanel server={server} notify={notify} /> : null}
    {!loading && tab === "xray" ? <div className="xray-settings-shell">
      <div className="xray-settings-tabs" role="tablist" aria-label="Xray 设置分类">{xrayTabs.map((item) => <button key={item.key} role="tab" aria-selected={xrayTab === item.key} className={xrayTab === item.key ? "is-active" : ""} onClick={() => selectXrayTab(item.key)}>{item.icon}{item.label}</button>)}</div>
      {xrayTab === "routing" ? <XrayRoutingWorkbench serverId={server.id} notify={notify} /> : null}
      {xrayTab === "outbounds" ? <XrayResourcesWorkbench serverId={server.id} serverDomain={server.domain} serverIPv4={server.ip_address} serverIPv6={server.ip_address_v6} kind="outbound" notify={notify} /> : null}
      {xrayTab === "warp" && !server.is_federated ? <WarpManagement server={server} notify={notify} configDirty={configDirty} onChanged={async () => { await loadConfig(); await onChanged(); }} /> : null}
      {xrayTab === "basic" || xrayTab === "dns" || xrayTab === "advanced" ? <div className="service-config-panel">
        {!configLoaded ? <EmptyState icon={<Code2 size={23} />} title={working === "config-load" ? "正在读取 Xray 配置" : "暂未读取 Xray 配置"} description="配置直接来自目标服务器。" action={working === "config-load" ? <Spinner label="正在读取" /> : <Button onClick={() => void loadConfig()}><Clipboard size={16} />读取配置</Button>} /> : <>
          <div className="service-config-head xray-settings-toolbar"><span><strong>{configPath || "config.json"}</strong><small className={configDirty ? "is-dirty" : ""}>{configDirty ? "存在未保存更改" : "已与 Agent 同步"}</small></span><div><Button variant="ghost" onClick={() => void loadConfig()} disabled={Boolean(working)}><RefreshCw size={15} />重新读取</Button><Button variant="secondary" onClick={() => void testConfig()} disabled={Boolean(working) || !config.trim() || Boolean(dnsDraftError)}>{working === "config-test" ? <Spinner label="预检中" /> : <><ShieldCheck size={15} />预检</>}</Button><Button onClick={() => void saveConfig()} disabled={Boolean(working) || !configDirty || Boolean(dnsDraftError)}>{working === "config-save" ? <Spinner label="应用中" /> : <><Check size={15} />保存并应用</>}</Button><Button variant="secondary" title={configDirty ? "请先保存配置" : "重启当前 Xray 服务"} onClick={() => void restartXray()} disabled={Boolean(working) || configDirty}>{working === "config-restart" ? <Spinner label="重启中" /> : <><RotateCw size={15} />重启 Xray</>}</Button></div></div>
          {xrayTab === "basic" ? parsedConfig && basicSettings ? <div className="xray-basic-settings">
            <div className="xray-settings-summary"><div><small>Xray 状态</small><strong>{status?.xray?.running ? "运行中" : "已停止"}</strong></div><div><small>入站</small><strong>{xrayConfigArrayLength(parsedConfig.inbounds)}</strong></div><div><small>出站</small><strong>{xrayConfigArrayLength(parsedConfig.outbounds)}</strong></div><div><small>路由规则</small><strong>{routingRules.length}</strong></div><div><small>DNS 服务器</small><strong>{dnsServers.length}</strong></div></div>
            <details className="xray-settings-group" open><summary><span><strong>常规配置</strong><small>域名解析与路由匹配策略</small></span><ChevronDown size={17} /></summary><div className="xray-setting-list">
              <XraySettingRow title="Freedom 域名策略" description="控制 direct 出站解析域名时使用的 IP 类型"><select aria-label="Freedom 域名策略" value={basicSettings.freedomStrategy} onChange={(event) => updateConfigObject((draft) => setXrayFreedomStrategy(draft, event.target.value))}>{freedomDomainStrategies.map((strategy) => <option value={strategy} key={strategy}>{strategy}</option>)}</select></XraySettingRow>
              <XraySettingRow title="路由域名策略" description="决定路由匹配过程中何时解析域名"><select aria-label="路由域名策略" value={basicSettings.routingStrategy} onChange={(event) => updateConfigObject((draft) => setXrayRoutingStrategy(draft, event.target.value))}>{routingDomainStrategies.map((strategy) => <option value={strategy} key={strategy}>{strategy}</option>)}</select></XraySettingRow>
            </div></details>
            <details className="xray-settings-group"><summary><span><strong>流量统计</strong><small>Arcway 系统托管</small></span><ChevronDown size={17} /></summary><div className="xray-setting-list">
              <XraySettingRow title="入站上传统计" description="用于节点与用户流量核算"><Toggle checked={basicSettings.statsInboundUplink} disabled onChange={() => {}} label="入站上传统计" /></XraySettingRow>
              <XraySettingRow title="入站下载统计" description="用于节点与用户流量核算"><Toggle checked={basicSettings.statsInboundDownlink} disabled onChange={() => {}} label="入站下载统计" /></XraySettingRow>
              <XraySettingRow title="出站上传统计" description="由 Agent 根据统计口径维护"><Toggle checked={basicSettings.statsOutboundUplink} disabled onChange={() => {}} label="出站上传统计" /></XraySettingRow>
              <XraySettingRow title="出站下载统计" description="由 Agent 根据统计口径维护"><Toggle checked={basicSettings.statsOutboundDownlink} disabled onChange={() => {}} label="出站下载统计" /></XraySettingRow>
            </div></details>
            <details className="xray-settings-group"><summary><span><strong>日志</strong><small>级别、输出与隐私设置</small></span><ChevronDown size={17} /></summary><div className="xray-setting-list">
              <XraySettingRow title="日志级别"><select aria-label="Xray 日志级别" value={basicSettings.logLevel} onChange={(event) => updateConfigObject((draft) => setXrayLog(draft, "loglevel", event.target.value))}><option value="none">关闭日志</option><option value="debug">Debug</option><option value="info">Info</option><option value="warning">Warning</option><option value="error">Error</option></select></XraySettingRow>
              <XraySettingRow title="访问日志"><select aria-label="Xray 访问日志" value={basicSettings.accessLog} onChange={(event) => updateConfigObject((draft) => setXrayLog(draft, "access", event.target.value))}>{accessLogOptions.map((value) => <option value={value} key={value || "empty"}>{value || "使用 Xray 默认值"}</option>)}</select></XraySettingRow>
              <XraySettingRow title="错误日志"><select aria-label="Xray 错误日志" value={basicSettings.errorLog} onChange={(event) => updateConfigObject((draft) => setXrayLog(draft, "error", event.target.value))}>{errorLogOptions.map((value) => <option value={value} key={value || "empty"}>{value || "使用 Xray 默认值"}</option>)}</select></XraySettingRow>
              <XraySettingRow title="地址脱敏"><select aria-label="Xray 地址脱敏" value={basicSettings.maskAddress} onChange={(event) => updateConfigObject((draft) => setXrayLog(draft, "maskAddress", event.target.value))}><option value="">关闭</option><option value="quarter">隐藏四分之一</option><option value="half">隐藏一半</option><option value="full">完全隐藏</option></select></XraySettingRow>
              <XraySettingRow title="DNS 查询日志" description="将 Xray DNS 查询写入日志"><Toggle checked={basicSettings.dnsLog} onChange={(enabled) => updateConfigObject((draft) => setXrayLog(draft, "dnsLog", enabled))} label="DNS 查询日志" /></XraySettingRow>
            </div></details>
            <details className="xray-settings-group"><summary><span><strong>基础路由</strong><small>常用规则快捷设置</small></span><ChevronDown size={17} /></summary><div className="xray-setting-list">
              <XraySettingRow title="屏蔽 BitTorrent" description={`通过 ${basicSettings.blockOutboundTag} 出站拒绝 BitTorrent 流量`}><Toggle checked={basicSettings.torrentBlocked} onChange={(enabled) => updateConfigObject((draft) => setXrayTorrentBlocked(draft, enabled))} label="屏蔽 BitTorrent" /></XraySettingRow>
              <XrayTagPicker label="阻止 IP" description="匹配后交给黑洞出站" ariaLabel="添加阻止 IP 规则" values={basicSettings.blockedIPs} options={xrayIPPresets} onChange={(values) => updateConfigObject((draft) => setXrayBasicRule(draft, "blockedIPs", values))} />
              <XrayTagPicker label="阻止域名" description="广告与内容分类可直接选择" ariaLabel="添加阻止域名规则" values={basicSettings.blockedDomains} options={xrayBlockedDomainPresets} onChange={(values) => updateConfigObject((draft) => setXrayBasicRule(draft, "blockedDomains", values))} />
              <XrayTagPicker label="直接连接 IP" description="匹配后使用 direct 出站" ariaLabel="添加直连 IP 规则" values={basicSettings.directIPs} options={xrayIPPresets} onChange={(values) => updateConfigObject((draft) => setXrayBasicRule(draft, "directIPs", values))} />
              <XrayTagPicker label="直接连接域名" description="匹配后使用 direct 出站" ariaLabel="添加直连域名规则" values={basicSettings.directDomains} options={xrayDirectDomainPresets} onChange={(values) => updateConfigObject((draft) => setXrayBasicRule(draft, "directDomains", values))} />
              <XrayTagPicker label="强制 IPv4" description="自动使用 freedom / UseIPv4 出站" ariaLabel="添加强制 IPv4 域名规则" values={basicSettings.ipv4Domains} options={xrayServicePresets} onChange={(values) => updateConfigObject((draft) => setXrayBasicRule(draft, "ipv4Domains", values))} />
              {basicSettings.warpAvailable ? <XrayTagPicker label="WARP 路由" description="匹配后使用 warp 出站" ariaLabel="添加 WARP 域名规则" values={basicSettings.warpDomains} options={xrayServicePresets} onChange={(values) => updateConfigObject((draft) => setXrayBasicRule(draft, "warpDomains", values))} /> : null}
              {basicSettings.warpIPv4Available ? <XrayTagPicker label="WARP IPv4 路由" description="匹配后使用 warp-v4 出站" ariaLabel="添加 WARP IPv4 域名规则" values={basicSettings.warpIPv4Domains} options={xrayServicePresets} onChange={(values) => updateConfigObject((draft) => setXrayBasicRule(draft, "warpIPv4Domains", values))} /> : null}
              {basicSettings.warpIPv6Available ? <XrayTagPicker label="WARP IPv6 路由" description="匹配后使用 warp-v6 出站" ariaLabel="添加 WARP IPv6 域名规则" values={basicSettings.warpIPv6Domains} options={xrayServicePresets} onChange={(values) => updateConfigObject((draft) => setXrayBasicRule(draft, "warpIPv6Domains", values))} /> : null}
              {!server.is_federated && !basicSettings.warpAvailable && !basicSettings.warpIPv4Available && !basicSettings.warpIPv6Available ? <XraySettingRow title="WARP 路由" description="当前服务器尚未安装 WARP 出站"><Button variant="secondary" onClick={() => selectXrayTab("warp")}><Cloud size={15} />管理 WARP</Button></XraySettingRow> : null}
            </div></details>
            <details className="xray-settings-group"><summary><span><strong>恢复默认</strong><small>仅恢复本页基础项</small></span><ChevronDown size={17} /></summary><div className="xray-reset-panel"><TriangleAlert size={18} /><span><strong>恢复 Arcway 基础默认值</strong><small>数据库入站、DNS、自定义复杂路由和其他出站保持不变。</small></span><Button variant="secondary" onClick={() => setResetBasicConfirm(true)}>恢复基础默认值</Button></div></details>
          </div> : <ErrorState message="当前配置不是有效的 JSON 对象，请在高级配置中修正" /> : null}
          {xrayTab === "dns" ? <div className="xray-dns-settings">{dnsDraftError ? <ErrorState message={dnsDraftError} /> : null}<textarea className="service-code-editor xray-dns-editor" aria-label="Xray DNS JSON" spellCheck={false} value={dnsDraft} onChange={(event) => updateDNS(event.target.value)} /></div> : null}
          {xrayTab === "advanced" ? <textarea className="service-code-editor" aria-label="Xray 配置 JSON" spellCheck={false} value={config} onChange={(event) => { setConfig(event.target.value); setConfigDirty(true); }} /> : null}
        </>}
      </div> : null}
    </div> : null}
    {!loading && tab === "sharing" ? <div className="service-sharing"><form onSubmit={createShare} className="service-share-create"><Field label="令牌备注"><input required value={shareLabel} onChange={(event) => setShareLabel(event.target.value)} placeholder="提供给分控制端 A" /></Field><Button type="submit" disabled={working === "share-create"}>{working === "share-create" ? <Spinner label="生成中" /> : <><FileKey2 size={16} />生成分享令牌</>}</Button></form>{newShareToken ? <div className="credential-warning"><KeyRound size={19} /><span><strong>仅显示一次</strong><code>{newShareToken}</code></span><IconButton label="复制新分享令牌" onClick={() => navigator.clipboard.writeText(newShareToken).then(() => notify("分享令牌已复制")).catch(() => notify("复制失败", "error"))}><Copy size={17} /></IconButton></div> : null}<div className="service-share-list">{shares.length ? shares.map((share) => <div key={share.id}><span><strong>{share.label || `令牌 #${share.id}`}</strong><small>{share.revoked_at ? `已于 ${share.revoked_at} 吊销` : `创建于 ${share.created_at}`}</small></span><Badge tone={share.revoked_at ? "neutral" : "good"}>{share.revoked_at ? "已吊销" : "有效"}</Badge>{!share.revoked_at ? <IconButton label={`吊销 ${share.label || share.id}`} onClick={() => void revokeShare(share.id)} disabled={working === `share-${share.id}`}><Trash2 size={16} /></IconButton> : null}</div>) : <EmptyState icon={<FileKey2 size={22} />} title="暂无分享令牌" description="生成后可在其他 Arcway 控制端接入这台服务器" />}</div></div> : null}
    {confirm?.service === "xray" && confirm.action === "update" ? <XrayVersionDialog server={server} currentVersion={status?.xray?.version || server.xray_version} working={Boolean(working)} onCancel={() => !working && setConfirm(null)} onConfirm={(selectedVersion) => void serviceAction("xray", "update", selectedVersion)} /> : null}
    {confirm && !(confirm.service === "xray" && confirm.action === "update") ? <ConfirmDialog title={confirmTitle} description={confirmDescription} confirmLabel={confirm.action === "remove" ? "确认卸载" : "确认停止"} working={Boolean(working)} onCancel={() => !working && setConfirm(null)} onConfirm={() => void serviceAction(confirm.service, confirm.action)} /> : null}
    {resetBasicConfirm ? <ConfirmDialog title="恢复 Xray 基础默认值" description="只恢复常规策略、统计、日志和本页快捷路由；数据库入站、DNS、自定义复杂路由及其他出站不会改变。恢复后仍需保存并应用。" confirmLabel="确认恢复" working={false} onCancel={() => setResetBasicConfirm(false)} onConfirm={() => { updateConfigObject((draft) => applyXrayBasicDefaults(draft)); setResetBasicConfirm(false); }} /> : null}
    {terminal ? <RemoteServiceTerminalDialog terminal={terminal} onClose={() => !terminal.running && setTerminal(null)} /> : null}
  </Dialog>;
}

type XrayEditorMode = "create" | "view" | "edit";

function defaultXrayResource(kind: XrayResourceKind): XrayResource {
  if (kind === "inbound") {
    return { tag: "", listen: "0.0.0.0", port: 1080, protocol: "socks", settings: { auth: "noauth", udp: true } };
  }
  return { tag: "", protocol: "freedom", settings: {} };
}

function XrayResourcesWorkbench({ serverId, serverDomain = "", serverIPv4 = "", serverIPv6 = "", nginxMode = "managed", kind, notify }: { serverId: number; serverDomain?: string; serverIPv4?: string; serverIPv6?: string; nginxMode?: NginxMode; kind: XrayResourceKind; notify: Notify }) {
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
  const [outboundEditorTab, setOutboundEditorTab] = useState<OutboundEditorTab>("basics");
  const [outboundFields, setOutboundFields] = useState<OutboundEditorFields>(() => outboundEditorDefaults());
  const [creationPreset, setCreationPreset] = useState<InboundCreationPreset>("advanced");
  const [secureDraft, setSecureDraft] = useState<SecureInboundDraft>(() => newSecureInboundDraft());
  const [trojanDraft, setTrojanDraft] = useState<TrojanInboundDraft>(() => newTrojanInboundDraft());
  const [wireGuardDraft, setWireGuardDraft] = useState<WireGuardInboundDraft>(() => newWireGuardInboundDraft());
  const [wireGuardCreated, setWireGuardCreated] = useState<WireGuardCreatedState | null>(null);
  const [certificates, setCertificates] = useState<ManagedCertificateOption[]>([]);
  const [certificatesLoading, setCertificatesLoading] = useState(false);
  const [certificatesError, setCertificatesError] = useState("");
  const [examples, setExamples] = useState<XrayProtocolCombination[]>([]);
  const [examplesLoading, setExamplesLoading] = useState(false);
  const [examplesError, setExamplesError] = useState("");
  const [realityDomains, setRealityDomains] = useState<RealityDomainProbe[]>([]);
  const [domainsLoading, setDomainsLoading] = useState(false);
  const [domainsError, setDomainsError] = useState("");
  const [keyWorking, setKeyWorking] = useState<"reality" | "encryption" | "">("");
  const [trojanKeyWorking, setTrojanKeyWorking] = useState(false);
  const [wireGuardKeyWorking, setWireGuardKeyWorking] = useState(false);
  const wireGuardKeyGeneration = useRef(0);
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
  useEffect(() => () => { wireGuardKeyGeneration.current += 1; }, []);

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

  const loadCertificates = useCallback(async () => {
    setCertificatesLoading(true);
    setCertificatesError("");
    try {
      const result = assertSuccess(await api.get<ValidCertificatesResponse>("/api/admin/certificates/valid"), "读取托管证书失败");
      const available = (result.certificates ?? []).filter((certificate) => {
        const owner = Number(certificate.remote_server_id) || 0;
        return owner === 0 || owner === serverId;
      });
      setCertificates(available);
      const matchingCertificate = available.find((certificate) => certificateMatchesHost(certificate, serverDomain));
      setTrojanDraft((current) => current.certificateId || available.length === 0
        ? current
        : { ...current, certificateId: matchingCertificate ? String(matchingCertificate.id) : "" });
    } catch (reason) {
      setCertificatesError(messageFrom(reason, "托管证书暂不可用"));
    } finally {
      setCertificatesLoading(false);
    }
  }, [serverDomain, serverId]);

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

  const generateTrojanRealityKeys = useCallback(async () => {
    setTrojanKeyWorking(true);
    setEditorError("");
    try {
      const result = assertSuccess(await api.post<X25519Response>("/api/admin/xray/generate-x25519"), "生成 Trojan Reality 密钥失败");
      if (!result.privateKey || !result.publicKey) throw new Error("服务端未返回完整的 X25519 密钥对");
      setTrojanDraft((current) => ({ ...current, privateKey: result.privateKey ?? "", publicKey: result.publicKey ?? "" }));
    } catch (reason) {
      setEditorError(messageFrom(reason, "生成 Trojan Reality 密钥失败"));
    } finally {
      setTrojanKeyWorking(false);
    }
  }, []);

  const generateWireGuardKeys = useCallback(async () => {
    const generation = ++wireGuardKeyGeneration.current;
    setWireGuardKeyWorking(true);
    setEditorError("");
    try {
      const [serverPair, clientPair] = await Promise.all([
        generateWireGuardKeyPair(),
        generateWireGuardKeyPair(),
      ]);
      if (!serverPair.privateKey || !serverPair.publicKey || !clientPair.privateKey || !clientPair.publicKey) {
        throw new Error("浏览器未生成两组完整的 WireGuard 密钥对");
      }
      if (wireGuardKeyGeneration.current !== generation) return;
      setWireGuardDraft((current) => ({
        ...current,
        serverPrivateKey: serverPair.privateKey,
        serverPublicKey: serverPair.publicKey,
        clientPrivateKey: clientPair.privateKey,
        clientPublicKey: clientPair.publicKey,
      }));
    } catch (reason) {
      if (wireGuardKeyGeneration.current === generation) {
        setEditorError(messageFrom(reason, "生成 WireGuard 密钥失败"));
      }
    } finally {
      if (wireGuardKeyGeneration.current === generation) setWireGuardKeyWorking(false);
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
    wireGuardKeyGeneration.current += 1;
    setWireGuardKeyWorking(false);
    const value = cleanXrayResource(resource ?? defaultXrayResource(kind));
    setEditor({ mode, original: resource });
    const secureCreate = kind === "inbound" && mode === "create";
    setCreationPreset(secureCreate ? "reality" : "advanced");
    setSecureDraft(newSecureInboundDraft());
    setTrojanDraft(newTrojanInboundDraft(serverDomain));
    setWireGuardDraft(newWireGuardInboundDraft());
    setWireGuardCreated(null);
    setTag(secureCreate ? "vless-reality" : xrayResourceTag(value));
    setProtocol(secureCreate ? "vless" : xrayResourceProtocol(value));
    setListen(secureCreate ? "0.0.0.0" : typeof value.listen === "string" ? value.listen : "");
    setPort(secureCreate ? "443" : typeof value.port === "number" || typeof value.port === "string" ? String(value.port) : "");
    setJsonDraft(JSON.stringify(value, null, 2));
    setOutboundEditorTab("basics");
    setOutboundFields(kind === "outbound" ? outboundEditorFieldsFrom(value) : outboundEditorDefaults());
    setEditorError("");
    setExamplesError("");
    setDomainsError("");
    setCertificatesError("");
    if (secureCreate) {
      void loadExamples();
      void loadRealityDomains();
      void generateRealityKeys();
    }
  };

  const selectCreationPreset = (preset: InboundCreationPreset) => {
    if (preset !== "wireguard") {
      wireGuardKeyGeneration.current += 1;
      setWireGuardKeyWorking(false);
    }
    setCreationPreset(preset);
    setEditorError("");
    setWireGuardCreated(null);
    if (preset === "advanced") {
      const value = defaultXrayResource("inbound");
      setTag(xrayResourceTag(value));
      setProtocol(xrayResourceProtocol(value));
      setListen(String(value.listen ?? ""));
      setPort(String(value.port ?? ""));
      setJsonDraft(JSON.stringify(value, null, 2));
      return;
    }
    const generatedTags = new Set(["vless-reality", "vless-wss", "wireguard-in", "trojan-in"]);
    if (preset === "wireguard") {
      setTag((current) => !current || generatedTags.has(current) ? "wireguard-in" : current);
      setProtocol("wireguard");
      setListen("0.0.0.0");
      setPort("51820");
      if (!validWireGuardKey(wireGuardDraft.serverPrivateKey) || !validWireGuardKey(wireGuardDraft.clientPrivateKey)) {
        void generateWireGuardKeys();
      }
      return;
    }
    if (preset === "trojan") {
      setTag((current) => !current || generatedTags.has(current) ? "trojan-in" : current);
      setProtocol("trojan");
      setListen(trojanDraft.combination === "ws-tls" ? "127.0.0.1" : "0.0.0.0");
      setPort(trojanDraft.combination === "tcp-tls" || trojanDraft.combination === "grpc-tls" ? "8443" : "443");
      setTrojanDraft((current) => ({ ...current, domain: current.domain || serverDomain.trim().toLowerCase() }));
      if (trojanDraft.combination === "tcp-tls" || trojanDraft.combination === "grpc-tls") void loadCertificates();
      return;
    }
    setTag((current) => !current || generatedTags.has(current) ? `vless-${preset}` : current);
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

  const selectTrojanCombination = (combination: TrojanCombination) => {
    setEditorError("");
    setTrojanDraft((current) => ({
      ...current,
      combination,
      domain: combination === "tcp-reality" ? "" : current.domain || serverDomain.trim().toLowerCase(),
    }));
    setListen(combination === "ws-tls" ? "127.0.0.1" : "0.0.0.0");
    setPort(combination === "tcp-tls" || combination === "grpc-tls" ? "8443" : "443");
    if (combination === "tcp-tls" || combination === "grpc-tls") void loadCertificates();
    if (combination === "tcp-reality") {
      void loadRealityDomains();
      if (!trojanDraft.privateKey || !trojanDraft.publicKey) void generateTrojanRealityKeys();
    }
  };

  const closeEditor = () => {
    if (working) return;
    wireGuardKeyGeneration.current += 1;
    setWireGuardKeyWorking(false);
    setEditor(null);
    setEditorError("");
    setWireGuardCreated(null);
    setWireGuardDraft(newWireGuardInboundDraft());
  };

  const copyGenerated = async (value: string, copyLabel: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(`${copyLabel}已复制`);
    } catch {
      notify("复制失败，请手动选择", "error");
    }
  };

  const matchingExample = useMemo(() => {
    if (creationPreset !== "reality" && creationPreset !== "wss") return undefined;
    return examples.find((item) => {
      const signature = `${item.dir_name} ${item.transport} ${item.security}`.toLowerCase();
      if (!item.has_config || item.protocol.toLowerCase() !== "vless") return false;
      return creationPreset === "reality"
        ? signature.includes("reality")
        : (signature.includes("ws") || signature.includes("websocket")) && (signature.includes("tls") || signature.includes("nginx") || signature.includes("caddy"));
    });
  }, [creationPreset, examples]);

  const wireGuardFields = useMemo<WireGuardInboundFields>(() => ({ ...wireGuardDraft, tag, port }), [port, tag, wireGuardDraft]);
  const trojanFields = useMemo<TrojanInboundFields>(() => ({ ...trojanDraft, tag, port }), [port, tag, trojanDraft]);
  const wireGuardEndpoint = serverDomain.trim() || serverIPv4.trim() || serverIPv6.trim();
  const wireGuardEndpointDisplay = wireGuardEndpoint.includes(":") && !wireGuardEndpoint.startsWith("[") ? `[${wireGuardEndpoint}]` : wireGuardEndpoint;
  const setOutboundField = <K extends keyof OutboundEditorFields>(key: K, value: OutboundEditorFields[K]) => {
    setOutboundFields((current) => ({ ...current, [key]: value }));
  };
  const selectOutboundProtocol = (next: string) => {
    setProtocol(next);
    setOutboundFields((current) => ({
      ...current,
      protocol: next,
      network: next === "dns" && current.protocol !== "dns"
        ? "tcp"
        : current.protocol === "dns" && next !== "dns"
          ? "tcp"
          : current.network,
      encryption: next === "vmess" && current.protocol !== "vmess"
        ? "auto"
        : next === "vless" && current.protocol !== "vless"
          ? "none"
          : current.encryption,
    }));
  };

  const securePreview = useMemo(() => {
    if (kind !== "inbound" || editor?.mode !== "create" || creationPreset === "advanced") return "";
    try {
      const resource = creationPreset === "wireguard"
        ? buildWireGuardInbound(wireGuardFields)
        : creationPreset === "trojan"
          ? buildTrojanInbound(trojanFields)
          : buildSecureInbound(creationPreset, { tag, port }, secureDraft);
      return JSON.stringify(resource, null, 2);
    } catch {
      return "";
    }
  }, [creationPreset, editor?.mode, kind, port, secureDraft, tag, trojanFields, wireGuardFields]);

  const parseDraft = (): XrayResource => {
    if (kind === "inbound" && editor?.mode === "create" && creationPreset !== "advanced") {
      if (creationPreset === "wireguard") return buildWireGuardInbound(wireGuardFields);
      if (creationPreset === "trojan") return buildTrojanInbound(trojanFields);
      return buildSecureInbound(creationPreset, { tag, port }, secureDraft);
    }
    if (kind === "outbound" && outboundEditorTab === "basics") {
      return buildOutboundFromEditor({ ...outboundFields, tag, protocol }, jsonDraft);
    }
    const parsed = JSON.parse(jsonDraft) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label}配置必须是 JSON 对象`);
    const resource = cleanXrayResource(parsed as XrayResource);
    const normalizedTag = tag.trim();
    const normalizedProtocol = protocol.trim();
    if (!normalizedTag) throw new Error("Tag 不能为空");
    if (!normalizedProtocol) throw new Error("协议不能为空");
    if (kind === "inbound" && editor?.mode === "create" && normalizedProtocol.toLowerCase() === "snell") throw new Error("Snell 当前不在支持范围内");
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
    let generatedWireGuardClientConfig = "";
    try {
      resource = parseDraft();
      if (kind === "inbound" && editor.mode === "create" && creationPreset === "wireguard") {
        generatedWireGuardClientConfig = buildWireGuardClientConfig(wireGuardFields, wireGuardEndpoint);
      }
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
      } else if (kind === "inbound" && editor.mode === "create" && creationPreset === "wireguard") {
        const response = await api.post<WireGuardCreateResponse>(`/api/admin/managed-inbound-resources/wireguard?server_id=${serverId}`, {
          action: "add",
          display_name: tag.trim(),
          inbound: resource,
          client: buildWireGuardClientProfile(wireGuardFields),
        });
        assertSuccess(response, `创建${label}失败`);
        if (!(response.node_id ?? response.node?.id)) throw new Error("WireGuard 创建完成但控制端未返回节点记录");
        generatedWireGuardClientConfig = response.client_config || generatedWireGuardClientConfig;
      } else {
        assertSuccess(await api.post<ActionResponse>(endpoint, { action: "add", [kind]: resource }), `创建${label}失败`);
      }
      notify(editor.mode === "edit" ? `${label}已更新` : `${label}已创建`);
      if (editor.mode === "create" && creationPreset === "wireguard") {
        setWireGuardCreated({
          serverPublicKey: wireGuardFields.serverPublicKey,
          clientConfig: generatedWireGuardClientConfig,
        });
      } else {
        setEditor(null);
      }
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
    ? ["vless", "vmess", "trojan", "shadowsocks", "socks", "http", "dokodemo-door", "wireguard", "hysteria2", "anytls"]
    : ["freedom", "blackhole", "vless", "vmess", "trojan", "shadowsocks", "socks", "http", "wireguard", "dns"];

  return <div className="xray-resource-workbench">
    <div className="xray-resource-head">
      <span><strong>{label}管理</strong><small>目标服务器 #{serverId} · {items.length} 项</small></span>
      <div><Button variant="ghost" onClick={() => void load()} disabled={loading || working}><RefreshCw size={15} />刷新</Button><Button onClick={() => openEditor("create")} disabled={working}><Plus size={16} />添加{label}</Button></div>
    </div>
    {listError ? <ErrorState message={listError} onRetry={() => void load()} /> : null}
    {loading ? <div className="center-state"><Spinner label={`正在加载${label}`} /></div> : items.length === 0 ? <EmptyState icon={kind === "inbound" ? <ArrowDownToLine size={23} /> : <ArrowUpFromLine size={23} />} title={`暂无${label}`} description={`此列表直接读取服务器 #${serverId} 当前 Xray 配置`} action={<Button onClick={() => openEditor("create")}><Plus size={16} />添加{label}</Button>} /> : kind === "outbound" ? <div className="xray3-table-wrap" role="region" aria-label="出站列表"><table className="xray3-table xray3-outbound-table"><thead><tr><th>#</th><th>Tag</th><th>协议</th><th>目标</th><th>传输</th><th>安全</th><th aria-label="操作" /></tr></thead><tbody>
      {items.map((item, index) => {
        const itemTag = xrayResourceTag(item);
        const itemProtocol = xrayResourceProtocol(item);
        const generated = item._generated_tag === true;
        const transport = outboundTransportSummary(item);
        return <tr key={`${itemTag}-${index}`}><td><span className="xray3-rule-order"><strong>{index + 1}</strong></span></td><td><strong className="xray3-primary">{itemTag || "未命名出站"}</strong></td><td><Badge tone="info">{itemProtocol || "未知"}</Badge></td><td title={outboundTargetSummary(item)}>{outboundTargetSummary(item)}</td><td>{transport.network}</td><td><Badge tone={transport.security === "NONE" ? "neutral" : "good"}>{transport.security}</Badge></td><td><div className="xray3-row-actions"><IconButton label={`查看出站 ${itemTag || index + 1}`} onClick={() => openEditor("view", item)}><Eye size={15} /></IconButton><IconButton label={`编辑出站 ${itemTag || index + 1}`} onClick={() => openEditor("edit", item)} disabled={!itemTag || generated || working}><Pencil size={15} /></IconButton><IconButton label={`删除出站 ${itemTag || index + 1}`} onClick={() => setDeleting(item)} disabled={!itemTag || generated || working}><Trash2 size={15} /></IconButton></div></td></tr>;
      })}
    </tbody></table></div> : <div className="xray-resource-list" role="list" aria-label={`${label}列表`}>
      {items.map((item, index) => {
        const itemTag = xrayResourceTag(item);
        const itemProtocol = xrayResourceProtocol(item);
        const generated = item._generated_tag === true;
        const runtime = item._runtime_status === "running";
        const protectedWireGuard = kind === "inbound" && itemProtocol.toLowerCase() === "wireguard";
        const editLabel = protectedWireGuard
          ? `WireGuard 入站 ${itemTag || index + 1} 不能直接编辑，请删除后重新创建`
          : `编辑${label} ${itemTag || index + 1}`;
        return <Surface className="xray-resource-row" key={`${itemTag}-${index}`}><span className="xray-resource-icon">{kind === "inbound" ? <ArrowDownToLine size={17} /> : <ArrowUpFromLine size={17} />}</span><span className="xray-resource-main"><strong>{itemTag || `未命名${label}`}</strong><small>{itemProtocol || "未知协议"}{kind === "inbound" && item.port ? ` · ${String(item.listen || "0.0.0.0")}:${String(item.port)}` : ""}</small></span>{kind === "inbound" ? <Badge tone={runtime ? "good" : "warn"}>{runtime ? "运行中" : item._source === "runtime_only" ? "仅运行时" : "未运行"}</Badge> : null}<div className="xray-resource-actions"><Button variant="ghost" onClick={() => openEditor("view", item)}><Eye size={15} />查看</Button><IconButton label={editLabel} onClick={() => openEditor("edit", item)} disabled={!itemTag || generated || protectedWireGuard || working}><Pencil size={15} /></IconButton><IconButton label={`删除${label} ${itemTag || index + 1}`} onClick={() => setDeleting(item)} disabled={!itemTag || generated || working}><Trash2 size={15} /></IconButton></div></Surface>;
      })}
    </div>}
    {editor ? <Dialog title={editor.mode === "create" ? `添加${label}` : editor.mode === "edit" ? `编辑${label}` : `${label}详情`} description={editor.mode === "edit" ? "保存时会安全重建，失败自动回滚" : editor.mode === "view" ? "只读查看服务器返回的完整配置" : kind === "inbound" && creationPreset !== "advanced" ? "安全向导生成完整的 Xray 入站配置" : "基础字段会覆盖高级 JSON 中的同名字段"} onClose={closeEditor} dismissible={!working && !wireGuardCreated} wide={!wireGuardCreated} extraWide={Boolean(wireGuardCreated)}><div className="xray-resource-dialog">
      {kind === "inbound" && editor.mode === "create" ? <div className="secure-inbound-presets" role="tablist" aria-label="入站创建方式">
        <button type="button" role="tab" disabled={working || Boolean(wireGuardCreated)} aria-selected={creationPreset === "reality"} className={creationPreset === "reality" ? "is-active" : ""} onClick={() => selectCreationPreset("reality")}><ShieldCheck size={16} /><span><strong>VLESS + Reality</strong><small>xtls-rprx-vision · X25519</small></span></button>
        <button type="button" role="tab" disabled={working || Boolean(wireGuardCreated)} aria-selected={creationPreset === "wss"} className={creationPreset === "wss" ? "is-active" : ""} onClick={() => selectCreationPreset("wss")}><Cloud size={16} /><span><strong>VLESS + WS + TLS</strong><small>Nginx · 443</small></span></button>
        <button type="button" role="tab" disabled={working || Boolean(wireGuardCreated)} aria-selected={creationPreset === "wireguard"} className={creationPreset === "wireguard" ? "is-active" : ""} onClick={() => selectCreationPreset("wireguard")}><Network size={16} /><span><strong>WireGuard</strong><small>Xray 原生入站</small></span></button>
        <button type="button" role="tab" disabled={working || Boolean(wireGuardCreated)} aria-selected={creationPreset === "trojan"} className={creationPreset === "trojan" ? "is-active" : ""} onClick={() => selectCreationPreset("trojan")}><ShieldCheck size={16} /><span><strong>Trojan</strong><small>TLS · WS · gRPC · Reality</small></span></button>
        <button type="button" role="tab" disabled={working || Boolean(wireGuardCreated)} aria-selected={creationPreset === "advanced"} className={creationPreset === "advanced" ? "is-active" : ""} onClick={() => selectCreationPreset("advanced")}><Code2 size={16} /><span><strong>高级 JSON</strong><small>全部协议</small></span></button>
      </div> : null}
      {editorError ? <ErrorState message={editorError} /> : null}
      {wireGuardCreated ? <div className="wireguard-created-state" role="status" aria-label="WireGuard 已创建">
        <div className="wireguard-created-head"><span><Check size={18} /></span><div><strong>WireGuard 节点已创建</strong><small>客户端凭据已加密存储，可在节点管理、套餐和订阅中正常使用。</small></div></div>
        <Field label="WireGuard 服务端公钥"><div className="generated-secret"><code>{wireGuardCreated.serverPublicKey}</code><IconButton type="button" label="复制 WireGuard 服务端公钥" onClick={() => void copyGenerated(wireGuardCreated.serverPublicKey, "服务端公钥")}><Copy size={16} /></IconButton></div></Field>
        <Field label="WireGuard 客户端配置"><div className="wireguard-client-config"><textarea className="service-code-editor" aria-label="WireGuard 客户端配置" readOnly value={wireGuardCreated.clientConfig} /><IconButton type="button" label="复制 WireGuard 客户端配置" onClick={() => void copyGenerated(wireGuardCreated.clientConfig, "客户端配置")}><Copy size={16} /></IconButton></div></Field>
        <div className="dialog-actions"><Button type="button" onClick={closeEditor}><Check size={16} />完成</Button></div>
      </div> : editor.mode === "view" ? <textarea className="service-code-editor xray-resource-json" aria-label={`${label}只读 JSON`} readOnly value={jsonDraft} /> : <form className="form-stack" onSubmit={submit}>
        {kind === "inbound" && editor.mode === "create" && creationPreset !== "advanced" ? <>
          <div className="secure-inbound-reference"><span><Badge tone={creationPreset === "wireguard" || creationPreset === "trojan" ? "good" : matchingExample ? "good" : examplesError ? "warn" : "neutral"}>{creationPreset === "wireguard" ? "Xray 原生" : creationPreset === "trojan" ? "常用组合" : examplesLoading ? "模板读取中" : matchingExample ? "官方模板" : "内置模板"}</Badge><strong>{creationPreset === "wireguard" ? "WireGuard 入站与客户端配置" : creationPreset === "trojan" ? "Trojan 安全传输向导" : matchingExample?.dir_name || (creationPreset === "reality" ? "VLESS TCP Reality" : "VLESS WSS")}</strong></span>{creationPreset !== "wireguard" && creationPreset !== "trojan" && examplesError ? <small>{examplesError}</small> : null}</div>
          {nginxMode === "reuse_existing" && (creationPreset === "wss" || (creationPreset === "trojan" && trojanDraft.combination === "ws-tls")) ? <div className="service-nginx-reuse-notice" role="note"><ShieldCheck size={17} /><span><strong>此入站将复用系统已有 Nginx</strong><small>Arcway 只添加独立站点配置并安全重载，不会覆盖主配置或接管 Nginx 服务。</small></span></div> : null}
          <div className="form-grid two"><Field label="Tag"><input required aria-label="入站 Tag" value={tag} onChange={(event) => setTag(event.target.value)} placeholder={creationPreset === "wireguard" ? "wireguard-in" : creationPreset === "trojan" ? "trojan-in" : creationPreset === "reality" ? "vless-reality" : "vless-wss"} /></Field><Field label={creationPreset === "wss" || (creationPreset === "trojan" && trojanDraft.combination === "ws-tls") ? "外部 TLS 端口" : "监听端口"}><input type="number" min="1" max="65535" required aria-label="入站监听端口" value={port} onChange={(event) => setPort(event.target.value)} /></Field></div>
          {creationPreset === "wireguard" ? <>
            <div className="secure-key-status wireguard-key-status"><span><Badge tone={validWireGuardKey(wireGuardDraft.serverPrivateKey) && validWireGuardKey(wireGuardDraft.clientPrivateKey) ? "good" : "warn"}>{validWireGuardKey(wireGuardDraft.serverPrivateKey) && validWireGuardKey(wireGuardDraft.clientPrivateKey) ? "两组密钥已生成" : "密钥未就绪"}</Badge><small>客户端凭据将由控制端加密存储</small></span><Button type="button" variant="secondary" disabled={wireGuardKeyWorking} onClick={() => void generateWireGuardKeys()}>{wireGuardKeyWorking ? <Spinner label="生成中" /> : <><KeyRound size={15} />重新生成密钥</>}</Button></div>
            <div className="form-grid two"><Field label="服务端隧道地址"><input required aria-label="WireGuard 服务端地址" value={wireGuardDraft.serverAddress} onChange={(event) => setWireGuardDraft((current) => ({ ...current, serverAddress: event.target.value }))} /></Field><Field label="客户端隧道地址"><input required aria-label="WireGuard 客户端地址" value={wireGuardDraft.clientAddress} onChange={(event) => setWireGuardDraft((current) => ({ ...current, clientAddress: event.target.value }))} /></Field></div>
            <div className="form-grid three"><Field label="客户端 DNS"><input aria-label="WireGuard 客户端 DNS" value={wireGuardDraft.dns} onChange={(event) => setWireGuardDraft((current) => ({ ...current, dns: event.target.value }))} /></Field><Field label="MTU"><input type="number" min="576" max="9000" aria-label="WireGuard MTU" value={wireGuardDraft.mtu} onChange={(event) => setWireGuardDraft((current) => ({ ...current, mtu: event.target.value }))} /></Field><Field label="Keepalive"><input type="number" min="0" max="65535" aria-label="WireGuard Keepalive" value={wireGuardDraft.keepAlive} onChange={(event) => setWireGuardDraft((current) => ({ ...current, keepAlive: event.target.value }))} /></Field></div>
            <div className="form-grid two"><Field label="服务端公钥"><div className="generated-secret"><code>{wireGuardDraft.serverPublicKey || "生成中..."}</code></div></Field><Field label="客户端 Endpoint" hint="按节点域名、IPv4、IPv6 的顺序选择"><input aria-label="WireGuard 客户端 Endpoint" readOnly value={wireGuardEndpointDisplay ? `${wireGuardEndpointDisplay}:${port}` : "服务器尚未上报可连接地址"} /></Field></div>
          </> : creationPreset === "trojan" ? <>
            <div className="form-grid two"><Field label="传输与安全"><select aria-label="Trojan 传输与安全" value={trojanDraft.combination} onChange={(event) => selectTrojanCombination(event.target.value as TrojanCombination)}><option value="tcp-tls">TCP + TLS</option><option value="ws-tls">WebSocket + TLS（Nginx）</option><option value="grpc-tls">gRPC + TLS</option><option value="tcp-reality">TCP + Reality</option></select></Field><Field label="Trojan 密码"><div className="secure-field-action"><input required aria-label="Trojan 密码" value={trojanDraft.password} onChange={(event) => setTrojanDraft((current) => ({ ...current, password: event.target.value }))} /><IconButton type="button" label="重新生成 Trojan 密码" onClick={() => setTrojanDraft((current) => ({ ...current, password: randomHex(32) }))}><RefreshCw size={15} /></IconButton></div></Field></div>
            <Field label={trojanDraft.combination === "tcp-reality" ? "Reality 伪装目标 / SNI" : "TLS 节点域名"} hint={trojanDraft.combination === "ws-tls" ? "使用服务器域名，由 Nginx 终止 TLS" : undefined}><div className="secure-field-action"><input required aria-label={trojanDraft.combination === "tcp-reality" ? "Trojan Reality 伪装目标 / SNI" : "Trojan TLS 节点域名"} list={trojanDraft.combination === "tcp-reality" ? `trojan-reality-domains-${serverId}` : undefined} readOnly={trojanDraft.combination === "ws-tls"} value={trojanDraft.domain} onChange={(event) => setTrojanDraft((current) => ({ ...current, domain: event.target.value.trim().toLowerCase() }))} placeholder="edge.example.com" />{trojanDraft.combination === "tcp-reality" ? <IconButton type="button" label="重新探测 Trojan Reality 域名" disabled={domainsLoading} onClick={() => void loadRealityDomains()}>{domainsLoading ? <Spinner /> : <RefreshCw size={15} />}</IconButton> : null}</div></Field>
            {trojanDraft.combination === "tcp-tls" || trojanDraft.combination === "grpc-tls" ? <Field label="托管 TLS 证书" hint="仅显示主控通用证书和当前服务器证书"><select required aria-label="Trojan TLS 证书" value={trojanDraft.certificateId || ""} onChange={(event) => setTrojanDraft((current) => ({ ...current, certificateId: event.target.value }))}><option value="">{certificatesLoading ? "正在读取证书..." : "请选择证书"}</option>{certificates.map((certificate) => <option key={certificate.id} value={certificate.id}>{certificate.domain} · {Number(certificate.remote_server_id) ? certificate.remote_server_name || `服务器 #${certificate.remote_server_id}` : "主控通用"}</option>)}</select>{certificatesError ? <small className="secure-inline-error">{certificatesError}</small> : null}</Field> : null}
            {trojanDraft.combination === "ws-tls" ? <Field label="WebSocket 路径" hint="Agent 保存时会安全随机化最终路径"><input required aria-label="Trojan WebSocket 路径" value={trojanDraft.path || ""} onChange={(event) => setTrojanDraft((current) => ({ ...current, path: event.target.value }))} /></Field> : null}
            {trojanDraft.combination === "grpc-tls" ? <Field label="gRPC Service Name"><input required aria-label="Trojan gRPC Service Name" value={trojanDraft.serviceName || ""} onChange={(event) => setTrojanDraft((current) => ({ ...current, serviceName: event.target.value }))} /></Field> : null}
            {trojanDraft.combination === "tcp-reality" ? <>
              <datalist id={`trojan-reality-domains-${serverId}`}>{realityDomains.map((item) => <option key={item.domain} value={item.domain}>{item.success ? `443 可达 · ${item.latency_ms ?? "-"} ms` : item.error || "探测失败"}</option>)}</datalist>
              {domainsError ? <small className="secure-inline-error">{domainsError}</small> : null}
              <div className="form-grid two"><Field label="Reality Short ID"><input required aria-label="Trojan Reality Short ID" value={trojanDraft.shortId || ""} onChange={(event) => setTrojanDraft((current) => ({ ...current, shortId: event.target.value.trim().toLowerCase() }))} /></Field><Field label="Reality X25519 密钥"><div className="secure-key-status"><Badge tone={validRealityKey(trojanDraft.privateKey || "") && validRealityKey(trojanDraft.publicKey || "") ? "good" : "warn"}>{validRealityKey(trojanDraft.privateKey || "") && validRealityKey(trojanDraft.publicKey || "") ? "已生成" : "未就绪"}</Badge><Button type="button" variant="secondary" disabled={trojanKeyWorking} onClick={() => void generateTrojanRealityKeys()}>{trojanKeyWorking ? <Spinner label="生成中" /> : <><KeyRound size={15} />重新生成</>}</Button></div></Field></div>
              <Field label="Reality 客户端公钥"><div className="generated-secret"><code>{trojanDraft.publicKey || "生成中..."}</code>{trojanDraft.publicKey ? <IconButton type="button" label="复制 Trojan Reality 公钥" onClick={() => void copyGenerated(trojanDraft.publicKey || "", "Reality 公钥")}><Copy size={16} /></IconButton> : null}</div></Field>
            </> : null}
          </> : <>
            <div className="form-grid two"><Field label="客户端 UUID"><div className="secure-field-action"><input required aria-label="客户端 UUID" value={secureDraft.uuid} onChange={(event) => setSecureDraft({ ...secureDraft, uuid: event.target.value.trim() })} /><IconButton type="button" label="重新生成客户端 UUID" onClick={() => setSecureDraft({ ...secureDraft, uuid: createUUID() })}><RefreshCw size={15} /></IconButton></div></Field><Field label={creationPreset === "reality" ? "Reality 伪装目标 / SNI" : "TLS 节点域名"} hint={creationPreset === "reality" ? "必须明确选择目标；优先使用同 ASN 且证书覆盖该 SNI 的 TLS 站点" : creationPreset === "wss" && !serverDomain ? "请先在服务器编辑页配置节点域名" : undefined}><div className="secure-field-action"><input required aria-label={creationPreset === "reality" ? "Reality 伪装目标 / SNI" : "TLS 节点域名"} list={creationPreset === "reality" ? `reality-domains-${serverId}` : undefined} readOnly={creationPreset === "wss"} value={secureDraft.domain} onChange={(event) => setSecureDraft({ ...secureDraft, domain: event.target.value.trim().toLowerCase() })} placeholder="www.example.com" />{creationPreset === "reality" ? <IconButton type="button" label="重新探测 Reality 域名" disabled={domainsLoading} onClick={() => void loadRealityDomains()}>{domainsLoading ? <Spinner /> : <RefreshCw size={15} />}</IconButton> : null}</div></Field></div>
            {creationPreset === "reality" ? <>
              <datalist id={`reality-domains-${serverId}`}>{realityDomains.map((item) => <option key={item.domain} value={item.domain}>{item.success ? `443 可达 · ${item.latency_ms ?? "-"} ms` : item.error || "探测失败"}</option>)}</datalist>
              {domainsError ? <small className="secure-inline-error">{domainsError}</small> : null}
              <div className="form-grid two"><Field label="Reality Short ID" hint="2-16 位偶数长度十六进制"><input required aria-label="Reality Short ID" value={secureDraft.shortId} onChange={(event) => setSecureDraft({ ...secureDraft, shortId: event.target.value.trim().toLowerCase() })} /></Field><Field label="X25519 密钥对"><div className="secure-key-status"><Badge tone={validRealityKey(secureDraft.privateKey) && validRealityKey(secureDraft.publicKey) ? "good" : "warn"}>{validRealityKey(secureDraft.privateKey) && validRealityKey(secureDraft.publicKey) ? "已生成" : "未就绪"}</Badge><Button type="button" variant="secondary" disabled={keyWorking !== ""} onClick={() => void generateRealityKeys()}>{keyWorking === "reality" ? <Spinner label="生成中" /> : <><KeyRound size={15} />重新生成</>}</Button></div></Field></div>
              <div className="secure-encryption-row"><Toggle checked={secureDraft.enhancedEncryption} disabled={keyWorking !== ""} label="VLESS 后量子增强加密" onChange={(checked) => { setSecureDraft((current) => ({ ...current, enhancedEncryption: checked })); if (checked && (!secureDraft.decryptionConfig || !secureDraft.encryption)) void generateVlessEncryption(); }} />{secureDraft.enhancedEncryption ? <span><Badge tone={secureDraft.decryptionConfig && secureDraft.encryption ? "good" : "warn"}>{secureDraft.decryptionConfig && secureDraft.encryption ? "增强密钥已生成" : "增强密钥未就绪"}</Badge><Button type="button" variant="ghost" disabled={keyWorking !== ""} onClick={() => void generateVlessEncryption()}>{keyWorking === "encryption" ? <Spinner label="生成中" /> : <><RefreshCw size={14} />重生成</>}</Button></span> : null}</div>
            </> : <Field label="WebSocket 路径" hint="必须以 / 开头；Agent 保存时会安全随机化最终路径"><input required aria-label="WebSocket 路径" value={secureDraft.path} onChange={(event) => setSecureDraft({ ...secureDraft, path: event.target.value })} placeholder="/ws/path" /></Field>}
          </>}
          <details className="secure-inbound-preview"><summary>查看生成的 Xray JSON</summary>{securePreview ? <textarea className="service-code-editor xray-resource-json" aria-label="生成的入站 JSON" readOnly value={securePreview} /> : <small>字段与密钥完整后显示最终配置</small>}</details>
        </> : kind === "outbound" ? <>
          <div className="xray-editor-tabs" role="tablist" aria-label="出站编辑模式"><button type="button" role="tab" aria-selected={outboundEditorTab === "basics"} className={outboundEditorTab === "basics" ? "is-active" : ""} onClick={() => setOutboundEditorTab("basics")}>基础设置</button><button type="button" role="tab" aria-selected={outboundEditorTab === "json"} className={outboundEditorTab === "json" ? "is-active" : ""} onClick={() => setOutboundEditorTab("json")}>JSON</button></div>
          <div className="form-grid two"><Field label="Tag"><input required aria-label="出站 Tag" value={tag} onChange={(event) => { setTag(event.target.value); setOutboundField("tag", event.target.value); }} placeholder="unique-tag" /></Field><Field label="协议"><select aria-label="出站协议" value={protocol} onChange={(event) => selectOutboundProtocol(event.target.value)}><option value="">选择协议</option>{xrayOutboundProtocols.map((value) => <option key={value} value={value}>{value}</option>)}</select></Field></div>
          {outboundEditorTab === "basics" ? <>
            <div className="form-grid two"><Field label="Send through" hint="可选，本地出站地址"><input aria-label="出站 Send through" value={outboundFields.sendThrough} onChange={(event) => setOutboundField("sendThrough", event.target.value)} placeholder="local IP" /></Field>{["freedom", "blackhole", "dns", "loopback", "wireguard"].includes(protocol) ? <Field label={protocol === "loopback" ? "Inbound tag" : "说明"} hint={protocol === "loopback" ? "将流量回送到指定入站" : protocol === "wireguard" ? "连接目标请在下方 Peer endpoint 填写" : "此协议无需远端地址"}><input aria-label={protocol === "loopback" ? "Loopback 入站 Tag" : "出站说明"} value={protocol === "loopback" ? outboundFields.address : ""} onChange={(event) => protocol === "loopback" && setOutboundField("address", event.target.value)} placeholder={protocol === "loopback" ? "inbound-tag" : "由协议决定"} disabled={protocol !== "loopback"} /></Field> : <Field label="目标地址"><input required aria-label="出站目标地址" value={outboundFields.address} onChange={(event) => setOutboundField("address", event.target.value)} placeholder="server.example.com" /></Field>}</div>
            {["freedom"].includes(protocol) ? <Field label="Freedom 域名策略"><select aria-label="Freedom 域名策略（出站）" value={outboundFields.domainStrategy} onChange={(event) => setOutboundField("domainStrategy", event.target.value)}><option>AsIs</option><option>UseIP</option><option>UseIPv4</option><option>UseIPv6</option><option>ForceIPv4</option><option>ForceIPv6</option></select></Field> : null}
            {["blackhole"].includes(protocol) ? <Field label="响应类型"><select aria-label="Blackhole 响应类型" value={outboundFields.responseType} onChange={(event) => setOutboundField("responseType", event.target.value)}><option value="none">无</option><option value="http">HTTP 403</option></select></Field> : null}
            {["dns"].includes(protocol) ? <div className="form-grid three"><Field label="DNS 地址"><input aria-label="DNS 出站地址" value={outboundFields.address} onChange={(event) => setOutboundField("address", event.target.value)} placeholder="1.1.1.1" /></Field><Field label="端口"><input type="number" min="1" max="65535" aria-label="DNS 出站端口" value={outboundFields.port} onChange={(event) => setOutboundField("port", event.target.value)} placeholder="53" /></Field><Field label="网络"><select aria-label="DNS 出站网络" value={outboundFields.network} onChange={(event) => setOutboundField("network", event.target.value)}><option value="tcp">TCP</option><option value="udp">UDP</option></select></Field></div> : null}
            {["loopback"].includes(protocol) ? null : null}
            {["socks", "http", "shadowsocks", "vless", "vmess", "trojan"].includes(protocol) ? <div className="form-grid two"><Field label="端口"><input type="number" min="1" max="65535" required aria-label="出站目标端口" value={outboundFields.port} onChange={(event) => setOutboundField("port", event.target.value)} placeholder="443" /></Field>{["socks", "http"].includes(protocol) ? <Field label="用户名"><input aria-label="出站用户名" value={outboundFields.socksUser} onChange={(event) => setOutboundField("socksUser", event.target.value)} /></Field> : <Field label={protocol === "shadowsocks" ? "加密方法" : "Email / 备注"}>{protocol === "shadowsocks" ? <select aria-label="Shadowsocks 加密方法" value={outboundFields.method} onChange={(event) => setOutboundField("method", event.target.value)}>{outboundFields.method && !xrayShadowsocksMethods.includes(outboundFields.method) ? <option value={outboundFields.method}>{outboundFields.method}（当前配置）</option> : null}{xrayShadowsocksMethods.map((method) => <option key={method} value={method}>{method}</option>)}</select> : <input aria-label="出站 Email" value={outboundFields.email} onChange={(event) => setOutboundField("email", event.target.value)} placeholder="optional" />}</Field>}</div> : null}
            {["socks", "http"].includes(protocol) ? <Field label="密码"><input type="password" aria-label="出站密码" value={outboundFields.socksPassword} onChange={(event) => setOutboundField("socksPassword", event.target.value)} /></Field> : null}
            {["shadowsocks", "trojan"].includes(protocol) ? <Field label="密码"><input type="password" aria-label={protocol === "trojan" ? "Trojan 密码" : "Shadowsocks 密码"} value={outboundFields.password} onChange={(event) => setOutboundField("password", event.target.value)} /></Field> : null}
            {["vless", "vmess"].includes(protocol) ? <><div className="form-grid two"><Field label="ID / UUID"><input required aria-label="出站 ID" value={outboundFields.id} onChange={(event) => setOutboundField("id", event.target.value)} placeholder="UUID" /></Field><Field label={protocol === "vmess" ? "Security" : "Encryption"}>{protocol === "vmess" ? <select aria-label="出站 VMess Security" value={outboundFields.encryption} onChange={(event) => setOutboundField("encryption", event.target.value)}>{outboundFields.encryption && !xrayVMessSecurities.includes(outboundFields.encryption) ? <option value={outboundFields.encryption}>{outboundFields.encryption}（当前配置）</option> : null}{xrayVMessSecurities.map((security) => <option key={security} value={security}>{security}</option>)}</select> : <><input list={`xray-vless-encryption-${serverId}`} aria-label="出站 Encryption" value={outboundFields.encryption} onChange={(event) => setOutboundField("encryption", event.target.value)} placeholder="none" /><datalist id={`xray-vless-encryption-${serverId}`}><option value="none" /></datalist></>}</Field></div>{protocol === "vless" ? <Field label="Flow" hint="Reality Vision 使用 xtls-rprx-vision"><select aria-label="出站 VLESS Flow" value={outboundFields.flow} onChange={(event) => setOutboundField("flow", event.target.value)}>{outboundFields.flow && !xrayVlessFlows.includes(outboundFields.flow) ? <option value={outboundFields.flow}>{outboundFields.flow}（当前配置）</option> : null}{xrayVlessFlows.map((flow) => <option key={flow || "none"} value={flow}>{flow || "无"}</option>)}</select></Field> : null}</> : null}
            {["vless", "vmess", "trojan", "shadowsocks", "socks", "http"].includes(protocol) ? <div className="form-grid two"><Field label="Transmission"><select aria-label="出站传输" value={outboundFields.network} onChange={(event) => { const next = event.target.value; setOutboundFields((current) => ({ ...current, network: next, security: current.security === "reality" && !xrayRealityOutboundNetworks.includes(next) ? "none" : current.security })); }}>{xrayOutboundNetworks.map((value) => <option key={value} value={value}>{value === "tcp" ? "TCP (RAW)" : value.toUpperCase()}</option>)}</select></Field><Field label="Security"><div className="xray-security-segments" role="group" aria-label="出站安全">{xrayOutboundSecurities.map((value) => { const realityDisabled = value === "reality" && !xrayRealityOutboundNetworks.includes(outboundFields.network); return <button key={value} type="button" className={outboundFields.security === value ? "is-active" : ""} aria-pressed={outboundFields.security === value} disabled={realityDisabled} title={realityDisabled ? "Reality 仅支持 TCP、gRPC 或 XHTTP" : undefined} onClick={() => setOutboundField("security", value)}>{value === "none" ? "None" : value === "tls" ? "TLS" : "Reality"}</button>; })}</div></Field></div> : null}
            {["ws", "httpupgrade", "xhttp"].includes(outboundFields.network) ? <div className="form-grid two"><Field label={`${outboundFields.network === "ws" ? "WebSocket" : outboundFields.network === "httpupgrade" ? "HTTPUpgrade" : "XHTTP"} 路径`}><input aria-label={`出站 ${outboundFields.network === "ws" ? "WebSocket" : outboundFields.network === "httpupgrade" ? "HTTPUpgrade" : "XHTTP"} 路径`} value={outboundFields.path} onChange={(event) => setOutboundField("path", event.target.value)} placeholder="/" /></Field><Field label="Host"><input aria-label="出站 Host" value={outboundFields.host} onChange={(event) => setOutboundField("host", event.target.value)} /></Field></div> : null}
            {outboundFields.network === "xhttp" ? <Field label="XHTTP Mode"><select aria-label="出站 XHTTP Mode" value={outboundFields.xhttpMode} onChange={(event) => setOutboundField("xhttpMode", event.target.value)}><option value="auto">auto</option><option value="packet-up">packet-up</option><option value="stream-up">stream-up</option><option value="stream-one">stream-one</option></select></Field> : null}
            {outboundFields.network === "grpc" ? <Field label="gRPC Service Name"><input aria-label="出站 gRPC Service Name" value={outboundFields.serviceName} onChange={(event) => setOutboundField("serviceName", event.target.value)} /></Field> : null}
            {outboundFields.network === "kcp" ? <div className="form-grid three"><Field label="mKCP MTU"><input type="number" min="576" max="1460" aria-label="出站 mKCP MTU" value={outboundFields.kcpMtu} onChange={(event) => setOutboundField("kcpMtu", event.target.value)} /></Field><Field label="TTI (ms)"><input type="number" min="10" max="1000" aria-label="出站 mKCP TTI" value={outboundFields.kcpTti} onChange={(event) => setOutboundField("kcpTti", event.target.value)} /></Field><Field label="拥塞窗口倍数"><input type="number" min="1" aria-label="出站 mKCP 拥塞窗口倍数" value={outboundFields.kcpCwndMultiplier} onChange={(event) => setOutboundField("kcpCwndMultiplier", event.target.value)} /></Field><Field label="上行容量 (Mbps)"><input type="number" min="0" aria-label="出站 mKCP 上行容量" value={outboundFields.kcpUplinkCapacity} onChange={(event) => setOutboundField("kcpUplinkCapacity", event.target.value)} /></Field><Field label="下行容量 (Mbps)"><input type="number" min="0" aria-label="出站 mKCP 下行容量" value={outboundFields.kcpDownlinkCapacity} onChange={(event) => setOutboundField("kcpDownlinkCapacity", event.target.value)} /></Field><Field label="最大发送窗口"><input type="number" min="0" aria-label="出站 mKCP 最大发送窗口" value={outboundFields.kcpMaxSendingWindow} onChange={(event) => setOutboundField("kcpMaxSendingWindow", event.target.value)} /></Field></div> : null}
            {outboundFields.security === "tls" || outboundFields.security === "reality" ? <div className="form-grid two"><Field label="Server name / SNI"><input aria-label="出站 Server name" value={outboundFields.serverName} onChange={(event) => setOutboundField("serverName", event.target.value)} placeholder={outboundFields.address || "example.com"} /></Field><Field label="Fingerprint"><><input list={`xray-fingerprints-${serverId}`} aria-label="出站 Fingerprint" value={outboundFields.fingerprint} onChange={(event) => setOutboundField("fingerprint", event.target.value)} /><datalist id={`xray-fingerprints-${serverId}`}>{xrayFingerprints.map((fingerprint) => <option key={fingerprint} value={fingerprint} />)}</datalist></></Field></div> : null}
            {outboundFields.security === "reality" ? <div className="form-grid three"><Field label="Public key" hint="43 位 X25519 公钥"><input required aria-label="出站 Reality Public key" value={outboundFields.publicKey} onChange={(event) => setOutboundField("publicKey", event.target.value)} /></Field><Field label="Short ID" hint="可留空；填写时为偶数长度十六进制"><input aria-label="出站 Reality Short ID" value={outboundFields.shortId} onChange={(event) => setOutboundField("shortId", event.target.value)} /></Field><Field label="Spider X"><input aria-label="出站 Reality Spider X" value={outboundFields.spiderX} onChange={(event) => setOutboundField("spiderX", event.target.value)} /></Field></div> : null}
            {protocol === "wireguard" ? <><div className="form-grid two"><Field label="Secret key" hint="64 位十六进制或 32 字节 Base64 密钥"><input type="password" required aria-label="WireGuard Secret key" value={outboundFields.secretKey} onChange={(event) => setOutboundField("secretKey", event.target.value)} /></Field><Field label="隧道地址" hint="多个地址用逗号分隔"><input aria-label="WireGuard 隧道地址" value={outboundFields.tunnelAddress} onChange={(event) => setOutboundField("tunnelAddress", event.target.value)} placeholder="10.0.0.2/32" /></Field></div><div className="form-grid two"><Field label="Peer public key" hint="保留原有预共享密钥与其他 Peer"><input required aria-label="WireGuard Peer public key" value={outboundFields.peerPublicKey} onChange={(event) => setOutboundField("peerPublicKey", event.target.value)} /></Field><Field label="Peer endpoint" hint="IPv6 使用 [address]:port"><input required aria-label="WireGuard Peer endpoint" value={outboundFields.peerEndpoint} onChange={(event) => setOutboundField("peerEndpoint", event.target.value)} placeholder="host:51820" /></Field></div><div className="form-grid three"><Field label="Allowed IPs"><input aria-label="WireGuard Allowed IPs" value={outboundFields.allowedIPs} onChange={(event) => setOutboundField("allowedIPs", event.target.value)} /></Field><Field label="Keepalive"><input type="number" min="0" max="4294967295" aria-label="WireGuard Keepalive" value={outboundFields.keepAlive} onChange={(event) => setOutboundField("keepAlive", event.target.value)} /></Field><Field label="MTU"><input type="number" min="576" max="9000" aria-label="WireGuard 出站 MTU" value={outboundFields.mtu} onChange={(event) => setOutboundField("mtu", event.target.value)} /></Field></div></> : null}
          </> : null}
          <details className="xray-advanced-disclosure" open={outboundEditorTab === "json"}><summary>高级 JSON（可选）</summary><Field label="高级 JSON" hint="用于保留协议尚未覆盖的 Xray 字段；基础字段保存时会覆盖同名字段。"><textarea className="service-code-editor xray-resource-json" aria-label="出站高级 JSON" spellCheck={false} value={jsonDraft} onChange={(event) => { setJsonDraft(event.target.value); setOutboundEditorTab("json"); }} /></Field></details>
        </> : <>
          <div className="form-grid two"><Field label="Tag"><input required aria-label={`${label} Tag`} value={tag} onChange={(event) => setTag(event.target.value)} placeholder="vless-in" /></Field><Field label="协议"><select aria-label={`${label}协议`} value={protocol} onChange={(event) => setProtocol(event.target.value)}>{protocol && !protocols.includes(protocol) ? <option value={protocol}>{protocol}</option> : null}{protocols.map((value) => <option key={value} value={value}>{value}</option>)}</select></Field></div>
          <div className="form-grid two"><Field label="监听地址"><input aria-label="入站监听地址" value={listen} onChange={(event) => setListen(event.target.value)} placeholder="0.0.0.0" /></Field><Field label="监听端口"><input type="number" min="1" max="65535" required aria-label="入站监听端口" value={port} onChange={(event) => setPort(event.target.value)} /></Field></div>
          <Field label="高级 JSON" hint="可配置完整 Xray 入站字段；必须是单个对象。"><textarea className="service-code-editor xray-resource-json" aria-label={`${label}高级 JSON`} spellCheck={false} value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} /></Field>
        </>}
        <div className="dialog-actions"><Button type="button" variant="secondary" onClick={closeEditor} disabled={working}>取消</Button><Button type="submit" disabled={working || (creationPreset === "reality" && keyWorking !== "") || (creationPreset === "wireguard" && wireGuardKeyWorking) || (creationPreset === "trojan" && trojanDraft.combination === "tcp-reality" && trojanKeyWorking)}>{working ? <Spinner label="正在保存" /> : <><Check size={16} />{editor.mode === "edit" ? "保存并重建" : `创建${label}`}</>}</Button></div>
      </form>}
    </div></Dialog> : null}
    {deleting ? <ConfirmDialog title={`删除${label}`} description={`将从服务器 #${serverId} 的 Xray 运行时和配置文件中删除“${xrayResourceTag(deleting)}”。`} confirmLabel="确认删除" working={working} onCancel={() => !working && setDeleting(null)} onConfirm={() => void remove()} /> : null}
  </div>;
}

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
  const [sourceIP, setSourceIP] = useState("");
  const [sourcePort, setSourcePort] = useState("");
  const [attributes, setAttributes] = useState<Array<[string, string]>>([]);
  const [network, setNetwork] = useState("");
  const [inboundTag, setInboundTag] = useState("");
  const [user, setUser] = useState("");
  const [protocol, setProtocol] = useState("");
  const [outboundTag, setOutboundTag] = useState("");
  const [balancerTag, setBalancerTag] = useState("");
  const [inboundTags, setInboundTags] = useState<string[]>([]);
  const [userSuggestions, setUserSuggestions] = useState<string[]>([]);
  const [outboundTags, setOutboundTags] = useState<string[]>([]);
  const [balancerTags, setBalancerTags] = useState<string[]>([]);
  const [editorOptionSeeds, setEditorOptionSeeds] = useState({ protocols: [] as string[], inboundTags: [] as string[], outboundTags: [] as string[], balancerTags: [] as string[] });
  const [jsonDraft, setJsonDraft] = useState("{\n  \"type\": \"field\"\n}");
  const [editorError, setEditorError] = useState("");
  const [working, setWorking] = useState(false);
  const [deleting, setDeleting] = useState<{ index: number; rule: XrayRoutingRule } | null>(null);
  const [editing, setEditing] = useState<{ index: number; rule: XrayRoutingRule } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setListError("");
    try {
      const [routingResponse, outboundResponse, inboundResponse] = await Promise.all([
        api.get<XrayRoutingResponse>(endpoint),
        api.get<XrayResourceListResponse>(`/api/admin/remote/outbounds?server_id=${serverId}`),
        api.get<XrayResourceListResponse>(`/api/admin/remote/inbounds?server_id=${serverId}`).catch(() => null),
      ]);
      const result = assertSuccess(routingResponse, "路由规则加载失败");
      const outbounds = assertSuccess(outboundResponse, "出站 Tag 加载失败").outbounds ?? [];
      const inbounds = inboundResponse?.success === false ? [] : inboundResponse?.inbounds ?? [];
      const nextRules = Array.isArray(result.routing?.rules) ? result.routing.rules : [];
      const nextBalancers = Array.isArray(result.routing?.balancers) ? result.routing.balancers : [];
      const tags = (values: Array<string | undefined>) => [...new Set(values.map((value) => value?.trim() || "").filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-CN"));
      setRules(nextRules);
      setInboundTags(tags(inbounds.map(xrayResourceTag)));
      setUserSuggestions(xrayResourceEmails(inbounds));
      setOutboundTags(tags(outbounds.map(xrayResourceTag)));
      setBalancerTags(tags(nextBalancers.map(xrayResourceTag)));
      setDomainStrategy(typeof result.routing?.domainStrategy === "string" ? result.routing.domainStrategy : "");
    } catch (reason) {
      setListError(messageFrom(reason, "路由规则加载失败"));
    } finally {
      setLoading(false);
    }
  }, [endpoint, serverId]);

  useEffect(() => { void load(); }, [load]);

  const resetEditor = () => {
    setDomain("");
    setIP("");
    setPort("");
    setSourceIP("");
    setSourcePort("");
    setAttributes([]);
    setNetwork("");
    setInboundTag("");
    setUser("");
    setProtocol("");
    setOutboundTag("");
    setBalancerTag("");
    setEditorOptionSeeds({ protocols: [], inboundTags: [], outboundTags: [], balancerTags: [] });
    setJsonDraft("{\n  \"type\": \"field\"\n}");
    setEditorError("");
  };

  const openEditor = (existing?: { index: number; rule: XrayRoutingRule }) => {
    resetEditor();
    setEditing(existing ?? null);
    if (existing) {
      const rule = existing.rule;
      const read = (key: string) => routingRuleValues(rule, key).join(", ");
      setDomain(read("domain"));
      setIP(read("ip"));
      setPort(read("port"));
      const usesSourceIP = rule.sourceIP !== undefined && rule.sourceIP !== null;
      setSourceIP(read(usesSourceIP ? "sourceIP" : "source"));
      setSourcePort(read("sourcePort"));
      setInboundTag(read("inboundTag"));
      setUser(read("user"));
      setProtocol(read("protocol"));
      setOutboundTag(typeof rule.outboundTag === "string" ? rule.outboundTag : "");
      setBalancerTag(typeof rule.balancerTag === "string" ? rule.balancerTag : "");
      setEditorOptionSeeds({
        protocols: parseRoutingValues(read("protocol")),
        inboundTags: parseRoutingValues(read("inboundTag")),
        outboundTags: typeof rule.outboundTag === "string" && rule.outboundTag ? [rule.outboundTag] : [],
        balancerTags: typeof rule.balancerTag === "string" && rule.balancerTag ? [rule.balancerTag] : [],
      });
      setNetwork(routingRuleValues(rule, "network").join(","));
      const existingAttributes = rule.attrs && typeof rule.attrs === "object" && !Array.isArray(rule.attrs)
        ? Object.entries(rule.attrs as Record<string, unknown>).map(([key, value]) => [key, String(value)] as [string, string])
        : [];
      setAttributes(existingAttributes);
      setJsonDraft(JSON.stringify(rule, null, 2));
    }
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (working) return;
    setEditorOpen(false);
    setEditing(null);
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

    const normalizedSourceIPs = parseRoutingValues(sourceIP);
    if (normalizedSourceIPs.length) rule.sourceIP = normalizedSourceIPs;
    else delete rule.sourceIP;
    delete rule.source;

    if (port.trim()) rule.port = port.trim();
    else delete rule.port;
    if (sourcePort.trim()) rule.sourcePort = sourcePort.trim();
    else delete rule.sourcePort;
    if (network.trim()) rule.network = network.trim();
    else delete rule.network;
    const normalizedAttributes: Record<string, string> = {};
    for (const [rawKey, rawValue] of attributes) {
      const key = rawKey.trim();
      if (!key && !rawValue.trim()) continue;
      if (!key) throw new Error("路由属性名称不能为空");
      if (Object.prototype.hasOwnProperty.call(normalizedAttributes, key)) throw new Error(`路由属性名称重复：${key}`);
      normalizedAttributes[key] = rawValue;
    }
    if (Object.keys(normalizedAttributes).length) rule.attrs = normalizedAttributes;
    else delete rule.attrs;

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
      const request = editing
        ? { action: "replace_rule_hot", index: editing.index, expected_rule: editing.rule, rule }
        : { action: "add_rule_hot", rule };
      assertSuccess(await api.post<ActionResponse>(endpoint, request), editing ? "更新路由规则失败" : "创建路由规则失败");
      notify(editing ? "路由规则已更新" : "路由规则已创建");
      setEditorOpen(false);
      setEditing(null);
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
      assertSuccess(await api.post<ActionResponse>(endpoint, { action: "remove_rule_hot", index: deleting.index, expected_rule: deleting.rule }), "删除路由规则失败");
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

  const moveRule = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rules.length || working) return;
    setWorking(true);
    setListError("");
    try {
      assertSuccess(await api.post<ActionResponse>(endpoint, { action: "move_rule_hot", from: index, to: target, expected_rule: rules[index] }), "调整路由顺序失败");
      notify("路由顺序已调整");
      await load();
    } catch (reason) {
      setListError(messageFrom(reason, "调整路由顺序失败"));
    } finally {
      setWorking(false);
    }
  };

  const selectedProtocols = parseRoutingValues(protocol);
  const protocolOptions = [...new Set([...xrayRoutingProtocols, ...editorOptionSeeds.protocols, ...selectedProtocols])];
  const selectedInboundTags = parseRoutingValues(inboundTag);
  const selectableInboundTags = [...new Set([...inboundTags, ...editorOptionSeeds.inboundTags, ...selectedInboundTags])];
  const selectableOutboundTags = [...new Set([...outboundTags, ...editorOptionSeeds.outboundTags, ...(outboundTag ? [outboundTag] : [])])];
  const selectableBalancerTags = [...new Set([...balancerTags, ...editorOptionSeeds.balancerTags, ...(balancerTag ? [balancerTag] : [])])];

  return <div className="xray-resource-workbench xray-routing-workbench">
    <div className="xray-resource-head">
      <span><strong>路由规则管理</strong><small>目标服务器 #{serverId} · {rules.length} 条{domainStrategy ? ` · ${domainStrategy}` : ""}</small></span>
      <div><Button variant="ghost" onClick={() => void load()} disabled={loading || working}><RefreshCw size={15} />刷新</Button><Button onClick={() => openEditor()} disabled={working}><Plus size={16} />添加规则</Button></div>
    </div>
    {listError ? <ErrorState message={listError} onRetry={() => void load()} /> : null}
    {loading ? <div className="center-state"><Spinner label="正在加载路由规则" /></div> : rules.length === 0 ? <EmptyState icon={<Network size={23} />} title="暂无路由规则" description={`此列表直接读取服务器 #${serverId} 当前 Xray 配置`} action={<Button onClick={() => openEditor()}><Plus size={16} />添加规则</Button>} /> : <div className="xray3-table-wrap" role="region" aria-label="路由规则列表"><table className="xray3-table"><thead><tr><th>#</th><th>来源</th><th>网络</th><th>目标</th><th>入站</th><th>出站</th><th>负载均衡</th><th aria-label="操作" /></tr></thead><tbody>
      {rules.map((rule, index) => {
        const target = typeof rule.outboundTag === "string" ? rule.outboundTag : "—";
        const balancer = typeof rule.balancerTag === "string" ? rule.balancerTag : "—";
        const networkValue = routingRuleValues(rule, "network").join(" · ") || "—";
        const valuesCell = (...keys: string[]) => {
          const entries = keys.flatMap((key) => routingRuleValues(rule, key).map((value) => ({ key, value })));
          return entries.length ? entries.map((entry, entryIndex) => <span key={`${entry.key}-${entry.value}-${entryIndex}`}>{entry.value}</span>) : "—";
        };
        const sourceKey = rule.sourceIP !== undefined && rule.sourceIP !== null ? "sourceIP" : "source";
        return <tr key={`${target}-${index}`}><td><span className="xray3-rule-order"><GripVertical size={14} /><strong>{index + 1}</strong></span></td><td><span className="xray3-cell-stack">{valuesCell(sourceKey, "sourcePort")}</span></td><td>{networkValue}</td><td><span className="xray3-cell-stack">{valuesCell("ip", "domain", "port")}</span></td><td><span className="xray3-cell-stack">{valuesCell("inboundTag", "user")}</span></td><td><Badge tone={target === "—" ? "neutral" : "good"}>{target}</Badge></td><td><Badge tone={balancer === "—" ? "neutral" : "info"}>{balancer}</Badge></td><td><div className="xray3-row-actions"><IconButton label={`上移路由规则 ${index + 1}`} onClick={() => void moveRule(index, -1)} disabled={working || index === 0}><ArrowUp size={14} /></IconButton><IconButton label={`下移路由规则 ${index + 1}`} onClick={() => void moveRule(index, 1)} disabled={working || index === rules.length - 1}><ArrowDown size={14} /></IconButton><IconButton label={`编辑路由规则 ${index + 1}`} onClick={() => openEditor({ index, rule })} disabled={working}><Pencil size={15} /></IconButton><IconButton label={`删除路由规则 ${index + 1}`} onClick={() => setDeleting({ index, rule })} disabled={working}><Trash2 size={15} /></IconButton></div></td></tr>;
      })}
    </tbody></table></div>}
    {editorOpen ? <Dialog title={editing ? "编辑路由规则" : "添加路由规则"} onClose={closeEditor} dismissible={!working} medium><div className="xray-resource-dialog routing-rule-editor">
      {editorError ? <ErrorState message={editorError} /> : null}
      <form className="form-stack routing-compact-form" onSubmit={submit}>
        <RoutingFormRow label="Source IPs" hint="多个值使用逗号分隔"><input aria-label="路由来源 IP" value={sourceIP} onChange={(event) => setSourceIP(event.target.value)} placeholder="0.0.0.0/8, geoip:private" /></RoutingFormRow>
        <RoutingFormRow label="Source Port" hint="支持端口及端口范围"><input aria-label="路由来源端口" value={sourcePort} onChange={(event) => setSourcePort(event.target.value)} placeholder="53,443,1000-2000" /></RoutingFormRow>
        <RoutingFormRow label="Network"><select aria-label="路由网络" value={network} onChange={(event) => setNetwork(event.target.value)}><option value="">(any)</option><option value="tcp">tcp</option><option value="udp">udp</option><option value="tcp,udp">tcp,udp</option></select></RoutingFormRow>
        <RoutingFormRow label="Protocol"><RoutingMultiSelect ariaLabel="路由协议" values={selectedProtocols} options={protocolOptions} onChange={(values) => setProtocol(values.join(","))} placeholder="请选择协议" /></RoutingFormRow>
        <RoutingFormRow label="Attributes"><IconButton type="button" label="添加路由属性" onClick={() => setAttributes((current) => [...current, ["", ""]])}><Plus size={15} /></IconButton></RoutingFormRow>
        {attributes.length ? <div className="routing-attribute-list routing-compact-attributes">{attributes.map(([key, value], index) => <div className="routing-attribute-row" key={index}><span>{index + 1}</span><input aria-label={`路由属性名称 ${index + 1}`} value={key} onChange={(event) => setAttributes((current) => current.map((item, itemIndex) => itemIndex === index ? [event.target.value, item[1]] : item))} placeholder="名称" /><input aria-label={`路由属性值 ${index + 1}`} value={value} onChange={(event) => setAttributes((current) => current.map((item, itemIndex) => itemIndex === index ? [item[0], event.target.value] : item))} placeholder="值" /><IconButton type="button" label={`删除路由属性 ${index + 1}`} onClick={() => setAttributes((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></IconButton></div>)}</div> : null}
        <RoutingFormRow label="IP" hint="多个值使用逗号分隔"><input aria-label="路由 IP" value={ip} onChange={(event) => setIP(event.target.value)} placeholder="geoip:private, 10.0.0.0/8" /></RoutingFormRow>
        <RoutingFormRow label="Domain" hint="多个值使用逗号分隔"><input aria-label="路由域名" value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="domain:example.com, geosite:google" /></RoutingFormRow>
        <RoutingFormRow label="User" hint="可从入站用户选择；也支持逗号分隔或 regexp:"><><input list={`xray-routing-users-${serverId}`} aria-label="路由用户" value={user} onChange={(event) => setUser(event.target.value)} placeholder="user@example.com" /><datalist id={`xray-routing-users-${serverId}`}>{userSuggestions.map((email) => <option key={email} value={email} />)}</datalist></></RoutingFormRow>
        <RoutingFormRow label="Port" hint="支持端口及端口范围"><input aria-label="路由端口" value={port} onChange={(event) => setPort(event.target.value)} placeholder="80,443,1000-2000" /></RoutingFormRow>
        <RoutingFormRow label="Inbound Tags"><RoutingMultiSelect ariaLabel="路由入站 Tag" values={selectedInboundTags} options={selectableInboundTags} onChange={(values) => setInboundTag(values.join(","))} placeholder="请选择入站 Tag" /></RoutingFormRow>
        <RoutingFormRow label="Outbound Tag"><select aria-label="路由出站 Tag" value={outboundTag} onChange={(event) => { setOutboundTag(event.target.value); if (event.target.value) setBalancerTag(""); }}><option value="">(不使用)</option>{selectableOutboundTags.map((tag) => <option key={tag} value={tag}>{tag}{!outboundTags.includes(tag) ? "（已不存在）" : ""}</option>)}</select></RoutingFormRow>
        <RoutingFormRow label="Balancer Tag" hint="与 Outbound Tag 二选一"><select aria-label="路由负载均衡 Tag" value={balancerTag} onChange={(event) => { setBalancerTag(event.target.value); if (event.target.value) setOutboundTag(""); }}><option value="">(不使用)</option>{selectableBalancerTags.map((tag) => <option key={tag} value={tag}>{tag}{!balancerTags.includes(tag) ? "（已不存在）" : ""}</option>)}</select></RoutingFormRow>
        <details className="routing-advanced-disclosure"><summary>高级条件</summary><div className="routing-advanced-content">
          <RoutingFormRow label="高级 JSON"><textarea className="service-code-editor xray-resource-json" aria-label="路由规则高级 JSON" spellCheck={false} value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} /></RoutingFormRow>
        </div></details>
        <div className="dialog-actions"><Button type="button" variant="secondary" onClick={closeEditor} disabled={working}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在保存" /> : <><Check size={16} />{editing ? "保存规则" : "创建规则"}</>}</Button></div>
      </form>
    </div></Dialog> : null}
    {deleting ? <ConfirmDialog title="删除路由规则" description={`将从服务器 #${serverId} 删除规则 #${deleting.index + 1}（${String(deleting.rule.outboundTag || deleting.rule.balancerTag || "未指定目标")}）。`} confirmLabel="确认删除" working={working} onCancel={() => !working && setDeleting(null)} onConfirm={() => void remove()} /> : null}
  </div>;
}

function ServerSpeedtestPanel({ server, notify }: { server: ManagedServer; notify: Notify }) {
  const [target, setTarget] = useState<LineSpeedtestTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<"install" | "remove" | "run" | "">("");
  const [jobID, setJobID] = useState("");
  const [error, setError] = useState("");
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [licenseAccepted, setLicenseAccepted] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await api.get<{ targets?: LineSpeedtestTarget[] | null }>("/api/admin/line-speedtest/targets");
      const next = (response.targets ?? []).find((item) => item.kind === "remote" && Number(item.server_id) === server.id) ?? null;
      setTarget(next);
      const runningJobID = String(next?.last_job?.job_id ?? next?.last_job?.id ?? "").trim();
      if (next?.running && runningJobID) setJobID((current) => current || runningJobID);
    } catch (reason) {
      setError(messageFrom(reason, "服务器测速能力加载失败"));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [server.id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!jobID) return;
    let active = true;
    let timer = 0;
    const poll = async () => {
      try {
        const response = await api.get<LineSpeedtestJobResponse>(`/api/admin/line-speedtest/jobs/${encodeURIComponent(jobID)}`);
        if (!active) return;
        const state = lineSpeedtestJobState(response);
        if (["completed", "complete", "ok", "success", "succeeded", "done"].includes(state.status)) {
          setTarget((current) => current ? { ...current, running: false, error: "", last_result: state.result ?? current.last_result, last_job: state.job } : current);
          setJobID("");
          notify(`${server.name} 线路测速完成`);
          return;
        }
        if (["failed", "error", "cancelled", "canceled"].includes(state.status)) {
          const failure = state.error || "线路测速失败";
          setTarget((current) => current ? { ...current, running: false, error: failure, last_job: state.job } : current);
          setError(failure);
          setJobID("");
          notify(`${server.name}：${failure}`, "error");
          return;
        }
        setTarget((current) => current ? { ...current, running: true, error: state.error, last_job: state.job } : current);
        timer = window.setTimeout(() => void poll(), 2000);
      } catch (reason) {
        if (!active) return;
        const failure = messageFrom(reason, "测速任务状态刷新失败");
        setError(failure);
        setJobID("");
      }
    };
    timer = window.setTimeout(() => void poll(), 500);
    return () => { active = false; window.clearTimeout(timer); };
  }, [jobID, notify, server.name]);

  const install = async () => {
    if (!target) return;
    setWorking("install");
    setError("");
    try {
      await api.post("/api/admin/line-speedtest/install", { kind: "remote", server_id: server.id, accept_license: true });
      setLicenseOpen(false);
      setLicenseAccepted(false);
      notify(`${server.name} Ookla Speedtest ${target.installed ? "许可已确认" : "安装完成"}`);
      await load(true);
    } catch (reason) {
      setError(messageFrom(reason, "Ookla Speedtest 安装失败"));
    } finally {
      setWorking("");
    }
  };

  const remove = async () => {
    setWorking("remove");
    setError("");
    try {
      await api.post("/api/admin/line-speedtest/remove", { kind: "remote", server_id: server.id });
      setRemoveOpen(false);
      notify(`${server.name} Ookla Speedtest 已卸载`);
      await load(true);
    } catch (reason) {
      setError(messageFrom(reason, "Ookla Speedtest 卸载失败"));
    } finally {
      setWorking("");
    }
  };

  const run = async () => {
    if (!target) return;
    setWorking("run");
    setError("");
    try {
      const response = await api.post<LineSpeedtestJobResponse>("/api/admin/line-speedtest/run", { kind: "remote", server_id: server.id });
      const nextJobID = String(response.job_id ?? response.job?.job_id ?? response.id ?? response.job?.id ?? "").trim();
      if (!nextJobID) throw new Error("服务端未返回线路测速任务编号");
      const startedJob = response.job ?? response;
      setTarget({ ...target, running: true, error: "", last_job: { ...startedJob, id: startedJob.id ?? nextJobID, status: startedJob.status || response.status || "running" } });
      setJobID(nextJobID);
      notify(`${server.name} 线路测速已开始`);
    } catch (reason) {
      setError(messageFrom(reason, "线路测速启动失败"));
    } finally {
      setWorking("");
    }
  };

  const result = target?.last_result;
  const needsLicense = target?.license_accepted === false;
  const needsUpgrade = target ? lineSpeedtestNeedsAgentUpgrade(target) : false;
  const testing = Boolean(target?.running || jobID || working === "run");

  return <div className="service-speedtest-workbench">
    <div className="xray-resource-head"><span><strong>服务器线路测速</strong><small>直接使用 {server.name} 的公网出口运行官方 Ookla Speedtest</small></span><IconButton label="刷新服务器测速状态" onClick={() => void load()} disabled={loading || Boolean(working)}><RefreshCw size={16} /></IconButton></div>
    {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
    {loading ? <div className="center-state"><Spinner label="正在读取 Speedtest 状态" /></div> : !target ? <EmptyState icon={<Gauge size={23} />} title="当前服务器未提供测速能力" description="请先升级 Agent，再刷新当前页面。" /> : <Surface className="service-speedtest-panel">
      <div className="service-speedtest-head"><span className="service-control-icon"><Gauge size={21} /></span><span><strong>{target.implementation || "Ookla Speedtest CLI"}</strong><small>{target.version || "版本待检测"}</small></span><div><Badge tone={target.online ? "good" : "neutral"}>{target.online ? "在线" : "离线"}</Badge><Badge tone={target.installed ? "info" : "neutral"}>{target.installed ? "CLI 就绪" : "未安装"}</Badge>{needsLicense ? <Badge tone="warn">需确认许可</Badge> : null}{needsUpgrade ? <Badge tone="warn">需升级 Agent</Badge> : null}{testing ? <Badge tone="warn">测速中</Badge> : null}</div></div>
      <div className="service-speedtest-metrics"><span><small>Ping</small><strong>{lineSpeedtestMetric(result?.ping_ms, "ms")}</strong></span><span><small>抖动</small><strong>{lineSpeedtestMetric(result?.jitter_ms, "ms")}</strong></span><span><small>下载</small><strong>↓ {lineSpeedtestMetric(result?.download_mbps, "Mbps")}</strong></span><span><small>上传</small><strong>↑ {lineSpeedtestMetric(result?.upload_mbps, "Mbps")}</strong></span><span><small>丢包</small><strong>{lineSpeedtestMetric(result?.packet_loss_percent, "%")}</strong></span></div>
      <div className="service-speedtest-route"><span><small>测试点</small><strong>{lineSpeedtestServer(result)}</strong></span><span><small>运营商 / 出口</small><strong>{result?.isp || "-"}{result?.egress_ip ? ` · ${result.egress_ip}` : ""}</strong></span><span><small>最近测速</small><strong>{result?.created_at || result?.timestamp ? relativeTime(result.created_at || result.timestamp) : "尚未测速"}</strong></span></div>
      {target.error ? <p className="service-speedtest-error">{target.error}</p> : null}
      <div className="dialog-actions">{!target.installed || needsLicense ? <Button onClick={() => { setLicenseAccepted(false); setLicenseOpen(true); }} disabled={!target.online || needsUpgrade || Boolean(working)}><HardDriveDownload size={16} />{needsLicense ? "确认许可" : "安装 Speedtest"}</Button> : <><IconButton label={`卸载 ${server.name} Ookla Speedtest`} onClick={() => setRemoveOpen(true)} disabled={!target.online || testing || Boolean(working)}><Trash2 size={16} /></IconButton><Button onClick={() => void run()} disabled={!target.online || needsUpgrade || testing || Boolean(working)}>{testing ? <Spinner label="测速中" /> : <><Play size={16} />开始测速</>}</Button></>}</div>
    </Surface>}
    {licenseOpen && target ? <Dialog title={target.installed ? "确认 Ookla Speedtest 许可" : "安装 Ookla Speedtest"} description={`目标服务器：${server.name}`} onClose={() => !working && setLicenseOpen(false)} dismissible={!working}><div className="form-stack service-speedtest-license"><label><input type="checkbox" checked={licenseAccepted} onChange={(event) => setLicenseAccepted(event.target.checked)} /><span>我确认本次使用符合 Ookla 的许可范围，并已阅读和接受其 <a href="https://www.speedtest.net/about/eula" target="_blank" rel="noreferrer">最终用户许可协议</a> 与 <a href="https://www.speedtest.net/about/privacy" target="_blank" rel="noreferrer">隐私政策</a>。</span></label><div className="dialog-actions"><Button variant="secondary" onClick={() => setLicenseOpen(false)} disabled={Boolean(working)}>取消</Button><Button onClick={() => void install()} disabled={!licenseAccepted || Boolean(working)}>{working === "install" ? <Spinner label="安装中" /> : <><HardDriveDownload size={16} />同意并继续</>}</Button></div></div></Dialog> : null}
    {removeOpen ? <ConfirmDialog title="卸载 Ookla Speedtest" description={`将从 ${server.name} 移除由面板管理的 Ookla Speedtest。`} confirmLabel="确认卸载" working={working === "remove"} onCancel={() => !working && setRemoveOpen(false)} onConfirm={() => void remove()} /> : null}
  </div>;
}

function InfoTile({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: ReactNode }) {
  return <Surface className="service-info-tile"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></Surface>;
}

function ServiceControlCard({ name, state, fallbackVersion, working, externallyManaged = false, embeddedCore = false, allowCoreMaintenance = true, onAction, onUpdate, onRemove }: { name: "Xray" | "Nginx"; state?: ServiceState; fallbackVersion?: string; working: string; externallyManaged?: boolean; embeddedCore?: boolean; allowCoreMaintenance?: boolean; onAction: (action: "start" | "stop" | "restart" | "install") => void; onUpdate?: () => void; onRemove: () => void }) {
  const key = name.toLowerCase();
  const installed = state?.installed ?? (name === "Xray" && Boolean(fallbackVersion));
  const running = state?.running ?? false;
  const controlsLocked = Boolean(working) || externallyManaged;
  const xrayCoreLocked = name === "Xray" && (embeddedCore || !allowCoreMaintenance);
  const coreNote = embeddedCore ? "内嵌核心随 Agent 更新，不单独安装、更新或卸载。" : name === "Xray" && !allowCoreMaintenance ? "共享服务器的核心由拥有方控制端管理。" : "";
  const rawVersion = state?.version || fallbackVersion;
  const displayVersion = name === "Xray" ? cleanXrayVersion(rawVersion) : rawVersion;
  const activeAction = working.startsWith(`${key}-`) ? working.slice(key.length + 1) : "";
  const visualState = activeAction ? "working" : running ? "running" : installed ? "stopped" : "missing";
  const statusLabel = activeAction
    ? `${activeAction === "install" ? "安装" : activeAction === "update" ? "更新" : activeAction === "remove" ? "卸载" : activeAction === "start" ? "启动" : activeAction === "stop" ? "停止" : "重启"}中`
    : running ? "运行中" : installed ? "已停止" : "未安装";
  const actionContent = (action: string, label: string, icon: ReactNode) => activeAction === action
    ? <Spinner label={`${label}中`} />
    : <>{icon}{label}</>;

  return <Surface className={`service-control-card is-${visualState}${externallyManaged ? " is-externally-managed" : ""}`}>
    <div className="service-control-summary">
      <div className="service-control-icon">{activeAction ? <RotateCw className="service-spin" size={20} /> : name === "Xray" ? <Network size={21} /> : <Server size={21} />}</div>
      <div className="service-control-main">
        <div><h3>{name}</h3><span className={`service-control-state is-${visualState}`} aria-live="polite">{activeAction ? <RotateCw className="service-spin" size={12} /> : !installed ? <Trash2 size={12} /> : <i />}{statusLabel}</span>{embeddedCore ? <Badge tone="info">内嵌核心</Badge> : null}{externallyManaged ? <Badge tone="info">系统托管</Badge> : null}</div>
        <p>{displayVersion ? `${name === "Xray" ? "v" : ""}${displayVersion}` : "未检测到版本信息"}</p>
        {coreNote ? <small>{coreNote}</small> : externallyManaged ? <small>服务操作已锁定，防止影响服务器上的现有网站。</small> : null}
      </div>
    </div>
    <div className={`service-control-actions${!installed ? " is-install" : ""}`}>
      {!installed ? (!xrayCoreLocked ? <Button onClick={() => onAction("install")} disabled={controlsLocked}>{actionContent("install", "安装", <Plus size={15} />)} {name}</Button> : null) : <>
        <Button variant="secondary" aria-label={`启动 ${name}`} onClick={() => onAction("start")} disabled={controlsLocked || running}>{actionContent("start", "启动", <Play size={15} />)}</Button>
        <Button variant="secondary" aria-label={`停止 ${name}`} onClick={() => onAction("stop")} disabled={controlsLocked || !running}>{actionContent("stop", "停止", <Square size={14} />)}</Button>
        <Button variant="secondary" aria-label={`重启 ${name}`} onClick={() => onAction("restart")} disabled={controlsLocked}>{actionContent("restart", "重启", <RotateCw size={15} />)}</Button>
        {name === "Xray" && !xrayCoreLocked ? <Button variant="secondary" aria-label="更新 Xray" onClick={onUpdate} disabled={controlsLocked}>{actionContent("update", "更新", <HardDriveDownload size={15} />)}</Button> : null}
        {!xrayCoreLocked ? <Button variant="danger" aria-label={`卸载 ${name}`} onClick={onRemove} disabled={controlsLocked}>{actionContent("remove", "卸载", <Trash2 size={15} />)}</Button> : null}
      </>}
    </div>
  </Surface>;
}
