import { useCallback, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CalendarPlus,
  ChevronRight,
  Copy,
  Gauge,
  KeyRound,
  Link2,
  Mail,
  Package as PackageIcon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Unplug,
  UserCog,
  UserRoundCheck,
  UserRoundX,
  Users,
} from "lucide-react";
import { api } from "./api";
import { BatchServiceAuthorizationDialog, ServiceAuthorizationPanel } from "./service-authorization";
import { TGBotInvitesPanel } from "./tg-bot-invites";
import { TrafficProgress } from "./traffic-progress";
import type { NodeItem, NodeListResponse, UserItem } from "./types";
import { isPackageAuthorization } from "./user-authorization";
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
import "./users-workbench.css";

type Notify = (message: string, tone?: "success" | "error") => void;
export type UsersScope = "all" | "renewal" | "invites";

interface ManagedUser extends UserItem {
  avatar_url?: string;
  traffic_multiplier?: number;
  is_reset?: boolean;
  reset_day?: number;
  speed_limit_override?: number | null;
  device_limit_override?: number | null;
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

type Editor =
  | { kind: "create" }
  | { kind: "manage"; user: ManagedUser };

function messageOf(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function copyText(value: string, notify: Notify, label = "内容") {
  void navigator.clipboard.writeText(value).then(
    () => notify(`${label}已复制`),
    () => notify("复制失败，请手动选择", "error"),
  );
}

type ExpiryState = { label: string; tone: "good" | "warn" | "bad" | "neutral"; sortValue: number };

function expiryState(value?: string): ExpiryState {
  if (!value) return { label: "未设置到期日", tone: "neutral", sortValue: Number.POSITIVE_INFINITY };
  const end = new Date(`${value}T23:59:59`);
  if (!Number.isFinite(end.getTime())) return { label: "到期日无效", tone: "bad", sortValue: Number.POSITIVE_INFINITY };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((end.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { label: `已过期 ${Math.abs(days)} 天`, tone: "bad", sortValue: days };
  if (days === 0) return { label: "今日到期", tone: "bad", sortValue: days };
  if (days <= 7) return { label: `剩余 ${days} 天`, tone: "warn", sortValue: days };
  return { label: `剩余 ${days} 天`, tone: "good", sortValue: days };
}

export function UsersWorkbenchPage({ notify, initialScope = "all" }: { notify: Notify; initialScope?: UsersScope }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<UsersScope>(initialScope);
  const [status, setStatus] = useState<"all" | "active" | "disabled">("all");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ManagedUser | null>(null);
  const [workingUser, setWorkingUser] = useState("");
  const [selectedUsernames, setSelectedUsernames] = useState<string[]>([]);
  const [showBatchAuthorization, setShowBatchAuthorization] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get<{ users?: ManagedUser[] }>("/api/admin/users");
      const nextUsers = response.users ?? [];
      setUsers(nextUsers);
      const selectable = new Set(nextUsers.filter((user) => user.role !== "admin").map((user) => user.username));
      setSelectedUsernames((current) => current.filter((username) => selectable.has(username)));
      return nextUsers;
    } catch (reason) {
      setError(messageOf(reason, "用户列表加载失败"));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (scope !== "invites") void load(); }, [load, scope]);
  useEffect(() => { setScope(initialScope); }, [initialScope]);

  const changeScope = (next: UsersScope) => {
    setScope(next);
    location.hash = `/users${next === "all" ? "" : `?view=${next}`}`;
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = users.filter((user) => {
      if (status === "active" && !user.is_active) return false;
      if (status === "disabled" && user.is_active) return false;
      if (scope === "renewal") {
        if (user.role === "admin" || !user.package_id) return false;
      }
      return !needle || [user.username, user.nickname, user.email, user.remark, user.package_name, user.user_short_code]
        .some((value) => value?.toLowerCase().includes(needle));
    });
    return scope === "renewal"
      ? matching.sort((left, right) => expiryState(left.package_end_date).sortValue - expiryState(right.package_end_date).sortValue)
      : matching;
  }, [query, scope, status, users]);

  const regularUsers = users.filter((user) => user.role !== "admin");
  const activeCount = regularUsers.filter((user) => user.is_active).length;
  const overLimit = regularUsers.filter((user) => user.is_over_limit).length;
  const visibleRegularUsers = filtered.filter((user) => user.role !== "admin");
  const allVisibleSelected = visibleRegularUsers.length > 0 && visibleRegularUsers.every((user) => selectedUsernames.includes(user.username));

  const toggleSelected = (username: string) => setSelectedUsernames((current) => current.includes(username)
    ? current.filter((value) => value !== username)
    : [...current, username]);

  const toggleAllVisible = () => setSelectedUsernames((current) => {
    const visible = visibleRegularUsers.map((user) => user.username);
    return allVisibleSelected
      ? current.filter((username) => !visible.includes(username))
      : Array.from(new Set([...current, ...visible]));
  });

  const toggleStatus = async (user: ManagedUser) => {
    setWorkingUser(user.username);
    try {
      await api.post("/api/admin/users/status", { username: user.username, is_active: !user.is_active });
      notify(user.is_active ? "用户已停用，节点凭据已暂停" : "用户已启用，节点凭据正在恢复");
      await load();
    } catch (reason) {
      notify(messageOf(reason, "状态更新失败"), "error");
    } finally {
      setWorkingUser("");
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setWorkingUser(pendingDelete.username);
    try {
      await api.post("/api/admin/users/delete", { username: pendingDelete.username });
      notify(`用户 ${pendingDelete.username} 已删除`);
      setPendingDelete(null);
      await load();
    } catch (reason) {
      notify(messageOf(reason, "删除用户失败"), "error");
    } finally {
      setWorkingUser("");
    }
  };

  const renew = async (user: ManagedUser, days: number) => {
    setWorkingUser(user.username);
    try {
      const response = await api.post<{ success?: boolean; end_date?: string; message?: string; warnings?: string[] }>("/api/admin/users/extend", { username: user.username, days });
      if (response.success === false) throw new Error(response.message || "续期失败");
      const result = `${user.username} 已续期${response.end_date ? `至 ${response.end_date}` : ` ${days} 天`}`;
      if (response.warnings?.length) {
        notify(`${result}；${response.warnings.length} 项节点截止日下发失败，请到服务管理检查`, "error");
      } else {
        notify(result);
      }
      await load();
    } catch (reason) {
      notify(messageOf(reason, "续期失败"), "error");
    } finally {
      setWorkingUser("");
    }
  };

  const completed = async (message: string) => {
    setEditor(null);
    notify(message);
    await load();
  };

  const completedInSettings = async (username: string, message: string, tone?: "success" | "error") => {
    if (tone) notify(message, tone);
    else notify(message);
    const refreshedUsers = await load();
    if (!refreshedUsers) return;
    const refreshedUser = refreshedUsers.find((user) => user.username === username);
    setEditor((current) => current?.kind === "manage" && current.user.username === username
      ? refreshedUser ? { kind: "manage", user: refreshedUser } : null
      : current);
  };

  return (
    <>
      <PageHeader
        title="用户管理"
        description={scope === "invites" ? "管理 Telegram Bot 注册与账号绑定邀请码" : `${regularUsers.length} 位普通用户 · ${activeCount} 位启用 · ${overLimit} 位超出流量`}
        actions={scope === "invites" ? undefined : <><Button variant="secondary" disabled={!selectedUsernames.length} onClick={() => setShowBatchAuthorization(true)}><ShieldCheck size={17} />批量服务授权{selectedUsernames.length ? ` (${selectedUsernames.length})` : ""}</Button><IconButton label="刷新用户" onClick={() => void load()} disabled={loading}><RefreshCw size={18} /></IconButton><Button onClick={() => setEditor({ kind: "create" })}><Plus size={17} />新建用户</Button></>}
      />
      {scope !== "invites" && error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      <div className="users-toolbar">
        <div className="segmented-control" aria-label="用户视图">
          <button className={scope === "all" ? "is-active" : ""} onClick={() => changeScope("all")}>完整视图</button>
          <button className={scope === "renewal" ? "is-active" : ""} onClick={() => changeScope("renewal")}>续期工作台</button>
          <button className={scope === "invites" ? "is-active" : ""} onClick={() => changeScope("invites")}>TG 邀请码</button>
        </div>
        {scope !== "invites" ? <div className="users-toolbar-right">
          <Field label="状态" className="compact-field"><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">全部状态</option><option value="active">已启用</option><option value="disabled">已停用</option></select></Field>
          <div className="search-box users-search"><Search size={17} /><input aria-label="搜索用户" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="用户名、邮箱、套餐或短码" /></div>
        </div> : null}
      </div>
      {scope === "invites" ? <TGBotInvitesPanel notify={notify} /> : <Surface className="table-surface users-table-surface">
        {loading ? <div className="center-state"><Spinner label="正在加载用户" /></div> : filtered.length === 0 ? <EmptyState icon={<Users size={24} />} title={users.length ? "没有匹配的用户" : "暂无用户"} /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th className="user-select-cell"><input type="checkbox" aria-label="选择当前用户" checked={allVisibleSelected} disabled={!visibleRegularUsers.length} onChange={toggleAllVisible} /></th><th>用户</th><th>服务授权</th><th>流量用量</th><th>到期</th><th>启用</th><th aria-label="操作">操作</th></tr></thead>
              <tbody>{filtered.map((user) => {
                const isAdmin = user.role === "admin";
                const effectiveSpeed = user.speed_limit_override ?? user.speed_limit_mbps;
                const effectiveDevices = user.device_limit_override ?? user.device_limit;
                const expiry = expiryState(user.package_end_date);
                const identityDetail = [user.nickname && user.nickname !== user.username ? user.username : "", user.email].filter(Boolean).join(" · ") || "未填写邮箱";
                const rowWorking = workingUser === user.username;
                return <tr key={user.username}>
                  <td className="user-select-cell" data-label="选择">{isAdmin ? null : <input type="checkbox" aria-label={`选择用户 ${user.username}`} checked={selectedUsernames.includes(user.username)} onChange={() => toggleSelected(user.username)} />}</td>
                  <td data-label="用户">
                    <div className="user-list-identity">
                      <strong>{user.nickname || user.username}</strong>
                      <span>{identityDetail}</span>
                      {user.remark ? <small className="user-remark" title={user.remark}>{user.remark}</small> : null}
                    </div>
                  </td>
                  <td data-label="服务授权">
                    {isAdmin ? <Badge tone="info">管理员</Badge> : isPackageAuthorization(user)
                      ? <span className="user-package-chip"><PackageIcon size={14} />套餐 · {user.package_name || `#${user.package_id}`}</span>
                      : <span className="user-package-chip is-custom"><ShieldCheck size={14} />自定义</span>}
                  </td>
                  <td data-label="流量用量">
                    <TrafficProgress compact used={user.traffic_used} limit={user.traffic_limit} label={`${user.username} 流量使用率`} />
                    <small className="user-limit-note">{effectiveSpeed ? `${effectiveSpeed} Mbps` : "不限速"} · {effectiveDevices ? `${effectiveDevices} 台设备` : "设备不限"}</small>
                  </td>
                  <td data-label="到期">
                    <span className="user-expiry"><CalendarDays size={15} /><span><strong>{user.package_end_date || "-"}</strong><small>{user.package_end_date ? expiry.label : "未设置到期日"}</small></span></span>
                  </td>
                  <td data-label="启用">
                    {isAdmin ? <Badge tone="info">管理员</Badge> : <div className="user-status-toggle"><Toggle checked={user.is_active} onChange={() => void toggleStatus(user)} label={`${user.is_active ? "停用" : "启用"}用户 ${user.username}`} disabled={rowWorking} /></div>}
                    {user.is_over_limit ? <Badge tone="bad">流量超限</Badge> : null}
                  </td>
                  <td data-label="操作">
                    <div className="user-actions">
                      {scope === "renewal" && !isAdmin && user.package_id ? <div className="user-renew-actions"><Button type="button" variant="secondary" aria-label={`为 ${user.username} 续期 30 天`} disabled={workingUser !== ""} onClick={() => void renew(user, 30)}>{rowWorking ? <Spinner label="续期中" /> : "+30"}</Button><Button type="button" variant="secondary" aria-label={`为 ${user.username} 续期 60 天`} disabled={workingUser !== ""} onClick={() => void renew(user, 60)}>+60</Button><Button type="button" variant="secondary" aria-label={`为 ${user.username} 续期 90 天`} disabled={workingUser !== ""} onClick={() => void renew(user, 90)}>+90</Button></div> : null}
                      {!isAdmin ? <IconButton label={`复制订阅短码 ${user.username}`} disabled={rowWorking || !user.user_short_code} onClick={() => copyText(user.user_short_code ?? "", notify, "订阅短码")}><Link2 size={16} /></IconButton> : null}
                      <IconButton label={`用户设置 ${user.username}`} disabled={rowWorking} onClick={() => setEditor({ kind: "manage", user })}><Pencil size={16} /></IconButton>
                      {!isAdmin ? <IconButton className="is-danger" label={`删除用户 ${user.username}`} disabled={rowWorking} onClick={() => setPendingDelete(user)}><Trash2 size={16} /></IconButton> : null}
                    </div>
                  </td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </Surface>}

      {editor?.kind === "create" ? <CreateUserDialog notify={notify} onClose={() => setEditor(null)} onComplete={completed} /> : null}
      {editor?.kind === "manage" ? <UserSettingsDialog user={editor.user} notify={notify} working={workingUser === editor.user.username} onClose={() => setEditor(null)} onComplete={(message, tone) => completedInSettings(editor.user.username, message, tone)} onToggleStatus={async () => { await toggleStatus(editor.user); setEditor(null); }} onDelete={() => { setEditor(null); setPendingDelete(editor.user); }} /> : null}
      {pendingDelete ? <ConfirmDialog title="删除用户" description={`确认删除 ${pendingDelete.username}？该用户在所有节点上的客户端、私有路由、订阅关联和登录数据都会清理，此操作无法撤销。`} confirmLabel="确认删除" working={workingUser === pendingDelete.username} onCancel={() => setPendingDelete(null)} onConfirm={() => void remove()} /> : null}
      {showBatchAuthorization ? <BatchServiceAuthorizationDialog usernames={selectedUsernames} onClose={() => setShowBatchAuthorization(false)} onComplete={async (message, tone, failedUsernames = []) => { setShowBatchAuthorization(false); notify(message, tone); await load(); setSelectedUsernames(failedUsernames); }} /> : null}
    </>
  );
}

type UserSettingsPanel = "overview" | "profile" | "password" | "extend" | "limits" | "services" | "subscriptions" | "subaccounts";

function UserSettingsDialog({
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
      { id: "limits" as const, label: "流量与限额" },
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
        return <UserSettingsPanelFrame title="流量、限速与设备数" description="总流量仅覆盖套餐额度；服务器授权额度继续独立计算" onBack={() => setActivePanel("overview")}><LimitsSettingsPanel user={user} onBack={() => setActivePanel("overview")} onComplete={completePanel} /></UserSettingsPanelFrame>;
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
            {action("limits", "流量、限速与设备数", <Gauge size={17} />)}
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

function CreateUserDialog({ notify, onClose, onComplete }: { notify: Notify; onClose: () => void; onComplete: (message: string) => void }) {
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
  const [traffic, setTraffic] = useState(user.traffic_limit_override_gb == null ? "" : String(user.traffic_limit_override_gb));
  const [speed, setSpeed] = useState(user.speed_limit_override == null ? "" : String(user.speed_limit_override));
  const [devices, setDevices] = useState(user.device_limit_override == null ? "" : String(user.device_limit_override));
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
      await saveStep("/api/admin/users/traffic-limit", { username: user.username, traffic_limit_override_gb: traffic === "" ? null : Number(traffic) }, "总流量");
      await saveStep("/api/admin/users/limits", { username: user.username, speed_limit_override: speed === "" ? null : Number(speed), device_limit_override: devices === "" ? null : Number(devices) }, "用户限速与设备数");
      await saveStep("/api/admin/users/node-limits", { username: user.username, node_speed_overrides: numericMap(nodeSpeed), node_device_overrides: numericMap(nodeDevices) }, "节点级限额");
      onComplete(`${user.username} 的限额已下发`);
    } catch (reason) {
      const suffix = completed.length ? `；已保存：${completed.join("、")}。后续步骤未完成，请关闭后重新打开核对再重试` : "";
      setError(`${messageOf(reason, "限额保存失败")}${suffix}`);
    } finally { setWorking(false); }
  };
  return <form className="form-stack" onSubmit={submit}>
    {error ? <ErrorState message={error} /> : null}
    <Field label="总流量覆盖（GB）" hint={user.package_id ? "留空继承套餐；0 表示当前套餐显式不限流量" : "请先分配套餐；服务器授权额度在授权入口单独设置"}>
      <input type="number" min="0" step="0.01" value={traffic} onChange={(e) => setTraffic(e.target.value)} placeholder="继承套餐" disabled={!user.package_id} />
    </Field>
    <div className="form-grid">
      <Field label="用户限速覆盖（Mbps）" hint={`套餐值 ${user.speed_limit_mbps || 0}，留空继承`}><input type="number" min="0" step="0.1" value={speed} onChange={(e) => setSpeed(e.target.value)} placeholder="继承套餐" /></Field>
      <Field label="用户设备数覆盖" hint={`套餐值 ${user.device_limit || 0}，留空继承`}><input type="number" min="0" step="1" value={devices} onChange={(e) => setDevices(e.target.value)} placeholder="继承套餐" /></Field>
    </div>
    <div className="surface-heading compact-heading"><div><h2>节点级覆盖</h2><small>0 表示该节点显式不限，留空表示继承</small></div></div>
    <div className="node-limit-list">{nodes.length === 0 ? <span className="muted">当前没有可配置节点</span> : nodes.map((node) => <div key={node.id}><span><strong>{node.node_name}</strong><small>#{node.id} · {node.protocol}</small></span><Field label="Mbps"><input aria-label={`${node.node_name} 限速`} type="number" min="0" step="0.1" value={nodeSpeed[String(node.id)] ?? ""} onChange={(e) => setNodeSpeed({ ...nodeSpeed, [node.id]: e.target.value })} /></Field><Field label="设备"><input aria-label={`${node.node_name} 设备数`} type="number" min="0" step="1" value={nodeDevices[String(node.id)] ?? ""} onChange={(e) => setNodeDevices({ ...nodeDevices, [node.id]: e.target.value })} /></Field></div>)}</div>
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
