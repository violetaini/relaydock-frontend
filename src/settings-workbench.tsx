import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Bell,
  Check,
  Clipboard,
  Code2,
  Copy,
  Database,
  Eye,
  FileJson,
  Gauge,
  KeyRound,
  Link2,
  LockKeyhole,
  Network,
  Palette,
  RefreshCw,
  Save,
  Send,
  Shield,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { api } from "./api";
import { MmwMigrationDialog } from "./migration-workbench";
import { TwoFactorSettings } from "./two-factor";
import type { RemoteServer, ServerListResponse } from "./types";
import { Button, ConfirmDialog, ErrorState, Field, IconButton, PageHeader, Spinner, Surface, Toggle } from "./ui";
import "./settings-workbench.css";

type Notify = (message: string, tone?: "success" | "error") => void;
type Tab = "general" | "subscription" | "security" | "permissions" | "notifications" | "account";

interface SecuritySettings {
  login_rate_max_attempts: number;
  login_rate_window_minutes: number;
  login_rate_lock_minutes: number;
  brute_force_enabled: boolean;
  brute_force_max_failures: number;
  brute_force_window_minutes: number;
  brute_force_block_minutes: number;
  sub_rate_enabled: boolean;
  sub_rate_limit: number;
  sub_rate_window_minutes: number;
  skip_local_ip: boolean;
  turnstile_site_key: string;
  turnstile_secret_key: string;
}

interface PermissionSettings {
  pages: string[];
  quota_template: number;
  quota_override: number;
  quota_subscribe: number;
  routed_outbound_enabled: boolean;
  quota_routed_outbound: number;
  daily_limit_routed_outbound: number;
}

interface NotificationSettings {
  notify_enabled: boolean;
  telegram_bot_token: string;
  telegram_chat_id: string;
  notify_login: boolean;
  notify_subscribe_fetch: boolean;
  notify_daily_traffic: boolean;
  notify_server_offline: boolean;
  notify_server_online: boolean;
  notify_traffic_threshold: boolean;
  notify_daily_traffic_time: string;
  notify_traffic_threshold_percent: number;
  notify_traffic_threshold_80: boolean;
  notify_over_limit: boolean;
  notify_package_expiring: boolean;
  notify_package_expiring_days: number;
  notify_package_expired: boolean;
  notify_user_registered: boolean;
  notify_telegram_bound: boolean;
  notify_cert_result: boolean;
  notify_agent_long_offline: boolean;
  notify_agent_long_offline_minutes: number;
  notify_device_limit_exceeded: boolean;
  notify_server_tolerance_seconds: number;
}

interface UserSubscriptionConfig {
  force_sync_external: boolean;
  match_rule: "node_name" | "server_port" | "type_server_port";
  sync_scope: "saved_only" | "all";
  keep_node_name: boolean;
  cache_expire_minutes: number;
  sync_traffic: boolean;
  node_name_filter: string;
  append_sub_info: boolean;
  custom_rules_enabled: boolean;
  enable_short_link: boolean;
  use_new_template_system: boolean;
  enable_proxy_provider: boolean;
  node_order?: number[];
  proxy_groups_source_url: string;
  client_compatibility_mode: boolean;
}

const defaultSecurity: SecuritySettings = {
  login_rate_max_attempts: 5,
  login_rate_window_minutes: 60,
  login_rate_lock_minutes: 60,
  brute_force_enabled: true,
  brute_force_max_failures: 5,
  brute_force_window_minutes: 1440,
  brute_force_block_minutes: 1440,
  sub_rate_enabled: true,
  sub_rate_limit: 60,
  sub_rate_window_minutes: 1,
  skip_local_ip: true,
  turnstile_site_key: "",
  turnstile_secret_key: "",
};

const defaultPermissions: PermissionSettings = {
  pages: [], quota_template: 0, quota_override: 0, quota_subscribe: 0,
  routed_outbound_enabled: false, quota_routed_outbound: 2, daily_limit_routed_outbound: 5,
};

const defaultNotify: NotificationSettings = {
  notify_enabled: false, telegram_bot_token: "", telegram_chat_id: "", notify_login: false,
  notify_subscribe_fetch: false, notify_daily_traffic: false, notify_server_offline: true,
  notify_server_online: true, notify_traffic_threshold: false, notify_daily_traffic_time: "09:00",
  notify_traffic_threshold_percent: 90, notify_traffic_threshold_80: false, notify_over_limit: true,
  notify_package_expiring: true, notify_package_expiring_days: 3, notify_package_expired: true,
  notify_user_registered: false, notify_telegram_bound: false, notify_cert_result: true,
  notify_agent_long_offline: true, notify_agent_long_offline_minutes: 10,
  notify_device_limit_exceeded: true, notify_server_tolerance_seconds: 60,
};

