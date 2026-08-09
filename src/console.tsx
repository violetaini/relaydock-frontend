import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useState, type ErrorInfo, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Check,
  ChevronRight,
  Clipboard,
  Copy,
  FileText,
  Gauge,
  House,
  Link2,
  LogOut,
  Menu,
  MessageSquareWarning,
  Monitor,
  Moon,
  Network,
  Package,
  PanelLeft,
  PanelTop,
  Plus,
  RefreshCw,
  Route,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
  Users,
  Wifi,
  WifiOff,
  Wrench,
  X,
} from "lucide-react";
import { api, openDashboardSocket } from "./api";
import { BrandMark, useBranding, type Branding } from "./brand";
import { requestNavigation } from "./navigation-guard";
import { trafficProgressState } from "./traffic-progress";
import { nextThemeMode, normalizeThemeMode, resolveThemeMode, type ThemeMode } from "./theme";
import { TwoFactorSettings } from "./two-factor";
import type {
  NodeItem,
  NodeListResponse,
  Profile,
  RealtimeMessage,
  RemoteServer,
  ServerListResponse,
  Theme,
  TrafficSummary,
  UserItem,
} from "./types";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  PageHeader,
  Spinner,
  Surface,
  Toast,
  Toggle,
  formatBytes,
  relativeTime,
  statusTone,
} from "./ui";

type PageKey = "dashboard" | "subscriptions" | "generator" | "servers" | "nodes" | "forwarding" | "traffic" | "users" | "packages" | "certificates" | "templates" | "subscribeFiles" | "customRules" | "rulesConfig" | "settings" | "account";
type UsersScope = "all" | "renewal" | "invites";

interface ToastState { message: string; tone: "success" | "error" }
type LayoutMode = "top" | "side";
type ControlState = "checking" | "online" | "offline";

const AccountWorkbenchPage = lazy(() => import("./account-workbench").then((module) => ({ default: module.AccountWorkbenchPage })));
const contentWorkbench = () => import("./content-workbench");
const CertificatesWorkbenchPage = lazy(() => contentWorkbench().then((module) => ({ default: module.CertificatesWorkbenchPage })));
const SubscribeFilesPage = lazy(() => contentWorkbench().then((module) => ({ default: module.SubscribeFilesPage })));
const SubscriptionGeneratorPage = lazy(() => contentWorkbench().then((module) => ({ default: module.SubscriptionGeneratorPage })));
const SubscriptionLinksPage = lazy(() => contentWorkbench().then((module) => ({ default: module.SubscriptionLinksPage })));
const TemplatesWorkbenchPage = lazy(() => contentWorkbench().then((module) => ({ default: module.TemplatesWorkbenchPage })));
const NodesWorkbench = lazy(() => import("./nodes-workbench").then((module) => ({ default: module.NodesWorkbench })));
const PackagesPage = lazy(() => import("./packages").then((module) => ({ default: module.PackagesPage })));
const rulesWorkbench = () => import("./rules-workbench");
const CustomRulesWorkbenchPage = lazy(() => rulesWorkbench().then((module) => ({ default: module.CustomRulesWorkbenchPage })));
const RulesConfigWorkbenchPage = lazy(() => rulesWorkbench().then((module) => ({ default: module.RulesConfigWorkbenchPage })));
const ForwardingManagement = lazy(() => import("./forwarding-management").then((module) => ({ default: module.ForwardingManagement })));
const ServicesWorkbenchPage = lazy(() => import("./services-workbench").then((module) => ({ default: module.ServicesWorkbenchPage })));
const SettingsWorkbenchPage = lazy(() => import("./settings-workbench").then((module) => ({ default: module.SettingsWorkbenchPage })));
const TrafficWorkbenchPage = lazy(() => import("./traffic-workbench").then((module) => ({ default: module.TrafficWorkbenchPage })));
const UsersWorkbenchPage = lazy(() => import("./users-workbench").then((module) => ({ default: module.UsersWorkbenchPage })));

const pageTitles: Record<PageKey, string> = {
  dashboard: "流量信息",
  subscriptions: "订阅链接",
  generator: "生成订阅",
  servers: "服务管理",
  nodes: "节点管理",
  forwarding: "转发管理",
  traffic: "流量明细",
  users: "用户管理",
  packages: "套餐管理",
  certificates: "证书管理",
  templates: "模板管理",
  subscribeFiles: "订阅管理",
  customRules: "覆写管理",
  rulesConfig: "规则配置",
  settings: "系统设置",
  account: "账户中心",
};

function resolvePage(isAdmin: boolean): PageKey {
  const candidate = location.hash.replace(/^#\/?/, "").split("?")[0] as PageKey;
  const known: PageKey[] = ["dashboard", "subscriptions", "generator", "servers", "nodes", "forwarding", "traffic", "users", "packages", "certificates", "templates", "subscribeFiles", "customRules", "rulesConfig", "settings", "account"];
  if (!known.includes(candidate)) return "dashboard";
  if (!isAdmin && ["servers", "users", "packages", "certificates", "rulesConfig", "settings"].includes(candidate)) return "dashboard";
  return candidate;
}

function resolveUsersScope(): UsersScope {
  const query = location.hash.split("?")[1] ?? "";
  const view = new URLSearchParams(query).get("view");
  return view === "renewal" || view === "invites" ? view : "all";
}

const permissionKey: Partial<Record<PageKey, string>> = {
  subscriptions: "subscription",
  generator: "generator",
  nodes: "nodes",
  templates: "templates",
  subscribeFiles: "subscribe-files",
  customRules: "custom-rules",
};

function pageAllowed(page: PageKey, isAdmin: boolean, permissions: string[] | null): boolean {
  if (isAdmin || page === "dashboard" || page === "forwarding" || page === "traffic" || page === "account") return true;
  const key = permissionKey[page];
  return Boolean(key && permissions?.includes(key));
}

class LazyPageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("lazy page failed to load", error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return <div className="center-state"><ErrorState message="页面资源加载失败，可能刚完成版本更新" /><Button onClick={() => window.location.reload()}><RefreshCw size={16} />重新载入</Button></div>;
    }
    return this.props.children;
  }
}

