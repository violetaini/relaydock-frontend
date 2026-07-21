import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
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
  Server,
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
import { ServerGrantsDialog } from "./server-grants";
import type { NodeItem, NodeListResponse, PackageItem, UserItem } from "./types";
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
import "./users-workbench.css";

type Notify = (message: string, tone?: "success" | "error") => void;

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
  | { kind: "manage"; user: ManagedUser }
  | { kind: "profile"; user: ManagedUser }
  | { kind: "password"; user: ManagedUser }
  | { kind: "extend"; user: ManagedUser }
  | { kind: "limits"; user: ManagedUser }
  | { kind: "server-grants"; user: ManagedUser }
  | { kind: "subscriptions"; user: ManagedUser }
  | { kind: "subaccounts"; user: ManagedUser };

function messageOf(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function copyText(value: string, notify: Notify, label = "内容") {
  void navigator.clipboard.writeText(value).then(
    () => notify(`${label}已复制`),
    () => notify("复制失败，请手动选择", "error"),
  );
}

export function UsersWorkbenchPage({ notify }: { notify: Notify }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "renewal">("all");
  const [status, setStatus] = useState<"all" | "active" | "disabled">("all");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ManagedUser | null>(null);
  const [workingUser, setWorkingUser] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get<{ users?: ManagedUser[] }>("/api/admin/users");
      setUsers(response.users ?? []);
    } catch (reason) {
      setError(messageOf(reason, "用户列表加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const today = new Date();
    const renewalEdge = new Date(today.getTime() + 14 * 86400_000);
    return users.filter((user) => {
      if (status === "active" && !user.is_active) return false;
      if (status === "disabled" && user.is_active) return false;
      if (scope === "renewal") {
        if (!user.package_id || !user.package_end_date) return false;
        const end = new Date(`${user.package_end_date}T23:59:59`);
        if (!Number.isFinite(end.getTime()) || end > renewalEdge) return false;
      }
      return !needle || [user.username, user.nickname, user.email, user.remark, user.package_name, user.user_short_code]
        .some((value) => value?.toLowerCase().includes(needle));
    });
  }, [query, scope, status, users]);

  const regularUsers = users.filter((user) => user.role !== "admin");
  const activeCount = regularUsers.filter((user) => user.is_active).length;
  const overLimit = regularUsers.filter((user) => user.is_over_limit).length;

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

  const completed = async (message: string) => {
    setEditor(null);
    notify(message);
    await load();
  };

  return (
    <>
      <PageHeader
        title="用户管理"
        description={`${regularUsers.length} 位普通用户 · ${activeCount} 位启用 · ${overLimit} 位超出流量`}
        actions={<><IconButton label="刷新用户" onClick={() => void load()} disabled={loading}><RefreshCw size={18} /></IconButton><Button onClick={() => setEditor({ kind: "create" })}><Plus size={17} />新建用户</Button></>}
      />
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      <div className="users-toolbar">
        <div className="segmented-control" aria-label="用户视图">
          <button className={scope === "all" ? "is-active" : ""} onClick={() => setScope("all")}>完整视图</button>
          <button className={scope === "renewal" ? "is-active" : ""} onClick={() => setScope("renewal")}>续期视图</button>
        </div>
        <div className="users-toolbar-right">
          <Field label="状态" className="compact-field"><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">全部状态</option><option value="active">已启用</option><option value="disabled">已停用</option></select></Field>
          <div className="search-box users-search"><Search size={17} /><input aria-label="搜索用户" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="用户名、邮箱、套餐或短码" /></div>
        </div>
      </div>
      <Surface className="table-surface users-table-surface">
        {loading ? <div className="center-state"><Spinner label="正在加载用户" /></div> : filtered.length === 0 ? <EmptyState icon={<Users size={24} />} title={users.length ? "没有匹配的用户" : "暂无用户"} /> : (
          <div className="table-wrap"><table><thead><tr><th>用户</th><th>状态</th><th>套餐与到期</th><th>限额</th><th>订阅短码</th><th>操作</th></tr></thead><tbody>{filtered.map((user) => {
            const isAdmin = user.role === "admin";
            const effectiveSpeed = user.speed_limit_override ?? user.speed_limit_mbps;
            const effectiveDevices = user.device_limit_override ?? user.device_limit;
            return <tr key={user.username}>
              <td data-label="用户"><div className="primary-cell"><span className="user-avatar">{(user.nickname || user.username).slice(0, 1).toUpperCase()}</span><span><strong>{user.nickname || user.username}</strong><small>{user.username}{user.email ? ` · ${user.email}` : ""}</small>{user.remark ? <small className="user-remark">{user.remark}</small> : null}</span></div></td>
              <td data-label="状态"><Badge tone={user.is_active ? "good" : "bad"}>{user.is_active ? "启用" : "停用"}</Badge>{isAdmin ? <Badge tone="info">管理员</Badge> : user.is_over_limit ? <Badge tone="warn">流量超限</Badge> : null}</td>
              <td data-label="套餐与到期"><strong>{user.package_name || "未分配套餐"}</strong><small className="cell-note">{user.package_end_date ? `到期 ${user.package_end_date}` : "无到期日"}</small></td>
              <td data-label="限额"><strong>{formatBytes(user.traffic_used)}</strong><small className="cell-note">{user.traffic_limit ? `流量 ${formatBytes(user.traffic_limit)}` : "流量不限"} · {effectiveSpeed ? `${effectiveSpeed} Mbps` : "不限速"} · {effectiveDevices ? `${effectiveDevices} 设备` : "设备不限"}</small></td>
              <td data-label="订阅短码">{user.user_short_code ? <button className="inline-copy" onClick={() => copyText(user.user_short_code ?? "", notify, "短码")}><code>{user.user_short_code}</code><Copy size={13} /></button> : <span className="muted">未生成</span>}<small className="cell-note">{user.custom_user_short_code ? "自定义短码" : "系统短码"}</small></td>
              <td data-label="操作"><div className="user-actions"><Button variant="secondary" aria-label={`用户设置 ${user.username}`} onClick={() => setEditor({ kind: "manage", user })}><UserCog size={16} />用户设置<ChevronRight size={15} /></Button></div></td>
            </tr>;
          })}</tbody></table></div>
        )}
      </Surface>

      {editor?.kind === "create" ? <CreateUserDialog notify={notify} onClose={() => setEditor(null)} onComplete={completed} /> : null}
      {editor?.kind === "manage" ? <UserSettingsDialog user={editor.user} working={workingUser === editor.user.username} onClose={() => setEditor(null)} onOpen={(kind) => setEditor({ kind, user: editor.user } as Editor)} onComplete={completed} onToggleStatus={async () => { await toggleStatus(editor.user); setEditor(null); }} onDelete={() => { setEditor(null); setPendingDelete(editor.user); }} /> : null}
      {editor?.kind === "profile" ? <ProfileDialog user={editor.user} onClose={() => setEditor(null)} onComplete={completed} /> : null}
      {editor?.kind === "password" ? <PasswordDialog user={editor.user} notify={notify} onClose={() => setEditor(null)} /> : null}
      {editor?.kind === "extend" ? <ExtendDialog user={editor.user} onClose={() => setEditor(null)} onComplete={completed} /> : null}
      {editor?.kind === "limits" ? <LimitsDialog user={editor.user} onClose={() => setEditor(null)} onComplete={completed} /> : null}
      {editor?.kind === "server-grants" ? <ServerGrantsDialog username={editor.user.username} notify={notify} onClose={() => setEditor(null)} /> : null}
      {editor?.kind === "subscriptions" ? <SubscriptionsDialog user={editor.user} onClose={() => setEditor(null)} onComplete={completed} /> : null}
      {editor?.kind === "subaccounts" ? <SubaccountsDialog user={editor.user} onClose={() => setEditor(null)} /> : null}
      {pendingDelete ? <ConfirmDialog title="删除用户" description={`确认删除 ${pendingDelete.username}？该用户在所有节点上的客户端、私有路由、订阅关联和登录数据都会清理，此操作无法撤销。`} confirmLabel="确认删除" working={workingUser === pendingDelete.username} onCancel={() => setPendingDelete(null)} onConfirm={() => void remove()} /> : null}
    </>
  );
}

type UserEditorKind = Exclude<Editor["kind"], "create" | "manage">;

interface PackageMutationResponse {
  success?: boolean;
  message?: string;
  error?: string;
  warnings?: string[];
}

function UserSettingsDialog({
  user,
  working,
  onClose,
  onOpen,
  onComplete,
  onToggleStatus,
  onDelete,
}: {
  user: ManagedUser;
  working: boolean;
  onClose: () => void;
  onOpen: (kind: UserEditorKind) => void;
  onComplete: (message: string) => Promise<void>;
  onToggleStatus: () => Promise<void>;
  onDelete: () => void;
}) {
  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [packageID, setPackageID] = useState(String(user.package_id ?? ""));
  const [startDate, setStartDate] = useState("");
  const [expireDate, setExpireDate] = useState(user.package_end_date ?? "");
  const [packageLoading, setPackageLoading] = useState(user.role !== "admin");
  const [packageWorking, setPackageWorking] = useState(false);
  const [packageError, setPackageError] = useState("");
  const [confirmUnassign, setConfirmUnassign] = useState(false);

  useEffect(() => {
    if (user.role === "admin") return;
    api.get<{ packages?: PackageItem[] }>("/api/admin/packages")
      .then((response) => setPackages(response.packages ?? []))
      .catch((reason) => setPackageError(messageOf(reason, "套餐列表加载失败")))
      .finally(() => setPackageLoading(false));
  }, [user.role]);

  const selectedPackage = packages.find((item) => item.id === Number(packageID));

  const assignPackage = async (event: FormEvent) => {
    event.preventDefault();
    if (!packageID) {
      setPackageError("请选择套餐");
      return;
    }
    if (startDate && expireDate && expireDate < startDate) {
      setPackageError("到期日期不能早于开始日期");
      return;
    }
    setPackageWorking(true);
    setPackageError("");
    try {
      const response = await api.post<PackageMutationResponse>("/api/admin/packages/assign", {
        username: user.username,
        package_id: Number(packageID),
        ...(startDate ? { start_date: startDate } : {}),
        ...(expireDate ? { expire_date: expireDate } : {}),
      });
      if (response.success === false) throw new Error(response.error || response.message || "套餐分配失败");
      const warning = response.warnings?.length ? `，有 ${response.warnings.length} 项节点下发警告` : "";
      await onComplete(`已为 ${user.username} ${user.package_id ? "更新" : "分配"}“${selectedPackage?.name ?? "套餐"}”${warning}`);
    } catch (reason) {
      setPackageError(messageOf(reason, "套餐分配失败"));
    } finally {
      setPackageWorking(false);
    }
  };

  const unassignPackage = async () => {
    setPackageWorking(true);
    setPackageError("");
    try {
      const response = await api.post<PackageMutationResponse>("/api/admin/packages/unassign", { username: user.username });
      if (response.success === false) throw new Error(response.error || response.message || "解绑套餐失败");
      setConfirmUnassign(false);
      await onComplete(`已解绑 ${user.username} 的套餐`);
    } catch (reason) {
      setPackageError(messageOf(reason, "解绑套餐失败"));
    } finally {
      setPackageWorking(false);
    }
  };

  const action = (kind: UserEditorKind, label: string, icon: ReactNode) => (
    <button type="button" className="user-setting-row" onClick={() => onOpen(kind)}>
      <span className="user-setting-row-icon">{icon}</span><span><strong>{label}</strong><small>打开对应设置</small></span><ChevronRight size={16} />
    </button>
  );

  return (
    <Dialog title={`用户设置 · ${user.username}`} description="用户资料、套餐、节点权限和订阅都从这里管理" onClose={onClose} wide>
      <div className="user-settings-dialog">
        <div className="user-settings-summary">
          <span className="user-settings-avatar">{(user.nickname || user.username).slice(0, 1).toUpperCase()}</span>
          <span><strong>{user.nickname || user.username}</strong><small>{user.email || "未填写邮箱"} · {user.is_active ? "账号已启用" : "账号已停用"}</small></span>
          <Badge tone={user.role === "admin" ? "info" : user.is_active ? "good" : "bad"}>{user.role === "admin" ? "管理员" : user.is_active ? "启用" : "停用"}</Badge>
        </div>

        {user.role !== "admin" ? (
          <section className="user-settings-section">
            <div className="user-settings-section-heading"><div><h2>套餐与有效期</h2><p>分配套餐后，节点凭据和订阅会按套餐同步</p></div><PackageIcon size={19} /></div>
            {packageError ? <ErrorState message={packageError} /> : null}
            {packageLoading ? <div className="user-settings-loading"><Spinner label="正在加载套餐" /></div> : <form className="user-package-form" onSubmit={(event) => void assignPackage(event)}>
              <Field label="套餐"><select aria-label="用户套餐" required value={packageID} onChange={(event) => setPackageID(event.target.value)}><option value="">请选择套餐</option>{packages.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.traffic_limit_gb} GB / {item.cycle_days} 天</option>)}</select></Field>
              <Field label="开始日期" hint="留空表示今天"><input type="date" aria-label="套餐开始日期" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></Field>
              <Field label="到期日期" hint={`留空表示开始后 ${selectedPackage?.cycle_days ?? 30} 天`}><input type="date" aria-label="套餐到期日期" value={expireDate} onChange={(event) => setExpireDate(event.target.value)} /></Field>
              <div className="user-package-actions"><Button type="submit" disabled={packageWorking || !packageID}>{packageWorking ? <Spinner label="正在下发" /> : <><PackageIcon size={16} />{user.package_id ? "更新套餐" : "分配套餐"}</>}</Button>{user.package_id ? <Button type="button" variant="ghost" onClick={() => setConfirmUnassign(true)} disabled={packageWorking}>解绑套餐</Button> : null}</div>
            </form>}
            {user.package_id ? <div className="user-package-current"><span>当前套餐：<strong>{user.package_name || `套餐 #${user.package_id}`}</strong></span><span>{user.package_end_date ? `到期 ${user.package_end_date}` : "未设置到期日"}</span><Button type="button" variant="ghost" onClick={() => onOpen("extend")}><CalendarPlus size={15} />续期</Button></div> : null}
          </section>
        ) : null}

        <section className="user-settings-section">
          <div className="user-settings-section-heading"><div><h2>账号资料</h2><p>集中编辑可公开显示的用户信息</p></div><Pencil size={18} /></div>
          {action("profile", "资料、备注与订阅短码", <Pencil size={17} />)}
          {user.role !== "admin" ? action("password", "重置登录密码", <KeyRound size={17} />) : null}
        </section>

        {user.role !== "admin" ? <section className="user-settings-section">
          <div className="user-settings-section-heading"><div><h2>节点与订阅</h2><p>所有授权和下发内容统一从用户设置进入</p></div><Server size={18} /></div>
          {action("server-grants", "服务器授权与自建节点", <Server size={17} />)}
          {action("limits", "流量、限速与设备数", <Gauge size={17} />)}
          {action("subscriptions", "订阅文件分配", <Link2 size={17} />)}
          {action("subaccounts", "查看节点子账号", <UserCog size={17} />)}
        </section> : null}

        {user.role !== "admin" ? <section className="user-settings-danger">
          <Button type="button" variant="secondary" onClick={() => void onToggleStatus()} disabled={working}>{user.is_active ? <><UserRoundX size={16} />停用用户</> : <><UserRoundCheck size={16} />启用用户</>}</Button>
          <Button type="button" variant="danger" onClick={onDelete} disabled={working}><Trash2 size={16} />删除用户</Button>
        </section> : null}
      </div>
      {confirmUnassign ? <ConfirmDialog title="解绑用户套餐" description={`确认解绑 ${user.username} 的“${user.package_name || "当前套餐"}”？系统会同步清理该套餐下发的节点凭据和订阅关联。`} confirmLabel="确认解绑" working={packageWorking} onCancel={() => setConfirmUnassign(false)} onConfirm={() => void unassignPackage()} /> : null}
    </Dialog>
  );
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

