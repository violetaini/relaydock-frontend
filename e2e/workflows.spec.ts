import { expect, test, type Page, type Request, type Route } from "@playwright/test";

type JsonObject = Record<string, unknown>;

interface ApiCall {
  method: string;
  pathname: string;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
}

interface ApiReply {
  body?: unknown;
  status?: number;
}

type ApiHandler = (call: ApiCall) => ApiReply | Promise<ApiReply>;

const profile = {
  username: "admin",
  email: "admin@example.com",
  nickname: "运维管理员",
  avatar_url: "",
  role: "admin",
  is_admin: true,
};

function server(id: number, name: string, ip: string, extra: JsonObject = {}) {
  return {
    id,
    name,
    status: "online",
    last_heartbeat: new Date().toISOString(),
    ip_address: ip,
    ipv6_enabled: true,
    connection_mode: "websocket",
    current_upload_speed: 1024,
    current_download_speed: 2048,
    xray_running: true,
    xray_version: "25.6.8",
    xray_mode: "external",
    traffic_limit: 0,
    traffic_used: 0,
    traffic_stats_mode: "both",
    traffic_source: "system",
    ws_connected: true,
    encrypted: true,
    inbounds: [],
    ...extra,
  };
}

function node(id: number, name: string, protocol = "vless", extra: JsonObject = {}) {
  return {
    id,
    node_name: name,
    protocol,
    raw_url: "",
    clash_config: "{}",
    parsed_config: "{}",
    enabled: true,
    tag: "",
    tags: [],
    original_server: "Imported",
    inbound_tag: "",
    node_type: "physical",
    updated_at: new Date().toISOString(),
    ...extra,
  };
}

function user(username: string, nickname: string, extra: JsonObject = {}) {
  return {
    username,
    nickname,
    email: "",
    role: "user",
    is_active: true,
    remark: "",
    traffic_used: 0,
    traffic_limit: 0,
    is_over_limit: false,
    speed_limit_mbps: 0,
    device_limit: 0,
    ...extra,
  };
}

function json(body: unknown, status = 200): ApiReply {
  return { body, status };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

class StrictApiMock {
  private readonly handlers = new Map<string, ApiHandler>();
  readonly calls: ApiCall[] = [];
  readonly unexpected: string[] = [];
  readonly handlerErrors: string[] = [];

  constructor(private readonly page: Page) {}

  on(method: string, pathname: string, handler: ApiHandler): this {
    const key = this.key(method, pathname);
    if (this.handlers.has(key)) throw new Error(`duplicate API mock: ${key}`);
    this.handlers.set(key, handler);
    return this;
  }

  callsFor(method: string, pathname: string): ApiCall[] {
    const normalized = method.toUpperCase();
    return this.calls.filter((call) => call.method === normalized && call.pathname === pathname);
  }

  async install() {
    await this.page.addInitScript(() => localStorage.setItem("arcway-session-token", "workflow-test-token"));
    await this.page.route("**/api/**", (route) => this.handle(route));
  }

  async assertClean() {
    expect(this.unexpected, "all API requests must have an explicit method + pathname mock").toEqual([]);
    expect(this.handlerErrors, "API mock handlers must complete without errors").toEqual([]);
  }

  private key(method: string, pathname: string) {
    return `${method.toUpperCase()} ${pathname}`;
  }

  private async handle(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const call: ApiCall = {
      method: request.method().toUpperCase(),
      pathname: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body: this.readBody(request),
      headers: request.headers(),
    };
    this.calls.push(call);
    const key = this.key(call.method, call.pathname);
    const handler = this.handlers.get(key);
    if (!handler) {
      this.unexpected.push(`${key}${url.search}`);
      await route.fulfill({ status: 501, contentType: "application/json", body: JSON.stringify({ error: `Unexpected API request: ${key}` }) });
      return;
    }
    try {
      const reply = await handler(call);
      await route.fulfill({
        status: reply.status ?? 200,
        contentType: "application/json",
        body: JSON.stringify(reply.body ?? {}),
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
      this.handlerErrors.push(`${key}: ${message}`);
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "API mock handler failed" }) });
    }
  }

  private readBody(request: Request): unknown {
    const text = request.postData();
    if (!text) return undefined;
    try { return JSON.parse(text); } catch { return text; }
  }
}

const mocks = new WeakMap<Page, StrictApiMock>();

async function createMock(page: Page) {
  const mock = new StrictApiMock(page)
    .on("GET", "/api/setup/status", () => json({ needs_setup: false }))
    .on("GET", "/api/user/profile", () => json(profile));
  await mock.install();
  mocks.set(page, mock);
  return mock;
}

