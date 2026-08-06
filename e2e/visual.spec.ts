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
    ip_address_v6: "2001:db8:100::14",
    ipv6_enabled: true,
    connection_mode: "websocket",
    current_upload_speed: 1840000,
    current_download_speed: 12700000,
    xray_running: true,
    xray_version: "25.6.8",
    xray_mode: "external",
    country_code: "HK",
    cpu_pct: 12.4,
    loadavg: "0.12 0.08 0.03",
    mem_used: 3 * 1024 ** 3,
    mem_total: 8 * 1024 ** 3,
    disk_used: 40 * 1024 ** 3,
    disk_total: 100 * 1024 ** 3,
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
    country_code: "US",
    cpu_pct: 37.8,
    loadavg: "0.42 0.31 0.28",
    mem_used: 9 * 1024 ** 3,
    mem_total: 16 * 1024 ** 3,
    disk_used: 170 * 1024 ** 3,
    disk_total: 250 * 1024 ** 3,
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

const lineSpeedTargets = [{
  key: "master:0",
  kind: "master",
  server_id: 0,
  name: "主控本机",
  online: true,
  supported: true,
  installed: true,
  managed: true,
  owned: true,
  running: false,
  implementation: "Ookla Speedtest CLI",
  version: "1.2.0.84",
  last_result: {
    ping_ms: 18.4,
    download_mbps: 512.7,
    upload_mbps: 96.3,
    isp: "Example Transit",
    egress_ip: "198.51.100.40",
    test_server: "Example Network / Tokyo",
    server_location: "Tokyo, Japan",
    created_at: new Date().toISOString(),
  },
}, {
  key: "remote:1",
  kind: "remote",
  server_id: 1,
  name: "Hong Kong Edge",
  online: true,
  supported: true,
  installed: true,
  managed: true,
  owned: true,
  license_accepted: true,
  running: false,
  implementation: "Ookla Speedtest CLI",
  version: "1.2.0.84",
  last_result: {
    ping_ms: 2.6,
    jitter_ms: 0.3,
    packet_loss_percent: 0,
    download_mbps: 1881.5,
    upload_mbps: 1867.1,
    isp: "Example Transit",
    egress_ip: "198.51.100.14",
    test_server: "HKBN / Hong Kong",
    created_at: new Date().toISOString(),
  },
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
  can_delete: true,
  file_short_code: "daily",
  updated_at: new Date().toISOString(),
  latest_version: 3,
}, {
  id: 2,
  name: "备用订阅",
  description: "故障切换线路",
  filename: "backup.yaml",
  type: "clash",
  can_delete: true,
  file_short_code: "backup",
  updated_at: new Date().toISOString(),
  latest_version: 1,
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
  responseOverrides: Record<string, unknown> = {},
) {
  await page.addInitScript(() => localStorage.setItem("arcway-session-token", "visual-test-token"));
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      ...settingsGetResponses,
      "/api/setup/status": { needs_setup: false },
      "/api/user/profile": profile,
      "/api/admin/remote-servers": { success: true, servers },
      "/api/admin/remote-servers/delete-impact": {
        success: true,
        server: { id: 1, name: "Hong Kong Edge", ownership: "owned", online: true, agent_uninstall_v2: true, xray_mode: "external", warp_installed: true },
        counts: { nodes: 7, subaccounts: 4, inbound_configs: 3, outbounds: 2, xray_snapshots: 5, batch_inbounds: 1, batch_outbounds: 1, stat_records: 128, total: 168 },
        blocker: null,
      },
      "/api/admin/remote/services/status": { success: true, xray: { installed: true, running: true, version: "25.6.8" }, nginx: { installed: true, running: true, version: "1.26.3" } },
      "/api/admin/remote/agent/version-info": { success: true, current: "0.3.4", latest: "0.3.4", upgrade_available: false },
      "/api/admin/remote/system/info": { success: true, hostname: "edge-hk-01", uptime: 86400, loadavg: "0.12 0.18 0.20", memory: { MemAvailable: "1.8 GiB" } },
      "/api/admin/servers/1/ddns-status": { success: true, id: 1, name: "Hong Kong Edge", ddns_enabled: false, ddns_provider_id: 0, ddns_pending: false, pull_address: "" },
      "/api/admin/remote/inbounds": { success: true, inbounds: [{ tag: "vless-in", listen: "0.0.0.0", port: 443, protocol: "vless", settings: { clients: [] }, _runtime_status: "running" }] },
      "/api/admin/remote/outbounds": { success: true, outbounds: [{ tag: "direct", protocol: "freedom", settings: {} }] },
      "/api/admin/remote/routing": { success: true, routing: { domainStrategy: "IPIfNonMatch", rules: [{ type: "field", domain: ["domain:google.com"], network: "tcp", outboundTag: "direct" }] } },
      "/api/admin/remote/xray/config": { success: true, path: "/usr/local/etc/xray/config.json", config: "{\n  \"log\": {\n    \"loglevel\": \"warning\"\n  },\n  \"inbounds\": [],\n  \"outbounds\": []\n}" },
      "/api/admin/xray-examples": { success: true, combinations: [{ dir_name: "VLESS-TCP-XTLS-Vision-REALITY", protocol: "vless", transport: "tcp", security: "reality", has_config: true }] },
      "/api/admin/xray/generate-x25519": { privateKey: "A".repeat(43), publicKey: "B".repeat(43) },
      "/api/admin/remote/reality-domains": { success: true, domains: [{ domain: "www.cloudflare.com", target: "www.cloudflare.com:443", success: true, latency_ms: 18 }] },
      "/api/admin/nodes": { nodes },
      "/api/admin/managed-node-offers": { offers: [] },
      "/api/admin/managed-inbound-resources": { success: true, resources: [] },
      "/api/admin/managed-inbound-resources/wireguard": {
        success: true,
        node_id: 8,
        client_config: "[Interface]\nPrivateKey = visual-client-private-key\nAddress = 10.66.66.2/32\nDNS = 1.1.1.1, 1.0.0.1\nMTU = 1420\n\n[Peer]\nPublicKey = visual-server-public-key\nAllowedIPs = 0.0.0.0/0\nEndpoint = edge.example.com:51820\nPersistentKeepalive = 25\n",
      },
      "/api/traffic/summary": trafficResponse,
      "/api/admin/remote/warp/status": { installed: true, license_active: true, addr_v4: "172.16.0.2", addr_v6: "2606:4700:110:8765::2" },
      "/api/admin/server-share/list": { shares: [{ id: 4, server_id: 1, label: "东京控制端", created_at: new Date().toISOString() }] },
      "/api/admin/speedtest/mihomo-status": { success: true, ready: true, path: "/opt/arcway/data/bin/mihomo" },
      "/api/admin/speedtest/results": { success: true, results: speedResults },
      "/api/admin/speedtest/testers": { success: true, testers: [{ id: 1, name: "Home Fiber", online: true, created_by: "admin" }] },
      "/api/admin/line-speedtest/targets": { success: true, targets: lineSpeedTargets },
      "/api/user/debug/status": { enabled: true, log_path: "/tmp/arcway-debug.log", started_at: new Date().toISOString(), file_size: "12 KB", duration_seconds: 42 },
      "/api/user/debug/tail": { lines: "[INFO] agent connected\n[WARN] sample retry", total_size: 12288 },
      "/api/admin/tgbot/invites": { success: true, items: [{ code: "ARCWAY-DEMO", kind: "new", created_by: "admin", package_id: 1, max_uses: 3, used_count: 1, expires_at: "2026-08-19T00:00:00Z", revoked: false, remark: "新用户邀请", created_at: "2026-07-19T00:00:00Z", usable: true, duration_months: 1 }] },
      "/api/admin/node-uris": { items: [{ username: "alice", node_id: 1, node_name: "HK Reality 01", protocol: "vless", node_type: "physical", uri: "vless://masked@example.com:443" }] },
      "/api/admin/nodes/7/uri": { item: { username: "admin", node_id: 7, node_name: "HK Backup", protocol: "tuic", node_type: "physical", uri: "tuic://70000000-0000-4000-8000-000000000000:visual-secret@edge.example.com:443?sni=edge.example.com#HK%20Backup" } },
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
      "/api/admin/certificates/valid": { success: true, certificates },
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
      ...responseOverrides,
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

test("desktop navigation follows the upstream hierarchy", async ({ page }) => {
  await mockAPI(page);

  for (const width of [1440, 1360, 1359, 1280, 1219, 1050, 1041]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/dashboard");
    await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();

    const primaryLabels = page.locator(".sidebar-nav .nav-primary .nav-item > span");
    const utilityItems = page.locator(".sidebar-nav .nav-utility .nav-item");
    const utilityLabels = page.locator(".sidebar-nav .nav-utility .nav-item > span");
    const visibleUtilityLabels = page.locator(".sidebar-nav .nav-utility .nav-item:not(.nav-probe-link) > span");
    await expect(primaryLabels).toHaveCount(8);
    await expect(utilityItems).toHaveCount(5);
    await expect(utilityLabels).toHaveCount(5);
    await expect(page.locator(".sidebar-nav .nav-probe-link")).toHaveAttribute("title", "返回探针");
    await expect(page.locator(".sidebar-nav .nav-secondary")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "更多功能", exact: true })).toHaveCount(0);
    await expect(page.locator(".sidebar-brand")).toContainText("RelayDock");
    const clipped = await primaryLabels.or(visibleUtilityLabels).evaluateAll((elements) => elements.flatMap((element) => {
      const label = element.textContent?.trim() || "<empty>";
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const navRect = element.closest(".sidebar-nav")?.getBoundingClientRect();
      return style.display === "none" || style.visibility === "hidden" || style.position === "absolute" || rect.width <= 1 || rect.height <= 1
        || !navRect || rect.left < navRect.left - 1 || rect.right > navRect.right + 1
        ? [{ label, display: style.display, visibility: style.visibility, position: style.position, width: rect.width, height: rect.height }]
        : [];
    }));

    expect(clipped, `${width}px desktop navigation labels must remain visible`).toEqual([]);
    const navOverflow = await page.locator(".sidebar-nav").evaluate((nav) => nav.scrollWidth - nav.clientWidth);
    expect(navOverflow, `${width}px desktop navigation must not require horizontal scrolling`).toBeLessThanOrEqual(1);
    const desktopNavigationItems = ".sidebar-nav .nav-primary .nav-item, .sidebar-nav .nav-utility .nav-item:not(.nav-probe-link)";
    const spacing = await page.locator(desktopNavigationItems).evaluateAll((elements) => {
      const rows = new Map<number, DOMRect[]>();
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        const row = Math.round(rect.top);
        rows.set(row, [...(rows.get(row) ?? []), rect]);
      }
      const gaps = Array.from(rows.values()).flatMap((items) => items
        .sort((left, right) => left.left - right.left)
        .slice(1)
        .map((item, index) => item.left - items[index].right));
      const firstItem = elements[0]?.getBoundingClientRect();
      const brand = document.querySelector<HTMLElement>(".sidebar-brand")?.getBoundingClientRect();
      return {
        brandGap: firstItem && brand ? firstItem.left - brand.right : 0,
        minimumButtonGap: gaps.length ? Math.min(...gaps) : 0,
      };
    });
    expect(spacing.brandGap, `${width}px brand must remain separate from navigation`).toBeGreaterThanOrEqual(10);
    expect(spacing.minimumButtonGap, `${width}px navigation buttons must retain visible spacing`).toBeGreaterThanOrEqual(9);
    const renderedRows = await page.locator(desktopNavigationItems).evaluateAll((elements) => new Set(elements.map((element) => Math.round(element.getBoundingClientRect().top / 2) * 2)).size);
    expect(renderedRows, `${width}px desktop navigation row count`).toBeLessThanOrEqual(width >= 1360 ? 1 : 2);
    const headerHeight = await page.locator(".sidebar").evaluate((header) => header.getBoundingClientRect().height);
    expect(headerHeight, `${width}px desktop navigation uses its stable height`).toBeLessThanOrEqual(width >= 1360 ? 65 : 104);
    await expectViewportIntegrity(page, `${width}px desktop navigation`);
  }

});