const defaultUserSubscription: UserSubscriptionConfig = {
  force_sync_external: false,
  match_rule: "node_name",
  sync_scope: "saved_only",
  keep_node_name: true,
  cache_expire_minutes: 0,
  sync_traffic: false,
  node_name_filter: "剩余|流量|到期|订阅|时间|重置",
  append_sub_info: false,
  custom_rules_enabled: true,
  enable_short_link: false,
  use_new_template_system: true,
  enable_proxy_provider: false,
  proxy_groups_source_url: "",
  client_compatibility_mode: false,
};

function userSubscriptionPayload(config: UserSubscriptionConfig) {
  return {
    force_sync_external: config.force_sync_external,
    match_rule: config.match_rule,
    sync_scope: config.sync_scope,
    keep_node_name: config.keep_node_name,
    cache_expire_minutes: config.cache_expire_minutes,
    sync_traffic: config.sync_traffic,
    node_name_filter: config.node_name_filter,
    append_sub_info: config.append_sub_info,
    custom_rules_enabled: config.custom_rules_enabled,
    enable_short_link: config.enable_short_link,
    use_new_template_system: config.use_new_template_system,
    enable_proxy_provider: config.enable_proxy_provider,
    proxy_groups_source_url: config.proxy_groups_source_url.trim(),
    client_compatibility_mode: config.client_compatibility_mode,
  };
}