export function ConsoleApp({ profile, onLogout, onBrandingChange }: { profile: Profile; onLogout: () => void; onBrandingChange?: (branding: Branding) => void }) {
  const branding = useBranding();
  const [page, setPage] = useState<PageKey>(() => resolvePage(profile.is_admin));
  const [usersScope, setUsersScope] = useState<UsersScope>(resolveUsersScope);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => normalizeThemeMode(localStorage.getItem("arcway-theme")));
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => localStorage.getItem("arcway-layout") === "side" ? "side" : "top");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [userPages, setUserPages] = useState<string[] | null>(profile.is_admin ? [] : null);
  const [permissionsError, setPermissionsError] = useState("");
  const [permissionsRevision, setPermissionsRevision] = useState(0);
  const [controlState, setControlState] = useState<ControlState>("checking");
  const [identity, setIdentity] = useState(profile);
  const publicProbeURL = useMemo(() => {
    const target = new URL(location.href);
    target.hash = "";
    target.searchParams.set("probe", "1");
    return target.toString();
  }, []);

  useEffect(() => {
    const updateIdentity = (event: Event) => {
      const detail = (event as CustomEvent<Partial<Profile>>).detail;
      if (detail) setIdentity((current) => ({ ...current, ...detail }));
    };
    window.addEventListener("arcway:profile-updated", updateIdentity);
    return () => window.removeEventListener("arcway:profile-updated", updateIdentity);
  }, []);

  useEffect(() => {
    const onHash = () => {
      const nextPage = resolvePage(profile.is_admin);
      const nextUsersScope = resolveUsersScope();
      if (nextPage === page && nextUsersScope === usersScope) return;
      const targetHash = location.hash;
      const commit = () => {
        if (location.hash !== targetHash) location.hash = targetHash;
        setPage(nextPage);
        setUsersScope(nextUsersScope);
      };
      if (!requestNavigation(commit)) {
        const currentUsersView = page === "users" && usersScope !== "all" ? `?view=${usersScope}` : "";
        history.replaceState(null, "", `${location.pathname}${location.search}#/${page}${currentUsersView}`);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [page, profile.is_admin, usersScope]);

  useEffect(() => {
    if (profile.is_admin) return;
    let cancelled = false;
    setPermissionsError("");
    api.get<{ pages?: string[] }>("/api/user/permissions")
      .then((response) => { if (!cancelled) setUserPages(response.pages ?? []); })
      .catch((reason) => {
        if (!cancelled) {
          setUserPages(null);
          setPermissionsError(reason instanceof Error ? reason.message : "页面权限加载失败");
        }
      });
    return () => { cancelled = true; };
  }, [profile.is_admin, permissionsRevision]);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    const check = async () => {
      controller = new AbortController();
      try {
        await api.get<Profile>("/api/user/profile", { signal: controller.signal, timeoutMs: 10_000 });
        if (!stopped) setControlState("online");
      } catch {
        if (!stopped) setControlState("offline");
      } finally {
        controller = undefined;
        if (!stopped) timer = window.setTimeout(() => { void check(); }, 30_000);
      }
    };
    void check();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
    };
  }, []);

  useEffect(() => {
    if (!profile.is_admin && userPages !== null && !pageAllowed(page, false, userPages)) {
      location.hash = "/dashboard";
      setPage("dashboard");
    }
  }, [page, profile.is_admin, userPages]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const navigate = (next: PageKey, options?: { usersScope?: UsersScope }) => {
    const usersView = next === "users" ? options?.usersScope ?? "all" : "all";
    requestNavigation(() => {
      location.hash = `/${next}${usersView === "all" ? "" : `?view=${usersView}`}`;
      setPage(next);
      setUsersScope(usersView);
      setSidebarOpen(false);
    });
  };

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = resolveThemeMode(themeMode, media.matches);
      setTheme(resolved);
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    if (themeMode !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [themeMode]);

  const toggleTheme = () => {
    const next = nextThemeMode(themeMode);
    setThemeMode(next);
    localStorage.setItem("arcway-theme", next);
  };

  const themeLabel = themeMode === "light"
    ? "主题模式：亮色；点击切换暗色"
    : themeMode === "dark"
      ? "主题模式：暗色；点击切换跟随系统"
      : `主题模式：跟随系统（当前${theme === "dark" ? "暗色" : "亮色"}）；点击切换亮色`;
  const themeIcon = themeMode === "system" ? <Monitor size={18} /> : themeMode === "dark" ? <Moon size={18} /> : <Sun size={18} />;

  const toggleLayout = () => {
    const next = layoutMode === "top" ? "side" : "top";
    setLayoutMode(next);
    localStorage.setItem("arcway-layout", next);
  };

  const notify = (message: string, tone: ToastState["tone"] = "success") => setToast({ message, tone });

  return (
    <div className={`console-layout layout-${layoutMode}`}>
      {sidebarOpen ? <button className="sidebar-scrim" aria-label="关闭导航" onClick={() => setSidebarOpen(false)} /> : null}
      <aside className={`sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <div className="sidebar-brand brand"><BrandMark size={24} /><span>{branding.name}</span><IconButton className="sidebar-layout-switch" label="切换到顶部栏" onClick={toggleLayout}><PanelTop size={19} /></IconButton><IconButton className="sidebar-close" label="关闭导航" onClick={() => setSidebarOpen(false)}><X size={19} /></IconButton></div>
        <nav className="sidebar-nav" aria-label="主导航">
          <NavGroup label="主导航" className="nav-primary">
            <NavItem active={page === "dashboard"} icon={<Activity size={18} />} label="流量信息" onClick={() => navigate("dashboard")} />
            {pageAllowed("subscriptions", profile.is_admin, userPages) ? <NavItem active={page === "subscriptions"} icon={<Link2 size={18} />} label="订阅链接" onClick={() => navigate("subscriptions")} /> : null}
            {pageAllowed("generator", profile.is_admin, userPages) ? <NavItem active={page === "generator"} icon={<Wrench size={18} />} label="生成订阅" onClick={() => navigate("generator")} /> : null}
            {pageAllowed("nodes", profile.is_admin, userPages) ? <NavItem active={page === "nodes"} icon={<Route size={18} />} label="节点管理" onClick={() => navigate("nodes")} /> : null}
            <NavItem active={page === "forwarding"} icon={<Network size={18} />} label="转发管理" onClick={() => navigate("forwarding")} />
            <NavItem active={page === "traffic"} icon={<Gauge size={18} />} label="流量明细" onClick={() => navigate("traffic")} />
            {profile.is_admin ? <>
              <NavItem active={page === "servers"} icon={<Server size={18} />} label="服务管理" onClick={() => navigate("servers")} />
              <NavItem active={page === "users"} icon={<Users size={18} />} label="用户管理" onClick={() => navigate("users")} />
              <NavItem active={page === "packages"} icon={<Package size={18} />} label="套餐管理" onClick={() => navigate("packages")} />
            </> : null}
          </NavGroup>
          <NavGroup label="常用管理" className="nav-utility">
            <a className="nav-item nav-probe-link" href={publicProbeURL} aria-label="返回探针" title="返回探针"><House size={18} /><span>返回探针</span></a>
            {profile.is_admin ? <NavItem active={page === "certificates"} icon={<ShieldCheck size={18} />} label="证书管理" onClick={() => navigate("certificates")} /> : null}
            {pageAllowed("templates", profile.is_admin, userPages) ? <NavItem active={page === "templates"} icon={<Clipboard size={18} />} label="模板管理" onClick={() => navigate("templates")} /> : null}
            {pageAllowed("subscribeFiles", profile.is_admin, userPages) ? <NavItem active={page === "subscribeFiles"} icon={<FileText size={18} />} label="订阅管理" onClick={() => navigate("subscribeFiles")} /> : null}
            {profile.is_admin ? <NavItem active={page === "settings"} icon={<Settings size={18} />} label="系统设置" onClick={() => navigate("settings")} /> : null}
          </NavGroup>
        </nav>
        <div className="sidebar-footer">
          <a className="icon-button sidebar-probe-link" href={publicProbeURL} aria-label="返回探针" title="返回探针"><House size={18} /></a>
          <IconButton className="top-layout-switch" label="切换到侧边栏" onClick={toggleLayout}><PanelLeft size={18} /></IconButton>
          <IconButton label={themeLabel} onClick={toggleTheme}>{themeIcon}</IconButton>
          <button type="button" className={`account-block ${page === "account" ? "is-active" : ""}`} aria-label="账户中心" title="账户中心" onClick={() => navigate("account")}>
            <span className="account-avatar">{(identity.nickname || identity.username).slice(0, 1).toUpperCase()}</span>
            <span><strong>{identity.nickname || identity.username}</strong><small>{profile.is_admin ? "管理员" : "用户"}</small></span>
          </button>
          <IconButton label="退出登录" onClick={onLogout}><LogOut size={18} /></IconButton>
        </div>
      </aside>

      <div className="console-main">
        <header className="topbar">
          <div className="topbar-leading">
            <span className="mobile-topbar-brand"><BrandMark size={22} /><strong>{branding.name}</strong></span>
            <IconButton className="mobile-menu" label="打开导航" onClick={() => setSidebarOpen(true)}><Menu size={20} /></IconButton>
            <span className="topbar-page-title">{pageTitles[page]}</span>
          </div>
          <div className="topbar-actions">
            <span className="control-state" role="status"><span className={`status-dot status-${controlState}`} />{controlState === "online" ? "控制端在线" : controlState === "offline" ? "控制端离线" : "正在检查"}</span>
            <a className="icon-button topbar-probe-link" href={publicProbeURL} aria-label="返回探针" title="返回探针"><House size={18} /></a>
            <IconButton className="topbar-layout-switch" label="切换到顶部栏" onClick={toggleLayout}><PanelTop size={19} /></IconButton>
            <IconButton className="mobile-page-shortcut" label="返回流量信息" onClick={() => navigate("dashboard")}><Activity size={18} /></IconButton>
            <IconButton label={themeLabel} onClick={toggleTheme}>{themeIcon}</IconButton>
            <button type="button" className="topbar-account" aria-label="账户中心" title="账户中心" onClick={() => navigate("account")}><span className="topbar-avatar">{(identity.nickname || identity.username).slice(0, 1).toUpperCase()}</span><span className="topbar-account-copy"><strong>{identity.nickname || identity.username}</strong><small>{profile.is_admin ? "管理员" : "用户"}</small></span></button>
          </div>
        </header>
        <main className={`page-content page-${page}`}>
          {!profile.is_admin && permissionKey[page] && userPages === null ? (
            permissionsError
              ? <ErrorState message={permissionsError} onRetry={() => setPermissionsRevision((value) => value + 1)} />
              : <div className="center-state"><Spinner label="正在加载页面权限" /></div>
          ) : <LazyPageBoundary key={page}><Suspense fallback={<div className="center-state"><Spinner label="正在加载页面" /></div>}>
          {page === "dashboard" ? <DashboardPage profile={profile} navigate={navigate} canNavigateNodes={pageAllowed("nodes", profile.is_admin, userPages)} /> : null}
          {page === "subscriptions" && pageAllowed(page, profile.is_admin, userPages) ? <SubscriptionLinksPage notify={notify} /> : null}
          {page === "generator" && pageAllowed(page, profile.is_admin, userPages) ? <SubscriptionGeneratorPage notify={notify} /> : null}
          {page === "servers" && profile.is_admin ? <ServicesWorkbenchPage notify={notify} /> : null}
          {page === "nodes" && pageAllowed(page, profile.is_admin, userPages) ? <NodesWorkbench isAdmin={profile.is_admin} notify={notify} /> : null}
          {page === "forwarding" ? <ForwardingManagement isAdmin={profile.is_admin} notify={notify} /> : null}
          {page === "traffic" ? <TrafficWorkbenchPage profile={profile} /> : null}
          {page === "users" && profile.is_admin ? <UsersWorkbenchPage notify={notify} initialScope={usersScope} /> : null}
          {page === "packages" && profile.is_admin ? <PackagesPage notify={notify} /> : null}
          {page === "certificates" && profile.is_admin ? <CertificatesWorkbenchPage notify={notify} /> : null}
          {page === "templates" && pageAllowed(page, profile.is_admin, userPages) ? <TemplatesWorkbenchPage notify={notify} /> : null}
          {page === "subscribeFiles" && pageAllowed(page, profile.is_admin, userPages) ? <SubscribeFilesPage isAdmin={profile.is_admin} notify={notify} onOpenCustomRules={pageAllowed("customRules", profile.is_admin, userPages) ? () => navigate("customRules") : undefined} onOpenRulesConfig={profile.is_admin ? () => navigate("rulesConfig") : undefined} /> : null}
          {page === "customRules" && pageAllowed(page, profile.is_admin, userPages) ? <CustomRulesWorkbenchPage notify={notify} /> : null}
          {page === "rulesConfig" && profile.is_admin ? <RulesConfigWorkbenchPage notify={notify} /> : null}
          {page === "settings" && profile.is_admin ? <SettingsWorkbenchPage notify={notify} onBrandingChange={onBrandingChange} /> : null}
          {page === "account" ? <AccountWorkbenchPage notify={notify} /> : null}
          </Suspense></LazyPageBoundary>}
        </main>
      </div>
      <div className="floating-tools" aria-label="反馈工具">
        <a className="icon-button" href="https://github.com/violetaini/relaydock-frontend/issues" target="_blank" rel="noreferrer" aria-label="反馈问题" title="反馈问题"><MessageSquareWarning size={18} /></a>
      </div>
      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </div>
  );
}

function NavGroup({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return <div className={`nav-group ${className}`.trim()}><span className="nav-label">{label}</span>{children}</div>;
}

function NavItem({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return <button className={`nav-item ${active ? "is-active" : ""}`} aria-label={label} title={label} onClick={onClick}>{icon}<span>{label}</span><ChevronRight size={15} /></button>;
}

type TrafficPeriod = "today" | "week" | "month";

export function filterTrafficHistory<T extends { date: string }>(items: T[], period: TrafficPeriod, now = new Date()): T[] {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const start = period === "today"
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    : period === "week"
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime()
      : new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return items.filter((item) => {
    const timestamp = new Date(/^\d{4}-\d{2}-\d{2}$/.test(item.date) ? `${item.date}T00:00:00` : item.date).getTime();
    return Number.isFinite(timestamp) && timestamp >= start && timestamp < end;
  });
}

function DashboardPage({ profile, navigate, canNavigateNodes }: { profile: Profile; navigate: (page: PageKey, options?: { usersScope?: UsersScope }) => void; canNavigateNodes: boolean }) {
  const [servers, setServers] = useState<RemoteServer[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [traffic, setTraffic] = useState<TrafficSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<TrafficPeriod>("month");
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const calls: Promise<unknown>[] = [
        api.get<NodeListResponse>("/api/admin/nodes"),
        api.get<TrafficSummary>("/api/traffic/summary"),
      ];
      if (profile.is_admin) {
        calls.push(api.get<ServerListResponse>("/api/admin/remote-servers"));
        calls.push(api.get<{ users: UserItem[] }>("/api/admin/users"));
      }
      const result = await Promise.all(calls);
      setNodes((result[0] as NodeListResponse).nodes ?? []);
      setTraffic(result[1] as TrafficSummary);
      if (profile.is_admin) {
        setServers((result[2] as ServerListResponse).servers ?? []);
        setUsers((result[3] as { users: UserItem[] }).users ?? []);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法加载运行数据");
    } finally {
      setLoading(false);
    }
  }, [profile.is_admin]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!profile.is_admin) {
      setRealtimeConnected(false);
      return;
    }
    return openDashboardSocket((data) => {
      const message = data as RealtimeMessage;
      if (message.type !== "realtime") return;
      if (message.servers) setServers(message.servers);
      if (message.trafficSummary) setTraffic(message.trafficSummary);
    }, {
      onOpen: () => setRealtimeConnected(true),
      onClose: () => setRealtimeConnected(false),
    });
  }, [profile.is_admin]);

  const online = servers.filter((server) => server.ws_connected || ["online", "connected"].includes(server.status)).length;
  const history = filterTrafficHistory(traffic?.history ?? [], period);
  const maxHistory = Math.max(1, ...history.map((item) => item.used_gb));
  const periodUsed = history.reduce((total, item) => total + item.used_gb, 0);
  const uploadSpeed = servers.reduce((total, server) => total + Number(server.current_upload_speed || 0), 0);
  const downloadSpeed = servers.reduce((total, server) => total + Number(server.current_download_speed || 0), 0);
  const rawUsagePercent = Number(traffic?.metrics.usage_percentage ?? 0);
  const usagePercent = Number.isFinite(rawUsagePercent) ? Math.max(0, rawUsagePercent) : 0;
  const usageState = trafficProgressState(usagePercent, Number(traffic?.metrics.total_limit_gb || 0) > 0 ? 100 : 0);
  const usageTone = usageState.tone === "neutral" ? "info" : usageState.tone;
  const enabledNodes = nodes.filter((node) => node.enabled).length;
  const renewalEdge = Date.now() + 14 * 86_400_000;
  const renewalAttention = users.filter((user) => {
    if (user.role === "admin" || !user.package_id || !user.package_end_date) return false;
    const end = new Date(`${user.package_end_date}T23:59:59`).getTime();
    return Number.isFinite(end) && end <= renewalEdge;
  }).length;
  const periodDescription = period === "today" ? "今天 00:00 起" : period === "week" ? "本周一 00:00 起" : "自本月 1 日 00:00 起";
  const periodTabs: Array<[TrafficPeriod, string]> = [["today", "今天"], ["week", "本周"], ["month", "本月"]];
  const selectPeriodByKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % periodTabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + periodTabs.length) % periodTabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = periodTabs.length - 1;
    else return;
    event.preventDefault();
    setPeriod(periodTabs[next][0]);
    document.getElementById(`dashboard-period-${periodTabs[next][0]}`)?.focus();
  };
  const healthState = error
    ? { className: "is-error", label: "待检查" }
    : loading
      ? { className: "is-syncing", label: "同步中" }
      : profile.is_admin && servers.length === 0
        ? { className: "is-syncing", label: "尚未接入服务器" }
        : profile.is_admin && online === 0
          ? { className: "is-error", label: "服务器全部离线" }
          : { className: "is-online", label: "运行正常" };

  return (
    <>
      <h1 className="sr-only">流量信息</h1>
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      <div className="metric-grid">
        <Metric tone="info" icon={<ArrowUpFromLine size={22} />} label="总流量配额" value={loading ? "--" : `${traffic?.metrics.total_limit_gb ?? 0} GB`} detail="所有节点的总配额" />
        <Metric tone="accent" icon={<Activity size={22} />} label="已用流量" value={loading ? "--" : `${traffic?.metrics.total_used_gb ?? 0} GB`} detail="所有节点累计消耗" />
        <Metric tone="good" icon={<Boxes size={22} />} label="剩余流量" value={loading ? "--" : `${traffic?.metrics.total_remaining_gb ?? 0} GB`} detail="仍可分配的余量" />
        <Metric tone={usageTone} icon={<Gauge size={22} />} label="使用率" value={loading ? "--" : `${usagePercent.toFixed(1)}%`} detail={loading ? "正在汇总流量" : profile.is_admin ? `${realtimeConnected ? "实时" : "最近同步"} ↑ ${formatBytes(uploadSpeed, true)} · ↓ ${formatBytes(downloadSpeed, true)}` : "账户流量汇总"} progress={loading ? undefined : usagePercent} />
      </div>

      <Surface className={`chart-surface dashboard-chart ${!loading && history.length === 0 ? "is-empty" : ""}`}>
        <div className="surface-heading dashboard-chart-heading">
          <div><h2>每日流量消耗</h2><small>{periodDescription}</small></div>
          <div className="dashboard-chart-tools">
            <span className={`dashboard-live-state ${error ? "is-error" : loading || (profile.is_admin && !realtimeConnected) ? "is-syncing" : "is-online"}`}><span />{error ? "数据异常" : loading ? "同步中" : profile.is_admin ? realtimeConnected ? "实时数据" : "轮询数据" : "最近同步"}</span>
            <IconButton label="查看流量明细" onClick={() => navigate("traffic")}><ChevronRight size={17} /></IconButton>
            <IconButton label="刷新流量概览" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "is-spinning" : ""} size={17} /></IconButton>
            <span className="chart-total">{periodUsed.toFixed(1)} GB</span>
            <div className="dashboard-period" role="tablist" aria-label="流量周期">
              {periodTabs.map(([value, label], index) => <button id={`dashboard-period-${value}`} key={value} type="button" role="tab" aria-controls="dashboard-traffic-chart" aria-selected={period === value} tabIndex={period === value ? 0 : -1} className={period === value ? "is-active" : ""} onKeyDown={(event) => selectPeriodByKey(event, index)} onClick={() => setPeriod(value)}>{label}</button>)}
            </div>
          </div>
        </div>
        {loading ? <div className="center-state"><Spinner /></div> : history.length === 0 ? <EmptyState icon={<Activity size={22} />} title="暂无历史记录" /> : (
          <div id="dashboard-traffic-chart" className={`bar-chart period-${period}`} role="tabpanel" aria-label="每日流量消耗图">
            <span className="sr-only">{history.map((item) => `${item.date} ${item.used_gb} GB`).join("；")}</span>
            {history.map((item) => <div className="bar-column" key={item.date} title={`${item.date}: ${item.used_gb} GB`}><span className="bar-value">{item.used_gb > 0 ? item.used_gb : ""}</span><span className="bar" style={{ height: `${Math.max(4, item.used_gb / maxHistory * 100)}%` }} /><small>{item.date.slice(-2)}</small></div>)}
          </div>
        )}
      </Surface>

      <Surface className="dashboard-health-strip">
        <div className="surface-heading"><div><h2>运行概览</h2><small>从这里进入需要处理的运营事项</small></div><span className={`dashboard-live-state ${healthState.className}`}><span />{healthState.label}</span></div>
        <div className={`dashboard-health-items ${profile.is_admin ? "is-admin" : ""}`}>
          <button type="button" className="dashboard-health-item" disabled={!canNavigateNodes} onClick={() => navigate("nodes")}><span className="dashboard-health-icon"><Route size={18} /></span><span><small>已启用节点</small><strong>{loading ? "--" : `${enabledNodes} / ${nodes.length}`}</strong></span>{canNavigateNodes ? <ChevronRight size={18} /> : null}</button>
          {profile.is_admin ? <button type="button" className="dashboard-health-item" onClick={() => navigate("servers")}><span className="dashboard-health-icon"><Server size={18} /></span><span><small>在线服务器</small><strong>{loading ? "--" : `${online} / ${servers.length}`}</strong></span><ChevronRight size={18} /></button> : null}
          {profile.is_admin ? <button type="button" className="dashboard-health-item" onClick={() => navigate("users", { usersScope: "renewal" })}><span className="dashboard-health-icon"><Users size={18} /></span><span><small>待续期用户</small><strong>{loading ? "--" : renewalAttention}</strong></span><ChevronRight size={18} /></button> : null}
        </div>
      </Surface>
    </>
  );
}

function Metric({ icon, label, value, detail, tone = "accent", progress }: { icon: ReactNode; label: string; value: ReactNode; detail: string; tone?: "accent" | "good" | "info" | "warn" | "bad"; progress?: number }) {
  const validProgress = progress != null && Number.isFinite(progress) ? Math.max(0, progress) : undefined;
  const safeProgress = validProgress == null ? undefined : Math.min(100, validProgress);
  const progressText = validProgress == null ? "" : `${validProgress.toFixed(1)}%`;
  return <Surface className={`metric metric-${tone}`}><div className="metric-top"><span className="metric-icon">{icon}</span><span className="metric-copy"><span>{label}</span><small>{detail}</small></span></div><strong>{value}</strong>{safeProgress != null ? <span className="metric-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={safeProgress} aria-valuetext={progressText}><span style={{ width: `${safeProgress}%` }} /></span> : null}</Surface>;
}

function ServersPage({ notify }: { notify: (message: string, tone?: ToastState["tone"]) => void }) {
  const [servers, setServers] = useState<RemoteServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [installCommand, setInstallCommand] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await api.get<ServerListResponse>("/api/admin/remote-servers");
      if (!response.success) throw new Error(response.message || "服务器列表加载失败");
      setServers(response.servers ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "服务器列表加载失败"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const remove = async (server: RemoteServer) => {
    if (!confirm(`确认从控制端删除“${server.name}”？远端 Agent 不会自动卸载。`)) return;
    try {
      const response = await api.post<{ success: boolean; message: string }>("/api/admin/remote-servers/delete", { id: server.id });
      if (!response.success) throw new Error(response.message);
      notify("服务器已删除");
      await load();
    } catch (reason) { notify(reason instanceof Error ? reason.message : "删除失败", "error"); }
  };

  return (
    <>
      <PageHeader title="服务管理" description="管理远程服务器" actions={<><IconButton label="刷新" onClick={() => void load()}><RefreshCw size={18} /></IconButton><Button onClick={() => setShowCreate(true)}><Plus size={17} />添加服务器</Button></>} />
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      <Surface className="table-surface">
        {loading ? <div className="center-state"><Spinner /></div> : servers.length === 0 ? <EmptyState icon={<Server size={24} />} title="尚未接入服务器" action={<Button onClick={() => setShowCreate(true)}><Plus size={16} />接入服务器</Button>} /> : (
          <div className="table-wrap"><table><thead><tr><th>服务器</th><th>连接</th><th>速度</th><th>流量</th><th>Xray</th><th aria-label="操作" /></tr></thead><tbody>{servers.map((server) => {
            const connected = server.ws_connected || server.status === "connected" || server.status === "online";
            return <tr key={server.id}><td><div className="primary-cell"><span className={`server-icon ${connected ? "is-online" : ""}`}>{connected ? <Wifi size={17} /> : <WifiOff size={17} />}</span><span><strong>{server.name}</strong><small>{server.ip_address || server.domain || "地址待上报"}</small></span></div></td><td><Badge tone={connected ? "good" : statusTone(server.status)}>{connected ? "WebSocket" : server.status || "离线"}</Badge><small className="cell-note">{relativeTime(server.last_heartbeat)}</small></td><td><span className="speed-pair"><small><ArrowUpFromLine size={13} />{formatBytes(server.current_upload_speed, true)}</small><small><ArrowDownToLine size={13} />{formatBytes(server.current_download_speed, true)}</small></span></td><td><strong>{formatBytes(server.traffic_used)}</strong><small className="cell-note">{server.traffic_limit > 0 ? `限额 ${formatBytes(server.traffic_limit)}` : "不限额"}</small></td><td><Badge tone={server.xray_running ? "good" : "neutral"}>{server.xray_running ? server.xray_version || "运行中" : "未运行"}</Badge><small className="cell-note">{server.xray_mode || "external"}</small></td><td className="actions-cell"><IconButton label={`删除 ${server.name}`} onClick={() => void remove(server)}><Trash2 size={17} /></IconButton></td></tr>;
          })}</tbody></table></div>
        )}
      </Surface>
      {showCreate ? <CreateServerDialog onClose={() => setShowCreate(false)} onCreated={async (command) => { setShowCreate(false); setInstallCommand(command); await load(); }} /> : null}
      {installCommand ? <InstallCommandDialog command={installCommand} onClose={() => setInstallCommand("")} notify={notify} /> : null}
    </>
  );
}

function CreateServerDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (command: string) => void }) {
  const [form, setForm] = useState({ name: "", ip_address: "", connection_mode: "websocket", xray_mode: "external", traffic_limit_gb: "", ipv6_enabled: true });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true); setError("");
    try {
      const result = await api.post<{ success: boolean; message: string; install_command: string }>("/api/admin/remote-servers/create", {
        name: form.name.trim(),
        ip_address: form.ip_address.trim(),
        connection_mode: form.connection_mode,
        listen_port: 0,
        xray_mode: form.xray_mode,
        traffic_limit: Math.round((Number(form.traffic_limit_gb) || 0) * 1024 ** 3),
        traffic_reset_day: 1,
        traffic_stats_mode: "both",
        traffic_source: "system",
        ipv6_enabled: form.ipv6_enabled,
        steal_self: false,
      });
      if (!result.success) throw new Error(result.message || "创建失败");
      onCreated(result.install_command);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "创建失败"); }
    finally { setSubmitting(false); }
  };
  return <Dialog title="接入服务器" description="创建连接凭据并生成 Agent 安装命令" onClose={onClose}><form onSubmit={submit} className="form-stack">{error ? <ErrorState message={error} /> : null}<Field label="名称"><input required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Hong Kong 01" /></Field><Field label="公网地址"><input required value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} placeholder="203.0.113.10" /></Field><div className="form-grid"><Field label="连接模式"><select value={form.connection_mode} onChange={(e) => setForm({ ...form, connection_mode: e.target.value })}><option value="websocket">WebSocket</option><option value="push">HTTP Push</option><option value="pull">HTTP Pull</option></select></Field><Field label="Xray 模式"><select value={form.xray_mode} onChange={(e) => setForm({ ...form, xray_mode: e.target.value })}><option value="external">独立服务</option><option value="embedded">内嵌运行</option></select></Field></div><Field label="月流量限额（GB）" hint="留空表示不限额"><input type="number" min="0" step="1" value={form.traffic_limit_gb} onChange={(e) => setForm({ ...form, traffic_limit_gb: e.target.value })} /></Field><Toggle checked={form.ipv6_enabled} onChange={(value) => setForm({ ...form, ipv6_enabled: value })} label="启用 IPv6" /><div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={submitting}>{submitting ? <Spinner label="正在创建" /> : <><Plus size={16} />创建</>}</Button></div></form></Dialog>;
}

function InstallCommandDialog({ command, onClose, notify }: { command: string; onClose: () => void; notify: (message: string, tone?: ToastState["tone"]) => void }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(command); notify("安装命令已复制"); }
    catch { notify("复制失败，请手动选择命令", "error"); }
  };
  return <Dialog title="Agent 安装命令" description="该命令包含一次性接入凭据" onClose={onClose} wide><div className="command-box"><code>{command}</code><IconButton label="复制安装命令" onClick={() => void copy()}><Copy size={18} /></IconButton></div><div className="dialog-actions"><Button onClick={onClose}><Check size={16} />完成</Button></div></Dialog>;
}

function NodesPage({ profile, notify }: { profile: Profile; notify: (message: string, tone?: ToastState["tone"]) => void }) {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setNodes((await api.get<NodeListResponse>("/api/admin/nodes")).nodes ?? []); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "节点列表加载失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? nodes.filter((node) => [node.node_name, node.protocol, node.tag, node.original_server].some((value) => value?.toLowerCase().includes(query))) : nodes;
  }, [nodes, search]);
  const remove = async (node: NodeItem) => {
    if (!confirm(`确认删除节点“${node.node_name}”？相关订阅会同步更新。`)) return;
    try { await api.delete(`/api/admin/nodes/${node.id}`); notify("节点已删除"); await load(); }
    catch (reason) { notify(reason instanceof Error ? reason.message : "删除失败", "error"); }
  };
  return <><PageHeader title="节点管理" description="输入代理节点信息，集中管理节点、标签和订阅归属。" actions={<><div className="search-box"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索节点" /></div><IconButton label="刷新" onClick={() => void load()}><RefreshCw size={18} /></IconButton><Button onClick={() => setShowImport(true)}><Upload size={17} />导入节点</Button></>} />{error ? <ErrorState message={error} onRetry={() => void load()} /> : null}<Surface className="table-surface">{loading ? <div className="center-state"><Spinner /></div> : filtered.length === 0 ? <EmptyState icon={<Route size={24} />} title={search ? "没有匹配的节点" : "暂无节点"} action={!search ? <Button onClick={() => setShowImport(true)}><Upload size={16} />导入节点</Button> : undefined} /> : <div className="table-wrap"><table><thead><tr><th>节点</th><th>协议</th><th>归属</th><th>标签</th><th>状态</th>{profile.is_admin ? <th aria-label="操作" /> : null}</tr></thead><tbody>{filtered.map((node) => <tr key={node.id}><td><div className="primary-cell"><span className={`server-icon ${node.enabled ? "is-online" : ""}`}><Route size={17} /></span><span><strong>{node.node_name}</strong><small>ID {node.id}{node.relay_orig_server ? " · 已中转" : ""}</small></span></div></td><td><Badge tone="info">{node.protocol || "未知"}</Badge><small className="cell-note">{node.node_type === "routed" ? "路由节点" : "物理节点"}</small></td><td><strong>{node.original_server || node.created_by || "外部导入"}</strong><small className="cell-note">{node.inbound_tag || "无入站绑定"}</small></td><td>{(node.tags?.length ? node.tags : node.tag ? [node.tag] : []).length ? <div className="tag-list">{(node.tags?.length ? node.tags : [node.tag]).slice(0, 3).map((tag) => <Badge key={tag}>{tag}</Badge>)}</div> : <span className="muted">未分类</span>}</td><td><Badge tone={node.enabled ? "good" : "neutral"}>{node.enabled ? "启用" : "停用"}</Badge></td>{profile.is_admin ? <td className="actions-cell"><IconButton label={`删除 ${node.node_name}`} onClick={() => void remove(node)}><Trash2 size={17} /></IconButton></td> : null}</tr>)}</tbody></table></div>}</Surface>{showImport ? <ImportNodesDialog onClose={() => setShowImport(false)} onComplete={async (count) => { setShowImport(false); notify(`已导入 ${count} 个节点`); await load(); }} /> : null}</>;
}

function ImportNodesDialog({ onClose, onComplete }: { onClose: () => void; onComplete: (count: number) => void }) {
  const [content, setContent] = useState("");
  const [tag, setTag] = useState("");
  const [skipCert, setSkipCert] = useState(false);
  const [proxies, setProxies] = useState<Record<string, unknown>[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const parse = async () => {
    setWorking(true); setError("");
    try { setProxies((await api.post<{ proxies: Record<string, unknown>[] }>("/api/admin/nodes/parse-uris", { content, force_node_skip_cert: skipCert })).proxies ?? []); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "解析失败"); }
    finally { setWorking(false); }
  };
  const save = async () => {
    setWorking(true); setError("");
    try {
      const nodes = proxies.map((proxy) => ({ raw_url: "", node_name: String(proxy.name ?? "未命名节点"), protocol: String(proxy.type ?? "unknown"), parsed_config: JSON.stringify(proxy), clash_config: JSON.stringify(proxy), enabled: true, tag: tag.trim(), tags: tag.trim() ? [tag.trim()] : [] }));
      const response = await api.post<{ nodes: NodeItem[] }>("/api/admin/nodes/batch", { nodes });
      onComplete(response.nodes?.length ?? nodes.length);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "导入失败"); }
    finally { setWorking(false); }
  };
  return <Dialog title="导入节点" description="支持分享链接、Clash YAML 与 Base64 订阅内容" onClose={onClose} wide><div className="form-stack">{error ? <ErrorState message={error} /> : null}{proxies.length === 0 ? <><Field label="节点内容"><textarea autoFocus rows={10} value={content} onChange={(e) => setContent(e.target.value)} placeholder="vmess://...&#10;vless://..." /></Field><div className="form-grid"><Field label="分类标签"><input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="例如：香港" /></Field><div className="field toggle-field"><span className="field-label">TLS 选项</span><Toggle checked={skipCert} onChange={setSkipCert} label="跳过证书校验" /></div></div><div className="dialog-actions"><Button variant="secondary" onClick={onClose}>取消</Button><Button disabled={!content.trim() || working} onClick={() => void parse()}>{working ? <Spinner label="正在解析" /> : <><Clipboard size={16} />解析内容</>}</Button></div></> : <><div className="import-summary"><span className="summary-icon"><Boxes size={21} /></span><span><strong>识别到 {proxies.length} 个节点</strong><small>{proxies.slice(0, 4).map((proxy) => String(proxy.name)).join("、")}{proxies.length > 4 ? " 等" : ""}</small></span></div><div className="preview-list">{proxies.slice(0, 12).map((proxy, index) => <div key={`${String(proxy.name)}-${index}`}><span>{String(proxy.name)}</span><Badge tone="info">{String(proxy.type ?? "unknown")}</Badge></div>)}</div><div className="dialog-actions"><Button variant="secondary" onClick={() => setProxies([])}>返回修改</Button><Button disabled={working} onClick={() => void save()}>{working ? <Spinner label="正在导入" /> : <><Upload size={16} />确认导入</>}</Button></div></>}</div></Dialog>;
}

function UsersPage({ notify }: { notify: (message: string, tone?: ToastState["tone"]) => void }) {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const load = useCallback(async () => { setLoading(true); setError(""); try { setUsers((await api.get<{ users: UserItem[] }>("/api/admin/users")).users ?? []); } catch (reason) { setError(reason instanceof Error ? reason.message : "用户列表加载失败"); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  const filtered = users.filter((user) => [user.username, user.nickname, user.email, user.remark].some((value) => value?.toLowerCase().includes(search.toLowerCase())));
  const setStatus = async (user: UserItem) => {
    if (!confirm(`${user.is_active ? "停用" : "启用"}用户“${user.username}”？`)) return;
    try { await api.post("/api/admin/users/status", { username: user.username, is_active: !user.is_active }); notify(user.is_active ? "用户已停用" : "用户已启用"); await load(); }
    catch (reason) { notify(reason instanceof Error ? reason.message : "操作失败", "error"); }
  };
  return <><PageHeader title="用户管理" description="查看系统用户，调整启用状态并管理访问权限。" actions={<><div className="search-box"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索用户" /></div><Button onClick={() => setShowCreate(true)}><Plus size={17} />新增用户</Button></>} />{error ? <ErrorState message={error} onRetry={() => void load()} /> : null}<Surface className="table-surface">{loading ? <div className="center-state"><Spinner /></div> : filtered.length === 0 ? <EmptyState icon={<Users size={24} />} title={search ? "没有匹配的用户" : "暂无用户"} /> : <div className="table-wrap"><table><thead><tr><th>用户</th><th>套餐</th><th>本期流量</th><th>速率 / 设备</th><th>状态</th><th aria-label="操作" /></tr></thead><tbody>{filtered.map((user) => <tr key={user.username}><td><div className="primary-cell"><span className="user-avatar">{(user.nickname || user.username).slice(0, 1).toUpperCase()}</span><span><strong>{user.nickname || user.username}</strong><small>{user.username}{user.email ? ` · ${user.email}` : ""}</small></span></div></td><td><strong>{user.package_name || "未分配"}</strong><small className="cell-note">{user.package_end_date || "无到期时间"}</small></td><td><strong>{formatBytes(user.traffic_used)}</strong><small className="cell-note">{user.traffic_limit ? `限额 ${formatBytes(user.traffic_limit)}` : "不限额"}</small></td><td><strong>{user.speed_limit_mbps ? `${user.speed_limit_mbps} Mbps` : "不限速"}</strong><small className="cell-note">{user.device_limit ? `${user.device_limit} 台设备` : "设备不限"}</small></td><td><Badge tone={user.is_active ? "good" : "bad"}>{user.is_active ? "启用" : "停用"}</Badge></td><td className="actions-cell">{user.role !== "admin" ? <Button variant="ghost" onClick={() => void setStatus(user)}>{user.is_active ? "停用" : "启用"}</Button> : <Badge tone="info">管理员</Badge>}</td></tr>)}</tbody></table></div>}</Surface>{showCreate ? <CreateUserDialog onClose={() => setShowCreate(false)} onCreated={async () => { setShowCreate(false); notify("用户已创建"); await load(); }} /> : null}</>;
}

function CreateUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ username: "", nickname: "", email: "", password: "", remark: "" });
  const [working, setWorking] = useState(false); const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); setWorking(true); setError(""); try { await api.post("/api/admin/users/create", form); onCreated(); } catch (reason) { setError(reason instanceof Error ? reason.message : "创建失败"); } finally { setWorking(false); } };
  return <Dialog title="创建用户" onClose={onClose}><form onSubmit={submit} className="form-stack">{error ? <ErrorState message={error} /> : null}<div className="form-grid"><Field label="账号"><input required autoFocus value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field><Field label="显示名称"><input required value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} /></Field></div><Field label="邮箱"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field><Field label="初始密码"><input required type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field><Field label="备注"><input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} /></Field><div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={working}>{working ? <Spinner label="正在创建" /> : <><Plus size={16} />创建</>}</Button></div></form></Dialog>;
}

function TrafficPage({ profile }: { profile: Profile }) {
  const [summary, setSummary] = useState<TrafficSummary | null>(null); const [userTraffic, setUserTraffic] = useState<Array<{ username: string; total_uplink: number; total_downlink: number; cycle_uplink: number; cycle_downlink: number }>>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const load = useCallback(async () => { setLoading(true); setError(""); try { const results = await Promise.all([api.get<TrafficSummary>("/api/traffic/summary"), profile.is_admin ? api.get<{ users: typeof userTraffic }>("/api/admin/traffic/users") : Promise.resolve({ users: [] })]); setSummary(results[0]); setUserTraffic(results[1].users ?? []); } catch (reason) { setError(reason instanceof Error ? reason.message : "流量数据加载失败"); } finally { setLoading(false); } }, [profile.is_admin]);
  useEffect(() => { void load(); }, [load]);
  const history = summary?.history ?? []; const max = Math.max(1, ...history.map((item) => item.used_gb));
  return <><PageHeader title="流量明细" description="当前计费周期" actions={<IconButton label="刷新" onClick={() => void load()}><RefreshCw size={18} /></IconButton>} />{error ? <ErrorState message={error} onRetry={() => void load()} /> : null}<div className="metric-grid traffic-metrics"><Metric icon={<Gauge size={18} />} label="已用" value={loading ? "--" : `${summary?.metrics.total_used_gb ?? 0} GB`} detail={`不限额服务器 ${summary?.metrics.unlimited_used_gb ?? 0} GB`} /><Metric icon={<Activity size={18} />} label="剩余" value={loading ? "--" : `${summary?.metrics.total_remaining_gb ?? 0} GB`} detail={`总限额 ${summary?.metrics.total_limit_gb ?? 0} GB`} /><Metric icon={<Gauge size={18} />} label="使用率" value={loading ? "--" : `${summary?.metrics.usage_percentage ?? 0}%`} detail="当前周期" /></div><Surface className="chart-surface traffic-chart"><div className="surface-heading"><div><h2>30 日用量</h2></div></div>{loading ? <div className="center-state"><Spinner /></div> : history.length === 0 ? <EmptyState icon={<Activity size={22} />} title="暂无历史记录" /> : <div className="bar-chart bar-chart-wide">{history.map((item) => <div className="bar-column" key={item.date} title={`${item.date}: ${item.used_gb} GB`}><span className="bar" style={{ height: `${Math.max(3, item.used_gb / max * 100)}%` }} /><small>{item.date.slice(8)}</small></div>)}</div>}</Surface>{profile.is_admin ? <Surface className="table-surface"><div className="surface-heading table-title"><div><h2>用户流量</h2></div></div>{userTraffic.length === 0 ? <EmptyState icon={<Users size={22} />} title="暂无用户流量" /> : <div className="table-wrap"><table><thead><tr><th>用户</th><th>周期上行</th><th>周期下行</th><th>历史总量</th></tr></thead><tbody>{userTraffic.map((item) => <tr key={item.username}><td><strong>{item.username}</strong></td><td>{formatBytes(item.cycle_uplink)}</td><td>{formatBytes(item.cycle_downlink)}</td><td>{formatBytes(item.total_uplink + item.total_downlink)}</td></tr>)}</tbody></table></div>}</Surface> : null}</>;
}

function SettingsPage({ notify }: { notify: (message: string, tone?: ToastState["tone"]) => void }) {
  const [masterURL, setMasterURL] = useState(""); const [interval, setIntervalValue] = useState(1000); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  useEffect(() => { Promise.all([api.get<{ master_url: string }>("/api/admin/system-settings/master-url"), api.get<{ refetch_interval_ms: number }>("/api/system-config/refetch-interval")]).then(([master, refresh]) => { setMasterURL(master.master_url || location.origin); setIntervalValue(refresh.refetch_interval_ms || 1000); }).catch((reason) => setError(reason instanceof Error ? reason.message : "设置加载失败")).finally(() => setLoading(false)); }, []);
  const save = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { await Promise.all([api.put("/api/admin/system-settings/master-url", { master_url: masterURL.trim().replace(/\/$/, "") }), api.put("/api/admin/system-settings/dashboard-refresh", { refetch_interval_ms: interval })]); notify("设置已保存"); } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); } finally { setSaving(false); } };
  return <><PageHeader title="系统设置" description="控制端地址与数据刷新" />{error ? <ErrorState message={error} /> : null}{loading ? <Surface className="center-state"><Spinner /></Surface> : <div className="settings-layout"><form onSubmit={save} className="settings-config-form"><Surface className="settings-section"><div className="settings-heading"><span className="settings-icon"><Network size={19} /></span><div><h2>控制端地址</h2><p>Agent 安装与回连使用的公开地址</p></div></div><Field label="公开 URL"><input type="url" required value={masterURL} onChange={(e) => setMasterURL(e.target.value)} placeholder="https://console.example.com" /></Field></Surface><Surface className="settings-section"><div className="settings-heading"><span className="settings-icon"><RefreshCw size={19} /></span><div><h2>数据刷新</h2><p>控制台使用的数据刷新配置</p></div></div><Field label="刷新间隔"><select value={interval} onChange={(e) => setIntervalValue(Number(e.target.value))}><option value={1000}>1 秒</option><option value={2000}>2 秒</option><option value={5000}>5 秒</option><option value={10000}>10 秒</option><option value={30000}>30 秒</option></select></Field></Surface><div className="settings-submit"><Button type="submit" disabled={saving}>{saving ? <Spinner label="正在保存" /> : <><Check size={16} />保存设置</>}</Button></div></form><TwoFactorSettings notify={notify} /></div>}</>;
}
