import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Check,
  Clock3,
  Code2,
  Copy,
  Eye,
  EyeOff,
  Image,
  KeyRound,
  Link2,
  Mail,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { api } from "./api";
import { TwoFactorSettings } from "./two-factor";
import type { Profile } from "./types";
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
import "./account-workbench.css";

type Notify = (message: string, tone?: "success" | "error") => void;

interface TokenBundle {
  token: string;
  user_short_code?: string;
  custom_user_short_code?: string;
}

interface PersonalAPIToken {
  id: number;
  name: string;
  created_at: string;
  last_used_at?: string;
}

interface APITokenListResponse {
  success?: boolean;
  tokens?: PersonalAPIToken[];
  error?: string;
  message?: string;
}

interface APITokenCreateResponse {
  success?: boolean;
  token?: string;
  name?: string;
  error?: string;
  message?: string;
}

function messageOf(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function formatDate(value?: string): string {
  if (!value) return "从未使用";
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

async function copyText(value: string, notify: Notify, label: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(value);
    notify(`${label}已复制`);
    return true;
  } catch {
    notify("复制失败，请手动选择", "error");
    return false;
  }
}

export function AccountWorkbenchPage({ notify }: { notify: Notify }) {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <>
      <PageHeader
        title="账户中心"
        description="管理个人资料、登录安全与访问凭据"
        actions={<IconButton label="刷新账户信息" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={17} /></IconButton>}
      />
      <div className="account-workbench">
        <ProfilePanel notify={notify} refreshKey={refreshKey} />
        <PasswordPanel notify={notify} />
        <SubscriptionCredentialsPanel notify={notify} refreshKey={refreshKey} />
        <PersonalAPITokensPanel notify={notify} refreshKey={refreshKey} />
        <TwoFactorSettings key={refreshKey} notify={notify} />
      </div>
    </>
  );
}

function PanelHeading({ icon, title, description, trailing }: { icon: React.ReactNode; title: string; description: string; trailing?: React.ReactNode }) {
  return (
    <div className="account-panel-heading">
      <span className="settings-icon">{icon}</span>
      <span className="account-panel-title"><h2>{title}</h2><p>{description}</p></span>
      {trailing ? <span className="account-panel-trailing">{trailing}</span> : null}
    </div>
  );
}