function messageOf(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

export function SettingsWorkbenchPage({ notify }: { notify: Notify }) {
  const [tab, setTab] = useState<Tab>("general");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [masterURL, setMasterURL] = useState("");
  const [theme, setTheme] = useState("flat");
  const [wallpaper, setWallpaper] = useState("");
  const [intervals, setIntervals] = useState({ speed_collect_interval: 3, traffic_collect_interval: 60, traffic_check_interval: 120, heartbeat_interval: 30, report_interval: 5 });
  const [dashboardRefreshMs, setDashboardRefreshMs] = useState(5000);
  const [probe, setProbe] = useState({ enabled: false, title: "", server_ids: [] as number[], show_name: false });
  const [servers, setServers] = useState<RemoteServer[]>([]);
  const [shortLink, setShortLink] = useState(true);
  const [prefix, setPrefix] = useState({ enabled: false, left: "「", right: "」" });
  const [overrideScripts, setOverrideScripts] = useState(false);
  const [outputFormat, setOutputFormat] = useState<"yaml" | "json">("yaml");
  const [silent, setSilent] = useState({ silent_mode: false, silent_mode_timeout: 15 });
  const [features, setFeatures] = useState(true);
  const [shortCompat, setShortCompat] = useState(false);
  const [agentLog, setAgentLog] = useState(false);
  const [defaultTemplate, setDefaultTemplate] = useState("");
  const [templates, setTemplates] = useState<string[]>([]);
  const [redeemTemplate, setRedeemTemplate] = useState("");
  const [security, setSecurity] = useState<SecuritySettings>(defaultSecurity);
  const [requireEncryption, setRequireEncryption] = useState(false);
  const [permissions, setPermissions] = useState<PermissionSettings>(defaultPermissions);
  const [notifications, setNotifications] = useState<NotificationSettings>(defaultNotify);
  const [userSubscription, setUserSubscription] = useState<UserSubscriptionConfig>(defaultUserSubscription);
  const [apiToken, setApiToken] = useState("");
  const [confirmTokenReset, setConfirmTokenReset] = useState(false);
  const [showMigration, setShowMigration] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setLoaded(false); setError("");
    try {
      const [master, themeData, wall, intervalData, refreshData, probeData, serverData, shortData, prefixData, overrideData, formatData, silentData, featureData, compatData, logData, templateData, defaultTemplateData, redeemData, secData, encryptData, permissionData, notifyData, tokenData, userSubscriptionData] = await Promise.all([
        api.get<{ master_url: string }>("/api/admin/system-settings/master-url"),
        api.get<{ default_theme: string }>("/api/admin/system-settings/default-theme"),
        api.get<{ login_wallpaper: string }>("/api/admin/system-settings/login-wallpaper"),
        api.get<typeof intervals>("/api/admin/system-settings/intervals"),
        api.get<{ refetch_interval_ms: number }>("/api/system-config/refetch-interval"),
        api.get<typeof probe>("/api/admin/system-settings/probe-disguise"),
        api.get<ServerListResponse>("/api/admin/remote-servers"),
        api.get<{ enable_short_link: boolean }>("/api/admin/system-settings/short-link"),
        api.get<typeof prefix>("/api/admin/system-settings/node-name-multiplier-prefix"),
        api.get<{ enable_override_scripts: boolean }>("/api/admin/system-settings/override-scripts"),
        api.get<{ subscription_output_format: string }>("/api/admin/system-settings/subscription-output-format"),
        api.get<typeof silent>("/api/admin/system-settings/silent-mode"),
        api.get<{ enable_miaomiaowu_features: boolean }>("/api/admin/system-settings/miaomiaowu-features"),
        api.get<{ enable_mmw_short_link_compat: boolean }>("/api/admin/system-settings/mmw-short-link-compat"),
        api.get<{ agent_log_enabled: boolean }>("/api/admin/system-settings/agent-log"),
        api.get<{ templates?: string[] }>("/api/admin/rule-templates"),
        api.get<{ default_template_filename: string }>("/api/admin/system-settings/default-template"),
        api.get<{ redeem_template: string }>("/api/admin/system-settings/redeem-template"),
        api.get<SecuritySettings>("/api/admin/security-settings"),
        api.get<{ require_encryption: boolean }>("/api/admin/system-settings/require-encryption"),
        api.get<{ config: PermissionSettings }>("/api/admin/system-settings/user-permissions"),
        api.get<NotificationSettings>("/api/admin/notify-config"),
        api.get<{ token: string }>("/api/admin/system-settings/api-token"),
        api.get<UserSubscriptionConfig>("/api/user/config"),
      ]);
      setMasterURL(master.master_url || location.origin); setTheme(themeData.default_theme); setWallpaper(wall.login_wallpaper);
      setIntervals(intervalData); setDashboardRefreshMs(refreshData.refetch_interval_ms); setProbe(probeData); setServers(serverData.servers ?? []); setShortLink(shortData.enable_short_link);
      setPrefix(prefixData); setOverrideScripts(overrideData.enable_override_scripts); setOutputFormat(formatData.subscription_output_format === "json" ? "json" : "yaml");
      setSilent(silentData); setFeatures(featureData.enable_miaomiaowu_features); setShortCompat(compatData.enable_mmw_short_link_compat); setAgentLog(logData.agent_log_enabled);
      setTemplates(templateData.templates ?? []); setDefaultTemplate(defaultTemplateData.default_template_filename); setRedeemTemplate(redeemData.redeem_template);
      setSecurity(secData); setRequireEncryption(encryptData.require_encryption); setPermissions(permissionData.config); setNotifications(notifyData); setApiToken(tokenData.token); setUserSubscription(userSubscriptionData);
      setLoaded(true);
    } catch (reason) { setError(messageOf(reason, "设置加载失败")); } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async (key: string, operation: () => Promise<unknown>, message: string) => {
    setSaving(key); setError("");
    try { await operation(); notify(message); }
    catch (reason) { const text = messageOf(reason, "保存失败"); setError(text); notify(text, "error"); }
    finally { setSaving(""); }
  };

  const saveGeneral = (event: FormEvent) => {
    event.preventDefault();
    void save("general", async () => {
      const normalizedRefreshMs = Number.isFinite(dashboardRefreshMs) ? Math.min(60000, Math.max(1000, dashboardRefreshMs)) : 5000;
      const reportInterval = Math.round(normalizedRefreshMs / 1000);
      await Promise.all([
        api.put("/api/admin/system-settings/master-url", { master_url: masterURL.trim().replace(/\/$/, "") }),
        api.put("/api/admin/system-settings/default-theme", { default_theme: theme }),
        api.put("/api/admin/system-settings/login-wallpaper", { login_wallpaper: wallpaper.trim() }),
        api.put("/api/admin/system-settings/intervals", { ...intervals, report_interval: reportInterval }),
        api.put("/api/admin/system-settings/probe-disguise", probe),
      ]);
      await api.put("/api/admin/system-settings/dashboard-refresh", { refetch_interval_ms: normalizedRefreshMs });
      document.documentElement.dataset.styleTheme = theme;
    }, "基础设置已保存");
  };

  const saveSubscription = (event: FormEvent) => {
    event.preventDefault();
    void save("subscription", () => Promise.all([
      api.put("/api/admin/system-settings/short-link", { enable_short_link: shortLink }),
      api.put("/api/admin/system-settings/node-name-multiplier-prefix", prefix),
      api.put("/api/admin/system-settings/override-scripts", { enable_override_scripts: overrideScripts }),
      api.put("/api/admin/system-settings/subscription-output-format", { subscription_output_format: outputFormat }),
      api.put("/api/admin/system-settings/silent-mode", silent),
      api.put("/api/admin/system-settings/miaomiaowu-features", { enable_miaomiaowu_features: features }),
      api.put("/api/admin/system-settings/mmw-short-link-compat", { enable_mmw_short_link_compat: shortCompat }),
      api.put("/api/admin/system-settings/agent-log", { agent_log_enabled: agentLog }),
      api.put("/api/admin/system-settings/default-template", { default_template_filename: defaultTemplate }),
      api.put("/api/admin/system-settings/redeem-template", { redeem_template: redeemTemplate }),
      api.put("/api/user/config", userSubscriptionPayload(userSubscription)),
    ]), "订阅与功能设置已保存");
  };

  const saveSecurity = (event: FormEvent) => {
    event.preventDefault();
    void save("security", async () => {
      await api.put("/api/admin/security-settings", security);
      await api.put("/api/admin/system-settings/require-encryption", { require_encryption: requireEncryption });
    }, "安全策略已热更新");
  };

  const savePermissions = (event: FormEvent) => {
    event.preventDefault();
    void save("permissions", () => api.put("/api/admin/system-settings/user-permissions", permissions), "普通用户权限已更新");
  };

  const saveNotifications = (event: FormEvent) => {
    event.preventDefault();
    void save("notifications", () => api.put("/api/admin/notify-config", notifications), "通知设置已保存");
  };

  const regenerateToken = async () => {
    setConfirmTokenReset(false);
    await save("token", async () => { const response = await api.post<{ token: string }>("/api/admin/system-settings/api-token/regenerate"); setApiToken(response.token); }, "API Token 已重新生成");
  };

  const tabs: Array<[Tab, ReactNode, string]> = [
    ["general", <SlidersHorizontal size={17} />, "基础"], ["subscription", <Link2 size={17} />, "订阅"],
    ["security", <Shield size={17} />, "安全"], ["permissions", <Users size={17} />, "用户权限"],
    ["notifications", <Bell size={17} />, "通知"], ["account", <KeyRound size={17} />, "账户与 API"],
  ];

  return <>
    <PageHeader title="系统设置" description="控制端、订阅、安全、权限与通知策略" actions={<IconButton label="重新加载设置" onClick={() => void load()} disabled={loading}><RefreshCw size={18} /></IconButton>} />
    <div className="advanced-tabs settings-tabs" role="tablist">{tabs.map(([key, icon, label]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "is-active" : ""} onClick={() => setTab(key)}>{icon}{label}</button>)}</div>
    {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
    {loading ? <Surface className="center-state"><Spinner label="正在加载全部设置" /></Surface> : loaded ? <>
      {tab === "general" ? <form className="settings-workbench" onSubmit={saveGeneral}>
        <SettingSection icon={<Network size={19} />} title="控制端与采集" description="Agent 回连地址及运行间隔">
          <Field label="公开 URL"><input type="url" required value={masterURL} onChange={(e) => setMasterURL(e.target.value)} /></Field>
          <div className="settings-fields-grid"><Field label="速度采集（秒）"><input type="number" min="1" value={intervals.speed_collect_interval} onChange={(e) => setIntervals({ ...intervals, speed_collect_interval: Number(e.target.value) })} /></Field><Field label="流量采集（秒）"><input type="number" min="10" value={intervals.traffic_collect_interval} onChange={(e) => setIntervals({ ...intervals, traffic_collect_interval: Number(e.target.value) })} /></Field><Field label="流量检查（秒）"><input type="number" min="10" value={intervals.traffic_check_interval} onChange={(e) => setIntervals({ ...intervals, traffic_check_interval: Number(e.target.value) })} /></Field><Field label="心跳（秒）"><input type="number" min="5" value={intervals.heartbeat_interval} onChange={(e) => setIntervals({ ...intervals, heartbeat_interval: Number(e.target.value) })} /></Field><Field label="看板刷新 / Agent 上报（秒）"><input type="number" min="1" max="60" value={dashboardRefreshMs / 1000} onChange={(e) => setDashboardRefreshMs(Number(e.target.value) * 1000)} /></Field></div>
        </SettingSection>
        <SettingSection icon={<Palette size={19} />} title="界面外观" description="新会话的默认主题与登录背景">
          <Field label="默认主题"><select value={theme} onChange={(e) => setTheme(e.target.value)}><option value="flat">扁平</option><option value="pixel">像素</option><option value="anime">动漫</option></select></Field>
          <Field label="登录页壁纸 URL" hint="留空使用内置背景"><input type="url" value={wallpaper} onChange={(e) => setWallpaper(e.target.value)} placeholder="https://..." /></Field>
        </SettingSection>
        <SettingSection icon={<Eye size={19} />} title="探针伪装" description="公开探针页面仅暴露选定服务器状态">
          <Toggle checked={probe.enabled} onChange={(enabled) => setProbe({ ...probe, enabled })} label="启用公开探针伪装" />
          <Toggle checked={probe.show_name} onChange={(show_name) => setProbe({ ...probe, show_name })} label="显示服务器名称" />
          <Field label="页面标题"><input value={probe.title} onChange={(e) => setProbe({ ...probe, title: e.target.value })} /></Field>
          <div className="settings-check-list">{servers.map((server) => <label className="checkbox-row" key={server.id}><input type="checkbox" checked={probe.server_ids.includes(server.id)} onChange={() => setProbe({ ...probe, server_ids: probe.server_ids.includes(server.id) ? probe.server_ids.filter((id) => id !== server.id) : [...probe.server_ids, server.id] })} /><span>{server.name}</span></label>)}</div>
        </SettingSection>
        <SaveRow saving={saving === "general"} />
      </form> : null}

      {tab === "subscription" ? <form className="settings-workbench" onSubmit={saveSubscription}>
        <SettingSection icon={<Link2 size={19} />} title="订阅链接" description="链接格式、短码与节点名称">
          <Toggle checked={shortLink} onChange={setShortLink} label="启用短链接" /><Toggle checked={shortCompat} onChange={setShortCompat} label="兼容根路径短码" /><Toggle checked={prefix.enabled} onChange={(enabled) => setPrefix({ ...prefix, enabled })} label="节点名显示流量倍率" />
          <div className="settings-fields-grid"><Field label="倍率左分隔符"><input maxLength={4} value={prefix.left} onChange={(e) => setPrefix({ ...prefix, left: e.target.value })} /></Field><Field label="倍率右分隔符"><input maxLength={4} value={prefix.right} onChange={(e) => setPrefix({ ...prefix, right: e.target.value })} /></Field></div>
          <Field label="订阅序列化"><select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value as "yaml" | "json")}><option value="yaml">YAML</option><option value="json">JSON</option></select></Field>
        </SettingSection>
        <SettingSection icon={<Code2 size={19} />} title="生成能力" description="模板、覆写与兼容能力">
          <Toggle checked={features} onChange={setFeatures} label="启用高级订阅功能" /><Toggle checked={overrideScripts} onChange={setOverrideScripts} label="允许覆写脚本" /><Toggle checked={agentLog} onChange={setAgentLog} label="记录 Agent 调试日志" />
          <Field label="默认规则模板"><select value={defaultTemplate} onChange={(e) => setDefaultTemplate(e.target.value)}><option value="">系统默认</option>{templates.map((name) => <option key={name} value={name}>{name}</option>)}</select></Field>
        </SettingSection>
        <SettingSection icon={<Database size={19} />} title="妙妙屋数据迁移" description="从旧面板导入用户、节点、订阅、模板和覆写">
          <Button type="button" variant="secondary" onClick={() => setShowMigration(true)}><Database size={16} />打开迁移向导</Button>
        </SettingSection>
        <SettingSection icon={<RefreshCw size={19} />} title="外部订阅同步" description="节点匹配、缓存与流量同步策略">
          <Toggle checked={userSubscription.force_sync_external} onChange={(force_sync_external) => setUserSubscription({ ...userSubscription, force_sync_external })} label="订阅访问时强制同步外部订阅" />
          <Toggle checked={userSubscription.keep_node_name} onChange={(keep_node_name) => setUserSubscription({ ...userSubscription, keep_node_name })} label="同步时保留现有节点名称" />
          <Toggle checked={userSubscription.sync_traffic} onChange={(sync_traffic) => setUserSubscription({ ...userSubscription, sync_traffic })} label="同步外部订阅流量信息" />
          <Toggle checked={userSubscription.append_sub_info} onChange={(append_sub_info) => setUserSubscription({ ...userSubscription, append_sub_info })} label="节点名称附加剩余流量与到期信息" />
          <div className="settings-fields-grid">
            <Field label="节点匹配规则"><select value={userSubscription.match_rule} onChange={(e) => setUserSubscription({ ...userSubscription, match_rule: e.target.value as UserSubscriptionConfig["match_rule"] })}><option value="node_name">节点名称</option><option value="server_port">服务器 + 端口</option><option value="type_server_port">协议 + 服务器 + 端口</option></select></Field>
            <Field label="同步范围"><select value={userSubscription.sync_scope} onChange={(e) => setUserSubscription({ ...userSubscription, sync_scope: e.target.value as UserSubscriptionConfig["sync_scope"] })}><option value="saved_only">仅已保存订阅</option><option value="all">全部外部订阅</option></select></Field>
            <NumberField label="缓存有效期（分钟）" min={0} value={userSubscription.cache_expire_minutes} onChange={(cache_expire_minutes) => setUserSubscription({ ...userSubscription, cache_expire_minutes })} />
          </div>
          <Field label="节点名称过滤表达式"><input value={userSubscription.node_name_filter} onChange={(e) => setUserSubscription({ ...userSubscription, node_name_filter: e.target.value })} /></Field>
        </SettingSection>
        <SettingSection icon={<FileJson size={19} />} title="高级订阅输出" description="模板系统、代理集合与客户端兼容策略">
          <Toggle checked={userSubscription.use_new_template_system} onChange={(use_new_template_system) => setUserSubscription({ ...userSubscription, use_new_template_system })} label="使用新版模板系统" />
          <Toggle checked={userSubscription.enable_proxy_provider} onChange={(enable_proxy_provider) => setUserSubscription({ ...userSubscription, enable_proxy_provider })} label="启用 Proxy Provider 输出" />
          <Toggle checked={userSubscription.client_compatibility_mode} onChange={(client_compatibility_mode) => setUserSubscription({ ...userSubscription, client_compatibility_mode })} label="自动过滤客户端不兼容节点" />
          <Field label="代理组来源 URL" hint="留空使用系统默认"><input type="url" value={userSubscription.proxy_groups_source_url} onChange={(e) => setUserSubscription({ ...userSubscription, proxy_groups_source_url: e.target.value })} placeholder="https://..." /></Field>
        </SettingSection>
        <SettingSection icon={<Gauge size={19} />} title="静默模式" description="短时间合并重复的订阅事件">
          <Toggle checked={silent.silent_mode} onChange={(silent_mode) => setSilent({ ...silent, silent_mode })} label="启用静默模式" /><Field label="静默超时（秒）"><input type="number" min="1" value={silent.silent_mode_timeout} onChange={(e) => setSilent({ ...silent, silent_mode_timeout: Number(e.target.value) })} /></Field>
        </SettingSection>
        <SettingSection icon={<Clipboard size={19} />} title="兑换码文案" description="支持 {兑换码}、{机器人地址}、{主控域名} 占位符"><Field label="复制模板"><textarea value={redeemTemplate} onChange={(e) => setRedeemTemplate(e.target.value)} /></Field></SettingSection>
        <SaveRow saving={saving === "subscription"} />
      </form> : null}

      {tab === "security" ? <form className="settings-workbench" onSubmit={saveSecurity}>
        <SettingSection icon={<LockKeyhole size={19} />} title="登录限流" description="连续失败后锁定来源地址"><div className="settings-fields-grid"><NumberField label="最大尝试" value={security.login_rate_max_attempts} onChange={(value) => setSecurity({ ...security, login_rate_max_attempts: value })} /><NumberField label="统计窗口（分钟）" value={security.login_rate_window_minutes} onChange={(value) => setSecurity({ ...security, login_rate_window_minutes: value })} /><NumberField label="锁定（分钟）" value={security.login_rate_lock_minutes} onChange={(value) => setSecurity({ ...security, login_rate_lock_minutes: value })} /></div><Toggle checked={security.skip_local_ip} onChange={(skip_local_ip) => setSecurity({ ...security, skip_local_ip })} label="跳过本地与私有地址" /></SettingSection>
        <SettingSection icon={<Shield size={19} />} title="暴力与订阅防护" description="策略保存后无需重启即可生效"><Toggle checked={security.brute_force_enabled} onChange={(brute_force_enabled) => setSecurity({ ...security, brute_force_enabled })} label="启用暴力枚举防护" /><div className="settings-fields-grid"><NumberField label="失败阈值" value={security.brute_force_max_failures} onChange={(value) => setSecurity({ ...security, brute_force_max_failures: value })} /><NumberField label="检测窗口（分钟）" value={security.brute_force_window_minutes} onChange={(value) => setSecurity({ ...security, brute_force_window_minutes: value })} /><NumberField label="封禁（分钟）" value={security.brute_force_block_minutes} onChange={(value) => setSecurity({ ...security, brute_force_block_minutes: value })} /></div><Toggle checked={security.sub_rate_enabled} onChange={(sub_rate_enabled) => setSecurity({ ...security, sub_rate_enabled })} label="限制订阅请求频率" /><div className="settings-fields-grid"><NumberField label="请求上限" value={security.sub_rate_limit} onChange={(value) => setSecurity({ ...security, sub_rate_limit: value })} /><NumberField label="窗口（分钟）" value={security.sub_rate_window_minutes} onChange={(value) => setSecurity({ ...security, sub_rate_window_minutes: value })} /></div></SettingSection>
        <SettingSection icon={<Check size={19} />} title="Turnstile" description="两项都填写才会在登录页启用"><Field label="Site Key"><input autoComplete="off" value={security.turnstile_site_key} onChange={(e) => setSecurity({ ...security, turnstile_site_key: e.target.value })} /></Field><Field label="Secret Key" hint="已配置时显示掩码；不修改可原样保存"><input type="password" autoComplete="new-password" value={security.turnstile_secret_key} onChange={(e) => setSecurity({ ...security, turnstile_secret_key: e.target.value })} /></Field></SettingSection>
        <SettingSection icon={<Network size={19} />} title="Agent 通道" description="要求已配对 Agent 使用加密通道"><Toggle checked={requireEncryption} onChange={setRequireEncryption} label="强制 Agent 管理通信加密" /></SettingSection>
        <SaveRow saving={saving === "security"} />
      </form> : null}

      {tab === "permissions" ? <form className="settings-workbench" onSubmit={savePermissions}>
        <SettingSection icon={<Users size={19} />} title="普通用户页面" description="管理员始终拥有全部页面"><div className="settings-check-list permission-pages">{[["subscription", "订阅链接"], ["generator", "生成订阅"], ["nodes", "节点管理"], ["templates", "模板管理"], ["subscribe-files", "订阅管理"], ["custom-rules", "覆写管理"]].map(([key, label]) => <label className="checkbox-row" key={key}><input type="checkbox" checked={permissions.pages.includes(key)} onChange={() => setPermissions({ ...permissions, pages: permissions.pages.includes(key) ? permissions.pages.filter((page) => page !== key) : [...permissions.pages, key] })} /><span>{label}</span></label>)}</div></SettingSection>
        <SettingSection icon={<FileJson size={19} />} title="资源配额" description="0 表示不限数量"><div className="settings-fields-grid"><NumberField label="模板数量" min={0} value={permissions.quota_template} onChange={(value) => setPermissions({ ...permissions, quota_template: value })} /><NumberField label="覆写数量" min={0} value={permissions.quota_override} onChange={(value) => setPermissions({ ...permissions, quota_override: value })} /><NumberField label="订阅数量" min={0} value={permissions.quota_subscribe} onChange={(value) => setPermissions({ ...permissions, quota_subscribe: value })} /></div></SettingSection>
        <SettingSection icon={<Network size={19} />} title="私有路由出站" description="每次操作都会让对应 Agent 重载 Xray"><Toggle checked={permissions.routed_outbound_enabled} onChange={(routed_outbound_enabled) => setPermissions({ ...permissions, routed_outbound_enabled })} label="允许普通用户创建路由出站" /><div className="settings-fields-grid"><NumberField label="每用户数量" min={1} value={permissions.quota_routed_outbound} onChange={(value) => setPermissions({ ...permissions, quota_routed_outbound: value })} /><NumberField label="每日操作次数" min={1} value={permissions.daily_limit_routed_outbound} onChange={(value) => setPermissions({ ...permissions, daily_limit_routed_outbound: value })} /></div></SettingSection>
        <SaveRow saving={saving === "permissions"} />
      </form> : null}

      {tab === "notifications" ? <form className="settings-workbench" onSubmit={saveNotifications}>
        <SettingSection icon={<Send size={19} />} title="Telegram" description="Bot Token 只写入，重新加载后以掩码显示"><Toggle checked={notifications.notify_enabled} onChange={(notify_enabled) => setNotifications({ ...notifications, notify_enabled })} label="启用 Telegram 通知" /><Field label="Bot Token"><input type="password" autoComplete="new-password" value={notifications.telegram_bot_token} onChange={(e) => setNotifications({ ...notifications, telegram_bot_token: e.target.value })} /></Field><Field label="Chat ID"><input value={notifications.telegram_chat_id} onChange={(e) => setNotifications({ ...notifications, telegram_chat_id: e.target.value })} /></Field><Button type="button" variant="secondary" onClick={() => void save("notify-test", () => api.post("/api/admin/notify-config/test"), "测试通知已发送")} disabled={saving === "notify-test"}>{saving === "notify-test" ? <Spinner label="正在发送" /> : <><Send size={16} />发送测试</>}</Button></SettingSection>
        <SettingSection icon={<Bell size={19} />} title="事件通知" description="选择需要推送的管理事件"><div className="settings-check-list event-grid">{[["notify_login", "用户登录"], ["notify_subscribe_fetch", "订阅拉取"], ["notify_server_offline", "服务器离线"], ["notify_server_online", "服务器恢复"], ["notify_over_limit", "流量超限"], ["notify_package_expiring", "套餐即将到期"], ["notify_package_expired", "套餐已到期"], ["notify_user_registered", "用户注册"], ["notify_telegram_bound", "Telegram 绑定"], ["notify_cert_result", "证书操作"], ["notify_agent_long_offline", "Agent 长时离线"], ["notify_device_limit_exceeded", "设备数超限"]].map(([key, label]) => <label className="checkbox-row" key={key}><input type="checkbox" checked={Boolean(notifications[key as keyof NotificationSettings])} onChange={(e) => setNotifications({ ...notifications, [key]: e.target.checked })} /><span>{label}</span></label>)}</div></SettingSection>
        <SettingSection icon={<Gauge size={19} />} title="阈值与日报" description="通知触发条件"><Toggle checked={notifications.notify_daily_traffic} onChange={(notify_daily_traffic) => setNotifications({ ...notifications, notify_daily_traffic })} label="发送每日流量摘要" /><Toggle checked={notifications.notify_traffic_threshold} onChange={(notify_traffic_threshold) => setNotifications({ ...notifications, notify_traffic_threshold })} label="启用自定义流量阈值" /><div className="settings-fields-grid"><Field label="日报时间"><input type="time" value={notifications.notify_daily_traffic_time} onChange={(e) => setNotifications({ ...notifications, notify_daily_traffic_time: e.target.value })} /></Field><NumberField label="流量阈值（%）" min={1} max={100} value={notifications.notify_traffic_threshold_percent} onChange={(value) => setNotifications({ ...notifications, notify_traffic_threshold_percent: value })} /><NumberField label="到期提前（天）" min={1} max={365} value={notifications.notify_package_expiring_days} onChange={(value) => setNotifications({ ...notifications, notify_package_expiring_days: value })} /><NumberField label="Agent 离线（分钟）" min={1} max={1440} value={notifications.notify_agent_long_offline_minutes} onChange={(value) => setNotifications({ ...notifications, notify_agent_long_offline_minutes: value })} /><NumberField label="上下线容忍（秒）" min={0} value={notifications.notify_server_tolerance_seconds} onChange={(value) => setNotifications({ ...notifications, notify_server_tolerance_seconds: value })} /></div></SettingSection>
        <SaveRow saving={saving === "notifications"} />
      </form> : null}

      {tab === "account" ? <div className="settings-workbench">
        <SettingSection icon={<KeyRound size={19} />} title="管理 API Token" description="用于可信自动化调用；重新生成后旧 Token 立即失效"><div className="api-token-row"><code>{apiToken || "尚未生成"}</code><IconButton label="复制 API Token" disabled={!apiToken} onClick={() => void navigator.clipboard.writeText(apiToken).then(() => notify("API Token 已复制"))}><Copy size={16} /></IconButton></div><Button type="button" variant="danger" onClick={() => setConfirmTokenReset(true)}>重新生成 Token</Button></SettingSection>
        <TwoFactorSettings notify={notify} />
      </div> : null}
    </> : null}
    {confirmTokenReset ? <ConfirmDialog title="重新生成 API Token" description="所有使用当前 Token 的脚本和集成都会立即失效，需要逐一替换。" confirmLabel="确认重新生成" working={saving === "token"} onCancel={() => setConfirmTokenReset(false)} onConfirm={() => void regenerateToken()} /> : null}
    {showMigration ? <MmwMigrationDialog notify={notify} onClose={() => setShowMigration(false)} /> : null}
  </>;
}

function SettingSection({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return <Surface className="settings-workbench-section"><div className="settings-heading"><span className="settings-icon">{icon}</span><div><h2>{title}</h2><p>{description}</p></div></div><div className="settings-section-body">{children}</div></Surface>;
}

function NumberField({ label, value, onChange, min = 1, max }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number }) {
  return <Field label={label}><input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /></Field>;
}

function SaveRow({ saving }: { saving: boolean }) {
  return <div className="settings-save-row"><Button type="submit" disabled={saving}>{saving ? <Spinner label="正在保存" /> : <><Save size={16} />保存当前分区</>}</Button></div>;
}
