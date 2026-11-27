import { useCallback, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  Pencil,
  ShieldCheck,
  Trash2,
  CalendarPlus,
  ChevronRight,
  Copy,
  Gauge,
  KeyRound,
  Link2,
  Mail,
  Plus,
  SlidersHorizontal,
  Unplug,
  UserCog,
  UserRoundCheck,
  UserRoundX,
} from "lucide-react";
import { api } from "./api";
import { isAnyDoorNode } from "./managed-node-presets";
import { ServiceAuthorizationPanel } from "./service-authorization";
import type { NodeItem, NodeListResponse, UserItem } from "./types";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Spinner,
  Toggle,
  formatBytes,
} from "./ui";
import "./users-workbench.css";

type Notify = (message: string, tone?: "success" | "error") => void;
export type UsersScope = "all" | "renewal" | "invites";

export interface ManagedUser extends UserItem {
  avatar_url?: string;
  traffic_multiplier?: number;
  is_reset?: boolean;
  reset_day?: number;
  speed_limit_override?: number | null;
  device_limit_override?: number | null;
  node_traffic_limit_overrides?: Record<string, number>;
  node_speed_limit_overrides?: Record<string, number>;
  node_device_limit_overrides?: Record<string, number>;
  user_short_code?: string;
  custom_user_short_code?: string;
}

interface SubscribeFile {
  id: number;
  name: string;
  filename: string;
  description?: string;
  type?: string;
}

interface Subaccount {
  type: "routed" | "inbound" | string;
  email?: string;
  identifier?: string;
  node_id?: number;
  node_name?: string;
  server_id?: number;
  server_name?: string;
  inbound_tag?: string;
  protocol?: string;
  is_active: boolean;
  updated_at?: string;
}

