import { StrictMode, useCallback, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { api, ApiError, getToken, setToken } from "./api";
import { LoginScreen, PublicProbeScreen, SetupScreen, emptyPublicProbeState, normalizePublicProbeState, type PublicProbeState } from "./auth-screens";
import { BrandMark, BrandingProvider, DEFAULT_BRANDING, applyBrandingDocument, normalizeBranding, type Branding } from "./brand";
import { ConsoleApp } from "./console";
import type { Profile, Session } from "./types";
import { Button, ErrorState, Spinner } from "./ui";
import "./styles.css";
import "./modern-theme.css";

type BootState = "loading" | "setup" | "login" | "ready" | "error";

// Keep the unauthenticated status page as responsive as Komari's default
// live stream without changing the dashboard or Agent reporting cadence.
const publicProbeRefreshIntervalMs = 1_000;
const preloadRecoveryKey = "arcway-preload-recovery-at";
const preloadRecoveryWindowMs = 60_000;
const PROBE_CACHE_KEY = "arcway-public-probe-cache";

function loadCachedProbe(): PublicProbeState {
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(PROBE_CACHE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const normalized = normalizePublicProbeState(parsed);
        if (normalized && normalized.enabled) {
          return normalized;
        }
      }
    } catch {
      // Ignore corrupted cache.
    }
  }
  return {
    ...emptyPublicProbeState(),
    enabled: true,
    title: "ちちゃんの探針",
    show_name: true,
    show_cpu: true,
    show_memory: true,
    show_disk: true,
    show_traffic: true,
    show_speed: true,
  };
}

function saveCachedProbe(probe: PublicProbeState) {
  try {
    if (typeof localStorage !== "undefined" && probe && probe.enabled) {
      localStorage.setItem(PROBE_CACHE_KEY, JSON.stringify(probe));
    }
  } catch {
    // Ignore quota or disabled storage.
  }
}

export function recoverFromPreloadError(event: Event, reload: () => void = () => window.location.reload(), now = Date.now()): boolean {
  let previous = 0;
  try {
    previous = Number(sessionStorage.getItem(preloadRecoveryKey)) || 0;
  } catch {
    // Let the import rejection reach the page error boundary when a retry marker cannot persist.
    return false;
  }
  if (now - previous < preloadRecoveryWindowMs) return false;
  try {
    sessionStorage.setItem(preloadRecoveryKey, String(now));
  } catch {
    return false;
  }
  event.preventDefault();
  reload();
  return true;
}

if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", recoverFromPreloadError);
}

function publicProbeFrame(value: unknown): PublicProbeState | null {
  const direct = normalizePublicProbeState(value);
  if (direct) return direct;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return normalizePublicProbeState(record.data)
    ?? normalizePublicProbeState(record.probe)
    ?? normalizePublicProbeState(record.payload);
}

function publicBrandingFrame(value: unknown): Branding {
  if (!value || typeof value !== "object") return DEFAULT_BRANDING;
  const record = value as Record<string, unknown>;
  const nested = [record.branding, record.data, value].find((candidate) => candidate && typeof candidate === "object");
  return normalizeBranding(nested as Partial<Branding> | undefined);
}

function mapOAuthError(code: string): string {
  switch (code) {
    case "access_denied":
      return "第三方授权已取消";
    case "invalid_state":
    case "csrf_validation_failed":
      return "登录校验超时或防重放校验失败，请重试";
    case "state_expired":
      return "登录请求已过期，请重新登录";
    case "provider_disabled":
      return "该第三方登录通道当前未开启";
    case "exchange_failed":
    case "profile_not_found":
      return "与第三方身份提供商通信失败，请稍后重试";
    case "registration_disabled":
      return "系统暂未开启第三方账号快捷注册，请联系管理员";
    case "account_disabled":
      return "该用户账号已被禁用，请联系管理员";
    case "already_bound_to_other_user":
      return "该第三方账号已绑定至其他用户";
    case "login_required_to_bind":
      return "绑定第三方账号前请先登录";
    default:
      return code ? `第三方登录失败: ${code}` : "第三方登录失败";
  }
}

