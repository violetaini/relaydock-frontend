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

function mockServerReads(servers: RemoteServer[] = [onlineServer, offlineServer], resources: { inbounds?: Record<string, unknown>[]; outbounds?: Record<string, unknown>[]; routing?: { rules?: Record<string, unknown>[]; domainStrategy?: string } } = {}) {
  return vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
    if (path === "/api/admin/remote-servers") return { success: true, servers } as T;
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
    throw new Error(`unexpected GET ${path}`);
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("service management workbench", () => {
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
    mockServerReads([onlineServer], { routing: { domainStrategy: "IPIfNonMatch", rules: [{
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
    fireEvent.change(within(dialog).getByRole("textbox", { name: "路由出站 Tag" }), { target: { value: "media-out" } });
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
    fireEvent.change(within(dialog).getByRole("textbox", { name: "路由出站 Tag" }), { target: { value: "broken-out" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建规则" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("规则语义无效");
    expect(within(dialog).getByRole("textbox", { name: "路由出站 Tag" })).toHaveValue("broken-out");
    expect(notify).not.toHaveBeenCalled();
  });
});
