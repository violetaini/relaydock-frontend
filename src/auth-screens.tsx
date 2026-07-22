import { useEffect, useRef, useState, type FormEvent } from "react";
import { Activity, ArrowDown, ArrowRight, ArrowUp, Check, KeyRound, LockKeyhole, LogIn, Network, Server, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { api, ApiError, setToken } from "./api";
import { BRAND_NAME, BrandMark } from "./brand";
import type { Session } from "./types";
import { Badge, Button, ErrorState, Field, IconButton, Spinner, Surface, formatBytes } from "./ui";

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void; theme: "light" | "dark" }) => string;
      remove: (id: string) => void;
    };
  }
}

function AuthVisual({ mode }: { mode: "setup" | "login" }) {
  return (
    <aside className="auth-visual" aria-label={`${BRAND_NAME} 控制端`}>
      <div className="brand brand-auth"><BrandMark size={27} /><span>{BRAND_NAME}</span></div>
      <div className="topology" aria-hidden="true">
        <div className="topology-line line-a" />
        <div className="topology-line line-b" />
        <span className="topology-node node-master"><Network size={20} /></span>
        <span className="topology-node node-one"><Server size={18} /></span>
        <span className="topology-node node-two"><Server size={18} /></span>
        <span className="topology-pulse pulse-one" />
        <span className="topology-pulse pulse-two" />
      </div>
      <div className="auth-visual-copy">
        <span className="eyebrow">{mode === "setup" ? "首次启动" : "Control plane"}</span>
        <h1>{mode === "setup" ? "建立控制端" : "统一掌握每条链路"}</h1>
        <div className="auth-facts">
          <span><Check size={15} />状态与流量实时汇总</span>
          <span><Check size={15} />节点配置集中管理</span>
          <span><Check size={15} />凭据仅在必要时显示</span>
        </div>
      </div>
    </aside>
  );
}

export function SetupScreen({ onComplete }: { onComplete: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    username: "admin",
    password: "",
    confirm: "",
    nickname: "管理员",
    email: "",
    domain: location.origin,
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (form.password.length < 10) {
      setError("密码至少需要 10 个字符");
      return;
    }
    if (form.password !== form.confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/api/setup/init", {
        username: form.username.trim(),
        password: form.password,
        nickname: form.nickname.trim(),
        email: form.email.trim(),
        domain: "",
      });
      onComplete();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "初始化失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-layout">
      <AuthVisual mode="setup" />
      <section className="auth-panel">
        <div className="auth-form-wrap">
          <div className="mobile-brand brand"><BrandMark size={24} /><span>{BRAND_NAME}</span></div>
          <span className="auth-step">初始化</span>
          <h2>创建首位管理员</h2>
          <p className="auth-subtitle">完成后即可接入服务器和节点。</p>
          {error ? <ErrorState message={error} /> : null}
          <form onSubmit={submit} className="form-stack">
            <div className="form-grid">
              <Field label="管理员账号"><input required autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
              <Field label="显示名称"><input required value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} /></Field>
            </div>
            <Field label="邮箱"><input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="admin@example.com" /></Field>
            <Field label="登录密码"><input required type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <Field label="确认密码"><input required type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} /></Field>
            <Button type="submit" disabled={submitting}>{submitting ? <Spinner label="正在创建" /> : <><ShieldCheck size={17} />创建管理员<ArrowRight size={17} /></>}</Button>
          </form>
        </div>
      </section>
    </main>
  );
}

export interface PublicProbeServer {
  name?: string;
  upload_speed: number;
  download_speed: number;
  traffic_used: number;
  traffic_limit: number;
  online: boolean;
}

export interface PublicProbeState {
  enabled: boolean;
  title?: string;
  show_name?: boolean;
  servers?: PublicProbeServer[];
}

export function PublicProbeScreen({ probe, onLogin }: { probe: PublicProbeState; onLogin: () => void }) {
  const servers = probe.servers ?? [];
  const online = servers.filter((server) => server.online).length;
  return (
    <main className="public-probe">
      <header className="public-probe-header">
        <div className="brand"><span className="brand-mark"><Activity size={20} /></span><h1>{probe.title?.trim() || "Service Status"}</h1></div>
        <IconButton label="进入管理登录" onClick={onLogin}><LogIn size={18} /></IconButton>
      </header>
      <section className="public-probe-content">
        <div className="public-probe-summary">
          <span><strong>{online}</strong><small>在线</small></span>
          <span><strong>{servers.length - online}</strong><small>离线</small></span>
          <span><strong>{servers.length}</strong><small>监测服务</small></span>
        </div>
        {servers.length ? <div className="public-probe-grid">{servers.map((server, index) => {
          const used = Math.max(0, Number(server.traffic_used) || 0);
          const limit = Math.max(0, Number(server.traffic_limit) || 0);
          const percentage = limit > 0 ? Math.min(100, used / limit * 100) : 0;
          return <Surface className="public-probe-item" key={`${server.name || "service"}-${index}`}>
            <div className="public-probe-item-heading"><span className={server.online ? "is-online" : ""}>{server.online ? <Wifi size={18} /> : <WifiOff size={18} />}</span><strong>{probe.show_name && server.name ? server.name : `Service ${index + 1}`}</strong><Badge tone={server.online ? "good" : "bad"}>{server.online ? "Online" : "Offline"}</Badge></div>
            <div className="public-probe-speeds"><span><ArrowUp size={15} /><small>Upload</small><strong>{formatBytes(server.upload_speed, true)}</strong></span><span><ArrowDown size={15} /><small>Download</small><strong>{formatBytes(server.download_speed, true)}</strong></span></div>
            <div className="public-probe-traffic"><span><small>Traffic</small><strong>{formatBytes(used)}{limit > 0 ? ` / ${formatBytes(limit)}` : ""}</strong></span>{limit > 0 ? <div aria-label={`流量使用率 ${percentage.toFixed(1)}%`}><i style={{ width: `${percentage}%` }} /></div> : null}</div>
          </Surface>;
        })}</div> : <Surface className="public-probe-empty"><Server size={24} /><strong>No services configured</strong></Surface>}
      </section>
    </main>
  );
}

