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
  country_code: "HK",
  cpu_pct: 12.4,
  loadavg: "0.12 0.08 0.03",
  mem_used: 3 * 1024 ** 3,
  mem_total: 8 * 1024 ** 3,
  disk_used: 40 * 1024 ** 3,
  disk_total: 100 * 1024 ** 3,
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
  inboundError?: string;
  xrayVersions?: Record<string, unknown>;
  agentVersion?: Record<string, unknown>;
  xrayConfig?: string;
  warpStatus?: Record<string, unknown>;
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
    if (path.includes("/api/admin/remote/xray/versions")) return (resources.xrayVersions ?? {
      success: true,
      version_selection_supported: true,
      latest: "v26.7.28",
      latest_stable: "v26.3.27",
      versions: [
        { version: "v26.7.28", name: "v26.7.28", prerelease: true, published_at: "2026-07-28T12:00:00Z" },
        { version: "v26.3.27", name: "v26.3.27", prerelease: false, published_at: "2026-03-27T12:00:00Z" },
      ],
    }) as T;
    if (path.includes("/api/admin/remote/agent/version-info")) return (resources.agentVersion ?? { server_id: 11, current: "0.3.0", latest: "0.3.1", upgrade_available: true }) as T;
    if (path.includes("/api/admin/remote/system/info")) return { success: true, hostname: "edge-hk", uptime: "3600", loadavg: "0.10 0.20 0.30 1/100 1", memory: { MemAvailable: "1024 MB" } } as T;
    if (path.includes("/api/admin/remote-servers/reveal-token")) return { success: true, token: "revealed-server-token", pull_token: "existing-agent-token", agent_token: "existing-agent-token", install_command: "authoritative-install-command" } as T;
    if (path === "/api/admin/remote/inbounds?server_id=11") {
      if (resources.inboundError) throw new Error(resources.inboundError);
      return { success: true, inbounds: resources.inbounds ?? [] } as T;
    }
    if (path === "/api/admin/remote/outbounds?server_id=11") return { success: true, outbounds: resources.outbounds ?? [] } as T;
    if (path === "/api/admin/remote/routing?server_id=11") return { success: true, routing: resources.routing ?? { rules: [] } } as T;
    if (path === "/api/admin/remote/xray/config?server_id=11") return { success: true, path: "/usr/local/etc/xray/config.json", config: resources.xrayConfig ?? JSON.stringify({ log: { loglevel: "warning" }, inbounds: [], outbounds: [], routing: { rules: [] }, dns: { servers: ["1.1.1.1"] } }, null, 2) } as T;
    if (path === "/api/admin/remote/warp/status?server_id=11") return (resources.warpStatus ?? { success: true, installed: false }) as T;
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
    let serverListRequests = 0;
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/remote-servers") {
        serverListRequests += 1;
        return { success: true, servers: [onlineServer] } as T;
      }
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

    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(statusRequests).toBe(1);
    expect(serverListRequests).toBeGreaterThanOrEqual(3);

    await act(async () => {
      resolveFirstStatus({
        success: true,
        xray: { installed: true, running: true, version: "Xray 25.1" },
        nginx: { installed: true, running: true, version: "nginx/1.26" },
      });
      await Promise.resolve();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(statusRequests).toBe(2);
  });

  it("does not overlap one-second fallback server-list refreshes", async () => {
    vi.useFakeTimers();
    let resolveFirstList!: (value: unknown) => void;
    const firstList = new Promise((resolve) => { resolveFirstList = resolve; });
    let listRequests = 0;
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/remote-servers") {
        listRequests += 1;
        if (listRequests === 1) return await firstList as T;
        return { success: true, servers: [onlineServer] } as T;
      }
      if (path.includes("/api/admin/remote/services/status")) return {
        success: true,
        xray: { installed: true, running: true, version: "Xray 25.1" },
        nginx: { installed: true, running: true, version: "nginx/1.26" },
      } as T;
      if (path.includes("/api/admin/remote/agent/version-info")) return { server_id: 11, current: "0.3.0", latest: "0.3.1", upgrade_available: true } as T;
      throw new Error(`unexpected GET ${path}`);
    });

    render(<ServicesWorkbenchPage notify={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(listRequests).toBe(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(listRequests).toBe(1);

    await act(async () => {
      resolveFirstList({ success: true, servers: [onlineServer] });
      await Promise.resolve();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(listRequests).toBe(2);
  });

  it("does not expose the retired advanced management entry", async () => {
    mockServerReads();
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    await screen.findByText("Edge Hong Kong");

    expect(screen.queryByRole("button", { name: "高级运维" })).not.toBeInTheDocument();
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

  it("shows country, live host resources, network speed and traffic on a service card", async () => {
    mockServerReads([onlineServer]);
    const { container } = render(<ServicesWorkbenchPage notify={vi.fn()} />);

    await screen.findByText("Edge Hong Kong");
    const card = container.querySelector(".service-card") as HTMLElement;
    const flag = within(card).getByTitle("HK");
    expect(flag.querySelector("img")).toHaveAttribute("src", expect.stringMatching(/(?:data:image\/svg\+xml|\.svg(?:\?|$))/));
    expect(flag).not.toHaveTextContent("HK");
    expect(within(card).getByText("CPU")).toBeInTheDocument();
    expect(within(card).getByText("12%")).toBeInTheDocument();
    expect(within(card).getByText("内存")).toBeInTheDocument();
    expect(within(card).getByText("38%")).toBeInTheDocument();
    expect(within(card).getByText("磁盘")).toBeInTheDocument();
    expect(within(card).getByText("40%")).toBeInTheDocument();
    expect(within(card).getByText("实时网速")).toBeInTheDocument();
    expect(within(card).getByText("流量统计")).toBeInTheDocument();
  });

  it("never falls back to unselected online servers when an offline server is selected", async () => {
    mockServerReads();
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    await screen.findByText("Edge Hong Kong");
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 Edge Tokyo" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /升级选中 Agent \(0\/1\)/ })).toBeDisabled());

    fireEvent.click(screen.getByRole("checkbox", { name: "选择 Edge Hong Kong" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /升级选中 Agent \(1\/2\)/ })).toBeEnabled());
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
    fireEvent.click(await within(menu).findByRole("menuitem", { name: "更新到 v26.3.27" }));
    const confirm = screen.getByRole("dialog", { name: "更新 Xray" });
    fireEvent.click(await within(confirm).findByRole("button", { name: "更新到 v26.3.27" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/remote/xray/install-stream?server_id=11");
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "POST" }));
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ body: JSON.stringify({ version: "v26.3.27" }) }));
  });

  it("lets the operator select an official Xray prerelease explicitly", async () => {
    mockServerReads([onlineServer]);
    const fetchMock = vi.fn().mockResolvedValue(new Response('data: {"type":"complete","success":true,"message":"updated"}\n\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理 Edge Hong Kong Xray v25.1" }));
    fireEvent.click(within(screen.getByRole("menu", { name: "Edge Hong Kong Xray 快捷操作" })).getByRole("menuitem", { name: "选择 / 重装核心" }));
    const dialog = screen.getByRole("dialog", { name: "更新 Xray" });
    fireEvent.click(await within(dialog).findByRole("radio", { name: /v26\.7\.28/ }));

    expect(within(dialog).getByText(/尚未通过 Arcway 完整协议验收/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "更新到 v26.7.28" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ body: JSON.stringify({ version: "v26.7.28" }) }));
  });

  it("blocks version selection until the external-Xray Agent is upgraded", async () => {
    mockServerReads([onlineServer], {
      xrayVersions: {
        success: true,
        version_selection_supported: false,
        support_error: "当前 Agent 不支持指定 Xray 版本，请先升级 Agent",
        versions: [],
      },
    });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理 Edge Hong Kong Xray v25.1" }));
    fireEvent.click(within(screen.getByRole("menu", { name: "Edge Hong Kong Xray 快捷操作" })).getByRole("menuitem", { name: "选择 / 重装核心" }));
    const dialog = screen.getByRole("dialog", { name: "更新 Xray" });

    expect(await within(dialog).findByText("请先升级 Agent")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "选择版本" })).toBeDisabled();
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
    expect(await within(menu).findByRole("menuitem", { name: "更新到 v26.3.27" })).toBeEnabled();
    expect(within(menu).getByRole("menuitem", { name: "选择 / 重装核心" })).toBeEnabled();
    expect(within(menu).queryByRole("menuitem", { name: "暂停 Xray" })).not.toBeInTheDocument();
  });

  it("disables one-click Xray update when the installed core is already current", async () => {
    const currentServer = { ...onlineServer, xray_version: "Xray 26.3.27" };
    mockServerReads([currentServer], {
      serviceStatus: {
        success: true,
        xray: { installed: true, running: true, version: "Xray 26.3.27" },
        nginx: { installed: true, running: true, version: "nginx/1.26" },
      },
      xrayVersions: {
        success: true,
        version_selection_supported: true,
        latest: "v26.7.28",
        latest_stable: "v26.3.27",
        versions: [
          { version: "v26.7.28", name: "v26.7.28", prerelease: true },
          { version: "v26.3.27", name: "v26.3.27", prerelease: false },
        ],
      },
    });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理 Edge Hong Kong Xray v26.3.27" }));
    const menu = screen.getByRole("menu", { name: "Edge Hong Kong Xray 快捷操作" });

    expect(await within(menu).findByRole("menuitem", { name: "已是最新版 v26.3.27" })).toBeDisabled();
    const selector = within(menu).getByRole("menuitem", { name: "选择 / 重装核心" });
    expect(selector).toBeEnabled();
    fireEvent.click(selector);
    expect(screen.getByRole("dialog", { name: "更新 Xray" })).toBeInTheDocument();
  });

  it("shows the Agent upgrade indicator and requires confirmation before upgrading", async () => {
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

    const confirm = await screen.findByRole("dialog", { name: "升级 Agent" });
    expect(within(confirm).getByText(/Edge Hong Kong 将从 v0\.3\.0 升级到 v0\.3\.1/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "确认升级" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/remote/agent/upgrade-stream?server_id=11");
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "POST" }));
    const dialog = await screen.findByRole("dialog", { name: "Agent 批量升级" });
    expect(within(dialog).getByLabelText("Agent 升级日志")).toHaveTextContent("Downloading Agent");
    expect(notify).toHaveBeenCalledWith("1 台 Agent 已完成升级", "success");
  });

  it("disables every Agent upgrade entry when the current version is latest", async () => {
    mockServerReads([onlineServer], {
      agentVersion: { server_id: 11, current: "0.4.8", latest: "0.4.8", upgrade_available: false },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    const agentButton = await screen.findByRole("button", { name: "Edge Hong Kong Agent 已是最新版" });
    expect(agentButton).toBeDisabled();
    expect(agentButton).toHaveAttribute("title", "Agent 当前已是上游最新版 v0.4.8");
    expect(agentButton).not.toHaveClass("has-update");
    expect(screen.getByRole("button", { name: "Agent 已是最新版" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "管理" }));
    const details = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    const detailsUpgrade = await within(details).findByRole("button", { name: "已是最新版" });
    expect(detailsUpgrade).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Agent 批量升级" })).not.toBeInTheDocument();
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

  it("keeps proxy creation out of service management", async () => {
    const get = mockServerReads([onlineServer]);
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    expect(await screen.findByText("Edge Hong Kong")).toBeInTheDocument();
    expect(screen.queryByText("1 个入站")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());

    expect(within(dialog).queryByRole("tab", { name: "入站" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "添加入站" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "概览" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "服务控制" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "Speedtest" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "Xray 设置" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("tab", { name: "出站" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "服务器分享" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("tab", { name: "Xray 设置" }));
    expect(within(dialog).getByRole("tab", { name: "基础设置" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "路由规则" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "出站规则" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "DNS" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "高级配置" })).toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith("/api/admin/remote/inbounds?server_id=11");
  });

  it("groups Xray settings and saves structured changes through the protected full-config path", async () => {
    const initialConfig = {
      log: { loglevel: "warning", access: "/var/log/xray/access.log" },
      inbounds: [{ tag: "database-owned", protocol: "vless", port: 443 }],
      outbounds: [{ tag: "direct", protocol: "freedom" }],
      routing: { rules: [{ type: "field", outboundTag: "direct" }] },
      dns: { servers: ["1.1.1.1"] },
    };
    mockServerReads([onlineServer], { xrayConfig: JSON.stringify(initialConfig, null, 2) });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Xray 设置" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    const logLevel = await within(dialog).findByRole("combobox", { name: "Xray 日志级别" });
    expect(within(dialog).getByText("运行中")).toBeInTheDocument();
    fireEvent.change(logLevel, { target: { value: "info" } });
    fireEvent.click(within(dialog).getByRole("tab", { name: "DNS" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Xray DNS JSON" }), { target: { value: JSON.stringify({ servers: ["9.9.9.9", "1.1.1.1"] }, null, 2) } });
    fireEvent.click(within(dialog).getByRole("tab", { name: "高级配置" }));

    const advanced = within(dialog).getByRole("textbox", { name: "Xray 配置 JSON" });
    const merged = JSON.parse((advanced as HTMLTextAreaElement).value);
    expect(merged.log.loglevel).toBe("info");
    expect(merged.dns.servers).toEqual(["9.9.9.9", "1.1.1.1"]);
    expect(merged.inbounds).toEqual(initialConfig.inbounds);
    fireEvent.click(within(dialog).getByRole("button", { name: "保存并应用" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/xray/config?server_id=11", expect.objectContaining({ path: "/usr/local/etc/xray/config.json" })));
    const configWrite = post.mock.calls.find(([path]) => path === "/api/admin/remote/xray/config?server_id=11");
    expect(JSON.parse((configWrite?.[1] as { config: string }).config).inbounds).toEqual(initialConfig.inbounds);
    expect(post).toHaveBeenCalledWith("/api/admin/remote/services/control?server_id=11", { service: "xray", action: "restart" });
  });

  it("applies basic Xray presets without changing database-owned or conditional configuration", async () => {
    const initialConfig = {
      log: { loglevel: "warning" },
      inbounds: [{ tag: "database-owned", protocol: "vless", port: 443 }],
      outbounds: [
        { tag: "direct", protocol: "freedom", settings: {} },
        { tag: "custom-proxy", protocol: "socks", settings: { servers: [] } },
      ],
      routing: {
        domainStrategy: "AsIs",
        rules: [
          { type: "field", inboundTag: ["special-in"], outboundTag: "custom-proxy", domain: ["domain:conditional.example"] },
        ],
      },
      dns: { servers: ["1.1.1.1"] },
    };
    mockServerReads([onlineServer], { xrayConfig: JSON.stringify(initialConfig, null, 2) });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Xray 设置" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    fireEvent.change(await within(dialog).findByRole("combobox", { name: "Freedom 域名策略" }), { target: { value: "UseIPv4" } });
    fireEvent.click(within(dialog).getByText("基础路由", { exact: true }));
    fireEvent.click(within(dialog).getByRole("switch", { name: "屏蔽 BitTorrent" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "全部广告" }));
    fireEvent.click(within(dialog).getByRole("tab", { name: "高级配置" }));

    const merged = JSON.parse((within(dialog).getByRole("textbox", { name: "Xray 配置 JSON" }) as HTMLTextAreaElement).value);
    expect(merged.inbounds).toEqual(initialConfig.inbounds);
    expect(merged.dns).toEqual(initialConfig.dns);
    expect(merged.outbounds).toContainEqual(expect.objectContaining({ tag: "custom-proxy", protocol: "socks" }));
    expect(merged.outbounds).toContainEqual(expect.objectContaining({ tag: "blocked", protocol: "blackhole" }));
    expect(merged.outbounds.find((item: { tag?: string }) => item.tag === "direct").settings.domainStrategy).toBe("UseIPv4");
    expect(merged.routing.rules).toContainEqual(expect.objectContaining({ inboundTag: ["special-in"], domain: ["domain:conditional.example"] }));
    expect(merged.routing.rules).toContainEqual(expect.objectContaining({ outboundTag: "blocked", protocol: ["bittorrent"] }));
    expect(merged.routing.rules).toContainEqual(expect.objectContaining({ outboundTag: "blocked", domain: ["geosite:category-ads-all"] }));
  });

  it("opens WARP management inside the current server Xray settings", async () => {
    const get = mockServerReads([onlineServer], { warpStatus: { success: true, installed: false } });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Xray 设置" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    fireEvent.click(within(dialog).getByText("基础路由", { exact: true }));
    fireEvent.click(within(dialog).getByRole("button", { name: "管理 WARP" }));

    expect(await within(dialog).findByRole("heading", { name: "WARP 出站" })).toBeInTheDocument();
    expect(within(dialog).getByText("未注册", { exact: true })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/api/admin/remote/warp/status?server_id=11");
    expect(screen.getByRole("dialog", { name: "Edge Hong Kong" })).toBeInTheDocument();
  });

  it("restores the previous Xray config when the new config cannot restart", async () => {
    const initialConfig = {
      log: { loglevel: "warning" },
      inbounds: [{ tag: "database-owned", protocol: "vless", port: 443 }],
      outbounds: [{ tag: "direct", protocol: "freedom", settings: {} }],
      routing: { rules: [] },
      dns: { servers: ["1.1.1.1"] },
    };
    const initialJSON = JSON.stringify(initialConfig, null, 2);
    mockServerReads([onlineServer], { xrayConfig: initialJSON });
    let restartAttempts = 0;
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/remote/services/control?server_id=11") {
        restartAttempts += 1;
        if (restartAttempts === 1) throw new Error("new process exited");
      }
      return { success: true } as T;
    });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Xray 设置" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    fireEvent.change(await within(dialog).findByRole("combobox", { name: "Freedom 域名策略" }), { target: { value: "UseIPv4" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存并应用" }));

    expect(await within(dialog).findByText(/新配置未能启动，已自动恢复旧配置/)).toBeInTheDocument();
    expect(restartAttempts).toBe(2);
    const writes = post.mock.calls.filter(([path]) => path === "/api/admin/remote/xray/config?server_id=11");
    expect(writes).toHaveLength(2);
    expect((writes[1][1] as { config: string }).config).toBe(initialJSON);
    fireEvent.click(within(dialog).getByRole("tab", { name: "高级配置" }));
    expect(within(dialog).getByRole("textbox", { name: "Xray 配置 JSON" })).toHaveValue(initialJSON);
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
    fireEvent.click(await within(confirm).findByRole("button", { name: "更新到 v26.3.27" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/remote/xray/install-stream?server_id=11");
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "POST" }));
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ body: JSON.stringify({ version: "v26.3.27" }) }));
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

  it("edits an outbound through the real remove-then-add contract on one server", async () => {
    const original = { tag: "proxy-old", protocol: "socks", settings: { servers: [{ address: "old.example", port: 1080 }] } };
    mockServerReads([onlineServer], { outbounds: [original] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "Xray 设置" }));
    fireEvent.click(within(dialog).getByRole("tab", { name: "出站规则" }));
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

  it("creates a VLESS Reality outbound entirely through the visual editor", async () => {
    mockServerReads([onlineServer], { outbounds: [{ tag: "direct", protocol: "freedom", settings: {} }] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const serverDialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(serverDialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(serverDialog).getByRole("tab", { name: "Xray 设置" }));
    fireEvent.click(within(serverDialog).getByRole("tab", { name: "出站规则" }));
    fireEvent.click(await within(serverDialog).findByRole("button", { name: "添加出站" }));

    const editor = await screen.findByRole("dialog", { name: "添加出站" });
    fireEvent.change(within(editor).getByRole("textbox", { name: "出站 Tag" }), { target: { value: "edge-reality" } });
    fireEvent.change(within(editor).getByRole("combobox", { name: "出站协议" }), { target: { value: "vless" } });
    fireEvent.change(within(editor).getByRole("textbox", { name: "出站目标地址" }), { target: { value: "edge.example.com" } });
    fireEvent.change(within(editor).getByRole("spinbutton", { name: "出站目标端口" }), { target: { value: "443" } });
    fireEvent.change(within(editor).getByRole("textbox", { name: "出站 Email" }), { target: { value: "route@example.com" } });
    fireEvent.change(within(editor).getByRole("textbox", { name: "出站 ID" }), { target: { value: "11111111-2222-4333-8444-555555555555" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Reality" }));
    fireEvent.change(within(editor).getByRole("textbox", { name: "出站 Server name" }), { target: { value: "cdn.example.com" } });
    fireEvent.change(within(editor).getByRole("textbox", { name: "出站 Reality Public key" }), { target: { value: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFE" } });
    fireEvent.change(within(editor).getByRole("textbox", { name: "出站 Reality Short ID" }), { target: { value: "a1b2c3d4" } });
    fireEvent.click(within(editor).getByRole("button", { name: "创建出站" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/outbounds?server_id=11", {
      action: "add",
      outbound: {
        tag: "edge-reality",
        protocol: "vless",
        settings: {
          vnext: [{
            address: "edge.example.com",
            port: 443,
            users: [{
              id: "11111111-2222-4333-8444-555555555555",
              email: "route@example.com",
              encryption: "none",
            }],
          }],
        },
        streamSettings: {
          network: "tcp",
          security: "reality",
          realitySettings: {
            serverName: "cdn.example.com",
            password: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFE",
            shortId: "a1b2c3d4",
            fingerprint: "chrome",
            spiderX: "/",
          },
        },
      },
    }));
  });

  it("preserves and updates a direct-form VLESS outbound", async () => {
    const original = {
      tag: "direct-vless",
      protocol: "vless",
      settings: {
        address: "old.example.com",
        port: 443,
        id: "11111111-2222-4333-8444-555555555555",
        email: "before@example.com",
        encryption: "none",
        reverse: { tag: "reverse-only" },
      },
      streamSettings: { network: "tcp", security: "none" },
    };
    mockServerReads([onlineServer], { outbounds: [original] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const serverDialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(serverDialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(serverDialog).getByRole("tab", { name: "Xray 设置" }));
    fireEvent.click(within(serverDialog).getByRole("tab", { name: "出站规则" }));
    expect(await within(serverDialog).findByText("old.example.com:443")).toBeInTheDocument();
    fireEvent.click(await within(serverDialog).findByRole("button", { name: "编辑出站 direct-vless" }));

    const editor = await screen.findByRole("dialog", { name: "编辑出站" });
    expect(within(editor).getByRole("textbox", { name: "出站目标地址" })).toHaveValue("old.example.com");
    expect(within(editor).getByRole("textbox", { name: "出站 ID" })).toHaveValue("11111111-2222-4333-8444-555555555555");
    fireEvent.change(within(editor).getByRole("textbox", { name: "出站目标地址" }), { target: { value: "new.example.com" } });
    fireEvent.change(within(editor).getByRole("textbox", { name: "出站 Email" }), { target: { value: "after@example.com" } });
    fireEvent.click(within(editor).getByRole("button", { name: "保存并重建" }));

    await waitFor(() => expect(post).toHaveBeenNthCalledWith(1, "/api/admin/remote/outbounds?server_id=11", { action: "remove", tag: "direct-vless" }));
    expect(post).toHaveBeenNthCalledWith(2, "/api/admin/remote/outbounds?server_id=11", {
      action: "add",
      outbound: {
        ...original,
        settings: { ...original.settings, address: "new.example.com", email: "after@example.com" },
      },
    });
  });

  it("preserves and updates a direct-form SOCKS outbound", async () => {
    const original = {
      tag: "direct-socks",
      protocol: "socks",
      settings: { address: "old.proxy.example", port: 1080, level: 2, email: "proxy@example.com", user: "alice", pass: "old-pass" },
      streamSettings: { network: "tcp", security: "none" },
    };
    mockServerReads([onlineServer], { outbounds: [original] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const serverDialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(serverDialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(serverDialog).getByRole("tab", { name: "Xray 设置" }));
    fireEvent.click(within(serverDialog).getByRole("tab", { name: "出站规则" }));
    fireEvent.click(await within(serverDialog).findByRole("button", { name: "编辑出站 direct-socks" }));

    const editor = await screen.findByRole("dialog", { name: "编辑出站" });
    expect(within(editor).getByRole("textbox", { name: "出站用户名" })).toHaveValue("alice");
    fireEvent.change(within(editor).getByLabelText("出站密码"), { target: { value: "new-pass" } });
    fireEvent.click(within(editor).getByRole("button", { name: "保存并重建" }));

    await waitFor(() => expect(post).toHaveBeenNthCalledWith(1, "/api/admin/remote/outbounds?server_id=11", { action: "remove", tag: "direct-socks" }));
    expect(post).toHaveBeenNthCalledWith(2, "/api/admin/remote/outbounds?server_id=11", {
      action: "add",
      outbound: { ...original, settings: { ...original.settings, pass: "new-pass" } },
    });
  });

  it("round-trips an existing loopback inbound tag through the visual editor", async () => {
    const original = {
      tag: "loopback-out",
      protocol: "loopback",
      settings: { inboundTag: "api-in", customSetting: "preserved" },
    };
    mockServerReads([onlineServer], { outbounds: [original] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const serverDialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(serverDialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(serverDialog).getByRole("tab", { name: "Xray 设置" }));
    fireEvent.click(within(serverDialog).getByRole("tab", { name: "出站规则" }));
    fireEvent.click(await within(serverDialog).findByRole("button", { name: "编辑出站 loopback-out" }));

    const editor = await screen.findByRole("dialog", { name: "编辑出站" });
    expect(within(editor).getByRole("textbox", { name: "Loopback 入站 Tag" })).toHaveValue("api-in");
    fireEvent.click(within(editor).getByRole("button", { name: "保存并重建" }));

    await waitFor(() => expect(post).toHaveBeenNthCalledWith(1, "/api/admin/remote/outbounds?server_id=11", { action: "remove", tag: "loopback-out" }));
    expect(post).toHaveBeenNthCalledWith(2, "/api/admin/remote/outbounds?server_id=11", { action: "add", outbound: original });
  });

  it("preserves and exposes the network of an existing DNS outbound", async () => {
    const original = {
      tag: "dns-udp",
      protocol: "dns",
      settings: { network: "udp", address: "1.1.1.1", port: 53, nonIPQuery: "skip" },
    };
    mockServerReads([onlineServer], { outbounds: [original] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const serverDialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(serverDialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(serverDialog).getByRole("tab", { name: "Xray 设置" }));
    fireEvent.click(within(serverDialog).getByRole("tab", { name: "出站规则" }));
    const row = (await within(serverDialog).findByText("dns-udp")).closest("tr");
    expect(row).toHaveTextContent("UDP");
    fireEvent.click(within(serverDialog).getByRole("button", { name: "编辑出站 dns-udp" }));

    const editor = await screen.findByRole("dialog", { name: "编辑出站" });
    expect(within(editor).getByRole("combobox", { name: "DNS 出站网络" })).toHaveValue("udp");
    fireEvent.click(within(editor).getByRole("button", { name: "保存并重建" }));

    await waitFor(() => expect(post).toHaveBeenNthCalledWith(1, "/api/admin/remote/outbounds?server_id=11", { action: "remove", tag: "dns-udp" }));
    expect(post).toHaveBeenNthCalledWith(2, "/api/admin/remote/outbounds?server_id=11", { action: "add", outbound: original });
  });

  it("preserves additional legacy targets and users when editing the first VLESS target", async () => {
    const original = {
      tag: "multi-vless",
      protocol: "vless",
      settings: {
        vnext: [
          {
            address: "primary.example.com",
            port: 443,
            users: [
              { id: "11111111-2222-4333-8444-555555555555", email: "primary@example.com", encryption: "none" },
              { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", email: "secondary-user@example.com", encryption: "none", level: 3 },
            ],
          },
          { address: "backup.example.com", port: 8443, users: [{ id: "99999999-8888-4777-8666-555555555555", encryption: "none" }] },
        ],
      },
      streamSettings: { network: "tcp", security: "none" },
    };
    mockServerReads([onlineServer], { outbounds: [original] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const serverDialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(serverDialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(serverDialog).getByRole("tab", { name: "Xray 设置" }));
    fireEvent.click(within(serverDialog).getByRole("tab", { name: "出站规则" }));
    fireEvent.click(await within(serverDialog).findByRole("button", { name: "编辑出站 multi-vless" }));

    const editor = await screen.findByRole("dialog", { name: "编辑出站" });
    fireEvent.change(within(editor).getByRole("textbox", { name: "出站 Email" }), { target: { value: "updated@example.com" } });
    fireEvent.click(within(editor).getByRole("button", { name: "保存并重建" }));

    await waitFor(() => expect(post).toHaveBeenNthCalledWith(2, "/api/admin/remote/outbounds?server_id=11", {
      action: "add",
      outbound: {
        ...original,
        settings: {
          vnext: [
            { ...original.settings.vnext[0], users: [{ ...original.settings.vnext[0].users[0], email: "updated@example.com" }, original.settings.vnext[0].users[1]] },
            original.settings.vnext[1],
          ],
        },
      },
    }));
  });

  it("clears incompatible settings and credentials when switching outbound protocol", async () => {
    const original = {
      tag: "switch-me",
      protocol: "socks",
      settings: { servers: [{ address: "secret.example.com", port: 1080, users: [{ user: "alice", pass: "secret" }] }] },
      streamSettings: { network: "xhttp", security: "tls", xhttpSettings: { host: "old.example", path: "/old", mode: "stream-up" }, tlsSettings: { serverName: "old.example" } },
    };
    mockServerReads([onlineServer], { outbounds: [original] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const serverDialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(serverDialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(serverDialog).getByRole("tab", { name: "Xray 设置" }));
    fireEvent.click(within(serverDialog).getByRole("tab", { name: "出站规则" }));
    fireEvent.click(await within(serverDialog).findByRole("button", { name: "编辑出站 switch-me" }));
    const editor = await screen.findByRole("dialog", { name: "编辑出站" });
    fireEvent.change(within(editor).getByRole("combobox", { name: "出站协议" }), { target: { value: "blackhole" } });
    fireEvent.click(within(editor).getByRole("button", { name: "保存并重建" }));

    await waitFor(() => expect(post).toHaveBeenNthCalledWith(2, "/api/admin/remote/outbounds?server_id=11", {
      action: "add",
      outbound: { tag: "switch-me", protocol: "blackhole", settings: {} },
    }));
  });

  it("builds XHTTP Reality and VLESS Vision through visual controls", async () => {
    mockServerReads([onlineServer], { outbounds: [{ tag: "direct", protocol: "freedom", settings: {} }] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const serverDialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(serverDialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(serverDialog).getByRole("tab", { name: "Xray 设置" }));
    fireEvent.click(within(serverDialog).getByRole("tab", { name: "出站规则" }));
    fireEvent.click(await within(serverDialog).findByRole("button", { name: "添加出站" }));
    const editor = await screen.findByRole("dialog", { name: "添加出站" });
    fireEvent.change(within(editor).getByRole("textbox", { name: "出站 Tag" }), { target: { value: "xhttp-vision" } });
    fireEvent.change(within(editor).getByRole("combobox", { name: "出站协议" }), { target: { value: "vless" } });
    fireEvent.change(within(editor).getByRole("textbox", { name: "出站目标地址" }), { target: { value: "edge.example.com" } });
    fireEvent.change(within(editor).getByRole("spinbutton", { name: "出站目标端口" }), { target: { value: "443" } });
    fireEvent.change(within(editor).getByRole("textbox", { name: "出站 ID" }), { target: { value: "11111111-2222-4333-8444-555555555555" } });
    fireEvent.change(within(editor).getByRole("combobox", { name: "出站 VLESS Flow" }), { target: { value: "xtls-rprx-vision" } });
    fireEvent.change(within(editor).getByRole("combobox", { name: "出站传输" }), { target: { value: "xhttp" } });
    fireEvent.change(within(editor).getByRole("textbox", { name: "出站 XHTTP 路径" }), { target: { value: "/vision" } });
    fireEvent.change(within(editor).getByRole("textbox", { name: "出站 Host" }), { target: { value: "cdn.example.com" } });
    fireEvent.change(within(editor).getByRole("combobox", { name: "出站 XHTTP Mode" }), { target: { value: "stream-up" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Reality" }));
    fireEvent.change(within(editor).getByRole("textbox", { name: "出站 Reality Public key" }), { target: { value: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFE" } });
    fireEvent.change(within(editor).getByRole("textbox", { name: "出站 Server name" }), { target: { value: "cdn.example.com" } });
    fireEvent.click(within(editor).getByRole("button", { name: "创建出站" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/outbounds?server_id=11", expect.objectContaining({
      action: "add",
      outbound: expect.objectContaining({
        settings: { vnext: [{ address: "edge.example.com", port: 443, users: [{ id: "11111111-2222-4333-8444-555555555555", encryption: "none", flow: "xtls-rprx-vision" }] }] },
        streamSettings: expect.objectContaining({ network: "xhttp", security: "reality", xhttpSettings: { path: "/vision", host: "cdn.example.com", mode: "stream-up" } }),
      }),
    })));
  });

  it("keeps WireGuard peer metadata and additional peers when editing", async () => {
    const original = {
      tag: "wg-out",
      protocol: "wireguard",
      settings: {
        secretKey: "1".repeat(64),
        address: ["10.0.0.2/32"],
        mtu: 1420,
        peers: [
          { publicKey: "2".repeat(64), preSharedKey: "3".repeat(64), endpoint: "old.example.com:51820", allowedIPs: ["0.0.0.0/0"], keepAlive: 25 },
          { publicKey: "4".repeat(64), endpoint: "backup.example.com:51820", allowedIPs: ["10.0.0.0/8"] },
        ],
      },
    };
    mockServerReads([onlineServer], { outbounds: [original] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const serverDialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(serverDialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(serverDialog).getByRole("tab", { name: "Xray 设置" }));
    fireEvent.click(within(serverDialog).getByRole("tab", { name: "出站规则" }));
    fireEvent.click(await within(serverDialog).findByRole("button", { name: "编辑出站 wg-out" }));

    const editor = await screen.findByRole("dialog", { name: "编辑出站" });
    fireEvent.change(within(editor).getByRole("textbox", { name: "WireGuard Peer endpoint" }), { target: { value: "new.example.com:51820" } });
    fireEvent.click(within(editor).getByRole("button", { name: "保存并重建" }));

    await waitFor(() => expect(post).toHaveBeenNthCalledWith(1, "/api/admin/remote/outbounds?server_id=11", { action: "remove", tag: "wg-out" }));
    expect(post).toHaveBeenNthCalledWith(2, "/api/admin/remote/outbounds?server_id=11", {
      action: "add",
      outbound: {
        ...original,
        settings: {
          ...original.settings,
          peers: [{ ...original.settings.peers[0], endpoint: "new.example.com:51820" }, original.settings.peers[1]],
        },
      },
    });
  });

  it("disables Reality when the selected transport is incompatible", async () => {
    mockServerReads([onlineServer], { outbounds: [{ tag: "direct", protocol: "freedom", settings: {} }] });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const serverDialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(serverDialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(serverDialog).getByRole("tab", { name: "Xray 设置" }));
    fireEvent.click(within(serverDialog).getByRole("tab", { name: "出站规则" }));
    fireEvent.click(await within(serverDialog).findByRole("button", { name: "添加出站" }));

    const editor = await screen.findByRole("dialog", { name: "添加出站" });
    fireEvent.change(within(editor).getByRole("combobox", { name: "出站协议" }), { target: { value: "vmess" } });
    expect(within(editor).getByRole("textbox", { name: "出站 VMess Security" })).toHaveValue("auto");
    fireEvent.change(within(editor).getByRole("combobox", { name: "出站协议" }), { target: { value: "vless" } });
    fireEvent.change(within(editor).getByRole("combobox", { name: "出站传输" }), { target: { value: "ws" } });
    expect(within(editor).getByRole("button", { name: "Reality" })).toBeDisabled();
    expect(within(editor).getByRole("combobox", { name: "出站传输" })).not.toHaveTextContent("QUIC");
    fireEvent.change(within(editor).getByRole("combobox", { name: "出站传输" }), { target: { value: "kcp" } });
    expect(within(editor).getByRole("spinbutton", { name: "出站 mKCP MTU" })).toHaveValue(1350);
    fireEvent.change(within(editor).getByRole("combobox", { name: "出站传输" }), { target: { value: "httpupgrade" } });
    expect(within(editor).getByRole("textbox", { name: "出站 HTTPUpgrade 路径" })).toBeVisible();
    fireEvent.change(within(editor).getByRole("combobox", { name: "出站传输" }), { target: { value: "xhttp" } });
    expect(within(editor).getByRole("button", { name: "Reality" })).toBeEnabled();
    expect(within(editor).getByRole("textbox", { name: "出站 XHTTP 路径" })).toBeVisible();
  });

  it("requires confirmation before deleting an outbound from the selected server", async () => {
    mockServerReads([onlineServer], { outbounds: [{ tag: "blocked", protocol: "blackhole", settings: {} }] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "Xray 设置" }));
    fireEvent.click(within(dialog).getByRole("tab", { name: "出站规则" }));
    await within(dialog).findByText("blocked");
    fireEvent.click(within(dialog).getByRole("button", { name: "删除出站 blocked" }));
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/outbounds?server_id=11", { action: "remove", tag: "blocked" }));
  });

  it("shows common routing match fields and creates a rule through an atomic hot mutation", async () => {
    mockServerReads([onlineServer], { inbounds: [{ tag: "vless-in", protocol: "vless" }, { tag: "trojan-in", protocol: "trojan" }], outbounds: [{ tag: "media-out", protocol: "freedom" }, { tag: "proxy-google", protocol: "shadowsocks" }], routing: { domainStrategy: "IPIfNonMatch", balancers: [{ tag: "fallback" }], rules: [{
      type: "field",
      domain: ["domain:google.com"],
      ip: ["8.8.8.8"],
      port: "443",
      network: "tcp",
      inboundTag: ["vless-in"],
      user: ["alice@example.com"],
      protocol: ["bittorrent"],
      outboundTag: "ghost-out",
    }] } });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true, message: "updated" });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "Xray 设置" }));
    fireEvent.click(within(dialog).getByRole("tab", { name: "路由规则" }));
    expect(await within(dialog).findByRole("button", { name: "删除路由规则 1" })).toBeInTheDocument();
    expect(within(dialog).getByText("domain:google.com")).toBeInTheDocument();
    expect(within(dialog).getByText("8.8.8.8")).toBeInTheDocument();
    expect(within(dialog).getByText("alice@example.com")).toBeInTheDocument();
    expect(within(dialog).getByText(/IPIfNonMatch/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "添加规则" }));
    expect(await screen.findByRole("dialog", { name: "添加路由规则" })).toBeInTheDocument();
    const outboundSelect = within(dialog).getByRole("combobox", { name: "路由出站 Tag" });
    const balancerSelect = within(dialog).getByRole("combobox", { name: "路由负载均衡 Tag" });
    expect(outboundSelect.tagName).toBe("SELECT");
    expect(balancerSelect.tagName).toBe("SELECT");
    expect([...outboundSelect.querySelectorAll("option")].map((option) => option.value)).toEqual(["", "media-out", "proxy-google"]);
    expect([...outboundSelect.querySelectorAll("option")].map((option) => option.value)).not.toContain("ghost-out");
    expect([...balancerSelect.querySelectorAll("option")].map((option) => option.value)).toEqual(["", "fallback"]);
    fireEvent.change(outboundSelect, { target: { value: "media-out" } });
    fireEvent.change(balancerSelect, { target: { value: "fallback" } });
    expect(outboundSelect).toHaveValue("");
    fireEvent.change(outboundSelect, { target: { value: "media-out" } });
    expect(balancerSelect).toHaveValue("");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "路由来源 IP" }), { target: { value: "192.0.2.0/24" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "路由域名" }), { target: { value: "domain:youtube.com,geosite:google" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "路由 IP" }), { target: { value: "geoip:private,10.0.0.0/8" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "路由端口" }), { target: { value: "443,8443" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "路由网络" }), { target: { value: "tcp,udp" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "路由用户" }), { target: { value: "bob@example.com" } });
    const protocolSelect = within(dialog).getByRole("button", { name: "路由协议" });
    fireEvent.click(protocolSelect);
    expect(protocolSelect).toHaveAttribute("aria-expanded", "true");
    const focusedProtocolOption = within(dialog).getByRole("option", { name: "http" });
    focusedProtocolOption.focus();
    fireEvent.keyDown(focusedProtocolOption, { key: "Escape" });
    expect(within(dialog).getByRole("dialog", { name: "添加路由规则" })).toBeInTheDocument();
    expect(protocolSelect).toHaveAttribute("aria-expanded", "false");
    expect(protocolSelect).toHaveFocus();
    fireEvent.click(protocolSelect);
    fireEvent.click(within(dialog).getByRole("option", { name: "bittorrent" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "路由入站 Tag" }));
    fireEvent.click(within(dialog).getByRole("option", { name: "vless-in" }));
    fireEvent.click(within(dialog).getByRole("option", { name: "trojan-in" }));
    fireEvent.click(within(dialog).getByText("高级条件"));
    expect(within(dialog).queryByRole("textbox", { name: "VLESS 路由" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "添加路由属性" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "路由属性名称 1" }), { target: { value: "network" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "路由属性值 1" }), { target: { value: "tcp" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "路由规则高级 JSON" }), { target: { value: JSON.stringify({ type: "field", outboundTag: "ignored", balancerTag: "ignored", _runtime: true }) } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建规则" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/routing?server_id=11", {
      action: "add_rule_hot",
      rule: {
        type: "field",
        attrs: { network: "tcp" },
        sourceIP: ["192.0.2.0/24"],
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

  it("round trips 3x-ui sourceIP rules and preserves unavailable targets and unknown fields", async () => {
    const originalRule = {
      type: "field",
      sourceIP: ["10.10.0.0/16"],
      source: ["192.0.2.0/24"],
      network: ["tcp", "udp"],
      inboundTag: ["removed-in"],
      protocol: ["tls", "custom-proto"],
      outboundTag: "removed-out",
      vlessRoute: "443",
      ruleTag: "legacy-rule",
      process: ["legacy-process"],
    };
    mockServerReads([onlineServer], {
      inbounds: [{ tag: "active-in", protocol: "vless" }],
      outbounds: [{ tag: "direct", protocol: "freedom" }],
      routing: { balancers: [{ tag: "active-balancer" }], rules: [originalRule] },
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "Xray 设置" }));
    fireEvent.click(within(dialog).getByRole("tab", { name: "路由规则" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "编辑路由规则 1" }));

    const editor = await screen.findByRole("dialog", { name: "编辑路由规则" });
    expect(within(editor).getByRole("textbox", { name: "路由来源 IP" })).toHaveValue("10.10.0.0/16");
    expect(within(editor).getByRole("combobox", { name: "路由网络" })).toHaveValue("tcp,udp");
    const outboundSelect = within(editor).getByRole("combobox", { name: "路由出站 Tag" });
    expect(outboundSelect).toHaveValue("removed-out");
    expect(within(outboundSelect).getByRole("option", { name: "removed-out（已不存在）" })).toBeInTheDocument();
    fireEvent.click(within(editor).getByRole("button", { name: "路由协议" }));
    const customProtocol = within(editor).getByRole("option", { name: "custom-proto" });
    expect(customProtocol).toHaveAttribute("aria-selected", "true");
    fireEvent.click(customProtocol);
    expect(within(editor).getByRole("option", { name: "custom-proto" })).toHaveAttribute("aria-selected", "false");
    fireEvent.click(within(editor).getByRole("option", { name: "custom-proto" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(within(editor).getByRole("button", { name: "路由入站 Tag" }));
    const removedInbound = within(editor).getByRole("option", { name: "removed-in" });
    expect(removedInbound).toHaveAttribute("aria-selected", "true");
    fireEvent.click(removedInbound);
    expect(within(editor).getByRole("option", { name: "removed-in" })).toHaveAttribute("aria-selected", "false");
    fireEvent.click(within(editor).getByRole("option", { name: "removed-in" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.change(within(editor).getByRole("combobox", { name: "路由负载均衡 Tag" }), { target: { value: "active-balancer" } });
    expect(within(outboundSelect).getByRole("option", { name: "removed-out（已不存在）" })).toBeInTheDocument();
    fireEvent.change(outboundSelect, { target: { value: "removed-out" } });
    fireEvent.click(within(editor).getByRole("button", { name: "保存规则" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/routing?server_id=11", {
      action: "replace_rule_hot",
      index: 0,
      expected_rule: originalRule,
      rule: {
        type: "field",
        sourceIP: ["10.10.0.0/16"],
        network: "tcp,udp",
        inboundTag: ["removed-in"],
        protocol: ["tls", "custom-proto"],
        outboundTag: "removed-out",
        vlessRoute: "443",
        ruleTag: "legacy-rule",
        process: ["legacy-process"],
      },
    }));
  });

  it("does not activate legacy source when an explicit empty sourceIP is saved", async () => {
    const originalRule = { type: "field", sourceIP: [], source: ["10.0.0.0/8"], outboundTag: "direct" };
    mockServerReads([onlineServer], {
      outbounds: [{ tag: "direct", protocol: "freedom" }],
      routing: { rules: [originalRule] },
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "Xray 设置" }));
    fireEvent.click(within(dialog).getByRole("tab", { name: "路由规则" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "编辑路由规则 1" }));

    const editor = await screen.findByRole("dialog", { name: "编辑路由规则" });
    expect(within(editor).getByRole("textbox", { name: "路由来源 IP" })).toHaveValue("");
    fireEvent.click(within(editor).getByRole("button", { name: "保存规则" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/routing?server_id=11", {
      action: "replace_rule_hot",
      index: 0,
      expected_rule: originalRule,
      rule: { type: "field", outboundTag: "direct" },
    }));
  });

  it("keeps routing management available when inbound tag suggestions fail to load", async () => {
    mockServerReads([onlineServer], {
      inboundError: "older agent does not expose inbound suggestions",
      outbounds: [{ tag: "direct", protocol: "freedom" }],
      routing: { rules: [{ type: "field", domain: ["domain:example.com"], outboundTag: "direct" }] },
    });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "Xray 设置" }));
    fireEvent.click(within(dialog).getByRole("tab", { name: "路由规则" }));

    expect(await within(dialog).findByText("domain:example.com", { exact: true })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "编辑路由规则 1" })).toBeEnabled();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
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
    fireEvent.click(within(dialog).getByRole("tab", { name: "Xray 设置" }));
    fireEvent.click(within(dialog).getByRole("tab", { name: "路由规则" }));
    await within(dialog).findByRole("button", { name: "删除路由规则 2" });
    fireEvent.click(within(dialog).getByRole("button", { name: "删除路由规则 2" }));
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/routing?server_id=11", {
      action: "remove_rule_hot",
      index: 1,
      expected_rule: { type: "field", domain: ["domain:blocked.example"], balancerTag: "fallback" },
    }));
    expect(notify).toHaveBeenCalledWith("路由规则 #2 已删除");
  });

  it("reorders routing rules through one hot atomic replacement", async () => {
    const first = { type: "field", domain: ["domain:first.example"], outboundTag: "direct" };
    const second = { type: "field", domain: ["domain:second.example"], outboundTag: "proxy" };
    mockServerReads([onlineServer], { routing: { domainStrategy: "IPIfNonMatch", rules: [first, second] } });
    const notify = vi.fn();
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServicesWorkbenchPage notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "Xray 设置" }));
    fireEvent.click(within(dialog).getByRole("tab", { name: "路由规则" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "下移路由规则 1" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/routing?server_id=11", {
      action: "move_rule_hot",
      from: 0,
      to: 1,
      expected_rule: first,
    }));
    expect(notify).toHaveBeenCalledWith("路由顺序已调整");
  });

  it("surfaces an HTTP 200 routing response whose success flag is false", async () => {
    mockServerReads([onlineServer], { outbounds: [{ tag: "direct", protocol: "freedom" }], routing: { rules: [{ type: "field", outboundTag: "direct" }] } });
    const notify = vi.fn();
    vi.spyOn(api, "post").mockResolvedValue({ success: false, error: "规则语义无效" });
    render(<ServicesWorkbenchPage notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "Xray 设置" }));
    fireEvent.click(within(dialog).getByRole("tab", { name: "路由规则" }));
    await within(dialog).findByRole("button", { name: "删除路由规则 1" });
    fireEvent.click(within(dialog).getByRole("button", { name: "添加规则" }));
    fireEvent.change(within(dialog).getByLabelText("路由出站 Tag"), { target: { value: "direct" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建规则" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("规则语义无效");
    expect(within(dialog).getByLabelText("路由出站 Tag")).toHaveValue("direct");
    expect(notify).not.toHaveBeenCalled();
  });
});