function ProfileDialog({ user, onClose, onComplete }: { user: ManagedUser; onClose: () => void; onComplete: (message: string) => void }) {
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
  return <Dialog title={`编辑 ${user.username}`} description="短码留空时恢复系统自动短码" onClose={onClose}><form className="form-stack" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<Field label="邮箱"><div className="input-with-icon"><Mail size={16} /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div></Field><Field label="自定义订阅短码" hint="2-16 位字母、数字、下划线或横杠"><input pattern="[A-Za-z0-9_-]{2,16}" value={shortCode} onChange={(e) => setShortCode(e.target.value)} placeholder={user.user_short_code || "系统自动生成"} /></Field><Field label="备注"><textarea value={remark} onChange={(e) => setRemark(e.target.value)} /></Field><div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在保存" /> : <><Pencil size={16} />保存资料</>}</Button></div></form></Dialog>;
}

function PasswordDialog({ user, notify, onClose }: { user: ManagedUser; notify: Notify; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [result, setResult] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError("");
    try { const response = await api.post<{ password: string }>("/api/admin/users/reset-password", { username: user.username, new_password: password }); setResult(response.password); }
    catch (reason) { setError(messageOf(reason, "密码重置失败")); } finally { setWorking(false); }
  };
  return <Dialog title={`重置 ${user.username} 的密码`} description="留空时生成随机密码；提交后旧密码立即失效" onClose={onClose}>{result ? <div className="form-stack"><div className="secret-box"><code>{result}</code><IconButton label="复制新密码" onClick={() => copyText(result, notify, "新密码")}><Copy size={16} /></IconButton></div><div className="dialog-actions"><Button onClick={onClose}>完成</Button></div></div> : <form className="form-stack" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<Field label="新密码"><input autoFocus type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="留空自动生成" /></Field><div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在重置" /> : <><KeyRound size={16} />重置密码</>}</Button></div></form>}</Dialog>;
}

function ExtendDialog({ user, onClose, onComplete }: { user: ManagedUser; onClose: () => void; onComplete: (message: string) => void }) {
  const [days, setDays] = useState("30"); const [working, setWorking] = useState(false); const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); setWorking(true); setError(""); try { const response = await api.post<{ end_date: string }>("/api/admin/users/extend", { username: user.username, days: Number(days) }); onComplete(`${user.username} 已续期至 ${response.end_date}`); } catch (reason) { setError(messageOf(reason, "续期失败")); } finally { setWorking(false); } };
  return <Dialog title={`为 ${user.username} 续期`} description={`当前到期日：${user.package_end_date || "未设置"}；仅延长有效期，不重置流量`} onClose={onClose}><form className="form-stack" onSubmit={submit}>{error ? <ErrorState message={error} /> : null}<Field label="延长天数"><input autoFocus type="number" min="1" max="3650" value={days} onChange={(e) => setDays(e.target.value)} /></Field><div className="quick-days">{[30, 90, 180, 365].map((value) => <Button key={value} type="button" variant={days === String(value) ? "primary" : "secondary"} onClick={() => setDays(String(value))}>{value} 天</Button>)}</div><div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working || Number(days) < 1}>{working ? <Spinner label="正在续期" /> : <><CalendarPlus size={16} />确认续期</>}</Button></div></form></Dialog>;
}