function ProfilePanel({ notify, refreshKey }: { notify: Notify; refreshKey: number }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [draft, setDraft] = useState({ username: "", email: "", nickname: "", avatar_url: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get<Profile>("/api/user/profile");
      if (!response?.username) throw new Error("个人资料响应无效");
      setProfile(response);
      setDraft({
        username: response.username,
        email: response.email ?? "",
        nickname: response.nickname ?? "",
        avatar_url: response.avatar_url ?? "",
      });
    } catch (reason) {
      setError(messageOf(reason, "个人资料加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const changed = useMemo(() => Boolean(profile) && (
    draft.username.trim() !== profile?.username
    || draft.email.trim() !== (profile?.email ?? "")
    || draft.nickname.trim() !== (profile?.nickname ?? "")
    || draft.avatar_url.trim() !== (profile?.avatar_url ?? "")
  ), [draft, profile]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!profile) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        username: draft.username.trim(),
        email: draft.email.trim(),
        nickname: draft.nickname.trim(),
        avatar_url: draft.avatar_url.trim(),
      };
      const response = await api.put<{ profile?: Profile }>("/api/user/settings", payload);
      if (!response?.profile?.username) throw new Error("个人资料更新响应无效");
      setProfile(response.profile);
      setDraft({
        username: response.profile.username,
        email: response.profile.email ?? "",
        nickname: response.profile.nickname ?? "",
        avatar_url: response.profile.avatar_url ?? "",
      });
      window.dispatchEvent(new CustomEvent("arcway:profile-updated", { detail: response.profile }));
      notify("个人资料已更新");
    } catch (reason) {
      const message = messageOf(reason, "个人资料更新失败");
      setError(message);
      notify(message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Surface className="account-panel account-profile-panel">
      <PanelHeading
        icon={<UserRound size={19} />}
        title="个人资料"
        description="控制账户显示信息与联系方式"
        trailing={profile ? <Badge tone={profile.is_admin ? "info" : "neutral"}>{profile.is_admin ? "管理员" : "用户"}</Badge> : undefined}
      />
      {loading ? <div className="account-loading"><Spinner label="正在加载资料" /></div> : null}
      {!loading && error && !profile ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {!loading && profile ? (
        <form className="account-form" onSubmit={save}>
          {error ? <ErrorState message={error} /> : null}
          <div className="account-identity">
            <span className="account-avatar-preview" aria-hidden="true">
              <span>{(draft.nickname || draft.username || "U").slice(0, 1).toUpperCase()}</span>
              {draft.avatar_url ? <img src={draft.avatar_url} alt="" onLoad={(event) => { event.currentTarget.hidden = false; }} onError={(event) => { event.currentTarget.hidden = true; }} /> : null}
            </span>
            <span><strong>{draft.nickname || draft.username}</strong><small>{profile.role || "user"}</small></span>
          </div>
          <div className="account-field-grid">
            <Field label="用户名" hint={profile.is_admin ? "管理员用户名不可修改" : "修改后当前登录会话保持有效"}>
              <div className="input-with-icon"><UserRound size={16} /><input aria-label="用户名" required disabled={profile.is_admin} autoComplete="username" value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} /></div>
            </Field>
            <Field label="昵称">
              <div className="input-with-icon"><UserRound size={16} /><input autoComplete="name" value={draft.nickname} onChange={(event) => setDraft({ ...draft, nickname: event.target.value })} /></div>
            </Field>
            <Field label="邮箱">
              <div className="input-with-icon"><Mail size={16} /><input type="email" autoComplete="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></div>
            </Field>
            <Field label="头像 URL">
              <div className="input-with-icon"><Image size={16} /><input type="url" inputMode="url" placeholder="https://example.com/avatar.png" value={draft.avatar_url} onChange={(event) => setDraft({ ...draft, avatar_url: event.target.value })} /></div>
            </Field>
          </div>
          <div className="account-panel-actions"><Button type="submit" disabled={saving || !changed || !draft.username.trim()}>{saving ? <Spinner label="正在保存" /> : <><Save size={16} />保存资料</>}</Button></div>
        </form>
      ) : null}
    </Surface>
  );
}

function PasswordPanel({ notify }: { notify: Notify }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError("新密码至少需要 8 个字符");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    setWorking(true);
    try {
      await api.post("/api/user/password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      notify("密码已更新");
    } catch (reason) {
      const message = messageOf(reason, "密码更新失败");
      setError(message);
      notify(message, "error");
    } finally {
      setWorking(false);
    }
  };

  return (
    <Surface className="account-panel account-password-panel">
      <PanelHeading icon={<KeyRound size={19} />} title="修改密码" description="使用当前密码确认身份" />
      <form className="account-form" onSubmit={submit}>
        {error ? <ErrorState message={error} /> : null}
        <Field label="当前密码"><PasswordInput label="当前密码" autoComplete="current-password" value={currentPassword} show={showPasswords} onChange={setCurrentPassword} /></Field>
        <Field label="新密码" hint="至少 8 个字符"><PasswordInput label="新密码" autoComplete="new-password" value={newPassword} show={showPasswords} minLength={8} onChange={setNewPassword} /></Field>
        <Field label="确认新密码"><PasswordInput label="确认新密码" autoComplete="new-password" value={confirmPassword} show={showPasswords} minLength={8} onChange={setConfirmPassword} /></Field>
        <div className="account-password-footer">
          <IconButton type="button" label={showPasswords ? "隐藏密码" : "显示密码"} onClick={() => setShowPasswords((value) => !value)}>{showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}</IconButton>
          <Button type="submit" disabled={working || !currentPassword || !newPassword || !confirmPassword}>{working ? <Spinner label="正在更新" /> : <><ShieldCheck size={16} />更新密码</>}</Button>
        </div>
      </form>
    </Surface>
  );
}

function PasswordInput({ label, value, onChange, show, autoComplete, minLength }: { label: string; value: string; onChange: (value: string) => void; show: boolean; autoComplete: string; minLength?: number }) {
  return <input aria-label={label} required type={show ? "text" : "password"} autoComplete={autoComplete} minLength={minLength} value={value} onChange={(event) => onChange(event.target.value)} />;
}

function SubscriptionCredentialsPanel({ notify, refreshKey }: { notify: Notify; refreshKey: number }) {
  const [bundle, setBundle] = useState<TokenBundle | null>(null);
  const [shortCode, setShortCode] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get<TokenBundle>("/api/user/token");
      if (!response?.token) throw new Error("订阅凭据响应无效");
      setBundle(response);
      setShortCode(response.custom_user_short_code ?? "");
    } catch (reason) {
      setError(messageOf(reason, "订阅凭据加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const updateShortCode = async (event: FormEvent) => {
    event.preventDefault();
    const code = shortCode.trim();
    if (code && !/^[A-Za-z0-9_-]{2,16}$/.test(code)) {
      setError("短码只能含字母、数字、下划线或横杠，长度 2-16 位");
      return;
    }
    setWorking("short-code");
    setError("");
    try {
      const response = await api.put<TokenBundle>("/api/user/token", { custom_user_short_code: code });
      if (!response?.token) throw new Error("短码更新响应无效");
      setBundle(response);
      setShortCode(response.custom_user_short_code ?? "");
      notify(code ? "订阅短码已更新" : "已恢复系统订阅短码");
    } catch (reason) {
      const message = messageOf(reason, "订阅短码更新失败");
      setError(message);
      notify(message, "error");
    } finally {
      setWorking("");
    }
  };

  const resetToken = async () => {
    setWorking("reset-token");
    setError("");
    try {
      const response = await api.post<TokenBundle>("/api/user/token");
      if (!response?.token) throw new Error("订阅 Token 重置响应无效");
      setBundle(response);
      setShortCode(response.custom_user_short_code ?? "");
      setShowToken(true);
      setConfirmReset(false);
      notify("订阅 Token 已重置");
    } catch (reason) {
      const message = messageOf(reason, "订阅 Token 重置失败");
      setError(message);
      notify(message, "error");
    } finally {
      setWorking("");
    }
  };

  return (
    <Surface className="account-panel account-subscription-panel">
      <PanelHeading icon={<Link2 size={19} />} title="订阅凭据" description="管理订阅 Token 与个人短码" />
      {loading ? <div className="account-loading"><Spinner label="正在加载订阅凭据" /></div> : null}
      {!loading && error && !bundle ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {!loading && bundle ? (
        <div className="account-form">
          {error ? <ErrorState message={error} /> : null}
          <Field label="订阅 Token">
            <div className="account-copy-field">
              <input aria-label="订阅 Token" readOnly type={showToken ? "text" : "password"} value={bundle.token} />
              <IconButton type="button" label={showToken ? "隐藏订阅 Token" : "显示订阅 Token"} onClick={() => setShowToken((value) => !value)}>{showToken ? <EyeOff size={16} /> : <Eye size={16} />}</IconButton>
              <IconButton type="button" label="复制订阅 Token" onClick={() => void copyText(bundle.token, notify, "订阅 Token")}><Copy size={16} /></IconButton>
            </div>
          </Field>
          <form className="account-short-code-form" onSubmit={updateShortCode}>
            <Field label="自定义短码" hint="留空后恢复系统短码；支持 2-16 位字母、数字、下划线或横杠">
              <input aria-label="自定义短码" pattern="[A-Za-z0-9_-]{2,16}" value={shortCode} onChange={(event) => setShortCode(event.target.value)} placeholder={bundle.user_short_code || "系统自动生成"} />
            </Field>
            <Button type="submit" variant="secondary" disabled={working !== "" || shortCode.trim() === (bundle.custom_user_short_code ?? "")}>{working === "short-code" ? <Spinner label="正在保存" /> : <><Save size={16} />保存短码</>}</Button>
          </form>
          <div className="account-effective-code">
            <span><small>当前生效短码</small><code>{bundle.user_short_code || "尚未生成"}</code></span>
            <IconButton type="button" label="复制当前短码" disabled={!bundle.user_short_code} onClick={() => void copyText(bundle.user_short_code ?? "", notify, "订阅短码")}><Copy size={16} /></IconButton>
          </div>
          <div className="account-panel-actions"><Button type="button" variant="danger" onClick={() => setConfirmReset(true)} disabled={working !== ""}><RotateCcw size={16} />重置订阅 Token</Button></div>
        </div>
      ) : null}
      {confirmReset ? <ConfirmDialog title="重置订阅 Token" description="旧 Token 订阅地址会立即失效；使用个人短码的地址不受影响。" confirmLabel="确认重置" working={working === "reset-token"} onCancel={() => setConfirmReset(false)} onConfirm={() => void resetToken()} /> : null}
    </Surface>
  );
}

function PersonalAPITokensPanel({ notify, refreshKey }: { notify: Notify; refreshKey: number }) {
  const [tokens, setTokens] = useState<PersonalAPIToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [newSecret, setNewSecret] = useState("");
  const [secretName, setSecretName] = useState("");
  const [secretAcknowledged, setSecretAcknowledged] = useState(false);
  const [secretCopyFailed, setSecretCopyFailed] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<PersonalAPIToken | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get<APITokenListResponse>("/api/user/api-tokens");
      if (response?.success === false) throw new Error(response.error || response.message || "API Token 列表加载失败");
      if (!Array.isArray(response?.tokens)) throw new Error("API Token 列表响应无效");
      setTokens(response.tokens);
    } catch (reason) {
      setError(messageOf(reason, "API Token 列表加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const tokenName = name.trim();
    if (!tokenName) return;
    setWorking("create");
    setError("");
    try {
      const response = await api.post<APITokenCreateResponse>("/api/user/api-tokens", { name: tokenName });
      if (response?.success === false) throw new Error(response.error || response.message || "API Token 创建失败");
      if (!response?.token) throw new Error("服务端未返回 API Token 明文");
      setNewSecret(response.token);
      setSecretName(response.name || tokenName);
      setSecretAcknowledged(false);
      setSecretCopyFailed(false);
      setName("");
      notify("个人 API Token 已创建");
      await load();
    } catch (reason) {
      const message = messageOf(reason, "API Token 创建失败");
      setError(message);
      notify(message, "error");
    } finally {
      setWorking("");
    }
  };

  const copySecret = async () => {
    const copied = await copyText(newSecret, notify, "API Token");
    setSecretCopyFailed(!copied);
  };

  const closeSecret = () => {
    if (!secretAcknowledged) return;
    setNewSecret("");
    setSecretName("");
    setSecretAcknowledged(false);
    setSecretCopyFailed(false);
  };

  const revoke = async () => {
    if (!pendingRevoke) return;
    const token = pendingRevoke;
    setWorking(`revoke-${token.id}`);
    setError("");
    try {
      const response = await api.delete<{ success?: boolean; error?: string; message?: string }>(`/api/user/api-tokens/${token.id}`);
      if (response?.success === false) throw new Error(response.error || response.message || "API Token 吊销失败");
      setTokens((items) => items.filter((item) => item.id !== token.id));
      setPendingRevoke(null);
      notify("个人 API Token 已吊销");
    } catch (reason) {
      const message = messageOf(reason, "API Token 吊销失败");
      setError(message);
      notify(message, "error");
    } finally {
      setWorking("");
    }
  };

  return (
    <Surface className="account-panel account-api-panel">
      <PanelHeading icon={<Code2 size={19} />} title="个人 API Token" description="供 MCP 与个人自动化调用" trailing={<Badge tone="info">{tokens.length} 枚</Badge>} />
      <form className="account-token-create" onSubmit={create}>
        <Field label="Token 名称"><input required maxLength={64} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：部署脚本" /></Field>
        <Button type="submit" disabled={working !== "" || !name.trim()}>{working === "create" ? <Spinner label="正在创建" /> : <><Plus size={16} />创建 Token</>}</Button>
      </form>
      {error ? <ErrorState message={error} onRetry={!tokens.length ? () => void load() : undefined} /> : null}
      {loading ? <div className="account-loading"><Spinner label="正在加载 API Token" /></div> : null}
      {!loading && !error && tokens.length === 0 ? <EmptyState icon={<KeyRound size={22} />} title="还没有个人 API Token" description="创建后可用于受支持的自动化客户端" /> : null}
      {!loading && tokens.length ? (
        <div className="account-token-list">
          {tokens.map((token) => (
            <article key={token.id}>
              <span className="account-token-icon"><KeyRound size={17} /></span>
              <span className="account-token-main"><strong>{token.name}</strong><small><Clock3 size={12} />创建于 {formatDate(token.created_at)}</small></span>
              <span className="account-token-used"><small>最近使用</small><strong>{formatDate(token.last_used_at)}</strong></span>
              <Badge tone={token.last_used_at ? "good" : "neutral"}>{token.last_used_at ? "已使用" : "未使用"}</Badge>
              <IconButton type="button" label={`吊销 ${token.name}`} disabled={working !== ""} onClick={() => setPendingRevoke(token)}><Trash2 size={16} /></IconButton>
            </article>
          ))}
        </div>
      ) : null}
      {pendingRevoke ? <ConfirmDialog title="吊销个人 API Token" description={`“${pendingRevoke.name}”吊销后无法恢复，使用它的客户端会立即失去访问权限。`} confirmLabel="确认吊销" working={working === `revoke-${pendingRevoke.id}`} onCancel={() => setPendingRevoke(null)} onConfirm={() => void revoke()} /> : null}
      {newSecret ? (
        <Dialog title="保存个人 API Token" description="明文只显示这一次" onClose={closeSecret} dismissible={false} wide>
          <div className="form-stack">
            <div className="account-one-time-warning"><KeyRound size={20} /><span><strong>{secretName}</strong><p>关闭后无法再次查看，请立即保存到安全位置。</p></span></div>
            <div className="account-secret-box"><code>{newSecret}</code><IconButton type="button" label="复制新 API Token" onClick={() => void copySecret()}><Copy size={17} /></IconButton></div>
            {secretCopyFailed ? <ErrorState message="无法访问剪贴板，请手动选择并保存上方 Token。" /> : null}
            <label className="checkbox-row account-secret-ack"><input type="checkbox" checked={secretAcknowledged} onChange={(event) => setSecretAcknowledged(event.target.checked)} />我已将这个 Token 保存在安全位置</label>
            <div className="dialog-actions"><Button type="button" onClick={closeSecret} disabled={!secretAcknowledged}><Check size={16} />完成</Button></div>
          </div>
        </Dialog>
      ) : null}
    </Surface>
  );
}
