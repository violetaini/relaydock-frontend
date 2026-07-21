import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Network } from "lucide-react";
import { api, ApiError, getToken, setToken } from "./api";
import { LoginScreen, PublicProbeScreen, SetupScreen, type PublicProbeState } from "./auth-screens";
import { ConsoleApp } from "./console";
import type { Profile, Session } from "./types";
import { Button, ErrorState, Spinner } from "./ui";
import "./styles.css";
import "./modern-theme.css";

type BootState = "loading" | "setup" | "login" | "ready" | "error";

export function App() {
  const [state, setState] = useState<BootState>("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [publicReady, setPublicReady] = useState(false);
  const [wallpaper, setWallpaper] = useState("");
  const [probe, setProbe] = useState<PublicProbeState>({ enabled: false, servers: [] });
  const [loginRequested, setLoginRequested] = useState(() => location.hash.replace(/^#\/?/, "") === "login");

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
    const onHash = () => setLoginRequested(location.hash.replace(/^#\/?/, "") === "login");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (state !== "login") return;
    let cancelled = false;
    setPublicReady(false);
    Promise.all([
      api.get<{ login_wallpaper?: string }>("/api/public/login-wallpaper").catch(() => ({ login_wallpaper: "" })),
      api.get<PublicProbeState>("/api/public/probe-servers").catch(() => ({ enabled: false, servers: [] })),
    ]).then(([wallpaperResponse, probeResponse]) => {
      if (cancelled) return;
      setWallpaper(wallpaperResponse.login_wallpaper?.trim() ?? "");
      setProbe({ ...probeResponse, servers: probeResponse.servers ?? [] });
      setPublicReady(true);
    });
    return () => { cancelled = true; };
  }, [state]);
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

  if (state === "loading") {
    return <main className="boot-screen"><span className="brand-mark brand-mark-large"><Network size={27} /></span><strong>Arcway</strong><Spinner label="正在连接控制端" /></main>;
  }
  if (state === "error") {
    return <main className="boot-screen boot-error"><span className="brand-mark brand-mark-large"><Network size={27} /></span><ErrorState message={error} /><Button onClick={() => void bootstrap()}>重新连接</Button></main>;
  }
  if (state === "setup") return <SetupScreen onComplete={() => setState("login")} />;
  if (state === "login" && !publicReady) return <main className="boot-screen"><span className="brand-mark brand-mark-large"><Network size={27} /></span><Spinner label="正在加载入口" /></main>;
  if (state === "login" && probe.enabled && !loginRequested) return <PublicProbeScreen probe={probe} onLogin={() => { location.hash = "/login"; setLoginRequested(true); }} />;
  if (state === "login") return <LoginScreen wallpaper={wallpaper} onLogin={onLogin} />;
  if (profile) return <ConsoleApp profile={profile} onLogout={logout} />;
  return null;
}

const rootElement = document.getElementById("root");
if (rootElement) createRoot(rootElement).render(<StrictMode><App /></StrictMode>);
