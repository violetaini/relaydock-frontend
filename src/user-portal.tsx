import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  Compass,
  Copy,
  ExternalLink,
  HardDrive,
  HelpCircle,
  Layers,
  LayoutGrid,
  Link2,
  List,
  LogOut,
  Moon,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldAlert,
  Sparkles,
  Sun,
  Wrench,
  Zap,
} from "lucide-react";
import QRCode from "qrcode";
import { api } from "./api";
import { BrandMark, useBranding } from "./brand";
import { CountryFlag } from "./country-flag";
import { nextThemeMode, normalizeThemeMode, type ThemeMode } from "./theme";
import type { Profile } from "./types";
import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  Spinner,
  Toast,
  formatBytes,
} from "./ui";
import "./user-portal.css";

interface PortalSummary {
  success: boolean;
  user: {
    username: string;
    nickname: string;
    email: string;
    avatar_url: string;
    role: string;
    is_admin: boolean;
  };
  package: {
    id: number;
    name: string;
    description: string;
    start_date?: string;
    end_date?: string;
    days_remaining: number;
    is_expired: boolean;
    speed_limit_mbps: number;
    device_limit: number;
  };
  traffic: {
    total_limit_bytes: number;
    total_used_bytes: number;
    remaining_bytes: number;
    usage_percentage: number;
    reset_day: number;
    days_until_reset: number;
  };
  nodes: {
    total_count: number;
    online_count: number;
  };
  subscription: {
    token?: string;
    user_short_code?: string;
    custom_short_code?: string;
    short_link_prefix?: string;
  };
}

interface PublicNode {
  id: number;
  name: string;
  protocol: string;
  country_code: string;
  enabled: boolean;
  online: boolean;
  tags: string[];
  link?: string;
}

interface ClientOption {
  type: string;
  name: string;
  tag: string;
  icon: string;
  badge?: string;
  deepLink?: (url: string, brandName: string) => string;
}

const CLIENT_OPTIONS: ClientOption[] = [
  {
    type: "clash",
    name: "Clash / Verge / Mihomo",
    tag: "clash",
    icon: "⚡",
    badge: "推荐",
    deepLink: (url, name) => `clash://install-config?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`,
  },
  {
    type: "sing-box",
    name: "Sing-box",
    tag: "sing-box",
    icon: "📦",
    badge: "原生",
    deepLink: (url, name) => {
      const target = url + (url.includes("?") ? "&t=sing-box" : "?t=sing-box");
      return `sing-box://import-remote-profile?url=${encodeURIComponent(target)}#${encodeURIComponent(name)}`;
    },
  },
  {
    type: "shadowrocket",
    name: "Shadowrocket (小火箭)",
    tag: "shadowrocket",
    icon: "🚀",
    badge: "iOS",
    deepLink: (url, name) => {
      try {
        const target = url + (url.includes("?") ? "&t=shadowrocket" : "?t=shadowrocket");
        return `shadowrocket://add/sub://${btoa(target)}?title=${encodeURIComponent(name)}`;
      } catch {
        return "";
      }
    },
  },
  {
    type: "surge",
    name: "Surge (iOS / macOS)",
    tag: "surge",
    icon: "🌊",
    badge: "iOS/Mac",
    deepLink: (url) => {
      const target = url + (url.includes("?") ? "&t=surge" : "?t=surge");
      return `surge:///install-config?url=${encodeURIComponent(target)}`;
    },
  },
  {
    type: "loon",
    name: "Loon",
    tag: "loon",
    icon: "🎈",
    badge: "iOS",
    deepLink: (url, name) => {
      const target = url + (url.includes("?") ? "&t=loon" : "?t=loon");
      return `loon://import?n=${encodeURIComponent(name)}&url=${encodeURIComponent(target)}`;
    },
  },
  {
    type: "qx",
    name: "Quantumult X",
    tag: "qx",
    icon: "⭕",
    badge: "iOS",
    deepLink: (url, name) => {
      const target = url + (url.includes("?") ? "&t=qx" : "?t=qx");
      return `quantumult-x:///add-resource?remote-resource={"server_remote":["${target}, tag=${name}"]}`;
    },
  },
  {
    type: "stash",
    name: "Stash",
    tag: "stash",
    icon: "📱",
    badge: "iOS/Mac",
    deepLink: (url, name) => `stash://install-config?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`,
  },
  {
    type: "surfboard",
    name: "Surfboard",
    tag: "surfboard",
    icon: "🏄",
    badge: "Android",
  },
  {
    type: "v2ray",
    name: "V2Ray / Base64",
    tag: "v2ray",
    icon: "📡",
  },
  {
    type: "uri",
    name: "URI 原始节点单链",
    tag: "uri",
    icon: "🔗",
  },
];