function LimitsDialog({ user, onClose, onComplete }: { user: ManagedUser; onClose: () => void; onComplete: (message: string) => void }) {
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
  return (
    <Dialog title={`${user.username} 的用户限额`} description="总流量只覆盖套餐额度；每台服务器授权的额度继续独立计算" onClose={onClose} wide>
      <form className="form-stack" onSubmit={submit}>
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
        <div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在下发" /> : <><SlidersHorizontal size={16} />保存并下发</>}</Button></div>
      </form>
    </Dialog>
  );
}

function SubscriptionsDialog({ user, onClose, onComplete }: { user: ManagedUser; onClose: () => void; onComplete: (message: string) => void }) {
  const [files, setFiles] = useState<SubscribeFile[]>([]); const [selected, setSelected] = useState<number[]>([]); const [loading, setLoading] = useState(true); const [working, setWorking] = useState(false); const [error, setError] = useState("");
  useEffect(() => { Promise.all([api.get<{ files?: SubscribeFile[] }>("/api/admin/subscribe-files"), api.get<{ subscription_ids?: number[] }>(`/api/admin/users/${encodeURIComponent(user.username)}/subscriptions`)]).then(([all, assigned]) => { setFiles(all.files ?? []); setSelected(assigned.subscription_ids ?? []); }).catch((reason) => setError(messageOf(reason, "订阅分配加载失败"))).finally(() => setLoading(false)); }, [user.username]);
  const submit = async () => { setWorking(true); setError(""); try { await api.put(`/api/admin/users/${encodeURIComponent(user.username)}/subscriptions`, { subscription_ids: selected }); onComplete(`${user.username} 的订阅分配已更新`); } catch (reason) { setError(messageOf(reason, "订阅分配保存失败")); } finally { setWorking(false); } };
  return <Dialog title={`${user.username} 的订阅`} description="选择后，该用户可在自己的订阅链接中访问这些订阅文件" onClose={onClose} wide>{error ? <ErrorState message={error} /> : null}{loading ? <div className="center-state"><Spinner /></div> : <div className="form-stack"><div className="preview-list subscription-assignment-list">{files.length === 0 ? <div><span className="muted">暂无可分配订阅</span></div> : files.map((file) => <div key={file.id}><label className="checkbox-row"><input type="checkbox" checked={selected.includes(file.id)} onChange={() => setSelected((current) => current.includes(file.id) ? current.filter((id) => id !== file.id) : [...current, file.id])} /><span><strong>{file.name}</strong><small>{file.description || file.filename}</small></span></label><Badge tone={selected.includes(file.id) ? "good" : "neutral"}>{file.type || "订阅"}</Badge></div>)}</div><div className="dialog-actions"><Button variant="secondary" onClick={onClose}>取消</Button><Button onClick={() => void submit()} disabled={working}>{working ? <Spinner label="正在保存" /> : <><Link2 size={16} />保存分配（{selected.length}）</>}</Button></div></div>}</Dialog>;
}