function messageOf(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function copyText(value: string, notify: Notify, label = "内容") {
  void navigator.clipboard.writeText(value).then(
    () => notify(`${label}已复制`),
    () => notify("复制失败，请手动选择", "error"),
  );
}

type UserSettingsPanel = "overview" | "profile" | "password" | "extend" | "limits" | "services" | "subscriptions" | "subaccounts";

export function UserSettingsDialog({
  user,
  notify,
  working,
  onClose,
  onComplete,
  onToggleStatus,
  onDelete,
}: {
  user: ManagedUser;
  notify: Notify;
  working: boolean;
  onClose: () => void;
  onComplete: (message: string, tone?: "success" | "error") => Promise<void>;
  onToggleStatus: () => Promise<void>;
  onDelete: () => void;
}) {
  const [activePanel, setActivePanel] = useState<UserSettingsPanel>("overview");

  const completePanel = async (message: string, tone?: "success" | "error") => {
    setActivePanel("overview");
    await onComplete(message, tone);
  };

  const action = (kind: UserSettingsPanel, label: string, icon: ReactNode) => (
    <button type="button" className="user-setting-row" onClick={() => setActivePanel(kind)}>
      <span className="user-setting-row-icon">{icon}</span><span><strong>{label}</strong><small>打开对应设置</small></span><ChevronRight size={16} />
    </button>
  );

  const tabs: Array<{ id: UserSettingsPanel; label: string }> = [
    { id: "overview", label: "设置总览" },
    { id: "profile", label: "资料与短码" },
    ...(user.role !== "admin" ? [
      { id: "password" as const, label: "登录密码" },
      { id: "services" as const, label: "服务授权" },
      { id: "limits" as const, label: "节点与设备" },
      { id: "subscriptions" as const, label: "订阅分配" },
      { id: "subaccounts" as const, label: "节点子账号" },
    ] : []),
  ];

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    setActivePanel(nextTab.id);
    const tabElements = event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabElements?.[nextIndex]?.focus();
  };

  const panel = (() => {
    switch (activePanel) {
      case "profile":
        return <UserSettingsPanelFrame title="资料、备注与订阅短码" description="编辑账号资料；短码留空时恢复系统自动短码" onBack={() => setActivePanel("overview")}><ProfileSettingsPanel user={user} onBack={() => setActivePanel("overview")} onComplete={completePanel} /></UserSettingsPanelFrame>;
      case "password":
        return <UserSettingsPanelFrame title="重置登录密码" description="提交后旧密码立即失效；留空时生成随机密码" onBack={() => setActivePanel("overview")}><PasswordSettingsPanel user={user} notify={notify} onBack={() => setActivePanel("overview")} /></UserSettingsPanelFrame>;
      case "extend":
        return <UserSettingsPanelFrame title="续期套餐" description={`当前到期日：${user.package_end_date || "未设置"}；仅延长有效期，不重置流量`} onBack={() => setActivePanel("overview")}><ExtendSettingsPanel user={user} onBack={() => setActivePanel("overview")} onComplete={completePanel} /></UserSettingsPanelFrame>;
      case "limits":
        return <UserSettingsPanelFrame title="固定节点流量、限速与设备数" description="固定节点按节点设置；服务器和转发限制在各自授权中维护" onBack={() => setActivePanel("overview")}><LimitsSettingsPanel user={user} onBack={() => setActivePanel("overview")} onComplete={completePanel} /></UserSettingsPanelFrame>;
      case "services":
        return <UserSettingsPanelFrame title="服务授权" description="套餐授权与自定义授权互斥；先选择方式，再配置对应服务" onBack={() => setActivePanel("overview")}><ServiceAuthorizationPanel user={user} notify={notify} onChanged={onComplete} onOpenExtend={() => setActivePanel("extend")} /></UserSettingsPanelFrame>;
      case "subscriptions":
        return <UserSettingsPanelFrame title="订阅文件分配" description="选择后，该用户可在自己的订阅链接中访问这些订阅文件" onBack={() => setActivePanel("overview")}><SubscriptionsSettingsPanel user={user} onBack={() => setActivePanel("overview")} onComplete={completePanel} /></UserSettingsPanelFrame>;
      case "subaccounts":
        return <UserSettingsPanelFrame title="节点子账号" description="查看已下发到入站和私有路由的凭据标识" onBack={() => setActivePanel("overview")}><SubaccountsSettingsPanel user={user} /></UserSettingsPanelFrame>;
      default:
        return <>
          <section className="user-settings-section">
            <div className="user-settings-section-heading"><div><h2>账号资料</h2><p>集中编辑可公开显示的用户信息</p></div><Pencil size={18} /></div>
            {action("profile", "资料、备注与订阅短码", <Pencil size={17} />)}
            {user.role !== "admin" ? action("password", "重置登录密码", <KeyRound size={17} />) : null}
          </section>

          {user.role !== "admin" ? <section className="user-settings-section">
            <div className="user-settings-section-heading"><div><h2>权限与服务</h2><p>统一管理授权方式、额度和订阅输出</p></div><ShieldCheck size={18} /></div>
            {action("services", "服务授权", <ShieldCheck size={17} />)}
            {action("limits", "固定节点流量、限速与设备数", <Gauge size={17} />)}
            {action("subscriptions", "订阅文件分配", <Link2 size={17} />)}
            {action("subaccounts", "查看节点子账号", <UserCog size={17} />)}
          </section> : null}

          {user.role !== "admin" ? <section className="user-settings-danger">
            <Button type="button" variant="secondary" onClick={() => void onToggleStatus()} disabled={working}>{user.is_active ? <><UserRoundX size={16} />停用用户</> : <><UserRoundCheck size={16} />启用用户</>}</Button>
            <Button type="button" variant="danger" onClick={onDelete} disabled={working}><Trash2 size={16} />删除用户</Button>
          </section> : null}
        </>;
    }
  })();

  return (
    <Dialog title={`用户设置 · ${user.username}`} description="用户资料、服务授权、限额和订阅都从这里管理" onClose={onClose} wide>
      <div className="user-settings-dialog">
        <div className="user-settings-summary">
          <span className="user-settings-avatar">{(user.nickname || user.username).slice(0, 1).toUpperCase()}</span>
          <span><strong>{user.nickname || user.username}</strong><small>{user.email || "未填写邮箱"} · {user.is_active ? "账号已启用" : "账号已停用"}</small></span>
          <Badge tone={user.role === "admin" ? "info" : user.is_active ? "good" : "bad"}>{user.role === "admin" ? "管理员" : user.is_active ? "启用" : "停用"}</Badge>
        </div>
        <div className="user-settings-tabs" role="tablist" aria-label="用户设置菜单">
          {tabs.map((tab, index) => <button key={tab.id} id={`user-settings-tab-${tab.id}`} role="tab" aria-selected={activePanel === tab.id} aria-controls="user-settings-panel" tabIndex={activePanel === tab.id ? 0 : -1} className={activePanel === tab.id ? "is-active" : ""} onClick={() => setActivePanel(tab.id)} onKeyDown={(event) => handleTabKeyDown(event, index)}>{tab.label}</button>)}
        </div>
        <section id="user-settings-panel" className="user-settings-panel" role="tabpanel" aria-labelledby={`user-settings-tab-${activePanel}`}>
          {panel}
        </section>
      </div>
    </Dialog>
  );
}

