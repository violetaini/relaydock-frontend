import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { settingsGetResponses } from "./mock-fixtures";

const profile = {
  username: "admin",
  email: "admin@example.com",
  nickname: "运维管理员",
  avatar_url: "",
  role: "admin",
  is_admin: true,
};

const servers = [
  {
    id: 1,
    name: "Hong Kong Edge",
    status: "online",
    last_heartbeat: new Date().toISOString(),
    ip_address: "198.51.100.14",
    ipv6_enabled: true,
    connection_mode: "websocket",
    current_upload_speed: 1840000,
    current_download_speed: 12700000,
    xray_running: true,
    xray_version: "25.6.8",
    xray_mode: "external",
    traffic_limit: 1099511627776,
    traffic_used: 237296943104,
    traffic_stats_mode: "both",
    traffic_source: "system",
    ws_connected: true,
    encrypted: true,
    inbounds: [],
  },
  {
    id: 2,
    name: "US West Edge",
    status: "online",
    last_heartbeat: new Date(Date.now() - 18_000).toISOString(),
    ip_address: "203.0.113.17",
    ipv6_enabled: true,
    connection_mode: "websocket",
    current_upload_speed: 650000,
    current_download_speed: 8100000,
    xray_running: true,
    xray_version: "25.6.8",
    xray_mode: "external",
    traffic_limit: 0,
    traffic_used: 78296943104,
    traffic_stats_mode: "both",
    traffic_source: "system",
    ws_connected: true,
    encrypted: true,
    inbounds: [],
  },
];

const nodes = Array.from({ length: 7 }, (_, index) => ({
  id: index + 1,
  node_name: ["HK Reality 01", "HK Hysteria2", "US VLESS", "US Trojan", "HK Relay", "US Reality", "HK Backup"][index],
  protocol: ["vless", "hysteria2", "vless", "trojan", "shadowsocks", "vless", "tuic"][index],
  raw_url: "",
  clash_config: "{}",
  parsed_config: "{}",
  enabled: index !== 6,
  tag: index < 3 ? "香港" : "美国",
  tags: [index < 3 ? "香港" : "美国"],
  original_server: index < 3 ? "Hong Kong Edge" : "US West Edge",
  inbound_tag: `inbound-${index + 1}`,
  node_type: "physical",
  created_by: "admin",
  updated_at: new Date().toISOString(),
}));

