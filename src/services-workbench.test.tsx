import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { consumeRemoteServiceStream, parseSSELog, ServicesWorkbenchPage } from "./services-workbench";
import type { RemoteServer } from "./types";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

const onlineServer: RemoteServer = {
  id: 11,
  name: "Edge Hong Kong",
  status: "connected",
  last_heartbeat: new Date().toISOString(),
  ip_address: "203.0.113.11",
  ip_address_v6: "2001:db8::11",
  ipv6_enabled: true,
  domain: "hk.example.com",
  connection_mode: "websocket",
  listen_port: 23889,
  current_upload_speed: 1024,
  current_download_speed: 2048,
  xray_running: true,
  xray_version: "Xray 25.1",
  xray_mode: "external",
  traffic_limit: 100 * 1024 ** 3,
  traffic_used: 25 * 1024 ** 3,
  traffic_stats_mode: "both",
  traffic_source: "system",
  ws_connected: true,
  encrypted: true,
  agent_uninstall_v2: true,
  nginx_mode: "managed",
  inbounds: [{ tag: "vless-in", protocol: "vless", port: 443, uplink: 1, downlink: 2 }],
};

const offlineServer: RemoteServer = {
  ...onlineServer,
  id: 12,
  name: "Edge Tokyo",
  status: "offline",
  ip_address: "203.0.113.12",
  ip_address_v6: undefined,
  ws_connected: false,
  encrypted: false,
  xray_running: false,
  xray_version: "",
};

