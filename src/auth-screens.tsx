import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Activity, ArrowDown, ArrowRight, ArrowUp, Check, Cpu, Gauge, Grid2X2, HardDrive, KeyRound, List, LockKeyhole, LogIn, MemoryStick, Network, Server, ShieldCheck } from "lucide-react";
import { api, ApiError, setToken } from "./api";
import { BRAND_NAME, BrandMark } from "./brand";
import type { Session } from "./types";
import { Button, ErrorState, Field, Spinner, formatBytes } from "./ui";

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
  upload_speed?: number;
  download_speed?: number;
  traffic_used?: number;
  traffic_limit?: number;
  cpu_pct?: number;
  loadavg?: string;
  mem_used?: number;
  mem_total?: number;
  disk_used?: number;
  disk_total?: number;
  online?: boolean;
}

export interface PublicProbeState {
  enabled: boolean;
  title?: string;
  logo?: string;
  block_login?: boolean;
  show_name?: boolean;
  metric_cpu?: boolean;
  metric_mem?: boolean;
  metric_disk?: boolean;
  metric_traffic?: boolean;
  metric_speed?: boolean;
  // The public endpoint uses these aliases so it never needs to expose the
  // administrative metric_* configuration in a public response.
  show_cpu?: boolean;
  show_memory?: boolean;
  show_disk?: boolean;
  show_traffic?: boolean;
  show_speed?: boolean;
  servers?: PublicProbeServer[];
}

const publicProbeDefaults: PublicProbeState = {
  enabled: false,
  servers: [],
};

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function boundedText(value: unknown, maxLength = 96): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text || text.length > maxLength || /[\r\n\u0000]/.test(text)) return undefined;
  return text;
}

function publicProbeServer(value: unknown): PublicProbeServer | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  return {
    name: typeof source.name === "string" ? source.name : undefined,
    online: booleanValue(source.online),
    upload_speed: finiteNumber(source.upload_speed),
    download_speed: finiteNumber(source.download_speed),
    traffic_used: finiteNumber(source.traffic_used),
    traffic_limit: finiteNumber(source.traffic_limit),
    cpu_pct: finiteNumber(source.cpu_pct),
    loadavg: boundedText(source.loadavg),
    mem_used: finiteNumber(source.mem_used),
    mem_total: finiteNumber(source.mem_total),
    disk_used: finiteNumber(source.disk_used),
    disk_total: finiteNumber(source.disk_total),
  };
}

/**
 * Keep the browser-side representation deliberately narrow. Public frames are
 * untrusted and this drops fields that are not part of the probe contract.
 */
export function normalizePublicProbeState(value: unknown): PublicProbeState | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (typeof source.enabled !== "boolean") return null;
  const servers = Array.isArray(source.servers)
    ? source.servers.map(publicProbeServer).filter((server): server is PublicProbeServer => server !== null)
    : [];
  return {
    enabled: source.enabled,
    title: typeof source.title === "string" ? source.title : undefined,
    logo: typeof source.logo === "string" ? source.logo : undefined,
    block_login: booleanValue(source.block_login),
    show_name: booleanValue(source.show_name),
    metric_cpu: booleanValue(source.metric_cpu),
    metric_mem: booleanValue(source.metric_mem),
    metric_disk: booleanValue(source.metric_disk),
    metric_traffic: booleanValue(source.metric_traffic),
    metric_speed: booleanValue(source.metric_speed),
    show_cpu: booleanValue(source.show_cpu),
    show_memory: booleanValue(source.show_memory),
    show_disk: booleanValue(source.show_disk),
    show_traffic: booleanValue(source.show_traffic),
    show_speed: booleanValue(source.show_speed),
    servers,
  };
}

export function emptyPublicProbeState(): PublicProbeState {
  return { ...publicProbeDefaults, servers: [] };
}

function isProbeMetricEnabled(probe: PublicProbeState, publicKey: "show_cpu" | "show_memory" | "show_disk" | "show_traffic" | "show_speed", adminKey: "metric_cpu" | "metric_mem" | "metric_disk" | "metric_traffic" | "metric_speed", fallback: boolean) {
  return probe[publicKey] ?? probe[adminKey] ?? fallback;
}

function percent(value: number | undefined, total?: number): number | undefined {
  if (value === undefined) return undefined;
  const output = total && total > 0 ? value / total * 100 : value;
  return Number.isFinite(output) ? Math.min(100, Math.max(0, output)) : undefined;
}

function formatPercent(value: number | undefined) {
  if (value === undefined) return "--";
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}%`;
}

function loadAverageDetail(value: string | undefined) {
  const values = value?.split(/\s+/).slice(0, 3).join(" / ");
  return values ? `负载 ${values}` : undefined;
}

function ProbeMetric({ icon, label, value, progress, detail }: { icon: ReactNode; label: string; value: string; progress?: number; detail?: string }) {
  return <div className="public-probe-metric">
    <div className="public-probe-metric-heading"><span>{icon}</span><small>{label}</small><strong>{value}</strong></div>
    {progress !== undefined ? <span className="public-probe-meter" aria-label={`${label} ${value}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></span> : null}
    {detail ? <small className="public-probe-metric-detail">{detail}</small> : null}
  </div>;
}