function UserSettingsPanelFrame({ title, description, onBack, children }: { title: string; description: string; onBack: () => void; children: ReactNode }) {
  return <div className="user-settings-panel-frame"><div className="user-settings-panel-heading"><div><h3>{title}</h3><p>{description}</p></div><Button type="button" variant="ghost" onClick={onBack}><ArrowLeft size={16} />返回设置总览</Button></div>{children}</div>;
}

export function CreateUserDialog({ notify, onClose, onComplete }: { notify: Notify; onClose: () => void; onComplete: (message: string) => void }) {
  const [form, setForm] = useState({ username: "", email: "", nickname: "", password: "", remark: "" });
  const [result, setResult] = useState<{ username: string; password: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      const response = await api.post<{ username: string; password: string }>("/api/admin/users/create", form);
      setResult(response);
    } catch (reason) { setError(messageOf(reason, "创建用户失败")); } finally { setWorking(false); }
  };
  return <Dialog title={result ? `用户 ${result.username} 已创建` : "新建用户"} description={result ? "请在关闭前保存初始密码；该密码不会再次显示" : "密码留空时由控制端生成随机密码"} onClose={onClose}>{result ? <div className="form-stack"><div className="secret-box"><code>{result.password}</code><IconButton label="复制初始密码" onClick={() => copyText(result.password, notify, "初始密码")}><Copy size={16} /></IconButton></div><div className="dialog-actions"><Button onClick={() => onComplete(`用户 ${result.username} 已创建`)}>完成</Button></div></div> : <form className="form-stack" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<div className="form-grid"><Field label="用户名"><input required autoFocus pattern="[A-Za-z0-9_.-]+" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field><Field label="显示名称"><input value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} placeholder="默认同用户名" /></Field></div><Field label="邮箱"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field><Field label="初始密码" hint="留空自动生成 12 位随机密码"><input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field><Field label="备注"><textarea value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} /></Field><div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在创建" /> : <><Plus size={16} />创建用户</>}</Button></div></form>}</Dialog>;
}

function ProfileSettingsPanel({ user, onBack, onComplete }: { user: ManagedUser; onBack: () => void; onComplete: (message: string) => void }) {
  const [email, setEmail] = useState(user.email || "");
  const [remark, setRemark] = useState(user.remark || "");
  const [shortCode, setShortCode] = useState(user.custom_user_short_code || "");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      await Promise.all([
        api.post("/api/admin/users/update-email", { username: user.username, email: email.trim() }),
        api.post("/api/admin/users/remark", { username: user.username, remark: remark.trim() }),
        api.post("/api/admin/users/short-code", { username: user.username, short_code: shortCode.trim() }),
      ]);
      onComplete(`${user.username} 的资料已更新`);
    } catch (reason) { setError(messageOf(reason, "用户资料更新失败")); } finally { setWorking(false); }
  };
  return <form className="form-stack" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<Field label="邮箱"><div className="input-with-icon"><Mail size={16} /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div></Field><Field label="自定义订阅短码" hint="2-16 位字母、数字、下划线或横杠"><input pattern="[A-Za-z0-9_-]{2,16}" value={shortCode} onChange={(e) => setShortCode(e.target.value)} placeholder={user.user_short_code || "系统自动生成"} /></Field><Field label="备注"><textarea value={remark} onChange={(e) => setRemark(e.target.value)} /></Field><div className="dialog-actions"><Button type="button" variant="secondary" onClick={onBack}>返回设置总览</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在保存" /> : <><Pencil size={16} />保存资料</>}</Button></div></form>;
}

