import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { SettingsWorkbenchPage } from "./settings-workbench";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mockCompleteSettings(overrides: Record<string, unknown> = {}, failingPath = "") {
  const responses: Record<string, unknown> = {
    "/api/admin/system-settings/master-url": { master_url: "https://old.example.com" },
    "/api/admin/system-settings/default-theme": { default_theme: "flat" },
    "/api/admin/system-settings/login-wallpaper": { login_wallpaper: "" },
    "/api/admin/system-settings/intervals": { speed_collect_interval: 3, traffic_collect_interval: 60, traffic_check_interval: 120, heartbeat_interval: 30, report_interval: 5 },
    "/api/system-config/refetch-interval": { refetch_interval_ms: 5000 },
    "/api/admin/system-settings/probe-disguise": { enabled: false, title: "", server_ids: [], show_name: false },
    "/api/admin/remote-servers": { success: true, servers: [] },
    "/api/admin/system-settings/short-link": { enable_short_link: true },
    "/api/admin/system-settings/node-name-multiplier-prefix": { enabled: false, left: "[", right: "]" },
    "/api/admin/system-settings/override-scripts": { enable_override_scripts: false },
    "/api/admin/system-settings/subscription-output-format": { subscription_output_format: "yaml" },
    "/api/admin/system-settings/silent-mode": { silent_mode: false, silent_mode_timeout: 15 },
    "/api/admin/system-settings/miaomiaowu-features": { enable_miaomiaowu_features: true },
    "/api/admin/system-settings/mmw-short-link-compat": { enable_mmw_short_link_compat: false },
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
    return responses[path] as T;
  });
}

describe("settings workbench", () => {
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

  it("loads and saves the full user subscription contract without overwriting node order", async () => {
    mockCompleteSettings();
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    render(<SettingsWorkbenchPage notify={vi.fn()} />);

    expect(await screen.findByRole("combobox", { name: "节点匹配规则" })).toHaveValue("server_port");
    expect(screen.getByRole("spinbutton", { name: "缓存有效期（分钟）" })).toHaveValue(30);
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
});