function registerAdvancedShell(mock: StrictApiMock, servers: JsonObject[]) {
  mock
    .on("GET", "/api/admin/tunnels", () => json({ success: true, tunnels: [], chains: [] }))
    .on("GET", "/api/admin/remote-servers", () => json({ success: true, servers }));
}

test.afterEach(async ({ page }) => {
  await mocks.get(page)?.assertClean();
});

test("creates a server with the exact contract and presents its one-time install command", async ({ page }) => {
  const mock = await createMock(page);
  const servers = [server(1, "Existing Edge", "192.0.2.10")];
  const installCommand = "curl -fsSL https://console.example/install.sh | bash -s -- --token one-time-token";
  mock
    .on("GET", "/api/admin/remote-servers", () => json({ success: true, servers }))
    .on("GET", "/api/admin/dns-providers", () => json({ success: true, providers: [] }))
    .on("POST", "/api/admin/remote-servers/create", (call) => {
      const created = server(2, "Tokyo Edge", "203.0.113.18", { connection_mode: "pull", xray_mode: "embedded" });
      servers.push(created);
      return json({ success: true, message: "created", server: created, install_command: installCommand });
    });

  await page.goto("/#/servers");
  await expect(page.getByRole("heading", { name: "服务管理" })).toBeVisible();
  await page.getByRole("button", { name: "添加服务器" }).click();
  const dialog = page.getByRole("dialog", { name: "添加服务器" });
  await dialog.getByLabel("服务器名称").fill("  Tokyo Edge  ");
  await dialog.getByLabel("公网 IPv4 / 初始地址").fill("  203.0.113.18  ");
  await dialog.getByLabel("连接模式").selectOption("pull");
  await dialog.getByLabel("Xray 模式").selectOption("embedded");
  await dialog.getByLabel("流量限额（GB）").fill("25");
  await dialog.getByRole("switch", { name: "启用 IPv6" }).click();
  await dialog.getByRole("button", { name: "创建并生成命令", exact: true }).click();

  const commandDialog = page.getByRole("dialog", { name: "Tokyo Edge 接入凭据" });
  await expect(commandDialog).toBeVisible();
  await expect(commandDialog.getByText(installCommand, { exact: true })).toBeVisible();
  await expect(page.getByText("Tokyo Edge", { exact: true })).toBeVisible();

  const createCalls = mock.callsFor("POST", "/api/admin/remote-servers/create");
  expect(createCalls).toHaveLength(1);
  expect(createCalls[0].body).toEqual({
    name: "Tokyo Edge",
    ip_address: "203.0.113.18",
    pull_address: "",
    pull_port: 23889,
    pull_token: "",
    connection_mode: "pull",
    listen_port: 23889,
    domain: "",
    xray_mode: "embedded",
    traffic_limit: 25 * 1024 ** 3,
    traffic_used_offset: 0,
    traffic_reset_day: 1,
    traffic_stats_mode: "both",
    traffic_source: "system",
    ipv6_enabled: false,
    ddns_enabled: false,
    ddns_provider_id: 0,
    steal_self: false,
    front_service: "xray",
    use_443: false,
    steal_mode: "default",
    site_type: "static",
    site_value: "",
  });
  expect(createCalls[0].headers.authorization).toBe("Bearer workflow-test-token");
});

