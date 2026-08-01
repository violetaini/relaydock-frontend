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

export function App() {
  const [state, setState] = useState<BootState>("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [publicReady, setPublicReady] = useState(false);
  const [wallpaper, setWallpaper] = useState("");
  const [probe, setProbe] = useState<PublicProbeState>(emptyPublicProbeState);
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [loginRequested, setLoginRequested] = useState(() => location.hash.replace(/^#\/?/, "") === "login");
  const [probePreview, setProbePreview] = useState(() => new URLSearchParams(location.search).get("probe") === "1");

  const bootstrap = useCallback(async () => {
    setState("loading");
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
          return;
        }
        throw reason;
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "控制端启动失败");
      setState("error");
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
    const onHash = () => setLoginRequested(location.hash.replace(/^#\/?/, "") === "login");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (state !== "login" && !probePreview) return;
    let cancelled = false;
    setPublicReady(false);
    Promise.all([
      api.get<{ login_wallpaper?: string }>("/api/public/login-wallpaper").catch(() => ({ login_wallpaper: "" })),
      api.get<unknown>("/api/public/probe-servers").catch(() => emptyPublicProbeState()),
    ]).then(([wallpaperResponse, probeResponse]) => {
      if (cancelled) return;
      setWallpaper(wallpaperResponse.login_wallpaper?.trim() ?? "");
      setProbe(publicProbeFrame(probeResponse) ?? emptyPublicProbeState());
      setPublicReady(true);
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

    const update = (value: unknown) => {
      const next = publicProbeFrame(value);
      if (!stopped && next) setProbe(next);
    };
    const poll = async () => {
      try {
        update(await api.get<unknown>("/api/public/probe-servers"));
      } catch {
        // The last valid snapshot remains visible while public polling retries.
      }
    };
    const startPolling = () => {
      if (pollTimer !== undefined) return;
      void poll();
      pollTimer = window.setInterval(() => { void poll(); }, 5_000);
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
      }, 5_000);
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
    setProfile(session);
    setState("ready");
    location.hash = "/dashboard";
  };

  const logout = () => {
    setToken("");
    setProfile(null);
    location.hash = "/login";
    setState("login");
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
  } else if (state === "login" && !publicReady) {
    content = <main className="boot-screen"><BrandMark className="brand-mark-large" size={32} /><Spinner label="正在加载入口" /></main>;
  } else if (probePreview && !publicReady) {
    content = <main className="boot-screen"><BrandMark className="brand-mark-large" size={32} /><Spinner label="正在加载公开探针" /></main>;
  } else if (probePreview && probe.enabled) {
    content = <PublicProbeScreen probe={probe} onLogin={leaveProbePreview} loginLabel="返回控制台" />;
  } else if (state === "login" && probe.enabled && !loginRequested) {
    content = <PublicProbeScreen probe={probe} onLogin={() => { location.hash = "/login"; setLoginRequested(true); }} />;
  } else if (state === "login") {
    content = <LoginScreen wallpaper={wallpaper} onLogin={onLogin} />;
  } else if (profile) {
    content = <ConsoleApp profile={profile} onLogout={logout} onBrandingChange={setBranding} />;
  }
  return <BrandingProvider branding={branding}>{content}</BrandingProvider>;
}

const rootElement = document.getElementById("root");
if (rootElement) createRoot(rootElement).render(<StrictMode><App /></StrictMode>);
