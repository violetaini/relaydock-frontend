import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { SettingsWorkbenchPage } from "./settings-workbench";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

function mockCompleteSettings(overrides: Record<string, unknown> = {}, failingPath = "") {
  const responses: Record<string, unknown> = {
    "/api/admin/system-settings/master-url": { master_url: "https://old.example.com" },
    "/api/admin/system-settings/default-theme": { default_theme: "flat" },
    "/api/admin/system-settings/login-wallpaper": { login_wallpaper: "" },
    "/api/admin/system-settings/branding": { name: "RelayDock", logo: "", favicon: "" },
    "/api/admin/system-settings/intervals": { speed_collect_interval: 3, traffic_collect_interval: 60, traffic_check_interval: 120, heartbeat_interval: 30, report_interval: 5 },
    "/api/system-config/refetch-interval": { refetch_interval_ms: 5000 },
    "/api/admin/system-settings/probe-disguise": { enabled: false, title: "", server_ids: [], show_name: false },
    "/api/admin/remote-servers": { success: true, servers: [] },
    "/api/admin/system-settings/short-link": { enable_short_link: true },
    "/api/admin/system-settings/node-name-multiplier-prefix": { enabled: false, left: "[", right: "]" },
    "/api/admin/system-settings/override-scripts": { enable_override_scripts: false },
    "/api/admin/system-settings/subscription-output-format": { subscription_output_format: "yaml" },
    "/api/admin/system-settings/silent-mode": { silent_mode: false, silent_mode_timeout: 15 },
    "/api/admin/system-settings/management-features": { enable_management_features: true },
    "/api/admin/system-settings/root-short-links": { enable_root_short_links: false },
    "/api/admin/system-settings/agent-log": { agent_log_enabled: false },
    "/api/admin/rule-templates": { templates: [] },
    "/api/admin/system-settings/default-template": { default_template_filename: "" },
    "/api/admin/system-settings/redeem-template": { redeem_template: "" },
    "/api/admin/security-settings": {
      login_rate_max_attempts: 5, login_rate_window_minutes: 60, login_rate_lock_minutes: 60,
      brute_force_enabled: true, brute_force_max_failures: 5, brute_force_window_minutes: 1440,
      brute_force_block_minutes: 1440, sub_rate_enabled: true, sub_rate_limit: 60,
      sub_rate_window_minutes: 1, skip_local_ip: true, turnstile_site_key: "", turnstile_secret_key: "",
    },
    "/api/admin/system-settings/require-encryption": { require_encryption: false },
    "/api/admin/system-settings/user-permissions": { config: { pages: [], quota_template: 0, quota_override: 0, quota_subscribe: 0, routed_outbound_enabled: false, quota_routed_outbound: 2, daily_limit_routed_outbound: 5 } },
    "/api/admin/notify-config": { notify_enabled: false },
    "/api/admin/system-settings/api-token": { token: "" },
    "/api/admin/update/check": {
      current_version: "0.5.0", latest_version: "0.5.0", has_update: false,
      release_url: "https://github.com/violetaini/relaydock/releases/tag/v0.5.0",
      download_url: "", release_notes: "", deployment_mode: "standalone",
      update_scope: "full", external_web_root: false, can_apply: true,
    },
    "/api/admin/speedtest/mihomo-status": {
      success: true,
      status: {
        ready: true, path: "data/bin/mihomo", source: "managed",
        current_version: "1.19.29", target_version: "1.19.29",
        manageable: true, update_available: false,
      },
    },
    "/api/user/config": {
      force_sync_external: true, match_rule: "server_port", sync_scope: "saved_only",
      keep_node_name: true, cache_expire_minutes: 30, sync_traffic: true,
      node_name_filter: "剩余|流量", append_sub_info: false, custom_rules_enabled: true,
      enable_short_link: true, use_new_template_system: true, enable_proxy_provider: false,
      node_order: [9, 3], proxy_groups_source_url: "https://groups.example/config.yaml",
      client_compatibility_mode: true,
    },
    ...overrides,
  };
  return vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
    if (path === failingPath) throw new Error("setting unavailable");
    if (!(path in responses)) throw new Error(`unexpected GET ${path}`);
    const response = responses[path];
    if (typeof response === "function") return await (response as () => unknown)() as T;
    return response as T;
  });
}