test("top navigation keeps probe return with the chrome controls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAPI(page);
  await page.goto("/#/dashboard");

  const navigationProbe = page.locator(".layout-top .sidebar-nav .nav-probe-link");
  const toolbarProbe = page.locator(".layout-top .sidebar-footer .sidebar-probe-link");
  const layoutControl = page.locator(".layout-top .sidebar-footer .top-layout-switch");
  await expect(navigationProbe).toBeHidden();
  await expect(toolbarProbe).toBeVisible();
  await expect(toolbarProbe).toHaveAttribute("title", "返回探针");

  const controls = await page.evaluate(() => {
    const probe = document.querySelector<HTMLElement>(".layout-top .sidebar-footer .sidebar-probe-link");
    const layout = document.querySelector<HTMLElement>(".layout-top .sidebar-footer .top-layout-switch");
    const icon = probe?.querySelector<SVGElement>("svg");
    if (!probe || !layout || !icon) throw new Error("top navigation probe return control is missing");
    const probeRect = probe.getBoundingClientRect();
    const layoutRect = layout.getBoundingClientRect();
    return {
      iconClass: icon.getAttribute("class") || "",
      probe: { width: probeRect.width, height: probeRect.height },
      layout: { width: layoutRect.width, height: layoutRect.height },
    };
  });

  await expect(layoutControl).toBeVisible();
  expect(controls.iconClass).toContain("lucide-house");
  expect(controls.probe).toEqual(controls.layout);
  await expectViewportIntegrity(page, "desktop top probe return control");
});