function mockServerReads(servers: RemoteServer[] = [onlineServer, offlineServer], resources: {
  inbounds?: Record<string, unknown>[];
  outbounds?: Record<string, unknown>[];
  routing?: { rules?: Record<string, unknown>[]; domainStrategy?: string; balancers?: Record<string, unknown>[] };
  dnsProviders?: Record<string, unknown>[];
  ddnsStatuses?: Record<string, unknown>[];
  lineSpeedtestTargets?: Record<string, unknown>[];
  certificates?: Record<string, unknown>[];
  deleteImpact?: Record<string, unknown>;
  serviceStatus?: Record<string, unknown>;
} = {}) {
  let ddnsStatusRead = 0;
  return vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
    if (path === "/api/admin/remote-servers") return { success: true, servers } as T;
    if (path.startsWith("/api/admin/remote-servers/delete-impact?server_id=")) {
      const serverID = Number(new URLSearchParams(path.split("?")[1]).get("server_id"));
      const server = servers.find((item) => item.id === serverID) ?? servers[0];
      return (resources.deleteImpact ?? {
        success: true,
        server: {
          id: server?.id,
          name: server?.name,
          ownership: server?.is_federated ? "shared" : "owned",
          online: server ? server.status !== "offline" : false,
          agent_uninstall_v2: server?.agent_uninstall_v2 ?? null,
          xray_mode: server?.xray_mode,
          warp_installed: server?.warp_installed ?? false,
        },
        counts: {
          nodes: 3,
          subaccounts: 2,
          inbound_configs: 4,
          outbounds: 5,
          xray_snapshots: 6,
          batch_inbounds: 1,
          batch_outbounds: 2,
          node_traffic: 8,
          user_traffic: 9,
          stat_records: 10,
          total: 50,
        },
        blocker: null,
      }) as T;
    }
    if (path === "/api/admin/dns-providers") return { success: true, providers: resources.dnsProviders ?? [
      { id: 8, name: "Cloudflare 主账号", provider_type: "cloudflare" },
      { ID: 9, Name: "DNSPod 备用", ProviderType: "dnspod" },
    ] } as T;
    if (path === "/api/admin/servers/11/ddns-status") {
      const statuses = resources.ddnsStatuses ?? [{
        success: true,
        id: 11,
        name: "Edge Hong Kong",
        ddns_enabled: false,
        ddns_provider_id: 0,
        ddns_provider_name: "",
        ddns_last_synced_at: "",
        ddns_last_error: "",
        ddns_pending: false,
        pull_address: "",
      }];
      const value = statuses[Math.min(ddnsStatusRead, statuses.length - 1)];
      ddnsStatusRead += 1;
      return value as T;
    }
    if (path.includes("/api/admin/remote/services/status")) return (resources.serviceStatus ?? {
      success: true,
      xray: { installed: true, running: true, version: "Xray 25.1" },
      nginx: { installed: true, running: true, version: "nginx/1.26" },
    }) as T;
    if (path.includes("/api/admin/remote/agent/version-info")) return { server_id: 11, current: "0.3.0", latest: "0.3.1", upgrade_available: true } as T;
    if (path.includes("/api/admin/remote/system/info")) return { success: true, hostname: "edge-hk", uptime: "3600", loadavg: "0.10 0.20 0.30 1/100 1", memory: { MemAvailable: "1024 MB" } } as T;
    if (path.includes("/api/admin/remote-servers/reveal-token")) return { success: true, token: "revealed-server-token", pull_token: "existing-agent-token", agent_token: "existing-agent-token", install_command: "authoritative-install-command" } as T;
    if (path === "/api/admin/remote/inbounds?server_id=11") return { success: true, inbounds: resources.inbounds ?? [] } as T;
    if (path === "/api/admin/remote/outbounds?server_id=11") return { success: true, outbounds: resources.outbounds ?? [] } as T;
    if (path === "/api/admin/remote/routing?server_id=11") return { success: true, routing: resources.routing ?? { rules: [] } } as T;
    if (path === "/api/admin/line-speedtest/targets") return { success: true, targets: resources.lineSpeedtestTargets ?? [] } as T;
    if (path === "/api/admin/certificates/valid") return { success: true, certificates: resources.certificates ?? [] } as T;
    if (path === "/api/admin/xray-examples") return { success: true, combinations: [
      { dir_name: "VLESS-TCP-XTLS-Vision-REALITY", protocol: "vless", transport: "tcp", security: "reality", has_config: true },
      { dir_name: "VLESS-WSS-Nginx", protocol: "vless", transport: "wss", security: "tls", has_config: true },
    ] } as T;
    if (path === "/api/admin/remote/reality-domains?server_id=11") return { success: true, domains: [
      { domain: "www.cloudflare.com", target: "www.cloudflare.com:443", success: true, latency_ms: 18 },
      { domain: "slow.example.com", target: "slow.example.com:443", success: false, error: "timeout" },
    ] } as T;
    throw new Error(`unexpected GET ${path}`);
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("service management workbench", () => {
  it("does not overlap service status polling batches", async () => {
    vi.useFakeTimers();
    let resolveFirstStatus!: (value: unknown) => void;
    const firstStatus = new Promise((resolve) => { resolveFirstStatus = resolve; });
    let statusRequests = 0;
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/remote-servers") return { success: true, servers: [onlineServer] } as T;
      if (path.includes("/api/admin/remote/services/status")) {
        statusRequests += 1;
        if (statusRequests === 1) return await firstStatus as T;
        return {
          success: true,
          xray: { installed: true, running: true, version: "Xray 25.1" },
          nginx: { installed: true, running: true, version: "nginx/1.26" },
        } as T;
      }
      throw new Error(`unexpected GET ${path}`);
    });

    render(<ServicesWorkbenchPage notify={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(statusRequests).toBe(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
    expect(statusRequests).toBe(1);

    await act(async () => {
      resolveFirstStatus({
        success: true,
        xray: { installed: true, running: true, version: "Xray 25.1" },
        nginx: { installed: true, running: true, version: "nginx/1.26" },
      });
      await Promise.resolve();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(statusRequests).toBe(2);
  });

  it("keeps advanced operations reachable from service management", async () => {
    const onOpenAdvanced = vi.fn();
    mockServerReads();
    render(<ServicesWorkbenchPage notify={vi.fn()} onOpenAdvanced={onOpenAdvanced} />);

    fireEvent.click(await screen.findByRole("button", { name: "高级运维" }));

    expect(onOpenAdvanced).toHaveBeenCalledOnce();
  });

  it("filters servers and switches between card and table views", async () => {
    mockServerReads();
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    expect(await screen.findByText("Edge Hong Kong")).toBeInTheDocument();
    expect(screen.getByText("Edge Tokyo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "在线 1" }));
    expect(screen.getByText("Edge Hong Kong")).toBeInTheDocument();
    expect(screen.queryByText("Edge Tokyo")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "列表视图" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(localStorage.getItem("arcway-services-view")).toBe("list");
  });

  it("keeps the rotating address, WS, Xray and Agent controls in one card row", async () => {
    vi.useFakeTimers();
    mockServerReads([onlineServer]);
    const { container } = render(<ServicesWorkbenchPage notify={vi.fn()} />);

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const address = screen.getByRole("button", { name: /Edge Hong Kong 当前 IPv4 203\.0\.113\.11/ });
    expect(address).toHaveTextContent("203.0.113.11");
    expect(address).toHaveTextContent("1/2");
    expect(container.querySelectorAll(".service-address")).toHaveLength(1);
    expect(container.querySelector(".service-card-meta")).not.toBeInTheDocument();
    expect(container.querySelector(".service-connection-policy")).not.toBeInTheDocument();
    const controls = container.querySelector(".service-runtime-controls");
    expect(controls).not.toBeNull();
    expect(address.parentElement).toBe(controls);
    expect(controls?.firstElementChild).toBe(address);
    expect(controls?.children).toHaveLength(4);
    expect(within(controls as HTMLElement).getByText("WS")).toBeInTheDocument();
    expect(within(controls as HTMLElement).getByText("Xray")).toBeInTheDocument();
    expect(within(controls as HTMLElement).getByText("v0.3.0")).toBeInTheDocument();

    fireEvent.mouseEnter(address);
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(address).toHaveTextContent("203.0.113.11");
    fireEvent.mouseLeave(address);
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(address).toHaveTextContent("2001:db8::11");
    expect(address).toHaveTextContent("2/2");
    fireEvent.click(address);
    expect(address).toHaveTextContent("203.0.113.11");
    expect(address).toHaveTextContent("1/2");
  });

  it("never falls back to unselected online servers when an offline server is selected", async () => {
    mockServerReads();
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    await screen.findByText("Edge Hong Kong");
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 Edge Tokyo" }));
    expect(screen.getByRole("button", { name: /升级选中在线 \(0\/1\)/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "选择 Edge Hong Kong" }));
    expect(screen.getByRole("button", { name: /升级选中在线 \(1\/2\)/ })).toBeEnabled();
  });

  it("creates a server with connection, traffic and runtime settings", async () => {
    mockServerReads([onlineServer]);
    const post = vi.spyOn(api, "post").mockResolvedValue({
      success: true,
      server: { ...onlineServer, id: 13, name: "Edge Singapore", token: "server-token", agent_token: "agent-token" },
      install_command: "curl -fsSL 'https://panel.example/install' | bash",
    });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    await screen.findByText("Edge Hong Kong");
    fireEvent.click(screen.getByRole("button", { name: "添加服务器" }));
    const dialog = screen.getByRole("dialog", { name: "添加服务器" });
    expect(within(dialog).getByRole("spinbutton", { name: "Agent 监听端口" })).toHaveAttribute("max", "65534");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "服务器名称" }), { target: { value: "Edge Singapore" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /公网 IPv4 \/ 初始地址/ }), { target: { value: "203.0.113.13" } });
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: /流量限额（GB）/ }), { target: { value: "500" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Xray 模式" }), { target: { value: "embedded" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建并生成命令" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote-servers/create", expect.objectContaining({
      name: "Edge Singapore",
      ip_address: "203.0.113.13",
      connection_mode: "websocket",
      xray_mode: "embedded",
      nginx_mode: "managed",
      traffic_limit: 500 * 1024 ** 3,
      traffic_source: "system",
      traffic_stats_mode: "both",
      ipv6_enabled: true,
      steal_mode: "default",
      steal_self: false,
    })));
    expect(await screen.findByRole("dialog", { name: "Edge Singapore 接入凭据" })).toBeInTheDocument();
  });

  it("creates a server in existing Nginx reuse mode", async () => {
    mockServerReads([onlineServer]);
    const post = vi.spyOn(api, "post").mockResolvedValue({
      success: true,
      server: { ...onlineServer, id: 18, name: "Existing Nginx", nginx_mode: "reuse_existing" },
      install_command: "safe installer",
    });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    await screen.findByText("Edge Hong Kong");
    fireEvent.click(screen.getByRole("button", { name: "添加服务器" }));
    const dialog = screen.getByRole("dialog", { name: "添加服务器" });
    const reuse = within(dialog).getByRole("radio", { name: /复用系统已有 Nginx/ });
    expect(within(dialog).getByRole("radio", { name: /Arcway 管理 Nginx/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(reuse);
    expect(reuse).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByRole("note")).toHaveTextContent("不会安装、卸载、覆盖主配置或控制服务启停");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "服务器名称" }), { target: { value: "Existing Nginx" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建并生成命令" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote-servers/create", expect.objectContaining({
      name: "Existing Nginx",
      nginx_mode: "reuse_existing",
    })));
  });

  it("saves an explicitly selected certificate DNS provider when creating a DDNS server", async () => {
    mockServerReads([onlineServer]);
    const post = vi.spyOn(api, "post").mockResolvedValue({
      success: true,
      server: { ...onlineServer, id: 13, name: "Edge DDNS", ddns_enabled: true, ddns_provider_id: 8 },
      install_command: "safe installer",
    });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    await screen.findByText("Edge Hong Kong");
    fireEvent.click(screen.getByRole("button", { name: "添加服务器" }));
    const dialog = screen.getByRole("dialog", { name: "添加服务器" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "服务器名称" }), { target: { value: "Edge DDNS" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "服务器地址 / DDNS 域名" }), { target: { value: "edge-ddns.example.com" } });
    fireEvent.click(within(dialog).getByRole("switch", { name: "自动同步 DDNS" }));
    const provider = await within(dialog).findByRole("combobox", { name: "DDNS 提供商" });
    expect(within(provider).getByRole("option", { name: "自动（按证书）" })).toBeInTheDocument();
    expect(within(provider).getByRole("option", { name: "DNSPod 备用（dnspod）" })).toBeInTheDocument();
    fireEvent.change(provider, { target: { value: "8" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建并生成命令" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote-servers/create", expect.objectContaining({
      pull_address: "edge-ddns.example.com",
      ddns_enabled: true,
      ddns_provider_id: 8,
    })));
  });

  it("derives port 443 takeover authorization from the selected takeover mode", async () => {
    mockServerReads([onlineServer]);
    const post = vi.spyOn(api, "post").mockResolvedValue({
      success: true,
      server: { ...onlineServer, id: 14, name: "Edge Fallback" },
      install_command: "safe installer",
    });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    await screen.findByText("Edge Hong Kong");
    fireEvent.click(screen.getByRole("button", { name: "添加服务器" }));
    const dialog = screen.getByRole("dialog", { name: "添加服务器" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "服务器名称" }), { target: { value: "Edge Fallback" } });
    expect(within(dialog).queryByText("安装后接管本机 443")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("combobox", { name: "接管模式" }), { target: { value: "fallback" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /节点域名/ }), { target: { value: "fallback.example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建并生成命令" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote-servers/create", expect.objectContaining({
      steal_mode: "fallback",
      steal_self: true,
      use_443: true,
      domain: "fallback.example.com",
    })));
  });

  it("validates and adds a shared server using the federation payload", async () => {
    mockServerReads([onlineServer]);
    const post = vi.spyOn(api, "post").mockResolvedValue({ id: 22, name: "Shared Seoul", status: "connected" });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    await screen.findByText("Edge Hong Kong");
    fireEvent.click(screen.getByRole("button", { name: "添加共享服务器" }));
    const dialog = screen.getByRole("dialog", { name: "添加共享服务器" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "拥有方控制端地址" }), { target: { value: "https://owner.example.com" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "分享令牌" }), { target: { value: "share-secret" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "显示名称（可选）" }), { target: { value: "Shared Seoul" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "节点名称前缀（可选）" }), { target: { value: "共享-" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "验证并接入" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote-servers/add-shared", {
      owner_url: "https://owner.example.com",
      share_token: "share-secret",
      name: "Shared Seoul",
      prefix: "共享-",
    }));
  });

  it("installs a missing external Xray directly from the server card", async () => {
    mockServerReads([{ ...onlineServer, xray_version: "", xray_running: false }], {
      serviceStatus: {
        success: true,
        xray: { installed: false, running: false, version: "" },
        nginx: { installed: true, running: true, version: "nginx/1.26" },
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response('data: {"type":"output","data":"Installing Xray"}\n\ndata: {"type":"complete","success":true,"message":"installed"}\n\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const notify = vi.fn();
    render(<ServicesWorkbenchPage notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "安装 Edge Hong Kong Xray" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/remote/xray/install-stream?server_id=11");
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "POST" }));
    const terminal = await screen.findByRole("dialog", { name: "安装 Xray" });
    expect(within(terminal).getByRole("log", { name: "远端执行日志" })).toHaveTextContent("Installing Xray");
    expect(within(terminal).getByText("执行完成")).toBeInTheDocument();
    expect(notify).toHaveBeenCalledWith("Xray 安装完成");
  });

  it("opens running Xray card controls for restart, pause and update", async () => {
    mockServerReads([onlineServer]);
    const fetchMock = vi.fn().mockResolvedValue(new Response('data: {"type":"output","data":"Updating Xray"}\n\ndata: {"type":"complete","success":true,"message":"updated"}\n\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    const xrayButton = await screen.findByRole("button", { name: "管理 Edge Hong Kong Xray v25.1" });
    expect(within(xrayButton).getByText("Xray")).toBeInTheDocument();
    expect(within(xrayButton).queryByText("25.1")).not.toBeInTheDocument();
    fireEvent.click(xrayButton);
    expect(fetchMock).not.toHaveBeenCalled();
    const menu = screen.getByRole("menu", { name: "Edge Hong Kong Xray 快捷操作" });
    expect(within(menu).getByRole("menuitem", { name: "重启 Xray" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "暂停 Xray" })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "更新 / 重装核心" }));
    const confirm = screen.getByRole("dialog", { name: "更新 Xray" });
    fireEvent.click(within(confirm).getByRole("button", { name: "确认更新" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/remote/xray/install-stream?server_id=11");
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "POST" }));
  });

  it("offers start and update from a stopped Xray card menu", async () => {
    mockServerReads([{ ...onlineServer, xray_running: false }], {
      serviceStatus: {
        success: true,
        xray: { installed: true, running: false, version: "Xray 25.1" },
        nginx: { installed: true, running: true, version: "nginx/1.26" },
      },
    });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理 Edge Hong Kong Xray v25.1" }));

    const menu = screen.getByRole("menu", { name: "Edge Hong Kong Xray 快捷操作" });
    expect(within(menu).getByRole("menuitem", { name: "开启 Xray" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "更新 / 重装核心" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "暂停 Xray" })).not.toBeInTheDocument();
  });

  it("shows the Agent upgrade indicator and upgrades directly from the server card", async () => {
    mockServerReads([onlineServer]);
    const fetchMock = vi.fn().mockResolvedValue(new Response('data: {"type":"output","data":"Downloading Agent"}\n\ndata: {"type":"complete","success":true,"message":"upgraded"}\n\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const notify = vi.fn();
    render(<ServicesWorkbenchPage notify={notify} />);

    const upgradeButton = await screen.findByRole("button", { name: "升级 Edge Hong Kong Agent" });
    expect(upgradeButton).toHaveClass("has-update");
    expect(upgradeButton).toHaveAttribute("title", expect.stringContaining("上游最新 v0.3.1"));
    expect(within(upgradeButton).getByText("v0.3.0")).toBeInTheDocument();
    expect(upgradeButton.querySelector("i")).toBeInTheDocument();
    fireEvent.click(upgradeButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/remote/agent/upgrade-stream?server_id=11");
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "POST" }));
    const dialog = await screen.findByRole("dialog", { name: "Agent 批量升级" });
    expect(within(dialog).getByLabelText("Agent 升级日志")).toHaveTextContent("Downloading Agent");
    expect(notify).toHaveBeenCalledWith("1 台 Agent 已完成升级", "success");
  });

  it("loads live service state and restarts Xray through the remote control API", async () => {
    mockServerReads([onlineServer], {
      serviceStatus: {
        success: true,
        xray: { installed: true, running: true, version: "Xray 26.3.27 (Xray, Penetrates Everything.) Custom (go1.26.5 linux/amd64)" },
        nginx: { installed: true, running: true, version: "nginx/1.26" },
      },
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true, message: "restarted" });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "服务控制" }));
    expect(within(dialog).getByText("v26.3.27")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Penetrates Everything|go1\.26\.5|linux\/amd64/)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "重启 Xray" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/services/control?server_id=11", { service: "xray", action: "restart" }));
  });

  it("updates an external Xray core only after confirmation", async () => {
    mockServerReads([onlineServer]);
    const fetchMock = vi.fn().mockResolvedValue(new Response('data: {"type":"output","data":"Downloading Xray"}\n\ndata: {"type":"complete","success":true,"message":"updated"}\n\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const notify = vi.fn();
    render(<ServicesWorkbenchPage notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "服务控制" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "更新 Xray" }));

    expect(fetchMock).not.toHaveBeenCalled();
    const confirm = screen.getByRole("dialog", { name: "更新 Xray" });
    fireEvent.click(within(confirm).getByRole("button", { name: "确认更新" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/remote/xray/install-stream?server_id=11");
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "POST" }));
    const terminal = screen.getByRole("dialog", { name: "更新 Xray" });
    expect(within(terminal).getByRole("log", { name: "远端执行日志" })).toHaveTextContent("Downloading Xray");
    expect(within(terminal).getByText("执行完成")).toBeInTheDocument();
    expect(notify).toHaveBeenCalledWith("Xray 更新完成");
  });

  it("shows the external Xray missing state and a full install action", async () => {
    mockServerReads([{ ...onlineServer, xray_version: "", xray_running: false }], {
      serviceStatus: {
        success: true,
        xray: { installed: false, running: false, version: "" },
        nginx: { installed: true, running: true, version: "nginx/1.26" },
      },
    });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "服务控制" }));

    const xrayHeading = within(dialog).getByRole("heading", { name: "Xray" });
    const xrayCard = xrayHeading.closest(".service-control-card");
    expect(xrayCard).toHaveClass("is-missing");
    expect(within(xrayCard as HTMLElement).getByText("未安装")).toBeInTheDocument();
    expect(within(xrayCard as HTMLElement).getByRole("button", { name: "安装 Xray" })).toBeEnabled();
  });

  it("streams fragmented install output into a locked terminal until completion", async () => {
    mockServerReads([{ ...onlineServer, xray_version: "", xray_running: false }], {
      serviceStatus: {
        success: true,
        xray: { installed: false, running: false, version: "" },
        nginx: { installed: true, running: true, version: "nginx/1.26" },
      },
    });
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    })));
    const notify = vi.fn();
    render(<ServicesWorkbenchPage notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const management = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(management).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(management).getByRole("tab", { name: "服务控制" }));
    fireEvent.click(within(management).getByRole("button", { name: "安装 Xray" }));

    const terminal = await screen.findByRole("dialog", { name: "安装 Xray" });
    expect(within(terminal).queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
    expect(within(terminal).getByRole("button", { name: "正在执行" })).toBeDisabled();

    const encoder = new TextEncoder();
    controller.enqueue(encoder.encode('data: {"type":"output","data":"Down'));
    controller.enqueue(encoder.encode('loading Xray"}\n\n'));
    await waitFor(() => expect(within(terminal).getByRole("log", { name: "远端执行日志" })).toHaveTextContent("Downloading Xray"));
    expect(terminal.querySelector(".service-terminal-status")).toHaveTextContent("正在执行");

    controller.enqueue(encoder.encode('data: {"type":"complete","success":true,"message":"installed"}\n'));
    controller.enqueue(encoder.encode("\n"));
    controller.close();
    await waitFor(() => expect(within(terminal).getByText("执行完成")).toBeInTheDocument());
    expect(within(terminal).getAllByRole("button", { name: "关闭" }).every((button) => !button.hasAttribute("disabled"))).toBe(true);
    expect(notify).toHaveBeenCalledWith("Xray 安装完成");
  });

  it("rejects an error event even when the stream later claims completion", async () => {
    const response = new Response('data: {"type":"output","data":"starting"}\n\ndata: {"type":"error","message":"install failed"}\n\ndata: {"type":"complete","success":true,"message":"done"}\n\n');
    const output: string[] = [];
    await expect(consumeRemoteServiceStream(response, (value) => output.push(value))).rejects.toThrow("install failed");
    expect(output).toEqual(["starting"]);
  });

  it("cancels and releases an open stream after an error event", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn((_reason?: unknown) => { throw new Error("cancel failed"); });
    const stream = new ReadableStream<Uint8Array>({
      start(value) { controller = value; },
      cancel,
    });
    const result = consumeRemoteServiceStream(new Response(stream), vi.fn());

    controller.enqueue(new TextEncoder().encode('data: {"type":"error","message":"install failed"}\n\n'));

    await expect(result).rejects.toThrow("install failed");
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel.mock.calls[0][0]).toMatchObject({ message: "install failed" });
    expect(stream.locked).toBe(false);
  });

  it("keeps embedded Xray core maintenance tied to Agent updates", async () => {
    mockServerReads([{ ...onlineServer, xray_mode: "embedded" }]);
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "服务控制" }));

    expect(within(dialog).getByText("内嵌核心")).toBeInTheDocument();
    expect(within(dialog).getByText("内嵌核心随 Agent 更新，不单独安装、更新或卸载。")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "更新 Xray" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "卸载 Xray" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "安装 Xray" })).not.toBeInTheDocument();
  });

  it("runs Ookla Speedtest for the server currently open in service management", async () => {
    mockServerReads([onlineServer], { lineSpeedtestTargets: [{
      key: "remote:11",
      kind: "remote",
      server_id: 11,
      name: "Edge Hong Kong",
      online: true,
      installed: true,
      managed: true,
      license_accepted: true,
      implementation: "Ookla Speedtest CLI",
      version: "1.2.0",
      running: false,
      last_result: { ping_ms: 0.6, download_mbps: 603.4, upload_mbps: 1881.5, isp: "HKBN", test_server: "Sonic" },
    }] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true, job_id: "job-11", status: "running" });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "Speedtest" }));

    expect(await within(dialog).findByText("↓ 603.4 Mbps")).toBeInTheDocument();
    expect(within(dialog).getByText("↑ 1881.5 Mbps")).toBeInTheDocument();
    expect(within(dialog).getByText("Sonic")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "开始测速" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/line-speedtest/run", { kind: "remote", server_id: 11 }));
  });

  it("preserves the masked Agent token when editing an address", async () => {
    const serverWithPullAddress = { ...onlineServer, pull_address: "agent-hk.example.com", pull_port: 23889 } as RemoteServer;
    mockServerReads([serverWithPullAddress]);
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true, message: "saved" });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑 Edge Hong Kong" }));
    const dialog = screen.getByRole("dialog", { name: "编辑 Edge Hong Kong" });
    expect(within(dialog).getByRole("spinbutton", { name: "Agent 监听端口" })).toBeDisabled();
    expect(within(dialog).getByRole("combobox", { name: "连接模式" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "保存更改" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/remote-servers/update", expect.objectContaining({
      id: 11,
      pull_address: "agent-hk.example.com",
      pull_port: 23889,
      pull_token: "existing-agent-token",
    })));
  });

  it("loads and saves the existing Nginx reuse mode when editing", async () => {
    const reuseServer = { ...onlineServer, nginx_mode: "reuse_existing" as const };
    mockServerReads([reuseServer]);
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true, message: "saved" });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑 Edge Hong Kong" }));
    const dialog = screen.getByRole("dialog", { name: "编辑 Edge Hong Kong" });
    expect(within(dialog).getByRole("radio", { name: /复用系统已有 Nginx/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(dialog).getByRole("button", { name: "保存更改" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/remote-servers/update", expect.objectContaining({
      id: 11,
      nginx_mode: "reuse_existing",
    })));
  });

  it("locks all Nginx service controls while reusing the system Nginx", async () => {
    const reuseServer = { ...onlineServer, nginx_mode: "reuse_existing" as const };
    mockServerReads([reuseServer]);
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "服务控制" }));

    expect(within(dialog).getByRole("note")).toHaveTextContent("不安装、不卸载、不覆盖主配置");
    expect(within(dialog).getByText("系统托管")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "启动 Nginx" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "重启 Nginx" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "停止 Nginx" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "卸载 Nginx" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "重启 Nginx" }));
    expect(post).not.toHaveBeenCalled();
  });

  it("can switch an existing DDNS server back to automatic certificate provider selection", async () => {
    const ddnsServer = { ...onlineServer, pull_address: "agent-hk.example.com", pull_port: 23889, ddns_enabled: true, ddns_provider_id: 8 } as RemoteServer;
    mockServerReads([ddnsServer]);
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true, message: "saved" });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑 Edge Hong Kong" }));
    const dialog = screen.getByRole("dialog", { name: "编辑 Edge Hong Kong" });
    const provider = await within(dialog).findByRole("combobox", { name: "DDNS 提供商" });
    expect(provider).toHaveValue("8");
    fireEvent.change(provider, { target: { value: "0" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存更改" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/remote-servers/update", expect.objectContaining({
      id: 11,
      ddns_enabled: true,
      ddns_provider_id: 0,
    })));
  });

  it("shows DDNS provider and failure state, then triggers a retry and refreshes pending status", async () => {
    const ddnsServer = { ...onlineServer, pull_address: "edge-hk.example.com", ddns_enabled: true, ddns_provider_id: 8 } as RemoteServer;
    const get = mockServerReads([ddnsServer], { ddnsStatuses: [
      {
        success: true,
        id: 11,
        ddns_enabled: true,
        ddns_provider_id: 8,
        ddns_provider_name: "Cloudflare 主账号 (cloudflare)",
        ddns_last_synced_at: "",
        ddns_last_error: "record update failed",
        ddns_pending: false,
        pull_address: "edge-hk.example.com",
      },
      {
        success: true,
        id: 11,
        ddns_enabled: true,
        ddns_provider_id: 8,
        ddns_provider_name: "Cloudflare 主账号 (cloudflare)",
        ddns_last_synced_at: "",
        ddns_last_error: "",
        ddns_pending: true,
        pull_address: "edge-hk.example.com",
      },
    ] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true, message: "triggered" });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    expect(await within(dialog).findByText("Cloudflare 主账号 (cloudflare)")).toBeInTheDocument();
    expect(within(dialog).getByText("record update failed")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "重试 DDNS" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/servers/11/ddns-test"));
    await waitFor(() => expect(get.mock.calls.filter(([path]) => path === "/api/admin/servers/11/ddns-status")).toHaveLength(2));
    expect(within(dialog).getByText("同步中")).toBeInTheDocument();
    expect(within(dialog).queryByText("record update failed")).not.toBeInTheDocument();
  });

  it("uses only the authoritative installer command returned by the backend", async () => {
    mockServerReads([onlineServer]);
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "查看 Edge Hong Kong 安装凭据" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong 接入凭据" });
    const command = within(dialog).getByText("authoritative-install-command");
    expect(command.tagName).toBe("CODE");
  });

  it("does not delete a server until the destructive action is confirmed", async () => {
    mockServerReads([onlineServer]);
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true, message: "deleted" });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "删除 Edge Hong Kong" }));
    expect(post).not.toHaveBeenCalled();
    expect(screen.queryByRole("checkbox", { name: "同时卸载远端 Agent" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "卸载 Agent 并删除" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote-servers/delete", { id: 11, uninstall_agent: true }));
  });

  it("previews the complete impact and retains remote server software and configuration", async () => {
    mockServerReads([{ ...onlineServer, xray_mode: "embedded" }]);
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true, message: "远端 Agent 已完成清理，服务器记录已删除" });
    const notify = vi.fn();
    render(<ServicesWorkbenchPage notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "删除 Edge Hong Kong" }));
    const dialog = screen.getByRole("dialog", { name: "删除服务器" });
    expect(await within(dialog).findByText("共 50 条关联数据")).toBeInTheDocument();
    expect(within(dialog).getByText("节点子账号")).toBeInTheDocument();
    expect(within(dialog).getByText("流量与统计").previousElementSibling).toHaveTextContent("10");
    expect(within(dialog).getByText("其他关联").previousElementSibling).toHaveTextContent("17");
    expect(within(dialog).getByText("Arcway Agent 与到期守护服务")).toBeInTheDocument();
    expect(within(dialog).getByText("Arcway 创建的防火墙与端口规则")).toBeInTheDocument();
    expect(within(dialog).getByText("Xray 与 Nginx 程序")).toBeInTheDocument();
    expect(within(dialog).getByText("证书文件")).toBeInTheDocument();
    expect(within(dialog).getByRole("note")).toHaveTextContent("现有连接将中断");
    expect(within(dialog).getByRole("note")).toHaveTextContent("配置文件仍会保留");
    fireEvent.click(within(dialog).getByRole("button", { name: "卸载 Agent 并删除" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote-servers/delete", { id: 11, uninstall_agent: true }));
    expect(notify).toHaveBeenCalledWith("远端 Agent 已完成清理，服务器记录已删除");
  });

  it("allows an online HTTP Agent to be probed when deletion is confirmed", async () => {
    mockServerReads([{ ...onlineServer, ws_connected: false, agent_uninstall_v2: undefined }]);
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true, message: "远端 Agent 已完成清理，服务器记录已删除" });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "删除 Edge Hong Kong" }));
    const dialog = screen.getByRole("dialog", { name: "删除服务器" });
    expect(await within(dialog).findByText("删除时将再次检测 Agent 的安全卸载能力。")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "卸载 Agent 并删除" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote-servers/delete", { id: 11, uninstall_agent: true }));
  });

  it("keeps the deletion dialog and server record visible when remote uninstall fails", async () => {
    mockServerReads([onlineServer]);
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: false, error: "远端 Agent 卸载失败：权限不足" });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "删除 Edge Hong Kong" }));
    const dialog = screen.getByRole("dialog", { name: "删除服务器" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "卸载 Agent 并删除" }));

    await waitFor(() => expect(within(dialog).getAllByRole("alert").some((item) => item.textContent?.includes("远端 Agent 卸载失败：权限不足"))).toBe(true));
    expect(screen.getByRole("dialog", { name: "删除服务器" })).toBeInTheDocument();
    expect(screen.getByText("Edge Hong Kong")).toBeInTheDocument();
  });

  it.each([
    [{ ...offlineServer, agent_uninstall_v2: true }, "Agent 当前离线，无法安全完成删除。请先恢复 Agent 在线后重试。"],
    [{ ...onlineServer, id: 14, name: "Legacy Edge", agent_uninstall_v2: false }, "当前 Agent 版本或运行环境不支持安全卸载。请先升级 Agent 或修复运行环境后重试。"],
  ] as Array<[RemoteServer, string]>)("blocks complete deletion when the owned server cannot be safely uninstalled", async (server, reason) => {
    mockServerReads([server]);
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: `删除 ${server.name}` }));
    const dialog = screen.getByRole("dialog", { name: "删除服务器" });
    expect(await within(dialog).findByText(reason)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "卸载 Agent 并删除" })).toBeDisabled();
  });

  it("removes only the local relationship for a shared server", async () => {
    const sharedServer = { ...onlineServer, id: 13, name: "Shared Edge", is_federated: true };
    mockServerReads([sharedServer]);
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true, message: "共享接入已解除" });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "删除 Shared Edge" }));
    const dialog = await screen.findByRole("dialog", { name: "解除共享接入" });
    expect(within(dialog).getByText("远端保持原状")).toBeInTheDocument();
    expect(within(dialog).queryByText("远端将清理")).not.toBeInTheDocument();
    fireEvent.click(await within(dialog).findByRole("button", { name: "解除共享接入" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote-servers/delete", { id: 13 }));
  });

  it("resumes a persisted deletion after the remote Agent has already been removed", async () => {
    mockServerReads([{ ...offlineServer, id: 15, name: "Pending Cleanup" }], { deleteImpact: {
      success: true,
      server: { id: 15, name: "Pending Cleanup", ownership: "owned", online: false, agent_uninstall_v2: false, xray_mode: "external" },
      counts: { nodes: 1, total: 2 },
      blocker: null,
      deletion_task: { status: "agent_uninstalled", message: "远端清理已确认" },
    } });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true, message: "删除完成" });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "删除 Pending Cleanup" }));
    const dialog = screen.getByRole("dialog", { name: "删除服务器" });
    expect(await within(dialog).findByText("远端 Agent 已卸载，仅待清理面板数据")).toBeInTheDocument();
    const finish = within(dialog).getByRole("button", { name: "完成删除" });
    expect(finish).toBeEnabled();
    fireEvent.click(finish);

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote-servers/delete", { id: 15, uninstall_agent: true }));
  });

  it("continues waiting for an already dispatched deletion even when the Agent is now offline", async () => {
    mockServerReads([{ ...offlineServer, id: 16, name: "Dispatched Cleanup" }], { deleteImpact: {
      success: true,
      server: { id: 16, name: "Dispatched Cleanup", ownership: "owned", online: false, agent_uninstall_v2: true, xray_mode: "external" },
      counts: { total: 1 },
      blocker: null,
      deletion_task: { status: "dispatched", message: "等待远端完成回调" },
    } });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "删除 Dispatched Cleanup" }));
    const dialog = screen.getByRole("dialog", { name: "删除服务器" });
    expect(await within(dialog).findByText("已有卸载任务，继续操作不会重复下发")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "继续等待并删除" })).toBeEnabled();
  });

  it("respects a backend blocker after the remote Agent has been removed", async () => {
    mockServerReads([{ ...offlineServer, id: 17, name: "Referenced Edge" }], { deleteImpact: {
      success: true,
      server: { id: 17, name: "Referenced Edge", ownership: "owned", online: false, agent_uninstall_v2: false, xray_mode: "external" },
      counts: { total: 3 },
      blocker: "仍有 2 条转发规则引用此服务器，请先解除引用。",
      deletion_task: { status: "agent_uninstalled" },
    } });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "删除 Referenced Edge" }));
    const dialog = screen.getByRole("dialog", { name: "删除服务器" });
    expect(await within(dialog).findByText("仍有 2 条转发规则引用此服务器，请先解除引用。")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "完成删除" })).toBeDisabled();
  });

  it("treats SSE error events as failures", () => {
    expect(() => parseSSELog('data: {"type":"error","message":"Agent 不可达"}\n\n')).toThrow("Agent 不可达");
  });

  it("creates an inbound on the selected server with structured fields and advanced JSON", async () => {
    mockServerReads([onlineServer], { inbounds: [] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true, message: "added" });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "入站" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "添加入站" }));
    expect(await screen.findByRole("dialog", { name: "添加入站" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("tab", { name: /高级 JSON/ }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "入站 Tag" }), { target: { value: "socks-private" } });
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "入站监听端口" }), { target: { value: "2080" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "入站高级 JSON" }), { target: { value: JSON.stringify({ tag: "ignored", protocol: "socks", settings: { auth: "noauth", udp: true }, sniffing: { enabled: true } }) } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建入站" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/inbounds?server_id=11", {
      action: "add",
      inbound: {
        tag: "socks-private",
        protocol: "socks",
        listen: "0.0.0.0",
        port: 2080,
        settings: { auth: "noauth", udp: true },
        sniffing: { enabled: true },
      },
    }));
  });

  it("creates a complete VLESS Reality inbound with probed SNI and generated keys", async () => {
    const get = mockServerReads([onlineServer], { inbounds: [] });
    const privateKey = "A".repeat(43);
    const publicKey = "B".repeat(43);
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string, body?: unknown): Promise<T> => {
      if (path === "/api/admin/xray/generate-x25519") return { privateKey, publicKey } as T;
      if (path === "/api/admin/xray/generate-keys") return { decryptionConfig: "server-decryption", encryption: "client-encryption" } as T;
      if (path === "/api/admin/remote/inbounds?server_id=11") return { success: true, message: "added" } as T;
      throw new Error(`unexpected POST ${path} ${JSON.stringify(body)}`);
    });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "入站" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "添加入站" }));

    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Reality 伪装目标 / SNI" })).toHaveValue(""));
    await waitFor(() => expect(within(dialog).getByText("已生成")).toBeInTheDocument());
    expect(get).toHaveBeenCalledWith("/api/admin/xray-examples");
    expect(get).toHaveBeenCalledWith("/api/admin/remote/reality-domains?server_id=11");
    expect(post).toHaveBeenCalledWith("/api/admin/xray/generate-x25519");

    fireEvent.click(within(dialog).getByRole("tab", { name: /VLESS \+ WS \+ TLS/ }));
    expect(within(dialog).getByRole("textbox", { name: "TLS 节点域名" })).toHaveValue("hk.example.com");
    fireEvent.click(within(dialog).getByRole("tab", { name: /VLESS \+ Reality/ }));
    expect(within(dialog).getByRole("combobox", { name: "Reality 伪装目标 / SNI" })).toHaveValue("");

    fireEvent.change(within(dialog).getByRole("textbox", { name: "客户端 UUID" }), { target: { value: "123e4567-e89b-12d3-a456-426614174000" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Reality Short ID" }), { target: { value: "0123456789abcdef" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Reality 伪装目标 / SNI" }), { target: { value: "https://invalid.example/path" } });
    fireEvent.submit(within(dialog).getByRole("button", { name: "创建入站" }).closest("form") as HTMLFormElement);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("域名必须");
    expect(post).not.toHaveBeenCalledWith("/api/admin/remote/inbounds?server_id=11", expect.anything());

    fireEvent.change(within(dialog).getByRole("combobox", { name: "Reality 伪装目标 / SNI" }), { target: { value: "www.cloudflare.com" } });
    fireEvent.click(within(dialog).getByRole("switch", { name: "VLESS 后量子增强加密" }));
    await waitFor(() => expect(within(dialog).getByText("增强密钥已生成")).toBeInTheDocument());
    expect(post).toHaveBeenCalledWith("/api/admin/xray/generate-keys", {
      type: "mlkem768x25519plus",
      encryptionType: "x25519",
      appearance: "native",
      ticketLifetime: "600s",
      padding: "0rtt",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建入站" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/inbounds?server_id=11", {
      action: "add",
      inbound: {
        tag: "vless-reality",
        listen: "0.0.0.0",
        port: 443,
        protocol: "vless",
        settings: {
          clients: [{ id: "123e4567-e89b-12d3-a456-426614174000", flow: "xtls-rprx-vision" }],
          decryption: "server-decryption",
          encryption: "client-encryption",
        },
        streamSettings: {
          network: "tcp",
          security: "reality",
          realitySettings: {
            show: false,
            target: "www.cloudflare.com:443",
            xver: 0,
            serverNames: ["www.cloudflare.com"],
            privateKey,
            shortIds: ["0123456789abcdef"],
          },
        },
        sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], routeOnly: false },
      },
    }));
  });

  it("creates VLESS WS TLS while clearly preserving existing Nginx reuse mode", async () => {
    mockServerReads([{ ...onlineServer, nginx_mode: "reuse_existing" }], { inbounds: [] });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/xray/generate-x25519") return { privateKey: "A".repeat(43), publicKey: "B".repeat(43) } as T;
      if (path === "/api/admin/remote/inbounds?server_id=11") return { success: true, message: "added" } as T;
      throw new Error(`unexpected POST ${path}`);
    });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "入站" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "添加入站" }));
    fireEvent.click(within(dialog).getByRole("tab", { name: /VLESS \+ WS \+ TLS/ }));
    expect(within(dialog).getByRole("note")).toHaveTextContent("此入站将复用系统已有 Nginx");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "客户端 UUID" }), { target: { value: "123e4567-e89b-12d3-a456-426614174000" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "WebSocket 路径" }), { target: { value: "/ws/arcway" } });
    expect(within(dialog).getByRole("textbox", { name: "TLS 节点域名" })).toHaveValue("hk.example.com");
    fireEvent.click(within(dialog).getByRole("button", { name: "创建入站" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/inbounds?server_id=11", {
      action: "add",
      inbound: {
        tag: "vless-wss",
        listen: "127.0.0.1",
        port: 443,
        protocol: "vless",
        settings: { clients: [{ id: "123e4567-e89b-12d3-a456-426614174000" }], decryption: "none" },
        streamSettings: {
          network: "ws",
          security: "none",
          wsSettings: { path: "/ws/arcway", host: "hk.example.com" },
        },
        sniffing: { enabled: true, destOverride: ["http", "tls"], routeOnly: false },
      },
    }));
  });

  it("blocks invalid secure inbound port, UUID and WebSocket path before remote writes", async () => {
    mockServerReads([onlineServer], { inbounds: [] });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/xray/generate-x25519") return { privateKey: "A".repeat(43), publicKey: "B".repeat(43) } as T;
      if (path === "/api/admin/remote/inbounds?server_id=11") return { success: true } as T;
      throw new Error(`unexpected POST ${path}`);
    });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "入站" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "添加入站" }));
    fireEvent.click(within(dialog).getByRole("tab", { name: /VLESS \+ WS \+ TLS/ }));
    const submitButton = within(dialog).getByRole("button", { name: "创建入站" });
    const form = submitButton.closest("form") as HTMLFormElement;
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "入站监听端口" }), { target: { value: "70000" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "客户端 UUID" }), { target: { value: "bad-uuid" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "WebSocket 路径" }), { target: { value: "ws?bad" } });
    fireEvent.submit(form);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("监听端口必须");

    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "入站监听端口" }), { target: { value: "443" } });
    fireEvent.submit(form);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("UUID 必须");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "客户端 UUID" }), { target: { value: "123e4567-e89b-12d3-a456-426614174000" } });
    fireEvent.submit(form);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("WebSocket 路径必须");
    expect(post).not.toHaveBeenCalledWith("/api/admin/remote/inbounds?server_id=11", expect.anything());
  });

  it("creates a normal WireGuard node and keeps its encrypted client config available", async () => {
    mockServerReads([onlineServer], { inbounds: [] });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/xray/generate-x25519") return { privateKey: "A".repeat(43), publicKey: "B".repeat(43) } as T;
      if (path === "/api/admin/managed-inbound-resources/wireguard?server_id=11") return { success: true, message: "added", node_id: 19 } as T;
      throw new Error(`unexpected POST ${path}`);
    });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const operations = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(operations).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(operations).getByRole("tab", { name: "入站" }));
    fireEvent.click(within(operations).getAllByRole("button", { name: "添加入站" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "添加入站" });
    fireEvent.click(within(dialog).getByRole("tab", { name: /WireGuard/ }));

    await within(dialog).findByText("两组密钥已生成");
    expect(within(dialog).getByRole("textbox", { name: "入站 Tag" })).toHaveValue("wireguard-in");
    expect(within(dialog).getByRole("spinbutton", { name: "入站监听端口" })).toHaveValue(51820);
    expect(within(dialog).getByRole("textbox", { name: "WireGuard 客户端 Endpoint" })).toHaveValue("hk.example.com:51820");
    fireEvent.click(within(dialog).getByRole("button", { name: "创建入站" }));

    await within(dialog).findByRole("status", { name: "WireGuard 已创建" });
    const inboundCall = post.mock.calls.find(([path]) => path === "/api/admin/managed-inbound-resources/wireguard?server_id=11");
    expect(inboundCall?.[1]).toMatchObject({
      action: "add",
      display_name: "wireguard-in",
      inbound: {
        tag: "wireguard-in",
        port: 51820,
        protocol: "wireguard",
        settings: {
          address: ["10.66.66.1/32"],
          peers: [{ allowedIPs: ["10.66.66.2/32"], keepAlive: 25 }],
        },
      },
    });
    const clientConfig = within(dialog).getByRole("textbox", { name: "WireGuard 客户端配置" }) as HTMLTextAreaElement;
    const clientPrivateKey = clientConfig.value.match(/^PrivateKey = (.+)$/m)?.[1];
    expect(clientPrivateKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(inboundCall?.[1]).toMatchObject({
      client: {
        private_key: clientPrivateKey,
        address: ["10.66.66.2/32"],
        dns: ["1.1.1.1", "1.0.0.1"],
        mtu: 1420,
        keep_alive: 25,
        allowed_ips: ["0.0.0.0/0"],
      },
    });
    expect(JSON.stringify((inboundCall?.[1] as { inbound?: unknown }).inbound)).not.toContain(clientPrivateKey);
    expect(clientConfig.value).toMatch(/^PublicKey = [A-Za-z0-9+/]{43}=$/m);
    expect(clientConfig.value).toContain("Endpoint = hk.example.com:51820");
    expect(within(dialog).queryByRole("button", { name: "创建入站" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
  });

  it("generates WireGuard keys in the browser instead of requesting them from the backend", async () => {
    mockServerReads([onlineServer], { inbounds: [] });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/xray/generate-x25519") return { privateKey: "A".repeat(43), publicKey: "B".repeat(43) } as T;
      throw new Error(`unexpected POST ${path}`);
    });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const operations = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    fireEvent.click(within(operations).getByRole("tab", { name: "入站" }));
    fireEvent.click(await within(operations).findByRole("button", { name: "添加入站" }));
    const dialog = await screen.findByRole("dialog", { name: "添加入站" });
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/xray/generate-x25519"));
    const callsBeforeWireGuard = post.mock.calls.length;
    fireEvent.click(within(dialog).getByRole("tab", { name: /WireGuard/ }));
    await within(dialog).findByText("两组密钥已生成");
    expect(post.mock.calls).toHaveLength(callsBeforeWireGuard);
  });

  it("creates Trojan TCP TLS on 8443 with only global and current-server certificates", async () => {
    const get = mockServerReads([onlineServer], { inbounds: [], certificates: [
      { id: 9, domain: "global.example.com", remote_server_id: 0 },
      { id: 10, domain: "hk.example.com", remote_server_id: 11, remote_server_name: "Edge Hong Kong" },
      { id: 12, domain: "tokyo.example.com", remote_server_id: 12, remote_server_name: "Edge Tokyo" },
    ] });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/xray/generate-x25519") return { privateKey: "A".repeat(43), publicKey: "B".repeat(43) } as T;
      if (path === "/api/admin/remote/inbounds?server_id=11") return { success: true } as T;
      throw new Error(`unexpected POST ${path}`);
    });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const operations = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(operations).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(operations).getByRole("tab", { name: "入站" }));
    fireEvent.click(await within(operations).findByRole("button", { name: "添加入站" }));
    const dialog = await screen.findByRole("dialog", { name: "添加入站" });
    fireEvent.click(within(dialog).getByRole("tab", { name: /^Trojan/ }));

    const certificate = await within(dialog).findByRole("combobox", { name: "Trojan TLS 证书" });
    expect(get).toHaveBeenCalledWith("/api/admin/certificates/valid");
    expect(within(certificate).getByRole("option", { name: /global\.example\.com/ })).toBeInTheDocument();
    expect(within(certificate).getByRole("option", { name: /hk\.example\.com/ })).toBeInTheDocument();
    expect(within(certificate).queryByRole("option", { name: /tokyo\.example\.com/ })).not.toBeInTheDocument();
    expect(certificate).toHaveValue("10");
    expect(within(dialog).getByRole("spinbutton", { name: "入站监听端口" })).toHaveValue(8443);
    fireEvent.change(certificate, { target: { value: "10" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建入站" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/inbounds?server_id=11", {
      action: "add",
      inbound: expect.objectContaining({
        tag: "trojan-in",
        port: 8443,
        protocol: "trojan",
        cert_id: 10,
        streamSettings: expect.objectContaining({ network: "tcp", security: "tls" }),
      }),
    }));
  });

  it("creates Trojan TCP Reality on 443 with probed SNI and generated X25519 keys", async () => {
    mockServerReads([onlineServer], { inbounds: [] });
    let keypairIndex = 0;
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/xray/generate-x25519") {
        keypairIndex += 1;
        return { privateKey: (keypairIndex === 1 ? "A" : "C").repeat(43), publicKey: (keypairIndex === 1 ? "B" : "D").repeat(43) } as T;
      }
      if (path === "/api/admin/remote/inbounds?server_id=11") return { success: true } as T;
      throw new Error(`unexpected POST ${path}`);
    });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const operations = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(operations).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(operations).getByRole("tab", { name: "入站" }));
    fireEvent.click(await within(operations).findByRole("button", { name: "添加入站" }));
    const dialog = await screen.findByRole("dialog", { name: "添加入站" });
    fireEvent.click(within(dialog).getByRole("tab", { name: /^Trojan/ }));
    fireEvent.change(await within(dialog).findByRole("combobox", { name: "Trojan 传输与安全" }), { target: { value: "tcp-reality" } });

    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Trojan Reality 伪装目标 / SNI" })).toHaveValue(""));
    expect(within(dialog).getByRole("spinbutton", { name: "入站监听端口" })).toHaveValue(443);
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Trojan Reality 伪装目标 / SNI" }), { target: { value: "www.cloudflare.com" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Trojan Reality Short ID" }), { target: { value: "a1b2c3d4" } });
    await waitFor(() => expect(keypairIndex).toBeGreaterThanOrEqual(2));
    fireEvent.click(within(dialog).getByRole("button", { name: "创建入站" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/inbounds?server_id=11", {
      action: "add",
      inbound: expect.objectContaining({
        tag: "trojan-in",
        port: 443,
        protocol: "trojan",
        streamSettings: {
          network: "tcp",
          security: "reality",
          realitySettings: expect.objectContaining({
            target: "www.cloudflare.com:443",
            privateKey: "C".repeat(43),
            shortIds: ["a1b2c3d4"],
          }),
        },
      }),
    }));
  });

  it("keeps WireGuard view and delete available without exposing the destructive raw-edit path", async () => {
    const wireGuardInbound = {
      tag: "wireguard-in",
      protocol: "wireguard",
      port: 51820,
      settings: { address: ["10.66.66.1/32"], peers: [] },
      _source: "config",
      _runtime_status: "running",
    };
    mockServerReads([onlineServer], { inbounds: [wireGuardInbound] });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "入站" }));
    await within(dialog).findByText("wireguard-in");

    expect(within(dialog).getByRole("button", { name: "WireGuard 入站 wireguard-in 不能直接编辑，请删除后重新创建" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "查看" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "删除入站 wireguard-in" })).toBeEnabled();
  });

  it("edits an outbound through the real remove-then-add contract on one server", async () => {
    const original = { tag: "proxy-old", protocol: "socks", settings: { servers: [{ address: "old.example", port: 1080 }] } };
    mockServerReads([onlineServer], { outbounds: [original] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "出站" }));
    await within(dialog).findByText("proxy-old");
    fireEvent.click(within(dialog).getByRole("button", { name: "编辑出站 proxy-old" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "出站 Tag" }), { target: { value: "proxy-new" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "出站高级 JSON" }), { target: { value: JSON.stringify({ ...original, settings: { servers: [{ address: "new.example", port: 2080 }] } }) } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存并重建" }));

    await waitFor(() => expect(post).toHaveBeenNthCalledWith(1, "/api/admin/remote/outbounds?server_id=11", { action: "remove", tag: "proxy-old" }));
    expect(post).toHaveBeenNthCalledWith(2, "/api/admin/remote/outbounds?server_id=11", {
      action: "add",
      outbound: { tag: "proxy-new", protocol: "socks", settings: { servers: [{ address: "new.example", port: 2080 }] } },
    });
  });

  it("restores the original inbound when rebuilding an edited item fails", async () => {
    const original = { tag: "vless-in", protocol: "vless", port: 443, settings: { clients: [] }, _source: "config", _runtime_status: "running" };
    mockServerReads([onlineServer], { inbounds: [original] });
    const post = vi.spyOn(api, "post")
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error("new config rejected"))
      .mockResolvedValueOnce({ success: true });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "入站" }));
    await within(dialog).findByText("vless-in");
    fireEvent.click(within(dialog).getByRole("button", { name: "编辑入站 vless-in" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存并重建" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(post).toHaveBeenNthCalledWith(3, "/api/admin/remote/inbounds?server_id=11", {
      action: "add",
      inbound: { tag: "vless-in", protocol: "vless", port: 443, settings: { clients: [] } },
    });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("旧配置已自动恢复");
  });

  it("requires confirmation before deleting an outbound from the selected server", async () => {
    mockServerReads([onlineServer], { outbounds: [{ tag: "blocked", protocol: "blackhole", settings: {} }] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "出站" }));
    await within(dialog).findByText("blocked");
    fireEvent.click(within(dialog).getByRole("button", { name: "删除出站 blocked" }));
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/outbounds?server_id=11", { action: "remove", tag: "blocked" }));
  });

  it("shows common routing match fields and creates a rule through add_rule", async () => {
    mockServerReads([onlineServer], { outbounds: [{ tag: "media-out", protocol: "freedom" }, { tag: "proxy-google", protocol: "shadowsocks" }], routing: { domainStrategy: "IPIfNonMatch", balancers: [{ tag: "fallback" }], rules: [{
      type: "field",
      domain: ["domain:google.com"],
      ip: ["8.8.8.8"],
      port: "443",
      network: "tcp",
      inboundTag: ["vless-in"],
      user: ["alice@example.com"],
      protocol: ["bittorrent"],
      outboundTag: "proxy-google",
    }] } });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true, message: "updated" });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "路由规则" }));
    expect(await within(dialog).findByRole("button", { name: "删除路由规则 1" })).toBeInTheDocument();
    expect(within(dialog).getByText("domain:google.com")).toBeInTheDocument();
    expect(within(dialog).getByText("8.8.8.8")).toBeInTheDocument();
    expect(within(dialog).getByText("alice@example.com")).toBeInTheDocument();
    expect(within(dialog).getByText(/IPIfNonMatch/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "添加规则" }));
    expect(await screen.findByRole("dialog", { name: "添加路由规则" })).toBeInTheDocument();
    const outboundInput = within(dialog).getByLabelText("路由出站 Tag");
    const balancerInput = within(dialog).getByLabelText("路由负载均衡 Tag");
    const outboundOptions = document.getElementById(outboundInput.getAttribute("list") || "");
    const balancerOptions = document.getElementById(balancerInput.getAttribute("list") || "");
    expect(outboundOptions).not.toBeNull();
    expect(balancerOptions).not.toBeNull();
    expect([...outboundOptions!.querySelectorAll("option")].map((option) => option.value)).toEqual(expect.arrayContaining(["media-out", "proxy-google"]));
    expect([...balancerOptions!.querySelectorAll("option")].map((option) => option.value)).toContain("fallback");
    fireEvent.change(outboundInput, { target: { value: "media-out" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "路由域名" }), { target: { value: "domain:youtube.com\ngeosite:google" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "路由 IP" }), { target: { value: "geoip:private,10.0.0.0/8" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "路由端口" }), { target: { value: "443,8443" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "路由网络" }), { target: { value: "tcp,udp" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "路由入站 Tag" }), { target: { value: "vless-in,trojan-in" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "路由用户" }), { target: { value: "bob@example.com" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "路由协议" }), { target: { value: "bittorrent" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "路由规则高级 JSON" }), { target: { value: JSON.stringify({ type: "field", attrs: "browser == 'chrome'", outboundTag: "ignored", balancerTag: "ignored", _runtime: true }) } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建规则" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/routing?server_id=11", {
      action: "add_rule",
      rule: {
        type: "field",
        attrs: "browser == 'chrome'",
        domain: ["domain:youtube.com", "geosite:google"],
        ip: ["geoip:private", "10.0.0.0/8"],
        inboundTag: ["vless-in", "trojan-in"],
        user: ["bob@example.com"],
        protocol: ["bittorrent"],
        port: "443,8443",
        network: "tcp,udp",
        outboundTag: "media-out",
      },
    }));
  });

  it("deletes the selected routing rule by its current array index", async () => {
    mockServerReads([onlineServer], { routing: { rules: [
      { type: "field", domain: ["domain:first.example"], outboundTag: "direct" },
      { type: "field", domain: ["domain:blocked.example"], balancerTag: "fallback" },
    ] } });
    const notify = vi.fn();
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServicesWorkbenchPage notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "路由规则" }));
    await within(dialog).findByRole("button", { name: "删除路由规则 2" });
    fireEvent.click(within(dialog).getByRole("button", { name: "删除路由规则 2" }));
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/routing?server_id=11", { action: "remove_rule", index: 1 }));
    expect(notify).toHaveBeenCalledWith("路由规则 #2 已删除");
  });

  it("surfaces an HTTP 200 routing response whose success flag is false", async () => {
    mockServerReads([onlineServer], { routing: { rules: [{ type: "field", outboundTag: "direct" }] } });
    const notify = vi.fn();
    vi.spyOn(api, "post").mockResolvedValue({ success: false, error: "规则语义无效" });
    render(<ServicesWorkbenchPage notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "路由规则" }));
    await within(dialog).findByRole("button", { name: "删除路由规则 1" });
    fireEvent.click(within(dialog).getByRole("button", { name: "添加规则" }));
    fireEvent.change(within(dialog).getByLabelText("路由出站 Tag"), { target: { value: "broken-out" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建规则" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("规则语义无效");
    expect(within(dialog).getByLabelText("路由出站 Tag")).toHaveValue("broken-out");
    expect(notify).not.toHaveBeenCalled();
  });
});