test("parses node URIs, previews them, and sends the complete batch payload", async ({ page }) => {
  const mock = await createMock(page);
  const storedNodes: JsonObject[] = [];
  const proxies = [
    { name: "HK Reality", type: "vless", server: "hk.example.com", port: 443, tls: true },
    { name: "JP Hysteria", type: "hysteria2", server: "jp.example.com", port: 8443, password: "secret" },
  ];
  mock
    .on("GET", "/api/admin/nodes", () => json({ nodes: storedNodes }))
    .on("GET", "/api/admin/managed-node-offers", () => json({ offers: [] }))
    .on("GET", "/api/admin/speedtest/results", () => json({ results: [] }))
    .on("GET", "/api/user/config", () => json({
      force_sync_external: false,
      match_rule: "node_name",
      sync_scope: "saved_only",
      keep_node_name: true,
      cache_expire_minutes: 0,
      sync_traffic: true,
      node_name_filter: "",
      append_sub_info: false,
      custom_rules_enabled: true,
      enable_short_link: false,
      use_new_template_system: true,
      enable_proxy_provider: false,
      node_order: [],
      proxy_groups_source_url: "",
      client_compatibility_mode: false,
    }))
    .on("POST", "/api/admin/nodes/parse-uris", () => json({ proxies }))
    .on("POST", "/api/admin/nodes/batch", (call) => {
      const submitted = (call.body as { nodes: JsonObject[] }).nodes;
      storedNodes.splice(0, storedNodes.length, ...submitted.map((item, index) => node(index + 1, String(item.node_name), String(item.protocol), item)));
      return json({ nodes: storedNodes });
    });

  await page.goto("/#/nodes");
  await page.getByRole("button", { name: "导入已有节点" }).click();
  const dialog = page.getByRole("dialog", { name: "导入外部节点" });
  const source = "vless://first\nhysteria2://second";
  await dialog.getByLabel("节点内容").fill(source);
  await dialog.getByLabel("分类标签").fill("  亚太  ");
  await dialog.getByRole("switch", { name: "强制跳过证书校验" }).click();
  await dialog.getByRole("button", { name: "解析并预览" }).click();
  await expect(dialog.getByText("识别到 2 个节点")).toBeVisible();
  await expect(dialog.getByText("HK Reality", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "保存 2 个节点" }).click();

  await expect(page.getByRole("status").filter({ hasText: "已导入 2 个节点" })).toBeVisible();
  await expect(page.getByText("HK Reality", { exact: true })).toBeVisible();
  await expect(page.getByText("JP Hysteria", { exact: true })).toBeVisible();

  expect(mock.callsFor("POST", "/api/admin/nodes/parse-uris").map((call) => call.body)).toEqual([
    { content: source, force_node_skip_cert: true },
  ]);
  const expectedNodes = proxies.map((proxy) => ({
    raw_url: "",
    node_name: proxy.name,
    protocol: proxy.type,
    parsed_config: JSON.stringify(proxy),
    clash_config: JSON.stringify(proxy),
    enabled: true,
    tag: "亚太",
    tags: ["亚太"],
  }));
  expect(mock.callsFor("POST", "/api/admin/nodes/batch").map((call) => call.body)).toEqual([{ nodes: expectedNodes }]);
});