interface NodeLatency {
  latency: number;
  loading?: boolean;
  error?: string;
}

export function UserPortal({
  profile,
  onLogout,
  onSwitchToConsole,
}: {
  profile: Profile;
  onLogout: () => void;
  onSwitchToConsole?: () => void;
}) {
  const branding = useBranding();
  const [summary, setSummary] = useState<PortalSummary | null>(null);
  const [nodes, setNodes] = useState<PublicNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [activeTab, setActiveTab] = useState<"nodes" | "guides">("nodes");
  const [viewMode, setViewMode] = useState<"card" | "table">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("relaydock-portal-view") as "card" | "table") || "card";
    }
    return "card";
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("ALL");
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [copyDropdownOpen, setCopyDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [latencies, setLatencies] = useState<Record<number, NodeLatency>>({});
  const [batchTesting, setBatchTesting] = useState(false);
  const [copiedFormat, setCopiedFormat] = useState<string | null>(null);

  const [theme, setTheme] = useState<ThemeMode>(() =>
    normalizeThemeMode(typeof window !== "undefined" ? localStorage.getItem("arcway-theme") : null)
  );

  const notify = useCallback((message: string, tone: "success" | "error" = "success") => {
    setToast({ message, tone });
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setCopyDropdownOpen(false);
      }
    };
    if (copyDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [copyDropdownOpen]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [sumRes, nodesRes] = await Promise.all([
        api.get<PortalSummary>("/api/user/portal-summary"),
        api.get<{ success: boolean; nodes: PublicNode[] }>("/api/user/nodes/public").catch(() => ({ success: true, nodes: [] })),
      ]);
      setSummary(sumRes);
      setNodes(nodesRes.nodes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法加载用户门户数据");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const toggleTheme = () => {
    const next = nextThemeMode(theme);
    setTheme(next);
    localStorage.setItem("arcway-theme", next);
    document.documentElement.setAttribute("data-theme", next === "dark" ? "dark" : "light");
  };

  const setView = (mode: "card" | "table") => {
    setViewMode(mode);
    if (typeof window !== "undefined") {
      localStorage.setItem("relaydock-portal-view", mode);
    }
  };

  // Base Subscription URL calculation
  const subUrl = useMemo(() => {
    if (!summary?.subscription) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const shortCode = summary.subscription.custom_short_code || summary.subscription.user_short_code;
    if (shortCode) {
      return `${origin}/x/${shortCode}`;
    }
    if (summary.subscription.token) {
      return `${origin}/api/subscription?token=${summary.subscription.token}`;
    }
    return `${origin}/api/subscription`;
  }, [summary]);

  const getClientUrl = useCallback(
    (tag: string) => {
      if (!subUrl) return "";
      if (tag === "clash") return subUrl;
      const separator = subUrl.includes("?") ? "&" : "?";
      return `${subUrl}${separator}t=${tag}`;
    },
    [subUrl]
  );

  // Generate QR Code
  useEffect(() => {
    if (!qrOpen || !subUrl) return;
    let active = true;
    void QRCode.toDataURL(subUrl, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
      color: { dark: "#0f172a", light: "#ffffff" },
    }).then((url) => {
      if (active) setQrDataUrl(url);
    });
    return () => {
      active = false;
    };
  }, [qrOpen, subUrl]);

  // Copy helper
  const copyText = async (text: string, label: string, formatKey?: string) => {
    try {
      if (!navigator.clipboard) throw new Error("剪贴板不可用");
      await navigator.clipboard.writeText(text);
      notify(`已复制 ${label} 到剪贴板`);
      if (formatKey) {
        setCopiedFormat(formatKey);
        setTimeout(() => setCopiedFormat(null), 2000);
      }
    } catch {
      notify("复制失败，请手动长按或全选复制", "error");
    }
  };

  // Reset Token
  const rotateToken = async () => {
    setRotating(true);
    try {
      await api.post("/api/user/token");
      notify("订阅凭据已安全轮换，请在客户端重新导入新配置");
      setConfirmRotate(false);
      void loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : "凭据轮换失败", "error");
    } finally {
      setRotating(false);
    }
  };

  // Latency test for a single node
  const testSingleNode = async (nodeId: number) => {
    setLatencies((prev) => ({ ...prev, [nodeId]: { latency: 0, loading: true } }));
    try {
      const res = await api.post<{ success: boolean; latency: number; error?: string }>("/api/admin/tcping", {
        node_id: nodeId,
        timeout: 5000,
      });
      if (res.success && res.latency > 0) {
        setLatencies((prev) => ({ ...prev, [nodeId]: { latency: res.latency, loading: false } }));
      } else {
        setLatencies((prev) => ({
          ...prev,
          [nodeId]: { latency: 0, loading: false, error: res.error || "连接超时" },
        }));
      }
    } catch (err) {
      setLatencies((prev) => ({
        ...prev,
        [nodeId]: { latency: 0, loading: false, error: err instanceof Error ? err.message : "测试失败" },
      }));
    }
  };

  // Batch test all nodes
  const testAllNodes = async () => {
    if (batchTesting || nodes.length === 0) return;
    setBatchTesting(true);
    setLatencies((prev) => {
      const next = { ...prev };
      nodes.forEach((n) => {
        next[n.id] = { latency: 0, loading: true };
      });
      return next;
    });

    try {
      const targets = nodes.map((n) => ({ node_id: n.id, timeout: 5000 }));
      const results = await api.post<{ success: boolean; latency: number; error?: string }[]>(
        "/api/admin/tcping/batch",
        targets
      );
      setLatencies((prev) => {
        const next = { ...prev };
        nodes.forEach((n, idx) => {
          const r = results[idx];
          if (r && r.success && r.latency > 0) {
            next[n.id] = { latency: r.latency, loading: false };
          } else {
            next[n.id] = { latency: 0, loading: false, error: r?.error || "超时" };
          }
        });
        return next;
      });
      notify("节点连通性测试完成");
    } catch {
      notify("批量测速失败，已回退为离线测试", "error");
    } finally {
      setBatchTesting(false);
    }
  };

  // Filter nodes
  const filteredNodes = useMemo(() => {
    return nodes.filter((n) => {
      const matchSearch =
        n.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.protocol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.country_code.toLowerCase().includes(searchQuery.toLowerCase());
      const matchRegion = selectedRegion === "ALL" || n.country_code === selectedRegion;
      return matchSearch && matchRegion;
    });
  }, [nodes, searchQuery, selectedRegion]);

  const uniqueRegions = useMemo(() => {
    const set = new Set<string>();
    nodes.forEach((n) => {
      if (n.country_code) set.add(n.country_code);
    });
    return Array.from(set);
  }, [nodes]);

  // Traffic quota values
  const totalLimit = summary?.traffic.total_limit_bytes ?? 0;
  const totalUsed = summary?.traffic.total_used_bytes ?? 0;
  const remaining = totalLimit > 0 ? Math.max(0, totalLimit - totalUsed) : -1;
  const usagePercent = totalLimit > 0 ? Math.min(100, Math.round((totalUsed / totalLimit) * 100)) : 0;
  const isDanger = usagePercent >= 90;
  const isWarning = usagePercent >= 75 && !isDanger;

  return (
    <div className="mmw-portal-root">
      {toast ? (
        <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}

      {/* Top Navbar */}
      <header className="mmw-navbar">
        <div className="mmw-nav-inner">
          <div className="mmw-brand">
            <BrandMark size={28} />
            <div className="mmw-brand-titles">
              <span className="mmw-brand-name">{branding.name || "Chitanda Relay"}</span>
              <span className="mmw-brand-tag">User Portal</span>
            </div>
          </div>

          <div className="mmw-nav-right">
            {profile.is_admin && onSwitchToConsole ? (
              <button type="button" className="mmw-nav-admin-btn" onClick={onSwitchToConsole}>
                <Wrench size={14} />
                <span>管理员后台</span>
              </button>
            ) : null}

            <div className="mmw-user-badge">
              <div className="mmw-user-avatar">
                {(profile.nickname || profile.username || "U").slice(0, 1).toUpperCase()}
              </div>
              <div className="mmw-user-info">
                <span className="mmw-user-name">{profile.nickname || profile.username}</span>
                <span className="mmw-user-role">{profile.is_admin ? "管理员" : "标准会员"}</span>
              </div>
            </div>

            <IconButton
              label={theme === "dark" ? "切换浅色模式" : "切换深色模式"}
              onClick={toggleTheme}
              className="mmw-icon-btn"
            >
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </IconButton>

            <IconButton label="退出登录" onClick={onLogout} className="mmw-icon-btn">
              <LogOut size={17} />
            </IconButton>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mmw-main">
        {error ? <ErrorState message={error} onRetry={() => void loadData()} /> : null}

        {loading && !summary ? (
          <div className="center-state">
            <Spinner label="正在载入门户数据..." />
          </div>
        ) : null}

        {summary ? (
          <>
            {/* 4 Hero Metric Cards (Miaomiaowu X Style) */}
            <section className="mmw-hero-grid">
              {/* Card 1: Total Quota */}
              <div className="mmw-stat-card">
                <div className="mmw-stat-header">
                  <span className="mmw-stat-title">总配额</span>
                  <div className="mmw-stat-icon-wrap quota">
                    <HardDrive size={18} />
                  </div>
                </div>
                <div className="mmw-stat-value">
                  {totalLimit > 0 ? formatBytes(totalLimit) : "无限制"}
                </div>
                <div className="mmw-stat-desc">当期计划周期流量总限额</div>
              </div>

              {/* Card 2: Used Traffic */}
              <div className="mmw-stat-card">
                <div className="mmw-stat-header">
                  <span className="mmw-stat-title">已用流量</span>
                  <div className="mmw-stat-icon-wrap used">
                    <Activity size={18} />
                  </div>
                </div>
                <div className="mmw-stat-value">{formatBytes(totalUsed)}</div>
                <div className="mmw-stat-desc">上传与下载网络累计消耗</div>
              </div>

              {/* Card 3: Remaining Traffic */}
              <div className="mmw-stat-card">
                <div className="mmw-stat-header">
                  <span className="mmw-stat-title">剩余流量</span>
                  <div className="mmw-stat-icon-wrap remaining">
                    <Sparkles size={18} />
                  </div>
                </div>
                <div className="mmw-stat-value">
                  {remaining >= 0 ? formatBytes(remaining) : "不限配额"}
                </div>
                <div className="mmw-stat-desc">本账单周期可用剩余</div>
              </div>

              {/* Card 4: Usage Rate & Reset Cycle */}
              <div className="mmw-stat-card">
                <div className="mmw-stat-header">
                  <span className="mmw-stat-title">使用率与周期</span>
                  <div className="mmw-stat-icon-wrap cycle">
                    <RotateCcw size={18} />
                  </div>
                </div>
                <div className="mmw-stat-value">{usagePercent}%</div>
                <div className="mmw-progress-bar-bg">
                  <div
                    className={`mmw-progress-bar-fill ${
                      isDanger ? "danger" : isWarning ? "warning" : ""
                    }`}
                    style={{ width: `${Math.min(100, Math.max(3, usagePercent))}%` }}
                  />
                </div>
                <div className="mmw-stat-desc">
                  {summary.traffic.reset_day > 0
                    ? `每月 ${summary.traffic.reset_day} 日重置 (剩余 ${summary.traffic.days_until_reset} 天)`
                    : "不定期重置"}
                </div>
              </div>
            </section>

            {/* Plan Info Banner */}
            <section className="mmw-plan-banner">
              <div className="mmw-plan-info">
                <div className="mmw-plan-name-wrap">
                  <span className="mmw-plan-name">{summary.package.name || "全球优质加速套餐"}</span>
                  <span className="mmw-plan-badge">
                    {summary.package.end_date
                      ? summary.package.is_expired
                        ? "已过期"
                        : `剩余 ${summary.package.days_remaining} 天`
                      : "永久有效"}
                  </span>
                </div>
                <p className="mmw-plan-desc">
                  {summary.package.description || "全协议高速代理网络接入，享受低延迟稳定中继"}
                </p>
                <div className="mmw-plan-meta">
                  <span>
                    <Calendar size={13} />
                    到期时间: {summary.package.end_date || "永久有效"}
                  </span>
                  <span>
                    <Server size={13} />
                    可用节点: <strong style={{ color: "var(--color-primary, #38bdf8)" }}>{nodes.length}</strong> 台在线
                  </span>
                  {summary.package.device_limit > 0 ? (
                    <span>
                      <Zap size={13} />
                      设备限制: {summary.package.device_limit} 台
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="mmw-plan-actions">
                <Button variant="secondary" onClick={() => void loadData()} className="mmw-btn-refresh">
                  <RefreshCw size={14} />
                  刷新数据
                </Button>
              </div>
            </section>

            {/* Subscription Center Card (Miaomiaowu X Style) */}
            <section className="mmw-sub-card">
              <div className="mmw-sub-main-row">
                {/* QR Code Action Button */}
                <button
                  type="button"
                  className="mmw-sub-qr-btn"
                  onClick={() => setQrOpen(true)}
                  title="点击查看手机订阅二维码"
                >
                  <QrCode size={22} />
                  <span className="mmw-sub-qr-text">二维码</span>
                </button>

                {/* Center: Address Bar & Quick Copy */}
                <div className="mmw-sub-center">
                  <div className="mmw-sub-head-line">
                    <span className="mmw-sub-title">客户端统一订阅安全链接</span>
                    <span className="mmw-sub-pill">多协议自适应</span>
                  </div>
                  <div
                    className="mmw-sub-url-box"
                    onClick={() => void copyText(subUrl, "通用订阅链接")}
                    title="点击复制订阅链接"
                  >
                    <code>{subUrl || "正在生成订阅地址..."}</code>
                    <div className="mmw-sub-copy-hint">
                      <Copy size={13} />
                      <span>点击复制</span>
                    </div>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="mmw-sub-actions">
                  {/* Dropdown Menu for all client formats */}
                  <div className="mmw-dropdown-wrap" ref={dropdownRef}>
                    <button
                      type="button"
                      className="mmw-dropdown-btn"
                      onClick={() => setCopyDropdownOpen((prev) => !prev)}
                    >
                      <Copy size={14} />
                      <span>复制订阅</span>
                      <ChevronDown size={14} className={copyDropdownOpen ? "rotate" : ""} />
                    </button>

                    {copyDropdownOpen ? (
                      <div className="mmw-dropdown-menu">
                        <div className="mmw-dropdown-header">选择客户端格式复制:</div>
                        {CLIENT_OPTIONS.map((c) => {
                          const clientUrl = getClientUrl(c.tag);
                          const isCopied = copiedFormat === c.tag;
                          return (
                            <button
                              key={c.type}
                              type="button"
                              className="mmw-dropdown-item"
                              onClick={() => {
                                void copyText(clientUrl, `${c.name} 订阅`, c.tag);
                                setCopyDropdownOpen(false);
                              }}
                            >
                              <span className="mmw-client-icon">{c.icon}</span>
                              <span className="mmw-client-name">{c.name}</span>
                              {c.badge ? <span className="mmw-client-badge">{c.badge}</span> : null}
                              {isCopied ? <Check size={14} className="mmw-client-check" /> : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                  {/* Reset Token Security Button */}
                  <button
                    type="button"
                    className="mmw-sub-rotate-btn"
                    onClick={() => setConfirmRotate(true)}
                    title="订阅被泄露时可重置凭据"
                  >
                    <ShieldAlert size={14} />
                    <span>重置密钥</span>
                  </button>
                </div>
              </div>

              {/* Fast 1-Click Import App Badges */}
              <div className="mmw-import-row">
                <span className="mmw-import-label">一键导入客户端:</span>
                <div className="mmw-import-buttons">
                  <a
                    className="mmw-import-chip clash"
                    href={`clash://install-config?url=${encodeURIComponent(subUrl)}&name=${encodeURIComponent(branding.name || "RelayDock")}`}
                  >
                    <span>⚡ Clash / Verge</span>
                    <span className="chip-badge">推荐</span>
                  </a>

                  <a
                    className="mmw-import-chip singbox"
                    href={`sing-box://import-remote-profile?url=${encodeURIComponent(
                      subUrl + (subUrl.includes("?") ? "&t=sing-box" : "?t=sing-box")
                    )}#${encodeURIComponent(branding.name || "RelayDock")}`}
                  >
                    <span>📦 Sing-box</span>
                    <span className="chip-badge">原生</span>
                  </a>

                  <a
                    className="mmw-import-chip shadowrocket"
                    href={
                      CLIENT_OPTIONS.find((c) => c.type === "shadowrocket")?.deepLink?.(
                        subUrl,
                        branding.name || "RelayDock"
                      ) || "#"
                    }
                  >
                    <span>🚀 Shadowrocket</span>
                    <span className="chip-badge">iOS</span>
                  </a>

                  <a
                    className="mmw-import-chip surge"
                    href={`surge:///install-config?url=${encodeURIComponent(
                      subUrl + (subUrl.includes("?") ? "&t=surge" : "?t=surge")
                    )}`}
                  >
                    <span>🌊 Surge</span>
                    <span className="chip-badge">Mac/iOS</span>
                  </a>
                </div>
              </div>
            </section>

            {/* Navigation Tabs */}
            <div className="mmw-tab-nav">
              <button
                type="button"
                className={`mmw-tab-btn ${activeTab === "nodes" ? "active" : ""}`}
                onClick={() => setActiveTab("nodes")}
              >
                <Server size={16} />
                <span>可用节点状态 ({nodes.length})</span>
              </button>
              <button
                type="button"
                className={`mmw-tab-btn ${activeTab === "guides" ? "active" : ""}`}
                onClick={() => setActiveTab("guides")}
              >
                <HelpCircle size={16} />
                <span>客户端配置指南</span>
              </button>
            </div>

            {/* Tab 1: Node Explorer */}
            {activeTab === "nodes" ? (
              <div className="mmw-nodes-container">
                {/* Controls Bar: Search, Regions, View Mode, Batch Ping */}
                <div className="mmw-nodes-controls">
                  {/* Search */}
                  <div className="mmw-search-box">
                    <Search size={15} />
                    <input
                      placeholder="搜索节点、国家或协议..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>

                  {/* Region Filter Chips */}
                  <div className="mmw-region-chips">
                    <button
                      type="button"
                      className={`mmw-region-chip ${selectedRegion === "ALL" ? "active" : ""}`}
                      onClick={() => setSelectedRegion("ALL")}
                    >
                      全部 ({nodes.length})
                    </button>
                    {uniqueRegions.map((region) => (
                      <button
                        key={region}
                        type="button"
                        className={`mmw-region-chip ${selectedRegion === region ? "active" : ""}`}
                        onClick={() => setSelectedRegion(region)}
                      >
                        <CountryFlag countryCode={region} fallbackSize={13} />
                        <span>{region}</span>
                      </button>
                    ))}
                  </div>

                  {/* Right: View Mode Toggle & Batch Speedtest */}
                  <div className="mmw-controls-right">
                    <button
                      type="button"
                      className="mmw-batch-ping-btn"
                      onClick={() => void testAllNodes()}
                      disabled={batchTesting}
                      title="点击对所有节点发起真实连通性测速"
                    >
                      {batchTesting ? <Spinner label="测速中..." /> : <><Zap size={14} /> 一键测速</>}
                    </button>

                    <div className="mmw-view-toggle">
                      <button
                        type="button"
                        className={`mmw-view-toggle-btn ${viewMode === "card" ? "active" : ""}`}
                        onClick={() => setView("card")}
                        title="卡片网格模式"
                      >
                        <LayoutGrid size={15} />
                      </button>
                      <button
                        type="button"
                        className={`mmw-view-toggle-btn ${viewMode === "table" ? "active" : ""}`}
                        onClick={() => setView("table")}
                        title="列表表格模式"
                      >
                        <List size={15} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Nodes Content */}
                {filteredNodes.length === 0 ? (
                  <div className="mmw-empty-card">
                    <EmptyState
                      icon={<Compass size={28} />}
                      title="未找到匹配的节点"
                      description="请尝试调整搜索关键字或筛选条件"
                    />
                  </div>
                ) : viewMode === "card" ? (
                  /* Card Grid View */
                  <div className="mmw-node-grid">
                    {filteredNodes.map((n) => {
                      const lat = latencies[n.id];
                      return (
                        <div key={n.id} className="mmw-node-card">
                          <div className="mmw-node-top">
                            <div className="mmw-node-title-group">
                              <span
                                className={`mmw-node-dot ${n.online ? "online" : "offline"}`}
                                title={n.online ? "在线" : "离线"}
                              />
                              <CountryFlag countryCode={n.country_code} fallbackSize={18} />
                              <span className="mmw-node-name" title={n.name}>
                                {n.name}
                              </span>
                            </div>
                            <span className="mmw-node-proto">{n.protocol.toUpperCase()}</span>
                          </div>

                          <div className="mmw-node-middle">
                            <div className="mmw-node-tags-row">
                              {n.tags.map((t, idx) => (
                                <span key={idx} className="mmw-node-tag-pill">
                                  {t}
                                </span>
                              ))}
                            </div>

                            {/* Latency badge or test button */}
                            <div className="mmw-node-latency-wrap">
                              {lat?.loading ? (
                                <span className="mmw-latency-pill testing">
                                  <Spinner label="" />
                                </span>
                              ) : lat?.latency ? (
                                <span
                                  className={`mmw-latency-pill success ${
                                    lat.latency < 80 ? "fast" : lat.latency < 160 ? "medium" : "normal"
                                  }`}
                                  onClick={() => void testSingleNode(n.id)}
                                  title="点击重新测速"
                                >
                                  ⚡ {lat.latency.toFixed(0)} ms
                                </span>
                              ) : lat?.error ? (
                                <span
                                  className="mmw-latency-pill error"
                                  onClick={() => void testSingleNode(n.id)}
                                  title={lat.error}
                                >
                                  超时重试
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="mmw-latency-pill idle"
                                  onClick={() => void testSingleNode(n.id)}
                                  title="点击测速"
                                >
                                  <Zap size={11} /> 测速
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="mmw-node-footer">
                            {n.link ? (
                              <button
                                type="button"
                                className="mmw-node-copy-btn"
                                onClick={() => void copyText(n.link!, `${n.name} 节点链接`)}
                              >
                                <Copy size={12} />
                                <span>复制单节点链接</span>
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Table View */
                  <div className="mmw-table-wrapper">
                    <table className="mmw-node-table">
                      <thead>
                        <tr>
                          <th style={{ width: "48px" }}>状态</th>
                          <th>节点名称</th>
                          <th style={{ width: "100px" }}>国家/地区</th>
                          <th style={{ width: "90px" }}>协议</th>
                          <th>标签</th>
                          <th style={{ width: "110px" }}>实测延迟</th>
                          <th style={{ width: "120px", textAlign: "right" }}>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredNodes.map((n) => {
                          const lat = latencies[n.id];
                          return (
                            <tr key={n.id}>
                              <td>
                                <span
                                  className={`mmw-node-dot ${n.online ? "online" : "offline"}`}
                                  title={n.online ? "运行中" : "离线"}
                                />
                              </td>
                              <td>
                                <div className="mmw-table-node-name">
                                  <CountryFlag countryCode={n.country_code} fallbackSize={16} />
                                  <span className="name-text">{n.name}</span>
                                </div>
                              </td>
                              <td>
                                <span className="mmw-table-region-text">{n.country_code}</span>
                              </td>
                              <td>
                                <span className="mmw-node-proto">{n.protocol.toUpperCase()}</span>
                              </td>
                              <td>
                                <div className="mmw-node-tags-row">
                                  {n.tags.map((t, idx) => (
                                    <span key={idx} className="mmw-node-tag-pill">
                                      {t}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td>
                                {lat?.loading ? (
                                  <span className="mmw-latency-pill testing">
                                    <Spinner label="" />
                                  </span>
                                ) : lat?.latency ? (
                                  <span
                                    className={`mmw-latency-pill success ${
                                      lat.latency < 80 ? "fast" : lat.latency < 160 ? "medium" : "normal"
                                    }`}
                                    onClick={() => void testSingleNode(n.id)}
                                    title="点击重新测速"
                                  >
                                    ⚡ {lat.latency.toFixed(0)} ms
                                  </span>
                                ) : lat?.error ? (
                                  <span
                                    className="mmw-latency-pill error"
                                    onClick={() => void testSingleNode(n.id)}
                                  >
                                    重试
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className="mmw-latency-pill idle"
                                    onClick={() => void testSingleNode(n.id)}
                                  >
                                    测速
                                  </button>
                                )}
                              </td>
                              <td style={{ textAlign: "right" }}>
                                {n.link ? (
                                  <button
                                    type="button"
                                    className="mmw-table-copy-btn"
                                    onClick={() => void copyText(n.link!, `${n.name} 单节点链接`)}
                                    title="复制单节点配置"
                                  >
                                    <Copy size={13} />
                                    <span>复制链接</span>
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}

            {/* Tab 2: Client Guides */}
            {activeTab === "guides" ? (
              <div className="mmw-guide-grid">
                <div className="mmw-guide-card">
                  <div className="mmw-guide-header">
                    <span className="mmw-guide-os">💻 Windows 使用指南</span>
                    <span className="mmw-guide-rec">推荐</span>
                  </div>
                  <ol className="mmw-guide-steps">
                    <li>
                      下载并安装客户端推荐核心：<strong>Clash Verge Rev</strong> 或 <strong>Mihomo Party</strong>。
                    </li>
                    <li>
                      在上方“订阅服务中心”点击 <strong>“⚡ Clash / Verge”</strong> 一键导入配置。
                    </li>
                    <li>
                      在客户端中选中导入的订阅，打开 <strong>“系统代理” (System Proxy)</strong> 开关即可畅游。
                    </li>
                  </ol>
                </div>

                <div className="mmw-guide-card">
                  <div className="mmw-guide-header">
                    <span className="mmw-guide-os">🍎 macOS 使用指南</span>
                    <span className="mmw-guide-rec">推荐</span>
                  </div>
                  <ol className="mmw-guide-steps">
                    <li>
                      安装 <strong>Clash Verge Rev (macOS 版)</strong> 或 <strong>Sing-box</strong>。
                    </li>
                    <li>
                      点击上方对应客户端的 <strong>“一键导入”</strong> 按钮，浏览器将自动唤起客户端。
                    </li>
                    <li>
                      在代理模式中选择 <strong>“规则 (Rule)”</strong> 并开启系统代理。
                    </li>
                  </ol>
                </div>

                <div className="mmw-guide-card">
                  <div className="mmw-guide-header">
                    <span className="mmw-guide-os">📱 iOS / iPadOS 使用指南</span>
                    <span className="mmw-guide-rec">常用</span>
                  </div>
                  <ol className="mmw-guide-steps">
                    <li>
                      在海外 App Store 下载 <strong>Shadowrocket</strong> (小火箭) 或 <strong>Loon</strong>。
                    </li>
                    <li>
                      打开小火箭，点击右上角 <strong>“+”</strong> 号或直接点击右上角 <strong>扫描上方二维码</strong>。
                    </li>
                    <li>
                      类型选择 <strong>Subscribe</strong>，更新配置后开启顶部连接开关。
                    </li>
                  </ol>
                </div>

                <div className="mmw-guide-card">
                  <div className="mmw-guide-header">
                    <span className="mmw-guide-os">🤖 Android 使用指南</span>
                    <span className="mmw-guide-rec">常用</span>
                  </div>
                  <ol className="mmw-guide-steps">
                    <li>
                      安装 <strong>Clash Meta for Android (CMFA)</strong> 或 <strong>Sing-box</strong>。
                    </li>
                    <li>
                      点击 <strong>“⚡ Clash / Verge”</strong> 一键复制订阅链接并粘贴到配置管理器。
                    </li>
                    <li>
                      在“配置”中勾选本站订阅，返回主界面点击“运行 / 启动”即可生效。
                    </li>
                  </ol>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </main>

      {/* QR Code Dialog Modal */}
      {qrOpen ? (
        <Dialog
          title="手机扫码快速导入"
          description="使用小火箭 (Shadowrocket)、Loon 或相机扫码自动识别订阅"
          onClose={() => setQrOpen(false)}
        >
          <div className="mmw-qr-dialog-body">
            <div className="mmw-qr-canvas-box">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="订阅二维码" className="mmw-qr-image" />
              ) : (
                <Spinner label="正在生成高清二维码..." />
              )}
            </div>

            <div className="mmw-qr-url-box">
              <code>{subUrl}</code>
              <IconButton label="复制完整链接" onClick={() => void copyText(subUrl, "订阅链接")}>
                <Copy size={16} />
              </IconButton>
            </div>
            <p className="mmw-qr-tip">提示：如需指定客户端格式，请在主页复制下拉菜单中选择对应客户端。</p>
          </div>
          <div className="dialog-actions">
            <Button variant="secondary" onClick={() => setQrOpen(false)}>
              完成
            </Button>
          </div>
        </Dialog>
      ) : null}

      {/* Security Confirm Dialog */}
      {confirmRotate ? (
        <ConfirmDialog
          title="确认重置订阅凭据与密钥？"
          description="重置后，历史所有订阅链接与您在客户端中导入的旧配置将立即失效，必须在客户端中重新导入新链接。"
          confirmLabel="确认立即重置"
          working={rotating}
          onCancel={() => setConfirmRotate(false)}
          onConfirm={() => void rotateToken()}
        />
      ) : null}
    </div>
  );
}
