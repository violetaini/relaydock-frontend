import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CalendarDays,
  ChevronDown,
  CircleUserRound,
  Grid2X2,
  Layers,
  List,
  Package as PackageIcon,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Network,
  Server,
  Trash2,
} from "lucide-react";
import { api } from "./api";
import { isPackageNodeEligible } from "./managed-node-presets";
import type {
  ForwardingBillingMode,
  NodeItem,
  NodeListResponse,
  NodeTrafficResetPeriod,
  PackageForwardingGrant,
  PackageItem,
  PackageServerGrant,
  RemoteServer,
  ServerListResponse,
} from "./types";
import {
  groupTunnelTemplates,
  type TunnelTemplate,
  type TunnelTemplateGroup,
} from "./forwarding-management";
import { normalizeForwardingBillingMode } from "./forwarding-billing";
import {
  normalizeNodeTrafficResetPeriod,
  packageNodeTrafficResetSummary,
} from "./node-traffic-reset";
import {
  familiesForProfiles,
  managedGrantProtocolGroups,
  profilesForFamilies,
  type ManagedGrantProtocol,
  type ManagedGrantProtocolProfile,
} from "./managed-grant-protocols";
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
} from "./ui";
import "./packages.css";

type NotifyTone = "success" | "error";
type PackageView = "cards" | "list";

interface PackagesPageProps {
  notify: (message: string, tone?: NotifyTone) => void;
}

interface ApiEnvelope {
  success?: boolean;
  message?: string;
  error?: string;
}

interface PackageListResponse extends ApiEnvelope {
  packages?: PackageItem[];
}

interface MutationResponse extends ApiEnvelope {
  id?: number;
  warnings?: string[];
  unbound_users?: number;
}

interface PackageSubscribeFileOption {
  id: number;
  name: string;
  filename: string;
  type: string;
  description?: string;
  selected_node_ids?: number[];
}

interface PackageFormState {
  name: string;
  description: string;
  trafficLimitGB: string;
  nodeModuleTrafficLimitGB: string;
  serverModuleTrafficLimitGB: string;
  forwardingModuleTrafficLimitGB: string;
  cycleDays: string;
  deviceLimit: string;
  trafficMode: "oneway" | "twoway";
  nodeTrafficResetPeriod: NodeTrafficResetPeriod;
  resetDay: string;
  nodes: number[];
  subscribeFileIds: number[];
  templateFilename: string;
  nodeMultipliers: Record<string, string>;
  nodeTrafficLimits: Record<string, string>;
  nodeSpeedLimits: Record<string, string>;
  nodeDeviceLimits: Record<string, string>;
  serverGrants: PackageServerGrant[];
  forwardingGrants: PackageForwardingGrant[];
}

type PendingAction = { kind: "delete-package"; item: PackageItem };