test("creates and publishes a managed Shadowsocks 2022 node with exact payload and source classification", async ({ page }) => {
  const mock = await createMock(page);
  const embeddedServer = server(7, "Hong Kong Embedded", "198.51.100.27", {
    domain: "hk-edge.example.com",
    xray_mode: "embedded",
  });
  const importedNode = node(1, "Imported VLESS", "vless", {
    original_server: "",
    inbound_tag: "",
    clash_config: JSON.stringify({ name: "Imported VLESS", type: "vless", server: "vendor.example.com", port: 443 }),
  });
  const routedNode = node(2, "Private Route", "socks5", {
    original_server: "Hong Kong Embedded",
    inbound_tag: "",
    node_type: "routed",
    clash_config: JSON.stringify({ name: "Private Route", type: "socks5", server: "127.0.0.1", port: 18080 }),
  });
  const storedNodes: JsonObject[] = [importedNode, routedNode];
  const offers: JsonObject[] = [];
  const serverKey = "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=";
  const userKey = "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=";

  mock
    .on("GET", "/api/admin/nodes", () => json({ nodes: storedNodes }))
    .on("GET", "/api/admin/managed-node-offers", () => json({ offers }))
    .on("GET", "/api/admin/speedtest/results", () => json({ results: [] }))
    .on("GET", "/api/user/config", () => json({
      force_sync_external: false,
      match_rule: "node_name",
      sync_scope: "saved_only",
      keep_node_name: true,
      cache_expire_minutes: 0,
      sync_traffic: true,
      node_name_filter: "",
      append_sub_info: false,
      custom_rules_enabled: true,
      enable_short_link: false,
      use_new_template_system: true,
      enable_proxy_provider: false,
      node_order: [],
      proxy_groups_source_url: "",
      client_compatibility_mode: false,
    }))
    .on("GET", "/api/admin/remote-servers", () => json({ success: true, servers: [embeddedServer] }))
    .on("GET", "/api/admin/remote/inbounds", (call) => {
      expect(call.query).toEqual({ server_id: "7" });
      return json({ success: true, inbounds: [{ tag: "existing", protocol: "vless", port: 443 }] });
    })
    .on("GET", "/api/admin/certificates", () => json({ success: true, certificates: [] }))
    .on("GET", "/api/admin/remote/reality-domains", (call) => {
      expect(call.query).toEqual({ server_id: "7" });
      return json({ success: true, domains: [{ domain: "www.cloudflare.com", success: true, latency_ms: 18 }] });
    })
    .on("POST", "/api/admin/xray/generate-x25519", () => json({ privateKey: "A".repeat(43), publicKey: "B".repeat(43) }))
    .on("POST", "/api/admin/managed-nodes/create", (call) => {
      expect(call.query).toEqual({ server_id: "7" });
      const created = node(42, "HK SS 2022", "shadowsocks", {
        original_server: "Hong Kong Embedded",
        inbound_tag: "ss2022-hk-user",
        clash_config: JSON.stringify({
          name: "HK SS 2022",
          type: "ss",
          server: "hk-edge.example.com",
          port: 18443,
          cipher: "2022-blake3-aes-256-gcm",
          password: `${serverKey}:${userKey}`,
        }),
      });
      storedNodes.push(created);
      return json({ success: true, node_id: 42, node: created });
    })
    .on("POST", "/api/admin/managed-node-offers", (call) => {
      const body = call.body as { node_id: number; enabled: boolean; sort_order: number };
      offers.push({ id: 9, server_id: 7, inbound_tag: "ss2022-hk-user", ...body });
      return json({ success: true, offer: offers[0] });
    });

  await page.goto("/#/nodes");
  const sourceFilters = page.getByLabel("节点来源");
  await expect(sourceFilters.getByRole("button", { name: /全部节点\s+2/ })).toBeVisible();
  await expect(sourceFilters.getByRole("button", { name: /服务器创建\s+0/ })).toBeVisible();
  await expect(sourceFilters.getByRole("button", { name: /外部导入\s+1/ })).toBeVisible();
  await expect(sourceFilters.getByRole("button", { name: /路由出站\s+1/ })).toBeVisible();

  await page.getByRole("button", { name: "在服务器创建" }).click();
  const dialog = page.getByRole("dialog", { name: "在服务器创建节点" });
  await expect(dialog.getByRole("button", { name: /Hong Kong Embedded/ })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "下一步" }).click();
  await dialog.getByRole("combobox", { name: "节点协议" }).selectOption("shadowsocks");
  await expect(dialog.getByRole("combobox", { name: "节点传输与安全预设" })).toHaveValue("shadowsocks");
  await dialog.getByRole("button", { name: "下一步" }).click();

  await dialog.getByLabel("节点名称").fill("  HK SS 2022  ");
  await dialog.getByLabel("入站 Tag").fill("  ss2022-hk-user  ");
  await dialog.getByLabel("监听端口").fill("18443");
  await dialog.getByLabel("Shadowsocks 加密方式").selectOption("2022-blake3-aes-256-gcm");
  await dialog.getByLabel("服务端主密钥").fill(serverKey);
  await dialog.getByLabel("初始用户密钥").fill(userKey);
  await dialog.getByRole("switch", { name: "创建后发布到用户自助目录" }).click();
  await dialog.getByLabel("目录排序").fill("8");
  await dialog.getByRole("button", { name: "下一步" }).click();

  await expect(dialog.getByText("HK SS 2022", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Shadowsocks", { exact: true })).toBeVisible();
  await expect(dialog.getByText("18443 · V4", { exact: true })).toBeVisible();
  await expect(dialog.getByText("创建后发布", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "创建节点" }).click();

  await expect(page.getByRole("status").filter({ hasText: "受管节点已创建并发布给用户" })).toBeVisible();
  await expect(sourceFilters.getByRole("button", { name: /全部节点\s+3/ })).toBeVisible();
  await expect(sourceFilters.getByRole("button", { name: /服务器创建\s+1/ })).toBeVisible();
  await sourceFilters.getByRole("button", { name: /服务器创建\s+1/ }).click();
  await expect(page.getByText("HK SS 2022", { exact: true })).toBeVisible();
  await expect(page.getByText("Imported VLESS", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Private Route", { exact: true })).toHaveCount(0);
  await sourceFilters.getByRole("button", { name: /外部导入\s+1/ }).click();
  await expect(page.getByText("Imported VLESS", { exact: true })).toBeVisible();
  await expect(page.getByText("HK SS 2022", { exact: true })).toHaveCount(0);
  await sourceFilters.getByRole("button", { name: /路由出站\s+1/ }).click();
  await expect(page.getByText("Private Route", { exact: true })).toBeVisible();

  expect(mock.callsFor("POST", "/api/admin/managed-nodes/create").map((call) => call.body)).toEqual([{
    action: "add",
    node_name: "HK SS 2022",
    ip_version: "v4",
    inbound: {
      tag: "ss2022-hk-user",
      listen: "0.0.0.0",
      port: 18443,
      protocol: "shadowsocks",
      settings: {
        method: "2022-blake3-aes-256-gcm",
        password: serverKey,
        network: "tcp,udp",
        clients: [{ password: userKey, email: "admin", level: 0 }],
      },
      sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], routeOnly: false },
    },
  }]);
  expect(mock.callsFor("POST", "/api/admin/managed-node-offers").map((call) => call.body)).toEqual([{
    node_id: 42,
    enabled: true,
    sort_order: 8,
  }]);
});

test("creates plain VLESS WebSocket on an IP-only server without a domain or TLS rewrite", async ({ page }) => {
  const mock = await createMock(page);
  const embeddedServer = server(8, "IP Only Edge", "198.51.100.28", {
    domain: "",
    xray_mode: "embedded",
  });
  const storedNodes: JsonObject[] = [];

  mock
    .on("GET", "/api/admin/nodes", () => json({ nodes: storedNodes }))
    .on("GET", "/api/admin/managed-node-offers", () => json({ offers: [] }))
    .on("GET", "/api/admin/speedtest/results", () => json({ results: [] }))
    .on("GET", "/api/user/config", () => json({
      force_sync_external: false,
      match_rule: "node_name",
      sync_scope: "saved_only",
      keep_node_name: true,
      cache_expire_minutes: 0,
      sync_traffic: true,
      node_name_filter: "",
      append_sub_info: false,
      custom_rules_enabled: true,
      enable_short_link: false,
      use_new_template_system: true,
      enable_proxy_provider: false,
      node_order: [],
      proxy_groups_source_url: "",
      client_compatibility_mode: false,
    }))
    .on("GET", "/api/admin/remote-servers", () => json({ success: true, servers: [embeddedServer] }))
    .on("GET", "/api/admin/remote/inbounds", () => json({ success: true, inbounds: [] }))
    .on("GET", "/api/admin/certificates", () => json({ success: true, certificates: [] }))
    .on("GET", "/api/admin/remote/reality-domains", () => json({ success: true, domains: [] }))
    .on("POST", "/api/admin/xray/generate-x25519", () => json({ privateKey: "A".repeat(43), publicKey: "B".repeat(43) }))
    .on("POST", "/api/admin/managed-nodes/create", (call) => {
      expect(call.query).toEqual({ server_id: "8" });
      const created = node(43, "IP VLESS WS", "vless", {
        original_server: "IP Only Edge",
        inbound_tag: "vless-ws-ip",
        clash_config: JSON.stringify({
          name: "IP VLESS WS",
          type: "vless",
          server: "198.51.100.28",
          port: 18080,
          network: "ws",
          "ws-opts": { path: "/socket" },
        }),
      });
      storedNodes.push(created);
      return json({ success: true, node_id: 43, node: created });
    });

  await page.goto("/#/nodes");
  await page.getByRole("button", { name: "在服务器创建" }).click();
  const dialog = page.getByRole("dialog", { name: "在服务器创建节点" });
  await expect(dialog.getByRole("button", { name: /IP Only Edge/ })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "下一步" }).click();

  const preset = dialog.getByRole("combobox", { name: "节点传输与安全预设" });
  await expect(preset.getByRole("option", { name: /VLESS WSS/ })).toHaveAttribute("disabled", "");
  await expect(preset.getByRole("option", { name: "VLESS WS", exact: true })).not.toHaveAttribute("disabled", "");
  await preset.selectOption("vless-ws");
  await dialog.getByRole("button", { name: "下一步" }).click();

  await dialog.getByLabel("节点名称").fill("IP VLESS WS");
  await dialog.getByLabel("入站 Tag").fill("vless-ws-ip");
  await dialog.getByLabel("监听端口").fill("18080");
  await dialog.getByLabel("WebSocket Host（可选）").fill("");
  await dialog.getByLabel("WebSocket 路径").fill("/socket");
  await dialog.getByRole("button", { name: "下一步" }).click();
  await dialog.getByRole("button", { name: "创建节点" }).click();

  await expect(page.getByRole("status").filter({ hasText: "受管节点已创建" })).toBeVisible();
  expect(mock.callsFor("POST", "/api/admin/managed-nodes/create").map((call) => call.body)).toEqual([{
    action: "add",
    node_name: "IP VLESS WS",
    ip_version: "v4",
    inbound: {
      tag: "vless-ws-ip",
      listen: "0.0.0.0",
      port: 18080,
      protocol: "vless",
      settings: {
        clients: [{ id: expect.any(String), email: "admin" }],
        decryption: "none",
      },
      streamSettings: {
        network: "ws",
        security: "none",
        wsSettings: { path: "/socket" },
      },
      sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], routeOnly: false },
    },
  }]);
});