describe("settings workbench", () => {
  it("lets the administrator update an Arcway-managed Mihomo core", async () => {
    mockCompleteSettings({
      "/api/admin/speedtest/mihomo-status": {
        success: true,
        status: {
          ready: true, path: "data/bin/mihomo", source: "managed",
          current_version: "1.19.28", target_version: "1.19.29",
          manageable: true, update_available: true,
        },
      },
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({
      success: true,
      status: {
        ready: true, path: "data/bin/mihomo", source: "managed",
        current_version: "1.19.29", target_version: "1.19.29",
        manageable: true, update_available: false,
      },
    });
    const notify = vi.fn();
    render(<SettingsWorkbenchPage notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "更新到 1.19.29" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/speedtest/mihomo/install"));
    expect(notify).toHaveBeenCalledWith("主控 Mihomo 1.19.29 已就绪");
    expect(screen.getByRole("button", { name: "检查并更新" })).toBeInTheDocument();
  });

  it("lets the administrator recheck upstream when managed Mihomo is current", async () => {
    mockCompleteSettings();
    const post = vi.spyOn(api, "post").mockResolvedValue({
      success: true,
      status: {
        ready: true, path: "data/bin/mihomo", source: "managed",
        current_version: "1.19.29", target_version: "1.19.29",
        manageable: true, update_available: false,
      },
    });
    render(<SettingsWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "检查并更新" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/speedtest/mihomo/install"));
  });

  it("does not offer automatic Mihomo installation on unsupported platforms", async () => {
    mockCompleteSettings({
      "/api/admin/speedtest/mihomo-status": {
        success: true,
        status: {
          ready: false, path: "", source: "none",
          current_version: "", target_version: "",
          manageable: false, update_available: false,
        },
      },
    });
    render(<SettingsWorkbenchPage notify={vi.fn()} />);

    expect(await screen.findByText("当前平台不支持自动安装 Mihomo；请通过 MIHOMO_BIN 提供兼容核心。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /安装.*Mihomo|安装上游最新版/ })).not.toBeInTheDocument();
  });

  it("loads and saves the general settings as a scoped group", async () => {
    mockCompleteSettings();
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    const notify = vi.fn();
    render(<SettingsWorkbenchPage notify={notify} />);

    const url = await screen.findByRole("textbox", { name: "公开 URL" });
    fireEvent.change(url, { target: { value: "https://new.example.com/" } });
    fireEvent.click(screen.getByRole("button", { name: "保存基础设置" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/system-settings/master-url", { master_url: "https://new.example.com" }));
    expect(put).toHaveBeenCalledWith("/api/admin/system-settings/intervals", expect.objectContaining({ report_interval: 5 }));
    expect(put).toHaveBeenCalledWith("/api/admin/system-settings/dashboard-refresh", { refetch_interval_ms: 5000 });
    expect(notify).toHaveBeenCalledWith("基础设置已保存");
  });

  it("enables the public probe by default when no persisted toggle exists", async () => {
    mockCompleteSettings({
      "/api/admin/system-settings/probe-disguise": { title: "", server_ids: [], show_name: false },
    });
    render(<SettingsWorkbenchPage notify={vi.fn()} />);

    expect(await screen.findByRole("switch", { name: "启用公开探针伪装" })).toHaveAttribute("aria-checked", "true");
  });

  it("saves project branding and applies it to the active console", async () => {
    mockCompleteSettings({
      "/api/admin/system-settings/branding": {
        name: "RelayDock", logo: "https://assets.example/original-logo.png", favicon: "",
      },
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    const onBrandingChange = vi.fn();
    render(<SettingsWorkbenchPage notify={vi.fn()} onBrandingChange={onBrandingChange} />);

    fireEvent.change(await screen.findByRole("textbox", { name: /项目名称/ }), { target: { value: "Northstar" } });
    fireEvent.change(screen.getByRole("textbox", { name: "项目 Logo URL" }), { target: { value: "/assets/northstar-logo.svg" } });
    fireEvent.change(screen.getByRole("textbox", { name: "浏览器图标 URL" }), { target: { value: "https://assets.example/northstar.ico" } });
    fireEvent.click(screen.getByRole("button", { name: "保存基础设置" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/system-settings/branding", {
      name: "Northstar",
      logo: "/assets/northstar-logo.svg",
      favicon: "https://assets.example/northstar.ico",
    }));
    expect(onBrandingChange).toHaveBeenCalledWith({
      name: "Northstar",
      logo: "/assets/northstar-logo.svg",
      favicon: "https://assets.example/northstar.ico",
    });
  });

  it("keeps public probe server selection compact until the picker is confirmed", async () => {
    mockCompleteSettings({
      "/api/admin/system-settings/probe-disguise": {
        enabled: true,
        title: "状态页",
        server_ids: [11, 12],
        show_name: true,
        metric_cpu: true,
        metric_mem: true,
        metric_disk: true,
        metric_traffic: true,
        metric_speed: true,
      },
      "/api/admin/remote-servers": {
        success: true,
        servers: [
          { id: 11, name: "Edge Hong Kong", ip_address: "203.0.113.11" },
          { id: 12, name: "Edge Tokyo", ip_address: "203.0.113.12" },
          { id: 13, name: "Oracle Seoul", ip_address: "203.0.113.13" },
        ],
      },
    });
    render(<SettingsWorkbenchPage notify={vi.fn()} />);

    await screen.findByRole("heading", { name: "伪装" });
    const compactField = screen.getByText("服务器").closest(".probe-server-field") as HTMLElement;
    expect(within(compactField).getByText("已选择 2 / 3")).toBeInTheDocument();
    expect(within(compactField).queryByRole("checkbox")).not.toBeInTheDocument();

    fireEvent.click(within(compactField).getByRole("button", { name: "选择" }));
    const dialog = screen.getByRole("dialog", { name: "选择服务器" });
    const seoul = within(dialog).getByRole("checkbox", { name: /Oracle Seoul/ });
    expect(seoul).not.toBeChecked();
    fireEvent.click(seoul);
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(within(compactField).getByText("已选择 2 / 3")).toBeInTheDocument();

    fireEvent.click(within(compactField).getByRole("button", { name: "选择" }));
    const confirmedDialog = screen.getByRole("dialog", { name: "选择服务器" });
    fireEvent.click(within(confirmedDialog).getByRole("checkbox", { name: /Oracle Seoul/ }));
    fireEvent.click(within(confirmedDialog).getByRole("button", { name: "完成" }));
    expect(within(compactField).getByText("默认全部 / 3")).toBeInTheDocument();
  });

  it("keeps the default probe selection dynamic", async () => {
    mockCompleteSettings({
      "/api/admin/system-settings/probe-disguise": {
        enabled: true,
        title: "状态页",
        server_ids: [11, 12, 99],
        server_ids_default: true,
        show_name: true,
      },
      "/api/admin/remote-servers": {
        success: true,
        servers: [
          { id: 11, name: "Edge Hong Kong", ip_address: "203.0.113.11" },
          { id: 12, name: "Edge Tokyo", ip_address: "203.0.113.12" },
        ],
      },
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    render(<SettingsWorkbenchPage notify={vi.fn()} />);

    const compactField = (await screen.findByText("服务器")).closest(".probe-server-field") as HTMLElement;
    expect(within(compactField).getByText("默认全部 / 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存基础设置" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/system-settings/probe-disguise", expect.objectContaining({ server_ids_default: true })));
    const defaultProbeCall = put.mock.calls.find(([path]) => path === "/api/admin/system-settings/probe-disguise");
    expect(defaultProbeCall?.[1]).not.toHaveProperty("server_ids");
  });

  it("drops deleted servers from the explicit probe selection", async () => {
    mockCompleteSettings({
      "/api/admin/system-settings/probe-disguise": {
        enabled: true,
        title: "状态页",
        server_ids: [11, 99],
        server_ids_default: false,
        show_name: true,
      },
      "/api/admin/remote-servers": {
        success: true,
        servers: [
          { id: 11, name: "Edge Hong Kong", ip_address: "203.0.113.11" },
          { id: 12, name: "Edge Tokyo", ip_address: "203.0.113.12" },
        ],
      },
    });
    render(<SettingsWorkbenchPage notify={vi.fn()} />);

    const compactField = (await screen.findByText("服务器")).closest(".probe-server-field") as HTMLElement;
    expect(within(compactField).getByText("已选择 1 / 2")).toBeInTheDocument();
    fireEvent.click(within(compactField).getByRole("button", { name: "选择" }));
    const dialog = screen.getByRole("dialog", { name: "选择服务器" });
    expect(within(dialog).getByText("已选择 1 / 2")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "全选" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "取消全选" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "完成" }));
    expect(within(compactField).getByText("未选择 / 2")).toBeInTheDocument();
  });

  it("loads and saves the full user subscription contract without overwriting node order", async () => {
    mockCompleteSettings();
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    render(<SettingsWorkbenchPage notify={vi.fn()} />);

    expect(await screen.findByRole("combobox", { name: "节点匹配规则" })).toHaveValue("server_port");
    expect(screen.getByRole("spinbutton", { name: "缓存有效期（分钟）" })).toHaveValue(30);
    expect(screen.getByRole("textbox", { name: "复制模板" })).toHaveAttribute("rows", "10");
    fireEvent.change(screen.getByRole("combobox", { name: "同步范围" }), { target: { value: "all" } });
    fireEvent.click(screen.getByRole("switch", { name: "节点名称附加剩余流量与到期信息" }));
    fireEvent.click(screen.getByRole("button", { name: "保存订阅设置" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/user/config", expect.objectContaining({
      force_sync_external: true,
      match_rule: "server_port",
      sync_scope: "all",
      keep_node_name: true,
      cache_expire_minutes: 30,
      sync_traffic: true,
      node_name_filter: "剩余|流量",
      append_sub_info: true,
      enable_short_link: true,
      use_new_template_system: true,
      enable_proxy_provider: false,
      proxy_groups_source_url: "https://groups.example/config.yaml",
      client_compatibility_mode: true,
    })));
    const configCall = put.mock.calls.find(([path]) => path === "/api/user/config");
    expect(configCall?.[1]).not.toHaveProperty("node_order");
    expect(put).toHaveBeenCalledWith("/api/admin/system-settings/management-features", { enable_management_features: true });
    expect(put).toHaveBeenCalledWith("/api/admin/system-settings/root-short-links", { enable_root_short_links: false });
  });

  it("saves security thresholds without dropping masked Turnstile secrets", async () => {
    mockCompleteSettings({
      "/api/admin/security-settings": {
        login_rate_max_attempts: 7, login_rate_window_minutes: 30, login_rate_lock_minutes: 45,
        brute_force_enabled: true, brute_force_max_failures: 6, brute_force_window_minutes: 120,
        brute_force_block_minutes: 240, sub_rate_enabled: true, sub_rate_limit: 40,
        sub_rate_window_minutes: 2, skip_local_ip: true,
        turnstile_site_key: "1x00000000000000000000AA", turnstile_secret_key: "1x00****AA",
      },
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    render(<SettingsWorkbenchPage notify={vi.fn()} />);

    await screen.findByRole("heading", { name: "安全设置" });
    fireEvent.click(screen.getByRole("button", { name: "保存安全设置" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/security-settings", expect.objectContaining({
      login_rate_max_attempts: 7,
      turnstile_secret_key: "1x00****AA",
    })));
  });

  it("blocks editing when any persisted setting could not be loaded", async () => {
    mockCompleteSettings({}, "/api/admin/system-settings/short-link");
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    render(<SettingsWorkbenchPage notify={vi.fn()} />);

    expect(await screen.findByText("setting unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "公开 URL" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存基础设置" })).not.toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });

  it("shows the host update command and blocks in-container updates for Docker", async () => {
    mockCompleteSettings({
      "/api/admin/update/check": {
        current_version: "0.5.0", latest_version: "0.6.0", has_update: true,
        release_url: "https://github.com/violetaini/relaydock/releases/tag/v0.6.0",
        download_url: "", release_notes: "Docker release", deployment_mode: "docker",
        update_scope: "none", external_web_root: false, can_apply: false,
        warning: "Docker 部署需要在宿主机拉取新镜像。",
      },
    });
    render(<SettingsWorkbenchPage notify={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "系统更新" })).toBeInTheDocument();
    expect(screen.getByText("Docker 部署需要在宿主机拉取新镜像。")).toBeInTheDocument();
    expect(screen.getByText("docker compose pull && docker compose up -d")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "立即更新" })).toBeDisabled();
  });

  it("does not expose legacy updater behavior before the backend declares it safe", async () => {
    mockCompleteSettings({
      "/api/admin/update/check": {
        current_version: "0.5.0", latest_version: "0.5.1", has_update: true,
        release_url: "", download_url: "https://example.com/arcway", release_notes: "",
      },
    });
    render(<SettingsWorkbenchPage notify={vi.fn()} />);

    expect(await screen.findByText("当前控制端尚未提供安全的网页更新能力，请先按 README 使用命令行更新。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "立即更新" })).toBeDisabled();
  });

  it("streams an authenticated update and recovers after the restart disconnect", async () => {
    let checkCount = 0;
    const get = mockCompleteSettings({
      "/api/admin/update/check": () => {
        checkCount += 1;
        return checkCount === 1 ? {
          current_version: "0.5.0", latest_version: "0.6.0", has_update: true,
          release_url: "https://github.com/violetaini/relaydock/releases/tag/v0.6.0",
          download_url: "https://example.com/arcway", release_notes: "New release",
          deployment_mode: "standalone", update_scope: "full", external_web_root: false, can_apply: true,
        } : {
          current_version: "0.6.0", latest_version: "0.6.0", has_update: false,
          release_url: "https://github.com/violetaini/relaydock/releases/tag/v0.6.0",
          download_url: "", release_notes: "New release", deployment_mode: "standalone",
          update_scope: "full", external_web_root: false, can_apply: true,
        };
      },
      "/api/admin/update/status": { current_version: "0.6.0" },
    });
    localStorage.setItem("arcway-session-token", "admin-session");
    const encoder = new TextEncoder();
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({
          done: false,
          value: encoder.encode([
            'data: {"step":"checking","progress":0,"message":"正在检查版本"}',
            'data: {"step":"replacing","progress":0,"message":"正在替换文件"}',
            'data: {"step":"restarting","progress":0,"message":"正在重启服务"}',
          ].join("\n\n") + "\n\n"),
        })
        .mockRejectedValueOnce(new Error("connection closed during restart")),
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/event-stream" }),
      body: { getReader: () => reader },
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const notify = vi.fn();
    render(<SettingsWorkbenchPage notify={notify} />);

    await screen.findByText("发现新版本");
    fireEvent.click(screen.getByRole("button", { name: "立即更新" }));
    expect(screen.getByRole("dialog", { name: "更新到 0.6.0" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认更新" }));

    expect(await screen.findByText("更新完成，当前版本 0.6.0")).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/update/apply-sse?version=0.6.0");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer admin-session");
    expect(new Headers(init.headers).get("Accept")).toBe("text/event-stream");
    expect(get.mock.calls.some(([path]) => path === "/api/admin/update/status")).toBe(true);
    expect(notify).toHaveBeenCalledWith("系统已更新到 0.6.0");
  });

  it("shows an SSE update failure without waiting for a restart", async () => {
    mockCompleteSettings({
      "/api/admin/update/check": {
        current_version: "0.5.0", latest_version: "0.6.0", has_update: true,
        release_url: "", download_url: "https://example.com/arcway", release_notes: "",
        deployment_mode: "standalone", update_scope: "backend_only", external_web_root: true, can_apply: true,
      },
    });
    const encoder = new TextEncoder();
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: encoder.encode('data: {"step":"error","progress":0,"message":"更新包校验失败"}\n\n') })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/event-stream" }),
      body: { getReader: () => reader },
    } as unknown as Response));
    const notify = vi.fn();
    render(<SettingsWorkbenchPage notify={notify} />);

    await screen.findByText("发现新版本");
    fireEvent.click(screen.getByRole("button", { name: "立即更新" }));
    fireEvent.click(screen.getByRole("button", { name: "确认更新" }));

    expect(await screen.findByText("更新包校验失败", { selector: ".system-update-error" })).toBeInTheDocument();
    expect(notify).toHaveBeenCalledWith("更新包校验失败", "error");
  });
});