export function App() {
  const [loginRequested, setLoginRequested] = useState(() => {
    if (typeof location === "undefined") return false;
    return location.hash.replace(/^#\/?/, "") === "login";
  });
  const [probePreview, setProbePreview] = useState(() => {
    if (typeof location === "undefined") return false;
    return new URLSearchParams(location.search).get("probe") === "1";
  });
  const [state, setState] = useState<BootState>(() => {
    if (typeof window !== "undefined" && !getToken() && location.hash.replace(/^#\/?/, "") !== "login") {
      return "login";
    }
    return "loading";
  });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [wallpaper, setWallpaper] = useState("");
  const [logoutNotice, setLogoutNotice] = useState("");
  const [probe, setProbe] = useState<PublicProbeState>(loadCachedProbe);
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);

  const bootstrap = useCallback(async () => {
    if (typeof location !== "undefined" && location.search) {
      const searchParams = new URLSearchParams(location.search);
      const oauthToken = searchParams.get("oauth_token");
      const oauthError = searchParams.get("oauth_error");
      const oauthSuccess = searchParams.get("oauth_success");

      if (oauthToken) {
        setToken(oauthToken, true);
        searchParams.delete("oauth_token");
        searchParams.delete("oauth_username");
        const remaining = searchParams.toString();
        const cleanUrl = location.pathname + (remaining ? `?${remaining}` : "") + location.hash;
        history.replaceState(null, "", cleanUrl);
      } else if (oauthError) {
        searchParams.delete("oauth_error");
        const remaining = searchParams.toString();
        const cleanUrl = location.pathname + (remaining ? `?${remaining}` : "") + (location.hash || "#/login");
        history.replaceState(null, "", cleanUrl);
        setLogoutNotice(mapOAuthError(oauthError));
        location.hash = "/login";
        setLoginRequested(true);
      } else if (oauthSuccess === "bound") {
        searchParams.delete("oauth_success");
        searchParams.delete("provider");
        const remaining = searchParams.toString();
        const cleanUrl = location.pathname + (remaining ? `?${remaining}` : "") + (location.hash || "#/account");
        history.replaceState(null, "", cleanUrl);
      }
    }

    if (getToken() || location.hash.replace(/^#\/?/, "") === "login") {
      setState("loading");
    }
    setError("");
    try {
      const setup = await api.get<{ needs_setup: boolean }>("/api/setup/status");
      if (setup.needs_setup) {
        setState("setup");
        return;
      }
      if (!getToken()) {
        setState("login");
        return;
      }
      try {
        const current = await api.get<Profile>("/api/user/profile");
        setProfile(current);
        setState("ready");
      } catch (reason) {
        if (reason instanceof ApiError && (reason.status === 401 || reason.status === 403)) {
          setToken("");
          location.hash = "/login";
          setState("login");
          setLoginRequested(true);
          return;
        }
        throw reason;
      }
    } catch (reason) {
      if (getToken()) {
        setError(reason instanceof Error ? reason.message : "控制端启动失败");
        setState("error");
      } else {
        setState("login");
      }
    }
  }, []);

  useEffect(() => { void bootstrap(); }, [bootstrap]);
  useEffect(() => {
    let cancelled = false;
    api.get<unknown>("/api/public/branding")
      .then((response) => { if (!cancelled) setBranding(publicBrandingFrame(response)); })
      .catch(() => { if (!cancelled) setBranding(DEFAULT_BRANDING); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { applyBrandingDocument(branding); }, [branding]);
  useEffect(() => {
    if (location.hash.replace(/^#\/?/, "") === "portal") {
      location.hash = "/dashboard";
    }
    const onHash = () => {
      const cleanHash = location.hash.replace(/^#\/?/, "");
      if (cleanHash === "portal") {
        location.hash = "/dashboard";
        return;
      }
      setLoginRequested(cleanHash === "login");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (state !== "login" && !probePreview) return;
    let cancelled = false;
    Promise.all([
      api.get<{ login_wallpaper?: string }>("/api/public/login-wallpaper").catch(() => ({ login_wallpaper: "" })),
      api.get<unknown>("/api/public/probe-servers").catch(() => emptyPublicProbeState()),
    ]).then(([wallpaperResponse, probeResponse]) => {
      if (cancelled) return;
      setWallpaper(wallpaperResponse.login_wallpaper?.trim() ?? "");
      const nextProbe = publicProbeFrame(probeResponse) ?? emptyPublicProbeState();
      setProbe(nextProbe);
      if (nextProbe.enabled) {
        saveCachedProbe(nextProbe);
      }
    });
    return () => { cancelled = true; };
  }, [probePreview, state]);
  useEffect(() => {
    const showingProbe = probePreview || (state === "login" && !loginRequested);
    if (!showingProbe || !probe.enabled) return;

    let stopped = false;
    let socket: WebSocket | null = null;
    let pollTimer: number | undefined;
    let reconnectTimer: number | undefined;
    let connectionFallbackTimer: number | undefined;
    let reconnectAttempts = 0;
    let pollInFlight = false;

    const update = (value: unknown) => {
      const next = publicProbeFrame(value);
      if (!stopped && next) {
        setProbe(next);
        if (next.enabled) {
          saveCachedProbe(next);
        }
      }
    };
    const poll = async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        update(await api.get<unknown>("/api/public/probe-servers"));
      } catch {
        // The last valid snapshot remains visible while public polling retries.
      } finally {
        pollInFlight = false;
      }
    };
    const startPolling = () => {
      if (pollTimer !== undefined) return;
      void poll();
      pollTimer = window.setInterval(() => { void poll(); }, publicProbeRefreshIntervalMs);
    };
    const stopPolling = () => {
      if (pollTimer === undefined) return;
      window.clearInterval(pollTimer);
      pollTimer = undefined;
    };
    const scheduleReconnect = () => {
      if (stopped || reconnectTimer !== undefined) return;
      startPolling();
      const delay = Math.min(30_000, 1_000 * 2 ** reconnectAttempts);
      reconnectAttempts += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, delay);
    };
    const connect = () => {
      if (stopped || typeof window.WebSocket !== "function") {
        startPolling();
        return;
      }
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      let closed = false;
      let opened = false;
      const disconnect = () => {
        if (closed) return;
        closed = true;
        if (connectionFallbackTimer !== undefined) {
          window.clearTimeout(connectionFallbackTimer);
          connectionFallbackTimer = undefined;
        }
        if (socket === next) socket = null;
        scheduleReconnect();
      };
      let next: WebSocket;
      try {
        next = new window.WebSocket(`${protocol}//${location.host}/api/public/probe-ws`);
      } catch {
        scheduleReconnect();
        return;
      }
      socket = next;
      connectionFallbackTimer = window.setTimeout(() => {
        if (!opened) startPolling();
      }, publicProbeRefreshIntervalMs);
      next.onopen = () => {
        if (stopped || socket !== next) return;
        opened = true;
        reconnectAttempts = 0;
        if (connectionFallbackTimer !== undefined) {
          window.clearTimeout(connectionFallbackTimer);
          connectionFallbackTimer = undefined;
        }
        stopPolling();
      };
      next.onmessage = (event) => {
        try { update(JSON.parse(String(event.data))); } catch { /* Ignore non-snapshot frames. */ }
      };
      next.onerror = () => {
        next.close();
        disconnect();
      };
      next.onclose = disconnect;
    };

    connect();
    return () => {
      stopped = true;
      stopPolling();
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if (connectionFallbackTimer !== undefined) window.clearTimeout(connectionFallbackTimer);
      socket?.close();
    };
  }, [loginRequested, probe.enabled, probePreview, state]);
  useEffect(() => {
    const unauthorized = () => {
      if (state !== "ready") return;
      setToken("");
      setProfile(null);
      location.hash = "/login";
      setState("login");
    };
    window.addEventListener("arcway:unauthorized", unauthorized);
    return () => window.removeEventListener("arcway:unauthorized", unauthorized);
  }, [state]);

  const onLogin = (session: Session) => {
    setLogoutNotice("");
    setProfile(session);
    setState("ready");
    location.hash = "/dashboard";
  };

  const logout = () => {
    const remoteLogout = revokeCurrentSession();
    setLogoutNotice("");
    setProfile(null);
    location.hash = "/login";
    setState("login");
    void remoteLogout.catch(() => {
      setLogoutNotice("服务端会话注销未确认，本地登录信息已清除；如在共享设备上操作，请关闭其他已登录页面。");
    });
  };

  const leaveProbePreview = () => {
    const next = new URL(location.href);
    next.searchParams.delete("probe");
    history.replaceState(null, "", `${next.pathname}${next.search}${next.hash}`);
    setProbePreview(false);
    if (state === "login") {
      location.hash = "/login";
      setLoginRequested(true);
    }
  };

  let content: ReactNode = null;
  if (state === "loading") {
    content = <main className="boot-screen"><BrandMark className="brand-mark-large" size={32} /><strong>{branding.name}</strong><Spinner label="正在连接控制端" /></main>;
  } else if (state === "error") {
    content = <main className="boot-screen boot-error"><BrandMark className="brand-mark-large" size={32} /><ErrorState message={error} /><Button onClick={() => void bootstrap()}>重新连接</Button></main>;
  } else if (state === "setup") {
    content = <SetupScreen onComplete={() => setState("login")} />;
  } else if (probePreview && probe.enabled) {
    content = <PublicProbeScreen probe={probe} onLogin={leaveProbePreview} loginLabel="返回控制台" />;
  } else if (state === "login" && probe.enabled && !loginRequested) {
    content = <PublicProbeScreen probe={probe} onLogin={() => { location.hash = "/login"; setLoginRequested(true); }} />;
  } else if (state === "login") {
    content = <LoginScreen wallpaper={wallpaper} notice={logoutNotice} onLogin={onLogin} />;
  } else if (profile) {
    content = (
      <ConsoleApp
        profile={profile}
        onLogout={logout}
        onBrandingChange={setBranding}
      />
    );
  }
  return <BrandingProvider branding={branding}>{content}</BrandingProvider>;
}

export function revokeCurrentSession(): Promise<unknown> {
  const remoteLogout = api.post("/api/logout", undefined, { suppressUnauthorizedEvent: true, timeoutMs: 5_000 });
  setToken("");
  return remoteLogout;
}

const rootElement = document.getElementById("root");
if (rootElement) createRoot(rootElement).render(<StrictMode><App /></StrictMode>);
