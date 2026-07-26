import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { ServicesWorkbenchPage } from "./services-workbench";
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
} = {}) {
  let ddnsStatusRead = 0;
  return vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
    if (path === "/api/admin/remote-servers") return { success: true, servers } as T;
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
    if (path.includes("/api/admin/remote/services/status")) return {
      success: true,
      xray: { installed: true, running: true, version: "Xray 25.1" },
      nginx: { installed: true, running: true, version: "nginx/1.26" },
    } as T;
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
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("service management workbench", () => {
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
      traffic_limit: 500 * 1024 ** 3,
      traffic_source: "system",
      traffic_stats_mode: "both",
      ipv6_enabled: true,
      steal_mode: "default",
      steal_self: false,
    })));
    expect(await screen.findByRole("dialog", { name: "Edge Singapore 接入凭据" })).toBeInTheDocument();
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

  it("loads live service state and restarts Xray through the remote control API", async () => {
    mockServerReads([onlineServer]);
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true, message: "restarted" });
    render(<ServicesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "管理" }));
    const dialog = await screen.findByRole("dialog", { name: "Edge Hong Kong" });
    await waitFor(() => expect(within(dialog).getByText("0.3.0")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("tab", { name: "服务控制" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "重启 Xray" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/services/control?server_id=11", { service: "xray", action: "restart" }));
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
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote-servers/delete", { id: 11 }));
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

  it("creates VLESS WS TLS through the existing Nginx-managed inbound contract", async () => {
    mockServerReads([onlineServer], { inbounds: [] });
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

  it("creates WireGuard with two generated keypairs and keeps the one-time client config open", async () => {
    mockServerReads([onlineServer], { inbounds: [] });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/xray/generate-x25519") return { privateKey: "A".repeat(43), publicKey: "B".repeat(43) } as T;
      if (path === "/api/admin/managed-inbound-resources/wireguard?server_id=11") return { success: true, message: "added" } as T;
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
    expect(JSON.stringify(inboundCall?.[1])).not.toContain(clientPrivateKey);
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