function assertSuccessful<T extends ApiEnvelope>(response: T, fallback: string): T {
  if (response?.success === false) {
    throw new Error(response.error || response.message || fallback);
  }
  return response;
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function formatLimitGBValue(value?: number): string {
  if (!value || value <= 0) return "0";
  return String(Number(value.toFixed(2)));
}

function initialPackageForm(item: PackageItem | undefined, tunnels: TunnelTemplate[]): PackageFormState {
  return {
    name: item?.name ?? "",
    description: item?.description ?? "",
    trafficLimitGB: formatLimitGBValue(item?.traffic_limit_gb),
    nodeModuleTrafficLimitGB: formatLimitGBValue(item?.node_module_traffic_limit_gb),
    serverModuleTrafficLimitGB: formatLimitGBValue(item?.server_module_traffic_limit_gb),
    forwardingModuleTrafficLimitGB: formatLimitGBValue(item?.forwarding_module_traffic_limit_gb),
    cycleDays: String(item?.cycle_days ?? 30),
    deviceLimit: String(item?.device_limit ?? 0),
    trafficMode: item?.traffic_mode === "twoway" ? "twoway" : "oneway",
    nodeTrafficResetPeriod: normalizeNodeTrafficResetPeriod(item?.node_traffic_reset_period),
    resetDay: String(item?.reset_day || 1),
    nodes: [...(item?.nodes ?? [])],
    subscribeFileIds: [...(item?.subscribe_file_ids ?? [])],
    templateFilename: item?.template_filename ?? "",
    nodeMultipliers: Object.fromEntries(Object.entries(item?.node_multipliers ?? {}).map(([key, value]) => [key, String(value)])),
    nodeTrafficLimits: Object.fromEntries(Object.entries(item?.node_traffic_limits ?? {}).map(([key, value]) => [key, String(value)])),
    nodeSpeedLimits: Object.fromEntries(Object.entries(item?.node_speed_limits ?? {}).map(([key, value]) => [key, String(value)])),
    nodeDeviceLimits: Object.fromEntries(Object.entries(item?.node_device_limits ?? {}).map(([key, value]) => [key, String(value)])),
    serverGrants: [...(item?.server_grants ?? [])],
    forwardingGrants: (item?.forwarding_grants ?? []).map((grant) => {
      const tunnel = tunnels.find((candidate) => Number(candidate.id) === grant.tunnel_id);
      return {
        ...grant,
        billing_mode_override: normalizeForwardingBillingMode(grant.billing_mode_override, tunnel?.billing_mode),
      };
    }),
  };
}

function packagePayload(form: PackageFormState, original?: PackageItem): Record<string, unknown> {
  const selected = new Set(form.nodes.map(String));
  const numericMap = (source: Record<string, string>) => Object.fromEntries(
    Object.entries(source)
      .filter(([nodeID, value]) => selected.has(nodeID) && value !== "")
      .map(([nodeID, value]) => [nodeID, Number(value)]),
  );
  const payload: Record<string, unknown> = {
    name: form.name.trim(),
    description: form.description.trim(),
    traffic_limit_gb: Number(form.trafficLimitGB || 0),
    node_module_traffic_limit_gb: Number(form.nodeModuleTrafficLimitGB || 0),
    server_module_traffic_limit_gb: Number(form.serverModuleTrafficLimitGB || 0),
    forwarding_module_traffic_limit_gb: Number(form.forwardingModuleTrafficLimitGB || 0),
    cycle_days: Number(form.cycleDays),
    is_reset: true,
    node_traffic_reset_period: form.nodeTrafficResetPeriod,
    reset_day: Number(form.resetDay),
    nodes: form.nodes,
    subscribe_file_ids: form.subscribeFileIds,
    node_multipliers: numericMap(form.nodeMultipliers),
    node_traffic_limits: numericMap(form.nodeTrafficLimits),
    node_speed_limits: numericMap(form.nodeSpeedLimits),
    node_device_limits: numericMap(form.nodeDeviceLimits),
    speed_limit_mbps: 0,
    device_limit: Number(form.deviceLimit),
    auto_speed_rules: [],
    traffic_mode: form.trafficMode,
    template_filename: form.templateFilename,
    server_grants: form.serverGrants,
    forwarding_grants: form.forwardingGrants.map((grant) => ({
      ...grant,
      billing_mode_override: normalizeForwardingBillingMode(grant.billing_mode_override),
    })),
  };
  if (original) payload.id = original.id;
  return payload;
}

export function PackagesPage({ notify }: PackagesPageProps) {
  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [servers, setServers] = useState<RemoteServer[]>([]);
  const [tunnels, setTunnels] = useState<TunnelTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<PackageItem | "create" | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionWorking, setActionWorking] = useState(false);
  const [packageView, setPackageView] = useState<PackageView>("cards");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [packageResult, nodeResult, serverResult, tunnelResult] = await Promise.all([
        api.get<PackageListResponse>("/api/admin/packages"),
        api.get<NodeListResponse & ApiEnvelope>("/api/admin/nodes"),
        api.get<ServerListResponse | RemoteServer[]>("/api/admin/remote-servers"),
        api.get<{ tunnels?: TunnelTemplate[] } | TunnelTemplate[]>("/api/admin/tunnel-templates"),
      ]);
      setPackages(assertSuccessful(packageResult, "套餐列表加载失败").packages ?? []);
      setNodes(assertSuccessful(nodeResult, "节点列表加载失败").nodes ?? []);
      setServers(Array.isArray(serverResult) ? serverResult : serverResult.servers ?? []);
      setTunnels(Array.isArray(tunnelResult) ? tunnelResult : tunnelResult.tunnels ?? []);
    } catch (reason) {
      setError(errorMessage(reason, "套餐数据加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const reloadAfterMutation = () => { void load(); };

  const completePackageMutation = (message: string) => {
    setEditor(null);
    notify(message);
    reloadAfterMutation();
  };

  const confirmAction = async () => {
    if (!pendingAction) return;
    setActionWorking(true);
    try {
      const response = assertSuccessful(
        await api.delete<MutationResponse>(`/api/admin/packages/${pendingAction.item.id}`),
        "删除套餐失败",
      );
      const affected = Number(response.unbound_users ?? 0);
      notify(affected > 0 ? `套餐已删除，同时解绑 ${affected} 位用户` : "套餐已删除");
      setPendingAction(null);
      reloadAfterMutation();
    } catch (reason) {
      notify(errorMessage(reason, "操作失败"), "error");
    } finally {
      setActionWorking(false);
    }
  };

  return (
    <>
      <PageHeader
        title="套餐模板管理"
        description="把固定节点、自助节点和转发线路组合成可批量授权的制式模板"
        actions={(
          <>
            <div className="packages-view-switch" role="group" aria-label="套餐视图">
              <IconButton className={packageView === "cards" ? "is-active" : ""} label="卡片视图" aria-pressed={packageView === "cards"} onClick={() => setPackageView("cards")}><Grid2X2 size={17} /></IconButton>
              <IconButton className={packageView === "list" ? "is-active" : ""} label="列表视图" aria-pressed={packageView === "list"} onClick={() => setPackageView("list")}><List size={18} /></IconButton>
            </div>
            <IconButton label="刷新套餐数据" onClick={() => void load()} disabled={loading}><RefreshCw size={18} /></IconButton>
            <Button onClick={() => setEditor("create")} disabled={loading}><Plus size={17} />创建套餐</Button>
          </>
        )}
      />

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {loading ? (
        <Surface className="center-state"><Spinner label="正在加载套餐和节点" /></Surface>
      ) : (
        <div className="package-stack">
          {packages.length === 0 ? <div className="package-grid">
              <Surface>
                <EmptyState
                  icon={<PackageIcon size={24} />}
                  title="暂无套餐"
                  description="创建套餐后可组合节点、服务器自助开通和转发线路授权"
                  action={<Button onClick={() => setEditor("create")}><Plus size={16} />创建套餐</Button>}
                />
              </Surface>
            </div> : packageView === "cards" ? <div className="package-grid">{packages.map((item) => {
              const itemNodes = item.nodes ?? [];
              const names = itemNodes.map((id) => nodes.find((node) => node.id === id)?.node_name ?? `#${id}`);
              return (
                <Surface className="package-item" key={item.id}>
                  <div className="package-top">
                    <Badge tone={item.traffic_mode === "twoway" ? "info" : "neutral"}>
                      固定节点{item.traffic_mode === "twoway" ? "双向计费" : "单向计费"}
                    </Badge>
                    <div className="page-actions">
                      <IconButton label={`编辑 ${item.name}`} onClick={() => setEditor(item)}><Pencil size={16} /></IconButton>
                      <IconButton label={`删除 ${item.name}`} onClick={() => setPendingAction({ kind: "delete-package", item })}><Trash2 size={16} /></IconButton>
                    </div>
                  </div>
                  <h2>{item.name}</h2>
                  <p>{item.description || "无套餐说明"}</p>
                  <div className="package-quota">
                    <strong>{item.traffic_limit_gb > 0 ? `${formatLimitGBValue(item.traffic_limit_gb)} GB` : `${item.cycle_days} 天`}</strong>
                    <span>{item.traffic_limit_gb > 0 ? `总流量上限 · ${item.cycle_days} 天周期` : "天授权周期（总流量不限）"}</span>
                  </div>
                  <div className="package-meta">
                    <span>
                      <CircleUserRound size={16} />
                      {item.device_limit ? (
                        <>
                          <strong className="package-meta-count">{item.device_limit}</strong> 台
                        </>
                      ) : (
                        "设备不限"
                      )}
                    </span>
                    <span title={names.join("、")}>
                      <Route size={16} />
                      <strong className="package-meta-count">{itemNodes.length}</strong> 个节点
                    </span>
                    {(item.subscribe_file_ids?.length ?? 0) > 0 ? (
                      <span>
                        <Layers size={16} />
                        <strong className="package-meta-count">{item.subscribe_file_ids?.length ?? 0}</strong> 个订阅
                      </span>
                    ) : null}
                    <span>
                      <Server size={16} />
                      <strong className="package-meta-count">{item.server_grants?.length ?? 0}</strong> 台服务器
                    </span>
                    <span>
                      <Network size={16} />
                      <strong className="package-meta-count">{item.forwarding_grants?.length ?? 0}</strong> 条线路
                    </span>
                    <span>
                      <CalendarDays size={16} />
                      {packageNodeTrafficResetSummary(item)}
                    </span>
                  </div>
                </Surface>
              );
            })}</div> : <Surface className="table-surface packages-list-surface"><div className="table-wrap"><table><thead><tr><th>套餐</th><th>固定节点计费</th><th>授权周期 / 设备</th><th>资源明细</th><th aria-label="操作" /></tr></thead><tbody>{packages.map((item) => {
              const itemNodes = item.nodes ?? [];
              const names = itemNodes.map((id) => nodes.find((node) => node.id === id)?.node_name ?? `#${id}`);
              return <tr key={item.id}>
                <td><strong>{item.name}</strong><small className="cell-note">{item.description || "无套餐说明"}</small></td>
                <td><Badge tone={item.traffic_mode === "twoway" ? "info" : "neutral"}>{item.traffic_mode === "twoway" ? "双向计费" : "单向计费"}</Badge></td>
                <td><strong>{item.cycle_days} 天</strong><small className="cell-note">{packageNodeTrafficResetSummary(item)} · {item.device_limit ? `${item.device_limit} 台设备` : "设备不限"}</small></td>
                <td><strong title={names.join("、")}>{itemNodes.length} 节点 · {item.subscribe_file_ids?.length ?? 0} 订阅 · {item.server_grants?.length ?? 0} 服务器 · {item.forwarding_grants?.length ?? 0} 线路</strong><small className="cell-note">{names.slice(0, 2).join("、") || "未关联固定节点"}</small></td>
                <td><div className="packages-list-actions"><IconButton label={`编辑 ${item.name}`} onClick={() => setEditor(item)}><Pencil size={16} /></IconButton><IconButton label={`删除 ${item.name}`} onClick={() => setPendingAction({ kind: "delete-package", item })}><Trash2 size={16} /></IconButton></div></td>
              </tr>;
            })}</tbody></table></div></Surface>}
        </div>
      )}

      {editor ? (
        <PackageEditorDialog
          item={editor === "create" ? undefined : editor}
          nodes={nodes}
          servers={servers}
          tunnels={tunnels}
          onClose={() => setEditor(null)}
          onComplete={completePackageMutation}
        />
      ) : null}

      {pendingAction ? (
        <ConfirmDialog
          title="删除套餐"
          description={`确认删除“${pendingAction.item.name}”？已绑定用户的套餐关系和节点凭据也会由服务器同步清理。此操作无法撤销。`}
          confirmLabel="确认删除"
          working={actionWorking}
          onCancel={() => !actionWorking && setPendingAction(null)}
          onConfirm={() => void confirmAction()}
        />
      ) : null}
    </>
  );
}

function PackageEditorDialog({ item, nodes, servers, tunnels, onClose, onComplete }: {
  item?: PackageItem;
  nodes: NodeItem[];
  servers: RemoteServer[];
  tunnels: TunnelTemplate[];
  onClose: () => void;
  onComplete: (message: string) => void;
}) {
  const eligibleNodes = useMemo(() => nodes.filter(isPackageNodeEligible), [nodes]);
  const [form, setForm] = useState<PackageFormState>(() => {
    const initial = initialPackageForm(item, tunnels);
    const eligibleIDs = new Set(nodes.filter(isPackageNodeEligible).map((n) => n.id));
    return {
      ...initial,
      nodes: initial.nodes.filter((id) => eligibleIDs.has(id)),
    };
  });
  const [nodeSearch, setNodeSearch] = useState("");
  const [subSearch, setSubSearch] = useState("");
  const [serverSearch, setServerSearch] = useState("");
  const [tunnelSearch, setTunnelSearch] = useState("");
  const [templates, setTemplates] = useState<string[]>([]);
  const [subscribeFiles, setSubscribeFiles] = useState<PackageSubscribeFileOption[]>([]);
  const [expandedServerProtocols, setExpandedServerProtocols] = useState<Set<number>>(() => new Set());
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<{ templates?: string[] }>("/api/admin/rule-templates")
      .then((response) => setTemplates(response.templates ?? []))
      .catch(() => setTemplates([]));
    api.get<{ files?: PackageSubscribeFileOption[] }>("/api/admin/subscribe-files")
      .then((response) => setSubscribeFiles(response.files ?? []))
      .catch(() => setSubscribeFiles([]));
  }, []);

  const visibleSubs = useMemo(() => {
    const query = subSearch.trim().toLowerCase();
    if (!query) return subscribeFiles;
    return subscribeFiles.filter((file) =>
      [file.name, file.filename, file.description].some((val) => val?.toLowerCase().includes(query)),
    );
  }, [subSearch, subscribeFiles]);

  const allVisibleSubsSelected = visibleSubs.length > 0 && visibleSubs.every((file) => form.subscribeFileIds.includes(file.id));

  const toggleSubscription = (subID: number) => {
    setForm((current) => ({
      ...current,
      subscribeFileIds: current.subscribeFileIds.includes(subID)
        ? current.subscribeFileIds.filter((id) => id !== subID)
        : [...current.subscribeFileIds, subID],
    }));
  };

  const toggleVisibleSubs = () => {
    setForm((current) => {
      const visibleIDs = visibleSubs.map((file) => file.id);
      if (allVisibleSubsSelected) {
        return { ...current, subscribeFileIds: current.subscribeFileIds.filter((id) => !visibleIDs.includes(id)) };
      }
      return { ...current, subscribeFileIds: Array.from(new Set([...current.subscribeFileIds, ...visibleIDs])) };
    });
  };

  const visibleNodes = useMemo(() => {
    const query = nodeSearch.trim().toLowerCase();
    if (!query) return eligibleNodes;
    return eligibleNodes.filter((node) => [node.node_name, node.protocol, node.original_server, node.tag]
      .some((value) => value?.toLowerCase().includes(query)));
  }, [nodeSearch, eligibleNodes]);
  const knownIDs = useMemo(() => new Set(eligibleNodes.map((node) => node.id)), [eligibleNodes]);
  const unavailableIDs = form.nodes.filter((id) => !knownIDs.has(id));
  const allVisibleSelected = visibleNodes.length > 0 && visibleNodes.every((node) => form.nodes.includes(node.id));

  const toggleNode = (nodeID: number) => {
    setForm((current) => ({
      ...current,
      nodes: current.nodes.includes(nodeID)
        ? current.nodes.filter((id) => id !== nodeID)
        : [...current.nodes, nodeID],
    }));
  };

  const toggleVisible = () => {
    setForm((current) => {
      const visibleIDs = visibleNodes.map((node) => node.id);
      if (allVisibleSelected) {
        return { ...current, nodes: current.nodes.filter((id) => !visibleIDs.includes(id)) };
      }
      return { ...current, nodes: Array.from(new Set([...current.nodes, ...visibleIDs])) };
    });
  };

  const toggleServer = (serverID: number) => {
    setForm((current) => {
      const exists = current.serverGrants.some((grant) => grant.server_id === serverID);
      return {
        ...current,
        serverGrants: exists
          ? current.serverGrants.filter((grant) => grant.server_id !== serverID)
          : [...current.serverGrants, {
            server_id: serverID,
            max_active_nodes: 0,
            speed_limit_mbps: 0,
            connection_limit: 0,
            traffic_limit_bytes: 0,
            billing_mode: "download",
            reset_policy: "none",
            reset_day: 1,
            allowed_protocols: [],
            allowed_protocol_profiles: [],
          }],
      };
    });
  };

  const updateServerGrant = (serverID: number, patch: Partial<PackageServerGrant>) => {
    setForm((current) => ({
      ...current,
      serverGrants: current.serverGrants.map((grant) => grant.server_id === serverID ? { ...grant, ...patch } : grant),
    }));
  };

  const selectedServerProfiles = (grant: PackageServerGrant): ManagedGrantProtocolProfile[] => {
    if (grant.allowed_protocol_profiles?.length) return [...grant.allowed_protocol_profiles] as ManagedGrantProtocolProfile[];
    if (grant.allowed_protocols?.length) return profilesForFamilies(grant.allowed_protocols);
    return [];
  };

  const setServerProfiles = (serverID: number, profiles: ManagedGrantProtocolProfile[]) => {
    updateServerGrant(serverID, {
      allowed_protocols: familiesForProfiles(profiles),
      allowed_protocol_profiles: profiles,
    });
  };

  const toggleServerProtocolProfile = (serverID: number, profile: ManagedGrantProtocolProfile) => {
    const grant = form.serverGrants.find((item) => item.server_id === serverID);
    if (!grant) return;
    const current = selectedServerProfiles(grant);
    const next = current.includes(profile) ? current.filter((item) => item !== profile) : [...current, profile];
    setServerProfiles(serverID, next);
  };

  const toggleServerProtocolFamily = (serverID: number, family: ManagedGrantProtocol) => {
    const grant = form.serverGrants.find((item) => item.server_id === serverID);
    if (!grant) return;
    const familyProfiles = managedGrantProtocolGroups.find((group) => group.value === family)?.profiles.map((profile) => profile.value) ?? [];
    const current = selectedServerProfiles(grant);
    const selected = new Set(current);
    const allSelected = familyProfiles.length > 0 && familyProfiles.every((profile) => selected.has(profile));
    const next = allSelected
      ? current.filter((profile) => !familyProfiles.includes(profile))
      : [...current, ...familyProfiles.filter((profile) => !selected.has(profile))];
    setServerProfiles(serverID, next);
  };

  const toggleServerProtocolDisclosure = (serverID: number) => {
    setExpandedServerProtocols((current) => {
      const next = new Set(current);
      if (next.has(serverID)) next.delete(serverID);
      else next.add(serverID);
      return next;
    });
  };

  const visibleServers = useMemo(() => {
    const query = serverSearch.trim().toLowerCase();
    if (!query) return servers;
    return servers.filter((server) => {
      const nameMatch = (server.name || "").toLowerCase().includes(query);
      const ipMatch = (server.ip_address || "").toLowerCase().includes(query);
      const statusMatch = (server.status || "").toLowerCase().includes(query);
      return nameMatch || ipMatch || statusMatch;
    });
  }, [serverSearch, servers]);

  const allVisibleServersSelected = visibleServers.length > 0 &&
    visibleServers.every((server) => form.serverGrants.some((g) => g.server_id === server.id));

  const toggleVisibleServers = () => {
    setForm((current) => {
      const visibleIDs = visibleServers.map((s) => s.id);
      if (allVisibleServersSelected) {
        return {
          ...current,
          serverGrants: current.serverGrants.filter((g) => !visibleIDs.includes(g.server_id)),
        };
      }
      const unselected = visibleServers.filter((s) => !current.serverGrants.some((g) => g.server_id === s.id));
      const newGrants: PackageServerGrant[] = unselected.map((s) => ({
        server_id: s.id,
        max_active_nodes: 0,
        speed_limit_mbps: 0,
        connection_limit: 0,
        traffic_limit_bytes: 0,
        billing_mode: "download",
        reset_policy: "none",
        reset_day: 1,
        allowed_protocols: [],
        allowed_protocol_profiles: [],
      }));
      return {
        ...current,
        serverGrants: [...current.serverGrants, ...newGrants],
      };
    });
  };

  const tunnelGroups = useMemo(() => groupTunnelTemplates(tunnels, servers), [tunnels, servers]);

  const visibleTunnelGroups = useMemo(() => {
    const query = tunnelSearch.trim().toLowerCase();
    if (!query) return tunnelGroups;
    return tunnelGroups.filter((group) => {
      const nameMatch = (group.name || "").toLowerCase().includes(query);
      const descMatch = (group.description || "").toLowerCase().includes(query);
      const hopsMatch = (group.hops || []).some((h) => (h.name || "").toLowerCase().includes(query));
      return nameMatch || descMatch || hopsMatch;
    });
  }, [tunnelSearch, tunnelGroups]);

  const toggleTunnelGroup = (group: TunnelTemplateGroup) => {
    const primaryID = Number(group.primary.id);
    const partnerID = group.partner ? Number(group.partner.id) : null;
    const targetIDs = partnerID !== null ? [primaryID, partnerID] : [primaryID];
    setForm((current) => {
      const exists = targetIDs.some((id) => current.forwardingGrants.some((grant) => grant.tunnel_id === id));
      if (exists) {
        return {
          ...current,
          forwardingGrants: current.forwardingGrants.filter((grant) => !targetIDs.includes(grant.tunnel_id)),
        };
      }
      const newGrants = targetIDs.map((id) => {
        const tunnelObj = id === primaryID ? group.primary : group.partner;
        return {
          tunnel_id: id,
          max_active_forwards: 1,
          per_forward_speed_mbps: 0,
          per_forward_connection_limit: 0,
          traffic_limit_bytes: 0,
          billing_mode_override: normalizeForwardingBillingMode(
            tunnelObj?.billing_mode,
          ),
        };
      });
      return {
        ...current,
        forwardingGrants: [...current.forwardingGrants, ...newGrants],
      };
    });
  };

  const updateTunnelGroupGrant = (group: TunnelTemplateGroup, patch: Partial<PackageForwardingGrant>) => {
    const primaryID = Number(group.primary.id);
    const partnerID = group.partner ? Number(group.partner.id) : null;
    const targetIDs = partnerID !== null ? [primaryID, partnerID] : [primaryID];
    setForm((current) => ({
      ...current,
      forwardingGrants: current.forwardingGrants.map((grant) =>
        targetIDs.includes(grant.tunnel_id) ? { ...grant, ...patch } : grant
      ),
    }));
  };

  const totalGB = Number(form.trafficLimitGB || 0);
  const nodeModGB = Number(form.nodeModuleTrafficLimitGB || 0);
  const serverModGB = Number(form.serverModuleTrafficLimitGB || 0);
  const forwardModGB = Number(form.forwardingModuleTrafficLimitGB || 0);

  const smallestPositive = (...values: number[]): number | undefined => {
    const positives = values.filter((value) => Number.isFinite(value) && value > 0);
    return positives.length > 0 ? Math.min(...positives) : undefined;
  };

  const nodeMaxGB = smallestPositive(totalGB, nodeModGB);
  const serverMaxGB = smallestPositive(totalGB, serverModGB);
  const forwardMaxGB = smallestPositive(totalGB, forwardModGB);

  const hierarchyError = useMemo(() => {
    if (totalGB > 0) {
      if (nodeModGB > totalGB) return `节点模块总流量（${nodeModGB} GB）不能高于套餐总流量（${totalGB} GB）`;
      if (serverModGB > totalGB) return `服务器模块总流量（${serverModGB} GB）不能高于套餐总流量（${totalGB} GB）`;
      if (forwardModGB > totalGB) return `转发模块总流量（${forwardModGB} GB）不能高于套餐总流量（${totalGB} GB）`;
    }
    for (const nodeID of form.nodes) {
      const nodeGB = Number(form.nodeTrafficLimits[String(nodeID)] || 0);
      if (nodeGB > 0) {
        if (nodeModGB > 0 && nodeGB > nodeModGB) return `单个固定节点流量（${nodeGB} GB）不能高于节点模块总流量（${nodeModGB} GB）`;
        if (totalGB > 0 && nodeGB > totalGB) return `单个固定节点流量（${nodeGB} GB）不能高于套餐总流量（${totalGB} GB）`;
      }
    }
    for (const grant of form.serverGrants) {
      const serverGB = (grant.traffic_limit_bytes || 0) / 1024 ** 3;
      if (serverGB > 0) {
        if (serverModGB > 0 && serverGB > serverModGB) return `单台服务器授权流量（${Number(serverGB.toFixed(2))} GB）不能高于服务器模块总流量（${serverModGB} GB）`;
        if (totalGB > 0 && serverGB > totalGB) return `单台服务器授权流量（${Number(serverGB.toFixed(2))} GB）不能高于套餐总流量（${totalGB} GB）`;
      }
    }
    for (const grant of form.forwardingGrants) {
      const forwardGB = (grant.traffic_limit_bytes || 0) / 1024 ** 3;
      if (forwardGB > 0) {
        if (forwardModGB > 0 && forwardGB > forwardModGB) return `单条转发线路流量（${Number(forwardGB.toFixed(2))} GB）不能高于转发模块总流量（${forwardModGB} GB）`;
        if (totalGB > 0 && forwardGB > totalGB) return `单条转发线路流量（${Number(forwardGB.toFixed(2))} GB）不能高于套餐总流量（${totalGB} GB）`;
      }
    }
    return "";
  }, [totalGB, nodeModGB, serverModGB, forwardModGB, form.nodes, form.nodeTrafficLimits, form.serverGrants, form.forwardingGrants]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (Number(form.resetDay) < 1 || Number(form.resetDay) > 31) {
      setError("固定节点流量重置日必须在 1 到 31 之间");
      return;
    }
    if (hierarchyError) {
      setError(hierarchyError);
      return;
    }
    setWorking(true);
    setError("");
    try {
      const payload = packagePayload(form, item);
      const response = item
        ? await api.post<MutationResponse>("/api/admin/packages/update", payload)
        : await api.post<MutationResponse>("/api/admin/packages/create", payload);
      assertSuccessful(response, item ? "更新套餐失败" : "创建套餐失败");
      onComplete(item ? "套餐已更新，节点关联正在同步" : "套餐已创建");
    } catch (reason) {
      setError(errorMessage(reason, item ? "更新套餐失败" : "创建套餐失败"));
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog
      title={item ? `编辑 ${item.name}` : "创建套餐"}
      description="套餐是批量授权模板；应用后生成账号的实际节点、服务器和转发授权"
      onClose={() => !working && onClose()}
      wide
    >
      <form onSubmit={submit} className="form-stack">
        {error ? <ErrorState message={error} /> : null}
        <div className="form-grid">
          <Field label="套餐名称"><input required autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="套餐周期（天）" hint="用于计算用户授权到期时间"><input required type="number" min="1" step="1" value={form.cycleDays} onChange={(event) => setForm({ ...form, cycleDays: event.target.value })} /></Field>
        </div>
        <Field label="套餐总流量 GB" hint="最高限制（0 表示不限）；耗尽后全部模块停用，可仅配置任意一层或两层"><input aria-label="套餐总流量 GB" type="number" min="0" step="0.01" value={form.trafficLimitGB} onChange={(event) => setForm({ ...form, trafficLimitGB: event.target.value })} /></Field>
        <Field label="套餐说明"><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
        <div className="form-grid">
          <Field label="固定节点流量计算">
            <select value={form.trafficMode} onChange={(event) => setForm({ ...form, trafficMode: event.target.value as PackageFormState["trafficMode"] })}>
              <option value="oneway">单向计费</option>
              <option value="twoway">双向计费</option>
            </select>
          </Field>
          <Field label="设备数量" hint="0 表示不限设备"><input type="number" min="0" step="1" value={form.deviceLimit} onChange={(event) => setForm({ ...form, deviceLimit: event.target.value })} /></Field>
        </div>
        <div className="form-grid">
          <Field label="固定节点流量重置周期">
            <select
              aria-label="固定节点流量重置周期"
              value={form.nodeTrafficResetPeriod}
              onChange={(event) => setForm({ ...form, nodeTrafficResetPeriod: event.target.value as NodeTrafficResetPeriod })}
            >
              <option value="monthly">按月重置</option>
              <option value="quarterly">按季度重置</option>
              <option value="yearly">按年重置</option>
            </select>
          </Field>
          <Field label="固定节点流量重置日" hint="月：每月；季度：季度首月；年：1 月"><input required aria-label="固定节点流量重置日" type="number" min="1" max="31" step="1" value={form.resetDay} onChange={(event) => setForm({ ...form, resetDay: event.target.value })} /></Field>
        </div>

        <Field label="订阅规则模板" hint="留空继承系统默认模板；保留原订阅将输出原始配置不套用模板">
          <select aria-label="订阅规则模板" value={form.templateFilename} onChange={(event) => setForm({ ...form, templateFilename: event.target.value })}>
            <option value="">继承系统默认</option>
            <option value="__raw__">保留原订阅</option>
            {form.templateFilename && form.templateFilename !== "__raw__" && !templates.includes(form.templateFilename) ? <option value={form.templateFilename}>{form.templateFilename}（当前）</option> : null}
            {templates.map((template) => <option key={template} value={template}>{template}</option>)}
          </select>
        </Field>

        <details className="package-module-accordion">
          <summary className="package-module-summary">
            <div>
              <h2>关联节点（{form.nodes.length}）</h2>
              <small>勾选节点后可直接配置倍率、独立流量（0 不限）、限速和设备数</small>
            </div>
            <div className="page-actions" onClick={(event) => event.stopPropagation()}>
              <Button type="button" variant="ghost" onClick={toggleVisible} disabled={visibleNodes.length === 0}>
                {allVisibleSelected ? "取消全选" : "全选"}
              </Button>
              <ChevronDown size={18} className="package-accordion-chevron" />
            </div>
          </summary>
          <div className="package-module-body">
            <Field label="节点模块总流量 GB" hint="0 表示不限；耗尽后仅停用固定节点模块，须 ≤ 套餐总流量"><input aria-label="节点模块总流量 GB" type="number" min="0" max={totalGB > 0 ? totalGB : undefined} step="0.01" value={form.nodeModuleTrafficLimitGB} onChange={(event) => setForm({ ...form, nodeModuleTrafficLimitGB: event.target.value })} /></Field>
            <Field label="筛选节点">
              <input value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} placeholder="名称、协议、服务器或标签" />
            </Field>
            {unavailableIDs.length > 0 ? (
              <ErrorState message={`有 ${unavailableIDs.length} 个已关联节点不在当前列表中；保持选中可保留关联，也可在下方移除。`} />
            ) : null}
            <div className="package-entitlement-list">
              {visibleNodes.map((node) => {
                const isSelected = form.nodes.includes(node.id);
                const key = String(node.id);
                return (
                  <div key={node.id} className={isSelected ? "is-selected" : ""}>
                    <div className="package-node-row-head">
                      <label className="checkbox-row">
                        <input type="checkbox" checked={isSelected} onChange={() => toggleNode(node.id)} />
                        <span>
                          <strong>{node.node_name}</strong>
                          <small>#{node.id} · {node.node_type === "routed" ? "路由转发 · " : ""}{node.original_server || "外部节点"}</small>
                        </span>
                      </label>
                      <Badge tone={node.enabled ? "good" : "neutral"}>{node.enabled ? node.protocol || "启用" : "停用"}</Badge>
                    </div>
                    {isSelected ? (
                      <div className="package-entitlement-fields">
                        <Field label="流量倍率"><input aria-label={`${node.node_name} 流量倍率`} type="number" min="0" step="0.01" value={form.nodeMultipliers[key] ?? ""} placeholder="1" onChange={(event) => setForm({ ...form, nodeMultipliers: { ...form.nodeMultipliers, [key]: event.target.value } })} /></Field>
                        <Field label="流量 GB"><input aria-label={`${node.node_name} 流量额度`} type="number" min="0" max={nodeMaxGB} step="0.01" value={form.nodeTrafficLimits[key] ?? ""} placeholder="0" onChange={(event) => setForm({ ...form, nodeTrafficLimits: { ...form.nodeTrafficLimits, [key]: event.target.value } })} /></Field>
                        <Field label="限速 Mbps"><input aria-label={`${node.node_name} 限速`} type="number" min="0" step="0.1" value={form.nodeSpeedLimits[key] ?? ""} placeholder="0" onChange={(event) => setForm({ ...form, nodeSpeedLimits: { ...form.nodeSpeedLimits, [key]: event.target.value } })} /></Field>
                        <Field label="设备数"><input aria-label={`${node.node_name} 设备数`} type="number" min="0" step="1" value={form.nodeDeviceLimits[key] ?? ""} placeholder="继承套餐设备数" onChange={(event) => setForm({ ...form, nodeDeviceLimits: { ...form.nodeDeviceLimits, [key]: event.target.value } })} /></Field>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {unavailableIDs.map((nodeID) => {
                const key = String(nodeID);
                return (
                  <div key={`missing-${nodeID}`} className="is-selected">
                    <div className="package-node-row-head">
                      <label className="checkbox-row">
                        <input type="checkbox" checked onChange={() => toggleNode(nodeID)} />
                        <span><strong>不可用节点 #{nodeID}</strong><small>节点已失联</small></span>
                      </label>
                      <Badge tone="warn">已失联</Badge>
                    </div>
                    <div className="package-entitlement-fields">
                      <Field label="流量倍率"><input aria-label={`${nodeID} 流量倍率`} type="number" min="0" step="0.01" value={form.nodeMultipliers[key] ?? ""} placeholder="1" onChange={(event) => setForm({ ...form, nodeMultipliers: { ...form.nodeMultipliers, [key]: event.target.value } })} /></Field>
                      <Field label="流量 GB"><input aria-label={`${nodeID} 流量额度`} type="number" min="0" step="0.01" value={form.nodeTrafficLimits[key] ?? ""} placeholder="0" onChange={(event) => setForm({ ...form, nodeTrafficLimits: { ...form.nodeTrafficLimits, [key]: event.target.value } })} /></Field>
                      <Field label="限速 Mbps"><input aria-label={`${nodeID} 限速`} type="number" min="0" step="0.1" value={form.nodeSpeedLimits[key] ?? ""} placeholder="0" onChange={(event) => setForm({ ...form, nodeSpeedLimits: { ...form.nodeSpeedLimits, [key]: event.target.value } })} /></Field>
                      <Field label="设备数"><input aria-label={`${nodeID} 设备数`} type="number" min="0" step="1" value={form.nodeDeviceLimits[key] ?? ""} placeholder="继承套餐设备数" onChange={(event) => setForm({ ...form, nodeDeviceLimits: { ...form.nodeDeviceLimits, [key]: event.target.value } })} /></Field>
                    </div>
                  </div>
                );
              })}
              {visibleNodes.length === 0 && unavailableIDs.length === 0 ? (
                <div className="package-empty-entitlement">
                  <span className="muted">{eligibleNodes.length === 0 ? "当前没有可关联的多用户节点" : "没有匹配的节点"}</span>
                </div>
              ) : null}
            </div>
          </div>
        </details>

        <details className="package-module-accordion">
          <summary className="package-module-summary">
            <div>
              <h2>关联订阅（{form.subscribeFileIds.length}）</h2>
              <small>下发套餐时将同步下发所选订阅，并自动开通订阅内面板节点的多用户凭据以精细统计流量</small>
            </div>
            <div className="page-actions" onClick={(event) => event.stopPropagation()}>
              {visibleSubs.length > 0 ? (
                <Button type="button" variant="ghost" onClick={toggleVisibleSubs}>
                  {allVisibleSubsSelected ? "取消全选" : "全选"}
                </Button>
              ) : null}
              <ChevronDown size={18} className="package-accordion-chevron" />
            </div>
          </summary>
          <div className="package-module-body">
            <Field label="筛选订阅">
              <input value={subSearch} onChange={(event) => setSubSearch(event.target.value)} placeholder="订阅名称、文件名或备注" />
            </Field>
            <div className="preview-list">
              {visibleSubs.map((sub) => (
                <div key={sub.id}>
                  <label className="checkbox-row">
                    <input type="checkbox" checked={form.subscribeFileIds.includes(sub.id)} onChange={() => toggleSubscription(sub.id)} />
                    <span>
                      {sub.name} <small>{sub.filename}{sub.selected_node_ids?.length ? ` · ${sub.selected_node_ids.length} 个面板节点` : ""}</small>
                    </span>
                  </label>
                  <Badge tone="info">{sub.type === "import" || sub.type === "upload" ? "外部订阅" : "自选/策略"}</Badge>
                </div>
              ))}
              {visibleSubs.length === 0 ? (
                <div><span className="muted">{subscribeFiles.length === 0 ? "暂无可用订阅文件，请先在订阅管理中创建" : "没有匹配的订阅"}</span></div>
              ) : null}
            </div>
          </div>
        </details>

        <details className="package-module-accordion">
          <summary className="package-module-summary">
            <div>
              <h2>服务器节点授权（{form.serverGrants.length}）</h2>
              <small>允许账号在指定服务器创建自己的节点，也可开通管理员发布的节点</small>
            </div>
            <div className="page-actions" onClick={(event) => event.stopPropagation()}>
              {visibleServers.length > 0 ? (
                <Button type="button" variant="ghost" onClick={toggleVisibleServers}>
                  {allVisibleServersSelected ? "取消全选" : "全选"}
                </Button>
              ) : null}
              <ChevronDown size={18} className="package-accordion-chevron" />
            </div>
          </summary>
          <div className="package-module-body">
            <Field label="服务器模块总流量 GB" hint="0 表示不限；耗尽后仅停用服务器授权模块，须 ≤ 套餐总流量"><input aria-label="服务器模块总流量 GB" type="number" min="0" max={totalGB > 0 ? totalGB : undefined} step="0.01" value={form.serverModuleTrafficLimitGB} onChange={(event) => setForm({ ...form, serverModuleTrafficLimitGB: event.target.value })} /></Field>
            <Field label="筛选服务器">
              <input
                value={serverSearch}
                onChange={(event) => setServerSearch(event.target.value)}
                placeholder="名称、IP 地址或状态"
                aria-label="筛选服务器"
              />
            </Field>
            <div className="package-entitlement-list">
              {visibleServers.length === 0 ? (
                <div className="package-empty-entitlement">
                  <span className="muted">{servers.length === 0 ? "暂无可授权服务器" : "没有匹配的服务器"}</span>
                </div>
              ) : visibleServers.map((server) => {
                const grant = form.serverGrants.find((itemGrant) => itemGrant.server_id === server.id);
                const protocolProfiles = grant ? selectedServerProfiles(grant) : [];
                const protocolUnrestricted = Boolean(grant && !grant.allowed_protocol_profiles?.length && !grant.allowed_protocols?.length);
                const protocolExpanded = expandedServerProtocols.has(server.id);
                const protocolSummary = protocolUnrestricted ? "全部协议组合" : `已选 ${protocolProfiles.length} 个组合`;
                return <div key={server.id} className={grant ? "is-selected" : ""}>
                  <label className="checkbox-row"><input type="checkbox" checked={Boolean(grant)} onChange={() => toggleServer(server.id)} /><span><strong>{server.name}</strong><small>{server.status || "未知状态"}</small></span></label>
                  {grant ? <div className="package-entitlement-fields">
                    <Field label="节点名额" hint="0 表示不限"><input aria-label={`${server.name} 节点名额`} type="number" min="0" value={grant.max_active_nodes} onChange={(event) => updateServerGrant(server.id, { max_active_nodes: Number(event.target.value) })} /></Field>
                    <Field label="授权流量 GB" hint="0 表示不限"><input aria-label={`${server.name} 授权流量`} type="number" min="0" max={serverMaxGB} step="0.01" value={grant.traffic_limit_bytes / 1024 ** 3} onChange={(event) => updateServerGrant(server.id, { traffic_limit_bytes: Math.round(Number(event.target.value) * 1024 ** 3) })} /></Field>
                    <Field label="限速 Mbps" hint="0 表示不限"><input aria-label={`${server.name} 授权限速`} type="number" min="0" step="0.1" value={grant.speed_limit_mbps} onChange={(event) => updateServerGrant(server.id, { speed_limit_mbps: Number(event.target.value) })} /></Field>
                    <Field label="流量计算"><select aria-label={`${server.name} 流量计算`} value={grant.billing_mode} onChange={(event) => updateServerGrant(server.id, { billing_mode: event.target.value as PackageServerGrant["billing_mode"] })}><option value="download">仅下载</option><option value="both">双向</option></select></Field>
                    <div className="package-protocol-disclosure">
                      <button
                        type="button"
                        className="package-protocol-summary"
                        aria-label={`${server.name} 代理协议，${protocolSummary}`}
                        aria-expanded={protocolExpanded}
                        aria-controls={`package-server-protocols-${server.id}`}
                        onClick={() => toggleServerProtocolDisclosure(server.id)}
                      >
                        <span><strong>代理协议</strong><small>{protocolSummary}</small></span>
                        <ChevronDown size={17} aria-hidden="true" />
                      </button>
                      {protocolExpanded ? <div id={`package-server-protocols-${server.id}`} className="package-protocol-content" role="group" aria-label={`${server.name} 允许的协议组合`}>
                        <label className={`package-protocol-all ${protocolUnrestricted ? "is-selected" : ""}`}>
                          <input type="checkbox" aria-label={`${server.name} 全部协议组合`} checked={protocolUnrestricted} onChange={() => setServerProfiles(server.id, [])} />
                          <span><strong>全部协议组合</strong><small>不限制协议、传输或加密方式</small></span>
                        </label>
                        <div className="package-protocol-groups">
                          {managedGrantProtocolGroups.map((group) => {
                            const selected = new Set(protocolProfiles);
                            const allAllowed = group.profiles.every((profile) => selected.has(profile.value));
                            return <section key={group.value} className={allAllowed ? "is-selected" : ""}>
                              <label className="package-protocol-group-head">
                                <input type="checkbox" aria-label={`${server.name} ${group.label} 全部组合`} checked={allAllowed} onChange={() => toggleServerProtocolFamily(server.id, group.value)} />
                                <strong>{group.label}</strong><small>全部组合</small>
                              </label>
                              <div className="package-protocol-options">
                                {group.profiles.map((profile) => {
                                  const profileSelected = selected.has(profile.value);
                                  return <label key={profile.value} className={profileSelected ? "is-selected" : ""}>
                                    <input type="checkbox" aria-label={`${server.name} ${group.label} ${profile.label}`} checked={profileSelected} onChange={() => toggleServerProtocolProfile(server.id, profile.value)} />
                                    <span><strong>{profile.label}</strong><small>{profile.detail}</small></span>
                                  </label>;
                                })}
                              </div>
                            </section>;
                          })}
                        </div>
                      </div> : null}
                    </div>
                  </div> : null}
                </div>;
              })}
            </div>
          </div>
        </details>

        <details className="package-module-accordion">
          <summary className="package-module-summary">
            <div>
              <h2>转发线路授权（{tunnelGroups.filter((g) => {
                const pid = Number(g.primary.id);
                const fid = g.partner ? Number(g.partner.id) : null;
                return form.forwardingGrants.some((grant) => grant.tunnel_id === pid || (fid !== null && grant.tunnel_id === fid));
              }).length}）</h2>
              <small>允许账号在选定线路模板上创建转发规则</small>
            </div>
            <div className="page-actions" onClick={(event) => event.stopPropagation()}>
              <ChevronDown size={18} className="package-accordion-chevron" />
            </div>
          </summary>
          <div className="package-module-body">
            <Field label="转发模块总流量 GB" hint="0 表示不限；耗尽后仅停用转发线路模块，须 ≤ 套餐总流量"><input aria-label="转发模块总流量 GB" type="number" min="0" max={totalGB > 0 ? totalGB : undefined} step="0.01" value={form.forwardingModuleTrafficLimitGB} onChange={(event) => setForm({ ...form, forwardingModuleTrafficLimitGB: event.target.value })} /></Field>
            <Field label="筛选转发线路">
              <input
                value={tunnelSearch}
                onChange={(event) => setTunnelSearch(event.target.value)}
                placeholder="线路名称、跳点或描述"
                aria-label="筛选转发线路"
              />
            </Field>
            <div className="package-entitlement-list">
              {visibleTunnelGroups.length === 0 ? (
                <div className="package-empty-entitlement">
                  <span className="muted">{tunnelGroups.length === 0 ? "暂无可授权转发线路" : "没有匹配的转发线路"}</span>
                </div>
              ) : visibleTunnelGroups.map((group) => {
                const primaryID = Number(group.primary.id);
                const partnerID = group.partner ? Number(group.partner.id) : null;
                const grant = form.forwardingGrants.find((itemGrant) => itemGrant.tunnel_id === primaryID) ||
                              (partnerID !== null ? form.forwardingGrants.find((itemGrant) => itemGrant.tunnel_id === partnerID) : undefined);
                const isSelected = Boolean(grant);
                const hops = group.hops || [];
                const routeText = hops.length > 0 ? (group.isBidirectional ? ` (${hops.map((h) => h.name).join(" ⇄ ")})` : ` (${hops.map((h) => h.name).join(" → ")})`) : "";
                return <div key={group.key} className={isSelected ? "is-selected" : ""}>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleTunnelGroup(group)}
                    />
                    <span>
                      <strong className="package-tunnel-title">
                        <span>{group.name}{routeText}</span>
                        {group.isBidirectional ? <Badge tone="info" className="package-bidirectional-badge">双向对称</Badge> : null}
                      </strong>
                      <small>{group.description || `${group.isBidirectional ? "双向" : ""}${hops.length ? `${hops.length} 跳线路` : "直连线路"}`}</small>
                    </span>
                  </label>
                  {isSelected && grant ? <div className="package-entitlement-fields package-entitlement-fields-forward">
                    <Field label="转发名额"><input aria-label={`${group.name} 转发名额`} type="number" min="1" value={grant.max_active_forwards} onChange={(event) => updateTunnelGroupGrant(group, { max_active_forwards: Number(event.target.value) })} /></Field>
                    <Field label="单条限速 Mbps" hint="0 表示不限"><input aria-label={`${group.name} 单条转发限速`} type="number" min="0" step="0.1" value={grant.per_forward_speed_mbps} onChange={(event) => updateTunnelGroupGrant(group, { per_forward_speed_mbps: Number(event.target.value) })} /></Field>
                    <Field label="授权流量 GB" hint="0 表示不限"><input aria-label={`${group.name} 授权流量`} type="number" min="0" max={forwardMaxGB} step="0.01" value={grant.traffic_limit_bytes / 1024 ** 3} onChange={(event) => updateTunnelGroupGrant(group, { traffic_limit_bytes: Math.round(Number(event.target.value) * 1024 ** 3) })} /></Field>
                    <Field label="流量计算"><select aria-label={`${group.name} 流量计算`} value={normalizeForwardingBillingMode(grant.billing_mode_override, group.primary.billing_mode)} onChange={(event) => updateTunnelGroupGrant(group, { billing_mode_override: event.target.value as ForwardingBillingMode })}><option value="both">双向</option><option value="upload">仅算上行</option><option value="download">仅算下行</option></select></Field>
                  </div> : null}
                </div>;
              })}
            </div>
          </div>
        </details>
        {hierarchyError ? <ErrorState message={hierarchyError} /> : null}
        <div className="dialog-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={working}>取消</Button>
          <Button type="submit" disabled={working || Boolean(hierarchyError)}>
            {working ? <Spinner label={item ? "正在更新" : "正在创建"} /> : item ? <><Pencil size={16} />保存更改</> : <><Plus size={16} />创建套餐</>}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