function SubaccountsDialog({ user, onClose }: { user: ManagedUser; onClose: () => void }) {
  const [items, setItems] = useState<Subaccount[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => { api.get<{ subaccounts?: Subaccount[] }>(`/api/admin/users/subaccounts?username=${encodeURIComponent(user.username)}`).then((r) => setItems(r.subaccounts ?? [])).catch((reason) => setError(messageOf(reason, "子账号加载失败"))).finally(() => setLoading(false)); }, [user.username]);
  return <Dialog title={`${user.username} 的节点子账号`} description="查看已下发到入站和私有路由的凭据标识" onClose={onClose} wide>{error ? <ErrorState message={error} /> : null}{loading ? <div className="center-state"><Spinner /></div> : items.length === 0 ? <EmptyState icon={<Unplug size={24} />} title="暂无节点子账号" /> : <div className="subaccount-list">{items.map((item, index) => <div key={`${item.type}-${item.node_id}-${item.server_id}-${item.inbound_tag}-${index}`}><span className="subaccount-icon"><ShieldCheck size={18} /></span><span><strong>{item.node_name || item.server_name || item.inbound_tag || "节点账号"}</strong><small>{item.type === "routed" ? "私有路由" : "入站凭据"} · {item.protocol || item.inbound_tag || "未知协议"}</small><code>{item.email || item.identifier || "凭据已隐藏"}</code></span><Badge tone={item.is_active ? "good" : "bad"}>{item.is_active ? "有效" : "暂停"}</Badge></div>)}</div>}</Dialog>;
}