test("creates a user, preserves the one-time password, and disables it", async ({ page }) => {
  const mock = await createMock(page);
  const users = [user("admin", "运维管理员", { role: "admin" })];
  mock
    .on("GET", "/api/admin/users", () => json({ users }))
    .on("GET", "/api/admin/packages", () => json({ packages: [] }))
    .on("POST", "/api/admin/users/create", (call) => {
      const form = call.body as Record<string, string>;
      users.push(user(form.username, form.nickname, { email: form.email, remark: form.remark }));
      return json({ username: form.username, password: form.password || "generated-password" });
    })
    .on("POST", "/api/admin/users/status", (call) => {
      const change = call.body as { username: string; is_active: boolean };
      const target = users.find((item) => item.username === change.username);
      if (target) target.is_active = change.is_active;
      return json({ success: true });
    });

  await page.goto("/#/users");
  await page.getByRole("button", { name: "新建用户" }).click();
  const dialog = page.getByRole("dialog", { name: "新建用户" });
  await dialog.getByLabel("用户名").fill("carol");
  await dialog.getByLabel("显示名称").fill("Carol Chen");
  await dialog.getByLabel("邮箱").fill("carol@example.com");
  await dialog.getByLabel("初始密码").fill("correct-horse-42");
  await dialog.getByLabel("备注").fill("QA account");
  await dialog.getByRole("button", { name: "创建用户", exact: true }).click();
  const resultDialog = page.getByRole("dialog", { name: "用户 carol 已创建" });
  await expect(resultDialog.getByText("correct-horse-42", { exact: true })).toBeVisible();
  await resultDialog.getByRole("button", { name: "完成" }).click();

  const row = page.getByRole("row").filter({ hasText: "carol" });
  await expect(row).toBeVisible();
  expect(mock.callsFor("POST", "/api/admin/users/create").map((call) => call.body)).toEqual([{
    username: "carol",
    nickname: "Carol Chen",
    email: "carol@example.com",
    password: "correct-horse-42",
    remark: "QA account",
  }]);

  await row.getByRole("button", { name: "用户设置 carol" }).click();
  await page.getByRole("dialog", { name: "用户设置 · carol" }).getByRole("button", { name: "停用用户" }).click();
  await expect(row.getByRole("switch", { name: "启用用户 carol" })).toHaveAttribute("aria-checked", "false");
  expect(mock.callsFor("POST", "/api/admin/users/status").map((call) => call.body)).toEqual([
    { username: "carol", is_active: false },
  ]);
});