function PasswordSettingsPanel({ user, notify, onBack }: { user: ManagedUser; notify: Notify; onBack: () => void }) {
  const [password, setPassword] = useState("");
  const [result, setResult] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError("");
    try { const response = await api.post<{ password: string }>("/api/admin/users/reset-password", { username: user.username, new_password: password }); setResult(response.password); }
    catch (reason) { setError(messageOf(reason, "密码重置失败")); } finally { setWorking(false); }
  };
  return result ? <div className="form-stack"><div className="secret-box"><code>{result}</code><IconButton label="复制新密码" onClick={() => copyText(result, notify, "新密码")}><Copy size={16} /></IconButton></div><div className="dialog-actions"><Button onClick={onBack}>返回用户设置</Button></div></div> : <form className="form-stack" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<Field label="新密码"><input autoFocus type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="留空自动生成" /></Field><div className="dialog-actions"><Button type="button" variant="secondary" onClick={onBack}>返回设置总览</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在重置" /> : <><KeyRound size={16} />重置密码</>}</Button></div></form>;
}

function ExtendSettingsPanel({ user, onBack, onComplete }: { user: ManagedUser; onBack: () => void; onComplete: (message: string, tone?: "success" | "error") => void }) {
  const [days, setDays] = useState("30"); const [working, setWorking] = useState(false); const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); setWorking(true); setError(""); try { const response = await api.post<{ success?: boolean; end_date: string; message?: string; warnings?: string[] }>("/api/admin/users/extend", { username: user.username, days: Number(days) }); if (response.success === false) throw new Error(response.message || "续期失败"); const result = `${user.username} 已续期至 ${response.end_date}`; onComplete(response.warnings?.length ? `${result}；${response.warnings.length} 项节点截止日下发失败，请到服务管理检查` : result, response.warnings?.length ? "error" : undefined); } catch (reason) { setError(messageOf(reason, "续期失败")); } finally { setWorking(false); } };
  return <form className="form-stack" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<Field label="延长天数"><input autoFocus type="number" min="1" max="3650" value={days} onChange={(e) => setDays(e.target.value)} /></Field><div className="quick-days">{[30, 90, 180, 365].map((value) => <Button key={value} type="button" variant={days === String(value) ? "primary" : "secondary"} onClick={() => setDays(String(value))}>{value} 天</Button>)}</div><div className="dialog-actions"><Button type="button" variant="secondary" onClick={onBack}>返回设置总览</Button><Button type="submit" disabled={working || Number(days) < 1}>{working ? <Spinner label="正在续期" /> : <><CalendarPlus size={16} />确认续期</>}</Button></div></form>;
}

