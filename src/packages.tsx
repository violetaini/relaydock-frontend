import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CalendarDays,
  CircleUserRound,
  Gauge,
  Grid2X2,
  List,
  Package as PackageIcon,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Trash2,
} from "lucide-react";
import { api } from "./api";
import type { AutoSpeedLimitRule, NodeItem, NodeListResponse, PackageItem } from "./types";
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

interface PackageFormState {
  name: string;
  description: string;
  trafficLimitGB: string;
  cycleDays: string;
  speedLimitMbps: string;
  deviceLimit: string;
  trafficMode: "oneway" | "twoway";
  isReset: boolean;
  resetDay: string;
  nodes: number[];
  templateFilename: string;
  nodeMultipliers: Record<string, string>;
  nodeSpeedLimits: Record<string, string>;
  nodeDeviceLimits: Record<string, string>;
  autoSpeedRules: AutoSpeedLimitRule[];
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

function initialPackageForm(item?: PackageItem): PackageFormState {
  return {
    name: item?.name ?? "",
    description: item?.description ?? "",
    trafficLimitGB: String(item?.traffic_limit_gb ?? 100),
    cycleDays: String(item?.cycle_days ?? 30),
    speedLimitMbps: String(item?.speed_limit_mbps ?? 0),
    deviceLimit: String(item?.device_limit ?? 0),
    trafficMode: item?.traffic_mode === "twoway" ? "twoway" : "oneway",
    isReset: item?.is_reset ?? false,
    resetDay: String(item?.reset_day || 1),
    nodes: [...(item?.nodes ?? [])],
    templateFilename: item?.template_filename ?? "",
    nodeMultipliers: Object.fromEntries(Object.entries(item?.node_multipliers ?? {}).map(([key, value]) => [key, String(value)])),
    nodeSpeedLimits: Object.fromEntries(Object.entries(item?.node_speed_limits ?? {}).map(([key, value]) => [key, String(value)])),
    nodeDeviceLimits: Object.fromEntries(Object.entries(item?.node_device_limits ?? {}).map(([key, value]) => [key, String(value)])),
    autoSpeedRules: [...(item?.auto_speed_rules ?? [])],
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
    traffic_limit_gb: Number(form.trafficLimitGB),
    cycle_days: Number(form.cycleDays),
    is_reset: form.isReset,
    reset_day: Number(form.resetDay),
    nodes: form.nodes,
    node_multipliers: numericMap(form.nodeMultipliers),
    node_speed_limits: numericMap(form.nodeSpeedLimits),
    node_device_limits: numericMap(form.nodeDeviceLimits),
    speed_limit_mbps: Number(form.speedLimitMbps),
    device_limit: Number(form.deviceLimit),
    auto_speed_rules: form.autoSpeedRules,
    traffic_mode: form.trafficMode,
    template_filename: form.templateFilename,
  };
  if (original) payload.id = original.id;
  return payload;
}

export function PackagesPage({ notify }: PackagesPageProps) {
  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
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
      const [packageResult, nodeResult] = await Promise.all([
        api.get<PackageListResponse>("/api/admin/packages"),
        api.get<NodeListResponse & ApiEnvelope>("/api/admin/nodes"),
      ]);
      setPackages(assertSuccessful(packageResult, "套餐列表加载失败").packages ?? []);
      setNodes(assertSuccessful(nodeResult, "节点列表加载失败").nodes ?? []);
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
        description="管理流量套餐模板，可在用户管理中为用户分配套餐"
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
        <div className="advanced-stack">
          {packages.length === 0 ? <div className="package-grid">
              <Surface>
                <EmptyState
                  icon={<PackageIcon size={24} />}
                  title="暂无套餐"
                  description="创建套餐后可配置流量、限速并关联节点"
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
                      {item.traffic_mode === "twoway" ? "双向计费" : "单向计费"}
                    </Badge>
                    <div className="page-actions">
                      <IconButton label={`编辑 ${item.name}`} onClick={() => setEditor(item)}><Pencil size={16} /></IconButton>
                      <IconButton label={`删除 ${item.name}`} onClick={() => setPendingAction({ kind: "delete-package", item })}><Trash2 size={16} /></IconButton>
                    </div>
                  </div>
                  <h2>{item.name}</h2>
                  <p>{item.description || "无套餐说明"}</p>
                  <div className="package-quota">
                    <strong>{item.traffic_limit_gb}</strong>
                    <span>GB / {item.cycle_days} 天</span>
                  </div>
                  <div className="package-meta">
                    <span><Gauge size={15} />{item.speed_limit_mbps ? `${item.speed_limit_mbps} Mbps` : "不限速"}</span>
                    <span><CircleUserRound size={15} />{item.device_limit ? `${item.device_limit} 台` : "设备不限"}</span>
                    <span title={names.join("、")}><Route size={15} />{itemNodes.length} 个节点</span>
                    <span><CalendarDays size={15} />{item.is_reset ? `每月 ${item.reset_day} 日重置` : "周期重置"}</span>
                  </div>
                </Surface>
              );
            })}</div> : <Surface className="table-surface packages-list-surface"><div className="table-wrap"><table><thead><tr><th>套餐</th><th>计费</th><th>流量 / 周期</th><th>速度 / 设备</th><th>节点</th><th aria-label="操作" /></tr></thead><tbody>{packages.map((item) => {
              const itemNodes = item.nodes ?? [];
              const names = itemNodes.map((id) => nodes.find((node) => node.id === id)?.node_name ?? `#${id}`);
              return <tr key={item.id}>
                <td><strong>{item.name}</strong><small className="cell-note">{item.description || "无套餐说明"}</small></td>
                <td><Badge tone={item.traffic_mode === "twoway" ? "info" : "neutral"}>{item.traffic_mode === "twoway" ? "双向计费" : "单向计费"}</Badge></td>
                <td><strong>{item.traffic_limit_gb} GB</strong><small className="cell-note">{item.cycle_days} 天 · {item.is_reset ? `每月 ${item.reset_day} 日重置` : "周期重置"}</small></td>
                <td><strong>{item.speed_limit_mbps ? `${item.speed_limit_mbps} Mbps` : "不限速"}</strong><small className="cell-note">{item.device_limit ? `${item.device_limit} 台设备` : "设备不限"}</small></td>
                <td><strong title={names.join("、")}>{itemNodes.length} 个节点</strong><small className="cell-note">{names.slice(0, 2).join("、") || "未关联"}</small></td>
                <td><div className="packages-list-actions"><IconButton label={`编辑 ${item.name}`} onClick={() => setEditor(item)}><Pencil size={16} /></IconButton><IconButton label={`删除 ${item.name}`} onClick={() => setPendingAction({ kind: "delete-package", item })}><Trash2 size={16} /></IconButton></div></td>
              </tr>;
            })}</tbody></table></div></Surface>}
        </div>
      )}

      {editor ? (
        <PackageEditorDialog
          item={editor === "create" ? undefined : editor}
          nodes={nodes}
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

function PackageEditorDialog({ item, nodes, onClose, onComplete }: {
  item?: PackageItem;
  nodes: NodeItem[];
  onClose: () => void;
  onComplete: (message: string) => void;
}) {
  const [form, setForm] = useState<PackageFormState>(() => initialPackageForm(item));
  const [nodeSearch, setNodeSearch] = useState("");
  const [templates, setTemplates] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(Boolean(
    item?.template_filename || Object.keys(item?.node_multipliers ?? {}).length ||
    Object.keys(item?.node_speed_limits ?? {}).length || Object.keys(item?.node_device_limits ?? {}).length ||
    item?.auto_speed_rules?.length,
  ));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<{ templates?: string[] }>("/api/admin/rule-templates")
      .then((response) => setTemplates(response.templates ?? []))
      .catch(() => setTemplates([]));
  }, []);

  const visibleNodes = useMemo(() => {
    const query = nodeSearch.trim().toLowerCase();
    if (!query) return nodes;
    return nodes.filter((node) => [node.node_name, node.protocol, node.original_server, node.tag]
      .some((value) => value?.toLowerCase().includes(query)));
  }, [nodeSearch, nodes]);
  const knownIDs = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
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

  const addAutoRule = () => {
    setForm((current) => ({
      ...current,
      autoSpeedRules: [...current.autoSpeedRules, {
        type: "sustained",
        threshold_mbps: 100,
        sustained_seconds: 30,
        window_seconds: 300,
        burst_count: 3,
        limit_mbps: 20,
        limit_duration: 300,
      }],
    }));
    setShowAdvanced(true);
  };

  const updateAutoRule = (index: number, patch: Partial<AutoSpeedLimitRule>) => {
    setForm((current) => ({
      ...current,
      autoSpeedRules: current.autoSpeedRules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule),
    }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (form.isReset && (Number(form.resetDay) < 1 || Number(form.resetDay) > 31)) {
      setError("每月重置日必须在 1 到 31 之间");
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
      description="套餐参数会应用到所有绑定用户"
      onClose={() => !working && onClose()}
      wide
    >
      <form onSubmit={submit} className="form-stack">
        {error ? <ErrorState message={error} /> : null}
        <div className="form-grid">
          <Field label="套餐名称"><input required autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="计费方式">
            <select value={form.trafficMode} onChange={(event) => setForm({ ...form, trafficMode: event.target.value as PackageFormState["trafficMode"] })}>
              <option value="oneway">单向计费</option>
              <option value="twoway">双向计费</option>
            </select>
          </Field>
        </div>
        <Field label="套餐说明"><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
        <div className="form-grid">
          <Field label="流量限额（GB）"><input required type="number" min="0.01" step="0.01" value={form.trafficLimitGB} onChange={(event) => setForm({ ...form, trafficLimitGB: event.target.value })} /></Field>
          <Field label="套餐周期（天）"><input required type="number" min="1" step="1" value={form.cycleDays} onChange={(event) => setForm({ ...form, cycleDays: event.target.value })} /></Field>
          <Field label="全局限速（Mbps）" hint="0 表示不限速"><input type="number" min="0" step="0.1" value={form.speedLimitMbps} onChange={(event) => setForm({ ...form, speedLimitMbps: event.target.value })} /></Field>
          <Field label="设备数量" hint="0 表示不限设备"><input type="number" min="0" step="1" value={form.deviceLimit} onChange={(event) => setForm({ ...form, deviceLimit: event.target.value })} /></Field>
        </div>
        <div className="form-grid">
          <Toggle checked={form.isReset} onChange={(value) => setForm({ ...form, isReset: value })} label="按自然月重置流量" />
          {form.isReset ? (
            <Field label="每月重置日"><input required type="number" min="1" max="31" step="1" value={form.resetDay} onChange={(event) => setForm({ ...form, resetDay: event.target.value })} /></Field>
          ) : <span />}
        </div>

        <div className="form-grid">
          <Field label="订阅规则模板" hint="留空继承系统默认模板">
            <select value={form.templateFilename} onChange={(event) => setForm({ ...form, templateFilename: event.target.value })}>
              <option value="">继承系统默认</option>
              {form.templateFilename && !templates.includes(form.templateFilename) ? <option value={form.templateFilename}>{form.templateFilename}（当前）</option> : null}
              {templates.map((template) => <option key={template} value={template}>{template}</option>)}
            </select>
          </Field>
          <div className="package-advanced-toggle"><Button type="button" variant="secondary" onClick={() => setShowAdvanced((value) => !value)}><Gauge size={16} />{showAdvanced ? "收起高级参数" : "展开高级参数"}</Button></div>
        </div>

        <div className="surface-heading">
          <div><h2>关联节点（{form.nodes.length}）</h2></div>
          <Button type="button" variant="ghost" onClick={toggleVisible} disabled={visibleNodes.length === 0}>
            {allVisibleSelected ? "取消当前结果" : "选择当前结果"}
          </Button>
        </div>
        <Field label="筛选节点">
          <input value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} placeholder="名称、协议、服务器或标签" />
        </Field>
        {unavailableIDs.length > 0 ? (
          <ErrorState message={`有 ${unavailableIDs.length} 个已关联节点不在当前列表中；保持选中可保留关联，也可在下方移除。`} />
        ) : null}
        <div className="preview-list">
          {visibleNodes.map((node) => (
            <div key={node.id}>
              <label className="checkbox-row">
                <input type="checkbox" checked={form.nodes.includes(node.id)} onChange={() => toggleNode(node.id)} />
                <span>{node.node_name} <small>#{node.id} · {node.original_server || "外部节点"}</small></span>
              </label>
              <Badge tone={node.enabled ? "good" : "neutral"}>{node.enabled ? node.protocol || "启用" : "停用"}</Badge>
            </div>
          ))}
          {unavailableIDs.map((nodeID) => (
            <div key={`missing-${nodeID}`}>
              <label className="checkbox-row">
                <input type="checkbox" checked onChange={() => toggleNode(nodeID)} />
                <span>不可用节点 #{nodeID}</span>
              </label>
              <Badge tone="warn">已失联</Badge>
            </div>
          ))}
          {visibleNodes.length === 0 && unavailableIDs.length === 0 ? (
            <div><span className="muted">{nodes.length === 0 ? "当前没有可关联的节点" : "没有匹配的节点"}</span></div>
          ) : null}
        </div>
        {showAdvanced ? <>
          <div className="surface-heading package-subheading"><div><h2>节点倍率与覆盖</h2><small>倍率默认 1；限速和设备留空时继承套餐全局值，0 表示显式不限</small></div></div>
          <div className="package-node-overrides">
            {form.nodes.length === 0 ? <span className="muted">先选择关联节点后配置覆盖项</span> : form.nodes.map((nodeID) => {
              const node = nodes.find((itemNode) => itemNode.id === nodeID);
              const key = String(nodeID);
              return <div key={nodeID}>
                <span><strong>{node?.node_name ?? `节点 #${nodeID}`}</strong><small>{node?.protocol || "节点已失联"}</small></span>
                <Field label="流量倍率"><input aria-label={`${node?.node_name ?? nodeID} 流量倍率`} type="number" min="0" step="0.01" value={form.nodeMultipliers[key] ?? ""} placeholder="1" onChange={(event) => setForm({ ...form, nodeMultipliers: { ...form.nodeMultipliers, [key]: event.target.value } })} /></Field>
                <Field label="限速 Mbps"><input aria-label={`${node?.node_name ?? nodeID} 限速`} type="number" min="0" step="0.1" value={form.nodeSpeedLimits[key] ?? ""} placeholder="继承" onChange={(event) => setForm({ ...form, nodeSpeedLimits: { ...form.nodeSpeedLimits, [key]: event.target.value } })} /></Field>
                <Field label="设备数"><input aria-label={`${node?.node_name ?? nodeID} 设备数`} type="number" min="0" step="1" value={form.nodeDeviceLimits[key] ?? ""} placeholder="继承" onChange={(event) => setForm({ ...form, nodeDeviceLimits: { ...form.nodeDeviceLimits, [key]: event.target.value } })} /></Field>
              </div>;
            })}
          </div>
          <div className="surface-heading package-subheading"><div><h2>自动限速规则（{form.autoSpeedRules.length}）</h2><small>持续高占用或窗口内多次突发后临时降速</small></div><Button type="button" variant="ghost" onClick={addAutoRule}><Plus size={15} />添加规则</Button></div>
          <div className="auto-rule-list">
            {form.autoSpeedRules.length === 0 ? <span className="muted">未启用自动限速</span> : form.autoSpeedRules.map((rule, index) => <div key={index}>
              <div className="auto-rule-head"><Badge tone={rule.type === "burst" ? "warn" : "info"}>{rule.type === "burst" ? "突发" : "持续"}</Badge><IconButton label={`删除自动限速规则 ${index + 1}`} onClick={() => setForm({ ...form, autoSpeedRules: form.autoSpeedRules.filter((_, ruleIndex) => ruleIndex !== index) })}><Trash2 size={15} /></IconButton></div>
              <div className="auto-rule-fields">
                <Field label="触发类型"><select value={rule.type} onChange={(event) => updateAutoRule(index, { type: event.target.value })}><option value="sustained">持续高占用</option><option value="burst">多次突发</option></select></Field>
                <Field label="触发 Mbps"><input type="number" min="0.1" step="0.1" value={rule.threshold_mbps} onChange={(event) => updateAutoRule(index, { threshold_mbps: Number(event.target.value) })} /></Field>
                <Field label={rule.type === "burst" ? "单次最短秒数" : "持续秒数"}><input type="number" min="1" value={rule.sustained_seconds} onChange={(event) => updateAutoRule(index, { sustained_seconds: Number(event.target.value) })} /></Field>
                {rule.type === "burst" ? <><Field label="窗口秒数"><input type="number" min="1" value={rule.window_seconds} onChange={(event) => updateAutoRule(index, { window_seconds: Number(event.target.value) })} /></Field><Field label="触发次数"><input type="number" min="1" value={rule.burst_count} onChange={(event) => updateAutoRule(index, { burst_count: Number(event.target.value) })} /></Field></> : null}
                <Field label="限制 Mbps"><input type="number" min="0.1" step="0.1" value={rule.limit_mbps} onChange={(event) => updateAutoRule(index, { limit_mbps: Number(event.target.value) })} /></Field>
                <Field label="限制时长（秒）"><input type="number" min="1" value={rule.limit_duration} onChange={(event) => updateAutoRule(index, { limit_duration: Number(event.target.value) })} /></Field>
              </div>
            </div>)}
          </div>
        </> : null}
        <div className="dialog-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={working}>取消</Button>
          <Button type="submit" disabled={working}>
            {working ? <Spinner label={item ? "正在更新" : "正在创建"} /> : item ? <><Pencil size={16} />保存更改</> : <><Plus size={16} />创建套餐</>}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