const traffic = {
  metrics: {
    total_limit_gb: 1024,
    total_used_gb: 221.4,
    total_remaining_gb: 802.6,
    usage_percentage: 21.62,
    unlimited_used_gb: 72.9,
  },
  history: Array.from({ length: 30 }, (_, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, "0")}`,
    used_gb: Math.round((4 + Math.sin(index / 2) * 2 + index / 5) * 10) / 10,
  })),
};

const tunnels = {
  success: true,
  chains: [{
    label: "hk-us-media",
    entry_server: 1,
    entry_port: 24433,
    final_target: "media.example.com:443",
    hops: [
      { server_id: 1, server_name: "Hong Kong Edge", tag: "tunnel-hk-us-media-h0", listen_port: 24433, target_address: "203.0.113.17", target_port: 24433 },
      { server_id: 2, server_name: "US West Edge", tag: "tunnel-hk-us-media-h1", listen_port: 24433, target_address: "media.example.com", target_port: 443 },
    ],
  }],
  tunnels: [{
    kind: "inbound",
    server_id: 1,
    server_name: "Hong Kong Edge",
    is_federated: false,
    tag: "tunnel-webhook",
    listen_port: 31080,
    target_address: "hooks.example.com",
    target_port: 443,
    network: "tcp,udp",
  }],
};

const speedResults = [{
  id: 9,
  node_id: 1,
  node_name: "HK Reality 01",
  source: "master_local",
  down_mbps: 318.6,
  latency_ms: 31,
  test_bytes: 52428800,
  status: "ok",
  egress_ip: "203.0.113.24",
  tested_by: "admin",
  created_at: new Date().toISOString(),
}];

const packages = [{
  id: 1,
  name: "标准套餐",
  description: "适用于日常访问",
  traffic_limit_gb: 300,
  cycle_days: 30,
  speed_limit_mbps: 100,
  device_limit: 5,
  traffic_mode: "oneway",
  is_reset: true,
  reset_day: 1,
  nodes: [1, 2, 3],
  node_multipliers: {},
  node_speed_limits: {},
  node_device_limits: {},
  auto_speed_rules: [],
  template_filename: "",
}];

const subscriptions = [{
  id: 1,
  name: "日常订阅",
  description: "香港与美国日常线路",
  filename: "daily.yaml",
  type: "clash",
  file_short_code: "daily",
  updated_at: new Date().toISOString(),
  latest_version: 3,
}];

const certificates = [{
  id: 1,
  domain: "edge.example.com",
  email: "admin@example.com",
  provider: "letsencrypt",
  status: "valid",
  issue_date: "2026-07-01T00:00:00Z",
  expiry_date: "2026-09-29T00:00:00Z",
  auto_renew: true,
  auto_deploy: true,
  challenge_mode: "dns",
  deploy_target: "nginx",
  updated_at: new Date().toISOString(),
}];

const customRules = [{
  id: 1,
  name: "私有 DNS 覆写",
  type: "dns",
  mode: "replace",
  content: "nameserver:\n  - 1.1.1.1",
  enabled: true,
  created_at: "2026-07-18 08:00:00",
  updated_at: "2026-07-19 08:30:00",
}];

const overrideScripts = [{
  id: 2,
  name: "清理节点名称",
  hook: "pre_save_nodes",
  content: "function main(value) { return value; }",
  enabled: true,
  sort_order: 10,
  created_at: "2026-07-18 09:00:00",
  updated_at: "2026-07-19 09:30:00",
}];

const ruleFiles = [{
  name: "balanced_v3.yaml",
  size: 2842,
  mod_time: 1784421000,
  latest_version: 3,
}];

async function mockAPI(
  page: Page,
  trafficResponse: typeof traffic | { metrics: typeof traffic.metrics; history: null } = traffic,
  unknownPaths?: string[],
) {
  await page.addInitScript(() => localStorage.setItem("arcway-session-token", "visual-test-token"));
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      ...settingsGetResponses,
      "/api/setup/status": { needs_setup: false },
      "/api/user/profile": profile,
      "/api/admin/remote-servers": { success: true, servers },
      "/api/admin/remote/services/status": { success: true, xray: { installed: true, running: true, version: "25.6.8" }, nginx: { installed: true, running: true, version: "1.26.3" } },
      "/api/admin/remote/agent/version-info": { success: true, current: "0.3.4", latest: "0.3.4", upgrade_available: false },
      "/api/admin/remote/system/info": { success: true, hostname: "edge-hk-01", uptime: 86400, loadavg: "0.12 0.18 0.20", memory: { MemAvailable: "1.8 GiB" } },
      "/api/admin/servers/1/ddns-status": { success: true, id: 1, name: "Hong Kong Edge", ddns_enabled: false, ddns_provider_id: 0, ddns_pending: false, pull_address: "" },
      "/api/admin/remote/inbounds": { success: true, inbounds: [{ tag: "vless-in", listen: "0.0.0.0", port: 443, protocol: "vless", settings: { clients: [] }, _runtime_status: "running" }] },
      "/api/admin/remote/outbounds": { success: true, outbounds: [{ tag: "direct", protocol: "freedom", settings: {} }] },
      "/api/admin/remote/routing": { success: true, routing: { domainStrategy: "IPIfNonMatch", rules: [{ type: "field", domain: ["domain:google.com"], network: "tcp", outboundTag: "direct" }] } },
      "/api/admin/xray-examples": { success: true, combinations: [{ dir_name: "VLESS-TCP-XTLS-Vision-REALITY", protocol: "vless", transport: "tcp", security: "reality", has_config: true }] },
      "/api/admin/xray/generate-x25519": { privateKey: "A".repeat(43), publicKey: "B".repeat(43) },
      "/api/admin/remote/reality-domains": { success: true, domains: [{ domain: "www.cloudflare.com", target: "www.cloudflare.com:443", success: true, latency_ms: 18 }] },
      "/api/admin/nodes": { nodes },
      "/api/admin/managed-node-offers": { offers: [] },
      "/api/traffic/summary": trafficResponse,
      "/api/admin/tunnels": tunnels,
      "/api/admin/remote/warp/status": { installed: true, license_active: true, addr_v4: "172.16.0.2", addr_v6: "2606:4700:110:8765::2" },
      "/api/admin/server-share/list": { shares: [{ id: 4, server_id: 1, label: "东京控制端", created_at: new Date().toISOString() }] },
      "/api/admin/speedtest/mihomo-status": { success: true, ready: true, path: "/opt/arcway/data/bin/mihomo" },
      "/api/admin/speedtest/results": { success: true, results: speedResults },
      "/api/admin/speedtest/testers": { success: true, testers: [{ id: 1, name: "Home Fiber", online: true, created_by: "admin" }] },
      "/api/user/debug/status": { enabled: true, log_path: "/tmp/arcway-debug.log", started_at: new Date().toISOString(), file_size: "12 KB", duration_seconds: 42 },
      "/api/user/debug/tail": { lines: "[INFO] agent connected\n[WARN] sample retry", total_size: 12288 },
      "/api/admin/tgbot/invites": { success: true, items: [{ code: "ARCWAY-DEMO", kind: "new", created_by: "admin", package_id: 1, max_uses: 3, used_count: 1, expires_at: "2026-08-19T00:00:00Z", revoked: false, remark: "新用户邀请", created_at: "2026-07-19T00:00:00Z", usable: true, duration_months: 1 }] },
      "/api/admin/node-uris": { items: [{ username: "alice", node_id: 1, node_name: "HK Reality 01", protocol: "vless", node_type: "physical", uri: "vless://masked@example.com:443" }] },
      "/api/admin/packages": { success: true, packages },
      "/api/admin/traffic/users": { users: [
        { username: "alice", total_uplink: 10995116277, total_downlink: 43980465111, cycle_uplink: 5368709120, cycle_downlink: 21474836480 },
        { username: "bob", total_uplink: 3221225472, total_downlink: 9663676416, cycle_uplink: 1073741824, cycle_downlink: 4294967296 },
      ] },
      "/api/admin/traffic/node-totals": { success: true, items: [
        { node_id: 1, node_name: "HK Reality 01", server_name: "Hong Kong Edge", node_type: "physical", uplink: 5368709120, downlink: 21474836480, last_uplink: 0, last_downlink: 0 },
        { node_id: 3, node_name: "US VLESS", server_name: "US West Edge", node_type: "physical", uplink: 1073741824, downlink: 4294967296, last_uplink: 0, last_downlink: 0 },
      ] },
      "/api/admin/traffic/user-connections": { success: true, connections: { alice: 2, bob: 0 } },
      "/api/admin/traffic/user-nodes": { success: true, items: [
        { node_id: 1, node_name: "HK Reality 01", server_name: "Hong Kong Edge", uplink: 5368709120, downlink: 21474836480, last_uplink: 0, last_downlink: 0 },
      ] },
      "/api/admin/traffic/node-users": { success: true, items: [
        { username: "alice", uplink: 5368709120, downlink: 21474836480, last_uplink: 0, last_downlink: 0 },
      ] },
      "/api/system-config/refetch-interval": { refetch_interval_ms: 5000 },
      "/api/user/2fa/status": { enabled: true },
      "/api/subscriptions": { subscriptions },
      "/api/user/token": { token: "subscription-token", user_short_code: "alice" },
      "/api/user/api-tokens": { success: true, tokens: [{ id: 1, name: "Home automation", created_at: "2026-07-12T08:00:00Z", last_used_at: "2026-07-19T08:00:00Z" }] },
      "/api/admin/template-v3": { templates: [{ name: "Balanced", filename: "balanced_v3.yaml", variables: {} }] },
      "/api/admin/template-v3/region-filters": { region_filters: { "香港": "(?i)(香港|HK|Hong Kong)", "日本": "(?i)(日本|JP|Japan)" } },
      "/api/admin/rule-templates": { templates: ["balanced_v3.yaml"], owners: { "balanced_v3.yaml": "admin" }, username: "admin", is_admin: true },
      "/api/admin/subscribe-files": { files: subscriptions.map((item) => ({ ...item, auto_sync_custom_rules: true, selected_node_ids: [1, 2], sort_order: 1, raw_output: false })) },
      "/api/user/external-subscriptions": [{ id: 2, username: "admin", name: "Vendor Backup", url: "https://vendor.example/sub", node_count: 4, upload: 1024, download: 2048, total: 4096, traffic_mode: "both" }],
      "/api/user/proxy-provider-configs": [],
      "/api/admin/certificates": { success: true, certificates },
      "/api/admin/dns-providers": { success: true, providers: [{ id: 1, name: "Cloudflare DNS", provider_type: "cloudflare", credentials_configured: true }] },
      "/api/admin/custom-rules": customRules,
      "/api/admin/override-scripts": overrideScripts,
      "/api/admin/rules/": { files: ruleFiles },
      "/api/admin/rules/balanced_v3.yaml": { name: "balanced_v3.yaml", content: "rules:\n  - MATCH,DIRECT\n", latest_version: 3 },
      "/api/admin/rules/balanced_v3.yaml/history": { history: [{ filename: "balanced_v3.yaml", version: 3, content: "rules:\n  - MATCH,DIRECT\n", created_by: "admin", created_at: "2026-07-19T08:30:00Z" }] },
      "/api/admin/users": { users: [
        { username: "admin", nickname: "运维管理员", role: "admin", is_active: true },
        { username: "alice", nickname: "Alice", email: "alice@example.com", role: "user", is_active: true, package_id: 1, package_name: "标准套餐", package_end_date: "2026-08-19", traffic_used: 26843545600, traffic_limit: 322122547200, speed_limit_mbps: 100, device_limit: 5 },
        { username: "bob", nickname: "Bob", role: "user", is_active: true, traffic_used: 5368709120 },
      ] },
    };
    if (!(pathname in responses)) unknownPaths?.push(`${route.request().method()} ${pathname}`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(responses[pathname] ?? {}) });
  });
}

async function expectViewportIntegrity(page: Page, label: string) {
  const result = await page.evaluate(() => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const clipped = Array.from(document.querySelectorAll<HTMLElement>(".topbar, .page-header, .dialog"))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      })
      .flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const horizontallyClipped = rect.left < -1 || rect.right > width + 1;
        const dialogVerticallyClipped = element.classList.contains("dialog") && (rect.top < -1 || rect.bottom > height + 1);
        return horizontallyClipped || dialogVerticallyClipped
          ? [`${element.className}: ${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`]
          : [];
      });
    return {
      documentOverflow: document.documentElement.scrollWidth - width,
      clipped,
    };
  });
  expect(result.documentOverflow, `${label}: document must not overflow horizontally`).toBeLessThanOrEqual(1);
  expect(result.clipped, `${label}: primary surfaces must stay inside the viewport`).toEqual([]);
}

async function closeDialog(page: Page) {
  const dialog = page.getByRole("dialog").last();
  await dialog.getByRole("button", { name: "关闭", exact: true }).first().click();
  await expect(dialog).toBeHidden();
}

test("desktop navigation follows the upstream primary and secondary hierarchy", async ({ page }) => {
  await mockAPI(page);

  for (const width of [1440, 1360, 1359, 1280, 1219, 1050, 1041]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/dashboard");
    await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();

    const primaryLabels = page.locator(".sidebar-nav .nav-primary .nav-item > span");
    const utilityItems = page.locator(".sidebar-nav .nav-utility .nav-item");
    await expect(primaryLabels).toHaveCount(7);
    await expect(utilityItems).toHaveCount(4);
    await expect(page.locator(".sidebar-nav .nav-secondary")).toBeHidden();
    await expect(page.getByRole("button", { name: "更多功能", exact: true })).toBeVisible();
    const clipped = await primaryLabels.evaluateAll((elements) => elements.flatMap((element) => {
      const label = element.textContent?.trim() || "<empty>";
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const navRect = element.closest(".sidebar-nav")?.getBoundingClientRect();
      return style.display === "none" || style.visibility === "hidden" || style.position === "absolute" || rect.width <= 1 || rect.height <= 1
        || !navRect || rect.left < navRect.left - 1 || rect.right > navRect.right + 1
        ? [{ label, display: style.display, visibility: style.visibility, position: style.position, width: rect.width, height: rect.height }]
        : [];
    }));

    expect(clipped, `${width}px primary navigation labels must remain visible`).toEqual([]);
    const navOverflow = await page.locator(".sidebar-nav").evaluate((nav) => nav.scrollWidth - nav.clientWidth);
    expect(navOverflow, `${width}px desktop navigation must not require horizontal scrolling`).toBeLessThanOrEqual(1);
    const renderedRows = await page.locator(".sidebar-nav .nav-primary .nav-item, .sidebar-nav .nav-utility .nav-item").evaluateAll((elements) => new Set(elements.map((element) => Math.round(element.getBoundingClientRect().top))).size);
    expect(renderedRows, `${width}px desktop navigation row count`).toBeLessThanOrEqual(width >= 1360 ? 1 : 2);
    const headerHeight = await page.locator(".sidebar").evaluate((header) => header.getBoundingClientRect().height);
    expect(headerHeight, `${width}px desktop navigation uses its stable height`).toBeLessThanOrEqual(width >= 1360 ? 65 : 104);
    await expectViewportIntegrity(page, `${width}px desktop navigation`);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: "更多功能", exact: true }).click();
  const moreMenu = page.getByRole("menu", { name: "更多功能" });
  await expect(moreMenu).toBeVisible();
  await expect(moreMenu.getByRole("menuitem")).toHaveCount(4);
  await expect(moreMenu.getByRole("menuitem", { name: "高级管理" })).toBeVisible();
});

test("dashboard uses the upstream desktop canvas and card scale", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAPI(page);
  await page.goto("/#/dashboard");

  await expect(page.locator(".page-header")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "流量信息", level: 1 })).toBeAttached();
  const measurements = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".nav-primary .nav-item");
    const pageContent = document.querySelector<HTMLElement>(".page-dashboard");
    const metric = document.querySelector<HTMLElement>(".metric");
    const chart = document.querySelector<HTMLElement>(".dashboard-chart");
    if (!nav || !pageContent || !metric || !chart) throw new Error("dashboard scale targets are missing");
    return {
      navFont: Number.parseFloat(getComputedStyle(nav).fontSize),
      pageWidth: pageContent.getBoundingClientRect().width,
      metricWidth: metric.getBoundingClientRect().width,
      metricHeight: metric.getBoundingClientRect().height,
      chartHeight: chart.getBoundingClientRect().height,
    };
  });
  expect(measurements.navFont).toBe(14);
  expect(measurements.pageWidth).toBe(1152);
  expect(measurements.metricWidth).toBeCloseTo(264, 0);
  expect(measurements.metricHeight).toBeGreaterThanOrEqual(130);
  expect(measurements.chartHeight).toBeGreaterThanOrEqual(390);
  await expectViewportIntegrity(page, "dashboard upstream scale");
});

test("mobile dashboard keeps the period selector readable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAPI(page);
  await page.goto("/#/dashboard");
  await expect(page.locator(".dashboard-period button")).toHaveCount(3);

  const measurements = await page.evaluate(() => {
    const tools = document.querySelector<HTMLElement>(".dashboard-chart-tools");
    const period = document.querySelector<HTMLElement>(".dashboard-period");
    const buttons = [...document.querySelectorAll<HTMLElement>(".dashboard-period button")];
    if (!tools || !period || buttons.length !== 3) throw new Error("dashboard period controls are missing");
    const periodStyle = getComputedStyle(period);
    return {
      toolsDisplay: getComputedStyle(tools).display,
      gridColumnStart: periodStyle.gridColumnStart,
      gridColumnEnd: periodStyle.gridColumnEnd,
      labels: buttons.map((button) => button.textContent?.trim()),
      whiteSpace: buttons.map((button) => getComputedStyle(button).whiteSpace),
      overflows: buttons.map((button) => button.scrollWidth - button.clientWidth),
      rows: new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size,
    };
  });

  expect(measurements.toolsDisplay).toBe("grid");
  expect(measurements.gridColumnStart).toBe("1");
  expect(measurements.gridColumnEnd).toBe("-1");
  expect(measurements.labels).toEqual(["今天", "本周", "本月"]);
  expect(measurements.whiteSpace).toEqual(["nowrap", "nowrap", "nowrap"]);
  expect(measurements.overflows.every((overflow) => overflow <= 1)).toBe(true);
  expect(measurements.rows).toBe(1);
  await expectViewportIntegrity(page, "mobile dashboard period selector");
});

test("desktop layout switch preserves navigation and preference", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAPI(page);
  await page.goto("/#/dashboard");

  await page.getByRole("button", { name: "切换到侧边栏" }).click();
  await expect(page.locator(".console-layout")).toHaveClass(/layout-side/);
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(page.locator(".sidebar-nav .nav-item > span")).toHaveCount(15);
  expect(await page.locator(".sidebar").evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(244);
  await expectViewportIntegrity(page, "desktop side navigation");

  await page.reload();
  await expect(page.locator(".console-layout")).toHaveClass(/layout-side/);
  await page.getByRole("button", { name: "切换到顶部栏" }).click();
  await expect(page.locator(".console-layout")).toHaveClass(/layout-top/);
  await expect(page.locator(".topbar")).toBeHidden();
  await expectViewportIntegrity(page, "desktop top navigation after switch");
});

test("advanced workflows render without runtime errors", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAPI(page);
  await page.goto("/#/advanced");
  await expect(page.getByRole("heading", { name: "高级管理" })).toBeVisible();
  await expect(page.getByText("hk-us-media")).toBeVisible();

  await page.getByRole("tab", { name: "WARP" }).click();
  await expect(page.getByRole("heading", { name: "WARP 出站" })).toBeVisible();
  await expect(page.getByText("License 已配置", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "联邦分享" }).click();
  await expect(page.getByRole("heading", { name: "我分享的服务器" })).toBeVisible();
  await expect(page.getByText("东京控制端")).toBeVisible();

  await page.getByRole("tab", { name: "节点测速" }).click();
  await expect(page.getByRole("heading", { name: "主控节点测速" })).toBeVisible();
  await expect(page.getByText("318.6 Mbps")).toBeVisible();

  await page.getByRole("tab", { name: "备份恢复" }).click();
  await expect(page.getByRole("heading", { name: "数据备份" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "恢复备份" })).toBeVisible();

  await page.getByRole("tab", { name: "Debug 日志" }).click();
  await expect(page.getByRole("heading", { name: "Debug / Agent 日志" })).toBeVisible();
  await expect(page.getByLabel("Debug 日志内容")).toContainText("agent connected");

  await page.getByRole("tab", { name: "TG 邀请码" }).click();
  await expect(page.getByRole("heading", { name: "TG Bot 邀请码" })).toBeVisible();
  await expect(page.getByText("ARCWAY-DEMO", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "创建邀请码" }).first().click();
  await expect(page.getByRole("dialog", { name: "创建 TG Bot 邀请码" })).toBeVisible();
  await closeDialog(page);
  expect(errors).toEqual([]);
});

test("advanced mobile panels remain within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAPI(page);
  await page.goto("/#/advanced");
  const panels = [
    { tab: "WARP", heading: "WARP 出站", file: "warp" },
    { tab: "联邦分享", heading: "我分享的服务器", file: "federation" },
    { tab: "节点测速", heading: "主控节点测速", file: "speedtest" },
    { tab: "备份恢复", heading: "数据备份", file: "backup" },
    { tab: "Debug 日志", heading: "Debug / Agent 日志", file: "debug" },
    { tab: "TG 邀请码", heading: "TG Bot 邀请码", file: "invites" },
  ];
  for (const panel of panels) {
    await page.getByRole("tab", { name: panel.tab }).click();
    await expect(page.getByRole("heading", { name: panel.heading })).toBeVisible();
    const hasViewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasViewportOverflow).toBe(false);
    const screenshot = path.resolve("../docs/change-records/assets/MMX-050", `advanced-${panel.file}-mobile.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
  }
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`advanced ${viewport.name} visual`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockAPI(page);
    await page.goto("/#/advanced");
    await expect(page.getByRole("heading", { name: "高级管理" })).toBeVisible();
    await expect(page.getByText("hk-us-media")).toBeVisible();
    const hasViewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasViewportOverflow).toBe(false);
    const screenshot = path.resolve("../docs/change-records/assets/MMX-050", `advanced-${viewport.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
  });
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`all console routes render cleanly on ${viewport.name}`, async ({ page }) => {
    const pageErrors: string[] = [];
    const unknownPaths: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize(viewport);
    await mockAPI(page, traffic, unknownPaths);

    const routes = [
      { route: "dashboard", heading: "流量信息", marker: "Hong Kong Edge", hiddenHeading: true },
      { route: "subscriptions", heading: "订阅链接", marker: "日常订阅" },
      { route: "generator", heading: "订阅生成器", marker: "最终订阅配置" },
      { route: "servers", heading: "服务管理", marker: "US West Edge" },
      { route: "nodes", heading: "节点管理", marker: "HK Reality 01" },
      { route: "traffic", heading: "流量明细", marker: "用户汇总" },
      { route: "users", heading: "用户管理", marker: "Alice" },
      { route: "packages", heading: "套餐管理", marker: "标准套餐" },
      { route: "certificates", heading: "证书管理", marker: "edge.example.com" },
      { route: "templates", heading: "模板管理", marker: "balanced_v3.yaml" },
      { route: "subscribeFiles", heading: "订阅管理", marker: "日常订阅" },
      { route: "customRules", heading: "覆写管理", marker: "私有 DNS 覆写" },
      { route: "rulesConfig", heading: "规则配置", marker: "balanced_v3.yaml" },
      { route: "advanced", heading: "高级管理", marker: "hk-us-media" },
      { route: "settings", heading: "系统设置", marker: "控制端与采集" },
      { route: "account", heading: "账户中心", marker: "个人资料" },
    ];

    for (const item of routes) {
      await page.goto(`/#/${item.route}`);
      const heading = page.getByRole("heading", { name: item.heading });
      if (item.hiddenHeading) await expect(heading).toBeAttached();
      else await expect(heading).toBeVisible();
      await expect(page.getByText(item.marker, { exact: true }).first()).toBeVisible();
      await expectViewportIntegrity(page, `${viewport.name} route ${item.route}`);
      await page.screenshot({
        path: path.resolve("../docs/change-records/assets/MMX-060", `arcway-${item.route}-${viewport.name}.png`),
        fullPage: true,
      });
    }

    expect(pageErrors).toEqual([]);
    expect(Array.from(new Set(unknownPaths))).toEqual([]);
  });
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`primary workbench entry points open cleanly on ${viewport.name}`, async ({ page }) => {
    test.setTimeout(60_000);
    const pageErrors: string[] = [];
    const unknownPaths: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize(viewport);
    await mockAPI(page, traffic, unknownPaths);

    await page.goto("/#/subscriptions");
    await expect(page.getByRole("link", { name: "导入 Clash" }).first()).toHaveAttribute("href", /^clash:\/\/install-config\?/);
    await expect(page.getByRole("link", { name: "导入 Clash Meta" }).first()).toHaveAttribute("href", /^clashmeta:\/\/install-config\?/);
    await page.getByRole("button", { name: "二维码" }).first().click();
    const qrDialog = page.getByRole("dialog", { name: "订阅二维码" });
    await expect(qrDialog.getByRole("img", { name: "日常订阅 订阅二维码" })).toBeVisible();
    await expect(qrDialog.getByRole("link", { name: "下载 PNG" })).toHaveAttribute("download", "日常订阅.png");
    await expectViewportIntegrity(page, `${viewport.name} local subscription QR`);
    await closeDialog(page);

    await page.goto("/#/generator");
    await page.getByRole("button", { name: "全选" }).click();
    await page.getByRole("main").getByRole("button", { name: "生成订阅" }).click();
    await expect(page.getByLabel("生成的订阅配置")).not.toHaveValue("");
    await page.getByRole("button", { name: "保存订阅" }).click();
    await expect(page.getByRole("dialog", { name: "保存生成的订阅" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} generator dialog`);
    await closeDialog(page);

    await page.goto("/#/servers");
    await page.getByRole("button", { name: "添加服务器" }).click();
    await expect(page.getByRole("dialog", { name: "添加服务器" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} server create`);
    await closeDialog(page);
    await page.getByRole("button", { name: /^管理(?: Hong Kong Edge)?$/ }).first().click();
    const serverDialog = page.getByRole("dialog", { name: "Hong Kong Edge" });
    await expect(serverDialog.getByText("Agent 版本", { exact: true })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} server operations`);
    await serverDialog.getByRole("tab", { name: "入站" }).click();
    await expect(serverDialog.getByText("vless-in", { exact: true })).toBeVisible();
    await serverDialog.getByRole("button", { name: "添加入站" }).first().click();
    await expect(serverDialog.getByRole("tab", { name: /VLESS \+ Reality/ })).toHaveAttribute("aria-selected", "true");
    await expect(serverDialog.getByRole("combobox", { name: "Reality 伪装目标 / SNI" })).toBeVisible();
    await expect(serverDialog.getByText("已生成", { exact: true })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} secure inbound wizard`);
    await serverDialog.getByRole("tab", { name: /高级 JSON/ }).click();
    await expect(serverDialog.getByLabel("入站高级 JSON")).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} advanced inbound editor`);
    await serverDialog.locator(".xray-resource-editor").getByRole("button", { name: "关闭" }).click();
    await serverDialog.getByRole("tab", { name: "出站" }).click();
    await expect(serverDialog.getByText("direct", { exact: true })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} structured outbound list`);
    await serverDialog.getByRole("tab", { name: "路由规则" }).click();
    await expect(serverDialog.getByText("domain:google.com", { exact: true })).toBeVisible();
    await serverDialog.getByRole("button", { name: "添加规则" }).first().click();
    await expect(serverDialog.getByLabel("路由规则高级 JSON")).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} structured routing editor`);
    await serverDialog.locator(".routing-rule-editor").getByRole("button", { name: "关闭" }).click();
    await closeDialog(page);

    await page.goto("/#/nodes");
    await expect(page.locator(".toast")).toHaveCount(0, { timeout: 5_000 });
    await page.getByRole("button", { name: "在服务器创建" }).click();
    await expect(page.getByRole("dialog", { name: "在服务器创建节点" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} node create`);
    await page.screenshot({ path: path.resolve("../docs/change-records/assets/MMX-100", `managed-node-wizard-${viewport.name}.png`), fullPage: true });
    await page.getByRole("button", { name: "下一步" }).click();
    await expect(page.getByRole("heading", { name: "选择协议与安全组合" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} managed protocol selection`);
    await page.screenshot({ path: path.resolve("../docs/change-records/assets/MMX-100", `managed-node-protocols-${viewport.name}.png`), fullPage: true });
    await page.getByRole("combobox", { name: "节点协议" }).selectOption("shadowsocks");
    await expect(page.getByRole("combobox", { name: "节点传输与安全预设" })).toHaveValue("shadowsocks");
    await page.getByRole("button", { name: "下一步" }).click();
    await expect(page.getByRole("heading", { name: "配置 Shadowsocks" })).toBeVisible();
    await expect(page.getByLabel("Shadowsocks 加密方式")).toHaveValue("2022-blake3-aes-128-gcm");
    await expectViewportIntegrity(page, `${viewport.name} managed Shadowsocks configuration`);
    await page.screenshot({ path: path.resolve("../docs/change-records/assets/MMX-100", `managed-node-shadowsocks-${viewport.name}.png`), fullPage: true });
    await closeDialog(page);
    await page.getByRole("button", { name: "导入已有节点" }).click();
    await expect(page.getByRole("dialog", { name: "导入外部节点" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} node import`);
    await closeDialog(page);
    await page.getByRole("button", { name: "工具", exact: true }).click();
    await page.getByRole("menuitem", { name: "节点测速" }).click();
    await expect(page.getByRole("dialog", { name: "节点测速工作台" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} speed test workbench`);
    await closeDialog(page);
    await page.getByRole("button", { name: "工具", exact: true }).click();
    await page.getByRole("menuitem", { name: "URI 管理器" }).click();
    await expect(page.getByRole("dialog", { name: "URI 管理器" }).getByText("vless://masked@example.com:443")).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} URI manager`);
    await closeDialog(page);

    await page.goto("/#/traffic");
    await expect(page.getByRole("tab", { name: /用户汇总/ })).toBeVisible();
    await page.getByRole("button", { name: "查看 alice 节点流量" }).click();
    const userTrafficDialog = page.getByRole("dialog", { name: "alice 的节点流量" });
    await expect(userTrafficDialog.getByText("HK Reality 01", { exact: true })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} user traffic drilldown`);
    await closeDialog(page);
    await page.getByRole("tab", { name: /节点汇总/ }).click();
    await page.getByRole("button", { name: "查看 HK Reality 01 用户流量" }).click();
    const nodeTrafficDialog = page.getByRole("dialog", { name: "HK Reality 01 的用户流量" });
    await expect(nodeTrafficDialog.getByText("alice", { exact: true })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} node traffic drilldown`);
    await closeDialog(page);

    await page.goto("/#/users");
    await page.getByRole("button", { name: "新建用户" }).click();
    await expect(page.getByRole("dialog", { name: "新建用户" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} user create`);
    await closeDialog(page);

    await page.goto("/#/packages");
    await page.getByRole("button", { name: "创建套餐" }).click();
    await expect(page.getByRole("dialog", { name: "创建套餐" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} package create`);
    await closeDialog(page);

    await page.goto("/#/certificates");
    await page.getByRole("button", { name: "申请证书" }).click();
    await expect(page.getByRole("dialog", { name: "申请 ACME 证书" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} certificate apply`);
    await closeDialog(page);
    await page.getByRole("tab", { name: /DNS 提供商/ }).click();
    await page.getByRole("button", { name: "DNS 提供商", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "添加 DNS 提供商" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} DNS provider create`);
    await closeDialog(page);

    await page.goto("/#/templates");
    await page.getByRole("button", { name: "可视化设计" }).click();
    const visualTemplateDialog = page.getByRole("dialog", { name: "可视化模板设计" });
    await expect(visualTemplateDialog.getByRole("tab", { name: "YAML 预览" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} visual template designer`);
    await closeDialog(page);
    await page.getByRole("button", { name: "新建模板" }).click();
    const templateDialog = page.getByRole("dialog", { name: "新建模板" });
    await expect(templateDialog.getByText("从订阅", { exact: true })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} template create`);
    await closeDialog(page);

    await page.goto("/#/subscribeFiles");
    await page.getByRole("button", { name: "添加订阅" }).click();
    const subscribeDialog = page.getByRole("dialog", { name: "添加订阅" });
    await expect(subscribeDialog).toBeVisible();
    await subscribeDialog.getByRole("button", { name: "配置模板、节点与覆写范围" }).click();
    await expect(subscribeDialog.getByRole("combobox", { name: "V3 模板" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} subscription create`);
    await closeDialog(page);
    await page.locator(".cw-tabs button").filter({ hasText: "外部订阅" }).click();
    await page.getByRole("button", { name: "外部订阅", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "添加外部订阅" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} external subscription create`);
    await closeDialog(page);

    await page.goto("/#/customRules");
    await page.getByRole("button", { name: "新建覆写" }).first().click();
    const overrideDialog = page.getByRole("dialog", { name: "新建覆写" });
    await expect(overrideDialog.getByRole("button", { name: "YAML 规则" })).toBeVisible();
    await expect(overrideDialog.getByRole("button", { name: "JavaScript 脚本" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} custom rule create`);
    await closeDialog(page);

    await page.goto("/#/rulesConfig");
    await page.getByRole("button", { name: "编辑" }).first().click();
    const ruleEditor = page.getByRole("dialog", { name: "编辑 balanced_v3.yaml" });
    await expect(ruleEditor.getByLabel("YAML 内容")).toHaveValue(/MATCH,DIRECT/);
    await expectViewportIntegrity(page, `${viewport.name} rule file editor`);
    await closeDialog(page);
    await page.getByRole("button", { name: "历史" }).first().click();
    const historyDialog = page.getByRole("dialog", { name: "balanced_v3.yaml 版本历史" });
    await expect(historyDialog.getByText("版本 3")).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} rule history`);
    await closeDialog(page);

    await page.goto("/#/settings");
    for (const [tab, marker] of [
      ["基础", "控制端与采集"],
      ["订阅", "生成能力"],
      ["安全", "登录限流"],
      ["用户权限", "普通用户页面"],
      ["通知", "Telegram"],
      ["账户与 API", "管理 API Token"],
    ]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await expect(page.getByRole("heading", { name: marker, exact: true })).toBeVisible();
      await expectViewportIntegrity(page, `${viewport.name} settings ${tab}`);
    }
    await page.getByRole("tab", { name: "订阅", exact: true }).click();
    await page.getByRole("button", { name: "打开迁移向导" }).click();
    const migrationDialog = page.getByRole("dialog", { name: "从妙妙屋迁移" });
    await expect(migrationDialog.getByRole("tab", { name: "远程拉取" })).toBeVisible();
    await expect(migrationDialog.getByRole("tab", { name: "上传备份" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} MMW migration wizard`);
    await closeDialog(page);

    await page.goto("/#/account");
    await expect(page.getByRole("heading", { name: "个人资料" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "修改密码" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "个人 API Token" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "账号安全" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} account center`);

    expect(pageErrors).toEqual([]);
    expect(Array.from(new Set(unknownPaths))).toEqual([]);
  });
}

test("dashboard accepts an empty traffic history", async ({ page }) => {
  await mockAPI(page, { metrics: traffic.metrics, history: null });
  await page.goto("/#/dashboard");
  await expect(page.getByRole("heading", { name: "流量信息" })).toBeAttached();
  await expect(page.getByText("暂无历史记录")).toBeVisible();
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`dashboard ${viewport.name} visual`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockAPI(page);
    await page.goto("/#/dashboard");
    await expect(page.getByRole("heading", { name: "流量信息" })).toBeAttached();
    await expect(page.getByText("Hong Kong Edge")).toBeVisible();
    const hasViewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasViewportOverflow).toBe(false);
    const screenshot = path.resolve("../docs/change-records/assets/MMX-010", `dashboard-${viewport.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
  });
}