test("public probe keeps its operational hierarchy across desktop and mobile", async ({ page }, testInfo) => {
  const probe = {
    enabled: true,
    title: "Northstar Network Status",
    show_name: true,
    show_cpu: true,
    show_memory: true,
    show_disk: true,
    show_traffic: true,
    show_speed: true,
    servers: servers.map((server, index) => ({
      name: server.name,
      country_code: index === 0 ? "HK" : "US",
      online: true,
      upload_speed: server.current_upload_speed,
      download_speed: server.current_download_speed,
      traffic_used: server.traffic_used,
      traffic_limit: server.traffic_limit,
      cpu_pct: server.cpu_pct,
      loadavg: server.loadavg,
      mem_used: server.mem_used,
      mem_total: server.mem_total,
      disk_used: server.disk_used,
      disk_total: server.disk_total,
    })),
  };
  await mockAPI(page, traffic, undefined, {
    "/api/public/branding": { name: "Northstar", logo: "/brand.png", favicon: "/brand.png" },
    "/api/public/probe-servers": probe,
  });

  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "wide-desktop", width: 1920, height: 1080 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/?probe=1#/dashboard");

    await expect(page.getByRole("heading", { name: "Northstar Network Status" })).toBeVisible();
    await expect(page.locator(".public-probe-statusline")).toContainText("Northstar Network Status");
    await expect(page.locator(".public-probe-summary-cell")).toHaveCount(4);
    await expect(page.locator(".public-probe-item")).toHaveCount(2);
    await expect(page.locator(".public-probe-country").first()).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(page.locator(".public-probe-live-state")).toContainText("LIVE");
    const titleAlignment = await page.evaluate(() => {
      const flag = document.querySelector<HTMLElement>(".public-probe-country");
      const name = document.querySelector<HTMLElement>(".public-probe-status strong");
      if (!flag || !name) throw new Error("public probe title is incomplete");
      const flagRect = flag.getBoundingClientRect();
      const nameRect = name.getBoundingClientRect();
      return {
        flagDisplay: getComputedStyle(flag).display,
        centerOffset: Math.abs(
          (flagRect.top + flagRect.height / 2) - (nameRect.top + nameRect.height / 2),
        ),
      };
    });
    expect(titleAlignment.flagDisplay).toBe("flex");
    expect(titleAlignment.centerOffset, `public probe ${viewport.name}: country flag and name must share a vertical center`).toBeLessThanOrEqual(1);
    await expectViewportIntegrity(page, `public probe ${viewport.name}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `public probe ${viewport.name}: document must not overflow horizontally`).toBeLessThanOrEqual(1);
    if (viewport.name === "wide-desktop") {
      const geometry = await page.evaluate(() => {
        const content = document.querySelector<HTMLElement>(".public-probe-content");
        const card = document.querySelector<HTMLElement>(".public-probe-item");
        const name = document.querySelector<HTMLElement>(".public-probe-status strong");
        if (!content || !card || !name) throw new Error("public probe layout is incomplete");
        return {
          contentWidth: content.getBoundingClientRect().width,
          cardWidth: card.getBoundingClientRect().width,
          cardHeight: card.getBoundingClientRect().height,
          nameFontSize: getComputedStyle(name).fontSize,
        };
      });
      expect(geometry.contentWidth).toBeGreaterThan(1_600);
      expect(geometry.cardWidth).toBeGreaterThan(800);
      expect(geometry.cardHeight).toBeGreaterThanOrEqual(276);
      expect(geometry.nameFontSize).toBe("16px");
    }
    await page.screenshot({ path: testInfo.outputPath(`public-probe-${viewport.name}.png`), fullPage: true });
  }
});

test("secondary workflows remain available from their owning pages", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAPI(page);

  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: "查看流量明细" }).click();
  await expect(page).toHaveURL(/#\/traffic$/);
  await expect(page.getByRole("heading", { name: "流量明细" })).toBeVisible();

  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: /待续期用户/ }).click();
  await expect(page).toHaveURL(/#\/users\?view=renewal$/);
  await expect(page.getByRole("button", { name: "续期工作台" })).toHaveClass(/is-active/);

  await page.goto("/#/subscribeFiles");
  await page.getByRole("button", { name: "覆写规则" }).click();
  await expect(page).toHaveURL(/#\/customRules$/);
  await expect(page.getByRole("heading", { name: "覆写管理" })).toBeVisible();

  await page.goto("/#/subscribeFiles");
  await page.getByRole("button", { name: "规则配置" }).click();
  await expect(page).toHaveURL(/#\/rulesConfig$/);
  await expect(page.getByRole("heading", { name: "规则配置" })).toBeVisible();
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

test("mobile probe return uses a matched home control", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAPI(page);
  await page.goto("/#/dashboard");

  await expect(page.locator(".topbar-probe-link")).toBeVisible();
  const controls = await page.evaluate(() => {
    const probe = document.querySelector<HTMLElement>(".topbar-probe-link");
    const reference = document.querySelector<HTMLElement>(".topbar-actions .mobile-page-shortcut");
    const icon = probe?.querySelector<SVGElement>("svg");
    if (!probe || !reference || !icon) throw new Error("mobile probe return control is missing");
    const probeRect = probe.getBoundingClientRect();
    const referenceRect = reference.getBoundingClientRect();
    return {
      iconClass: icon.getAttribute("class") || "",
      isIconButton: probe.classList.contains("icon-button"),
      probe: { width: probeRect.width, height: probeRect.height },
      reference: { width: referenceRect.width, height: referenceRect.height },
    };
  });

  expect(controls.isIconButton).toBe(true);
  expect(controls.iconClass).toContain("lucide-house");
  expect(controls.probe).toEqual(controls.reference);
  await expectViewportIntegrity(page, "mobile probe return control");
});

test("probe return stays in the current tab", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAPI(page, traffic, undefined, {
    "/api/public/probe-servers": {
      enabled: true,
      title: "RelayDock Status",
      show_name: true,
      show_cpu: true,
      servers: [{
        name: "Hong Kong Edge",
        country_code: "HK",
        online: true,
        cpu_pct: 12.4,
        traffic_used: 1024,
      }],
    },
  });
  await page.goto("/#/dashboard");

  const probeLink = page.locator(".topbar-probe-link");
  await expect(probeLink).toHaveAttribute("href", /[?&]probe=1/);
  await expect(probeLink).not.toHaveAttribute("target", "_blank");
  const pageCount = context.pages().length;
  await Promise.all([
    page.waitForURL(/[?&]probe=1/),
    probeLink.click(),
  ]);

  await expect(page.locator(".public-probe")).toBeVisible();
  expect(context.pages()).toHaveLength(pageCount);
});

test("desktop layout switch stays visible in both chrome modes and preserves navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAPI(page);
  await page.goto("/#/dashboard");

  await expect(page.locator(".sidebar-footer .top-layout-switch")).toBeVisible();
  await page.locator(".sidebar-footer .top-layout-switch").click();
  await expect(page.locator(".console-layout")).toHaveClass(/layout-side/);
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(page.locator(".sidebar-nav .nav-item > span")).toHaveCount(13);
  await expect(page.locator(".sidebar-brand .sidebar-layout-switch")).toBeVisible();
  await expect(page.locator(".topbar-actions .topbar-layout-switch")).toBeVisible();
  await expect(page.locator(".topbar-probe-link")).toBeVisible();
  expect(await page.locator(".sidebar").evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(224);
  expect(await page.locator(".console-layout").evaluate((element) => getComputedStyle(element).getPropertyValue("--app-header-height").trim())).toBe("68px");
  const chrome = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".layout-side .sidebar-nav .nav-item");
    const navContainer = document.querySelector<HTMLElement>(".layout-side .sidebar-nav");
    const sidebar = document.querySelector<HTMLElement>(".layout-side .sidebar");
    const title = document.querySelector<HTMLElement>(".layout-side .topbar-page-title");
    const actions = Array.from(document.querySelectorAll<HTMLElement>(".layout-side .topbar-actions .icon-button, .layout-side .topbar-account"))
      .filter((action) => getComputedStyle(action).display !== "none");
    if (!nav || !navContainer || !sidebar || !title || !actions.length) throw new Error("desktop side chrome is missing");
    const navRect = nav.getBoundingClientRect();
    const navContainerRect = navContainer.getBoundingClientRect();
    const sidebarRect = sidebar.getBoundingClientRect();
    const actionRects = actions.map((action) => action.getBoundingClientRect());
    return {
      navWidth: navRect.width,
      firstNavOffset: navRect.top - navContainerRect.top,
      sidebarWidth: sidebarRect.width,
      navFont: Number.parseFloat(getComputedStyle(nav).fontSize),
      navShadow: getComputedStyle(nav).boxShadow,
      titleFont: Number.parseFloat(getComputedStyle(title).fontSize),
      actionSizes: actionRects.map((rect) => ({ width: rect.width, height: rect.height })),
      actionGaps: actionRects.slice(1).map((rect, index) => rect.left - actionRects[index].right),
    };
  });
  expect(chrome.navWidth).toBeGreaterThanOrEqual(chrome.sidebarWidth - 28);
  expect(chrome.firstNavOffset).toBeLessThanOrEqual(58);
  expect(chrome.navFont).toBeGreaterThanOrEqual(14);
  expect(chrome.navShadow).not.toBe("none");
  expect(chrome.titleFont).toBeGreaterThanOrEqual(18);
  expect(chrome.actionSizes.every((size) => size.width >= 38 && size.height >= 38)).toBe(true);
  expect(chrome.actionGaps.every((gap) => gap >= 8)).toBe(true);
  await expectViewportIntegrity(page, "desktop side navigation");

  await page.reload();
  await expect(page.locator(".console-layout")).toHaveClass(/layout-side/);
  await page.locator(".sidebar-brand .sidebar-layout-switch").click();
  await expect(page.locator(".console-layout")).toHaveClass(/layout-top/);
  await expect(page.locator(".topbar")).toBeHidden();

  await page.locator(".sidebar-footer .top-layout-switch").click();
  await expect(page.locator(".console-layout")).toHaveClass(/layout-side/);
  await page.locator(".topbar-actions .topbar-layout-switch").click();
  await expect(page.locator(".console-layout")).toHaveClass(/layout-top/);
  const topChrome = await page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll<HTMLElement>(".layout-top .sidebar-footer > .icon-button, .layout-top .sidebar-footer > .account-block"));
    if (!controls.length) throw new Error("desktop top chrome is missing");
    const rects = controls.map((control) => control.getBoundingClientRect());
    return {
      sizes: rects.map((rect) => ({ width: rect.width, height: rect.height })),
      gaps: rects.slice(1).map((rect, index) => rect.left - rects[index].right),
    };
  });
  expect(topChrome.sizes.every((size) => size.width >= 36 && size.height >= 36)).toBe(true);
  expect(topChrome.gaps.every((gap) => gap >= 8)).toBe(true);
  await expectViewportIntegrity(page, "desktop top navigation after switch");
});

test("desktop side navigation keeps a return control in alternate themes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAPI(page);
  await page.goto("/#/dashboard");

  await page.locator(".sidebar-footer .top-layout-switch").click();
  await expect(page.locator(".console-layout")).toHaveClass(/layout-side/);
  await page.evaluate(() => { document.documentElement.dataset.styleTheme = "pixel"; });

  await expect(page.locator(".sidebar-brand .sidebar-layout-switch")).toBeVisible();
  await expect(page.locator(".topbar-actions .topbar-layout-switch")).toBeVisible();
  await page.locator(".topbar-actions .topbar-layout-switch").click();
  await expect(page.locator(".console-layout")).toHaveClass(/layout-top/);
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`migrated operations render from their owning pages on ${viewport.name}`, async ({ page }, testInfo) => {
    const errors: Error[] = [];
    page.on("pageerror", (error) => errors.push(error));
    await page.setViewportSize(viewport);
    await mockAPI(page);

    await page.goto("/#/servers");
    await page.getByRole("button", { name: "Xray 设置", exact: true }).first().click();
    const serverDialog = page.getByRole("dialog", { name: "Hong Kong Edge" });
    await serverDialog.getByRole("tab", { name: "WARP" }).click();
    await expect(serverDialog.getByRole("heading", { name: "WARP 出站" })).toBeVisible();
    await expect(serverDialog.getByText("License 已配置", { exact: true })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} server WARP ownership`);
    await serverDialog.screenshot({ path: testInfo.outputPath(`server-warp-${viewport.name}.png`) });

    await serverDialog.getByRole("tab", { name: "服务器分享" }).click();
    await expect(serverDialog.getByText("东京控制端", { exact: true })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} server sharing ownership`);
    await serverDialog.screenshot({ path: testInfo.outputPath(`server-sharing-${viewport.name}.png`) });
    await closeDialog(page);

    await page.goto("/#/settings");
    const maintenance = page.locator(".settings-update-group");
    await expect(page.getByRole("heading", { name: "数据备份" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "恢复备份" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "主控 Debug 日志" })).toBeVisible();
    await expect(page.getByLabel("主控 Debug 日志内容")).toContainText("agent connected");
    await expectViewportIntegrity(page, `${viewport.name} settings maintenance ownership`);
    await maintenance.screenshot({ path: testInfo.outputPath(`settings-maintenance-${viewport.name}.png`) });

    await page.goto("/#/users?view=invites");
    await expect(page.getByRole("heading", { name: "TG Bot 邀请码" })).toBeVisible();
    await expect(page.getByText("ARCWAY-DEMO", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "TG 邀请码" })).toHaveClass(/is-active/);
    await expectViewportIntegrity(page, `${viewport.name} TG invite ownership`);
    await page.screenshot({ path: testInfo.outputPath(`user-invites-${viewport.name}.png`), fullPage: true });
    await page.getByRole("button", { name: "创建邀请码" }).first().click();
    const inviteDialog = page.getByRole("dialog", { name: "创建 TG Bot 邀请码" });
    await expect(inviteDialog).toBeVisible();
    await expect(inviteDialog.getByText("Arcway 主控本身不提供兑换入口", { exact: false })).toBeVisible();
    await inviteDialog.getByRole("combobox", { name: "用途" }).selectOption("bind");
    const bindAccount = inviteDialog.getByRole("combobox", { name: "Arcway 账号" });
    await expect(bindAccount.getByRole("option", { name: "Alice（alice）" })).toHaveCount(1);
    await bindAccount.selectOption("alice");
    await expect(bindAccount).toHaveValue("alice");
    await expectViewportIntegrity(page, `${viewport.name} TG invite creation`);
    await inviteDialog.screenshot({ path: testInfo.outputPath(`tg-invite-bind-${viewport.name}.png`) });
    await closeDialog(page);

    expect(errors).toEqual([]);
  });
}

for (const scenario of [
  { name: "running", label: "运行中", installed: true, running: true, version: "Xray 26.2.6", theme: "light", viewport: { width: 1440, height: 900 } },
  { name: "running-dark", label: "运行中", installed: true, running: true, version: "Xray 26.2.6", theme: "dark", viewport: { width: 1440, height: 900 } },
  { name: "stopped", label: "已停止", installed: true, running: false, version: "Xray 26.2.6", theme: "light", viewport: { width: 1440, height: 900 } },
  { name: "missing", label: "未安装", installed: false, running: false, version: "", theme: "light", viewport: { width: 1440, height: 900 } },
  { name: "running-mobile", label: "运行中", installed: true, running: true, version: "Xray 26.2.6", theme: "light", viewport: { width: 390, height: 844 } },
  { name: "missing-mobile", label: "未安装", installed: false, running: false, version: "", theme: "light", viewport: { width: 390, height: 844 } },
]) {
  test(`Xray ${scenario.name} service state matches the management surface`, async ({ page }, testInfo) => {
    await page.setViewportSize(scenario.viewport);
    await page.addInitScript((theme) => localStorage.setItem("arcway-theme", theme), scenario.theme);
    const stateServers = servers.map((server, index) => index === 0 ? {
      ...server,
      xray_running: scenario.running,
      xray_version: scenario.version,
    } : server);
    await mockAPI(page, traffic, undefined, {
      "/api/admin/remote-servers": { success: true, servers: stateServers },
      "/api/admin/remote/services/status": {
        success: true,
        xray: { installed: scenario.installed, running: scenario.running, version: scenario.version },
        nginx: { installed: true, running: true, version: "nginx/1.24.0" },
      },
    });
    await page.goto("/#/servers");

    const firstCard = page.locator(".service-card").first();
    const listState = firstCard.locator(".service-xray-state");
    const cardState = scenario.running ? "running" : scenario.installed ? "stopped" : "missing";
    await expect(listState).toHaveClass(new RegExp(`is-${cardState}`));
    await expect(listState).toContainText(scenario.installed ? "Xray" : "安装 Xray");
    await expect(listState).not.toContainText("Penetrates Everything");
    const address = firstCard.locator(".service-address");
    if ((await address.getAttribute("aria-label"))?.includes("当前 IPv6")) await address.click();
    await expect(address).toContainText("198.51.100.14");
    await expect(address).toContainText("1/2");
    if (scenario.viewport.width <= 390) {
      await expect.poll(() => address.locator(".service-address-viewport").evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    }
    await expect(page.locator(".service-card").first().locator(".service-agent-version")).toContainText("v0.3.4");
    await expect(firstCard.locator(".service-runtime-controls").locator(".service-address")).toHaveCount(1);
    await expectViewportIntegrity(page, `${scenario.name} server card`);
    await page.screenshot({ path: testInfo.outputPath(`service-${scenario.name}-card.png`), fullPage: true });
    if (scenario.installed) {
      await listState.click();
      const quickMenu = page.getByRole("menu", { name: "Hong Kong Edge Xray 快捷操作" });
      if (scenario.running) {
        await expect(quickMenu.getByRole("menuitem", { name: "重启 Xray" })).toBeVisible();
        await expect(quickMenu.getByRole("menuitem", { name: "暂停 Xray" })).toBeVisible();
      } else {
        await expect(quickMenu.getByRole("menuitem", { name: "开启 Xray" })).toBeVisible();
      }
      await expect(quickMenu.getByRole("menuitem", { name: `已是最新版 v${scenario.version.replace(/^Xray\s*/i, "")}` })).toBeDisabled();
      await expect(quickMenu.getByRole("menuitem", { name: "选择 / 重装核心" })).toBeEnabled();
      await expectViewportIntegrity(page, `${scenario.name} Xray quick menu`);
      await page.screenshot({ path: testInfo.outputPath(`service-${scenario.name}-card-menu.png`), fullPage: true });
    }
    await page.getByRole("button", { name: /^管理(?: Hong Kong Edge)?$/ }).first().click();
    const operations = page.getByRole("dialog", { name: "Hong Kong Edge" });
    await expect(operations.getByText("Agent 版本", { exact: true })).toBeVisible();
    await operations.getByRole("tab", { name: "服务控制" }).click();
    const xray = operations.locator(".service-control-card").first();
    await expect(xray.locator(".service-control-state")).toContainText(scenario.label);
    if (scenario.installed) {
      await expect(xray.getByRole("button", { name: "重启 Xray" })).toBeVisible();
    } else {
      await expect(xray.getByRole("button", { name: "安装 Xray" })).toBeVisible();
    }
    await expectViewportIntegrity(page, `${scenario.name} Xray service state`);
    await page.screenshot({ path: testInfo.outputPath(`service-${scenario.name}.png`), fullPage: true });
  });
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900, theme: "dark" },
  { name: "mobile", width: 390, height: 844, theme: "light" },
]) {
  test(`Xray install terminal remains readable while streaming on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.addInitScript((theme) => localStorage.setItem("arcway-theme", theme), viewport.theme);
    const missingServers = servers.map((server, index) => index === 0 ? { ...server, xray_running: false, xray_version: "" } : server);
    await mockAPI(page, traffic, undefined, {
      "/api/admin/remote-servers": { success: true, servers: missingServers },
      "/api/admin/remote/services/status": {
        success: true,
        xray: { installed: false, running: false, version: "" },
        nginx: { installed: true, running: true, version: "nginx/1.24.0" },
      },
    });
    let releaseStream = () => undefined;
    const streamGate = new Promise<void>((resolve) => { releaseStream = resolve; });
    await page.route("**/api/admin/remote/xray/install-stream**", async (route) => {
      await streamGate;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'data: {"type":"output","data":"Downloading Xray core..."}\n\ndata: {"type":"complete","success":true,"message":"installed"}\n\n',
      });
    });
    await page.goto("/#/servers");
    await page.getByRole("button", { name: /^管理(?: Hong Kong Edge)?$/ }).first().click();
    const operations = page.getByRole("dialog", { name: "Hong Kong Edge" });
    await expect(operations.getByText("Agent 版本", { exact: true })).toBeVisible();
    await operations.getByRole("tab", { name: "服务控制" }).click();
    await operations.getByRole("button", { name: "安装 Xray" }).click();

    const terminal = page.getByRole("dialog", { name: "安装 Xray" });
    await expect(terminal).toBeVisible();
    await expect(terminal.locator(".service-terminal")).toHaveAttribute("aria-busy", "true");
    await expect(terminal.getByRole("button", { name: "正在执行" })).toBeDisabled();
    await expectViewportIntegrity(page, `${viewport.name} Xray install terminal`);
    await page.screenshot({ path: testInfo.outputPath(`service-install-${viewport.name}.png`), fullPage: true });

    releaseStream();
    await expect(terminal.getByText("执行完成", { exact: true })).toBeVisible();
  });
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`system update panel stays readable on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockAPI(page);
    await page.goto("/#/settings");

    const panel = page.locator(".settings-update-group .settings-workbench-section").filter({
      has: page.getByRole("heading", { name: "系统更新", exact: true }),
    });
    await expect(page.getByRole("heading", { name: "系统维护", exact: true })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "系统更新", exact: true })).toBeVisible();
    await expect(panel.getByText("0.5.0", { exact: true })).toBeVisible();
    await expect(panel.getByText("0.5.1", { exact: true })).toBeVisible();
    await expect(panel.getByText("发现新版本", { exact: true })).toBeVisible();
    await panel.scrollIntoViewIfNeeded();

    const overflow = await panel.evaluate((element) => ({
      panel: element.scrollWidth - element.clientWidth,
      versions: (element.querySelector<HTMLElement>(".system-update-versions")?.scrollWidth ?? 0)
        - (element.querySelector<HTMLElement>(".system-update-versions")?.clientWidth ?? 0),
      actions: (element.querySelector<HTMLElement>(".system-update-actions")?.scrollWidth ?? 0)
        - (element.querySelector<HTMLElement>(".system-update-actions")?.clientWidth ?? 0),
    }));
    expect(overflow.panel).toBeLessThanOrEqual(1);
    expect(overflow.versions).toBeLessThanOrEqual(1);
    expect(overflow.actions).toBeLessThanOrEqual(1);
    await expectViewportIntegrity(page, `${viewport.name} system update panel`);

    await panel.getByRole("button", { name: "立即更新" }).click();
    const dialog = page.getByRole("dialog", { name: "更新到 0.5.1" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/数据备份/)).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} system update confirmation`);
  });

  test(`all console routes render cleanly on ${viewport.name}`, async ({ page }) => {
    const pageErrors: string[] = [];
    const unknownPaths: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize(viewport);
    await mockAPI(page, traffic, unknownPaths);

    const routes = [
      { route: "dashboard", heading: "流量信息", marker: "运行概览", hiddenHeading: true },
      { route: "subscriptions", heading: "订阅链接", marker: "日常订阅" },
      { route: "generator", heading: "订阅生成器", marker: "最终订阅配置" },
      { route: "servers", heading: "服务管理", marker: "US West Edge" },
      { route: "nodes", heading: "节点管理", marker: "HK Reality 01" },
      { route: "traffic", heading: "流量明细", marker: "用户汇总" },
      { route: "users", heading: "用户管理", marker: "Alice" },
      { route: "packages", heading: "套餐模板管理", marker: "标准套餐" },
      { route: "certificates", heading: "证书管理", marker: "edge.example.com" },
      { route: "templates", heading: "模板管理", marker: "balanced_v3.yaml" },
      { route: "subscribeFiles", heading: "订阅管理", marker: "日常订阅" },
      { route: "customRules", heading: "覆写管理", marker: "私有 DNS 覆写" },
      { route: "rulesConfig", heading: "规则配置", marker: "balanced_v3.yaml" },
      { route: "settings", heading: "系统设置", marker: "后端与采集" },
      { route: "account", heading: "账户中心", marker: "个人资料" },
    ];

    for (const item of routes) {
      await page.goto(`/#/${item.route}`);
      const heading = page.getByRole("heading", { name: item.heading });
      if (item.hiddenHeading) await expect(heading).toBeAttached();
      else await expect(heading).toBeVisible();
      await expect(page.getByText(item.marker, { exact: true }).first()).toBeVisible();
      if (item.route === "certificates") {
        const headers = page.locator(".cw-certificate-table thead th");
        await expect(headers).toHaveCount(6);
        if (viewport.name === "desktop") {
          await expect(headers.first()).toHaveCSS("vertical-align", "middle");
          await expect(headers.first()).toHaveCSS("padding-top", "12px");
          await expect(headers.first()).toHaveCSS("padding-bottom", "12px");
        } else {
          await expect(page.locator(".cw-certificate-table thead")).toHaveCSS("display", "none");
          const firstCard = page.locator(".cw-certificate-table tbody tr").first();
          const cardBox = await firstCard.boundingBox();
          expect(cardBox?.width ?? 0).toBeLessThanOrEqual(viewport.width);
        }
      }
      if (item.route === "settings") {
        const redeemTemplate = page.getByRole("textbox", { name: "复制模板" });
        await expect(redeemTemplate).toHaveAttribute("rows", "10");
        const redeemTemplateHeight = await redeemTemplate.evaluate((element) => element.getBoundingClientRect().height);
        expect(redeemTemplateHeight, `${viewport.name} redeem template should remain readable`).toBeGreaterThanOrEqual(200);
      }
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
  test(`primary workbench entry points open cleanly on ${viewport.name}`, async ({ page }, testInfo) => {
    // This scenario deliberately walks every primary workbench and opens its
    // modal surface. Cold Chromium/CI runs regularly need more than one minute.
    test.setTimeout(120_000);
    const pageErrors: string[] = [];
    const unknownPaths: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize(viewport);
    await mockAPI(page, traffic, unknownPaths, {
      "/api/admin/remote/inbounds": {
        success: true,
        inbounds: ["vless-in", "trojan-in", "ws-in", "grpc-in", "wireguard-in", "shadowsocks-in"].map((tag, index) => ({
          tag,
          listen: "0.0.0.0",
          port: 443 + index,
          protocol: tag.split("-")[0],
          settings: { clients: [] },
          _runtime_status: "running",
        })),
      },
    });

    await page.goto("/#/subscriptions");
    await expect(page.getByRole("link", { name: "导入 Clash" }).first()).toHaveAttribute("href", /^clash:\/\/install-config\?/);
    await expect(page.getByRole("link", { name: "导入 Clash Meta" })).toHaveCount(0);
    await page.getByRole("button", { name: "二维码" }).first().click();
    const qrDialog = page.getByRole("dialog", { name: "订阅二维码" });
    await expect(qrDialog.getByRole("img", { name: "日常订阅 订阅二维码" })).toBeVisible();
    await expect(qrDialog.getByRole("link", { name: "下载 PNG" })).toHaveAttribute("download", "日常订阅.png");
    await expectViewportIntegrity(page, `${viewport.name} local subscription QR`);
    await closeDialog(page);
    const subscriptionActions = page.locator(".cw-subscription-actions").first();
    const cards = page.locator(".cw-subscription-grid > .cw-card");
    const cardTops = await cards.evaluateAll((elements) => elements.slice(0, 2).map((element) => Math.round(element.getBoundingClientRect().top)));
    if (viewport.name === "desktop") {
      expect(Math.max(...cardTops) - Math.min(...cardTops), "desktop should show two subscription cards per row").toBeLessThanOrEqual(2);
      const actionTops = await subscriptionActions.locator(":scope > *").evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().top)));
      expect(Math.max(...actionTops) - Math.min(...actionTops), "desktop subscription actions should stay on one line").toBeLessThanOrEqual(2);
    } else {
      expect(cardTops[1] - cardTops[0], "mobile should stack subscription cards").toBeGreaterThan(20);
    }
    await subscriptionActions.getByRole("button", { name: "删除订阅 日常订阅" }).click();
    await expect(page.getByRole("dialog", { name: "删除订阅" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} subscription delete confirmation`);
    await closeDialog(page);

    await page.goto("/#/generator");
    await page.getByRole("button", { name: "全选" }).click();
    await page.getByRole("main").getByRole("button", { name: "生成订阅文件" }).click();
    const generatedConfig = page.getByLabel("生成的订阅配置");
    await expect(generatedConfig).not.toHaveValue("");
    await expect(generatedConfig).toHaveAttribute("rows", "16");
    const generatedLayout = await generatedConfig.evaluate((element) => {
      const editor = element.getBoundingClientRect();
      const actions = element.closest(".cw-output-section")?.querySelector<HTMLElement>(".cw-generator-actions")?.getBoundingClientRect();
      return { height: editor.height, actionGap: actions ? actions.top - editor.bottom : -1 };
    });
    expect(generatedLayout.height, `${viewport.name} generated config editor should remain readable`).toBeGreaterThanOrEqual(250);
    expect(generatedLayout.actionGap, `${viewport.name} generated config actions should not overlap the editor`).toBeGreaterThanOrEqual(8);
    await expectViewportIntegrity(page, `${viewport.name} generated config editor`);
    await page.getByRole("button", { name: "保存订阅" }).click();
    const saveGeneratedDialog = page.getByRole("dialog", { name: "保存生成的订阅" });
    await expect(saveGeneratedDialog).toBeVisible();
    const descriptionHeight = await saveGeneratedDialog.getByRole("textbox", { name: "说明" }).evaluate((element) => element.getBoundingClientRect().height);
    expect(descriptionHeight, `${viewport.name} regular multiline fields should not collapse`).toBeGreaterThanOrEqual(110);
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
    await expect(serverDialog).toHaveClass(/dialog-wide/);
    await expect(serverDialog).not.toHaveClass(/dialog-extra-wide/);
    await serverDialog.getByRole("tab", { name: "Speedtest" }).click();
    await expect(serverDialog.getByText("服务器线路测速", { exact: true })).toBeVisible();
    await expect(serverDialog.getByText("Ookla Speedtest CLI", { exact: true })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} server speedtest`);
    await serverDialog.getByRole("tab", { name: "Xray 设置" }).click();
    await expect(serverDialog).toHaveClass(/dialog-extra-wide/);
    await expect(serverDialog.getByRole("tab", { name: "基础设置" })).toHaveAttribute("aria-selected", "true");
    await page.screenshot({ path: testInfo.outputPath(`xray-basic-top-${viewport.name}.png`), fullPage: true });
    await serverDialog.getByText("日志", { exact: true }).click();
    await expect(serverDialog.getByRole("combobox", { name: "Xray 日志级别" })).toHaveValue("warning");
    await expectViewportIntegrity(page, `${viewport.name} Xray basic settings`);
    await serverDialog.getByText("日志", { exact: true }).click();
    await serverDialog.getByText("基础路由", { exact: true }).click();
    await expect(serverDialog.getByRole("switch", { name: "屏蔽 BitTorrent" })).toBeVisible();
    const adsPreset = serverDialog.getByRole("button", { name: "全部广告" });
    await expect(adsPreset).toBeVisible();
    await adsPreset.scrollIntoViewIfNeeded();
    await expectViewportIntegrity(page, `${viewport.name} expanded Xray basic routing`);
    await page.screenshot({ path: testInfo.outputPath(`xray-basic-${viewport.name}.png`), fullPage: true });
    await serverDialog.getByRole("tab", { name: "DNS" }).click();
    const dnsEditor = serverDialog.getByLabel("Xray DNS JSON");
    await expect(dnsEditor).toHaveValue("{}");
    await expectViewportIntegrity(page, `${viewport.name} Xray DNS settings`);
    await serverDialog.getByRole("tab", { name: "高级配置" }).click();
    const configEditor = serverDialog.getByLabel("Xray 配置 JSON");
    await expect(configEditor).toHaveValue(/loglevel/);
    const editorHeight = await configEditor.evaluate((element) => element.getBoundingClientRect().height);
    expect(editorHeight, `${viewport.name} Xray editor should use the available dialog height`).toBeGreaterThanOrEqual(viewport.name === "desktop" ? 400 : 300);
    await expectViewportIntegrity(page, `${viewport.name} Xray config editor`);
    await serverDialog.getByRole("tab", { name: "出站规则" }).click();
    await expect(serverDialog.getByText("direct", { exact: true })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} structured outbound list`);
    await page.screenshot({ path: testInfo.outputPath(`xray-outbounds-${viewport.name}.png`), fullPage: true });
    await serverDialog.getByRole("button", { name: "添加出站" }).click();
    const outboundDialog = page.getByRole("dialog", { name: "添加出站" });
    await expect(outboundDialog.getByRole("tab", { name: "基础设置" })).toHaveAttribute("aria-selected", "true");
    await expect(outboundDialog.getByRole("combobox", { name: "出站协议" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} structured outbound editor`);
    await page.screenshot({ path: testInfo.outputPath(`xray-outbound-editor-${viewport.name}.png`), fullPage: true });
    await outboundDialog.getByRole("button", { name: "关闭" }).click();
    await serverDialog.getByRole("tab", { name: "路由规则" }).click();
    await expect(serverDialog.getByText("domain:google.com", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`xray-routing-${viewport.name}.png`), fullPage: true });
    await serverDialog.getByRole("button", { name: "添加规则" }).first().click();
    const routingDialog = page.getByRole("dialog", { name: "添加路由规则" });
    await expect(routingDialog).toHaveClass(/dialog-medium/);
    await expect(routingDialog.getByRole("combobox", { name: "路由网络" })).toHaveValue("");
    const protocolSelect = routingDialog.getByRole("button", { name: "路由协议" });
    await expect(protocolSelect).toBeVisible();
    await expect(routingDialog.getByRole("button", { name: "路由入站 Tag" })).toBeVisible();
    await expect(routingDialog.getByRole("combobox", { name: "路由出站 Tag" }).locator("option")).toHaveText(["(不使用)", "direct"]);
    await protocolSelect.click();
    await expect(routingDialog.getByRole("listbox", { name: "路由协议选项" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} routing protocol selector`);
    await page.screenshot({ path: testInfo.outputPath(`xray-routing-protocol-${viewport.name}.png`), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(routingDialog).toBeVisible();
    await expect(protocolSelect).toHaveAttribute("aria-expanded", "false");
    const inboundSelect = routingDialog.getByRole("button", { name: "路由入站 Tag" });
    await inboundSelect.scrollIntoViewIfNeeded();
    await inboundSelect.click();
    const inboundOptions = routingDialog.getByRole("listbox", { name: "路由入站 Tag选项" });
    await expect(inboundOptions).toBeVisible();
    const inboundMenuBounds = await inboundOptions.evaluate((element) => {
      const menu = element.getBoundingClientRect();
      const body = element.closest(".dialog-body")?.getBoundingClientRect();
      return body ? { menuTop: menu.top, menuBottom: menu.bottom, bodyTop: body.top, bodyBottom: body.bottom } : null;
    });
    expect(inboundMenuBounds).not.toBeNull();
    expect(inboundMenuBounds!.menuTop).toBeGreaterThanOrEqual(inboundMenuBounds!.bodyTop - 1);
    expect(inboundMenuBounds!.menuBottom).toBeLessThanOrEqual(inboundMenuBounds!.bodyBottom + 1);
    await page.keyboard.press("Escape");
    await expect(routingDialog).toBeVisible();
    await expect(inboundSelect).toHaveAttribute("aria-expanded", "false");
    await expect(routingDialog.getByText("高级条件", { exact: true })).toBeVisible();
    await expect(routingDialog.getByLabel("VLESS 路由")).toHaveCount(0);
    await expectViewportIntegrity(page, `${viewport.name} structured routing editor`);
    await page.screenshot({ path: testInfo.outputPath(`xray-routing-editor-${viewport.name}.png`), fullPage: true });
    await routingDialog.getByText("高级条件", { exact: true }).click();
    await expect(routingDialog.getByLabel("路由规则高级 JSON")).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} advanced routing editor`);
    await page.screenshot({ path: testInfo.outputPath(`xray-routing-advanced-${viewport.name}.png`), fullPage: true });
    await routingDialog.getByRole("button", { name: "关闭" }).click();
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
    await page.getByRole("button", { name: "上一步" }).click();
    await page.getByRole("combobox", { name: "节点协议" }).selectOption("wireguard");
    await page.getByRole("button", { name: "下一步" }).click();
    await page.getByLabel("节点名称").fill("视觉 WireGuard");
    await page.getByRole("button", { name: "下一步" }).click();
    const managedNodeDialog = page.getByRole("dialog", { name: "在服务器创建节点" });
    await managedNodeDialog.getByText("查看将提交的 Xray JSON", { exact: true }).click();
    const managedNodePreview = managedNodeDialog.getByLabel("受管节点 Xray JSON");
    await expect(managedNodePreview).toHaveAttribute("rows", "16");
    const managedNodePreviewHeight = await managedNodePreview.evaluate((element) => element.getBoundingClientRect().height);
    expect(managedNodePreviewHeight, `${viewport.name} managed node JSON preview should remain readable`).toBeGreaterThanOrEqual(220);
    await managedNodeDialog.getByRole("button", { name: "创建节点", exact: true }).click();
    const wireGuardCreatedDialog = page.getByRole("dialog", { name: "WireGuard 节点已创建" });
    const wireGuardConfig = wireGuardCreatedDialog.getByLabel("WireGuard 客户端配置");
    await expect(wireGuardConfig).toHaveAttribute("rows", "16");
    const wireGuardEditorHeight = await wireGuardConfig.evaluate((element) => element.getBoundingClientRect().height);
    expect(wireGuardEditorHeight, `${viewport.name} WireGuard client config should remain readable`).toBeGreaterThanOrEqual(320);
    await expectViewportIntegrity(page, `${viewport.name} WireGuard client config`);
    await wireGuardCreatedDialog.getByRole("button", { name: "完成" }).click();
    await page.getByRole("button", { name: "导入已有节点" }).click();
    await expect(page.getByRole("dialog", { name: "导入外部节点" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} node import`);
    await closeDialog(page);
    const lastNodeMenuTrigger = page.getByRole("button", { name: "更多 HK Backup 操作" });
    await lastNodeMenuTrigger.scrollIntoViewIfNeeded();
    await lastNodeMenuTrigger.click();
    const lastNodeMenu = page.getByRole("menu", { name: "HK Backup 节点操作" });
    await expect(lastNodeMenu.getByRole("menuitem", { name: "二维码导入" })).toBeVisible();
    const menuBox = await lastNodeMenu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.y).toBeGreaterThanOrEqual(7);
    expect(menuBox!.x).toBeGreaterThanOrEqual(7);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport.height - 7);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport.width - 7);
    await lastNodeMenu.getByRole("menuitem", { name: "二维码导入" }).click();
    const nodeQRDialog = page.getByRole("dialog", { name: "节点二维码" });
    await expect(nodeQRDialog.getByRole("img", { name: "HK Backup 节点二维码" })).toBeVisible();
    await expect(nodeQRDialog.getByRole("link", { name: "下载 PNG" })).toHaveAttribute("download", "HK Backup.png");
    await expectViewportIntegrity(page, `${viewport.name} node QR import`);
    await closeDialog(page);
    await page.getByRole("button", { name: "工具", exact: true }).click();
    await page.getByRole("menuitem", { name: "节点测速" }).click();
    await expect(page.getByRole("dialog", { name: "测速工作台" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} speed test workbench`);
    await page.getByRole("tab", { name: "线路 Ookla Speedtest" }).click();
    const speedDialog = page.getByRole("dialog", { name: "测速工作台" });
    await expect(speedDialog).toHaveClass(/dialog-extra-wide/);
    await expect(speedDialog.getByText("Example Network / Tokyo", { exact: true })).toBeVisible();
    const implementationFragments = await speedDialog.getByText("Ookla Speedtest CLI", { exact: true }).first().evaluate((element) => element.getClientRects().length);
    expect(implementationFragments, "Speedtest implementation should stay on one line").toBe(1);
    const statusLineOffsets = await speedDialog.locator(".nw-line-status").evaluateAll((groups) => groups.map((group) => {
      const tops = Array.from(group.querySelectorAll(".badge")).map((badge) => badge.getBoundingClientRect().top);
      return tops.length > 1 ? Math.max(...tops) - Math.min(...tops) : 0;
    }));
    expect(Math.max(...statusLineOffsets), "Each Speedtest status cell should stay on one line").toBeLessThanOrEqual(1);
    const metricLineOffsets = await speedDialog.locator(".nw-line-metrics").evaluateAll((groups) => groups.map((group) => {
      const tops = Array.from(group.children).map((metric) => metric.getBoundingClientRect().top);
      return Math.max(...tops) - Math.min(...tops);
    }));
    expect(Math.max(...metricLineOffsets), "Speedtest metrics should stay on one line").toBeLessThanOrEqual(4);
    const cellOverflows = await speedDialog.locator(".nw-line-speed-table tbody tr").evaluateAll((rows) => rows.flatMap((row) => (
      Array.from(row.querySelectorAll<HTMLElement>(".nw-line-status, .nw-line-implementation, .nw-line-metrics, .nw-line-endpoint, .nw-row-actions"))
        .flatMap((content) => {
          const cell = content.closest("td");
          if (!cell) return ["content has no table cell"];
          const contentRect = content.getBoundingClientRect();
          const cellRect = cell.getBoundingClientRect();
          return contentRect.left < cellRect.left - 1 || contentRect.right > cellRect.right + 1
            ? [`${content.className}: ${Math.round(contentRect.left)}-${Math.round(contentRect.right)} outside ${Math.round(cellRect.left)}-${Math.round(cellRect.right)}`]
            : [];
        })
    )));
    expect(cellOverflows, "Speedtest content must stay inside its own table cell").toEqual([]);
    await expectViewportIntegrity(page, `${viewport.name} line speedtest workbench`);
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
    await page.getByRole("button", { name: "用户设置 alice" }).click();
    const userSettings = page.getByRole("dialog", { name: "用户设置 · alice" });
    await expect(userSettings.getByRole("combobox", { name: "用户套餐" })).toBeVisible();
    await expect(userSettings.getByRole("button", { name: /服务器授权与自建节点/ })).toBeVisible();
    if (viewport.name === "desktop") {
      const packageControlTops = await userSettings.locator(".user-package-form").evaluate((form) =>
        Array.from(form.querySelectorAll<HTMLElement>(":scope > .field > select, :scope > .field > input"))
          .map((control) => control.getBoundingClientRect().top),
      );
      expect(packageControlTops).toHaveLength(3);
      expect(Math.max(...packageControlTops) - Math.min(...packageControlTops), "package and date controls must share one row").toBeLessThanOrEqual(1);
    }
    await userSettings.getByRole("button", { name: /资料、备注与订阅短码/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(userSettings.getByRole("tab", { name: "资料与短码" })).toHaveAttribute("aria-selected", "true");
    await expect(userSettings.locator('input[pattern="[A-Za-z0-9_-]{2,16}"]')).toBeVisible();
    await userSettings.getByRole("button", { name: "返回设置总览" }).first().click();
    await expect(userSettings.getByRole("tab", { name: "设置总览" })).toHaveAttribute("aria-selected", "true");
    await expect(userSettings.getByRole("button", { name: /服务器授权与自建节点/ })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} unified user settings`);
    await closeDialog(page);

    await page.goto("/#/packages");
    await expect(page.getByText("用户套餐分配")).toHaveCount(0);
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
    for (const [group, marker] of [
      ["基础设置", "后端与采集"],
      ["订阅设置", "生成能力"],
      ["安全设置", "登录限流"],
      ["用户权限", "普通用户页面"],
      ["通知设置", "Telegram"],
      ["系统维护", "系统更新"],
      ["账户与 API", "管理 API Token"],
    ]) {
      await expect(page.getByRole("heading", { name: group, exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: marker, exact: true })).toBeVisible();
      await expectViewportIntegrity(page, `${viewport.name} settings ${group}`);
    }
    await page.getByRole("button", { name: "打开迁移向导" }).click();
    const migrationDialog = page.getByRole("dialog", { name: "从旧版面板迁移" });
    await expect(migrationDialog.getByRole("tab", { name: "远程拉取" })).toBeVisible();
    await expect(migrationDialog.getByRole("tab", { name: "上传备份" })).toBeVisible();
    await expectViewportIntegrity(page, `${viewport.name} legacy panel import wizard`);
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

test("dashboard preserves the displayed rate when usage exceeds the limit", async ({ page }) => {
  await mockAPI(page, { ...traffic, metrics: { ...traffic.metrics, usage_percentage: 145.2 } });
  await page.goto("/#/dashboard");
  await expect(page.getByText("145.2%", { exact: true })).toBeVisible();
  await expect(page.locator(".metric-progress > span")).toHaveAttribute("style", /width: 100%/);
});

test("a normal user sees quota progress on the dashboard and traffic page", async ({ page }) => {
  await mockAPI(page, traffic, undefined, {
    "/api/user/profile": { ...profile, username: "alice", nickname: "Alice", role: "user", is_admin: false },
    "/api/user/permissions": { pages: [] },
  });

  await page.goto("/#/dashboard");
  await expect(page.getByRole("progressbar", { name: "使用率" })).toHaveAttribute("aria-valuetext", "21.6%");

  await page.goto("/#/traffic");
  await expect(page.getByRole("progressbar", { name: "本期流量使用率" })).toHaveAttribute("aria-valuetext", "21.6%");
  await expect(page.getByRole("tablist", { name: "流量汇总维度" })).toHaveCount(0);
});

test("dashboard reports when every configured server is offline", async ({ page }) => {
  const offlineServers = servers.map((server) => ({ ...server, status: "offline", ws_connected: false }));
  await mockAPI(page, traffic, undefined, {
    "/api/admin/remote-servers": { success: true, servers: offlineServers },
  });
  await page.goto("/#/dashboard");

  await expect(page.getByText("服务器全部离线", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "在线服务器 0 / 2" })).toBeVisible();
});

test("user status controls share one desktop column axis", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAPI(page);
  await page.goto("/#/users");
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();

  const centers = await page.locator(".users-table-surface table").evaluate((table) => {
    const center = (element: Element | null) => {
      if (!element) throw new Error("missing user status table element");
      const rect = element.getBoundingClientRect();
      return rect.left + rect.width / 2;
    };
    const statusCells = table.querySelectorAll("tbody td:nth-child(5)");
    return [
      center(table.querySelector("thead th:nth-child(5)")),
      center(statusCells[0]?.querySelector(".badge") ?? null),
      center(statusCells[1]?.querySelector(".toggle") ?? null),
    ];
  });

  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
});

test("a single package fills the package management canvas", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAPI(page);
  await page.goto("/#/packages");
  await expect(page.locator(".page-packages .package-item")).toBeVisible();

  const widths = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>(".page-packages .package-grid");
    const item = document.querySelector<HTMLElement>(".page-packages .package-item");
    if (!grid || !item) throw new Error("package grid is missing");
    return {
      grid: grid.getBoundingClientRect().width,
      item: item.getBoundingClientRect().width,
    };
  });
  expect(widths.item).toBeCloseTo(widths.grid, 0);
  await expectViewportIntegrity(page, "full-width package card");
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`existing Nginx reuse mode stays clear and locked on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const reuseServers = servers.map((server, index) => index === 0 ? { ...server, nginx_mode: "reuse_existing" } : server);
    await mockAPI(page, traffic, undefined, {
      "/api/admin/remote-servers": { success: true, servers: reuseServers },
    });
    await page.goto("/#/servers");

    await page.getByRole("button", { name: "编辑 Hong Kong Edge" }).click();
    const editDialog = page.getByRole("dialog", { name: "编辑 Hong Kong Edge" });
    await expect(editDialog.getByRole("radio", { name: /复用系统已有 Nginx/ })).toHaveAttribute("aria-checked", "true");
    await expect(editDialog.getByRole("note")).toContainText("不会安装、卸载、覆盖主配置或控制服务启停");
    await expectViewportIntegrity(page, `${viewport.name} existing Nginx edit mode`);
    await editDialog.getByRole("button", { name: "取消" }).click();
    await expect(editDialog).toBeHidden();

    await page.getByRole("button", { name: /^管理(?: Hong Kong Edge)?$/ }).first().click();
    const operationsDialog = page.getByRole("dialog", { name: "Hong Kong Edge" });
    await expect(operationsDialog.getByText("Agent 版本", { exact: true })).toBeVisible();
    await operationsDialog.getByRole("tab", { name: "服务控制" }).click();
    await expect(operationsDialog.getByRole("note")).toContainText("不接管服务启停");
    await expect(operationsDialog.getByText("系统托管", { exact: true })).toBeVisible();
    for (const action of ["启动", "重启", "停止", "卸载"]) {
      await expect(operationsDialog.getByRole("button", { name: `${action} Nginx` })).toBeDisabled();
    }
    await expectViewportIntegrity(page, `${viewport.name} existing Nginx service lock`);
  });

  test(`complete server deletion stays readable on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockAPI(page);
    await page.goto("/#/servers");
    await page.getByRole("button", { name: "删除 Hong Kong Edge" }).click();

    const dialog = page.getByRole("dialog", { name: "删除服务器" });
    await expect(dialog.getByText("共 168 条关联数据")).toBeVisible();
    await expect(dialog.getByText("其他关联").locator("xpath=preceding-sibling::*[1]")).toHaveText("17");
    await expect(dialog.getByText("远端将清理", { exact: true })).toBeVisible();
    await expect(dialog.getByText("远端将保留", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "取消" })).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "卸载 Agent 并删除" });
    await expect(confirm).toBeVisible();
    await expect(confirm).toBeEnabled();
    await expectViewportIntegrity(page, `${viewport.name} complete server deletion`);

    const overflow = await dialog.evaluate((element) => ({
      dialog: element.scrollWidth - element.clientWidth,
      metrics: Array.from(element.querySelectorAll<HTMLElement>(".service-delete-metrics > span"))
        .map((metric) => metric.scrollWidth - metric.clientWidth),
      actions: (element.querySelector<HTMLElement>(".service-delete-actions")?.scrollWidth ?? 0)
        - (element.querySelector<HTMLElement>(".service-delete-actions")?.clientWidth ?? 0),
    }));
    expect(overflow.dialog).toBeLessThanOrEqual(1);
    expect(Math.max(...overflow.metrics)).toBeLessThanOrEqual(1);
    expect(overflow.actions).toBeLessThanOrEqual(1);
  });
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`dashboard ${viewport.name} visual`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockAPI(page);
    await page.goto("/#/dashboard");
    await expect(page.getByRole("heading", { name: "流量信息" })).toBeAttached();
    await expect(page.getByText("使用率", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /在线服务器/ })).toBeVisible();
    const hasViewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasViewportOverflow).toBe(false);
    const screenshot = path.resolve("../docs/change-records/assets/MMX-010", `dashboard-${viewport.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
  });
}