export function PublicProbeScreen({ probe, onLogin }: { probe: PublicProbeState; onLogin: () => void }) {
  const servers = probe.servers ?? [];
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const showCPU = isProbeMetricEnabled(probe, "show_cpu", "metric_cpu", false);
  const showMemory = isProbeMetricEnabled(probe, "show_memory", "metric_mem", false);
  const showDisk = isProbeMetricEnabled(probe, "show_disk", "metric_disk", false);
  const showTraffic = isProbeMetricEnabled(probe, "show_traffic", "metric_traffic", true);
  const showSpeed = isProbeMetricEnabled(probe, "show_speed", "metric_speed", true);
  const title = probe.title?.trim() || "服务器状态";
  const logo = probe.logo?.trim();
  return (
    <main className="public-probe">
      <header className="public-probe-header">
        <div className="public-probe-header-inner">
          <div className="public-probe-brand">
            {logo ? <img src={logo} alt="" referrerPolicy="no-referrer" /> : <Activity size={18} aria-hidden="true" />}
            <h1>{title}</h1>
          </div>
          <div className="public-probe-controls" role="group" aria-label="页面视图">
            <button type="button" className={`public-probe-view-button ${layout === "grid" ? "is-active" : ""}`} aria-label="网格视图" title="网格视图" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}><Grid2X2 size={16} /></button>
            <button type="button" className={`public-probe-view-button ${layout === "list" ? "is-active" : ""}`} aria-label="列表视图" title="列表视图" aria-pressed={layout === "list"} onClick={() => setLayout("list")}><List size={17} /></button>
            {!probe.block_login ? <button type="button" className="public-probe-login" onClick={onLogin}><LogIn size={16} />登录</button> : null}
          </div>
        </div>
      </header>
      <section className="public-probe-content">
        {servers.length ? <div className={`public-probe-grid ${layout === "list" ? "is-list" : ""}`}>{servers.map((server, index) => {
          const used = Math.max(0, Number(server.traffic_used) || 0);
          const limit = Math.max(0, Number(server.traffic_limit) || 0);
          const trafficPercent = limit > 0 ? percent(used, limit) : undefined;
          // A state transition can race a final public frame in transit. Do
          // not turn that frame into a healthy-looking offline card; the API
          // also omits these values once an Agent is offline.
          const cpuPercent = server.online ? percent(server.cpu_pct) : undefined;
          const memoryPercent = server.online ? percent(server.mem_used, server.mem_total) : undefined;
          const diskPercent = server.online ? percent(server.disk_used, server.disk_total) : undefined;
          const visibleMetrics = [
            showCPU && cpuPercent !== undefined,
            showMemory && memoryPercent !== undefined,
            showDisk && diskPercent !== undefined,
            showTraffic,
          ].filter(Boolean).length;
          return <article className={`public-probe-item ${server.online ? "is-online" : "is-offline"}`} key={`${server.name || "service"}-${index}`} style={{ "--public-probe-order": index } as CSSProperties}>
            <header className="public-probe-item-heading">
              <span className="public-probe-status"><i /><strong>{probe.show_name && server.name ? server.name : `#${index + 1}`}</strong></span>
              <small>{server.online ? "在线" : "离线"}</small>
            </header>
            <div className={`public-probe-metrics public-probe-metrics-${Math.min(4, Math.max(1, visibleMetrics))}`}>
              {showCPU && cpuPercent !== undefined ? <ProbeMetric icon={<Cpu size={14} />} label="CPU" value={formatPercent(cpuPercent)} progress={cpuPercent} detail={loadAverageDetail(server.loadavg)} /> : null}
              {showMemory && memoryPercent !== undefined ? <ProbeMetric icon={<MemoryStick size={14} />} label="内存" value={formatPercent(memoryPercent)} progress={memoryPercent} detail={server.mem_used !== undefined && server.mem_total !== undefined ? `${formatBytes(server.mem_used)} / ${formatBytes(server.mem_total)}` : undefined} /> : null}
              {showDisk && diskPercent !== undefined ? <ProbeMetric icon={<HardDrive size={14} />} label="磁盘" value={formatPercent(diskPercent)} progress={diskPercent} detail={server.disk_used !== undefined && server.disk_total !== undefined ? `${formatBytes(server.disk_used)} / ${formatBytes(server.disk_total)}` : undefined} /> : null}
              {showTraffic ? <ProbeMetric icon={<Gauge size={14} />} label="流量" value={formatBytes(used)} progress={trafficPercent} detail={limit > 0 ? `配额 ${formatBytes(limit)}` : undefined} /> : null}
            </div>
            {showSpeed ? <footer className="public-probe-item-footer">
              <div className="public-probe-speeds"><span className="is-download"><ArrowDown size={15} /><strong>{formatBytes(server.download_speed, true)}</strong></span><span className="is-upload"><ArrowUp size={15} /><strong>{formatBytes(server.upload_speed, true)}</strong></span></div>
            </footer> : null}
          </article>;
        })}</div> : <div className="public-probe-empty"><Server size={24} /><strong>暂无可公开的服务器状态</strong></div>}
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