test("submits tunnel server_ids in the order shown after reordering", async ({ page }) => {
  const mock = await createMock(page);
  const servers = [
    server(1, "Hong Kong Edge", "198.51.100.11"),
    server(2, "Tokyo Edge", "198.51.100.12"),
    server(3, "US West Edge", "198.51.100.13"),
  ];
  const chains: JsonObject[] = [];
  mock
    .on("GET", "/api/admin/remote-servers", () => json({ success: true, servers }))
    .on("GET", "/api/admin/tunnels", () => json({ success: true, tunnels: [], chains }))
    .on("POST", "/api/admin/tunnel-chains", (call) => {
      const body = call.body as { label: string; server_ids: number[]; entry_port: number; target_address: string; target_port: number };
      chains.push({
        label: body.label,
        entry_server: body.server_ids[0],
        entry_port: body.entry_port,
        final_target: `${body.target_address}:${body.target_port}`,
        hops: body.server_ids.map((id, index) => ({
          server_id: id,
          server_name: String(servers.find((item) => item.id === id)?.name),
          tag: `tunnel-${body.label}-h${index}`,
          listen_port: body.entry_port,
          target_address: body.target_address,
          target_port: body.target_port,
        })),
      });
      return json({ success: true });
    });

  await page.goto("/#/advanced");
  await page.getByRole("button", { name: "创建链路" }).click();
  const dialog = page.getByRole("dialog", { name: "创建链式端口转发" });
  await dialog.getByLabel("链路名称").fill("hk-us-media");
  await dialog.getByLabel("入口端口").fill("24433");
  await dialog.getByLabel("最终目标地址").fill("media.example.com");
  await dialog.getByLabel("最终目标端口").fill("443");

  const chooser = dialog.getByLabel("添加服务器");
  for (const id of [2, 1, 3]) {
    await chooser.selectOption(String(id));
    await dialog.getByRole("button", { name: "加入" }).click();
  }
  const routeOrder = dialog.locator(".route-order");
  await routeOrder.locator(":scope > div").filter({ hasText: "US West Edge" }).getByRole("button", { name: "上移" }).click();
  await expect(routeOrder.locator("strong")).toHaveText(["Tokyo Edge", "US West Edge", "Hong Kong Edge"]);
  await dialog.getByRole("button", { name: "创建链路" }).click();

  await expect(page.getByText("hk-us-media", { exact: true })).toBeVisible();
  expect(mock.callsFor("POST", "/api/admin/tunnel-chains").map((call) => call.body)).toEqual([{
    label: "hk-us-media",
    server_ids: [2, 3, 1],
    entry_port: 24433,
    target_address: "media.example.com",
    target_port: 443,
  }]);
});