function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let widget = "";
    let cancelled = false;
    const render = () => {
      if (cancelled || !ref.current || !window.turnstile) return;
      widget = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        callback: onToken,
        "expired-callback": () => onToken(""),
        theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
      });
    };
    if (window.turnstile) {
      render();
    } else {
      const existing = document.querySelector<HTMLScriptElement>("script[data-arcway-turnstile]");
      const script = existing ?? document.createElement("script");
      if (!existing) {
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.dataset.arcwayTurnstile = "true";
        document.head.appendChild(script);
      }
      script.addEventListener("load", render, { once: true });
    }
    return () => {
      cancelled = true;
      if (widget) window.turnstile?.remove(widget);
    };
  }, [siteKey, onToken]);
  return <div className="turnstile-slot" ref={ref} />;
}

export function LoginScreen({ onLogin, wallpaper = "" }: { onLogin: (session: Session) => void; wallpaper?: string }) {
  const [form, setForm] = useState({ username: "", password: "", remember_me: true });
  const [pending2FA, setPending2FA] = useState("");
  const [code, setCode] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [captcha, setCaptcha] = useState<{ enabled: boolean; site_key: string }>({ enabled: false, site_key: "" });
  const [captchaToken, setCaptchaToken] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<{ enabled: boolean; site_key: string }>("/api/captcha/config").then(setCaptcha).catch(() => undefined);
  }, []);

  const finish = (session: Session) => {
    setToken(session.token);
    onLogin(session);
  };

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (captcha.enabled && !captchaToken) {
      setError("请完成人机验证");
      return;
    }
    setSubmitting(true);
    try {
      const response = await api.post<Session & { requires_2fa?: boolean; two_factor_token?: string }>("/api/login", {
        ...form,
        turnstile_token: captchaToken,
      });
      if (response.requires_2fa && response.two_factor_token) {
        setPending2FA(response.two_factor_token);
      } else {
        finish(response);
      }
    } catch (reason) {
      setError(reason instanceof ApiError && reason.status === 401 ? "账号或密码错误" : reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  const verify2FA = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const path = recoveryMode ? "/api/login/recovery" : "/api/login/2fa";
      const body = recoveryMode
        ? { two_factor_token: pending2FA, recovery_code: code }
        : { two_factor_token: pending2FA, code };
      finish(await api.post<Session>(path, body));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "验证失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className={`auth-layout ${wallpaper ? "has-wallpaper" : ""}`} style={wallpaper ? { backgroundImage: `url(${JSON.stringify(wallpaper).slice(1, -1)})` } : undefined}>
      <AuthVisual mode="login" />
      <section className="auth-panel">
        <div className="auth-form-wrap">
          <div className="mobile-brand brand"><BrandMark size={24} /><span>{BRAND_NAME}</span></div>
          <span className="auth-step">安全登录</span>
          <h2>{pending2FA ? "验证第二因素" : "进入控制台"}</h2>
          <p className="auth-subtitle">{pending2FA ? "输入验证器代码或恢复码。" : "使用管理端账号继续。"}</p>
          {error ? <ErrorState message={error} /> : null}
          {pending2FA ? (
            <form onSubmit={verify2FA} className="form-stack">
              <Field label={recoveryMode ? "恢复码" : "动态验证码"}>
                <div className="input-with-icon"><KeyRound size={17} /><input required autoFocus inputMode={recoveryMode ? "text" : "numeric"} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></div>
              </Field>
              <Button type="submit" disabled={submitting}>{submitting ? <Spinner label="正在验证" /> : <>验证并登录<ArrowRight size={17} /></>}</Button>
              <button type="button" className="text-button" onClick={() => { setRecoveryMode(!recoveryMode); setCode(""); setError(""); }}>{recoveryMode ? "使用动态验证码" : "使用恢复码"}</button>
            </form>
          ) : (
            <form onSubmit={login} className="form-stack">
              <Field label="账号"><div className="input-with-icon"><KeyRound size={17} /><input required autoFocus autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div></Field>
              <Field label="密码"><div className="input-with-icon"><LockKeyhole size={17} /><input required type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div></Field>
              <label className="checkbox-row"><input type="checkbox" checked={form.remember_me} onChange={(e) => setForm({ ...form, remember_me: e.target.checked })} /><span>保持登录</span></label>
              {captcha.enabled && captcha.site_key ? <Turnstile siteKey={captcha.site_key} onToken={setCaptchaToken} /> : null}
              <Button type="submit" disabled={submitting}>{submitting ? <Spinner label="正在登录" /> : <>登录<ArrowRight size={17} /></>}</Button>
            </form>
          )}
          <div className="auth-security"><ShieldCheck size={16} /><span>会话由控制端本地签发</span></div>
        </div>
      </section>
    </main>
  );
}