function LimitsSettingsPanel({ user, onBack, onComplete }: { user: ManagedUser; onBack: () => void; onComplete: (message: string) => void }) {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [devices, setDevices] = useState(user.device_limit_override == null ? "" : String(user.device_limit_override));
  const [nodeTraffic, setNodeTraffic] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(user.node_traffic_limit_overrides ?? {}).map(([key, value]) => [key, String(value)])));
  const [nodeSpeed, setNodeSpeed] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(user.node_speed_limit_overrides ?? {}).map(([key, value]) => [key, String(value)])));
  const [nodeDevices, setNodeDevices] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(user.node_device_limit_overrides ?? {}).map(([key, value]) => [key, String(value)])));
  const [working, setWorking] = useState(false); const [error, setError] = useState("");
  useEffect(() => { api.get<NodeListResponse>("/api/admin/nodes").then((r) => setNodes(r.nodes ?? [])).catch(() => setNodes([])); }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError("");
    const numericMap = (source: Record<string, string>) => Object.fromEntries(Object.entries(source).filter(([, value]) => value !== "").map(([key, value]) => [key, Number(value)]));
    const completed: string[] = [];
    const saveStep = async (path: string, body: unknown, label: string) => {
      const response = await api.put<{ success?: boolean; message?: string }>(path, body);
      if (response?.success === false) throw new Error(response.message || `${label}保存失败`);
      completed.push(label);
    };
    try {
      await saveStep("/api/admin/users/traffic-limit", { username: user.username, traffic_limit_override_gb: null }, "旧版总流量设置清理");
      await saveStep("/api/admin/users/limits", { username: user.username, speed_limit_override: null, device_limit_override: devices === "" ? null : Number(devices) }, "设备数");
      await saveStep("/api/admin/users/node-limits", { username: user.username, node_traffic_overrides: numericMap(nodeTraffic), node_speed_overrides: numericMap(nodeSpeed), node_device_overrides: numericMap(nodeDevices) }, "节点级限额");
      onComplete(`${user.username} 的限额已下发`);
    } catch (reason) {
      const suffix = completed.length ? `；已保存：${completed.join("、")}。后续步骤未完成，请关闭后重新打开核对再重试` : "";
      setError(`${messageOf(reason, "限额保存失败")}${suffix}`);
    } finally { setWorking(false); }
  };
  const visibleNodes = useMemo(
    () => nodes.filter((node) => (
      (!isAnyDoorNode(node) && node.package_eligible !== false)
      || nodeTraffic[String(node.id)] !== undefined
      || nodeSpeed[String(node.id)] !== undefined
      || nodeDevices[String(node.id)] !== undefined
    )),
    [nodeDevices, nodeSpeed, nodeTraffic, nodes],
  );
  return <form className="form-stack" onSubmit={submit}>
    {error ? <ErrorState message={error} /> : null}
    <Field label="用户设备数覆盖" hint={`套餐值 ${user.device_limit || 0}，留空继承`}><input type="number" min="0" step="1" value={devices} onChange={(e) => setDevices(e.target.value)} placeholder="继承套餐" /></Field>
    <div className="surface-heading compact-heading"><div><h2>节点级覆盖</h2><small>0 表示该节点显式不限，留空表示继承</small></div></div>
    <div className="node-limit-list">{visibleNodes.length === 0 ? <span className="muted">当前没有可配置节点</span> : visibleNodes.map((node) => <div key={node.id}><span><strong>{node.node_name}</strong><small>#{node.id}{node.node_type === "routed" ? " · 路由转发" : ""} · {node.protocol}</small></span><Field label="流量 GB"><input aria-label={`${node.node_name} 流量额度`} type="number" min="0" step="0.01" value={nodeTraffic[String(node.id)] ?? ""} onChange={(e) => setNodeTraffic({ ...nodeTraffic, [node.id]: e.target.value })} /></Field><Field label="Mbps"><input aria-label={`${node.node_name} 限速`} type="number" min="0" step="0.1" value={nodeSpeed[String(node.id)] ?? ""} onChange={(e) => setNodeSpeed({ ...nodeSpeed, [node.id]: e.target.value })} /></Field><Field label="设备"><input aria-label={`${node.node_name} 设备数`} type="number" min="0" step="1" value={nodeDevices[String(node.id)] ?? ""} onChange={(e) => setNodeDevices({ ...nodeDevices, [node.id]: e.target.value })} /></Field></div>)}</div>
    <div className="dialog-actions"><Button type="button" variant="secondary" onClick={onBack}>返回设置总览</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在下发" /> : <><SlidersHorizontal size={16} />保存并下发</>}</Button></div>
  </form>;
}

function SubscriptionsSettingsPanel({ user, onBack, onComplete }: { user: ManagedUser; onBack: () => void; onComplete: (message: string) => void }) {
  const [files, setFiles] = useState<SubscribeFile[]>([]); const [selected, setSelected] = useState<number[]>([]); const [loading, setLoading] = useState(true); const [ready, setReady] = useState(false); const [working, setWorking] = useState(false); const [loadError, setLoadError] = useState(""); const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setReady(false); setLoadError("");
    try {
      const [all, assigned] = await Promise.all([
        api.get<{ files?: SubscribeFile[] }>("/api/admin/subscribe-files"),
        api.get<{ subscription_ids?: number[] }>(`/api/admin/users/${encodeURIComponent(user.username)}/subscriptions`),
      ]);
      setFiles(all.files ?? []);
      setSelected(assigned.subscription_ids ?? []);
      setReady(true);
    } catch (reason) {
      setLoadError(messageOf(reason, "订阅分配加载失败"));
    } finally { setLoading(false); }
  }, [user.username]);
  useEffect(() => { void load(); }, [load]);
  const submit = async () => { setWorking(true); setError(""); try { await api.put(`/api/admin/users/${encodeURIComponent(user.username)}/subscriptions`, { subscription_ids: selected }); onComplete(`${user.username} 的订阅分配已更新`); } catch (reason) { setError(messageOf(reason, "订阅分配保存失败")); } finally { setWorking(false); } };
  return <>{loadError ? <ErrorState message={loadError} onRetry={() => void load()} /> : null}{error ? <ErrorState message={error} /> : null}{loading ? <div className="center-state"><Spinner /></div> : ready ? <div className="form-stack"><div className="preview-list subscription-assignment-list">{files.length === 0 ? <div><span className="muted">暂无可分配订阅</span></div> : files.map((file) => <div key={file.id}><label className="checkbox-row"><input type="checkbox" checked={selected.includes(file.id)} onChange={() => setSelected((current) => current.includes(file.id) ? current.filter((id) => id !== file.id) : [...current, file.id])} /><span><strong>{file.name}</strong><small>{file.description || file.filename}</small></span></label><Badge tone={selected.includes(file.id) ? "good" : "neutral"}>{file.type || "订阅"}</Badge></div>)}</div><div className="dialog-actions"><Button variant="secondary" onClick={onBack}>返回设置总览</Button><Button onClick={() => void submit()} disabled={working}>{working ? <Spinner label="正在保存" /> : <><Link2 size={16} />保存分配（{selected.length}）</>}</Button></div></div> : <div className="dialog-actions"><Button variant="secondary" onClick={onBack}>返回设置总览</Button></div>}</>;
}