test("does not report routed deletion success when routing returns success false", async ({ page }) => {
  const mock = await createMock(page);
  const servers = [server(1, "Hong Kong Edge", "198.51.100.11"), server(2, "Tokyo Edge", "198.51.100.12")];
  const routed = {
    kind: "routed",
    server_id: 1,
    server_name: "Hong Kong Edge",
    is_federated: false,
    tag: "route-media",
    listen_port: 0,
    target_address: "media.example.com",
    target_port: 443,
    network: "tcp",
  };
  mock
    .on("GET", "/api/admin/remote-servers", () => json({ success: true, servers }))
    .on("GET", "/api/admin/tunnels", () => json({ success: true, tunnels: [routed], chains: [] }))
    .on("GET", "/api/admin/remote/routing", () => json({ success: true, routing: { rules: [{ outboundTag: "route-media" }] } }))
    .on("POST", "/api/admin/remote/routing", () => json({ success: false, error: "规则仍在使用" }))
    .on("POST", "/api/admin/remote/outbounds", () => json({ success: true }));

  await page.goto("/#/advanced");
  await page.getByRole("button", { name: "删除隧道 route-media" }).click();
  await page.getByRole("dialog", { name: "删除隧道" }).getByRole("button", { name: "确认删除" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "规则仍在使用" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "隧道已删除" })).toHaveCount(0);
  await expect(page.getByText("route-media", { exact: true })).toBeVisible();
  expect(mock.callsFor("POST", "/api/admin/remote/routing").map((call) => call.body)).toEqual([
    { action: "remove_rule", index: 0 },
  ]);
  expect(mock.callsFor("POST", "/api/admin/remote/outbounds")).toHaveLength(0);
});

test("keeps a one-time share visible after clipboard failure until manual confirmation", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new DOMException("clipboard denied", "NotAllowedError")) },
    });
  });
  const mock = await createMock(page);
  const servers = [server(1, "Hong Kong Edge", "198.51.100.11"), server(2, "Tokyo Edge", "198.51.100.12")];
  const shares: JsonObject[] = [];
  const secret = "arcway-share-once-4f83d";
  registerAdvancedShell(mock, servers);
  mock
    .on("GET", "/api/admin/server-share/list", (call) => {
      const selected = Number(call.query.server_id);
      return json({ shares: shares.filter((share) => share.server_id === selected) });
    })
    .on("POST", "/api/admin/server-share/create", (call) => {
      const body = call.body as { server_id: number; label: string };
      shares.push({ id: 8, server_id: body.server_id, label: body.label, created_at: new Date().toISOString() });
      return json({ share_token: secret });
    });

  await page.goto("/#/advanced");
  await page.getByRole("tab", { name: "联邦分享" }).click();
  await page.getByRole("button", { name: "创建分享" }).click();
  const createDialog = page.getByRole("dialog", { name: "创建服务器分享" });
  await createDialog.getByLabel("分享标签").fill("Tokyo partner");
  await createDialog.getByRole("button", { name: "创建分享" }).click();

  const secretDialog = page.getByRole("dialog", { name: "分享令牌" });
  await expect(secretDialog.getByText(secret, { exact: true })).toBeVisible();
  await secretDialog.getByRole("button", { name: "复制令牌", exact: true }).click();
  await expect(secretDialog.getByText("无法访问剪贴板，请手动选择并保存上方令牌。")).toBeVisible();
  await expect(secretDialog.getByRole("button", { name: "重试复制" })).toBeVisible();
  const manual = secretDialog.getByRole("button", { name: "已手动保存" });
  await expect(manual).toBeEnabled();
  await manual.click();
  await expect(secretDialog).toHaveCount(0);

  expect(mock.callsFor("POST", "/api/admin/server-share/create").map((call) => call.body)).toEqual([
    { server_id: 1, label: "Tokyo partner" },
  ]);
  for (const call of mock.callsFor("GET", "/api/admin/server-share/list")) {
    expect(call.query).toEqual({ server_id: "1" });
  }
});

