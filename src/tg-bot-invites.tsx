import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Bot, Copy, Plus, RefreshCw, Search, TicketCheck, Trash2, X } from "lucide-react";
import { api } from "./api";
import type { PackageItem, UserItem } from "./types";
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
  Surface,
} from "./ui";
import "./operations-panels.css";

type Notify = (message: string, tone?: "success" | "error") => void;
type RemoteActionResponse = { success?: boolean; message?: string; error?: string };

export interface TGBotInvite {
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

function operationError(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function assertRemoteActionSucceeded(response: RemoteActionResponse, fallback: string) {
  if (response?.success === false) throw new Error(response.error || response.message || fallback);
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

function packageOptionLabel(item: PackageItem): string {
  return `${item.name} · ${item.traffic_limit_gb} GB / ${item.cycle_days} 天`;
}

function userOptionLabel(item: UserItem): string {
  const nickname = item.nickname?.trim();
  return nickname && nickname !== item.username ? `${nickname}（${item.username}）` : item.username;
}

export function TGBotInvitesPanel({ notify }: { notify: Notify }) {
  const [invites, setInvites] = useState<TGBotInvite[]>([]);
  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [referencesLoading, setReferencesLoading] = useState(true);
  const [referencesError, setReferencesError] = useState("");
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

  const loadReferences = useCallback(async () => {
    setReferencesLoading(true);
    setReferencesError("");
    const [packageResult, userResult] = await Promise.allSettled([
      api.get<{ packages?: PackageItem[] }>("/api/admin/packages"),
      api.get<{ users?: UserItem[] }>("/api/admin/users"),
    ]);
    const failures: string[] = [];
    if (packageResult.status === "fulfilled") {
      setPackages([...(packageResult.value.packages ?? [])].sort((left, right) => left.name.localeCompare(right.name, "zh-CN")));
    } else {
      failures.push(operationError(packageResult.reason, "套餐选项加载失败"));
    }
    if (userResult.status === "fulfilled") {
      setUsers([...(userResult.value.users ?? [])].sort((left, right) => left.username.localeCompare(right.username, "zh-CN")));
    } else {
      failures.push(operationError(userResult.reason, "用户选项加载失败"));
    }
    setReferencesError(failures.join("；"));
    setReferencesLoading(false);
  }, []);

  useEffect(() => { void load(); void loadReferences(); }, [load, loadReferences]);

  const packagesByID = useMemo(() => new Map(packages.map((item) => [item.id, item])), [packages]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return invites.filter((invite) => {
      const state = inviteState(invite);
      if (filter === "usable" && !state.usable) return false;
      if (filter === "unavailable" && state.usable) return false;
      return !query || [invite.code, invite.bind_username, invite.remark, invite.created_by, invite.package_id ? packagesByID.get(invite.package_id)?.name : undefined]
        .some((value) => value?.toLowerCase().includes(query));
    });
  }, [filter, invites, packagesByID, search]);

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
    <div className="ops-stack">
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      <Surface className="table-surface ops-invite-surface">
        <div className="surface-heading ops-invite-heading">
          <div><h2><TicketCheck size={17} />TG Bot 邀请码</h2><small>{invites.filter((invite) => inviteState(invite).usable).length} 个当前可用</small></div>
          <div className="ops-inline-actions"><IconButton label="刷新邀请码" onClick={() => void load()}><RefreshCw size={17} /></IconButton><Button onClick={() => setShowCreate(true)}><Plus size={16} />创建邀请码</Button></div>
        </div>
        <div className="ops-bot-context" role="note"><Bot size={18} /><span><strong>邀请码由独立 Telegram Bot 使用</strong><small>Arcway 主控只负责生成和校验代码；需要另行部署 Bot，用户才能在 Telegram 中注册或绑定账号。</small></span></div>
        <div className="ops-list-filters">
          <label className="search-box"><Search size={16} /><input aria-label="搜索邀请码" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="代码、账号或备注" /></label>
          <Field label="邀请码状态"><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">全部状态</option><option value="usable">仅可用</option><option value="unavailable">仅不可用</option></select></Field>
        </div>
        {loading ? <div className="center-state"><Spinner /></div> : visible.length === 0 ? <EmptyState icon={<TicketCheck size={22} />} title={invites.length ? "没有匹配的邀请码" : "暂无邀请码"} action={<Button onClick={() => setShowCreate(true)}><Plus size={16} />创建邀请码</Button>} /> : (
          <div className="table-wrap"><table className="invite-table"><thead><tr><th>邀请码</th><th>用途</th><th>使用次数</th><th>有效期</th><th>状态</th><th>备注</th><th aria-label="操作" /></tr></thead><tbody>{visible.map((invite) => { const state = inviteState(invite); return (
            <tr key={invite.code}>
              <td data-label="邀请码"><div className="ops-code-cell"><code className="inline-code">{invite.code}</code><IconButton label={`复制邀请码 ${invite.code}`} onClick={() => void copyCode(invite.code)}><Copy size={15} /></IconButton></div><small className="cell-note">{formatDate(invite.created_at)}</small></td>
              <td data-label="用途"><strong>{invite.kind === "bind" ? "关联 Telegram" : "通过 Bot 注册"}</strong>{invite.kind === "bind" ? <small className="cell-note">{invite.bind_username || "未指定账号"}</small> : invite.package_id ? <small className="cell-note">{packagesByID.get(invite.package_id)?.name || `套餐 #${invite.package_id}`}{invite.duration_months ? ` · ${invite.duration_months} 个月` : ""}</small> : null}</td>
              <td data-label="使用次数">{invite.used_count} / {invite.max_uses || "不限"}</td>
              <td data-label="有效期">{invite.expires_at ? formatDate(invite.expires_at) : "长期有效"}</td>
              <td data-label="状态"><Badge tone={state.tone}>{state.label}</Badge></td>
              <td data-label="备注">{invite.remark || "-"}</td>
              <td data-label="操作" className="actions-cell"><div className="ops-row-actions">{state.usable ? <IconButton label={`撤销邀请码 ${invite.code}`} onClick={() => setPending({ kind: "revoke", invite })}><X size={16} /></IconButton> : <IconButton label={`删除邀请码 ${invite.code}`} onClick={() => setPending({ kind: "delete", invite })}><Trash2 size={16} /></IconButton>}</div></td>
            </tr>
          ); })}</tbody></table></div>
        )}
      </Surface>
      {showCreate ? <CreateInviteDialog packages={packages} users={users} referencesLoading={referencesLoading} referencesError={referencesError} onReloadReferences={() => void loadReferences()} onClose={() => setShowCreate(false)} onCreated={async (code) => { setShowCreate(false); notify(`邀请码已创建：${code}`); await load(); }} /> : null}
      {pending ? <ConfirmDialog title={pending.kind === "revoke" ? "撤销邀请码" : "删除邀请码"} description={pending.kind === "revoke" ? `撤销“${pending.invite.code}”后将无法继续使用，但会保留历史记录。` : `将永久删除“${pending.invite.code}”及其使用记录，此操作不可恢复。`} confirmLabel={pending.kind === "revoke" ? "确认撤销" : "确认删除"} working={working} onCancel={() => setPending(null)} onConfirm={() => void runPending()} /> : null}
    </div>
  );
}

function CreateInviteDialog({ packages, users, referencesLoading, referencesError, onReloadReferences, onClose, onCreated }: {
  packages: PackageItem[];
  users: UserItem[];
  referencesLoading: boolean;
  referencesError: string;
  onReloadReferences: () => void;
  onClose: () => void;
  onCreated: (code: string) => void;
}) {
  const [form, setForm] = useState({ kind: "new", bind_username: "", package_id: "", max_uses: "1", expires_at: "", remark: "", duration_months: "0" });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const bindUsers = useMemo(() => users.filter((item) => item.role !== "admin" && item.is_active), [users]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (form.kind === "bind" && !form.bind_username.trim()) return setError("请选择要关联的 Arcway 账号");
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
    <Dialog title="创建 TG Bot 邀请码" description="仅供另行部署的 Telegram Bot 消费；Arcway 主控本身不提供兑换入口" onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        {error ? <ErrorState message={error} /> : null}
        {referencesError ? <ErrorState message={referencesError} onRetry={onReloadReferences} /> : null}
        <Field label="用途"><select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value, bind_username: "", package_id: "" })}><option value="new">通过 Telegram Bot 注册新账号</option><option value="bind">绑定 Telegram 到现有 Arcway 账号</option></select></Field>
        {form.kind === "bind" ? <Field label="Arcway 账号"><select autoFocus required disabled={referencesLoading || bindUsers.length === 0} value={form.bind_username} onChange={(event) => setForm({ ...form, bind_username: event.target.value })}><option value="">{referencesLoading ? "正在加载用户..." : bindUsers.length ? "请选择现有用户" : "没有可绑定的有效普通用户"}</option>{bindUsers.map((item) => <option key={item.username} value={item.username}>{userOptionLabel(item)}</option>)}</select></Field> : <div className="form-grid"><Field label="注册套餐" hint="可选；注册成功后自动分配"><select disabled={referencesLoading} value={form.package_id} onChange={(event) => setForm({ ...form, package_id: event.target.value })}><option value="">{referencesLoading ? "正在加载套餐..." : "不分配套餐"}</option>{packages.map((item) => <option key={item.id} value={item.id}>{packageOptionLabel(item)}</option>)}</select></Field><Field label="账号有效月数" hint="0 表示沿用套餐周期"><input type="number" min="0" max="120" value={form.duration_months} onChange={(event) => setForm({ ...form, duration_months: event.target.value })} /></Field></div>}
        <div className="form-grid"><Field label="最大使用次数"><input required type="number" min="1" max="10000" value={form.max_uses} onChange={(event) => setForm({ ...form, max_uses: event.target.value })} /></Field><Field label="过期时间" hint="留空表示长期有效"><input type="datetime-local" value={form.expires_at} onChange={(event) => setForm({ ...form, expires_at: event.target.value })} /></Field></div>
        <Field label="备注"><input value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} placeholder="用途或发放对象" /></Field>
        <div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={working}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在创建" /> : <><Plus size={16} />创建邀请码</>}</Button></div>
      </form>
    </Dialog>
  );
}