function SubaccountsSettingsPanel({ user }: { user: ManagedUser }) {
  const [items, setItems] = useState<Subaccount[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => { api.get<{ subaccounts?: Subaccount[] }>(`/api/admin/users/subaccounts?username=${encodeURIComponent(user.username)}`).then((r) => setItems(r.subaccounts ?? [])).catch((reason) => setError(messageOf(reason, "子账号加载失败"))).finally(() => setLoading(false)); }, [user.username]);
  return <>{error ? <ErrorState message={error} /> : null}{loading ? <div className="center-state"><Spinner /></div> : items.length === 0 ? <EmptyState icon={<Unplug size={24} />} title="暂无节点子账号" /> : <div className="subaccount-list">{items.map((item, index) => <div key={`${item.type}-${item.node_id}-${item.server_id}-${item.inbound_tag}-${index}`}><span className="subaccount-icon"><ShieldCheck size={18} /></span><span><strong>{item.node_name || item.server_name || item.inbound_tag || "节点账号"}</strong><small>{item.type === "routed" ? "私有路由" : "入站凭据"} · {item.protocol || item.inbound_tag || "未知协议"}</small><code>{item.email || item.identifier || "凭据已隐藏"}</code></span><Badge tone={item.is_active ? "good" : "bad"}>{item.is_active ? "有效" : "暂停"}</Badge></div>)}</div>}</>;
}

export { UserManagementPage as UsersWorkbenchPage } from "./user-management";