test("ignores a late WARP response after switching servers", async ({ page }) => {
  const mock = await createMock(page);
  const servers = [server(1, "Hong Kong Edge", "198.51.100.11"), server(2, "Tokyo Edge", "198.51.100.12")];
  const oldResponse = deferred<void>();
  registerAdvancedShell(mock, servers);
  mock.on("GET", "/api/admin/remote/warp/status", async (call) => {
    if (call.query.server_id === "1") {
      await oldResponse.promise;
      return json({ installed: true, license_active: false, addr_v4: "172.16.1.1", addr_v6: "2606:4700::1" });
    }
    return json({ installed: true, license_active: true, addr_v4: "172.16.2.2", addr_v6: "2606:4700::2" });
  });

  await page.goto("/#/advanced");
  await page.getByRole("tab", { name: "WARP" }).click();
  const select = page.getByLabel("服务器");
  await expect(select).toBeVisible();
  await expect.poll(() => mock.callsFor("GET", "/api/admin/remote/warp/status").some((call) => call.query.server_id === "1")).toBe(true);
  await select.selectOption("2");
  await expect(page.getByText("172.16.2.2", { exact: true })).toBeVisible();
  await expect(page.getByText("License 已配置", { exact: true })).toBeVisible();

  oldResponse.resolve();
  await expect.poll(() => mock.callsFor("GET", "/api/admin/remote/warp/status").filter((call) => call.query.server_id === "1").length).toBeGreaterThan(0);
  await page.waitForTimeout(100);
  await expect(select).toHaveValue("2");
  await expect(page.getByText("172.16.2.2", { exact: true })).toBeVisible();
  await expect(page.getByText("172.16.1.1", { exact: true })).toHaveCount(0);
});

test("submits download speed parameters and polls a running result to completion", async ({ page }) => {
  const mock = await createMock(page);
  const servers = [server(1, "Hong Kong Edge", "198.51.100.11"), server(2, "Tokyo Edge", "198.51.100.12")];
  const nodes = [node(5, "HK Reality"), node(8, "JP Hysteria", "hysteria2")];
  let submitted = false;
  let postSubmitResultRequests = 0;
  registerAdvancedShell(mock, servers);
  mock
    .on("GET", "/api/admin/nodes", () => json({ nodes }))
    .on("GET", "/api/admin/speedtest/mihomo-status", () => json({ success: true, ready: true, path: "/opt/arcway/data/bin/mihomo" }))
    .on("GET", "/api/admin/speedtest/results", (call) => {
      if (!submitted) return json({ success: true, results: [] });
      postSubmitResultRequests++;
      const running = postSubmitResultRequests === 1;
      return json({ success: true, results: [{
        id: 41,
        node_id: 8,
        node_name: "JP Hysteria",
        source: "master_local",
        down_mbps: running ? 0 : 286.4,
        latency_ms: running ? 0 : 42,
        test_bytes: running ? 0 : 75 * 1024 ** 2,
        status: running ? "running" : "ok",
        egress_ip: running ? "" : "203.0.113.80",
        tested_by: "admin",
        created_at: new Date().toISOString(),
      }] });
    })
    .on("POST", "/api/admin/speedtest/run", () => {
      submitted = true;
      return json({ success: true, id: 41 });
    });

  await page.goto("/#/advanced");
  await page.getByRole("tab", { name: "节点测速" }).click();
  const form = page.locator(".speedtest-form");
  await form.getByLabel("节点").selectOption("8");
  await form.getByLabel("测试类型").selectOption("download");
  await form.getByLabel("流量（MB）").fill("75");
  await form.getByLabel("线程").selectOption("4");
  await form.getByRole("button", { name: "开始测速" }).click();

  await expect(page.getByText("进行中", { exact: true })).toBeVisible();
  await expect(page.getByText("286.4 Mbps", { exact: true })).toBeVisible({ timeout: 6_000 });
  await expect(page.getByText("完成", { exact: true })).toBeVisible();
  expect(postSubmitResultRequests).toBeGreaterThanOrEqual(2);
  expect(mock.callsFor("POST", "/api/admin/speedtest/run").map((call) => call.body)).toEqual([{
    node_id: 8,
    bytes: 75 * 1024 ** 2,
    threads: 4,
    latency_only: false,
  }]);
  for (const call of mock.callsFor("GET", "/api/admin/speedtest/results")) {
    expect(call.query).toEqual({ limit: "50" });
  }
});
