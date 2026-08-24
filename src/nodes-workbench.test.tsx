import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import QRCode from "qrcode";
import { api } from "./api";
import {
  AnyDoorForwardDialog,
  BatchRenameDialog,
  ChainProxyDialog,
  ExternalSubscriptionsDialog,
  NodeEditor,
  NodeShareQRCodeDialog,
  NodesWorkbench,
  RegionEmojiDialog,
  ResolveIPDialog,
  RoutedOutboundDialog,
  SpeedDialog,
  SpeedHistoryDialog,
  TempSubscriptionDialog,
  TestersDialog,
  URIManagerDialog,
  managedCertificateMatchesServer,
  managedCertificateNameMatchesHost,
  managedTLSHostnameForCertificate,
  managedGrantAllowsProtocol,
  nodeDuplicateIdentity,
  type WorkbenchNode,
} from "./nodes-workbench";

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,node-qr") },
}));

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

function node(id: number, name: string, type = "vless", server = "edge.example.com"): WorkbenchNode {
  const config = {
    name,
    type,
    server,
    port: 443,
    uuid: `${id}0000000-0000-4000-8000-000000000000`,
    tls: true,
    sni: server,
    network: "ws",
    "ws-opts": { path: "/ws" },
  };
  return {
    id,
    raw_url: "",
    node_name: name,
    protocol: type,
    parsed_config: JSON.stringify(config),
    clash_config: JSON.stringify(config),
    enabled: true,
    tag: "",
    tags: [],
    original_server: "Edge A",
    original_domain: server,
    inbound_tag: `in-${id}`,
    node_type: "physical",
  };
}

function userConfig(nodeOrder: number[] = []) {
  return {
    force_sync_external: true,
    match_rule: "server_port",
    sync_scope: "saved_only",
    keep_node_name: false,
    cache_expire_minutes: 15,
    sync_traffic: true,
    node_name_filter: "剩余|流量",
    append_sub_info: true,
    custom_rules_enabled: true,
    enable_short_link: true,
    use_new_template_system: true,
    enable_proxy_provider: true,
    proxy_groups_source_url: "https://groups.example/config.yaml",
    client_compatibility_mode: true,
    node_order: nodeOrder,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("managed certificate hostname coverage", () => {
  const server = { id: 3, domain: "edge.example.com" } as never;
  const valid = { id: 9, domain: "example.com", status: "valid", expiry_date: "2030-01-01T00:00:00Z", remote_server_id: 3 };

  it("uses exact X.509 wildcard semantics", () => {
    expect(managedCertificateNameMatchesHost("example.com", "edge.example.com")).toBe(false);
    expect(managedCertificateNameMatchesHost("edge.example.com", "edge.example.com")).toBe(true);
    expect(managedCertificateNameMatchesHost("*.example.com", "edge.example.com")).toBe(true);
    expect(managedCertificateNameMatchesHost("*.example.com", "deep.edge.example.com")).toBe(false);
    expect(managedCertificateNameMatchesHost("*.example.com", "example.com")).toBe(false);
  });

  it("matches SANs and fills the concrete server hostname for wildcard TLS certificates", () => {
    expect(managedCertificateMatchesServer(valid, server)).toBe(false);
    const wildcard = { ...valid, domain: "*.example.com", dns_names: ["*.example.com"] };
    expect(managedCertificateMatchesServer(wildcard, server)).toBe(true);
    expect(managedTLSHostnameForCertificate(wildcard, server, "")).toBe("edge.example.com");
    expect(managedCertificateMatchesServer({ ...valid, remote_server_id: 8, dns_names: ["edge.example.com"] }, server)).toBe(false);
    expect(managedCertificateMatchesServer({ ...valid, dns_names: ["other.example.com", "edge.example.com"] }, server)).toBe(true);
  });
});

describe("managed server creation authorization", () => {
  it("never allows a regular-user shared Shadowsocks cipher", () => {
    const classicGrant = {
      id: 17,
      state: "active",
      allowed_protocols: ["shadowsocks" as const],
      allowed_protocol_profiles: ["shadowsocks-classic" as const],
    };

    expect(managedGrantAllowsProtocol(classicGrant, "shadowsocks", "aes-128-gcm")).toBe(true);
    expect(managedGrantAllowsProtocol(classicGrant, "shadowsocks", "chacha20-ietf-poly1305")).toBe(false);
    expect(managedGrantAllowsProtocol(classicGrant, "shadowsocks", "2022-blake3-aes-128-gcm")).toBe(false);
  });
});

describe("batch rename reconciliation", () => {
  it("reloads the owning workbench after a partial server-side success", async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(api, "post").mockResolvedValue({ success: 1, failed: 1 });
    render(<BatchRenameDialog nodes={[node(1, "Hong Kong"), node(2, "Tokyo")]} onClose={vi.fn()} onComplete={onComplete} />);

    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(1, 1));
  });
});

describe("duplicate node review", () => {
  it("uses a stable configuration identity regardless of object key order or display name", () => {
    const first = node(1, "First");
    const second = node(2, "Second");
    first.clash_config = JSON.stringify({ name: "First", server: "edge.example.com", port: 443, nested: { z: 2, a: 1 } });
    second.clash_config = JSON.stringify({ nested: { a: 1, z: 2 }, port: 443, server: "edge.example.com", name: "Second" });
    expect(nodeDuplicateIdentity(first)).toBe(nodeDuplicateIdentity(second));
  });

  it("falls back to parsed config and never groups nodes whose configuration is unknown", () => {
    const first = node(1, "Parsed A", "vless", "a.example.com");
    const second = node(2, "Parsed B", "vless", "b.example.com");
    first.clash_config = "";
    second.clash_config = "{}";
    expect(nodeDuplicateIdentity(first)).not.toBe(nodeDuplicateIdentity(second));

    first.parsed_config = "";
    second.parsed_config = "not-json";
    expect(nodeDuplicateIdentity(first)).not.toBe(nodeDuplicateIdentity(second));
  });

  it("previews each duplicate and lets the operator choose the survivor", async () => {
    const first = node(3, "保留候选 A");
    const second = node(8, "保留候选 B");
    const shared = { type: "vless", server: "edge.example.com", port: 443, uuid: "same-uuid" };
    first.clash_config = JSON.stringify({ ...shared, name: first.node_name });
    second.clash_config = JSON.stringify({ uuid: "same-uuid", port: 443, server: "edge.example.com", type: "vless", name: second.node_name });
    first.tags = ["生产"];
    second.tags = ["备用"];
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [second, first] } as T;
      if (path === "/api/admin/speedtest/results?latest=1") return { results: [] } as T;
      if (path === "/api/user/config") return userConfig([8, 3]) as T;
      if (path === "/api/admin/managed-node-offers") return { offers: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ deleted: 1, total: 1 });
    render(<NodesWorkbench isAdmin notify={vi.fn()} />);

    await screen.findByText("保留候选 A");
    fireEvent.click(screen.getByRole("button", { name: "工具" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除重复" }));
    const dialog = screen.getByRole("dialog", { name: "确认删除重复节点" });
    expect(within(dialog).getByRole("radio", { name: "保留 保留候选 A" })).toBeChecked();
    expect(within(dialog).getByText(/生产/)).toBeInTheDocument();
    expect(within(dialog).getByText(/备用/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("radio", { name: "保留 保留候选 B" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "删除 1 个节点" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/nodes/batch-delete", { node_ids: [3] }));
  });
});

describe("WireGuard nodes", () => {
  it("tests WireGuard by node id and labels the Mihomo end-to-end result", async () => {
    const wireGuard = node(12, "办公室 WireGuard", "wg", "203.0.113.10");
    const config = {
      name: wireGuard.node_name,
      type: "wireguard",
      server: "203.0.113.10",
      port: 51820,
      ip: "10.66.66.2",
      "private-key": "encrypted-at-rest-client-key",
      "public-key": "server-public-key",
      "allowed-ips": ["0.0.0.0/0"],
      udp: true,
      mtu: 1420,
    };
    wireGuard.clash_config = JSON.stringify(config);
    wireGuard.parsed_config = JSON.stringify(config);
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [wireGuard] } as T;
      if (path === "/api/admin/speedtest/results?latest=1") return { results: [] } as T;
      if (path === "/api/user/config") return userConfig([12]) as T;
      if (path === "/api/admin/managed-node-offers") return { offers: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/tcping") return { success: true, latency: 18.45, probe: "mihomo_url_test" } as T;
      throw new Error(`unexpected POST ${path}`);
    });
    render(<NodesWorkbench isAdmin notify={vi.fn()} />);

    expect(await screen.findByText("办公室 WireGuard")).toBeInTheDocument();
    expect(screen.getByRole("table").parentElement).toHaveClass("nw-node-table-scroll");
    expect(screen.getAllByText("WIREGUARD")).toHaveLength(2);
    expect(screen.getByText("203.0.113.10:51820")).toBeInTheDocument();
    const latencyButton = screen.getByRole("button", { name: "测延迟" });
    expect(latencyButton).toHaveAttribute("title", "点击使用 Mihomo 发起 HTTPS 204 代理实测；包含协议握手、代理出口和测试站响应，不是纯网络 RTT");
    fireEvent.click(latencyButton);
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/tcping", { node_id: 12, timeout: 5000 }));
    const result = await screen.findByRole("button", { name: "18.4 ms · 代理实测" });
    expect(result).toHaveAttribute("title", "Mihomo HTTPS 204 代理实测：18.4 ms，包含协议握手、代理出口和测试站响应，不是纯网络 RTT");
    expect(screen.getByRole("button", { name: "更多 办公室 WireGuard 操作" })).toBeInTheDocument();
    expect(screen.queryByText("不进入订阅")).not.toBeInTheDocument();
  });

  it("uses the same Mihomo latency wording for ordinary proxy protocols", async () => {
    const vless = node(13, "香港 VLESS", "vless", "edge.example.com");
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [vless] } as T;
      if (path === "/api/admin/speedtest/results?latest=1") return { results: [] } as T;
      if (path === "/api/user/config") return userConfig([13]) as T;
      if (path === "/api/admin/managed-node-offers") return { offers: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    vi.spyOn(api, "post").mockResolvedValue({ success: true, latency: 8.14, probe: "mihomo_url_test" });
    render(<NodesWorkbench isAdmin notify={vi.fn()} />);

    const latencyButton = await screen.findByRole("button", { name: "测延迟" });
    expect(latencyButton).toHaveAttribute("title", "点击使用 Mihomo 发起 HTTPS 204 代理实测；包含协议握手、代理出口和测试站响应，不是纯网络 RTT");
    fireEvent.click(latencyButton);

    const result = await screen.findByRole("button", { name: "8.1 ms · 代理实测" });
    expect(result).toHaveAttribute("title", "Mihomo HTTPS 204 代理实测：8.1 ms，包含协议握手、代理出口和测试站响应，不是纯网络 RTT");
  });

  it("submits batch latency requests by node id without client-provided targets", async () => {
    const wireGuard = node(12, "办公室 WireGuard", "wireguard", "203.0.113.10");
    const vless = node(13, "香港 VLESS", "vless", "edge.example.com");
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [wireGuard, vless] } as T;
      if (path === "/api/admin/speedtest/results?latest=1") return { results: [] } as T;
      if (path === "/api/user/config") return userConfig([12, 13]) as T;
      if (path === "/api/admin/managed-node-offers") return { offers: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue([
      { success: true, latency: 12.3, probe: "mihomo_url_test" },
      { success: true, latency: 8.1, probe: "mihomo_url_test" },
    ]);
    render(<NodesWorkbench isAdmin notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "选择当前结果" }));
    fireEvent.click(screen.getByRole("button", { name: "延迟" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/tcping/batch", [
      { node_id: 12, timeout: 5000 },
      { node_id: 13, timeout: 5000 },
    ]));
  });
});

describe("managed offer protocol guard", () => {
  it("edits node tags with reusable choices and custom chips", async () => {
    const tagged = node(6, "香港线路");
    tagged.tag = "香港";
    tagged.tags = ["香港"];
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    render(<NodeEditor node={tagged} availableTags={["香港", "高级线路"]} onClose={vi.fn()} onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "高级线路" }));
    const input = screen.getByRole("textbox", { name: "添加标签" });
    fireEvent.change(input, { target: { value: "低延迟" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "保存节点" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/nodes/6", expect.objectContaining({
      tag: "香港",
      tags: ["香港", "高级线路", "低延迟"],
    })));
  });

  it("keeps unverified imported classic Shadowsocks unavailable even with a legacy config marker", async () => {
    const classic = node(7, "Classic SS", "ss");
    const config = { name: "Classic SS", type: "ss", server: "edge.example.com", port: 8388, cipher: "aes-128-gcm", password: "shared", "x-arcway-managed-users": true };
    classic.clash_config = JSON.stringify(config);
    classic.parsed_config = JSON.stringify(config);
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<NodeEditor node={classic} onClose={vi.fn()} onComplete={vi.fn()} />);

    const selfService = screen.getByRole("switch", { name: "允许获授权用户自助开通" });
    expect(selfService).toBeDisabled();
    fireEvent.click(selfService);
    expect(selfService).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "保存节点" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/nodes/7", expect.objectContaining({ protocol: "ss" })));
    expect(post).not.toHaveBeenCalledWith("/api/admin/managed-node-offers", expect.anything());
  });

  it("allows unrelated edits to a verified managed classic AES node", async () => {
    const classic = node(8, "Managed Classic SS", "ss");
    const config = { name: "Managed Classic SS", type: "ss", server: "edge.example.com", port: 8388, cipher: "aes-256-gcm", password: "admin-password" };
    classic.clash_config = JSON.stringify(config);
    classic.parsed_config = JSON.stringify(config);
    classic.managed_multi_user = true;
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    render(<NodeEditor
      node={classic}
      offer={{ id: 12, node_id: 8, server_id: 3, inbound_tag: "in-8", enabled: true, sort_order: 0 }}
      onClose={vi.fn()}
      onComplete={vi.fn()}
    />);

    const selfService = screen.getByRole("switch", { name: "允许获授权用户自助开通" });
    expect(selfService).toBeChecked();
    expect(selfService).not.toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "节点名称" }), { target: { value: "Managed Classic SS 2" } });
    fireEvent.click(screen.getByRole("button", { name: "保存节点" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/nodes/8", expect.objectContaining({ node_name: "Managed Classic SS 2" })));
    expect(put).toHaveBeenCalledWith("/api/admin/managed-node-offers/12", { enabled: true, sort_order: 0 });
  });
});

describe("unsupported Snell imports", () => {
  it("removes Snell from a mixed import before saving supported nodes", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [node(1, "香港 A")] } as T;
      if (path === "/api/admin/speedtest/results?latest=1") return { results: [] } as T;
      if (path === "/api/user/config") return userConfig([1]) as T;
      if (path === "/api/admin/managed-node-offers") return { offers: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string, body?: unknown): Promise<T> => {
      if (path === "/api/admin/nodes/parse-uris") return {
        proxies: [
          { name: "Supported VLESS", type: "vless", server: "edge.example.com", port: 443 },
          { name: "Unsupported Snell", type: "snell", server: "snell.example.com", port: 443 },
        ],
      } as T;
      if (path === "/api/admin/nodes/batch") {
        const nodes = (body as { nodes: WorkbenchNode[] }).nodes;
        return { nodes: nodes.map((item, index) => ({ ...item, id: index + 10 })) } as T;
      }
      throw new Error(`unexpected POST ${path}`);
    });
    render(<NodesWorkbench isAdmin notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "导入已有节点" }));
    const dialog = screen.getByRole("dialog", { name: "导入外部节点" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "节点内容" }), { target: { value: "mixed subscription" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "解析并预览" }));

    expect(await within(dialog).findByText("识别到 1 个节点")).toBeInTheDocument();
    expect(within(dialog).getByText(/已忽略 1 个 Snell 节点/)).toBeInTheDocument();
    expect(within(dialog).queryByText("Unsupported Snell")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "保存 1 个节点" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/nodes/batch", {
      nodes: [expect.objectContaining({ node_name: "Supported VLESS", protocol: "vless" })],
    }));
  });
});

describe("nodes speedtest workbench", () => {
  it("submits the selected nodes with the exact asynchronous speedtest contract", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/speedtest/testers") return { testers: [] } as T;
      if (path === "/api/admin/speedtest/mihomo-status") return { ready: true } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn();
    render(<SpeedDialog nodes={[node(1, "香港 A")]} initialNodeIDs={[1]} latest={{}} notify={notify} onClose={vi.fn()} onRefresh={refresh} onOpenHistory={vi.fn()} onManageTesters={vi.fn()} />);

    fireEvent.change(await screen.findByRole("combobox", { name: "并发线程" }), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "开始测速" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/speedtest/run", {
      node_id: 1,
      bytes: 0,
      threads: 4,
      latency_only: false,
    }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith("节点测速已开始");
  });

  it("reports partial speedtest submission and refreshes after every request settles", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/speedtest/testers") return { testers: [] } as T;
      if (path === "/api/admin/speedtest/mihomo-status") return { ready: true } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string, body?: unknown): Promise<T> => {
      if (path !== "/api/admin/speedtest/run") throw new Error(`unexpected POST ${path}`);
      if ((body as { node_id: number }).node_id === 2) throw new Error("queue unavailable");
      return { success: true } as T;
    });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn();
    render(<SpeedDialog nodes={[node(1, "香港 A"), node(2, "东京 B")]} initialNodeIDs={[1, 2]} latest={{}} notify={notify} onClose={vi.fn()} onRefresh={refresh} onOpenHistory={vi.fn()} onManageTesters={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "开始测速" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("alert")).toHaveTextContent("节点测速提交完成：成功 1，失败 1");
    expect(notify).toHaveBeenCalledWith("节点测速提交完成：成功 1，失败 1", "error");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not overlap slow interval refreshes for running speedtests", async () => {
    vi.useFakeTimers();
    const slowRefresh = deferred<{ results: Record<string, unknown>[] }>();
    let requestCount = 0;
    const get = vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path !== "/api/admin/speedtest/results?limit=200") throw new Error(`unexpected GET ${path}`);
      requestCount += 1;
      if (requestCount === 1) return { results: [{ id: 1, node_id: 1, node_name: "香港 A", source: "master_local", down_mbps: 0, latency_ms: 0, test_bytes: 0, status: "running", created_at: "2026-08-08T00:00:00Z" }] } as T;
      return slowRefresh.promise as Promise<T>;
    });
    const rendered = render(<SpeedHistoryDialog onClose={vi.fn()} />);

    try {
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByText("进行中")).toBeInTheDocument();

      await act(async () => { vi.advanceTimersByTime(3000); await Promise.resolve(); });
      expect(get).toHaveBeenCalledTimes(2);
      await act(async () => { vi.advanceTimersByTime(9000); await Promise.resolve(); });
      expect(get).toHaveBeenCalledTimes(2);

      await act(async () => { slowRefresh.resolve({ results: [] }); await Promise.resolve(); });
      expect(screen.getByText("暂无测速记录")).toBeInTheDocument();
    } finally {
      rendered.unmount();
      vi.useRealTimers();
    }
  });

  it("loads line targets lazily and exposes explicit managed installation states", async () => {
    let masterInstalled = false;
    const installRequest = deferred<Record<string, unknown>>();
    const get = vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/speedtest/testers") return { testers: [] } as T;
      if (path === "/api/admin/speedtest/mihomo-status") return { ready: true } as T;
      if (path === "/api/admin/line-speedtest/targets") return { targets: [
        { key: "master", kind: "master", name: "主控", online: true, installed: masterInstalled, managed: true, owned: masterInstalled, implementation: "Ookla Speedtest", version: masterInstalled ? "1.2.0" : "", running: false },
        { key: "remote-8", kind: "remote", server_id: 8, name: "旧版 Agent", online: true, installed: false, managed: false, supported: false, upgrade_required: true, running: false, error: "Agent 版本过旧" },
        { key: "remote-9", kind: "remote", server_id: 9, name: "系统 CLI", online: true, installed: true, managed: true, owned: false, implementation: "Ookla Speedtest", version: "1.2.0.84", running: false },
        { key: "remote-10", kind: "remote", server_id: 10, name: "离线服务器", online: false, installed: false, managed: false, supported: false, running: false, error: "服务器离线" },
        { key: "remote-11", kind: "remote", server_id: 11, name: "探测失败", online: true, installed: false, managed: false, running: false, error: "context deadline exceeded" },
        { key: "remote-12", kind: "remote", server_id: 12, name: "最近失败", online: true, supported: true, installed: true, managed: true, owned: true, running: false, error: "公网测速超时", last_result: { ping_ms: 20, download_mbps: 100, upload_mbps: 50, created_at: "2026-07-22T12:00:00Z" }, last_job: { id: 44, status: "failed", error: "公网测速超时", created_at: "2026-07-23T12:00:00Z", completed_at: "2026-07-23T12:03:00Z" } },
        { key: "remote-13", kind: "remote", server_id: 13, name: "待确认许可", online: true, supported: true, installed: true, managed: true, owned: true, license_accepted: false, running: false },
      ] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/line-speedtest/install") {
        const response = await installRequest.promise;
        masterInstalled = true;
        return response as T;
      }
      throw new Error(`unexpected POST ${path}`);
    });
    const notify = vi.fn();
    render(<SpeedDialog nodes={[node(1, "香港 A")]} initialNodeIDs={[]} latest={{}} notify={notify} onClose={vi.fn()} onRefresh={vi.fn()} onOpenHistory={vi.fn()} onManageTesters={vi.fn()} />);

    await screen.findByRole("tab", { name: "节点测速" });
    expect(get).not.toHaveBeenCalledWith("/api/admin/line-speedtest/targets");
    fireEvent.click(screen.getByRole("tab", { name: "线路 Ookla Speedtest" }));

    const oldAgentRow = (await screen.findByText("旧版 Agent")).closest("tr");
    expect(oldAgentRow).not.toBeNull();
    expect(within(oldAgentRow as HTMLTableRowElement).getByText("需升级 Agent")).toBeInTheDocument();
    expect(within(oldAgentRow as HTMLTableRowElement).getByRole("button", { name: "安装 Ookla Speedtest 到 旧版 Agent" })).toBeDisabled();
    const offlineRow = screen.getByText("离线服务器").closest("tr");
    expect(within(offlineRow as HTMLTableRowElement).getByText("离线")).toBeInTheDocument();
    expect(within(offlineRow as HTMLTableRowElement).queryByText("需升级 Agent")).not.toBeInTheDocument();
    expect(within(offlineRow as HTMLTableRowElement).getByRole("button", { name: "安装 Ookla Speedtest 到 离线服务器" })).toBeDisabled();
    const probeErrorRow = screen.getByText("探测失败").closest("tr");
    expect(within(probeErrorRow as HTMLTableRowElement).getByText("状态不可用")).toBeInTheDocument();
    expect(within(probeErrorRow as HTMLTableRowElement).queryByText("手动安装")).not.toBeInTheDocument();
    expect(within(probeErrorRow as HTMLTableRowElement).getByRole("button", { name: "安装 Ookla Speedtest 到 探测失败" })).toBeDisabled();
    const failedRow = screen.getByText("最近失败").closest("tr");
    expect(within(failedRow as HTMLTableRowElement).getByText("最近测速失败")).toBeInTheDocument();
    expect(within(failedRow as HTMLTableRowElement).getByText("公网测速超时")).toBeInTheDocument();
    const systemRow = screen.getByText("系统 CLI").closest("tr");
    expect(within(systemRow as HTMLTableRowElement).queryByRole("button", { name: "卸载 系统 CLI Ookla Speedtest" })).not.toBeInTheDocument();
    const licenseRow = screen.getByText("待确认许可").closest("tr");
    expect(within(licenseRow as HTMLTableRowElement).getByText("需确认许可")).toBeInTheDocument();
    expect(within(licenseRow as HTMLTableRowElement).getByRole("button", { name: "确认 Ookla Speedtest 许可 到 待确认许可" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "安装 Ookla Speedtest 到 主控" }));
    expect(await screen.findByRole("dialog", { name: "安装 Ookla Speedtest" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "同意并安装" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "同意并安装" }));
    expect((await screen.findAllByText("安装中")).length).toBeGreaterThanOrEqual(1);
    await act(async () => { installRequest.resolve({ success: true }); });

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/line-speedtest/install", { kind: "master", accept_license: true }));
    expect(await screen.findByRole("button", { name: "测速 主控 线路" })).toBeEnabled();
    expect(notify).toHaveBeenCalledWith("主控 Ookla Speedtest 安装完成");
  });

  it("polls a line job and renders the complete Speedtest result", async () => {
    const jobRequest = deferred<Record<string, unknown>>();
    const get = vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/speedtest/testers") return { testers: [] } as T;
      if (path === "/api/admin/speedtest/mihomo-status") return { ready: true } as T;
      if (path === "/api/admin/line-speedtest/targets") return { targets: [{ key: "remote-7", kind: "remote", server_id: 7, name: "东京线路", online: true, supported: true, installed: true, managed: true, owned: true, implementation: "Ookla Speedtest", version: "1.2.0", running: false, error: "上次测速超时", last_job: { id: "old-job", status: "failed", error: "上次测速超时" } }] } as T;
      if (path === "/api/admin/line-speedtest/jobs/job-7") return jobRequest.promise as Promise<T>;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ job_id: "job-7", status: "queued" });
    const notify = vi.fn();
    render(<SpeedDialog nodes={[]} initialNodeIDs={[]} latest={{}} notify={notify} onClose={vi.fn()} onRefresh={vi.fn()} onOpenHistory={vi.fn()} onManageTesters={vi.fn()} />);

    fireEvent.click(await screen.findByRole("tab", { name: "线路 Ookla Speedtest" }));
    expect(await screen.findByText("最近测速失败")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "测速 东京线路 线路" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/line-speedtest/run", { kind: "remote", server_id: 7 }));
    expect((await screen.findAllByText("测试中")).length).toBeGreaterThanOrEqual(1);
    await act(async () => { jobRequest.resolve({
      job: { id: "job-7", status: "completed" },
      result: {
        ping_ms: 12.34,
        jitter_ms: 1.23,
        packet_loss_percent: 0,
        download_mbps: 812.45,
        upload_mbps: 398.76,
        test_server: "Ookla Tokyo #15047",
        server_name: "ignored fallback",
        server_location: "Tokyo",
        isp: "Example ISP",
        egress_ip: "203.0.113.7",
        created_at: "2026-07-23T12:30:00Z",
      },
    }); });

    expect(await screen.findByText("12.3 ms")).toBeInTheDocument();
    expect(screen.getByText("抖动")).toBeInTheDocument();
    expect(screen.getByText("1.2 ms")).toBeInTheDocument();
    expect(screen.getByText("丢包")).toBeInTheDocument();
    expect(screen.getByText("0.0 %")).toBeInTheDocument();
    expect(screen.getByText("↓ 812.5 Mbps")).toBeInTheDocument();
    expect(screen.getByText("↑ 398.8 Mbps")).toBeInTheDocument();
    expect(screen.getByText("Ookla Tokyo #15047")).toBeInTheDocument();
    expect(screen.getByText(/Example ISP · 203\.0\.113\.7/)).toBeInTheDocument();
    const lineTable = screen.getByRole("table", { name: "线路测速目标" });
    expect(Array.from(lineTable.querySelectorAll("colgroup col"), (column) => column.className)).toEqual([
      "nw-line-col-target",
      "nw-line-col-status",
      "nw-line-col-implementation",
      "nw-line-col-latency",
      "nw-line-col-throughput",
      "nw-line-col-endpoint",
      "nw-line-col-time",
      "nw-line-col-actions",
    ]);
    expect(screen.getByText("12.3 ms").closest(".nw-line-metrics")).not.toBeNull();
    expect(screen.getByText("↓ 812.5 Mbps").closest(".nw-line-throughput")).not.toBeNull();
    expect(get).toHaveBeenCalledWith("/api/admin/line-speedtest/jobs/job-7");
    expect(notify).toHaveBeenCalledWith("东京线路测速完成");
    expect(screen.queryByText("最近测速失败")).not.toBeInTheDocument();
  });

  it("stops polling and surfaces a failed line Speedtest job", async () => {
    const jobRequest = deferred<Record<string, unknown>>();
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/speedtest/testers") return { testers: [] } as T;
      if (path === "/api/admin/speedtest/mihomo-status") return { ready: true } as T;
      if (path === "/api/admin/line-speedtest/targets") return { targets: [{ key: "remote-7", kind: "remote", server_id: 7, name: "东京线路", online: true, supported: true, installed: true, managed: true, owned: true, implementation: "Ookla Speedtest", running: false }] } as T;
      if (path === "/api/admin/line-speedtest/jobs/job-7") return jobRequest.promise as Promise<T>;
      throw new Error(`unexpected GET ${path}`);
    });
    vi.spyOn(api, "post").mockResolvedValue({ job_id: "job-7", status: "running" });
    const notify = vi.fn();
    render(<SpeedDialog nodes={[]} initialNodeIDs={[]} latest={{}} notify={notify} onClose={vi.fn()} onRefresh={vi.fn()} onOpenHistory={vi.fn()} onManageTesters={vi.fn()} />);

    fireEvent.click(await screen.findByRole("tab", { name: "线路 Ookla Speedtest" }));
    fireEvent.click(await screen.findByRole("button", { name: "测速 东京线路 线路" }));
    expect((await screen.findAllByText("测试中")).length).toBeGreaterThanOrEqual(1);
    await act(async () => { jobRequest.resolve({ job: { id: "job-7", status: "failed", error: "公网测速超时" } }); });

    expect(await screen.findByText("公网测速超时")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("测试中")).not.toBeInTheDocument());
    expect(notify).toHaveBeenCalledWith("东京线路：公网测速超时", "error");
  });

  it("removes only a panel-owned Speedtest installation after confirmation", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/speedtest/testers") return { testers: [] } as T;
      if (path === "/api/admin/speedtest/mihomo-status") return { ready: true } as T;
      if (path === "/api/admin/line-speedtest/targets") return { targets: [{ key: "remote-3", kind: "remote", server_id: 3, name: "香港线路", online: true, installed: true, managed: true, owned: true, implementation: "Ookla Speedtest", running: false }] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<SpeedDialog nodes={[]} initialNodeIDs={[]} latest={{}} notify={vi.fn()} onClose={vi.fn()} onRefresh={vi.fn()} onOpenHistory={vi.fn()} onManageTesters={vi.fn()} />);

    fireEvent.click(await screen.findByRole("tab", { name: "线路 Ookla Speedtest" }));
    fireEvent.click(await screen.findByRole("button", { name: "卸载 香港线路 Ookla Speedtest" }));
    expect(screen.getByRole("dialog", { name: "卸载 Ookla Speedtest" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认卸载" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/line-speedtest/remove", { kind: "remote", server_id: 3 }));
  });

  it("surfaces a Speedtest removal failure after closing the confirmation", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/speedtest/testers") return { testers: [] } as T;
      if (path === "/api/admin/speedtest/mihomo-status") return { ready: true } as T;
      if (path === "/api/admin/line-speedtest/targets") return { targets: [{ key: "remote-3", kind: "remote", server_id: 3, name: "香港线路", online: true, installed: true, managed: true, owned: true, implementation: "Ookla Speedtest", running: false }] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    vi.spyOn(api, "post").mockRejectedValue(new Error("只允许删除面板安装的 Ookla Speedtest"));
    render(<SpeedDialog nodes={[]} initialNodeIDs={[]} latest={{}} notify={vi.fn()} onClose={vi.fn()} onRefresh={vi.fn()} onOpenHistory={vi.fn()} onManageTesters={vi.fn()} />);

    fireEvent.click(await screen.findByRole("tab", { name: "线路 Ookla Speedtest" }));
    fireEvent.click(await screen.findByRole("button", { name: "卸载 香港线路 Ookla Speedtest" }));
    fireEvent.click(screen.getByRole("button", { name: "确认卸载" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "卸载 Ookla Speedtest" })).not.toBeInTheDocument());
    expect(screen.getByText("只允许删除面板安装的 Ookla Speedtest")).toBeInTheDocument();
  });

  it("builds quote-safe RelayDock tester commands from GitHub installers in readable copy blocks", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ testers: [] });
    vi.spyOn(api, "post").mockResolvedValue({ id: 7, token: "tok'en" });
    render(<TestersDialog notify={vi.fn()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: "测速端名称" }), { target: { value: "Home O'Brien" } });
    fireEvent.click(screen.getByRole("button", { name: "创建测速端" }));

    const linuxButton = await screen.findByRole("button", { name: "复制 Linux 安装命令" });
    const powershellButton = screen.getByRole("button", { name: "复制 Windows PowerShell 安装命令" });
    const linux = linuxButton.closest(".field")?.querySelector("code")?.textContent;
    const powershell = powershellButton.closest(".field")?.querySelector("code")?.textContent;
    const origin = window.location.origin;
    const installerRevision = "5d28be86fd54a0958aee5a6ae97e348e0949312a";
    const linuxInstaller = `https://raw.githubusercontent.com/violetaini/relaydock/${installerRevision}/scripts/install-relaydock-speedtester.sh`;
    const powershellInstaller = `https://raw.githubusercontent.com/violetaini/relaydock/${installerRevision}/scripts/install-relaydock-speedtester.ps1`;

    expect(screen.getByText("tok'en", { selector: ".nw-pairing-token code" })).toBeInTheDocument();
    expect(linuxButton.closest(".nw-command-copy")).toBeInTheDocument();
    expect(powershellButton.closest(".nw-command-copy")).toBeInTheDocument();
    expect(linux).toBe(`( installer=$(mktemp) && curl -fsSL ${linuxInstaller} -o "$installer" && sudo env RELAYDOCK_MASTER_URL='${origin}' RELAYDOCK_SPEEDTEST_TOKEN='tok'\"'\"'en' RELAYDOCK_SPEEDTEST_NAME='Home O'\"'\"'Brien' sh "$installer"; status=$?; rm -f "$installer"; exit "$status" )`);
    expect(linux).not.toContain("| sudo");
    expect(powershell).toBe(`$env:RELAYDOCK_MASTER_URL='${origin}'; $env:RELAYDOCK_SPEEDTEST_TOKEN='tok''en'; $env:RELAYDOCK_SPEEDTEST_NAME='Home O''Brien'; $ErrorActionPreference='Stop'; $installer=Join-Path ([IO.Path]::GetTempPath()) ('relaydock-speedtester-install-' + [guid]::NewGuid().ToString('N') + '.ps1'); try { Invoke-WebRequest -UseBasicParsing -Uri '${powershellInstaller}' -OutFile $installer; & $installer } finally { Remove-Item -Force -ErrorAction SilentlyContinue $installer }`);
    expect(powershell).not.toContain("| iex");
  });
});

describe("node batch reconciliation", () => {
  const mockWorkbenchLoads = (items: WorkbenchNode[]) => vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
    if (path === "/api/admin/nodes") return { nodes: items } as T;
    if (path === "/api/admin/speedtest/results?latest=1") return { results: [] } as T;
    if (path === "/api/user/config") return userConfig(items.map((item) => item.id)) as T;
    if (path === "/api/admin/managed-node-offers") return { offers: [] } as T;
    throw new Error(`unexpected GET ${path}`);
  });

  it("reconciles and reports partial batch status updates", async () => {
    const items = [node(1, "香港 A"), node(2, "东京 B")];
    const get = mockWorkbenchLoads(items);
    const put = vi.spyOn(api, "put").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes/2") throw new Error("update rejected");
      return { success: true } as T;
    });
    const notify = vi.fn();
    render(<NodesWorkbench isAdmin notify={notify} />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "选择当前结果" }));
    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    fireEvent.click(screen.getByRole("button", { name: "确认停用" }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(notify).toHaveBeenCalledWith("批量停用完成：成功 1，失败 1", "error");
    await waitFor(() => expect(get.mock.calls.filter(([path]) => path === "/api/admin/nodes")).toHaveLength(2));
    expect(screen.queryByRole("dialog", { name: "批量停用节点" })).not.toBeInTheDocument();
  });

  it("reconciles and reports partial batch tag updates", async () => {
    const items = [node(1, "香港 A"), node(2, "东京 B")];
    const get = mockWorkbenchLoads(items);
    const put = vi.spyOn(api, "put").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes/2") throw new Error("update rejected");
      return { success: true } as T;
    });
    const notify = vi.fn();
    render(<NodesWorkbench isAdmin notify={notify} />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "选择当前结果" }));
    fireEvent.click(screen.getByRole("button", { name: "标签" }));
    const dialog = screen.getByRole("dialog", { name: "批量修改标签" });
    const input = within(dialog).getByPlaceholderText("输入标签后按回车");
    fireEvent.change(input, { target: { value: "重点线路" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存标签" }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put).toHaveBeenCalledWith("/api/admin/nodes/1", expect.objectContaining({ tag: "重点线路", tags: ["重点线路"] }));
    expect(notify).toHaveBeenCalledWith("批量标签更新完成：成功 1，失败 1", "error");
    await waitFor(() => expect(get.mock.calls.filter(([path]) => path === "/api/admin/nodes")).toHaveLength(2));
    expect(screen.queryByRole("dialog", { name: "批量修改标签" })).not.toBeInTheDocument();
  });

  it("reloads and clears selection after a partially successful batch delete", async () => {
    const items = [node(1, "香港 A"), node(2, "东京 B")];
    let nodeLoads = 0;
    const get = vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") {
        nodeLoads += 1;
        return { nodes: nodeLoads === 1 ? items : [items[1]] } as T;
      }
      if (path === "/api/admin/speedtest/results?latest=1") return { results: [] } as T;
      if (path === "/api/user/config") return userConfig([1, 2]) as T;
      if (path === "/api/admin/managed-node-offers") return { offers: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    vi.spyOn(api, "post").mockRejectedValue(new Error("已删除 1 个节点，另 1 个删除失败"));
    const notify = vi.fn();
    render(<NodesWorkbench isAdmin notify={notify} />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "选择当前结果" }));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "删除 2 个节点" }));

    await waitFor(() => expect(get.mock.calls.filter(([path]) => path === "/api/admin/nodes")).toHaveLength(2));
    expect(screen.queryByText("香港 A")).not.toBeInTheDocument();
    expect(screen.getByText("东京 B")).toBeInTheDocument();
    expect(screen.queryByRole("toolbar", { name: "批量操作" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "批量删除节点" })).not.toBeInTheDocument();
    expect(notify).toHaveBeenCalledWith("已删除 1 个节点，另 1 个删除失败", "error");
  });
});

describe("node any-door forwarding", () => {
  it("creates an AnyDoor node by selecting Tunnel and an existing target node", async () => {
    const source = node(7, "美国 Reality", "vless", "target.example.com");
    const managedServer = {
      id: 3,
      name: "香港入口",
      status: "online",
      ws_connected: true,
      xray_running: true,
      xray_mode: "embedded",
      is_federated: false,
      domain: "edge.example.com",
      inbounds: [],
    };
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [source] } as T;
      if (path === "/api/admin/speedtest/results?latest=1") return { results: [] } as T;
      if (path === "/api/user/config") return userConfig([7]) as T;
      if (path === "/api/admin/managed-node-offers") return { offers: [] } as T;
      if (path === "/api/admin/remote-servers") return { servers: [managedServer] } as T;
      if (path === "/api/admin/certificates") return { certificates: [] } as T;
      if (path === "/api/admin/remote/inbounds?server_id=3") return { inbounds: [] } as T;
      if (path === "/api/admin/remote/reality-domains?server_id=3") return { domains: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/xray/generate-x25519") return { privateKey: "A".repeat(43), publicKey: "B".repeat(43) } as T;
      if (path === "/api/admin/managed-nodes/create?server_id=3") return { success: true, node_id: 41 } as T;
      throw new Error(`unexpected POST ${path}`);
    });
    const notify = vi.fn();
    render(<NodesWorkbench isAdmin notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "在服务器创建" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "下一步" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    fireEvent.change(await screen.findByRole("combobox", { name: "节点协议" }), { target: { value: "anydoor" } });
    expect(screen.getByRole("combobox", { name: "节点传输与安全预设" })).toHaveValue("anydoor");
    expect(screen.getByText("Tunnel（任意门）", { selector: "strong" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    fireEvent.change(await screen.findByRole("textbox", { name: "节点名称" }), { target: { value: "A-B-C Tunnel" } });
    expect(screen.getByRole("spinbutton", { name: "监听端口" })).toHaveValue(2033);
    expect(screen.getByRole("combobox", { name: "目标节点" })).toHaveValue("7");
    expect(screen.getByRole("textbox", { name: "目标地址" })).toHaveValue("target.example.com:443");
    expect(screen.getByRole("textbox", { name: "转发网络" })).toHaveValue("TCP + UDP");
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "创建节点" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/managed-nodes/create?server_id=3", {
      action: "add",
      node_name: "A-B-C Tunnel",
      ip_version: "v4",
      forward_node_id: 7,
      inbound: {
        tag: expect.stringMatching(/^anydoor-[a-f0-9]{6}$/),
        listen: "0.0.0.0",
        protocol: "tunnel",
        port: 2033,
        settings: { address: "target.example.com", port: 443, network: "tcp,udp" },
      },
    }));
    expect(notify).toHaveBeenCalledWith("任意门转发已创建");
  });

  it("shows managed AnyDoor clones as TUNNEL in the node table", async () => {
    const tunnel = { ...node(41, "A-B-C Tunnel", "vless", "edge.example.com"), inbound_tag: "anydoor-node-7" };
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [tunnel] } as T;
      if (path === "/api/admin/speedtest/results?latest=1") return { results: [] } as T;
      if (path === "/api/user/config") return userConfig([41]) as T;
      if (path === "/api/admin/managed-node-offers") return { offers: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    render(<NodesWorkbench isAdmin notify={vi.fn()} />);

    const row = (await screen.findByText("A-B-C Tunnel")).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLTableRowElement).getByText("TUNNEL")).toBeInTheDocument();
    expect(within(row as HTMLTableRowElement).getByText(/目标协议 VLESS/)).toBeInTheDocument();
  });

  it("exposes any-door forwarding from an administrator node row", async () => {
    const source = node(7, "美国 Reality", "vless", "target.example.com");
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [source] } as T;
      if (path === "/api/admin/speedtest/results?latest=1") return { results: [] } as T;
      if (path === "/api/user/config") return userConfig([7]) as T;
      if (path === "/api/admin/managed-node-offers") return { offers: [] } as T;
      if (path === "/api/admin/remote-servers") return { servers: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    render(<NodesWorkbench isAdmin notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "更多 美国 Reality 操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "任意门转发" }));
    expect(screen.getByRole("dialog", { name: "任意门转发 · 美国 Reality" })).toBeInTheDocument();
  });

  it("keeps server-side forwarding actions off imported subscription nodes", async () => {
    const imported = { ...node(8, "订阅导入"), original_server: "", inbound_tag: "" };
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [imported] } as T;
      if (path === "/api/admin/speedtest/results?latest=1") return { results: [] } as T;
      if (path === "/api/user/config") return userConfig([8]) as T;
      if (path === "/api/admin/managed-node-offers") return { offers: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    render(<NodesWorkbench isAdmin notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "更多 订阅导入 操作" }));
    expect(screen.queryByRole("menuitem", { name: "任意门转发" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "设置中转" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "设置链式代理" })).not.toBeInTheDocument();
  });

  it.each([
    { kind: "top-level node id", response: { success: true, node_id: 41 } },
    { kind: "nested node id", response: { success: true, node_id: 0, node: { id: 41 } } },
  ])("creates a TCP+UDP tunnel through the managed-node transaction with $kind", async ({ response }) => {
    const source = node(7, "美国 Reality", "vless", "target.example.com");
    vi.spyOn(api, "get").mockResolvedValue({ servers: [{
      id: 3,
      name: "香港入口",
      status: "online",
      ws_connected: true,
      xray_running: true,
      is_federated: false,
      domain: "edge.example.com",
    }] });
    const post = vi.spyOn(api, "post").mockResolvedValue(response);
    const complete = vi.fn().mockResolvedValue(undefined);
    render(<AnyDoorForwardDialog node={source} onClose={vi.fn()} onComplete={complete} />);

    expect(await screen.findByRole("combobox", { name: "入口服务器" })).toHaveValue("3");
    expect(screen.getByRole("spinbutton", { name: "监听端口" })).toHaveValue(2033);
    fireEvent.click(screen.getByRole("button", { name: "创建任意门" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/managed-nodes/create?server_id=3", {
      action: "add",
      node_name: "美国 Reality | Tunnel",
      forward_node_id: 7,
      inbound: {
        tag: "anydoor-node-7",
        protocol: "tunnel",
        port: 2033,
        settings: { address: "target.example.com", port: 443, network: "tcp,udp" },
      },
    }));
    expect(complete).toHaveBeenCalledOnce();
  });

  it.each([
    {
      kind: "an empty 2xx body",
      response: {},
      expected: "任意门转发创建失败：服务端未确认事务成功",
    },
    {
      kind: "success without a node id",
      response: { success: true },
      expected: "任意门转发创建失败：服务端未返回有效节点记录",
    },
    {
      kind: "warning",
      response: { success: true, node_id: 41, warning: "persist_failed", message: "入站已添加到运行时，但写入配置文件失败" },
      expected: "入站已添加到运行时，但写入配置文件失败",
    },
    {
      kind: "runtime warning",
      response: { success: true, node_id: 41, runtime_warning: "Xray 运行态应用失败" },
      expected: "Xray 运行态应用失败",
    },
    {
      kind: "success false",
      response: { success: false, error: "Agent 拒绝创建入站", runtime_warning: "不应覆盖主错误" },
      expected: "Agent 拒绝创建入站",
    },
  ])("keeps the dialog open when the Agent returns $kind", async ({ response, expected }) => {
    const source = node(7, "美国 Reality", "vless", "target.example.com");
    vi.spyOn(api, "get").mockResolvedValue({ servers: [{
      id: 3,
      name: "香港入口",
      status: "online",
      ws_connected: true,
      xray_running: true,
      is_federated: false,
      domain: "edge.example.com",
    }] });
    vi.spyOn(api, "post").mockResolvedValue(response);
    const complete = vi.fn().mockResolvedValue(undefined);
    render(<AnyDoorForwardDialog node={source} onClose={vi.fn()} onComplete={complete} />);

    await screen.findByRole("combobox", { name: "入口服务器" });
    fireEvent.click(screen.getByRole("button", { name: "创建任意门" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    expect(complete).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "任意门转发 · 美国 Reality" })).toBeInTheDocument();
  });
});

describe("external subscription operations", () => {
  it("syncs an owned or administrator-visible subscription through the shared authenticated endpoint", async () => {
    const subscription = {
      id: 12,
      username: "alice",
      name: "Provider A",
      url: "https://provider.example/sub",
      user_agent: "clash-meta/2.4.0",
      node_count: 9,
      last_sync_at: "2026-07-18T10:00:00Z",
      upload: 1024,
      download: 2048,
      total: 10240,
      expire: null,
      traffic_mode: "both",
    };
    vi.spyOn(api, "get").mockResolvedValue([subscription]);
    const post = vi.spyOn(api, "post").mockResolvedValue({ message: "同步完成", node_count: 9 });
    const onNodesChanged = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn();
    render(<ExternalSubscriptionsDialog notify={notify} onClose={vi.fn()} onNodesChanged={onNodesChanged} />);

    fireEvent.click(await screen.findByRole("button", { name: "立即同步" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/user/sync-external-subscription?id=12", {}));
    expect(onNodesChanged).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith("同步完成");
  });
});

describe("node workbench permissions", () => {
  it("does not expose administrator-only speedtest and URI actions to a regular user", async () => {
    const get = vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [node(1, "香港 A")] } as T;
      if (path === "/api/user/config") return userConfig([1]) as T;
      if (path === "/api/user/routed-outbound") return { items: [], enabled: false, quota: { used: 0, max: 2 }, daily: { used: 0, max: 5 } } as T;
      if (path === "/api/user/managed-node-creation") return { servers: [], certificates: [], creations: [] } as T;
      if (path === "/api/user/managed-nodes") return { grants: [], selected: [], catalog: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    render(<NodesWorkbench isAdmin={false} notify={vi.fn()} />);

    expect(await screen.findByText("香港 A")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "在服务器创建" })).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith("/api/admin/speedtest/results?latest=1");
    fireEvent.click(screen.getByRole("button", { name: "工具" }));
    expect(screen.queryByRole("menuitem", { name: "节点测速" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "测速结果" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "测速端管理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "URI 管理器" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "外部订阅" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "选择 香港 A" }));
    const toolbar = screen.getByRole("toolbar", { name: "批量操作" });
    expect(toolbar).not.toHaveTextContent("标签");
    expect(toolbar).not.toHaveTextContent("测速");
    expect(toolbar).toHaveTextContent("延迟");
    expect(toolbar).toHaveTextContent("临时订阅");
  });

  it("shows a retryable error when the user creation context cannot be loaded", async () => {
    const get = vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [node(1, "香港 A")] } as T;
      if (path === "/api/user/config") return userConfig([1]) as T;
      if (path === "/api/user/routed-outbound") return { items: [], enabled: false, quota: { used: 0, max: 2 }, daily: { used: 0, max: 5 } } as T;
      if (path === "/api/user/managed-nodes") return { grants: [], selected: [], catalog: [] } as T;
      if (path === "/api/user/managed-node-creation") throw new Error("创建上下文暂不可用");
      throw new Error(`unexpected GET ${path}`);
    });
    render(<NodesWorkbench isAdmin={false} notify={vi.fn()} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("创建上下文暂不可用；服务器创建入口暂不可用，不能据此判断账号没有授权");
    expect(screen.queryByRole("button", { name: "在服务器创建" })).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "重试" }));
    await waitFor(() => expect(get.mock.calls.filter(([path]) => path === "/api/user/managed-node-creation")).toHaveLength(2));
  });

  it("lets an authorized user create only an allowed protocol on a granted server", async () => {
    const existing = node(1, "已有节点");
    const grantedServer = {
      id: 3,
      name: "获授权香港入口",
      status: "online",
      ws_connected: true,
      xray_running: true,
      xray_mode: "embedded",
      ipv6_enabled: false,
      domain: "edge.example.com",
      ip_address: "203.0.113.3",
      current_upload_speed: 0,
      current_download_speed: 0,
      traffic_limit: 0,
      traffic_used: 0,
      traffic_stats_mode: "both",
      traffic_source: "xray",
      connection_mode: "websocket",
      encrypted: true,
      inbounds: [{ tag: "existing-ws", protocol: "vless", port: 8080 }],
      grant: {
        id: 17,
        state: "active",
        max_active_nodes: 2,
        active_node_count: 0,
        allowed_protocols: ["vless"],
        allowed_protocol_profiles: ["vless-ws"],
      },
    };
    const creationContext = {
      success: true,
      servers: [
        grantedServer,
        { ...grantedServer, id: 4, name: "未授权服务器", grant: undefined },
        { ...grantedServer, id: 5, name: "外置 Xray 服务器", xray_mode: "external" },
      ],
      certificates: [],
      creations: [],
    };
    const get = vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [existing] } as T;
      if (path === "/api/user/config") return userConfig([1]) as T;
      if (path === "/api/user/routed-outbound") return { items: [], enabled: false, quota: { used: 0, max: 2 }, daily: { used: 0, max: 5 } } as T;
      if (path === "/api/user/managed-node-creation") return creationContext as T;
      if (path === "/api/user/managed-nodes") return { grants: [], selected: [], catalog: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/user/managed-node-creation?server_id=3") return { success: true, node_id: 22 } as T;
      throw new Error(`unexpected POST ${path}`);
    });
    const notify = vi.fn();
    render(<NodesWorkbench isAdmin={false} notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "在服务器创建" }));
    const dialog = screen.getByRole("dialog", { name: "在服务器创建节点" });
    expect(within(dialog).getByText("获授权香港入口")).toBeInTheDocument();
    expect(within(dialog).queryByText("未授权服务器")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /外置 Xray 服务器/ })).toBeDisabled();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "下一步" })).not.toBeDisabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));

    const family = within(dialog).getByRole("combobox", { name: "节点协议" });
    const preset = within(dialog).getByRole("combobox", { name: "节点传输与安全预设" });
    expect(within(family).getAllByRole("option").map((option) => option.textContent)).toEqual(["VLESS"]);
    expect(within(preset).getAllByRole("option").map((option) => option.textContent)).toEqual(["VLESS WS"]);
    expect(within(dialog).queryByText("WireGuard")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Tunnel（任意门）")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));

    fireEvent.change(within(dialog).getByRole("textbox", { name: "节点名称" }), { target: { value: "我的香港 WS" } });
    expect(within(dialog).getByRole("spinbutton", { name: "监听端口" })).toHaveValue(2082);
    expect(within(dialog).queryByRole("textbox", { name: "客户端 UUID" })).not.toBeInTheDocument();
    expect(within(dialog).getByText("节点凭据由服务端自动生成")).toBeInTheDocument();
    expect(within(dialog).queryByRole("switch", { name: "创建后发布到用户自助目录" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "下一步" }));
    expect(within(dialog).getByText("当前账号专用")).toBeInTheDocument();
    const preview = within(dialog).getByLabelText("受管节点 Xray JSON") as HTMLTextAreaElement;
    expect(preview.value).toContain("创建后由服务端自动生成");
    expect(preview.value).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    fireEvent.click(within(dialog).getByRole("button", { name: "创建节点" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/user/managed-node-creation?server_id=3", expect.objectContaining({
      action: "add",
      node_name: "我的香港 WS",
      inbound: expect.objectContaining({ protocol: "vless" }),
    })));
    expect(get).not.toHaveBeenCalledWith("/api/admin/remote-servers");
    expect(post.mock.calls.some(([path]) => String(path).startsWith("/api/admin/"))).toBe(false);
    expect(notify).toHaveBeenCalledWith("节点已在授权服务器创建");
  });

  it("lets a user delete only a server node linked to their creation record", async () => {
    const created = node(22, "我的服务器节点");
    const shared = node(23, "套餐共享节点");
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [created, shared] } as T;
      if (path === "/api/user/config") return userConfig([22, 23]) as T;
      if (path === "/api/user/routed-outbound") return { items: [], enabled: false, quota: { used: 0, max: 2 }, daily: { used: 0, max: 5 } } as T;
      if (path === "/api/user/managed-node-creation") return { servers: [], certificates: [], creations: [{ id: 31, node_id: 22, node_name: created.node_name, server_id: 3 }] } as T;
      if (path === "/api/user/managed-nodes") return { grants: [], selected: [], catalog: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const remove = vi.spyOn(api, "delete").mockResolvedValue({ success: true });
    const notify = vi.fn();
    render(<NodesWorkbench isAdmin={false} notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "更多 套餐共享节点 操作" }));
    expect(screen.queryByRole("menuitem", { name: "删除服务器节点" })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "更多 我的服务器节点 操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除服务器节点" }));
    const confirm = screen.getByRole("dialog", { name: "删除服务器节点" });
    fireEvent.click(within(confirm).getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("/api/user/managed-node-creation/31"));
    expect(notify).toHaveBeenCalledWith("服务器节点已删除");
  });

  it("supports roving keyboard focus in the tools menu and restores the trigger", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [node(1, "香港 A")] } as T;
      if (path === "/api/admin/speedtest/results?latest=1") return { results: [] } as T;
      if (path === "/api/user/config") return userConfig([1]) as T;
      if (path === "/api/admin/managed-node-offers") return { offers: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    render(<NodesWorkbench isAdmin notify={vi.fn()} />);

    const trigger = await screen.findByRole("button", { name: "工具" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const menu = await screen.findByRole("menu", { name: "节点工具" });
    const items = screen.getAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: "End" });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "节点工具" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("managed server node creation", () => {
  it("separates managed creation from importing and submits a protocol-aware Reality payload", async () => {
    const existing = node(1, "香港 A");
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [existing] } as T;
      if (path === "/api/admin/speedtest/results?latest=1") return { results: [] } as T;
      if (path === "/api/user/config") return userConfig([1]) as T;
      if (path === "/api/admin/managed-node-offers") return { offers: [] } as T;
      if (path === "/api/admin/remote-servers") return { servers: [{ id: 3, name: "香港入口", status: "online", ws_connected: true, xray_running: true, xray_mode: "embedded", ipv6_enabled: false, domain: "edge.example.com", current_upload_speed: 0, current_download_speed: 0, traffic_limit: 0, traffic_used: 0, traffic_stats_mode: "both", traffic_source: "xray", connection_mode: "websocket", encrypted: true, inbounds: [] }] } as T;
      if (path === "/api/admin/remote/inbounds?server_id=3") return { success: true, inbounds: [{ tag: "existing", protocol: "vless", port: 443 }] } as T;
      if (path === "/api/admin/certificates") return { certificates: [{ id: 9, domain: "*.example.com", status: "valid", expiry_date: "2030-01-01T00:00:00Z", remote_server_id: 3 }] } as T;
      if (path === "/api/admin/remote/reality-domains?server_id=3") return { domains: [{ domain: "www.cloudflare.com", success: true, latency_ms: 16 }] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/xray/generate-x25519") return { privateKey: "A".repeat(43), publicKey: "B".repeat(43) } as T;
      if (path === "/api/admin/managed-nodes/create?server_id=3") return { success: true, node_id: 8 } as T;
      throw new Error(`unexpected POST ${path}`);
    });
    const notify = vi.fn();
    render(<NodesWorkbench isAdmin notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "在服务器创建" }));
    expect(screen.getByRole("dialog", { name: "在服务器创建节点" })).toBeInTheDocument();
    expect(await screen.findByText("地址由服务器配置自动生成，不需要手工填写 IP 或域名。")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "下一步" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(await screen.findByRole("combobox", { name: "节点协议" })).toHaveValue("vless");
    expect(screen.getByText("已有节点统一使用“导入已有节点”，仅用于订阅、测速和用户分配。")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "节点传输与安全预设" })).toHaveValue("vless-reality");
    expect(screen.getByRole("option", { name: "VLESS WSS" })).not.toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "下一步" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "节点名称" }), { target: { value: "香港 Reality 02" } });
    fireEvent.change(screen.getByRole("combobox", { name: /^伪装目标域名 \/ SNI/ }), { target: { value: "www.cloudflare.com" } });
    expect(screen.getByRole("spinbutton", { name: "监听端口" })).toHaveValue(8443);
    expect(screen.getByRole("combobox", { name: "Reality 流控" })).toHaveValue("xtls-rprx-vision");
    expect(screen.getByRole("option", { name: "xtls-rprx-vision（推荐）" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Reality 流控" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "创建节点" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/managed-nodes/create?server_id=3", expect.objectContaining({
      node_name: "香港 Reality 02",
      inbound: expect.objectContaining({
        protocol: "vless",
        settings: expect.objectContaining({ clients: [expect.not.objectContaining({ flow: expect.anything() })] }),
        streamSettings: expect.objectContaining({ security: "reality" }),
      }),
    })));
    expect(notify).toHaveBeenCalledWith("受管节点已创建");
  });

  it("offers audited gRPC TLS and Trojan Reality presets with protocol-specific fields", async () => {
    const existing = node(1, "香港 A");
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [existing] } as T;
      if (path === "/api/admin/speedtest/results?latest=1") return { results: [] } as T;
      if (path === "/api/user/config") return userConfig([1]) as T;
      if (path === "/api/admin/managed-node-offers") return { offers: [] } as T;
      if (path === "/api/admin/remote-servers") return { servers: [{ id: 3, name: "香港入口", status: "online", ws_connected: true, xray_running: true, xray_mode: "embedded", ipv6_enabled: false, domain: "edge.example.com", current_upload_speed: 0, current_download_speed: 0, traffic_limit: 0, traffic_used: 0, traffic_stats_mode: "both", traffic_source: "xray", connection_mode: "websocket", encrypted: true, inbounds: [] }] } as T;
      if (path === "/api/admin/remote/inbounds?server_id=3") return { success: true, inbounds: [] } as T;
      if (path === "/api/admin/certificates") return { certificates: [{ id: 9, domain: "*.example.com", status: "valid", expiry_date: "2030-01-01T00:00:00Z", remote_server_id: 3 }] } as T;
      if (path === "/api/admin/remote/reality-domains?server_id=3") return { domains: [{ domain: "www.cloudflare.com", success: true, latency_ms: 16 }] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/xray/generate-x25519") return { privateKey: "A".repeat(43), publicKey: "B".repeat(43) } as T;
      throw new Error(`unexpected POST ${path}`);
    });
    render(<NodesWorkbench isAdmin notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "在服务器创建" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "下一步" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    const family = await screen.findByRole("combobox", { name: "节点协议" });
    const preset = screen.getByRole("combobox", { name: "节点传输与安全预设" });
    expect(screen.getByRole("option", { name: "VLESS gRPC TLS" })).toBeInTheDocument();
    fireEvent.change(family, { target: { value: "vmess" } });
    expect(screen.getByRole("option", { name: "VMess gRPC TLS" })).toBeInTheDocument();
    fireEvent.change(family, { target: { value: "trojan" } });
    expect(screen.getByRole("option", { name: "Trojan TCP Reality" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Trojan gRPC TLS" })).toBeInTheDocument();

    fireEvent.change(preset, { target: { value: "trojan-reality" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "下一步" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(await screen.findByRole("textbox", { name: "认证密码" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^伪装目标域名 \/ SNI/ })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "托管证书" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "上一步" }));
    fireEvent.change(screen.getByRole("combobox", { name: "节点传输与安全预设" }), { target: { value: "trojan-grpc-tls" } });
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(await screen.findByRole("textbox", { name: /^gRPC Service Name/ })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "认证密码" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "托管证书" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "TLS SNI" })).toBeInTheDocument();
  });

  it("creates WireGuard as a normal node with separately encrypted client credentials", async () => {
    const existing = node(1, "香港 A");
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [existing] } as T;
      if (path === "/api/admin/speedtest/results?latest=1") return { results: [] } as T;
      if (path === "/api/user/config") return userConfig([1]) as T;
      if (path === "/api/admin/managed-node-offers") return { offers: [] } as T;
      if (path === "/api/admin/remote-servers") return { servers: [{ id: 3, name: "香港入口", status: "online", ws_connected: true, xray_running: true, xray_mode: "embedded", ipv6_enabled: false, domain: "edge.example.com", current_upload_speed: 0, current_download_speed: 0, traffic_limit: 0, traffic_used: 0, traffic_stats_mode: "both", traffic_source: "xray", connection_mode: "websocket", encrypted: true, inbounds: [] }] } as T;
      if (path === "/api/admin/remote/inbounds?server_id=3") return { success: true, inbounds: [] } as T;
      if (path === "/api/admin/certificates") return { certificates: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/managed-inbound-resources/wireguard?server_id=3") return { success: true, resource: { id: 8 }, node_id: 8 } as T;
      throw new Error(`unexpected POST ${path}`);
    });
    const notify = vi.fn();
    render(<NodesWorkbench isAdmin notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "在服务器创建" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "下一步" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "节点协议" }), { target: { value: "wireguard" } });
    expect(screen.getByRole("combobox", { name: "节点传输与安全预设" })).toHaveValue("wireguard");
    await waitFor(() => expect(screen.getByRole("button", { name: "下一步" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "节点名称" }), { target: { value: "香港 WireGuard" } });
    expect(screen.getByRole("textbox", { name: "WireGuard 服务端地址" })).toHaveValue("10.66.66.1/32");
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    const preview = await screen.findByRole("textbox", { name: "受管节点 Xray JSON" });
    expect(preview).toHaveAttribute("rows", "16");
    expect((preview as HTMLTextAreaElement).value).toContain('"protocol": "wireguard"');
    fireEvent.click(screen.getByRole("button", { name: "创建节点" }));

    const config = await screen.findByRole("textbox", { name: "WireGuard 客户端配置" });
    expect(config).toHaveAttribute("rows", "16");
    const clientPrivateKey = (config as HTMLTextAreaElement).value.match(/^PrivateKey = (.+)$/m)?.[1];
    expect(clientPrivateKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/managed-inbound-resources/wireguard?server_id=3", expect.objectContaining({
      action: "add",
      display_name: "香港 WireGuard",
      inbound: expect.objectContaining({ protocol: "wireguard" }),
    })));
    const payload = post.mock.calls.find(([path]) => path === "/api/admin/managed-inbound-resources/wireguard?server_id=3")?.[1];
    expect(payload).toMatchObject({
      client: {
        private_key: clientPrivateKey,
        address: ["10.66.66.2/32"],
        dns: ["1.1.1.1", "1.0.0.1"],
        mtu: 1420,
        keep_alive: 25,
        allowed_ips: ["0.0.0.0/0"],
      },
    });
    expect(JSON.stringify((payload as { inbound?: unknown }).inbound)).not.toContain(clientPrivateKey);
    expect(post).not.toHaveBeenCalledWith("/api/admin/remote/inbounds?server_id=3", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(notify).toHaveBeenCalledWith("WireGuard 节点已创建");
  });

  it("offers public WS without a server domain while keeping WSS disabled", async () => {
    const existing = node(1, "香港 A");
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [existing] } as T;
      if (path === "/api/admin/speedtest/results?latest=1") return { results: [] } as T;
      if (path === "/api/user/config") return userConfig([1]) as T;
      if (path === "/api/admin/managed-node-offers") return { offers: [] } as T;
      if (path === "/api/admin/remote-servers") return { servers: [{ id: 3, name: "香港入口", status: "online", ws_connected: true, xray_running: true, xray_mode: "embedded", ipv6_enabled: false, domain: "", ip_address: "203.0.113.8", current_upload_speed: 0, current_download_speed: 0, traffic_limit: 0, traffic_used: 0, traffic_stats_mode: "both", traffic_source: "xray", connection_mode: "websocket", encrypted: true, inbounds: [] }] } as T;
      if (path === "/api/admin/remote/inbounds?server_id=3") return { success: true, inbounds: [] } as T;
      if (path === "/api/admin/certificates") return { certificates: [] } as T;
      if (path === "/api/admin/remote/reality-domains?server_id=3") return { domains: [{ domain: "www.cloudflare.com", success: true, latency_ms: 16 }] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/xray/generate-x25519") return { privateKey: "A".repeat(43), publicKey: "B".repeat(43) } as T;
      throw new Error(`unexpected POST ${path}`);
    });
    render(<NodesWorkbench isAdmin notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "在服务器创建" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "下一步" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    const preset = await screen.findByRole("combobox", { name: "节点传输与安全预设" });
    expect(screen.getByRole("option", { name: /VLESS WSS/ })).toBeDisabled();
    expect(screen.getByRole("option", { name: "VLESS WS" })).not.toBeDisabled();
    fireEvent.change(preset, { target: { value: "vless-ws" } });
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(await screen.findByRole("textbox", { name: /WebSocket Host（可选）/ })).toHaveValue("");
    expect(screen.getByRole("spinbutton", { name: "监听端口" })).toHaveValue(8080);
    fireEvent.change(screen.getByRole("textbox", { name: "节点名称" }), { target: { value: "香港 WS" } });
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    const preview = await screen.findByRole("textbox", { name: "受管节点 Xray JSON" });
    expect((preview as HTMLTextAreaElement).value).toContain('"listen": "0.0.0.0"');
    expect((preview as HTMLTextAreaElement).value).not.toContain('"headers"');
  });

  it("publishes managed classic AES but turns publishing off for shared classic ChaCha20", async () => {
    const existing = node(1, "香港 A");
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [existing] } as T;
      if (path === "/api/admin/speedtest/results?latest=1") return { results: [] } as T;
      if (path === "/api/user/config") return userConfig([1]) as T;
      if (path === "/api/admin/managed-node-offers") return { offers: [] } as T;
      if (path === "/api/admin/remote-servers") return { servers: [{ id: 3, name: "香港入口", status: "online", ws_connected: true, xray_running: true, xray_mode: "embedded", ipv6_enabled: false, domain: "edge.example.com", current_upload_speed: 0, current_download_speed: 0, traffic_limit: 0, traffic_used: 0, traffic_stats_mode: "both", traffic_source: "xray", connection_mode: "websocket", encrypted: true, inbounds: [] }] } as T;
      if (path === "/api/admin/remote/inbounds?server_id=3") return { success: true, inbounds: [] } as T;
      if (path === "/api/admin/certificates") return { certificates: [] } as T;
      if (path === "/api/admin/remote/reality-domains?server_id=3") return { domains: [{ domain: "www.cloudflare.com", success: true, latency_ms: 16 }] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/xray/generate-x25519") return { privateKey: "A".repeat(43), publicKey: "B".repeat(43) } as T;
      throw new Error(`unexpected POST ${path}`);
    });
    render(<NodesWorkbench isAdmin notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "在服务器创建" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "下一步" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByRole("option", { name: /VLESS WSS（缺少匹配的有效证书）/ })).toBeDisabled();
    fireEvent.change(await screen.findByRole("combobox", { name: "节点协议" }), { target: { value: "shadowsocks" } });
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    const publish = await screen.findByRole("switch", { name: "创建后发布到用户自助目录" });
    fireEvent.click(publish);
    expect(publish).toBeChecked();
    fireEvent.change(screen.getByRole("combobox", { name: "Shadowsocks 加密方式" }), { target: { value: "aes-128-gcm" } });
    expect(publish).toBeChecked();
    expect(publish).not.toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Shadowsocks 加密方式" }), { target: { value: "chacha20-ietf-poly1305" } });
    expect(publish).not.toBeChecked();
    expect(publish).toBeDisabled();
    expect(screen.getByText(/经典 ChaCha20 Shadowsocks 只有一组共享密码/)).toBeInTheDocument();
  });
});

describe("persistent node order", () => {
  it("keeps the complete user configuration while replacing only node_order", async () => {
    const config = userConfig([2, 1, 3]);
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [node(1, "香港 A"), node(2, "日本 B"), node(3, "美国 C")] } as T;
      if (path === "/api/admin/speedtest/results?latest=1") return { results: [] } as T;
      if (path === "/api/user/config") return config as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const put = vi.spyOn(api, "put").mockResolvedValue(config);
    const notify = vi.fn();
    render(<NodesWorkbench isAdmin notify={notify} />);

    await screen.findByText("香港 A");
    fireEvent.change(screen.getByRole("combobox", { name: "节点排序" }), { target: { value: "custom" } });
    fireEvent.click(screen.getByRole("button", { name: "下移 日本 B" }));
    fireEvent.click(screen.getByRole("button", { name: "保存节点顺序" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/user/config", {
      ...config,
      node_order: [1, 2, 3],
    }));
    expect(notify).toHaveBeenCalledWith("节点顺序已保存");
  });
});

describe("chain proxy configuration", () => {
  it("excludes the current node and submits a complete node payload", async () => {
    const source = node(1, "入口");
    const target = node(2, "前置");
    const put = vi.spyOn(api, "put").mockResolvedValue({});
    const complete = vi.fn().mockResolvedValue(undefined);
    render(<ChainProxyDialog node={source} nodes={[source, target]} onClose={vi.fn()} onComplete={complete} />);

    expect(screen.queryByRole("option", { name: /入口/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "前置代理节点" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "保存链式代理" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/nodes/1", {
      raw_url: source.raw_url,
      node_name: source.node_name,
      protocol: source.protocol,
      parsed_config: source.parsed_config,
      clash_config: source.clash_config,
      enabled: source.enabled,
      tag: "",
      tags: [],
      inbound_tag: source.inbound_tag,
      chain_proxy_node_id: 2,
    }));
    expect(complete).toHaveBeenCalledOnce();
  });

  it("clears an existing chain proxy with an explicit null", async () => {
    const source = { ...node(1, "入口"), chain_proxy_node_id: 2 };
    const put = vi.spyOn(api, "put").mockResolvedValue({});
    render(<ChainProxyDialog node={source} nodes={[source, node(2, "前置")]} onClose={vi.fn()} onComplete={vi.fn()} />);

    fireEvent.change(screen.getByRole("combobox", { name: "前置代理节点" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存链式代理" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/nodes/1", expect.objectContaining({ chain_proxy_node_id: null })));
  });

  it("does not offer imported subscription inventory as a chain target", () => {
    const source = node(1, "入口");
    const imported = { ...node(2, "订阅导入"), original_server: "", inbound_tag: "" };
    render(<ChainProxyDialog node={source} nodes={[source, imported]} onClose={vi.fn()} onComplete={vi.fn()} />);

    expect(screen.queryByRole("option", { name: /订阅导入/ })).not.toBeInTheDocument();
    expect(screen.getByText("没有其他节点可作为前置代理")).toBeInTheDocument();
  });
});

describe("node DNS resolution", () => {
  it("lets the administrator choose IPv6 and updates only the server endpoint", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue({ ips: ["203.0.113.8", "2001:db8::8"] });
    const put = vi.spyOn(api, "put").mockResolvedValue({});
    const complete = vi.fn().mockResolvedValue(undefined);
    render(<ResolveIPDialog node={node(7, "香港入口", "vless", "edge.example.com")} onClose={vi.fn()} onComplete={complete} />);

    fireEvent.click(screen.getByRole("button", { name: "解析域名" }));
    fireEvent.click(await screen.findByRole("radio", { name: "使用 2001:db8::8" }));
    fireEvent.click(screen.getByRole("button", { name: "应用 IP" }));

    expect(get).toHaveBeenCalledWith("/api/dns/resolve?hostname=edge.example.com");
    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/nodes/7/server", { server: "2001:db8::8" }));
    expect(complete).toHaveBeenCalledOnce();
  });
});

describe("node region emoji", () => {
  it("replaces the existing prefix and keeps both JSON names synchronized", async () => {
    const selected = node(9, "🇺🇸 Edge A");
    const put = vi.spyOn(api, "put").mockResolvedValue({});
    render(<RegionEmojiDialog node={selected} onClose={vi.fn()} onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "香港 🇭🇰" }));
    fireEvent.click(screen.getByRole("button", { name: "保存地区标识" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/nodes/9", expect.objectContaining({
      node_name: "🇭🇰 Edge A",
      parsed_config: expect.any(String),
      clash_config: expect.any(String),
    })));
    const payload = put.mock.calls[0][1] as { parsed_config: string; clash_config: string };
    expect(JSON.parse(payload.parsed_config).name).toBe("🇭🇰 Edge A");
    expect(JSON.parse(payload.clash_config).name).toBe("🇭🇰 Edge A");
  });
});

describe("routed outbound provisioning", () => {
  it("converts a target Clash node and creates the routed outbound atomically", async () => {
    const source = node(1, "入口");
    const target = node(2, "落地", "vless", "landing.example.com");
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    const complete = vi.fn().mockResolvedValue(undefined);
    render(<RoutedOutboundDialog node={source} nodes={[source, target]} onClose={vi.fn()} onComplete={complete} />);

    fireEvent.change(screen.getByRole("textbox", { name: /^Label/ }), { target: { value: "HK-T4" } });
    fireEvent.click(screen.getByRole("button", { name: "创建路由出站" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/routed-outbound", expect.objectContaining({
      parent_node_id: 1,
      label: "HK-T4",
      node_name: "入口-HK-T4",
      outbound: expect.objectContaining({
        protocol: "vless",
        settings: expect.objectContaining({ vnext: expect.any(Array) }),
        streamSettings: expect.objectContaining({ network: "ws", security: "tls" }),
      }),
    })));
    expect(complete).toHaveBeenCalledOnce();
  });

  it("uses the quota-enforced user endpoint for a regular user's private route", async () => {
    const source = node(1, "入口");
    const target = node(2, "落地", "vless", "landing.example.com");
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    const complete = vi.fn().mockResolvedValue(undefined);
    render(<RoutedOutboundDialog
      node={source}
      nodes={[source, target]}
      isAdmin={false}
      userStatus={{ items: [], enabled: true, quota: { used: 0, max: 2 }, daily: { used: 1, max: 5 } }}
      onClose={vi.fn()}
      onComplete={complete}
    />);

    fireEvent.change(screen.getByRole("textbox", { name: /^Label/ }), { target: { value: "private-us" } });
    fireEvent.click(screen.getByRole("button", { name: "创建私有路由出站" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/user/routed-outbound", expect.objectContaining({
      parent_node_id: 1,
      target_node_id: 2,
      label: "private-us",
      node_name: "入口-private-us",
      outbound: expect.objectContaining({ protocol: "vless" }),
    })));
    expect(complete).toHaveBeenCalledOnce();
  });
});

describe("temporary subscriptions", () => {
  it("sends parsed Clash proxies instead of node database records", async () => {
    const selected = node(7, "临时节点");
    const post = vi.spyOn(api, "post").mockResolvedValue({ id: "deadbeef", url: "/t/deadbeef", max_access: 1, expire_at: "2026-07-19T12:00:00Z" });
    render(<TempSubscriptionDialog nodes={[selected]} notify={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "生成订阅" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/temp-subscription", {
      proxies: [JSON.parse(selected.clash_config)],
      max_access: 1,
      expire_seconds: 300,
    }));
    expect(await screen.findByText("临时订阅已生成")).toBeInTheDocument();
  });
});

describe("URI manager", () => {
  it("loads server-produced per-user URIs and copies the filtered result", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ items: [{ username: "alice", node_id: 3, node_name: "香港", protocol: "vless", node_type: "physical", uri: "vless://alice-secret" }] });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const notify = vi.fn();
    render(<URIManagerDialog notify={notify} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "复制当前结果" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("vless://alice-secret"));
    expect(notify).toHaveBeenCalledWith("已复制 1 条 URI");
  });
});

describe("single node QR import", () => {
  it("loads the server-produced URI and generates the QR locally", async () => {
    const selected = node(7, "美国 Reality", "vless", "edge.example.com");
    const uri = "vless://70000000-0000-4000-8000-000000000000@edge.example.com:443?security=tls#US";
    vi.spyOn(api, "get").mockResolvedValue({
      item: {
        username: "alice",
        node_id: 7,
        node_name: "美国 Reality",
        protocol: "vless",
        node_type: "physical",
        uri,
      },
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const notify = vi.fn();
    vi.mocked(QRCode.toDataURL).mockClear();

    render(<NodeShareQRCodeDialog node={selected} notify={notify} onClose={vi.fn()} />);

    expect(await screen.findByRole("img", { name: "美国 Reality 节点二维码" })).toHaveAttribute("src", "data:image/png;base64,node-qr");
    expect(api.get).toHaveBeenCalledWith("/api/admin/nodes/7/uri");
    expect(QRCode.toDataURL).toHaveBeenCalledWith(uri, expect.objectContaining({ width: 320, margin: 2 }));
    fireEvent.click(screen.getByRole("button", { name: "复制链接" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(uri));
    expect(notify).toHaveBeenCalledWith("节点分享链接已复制");
    expect(screen.getByRole("link", { name: "下载 PNG" })).toHaveAttribute("download", "美国 Reality.png");
  });

  it("uses the same QR workflow for a normal WireGuard node", async () => {
    const selected = node(12, "办公室 WireGuard", "wireguard", "edge.example.com");
    const uri = "wireguard://client-private@edge.example.com:51820/?publickey=server-public&address=10.66.66.2%2F32#Office";
    vi.spyOn(api, "get").mockResolvedValue({
      item: {
        username: "alice",
        node_id: 12,
        node_name: "办公室 WireGuard",
        protocol: "wireguard",
        node_type: "physical",
        uri,
      },
    });
    vi.mocked(QRCode.toDataURL).mockClear();

    render(<NodeShareQRCodeDialog node={selected} notify={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByRole("img", { name: "办公室 WireGuard 节点二维码" })).toHaveAttribute("src", "data:image/png;base64,node-qr");
    expect(api.get).toHaveBeenCalledWith("/api/admin/nodes/12/uri");
    expect(QRCode.toDataURL).toHaveBeenCalledWith(uri, expect.objectContaining({ width: 320, margin: 2 }));
  });

  it("renders the row menu in a portal and exposes QR import to regular users", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [node(1, "香港 A")] } as T;
      if (path === "/api/user/config") return userConfig([1]) as T;
      if (path === "/api/user/routed-outbound") return { items: [], enabled: false, quota: { used: 0, max: 2 }, daily: { used: 0, max: 5 } } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    render(<NodesWorkbench isAdmin={false} notify={vi.fn()} />);

    const trigger = await screen.findByRole("button", { name: "更多 香港 A 操作" });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "香港 A 节点操作" });
    expect(menu.parentElement).toBe(document.body);
    expect(within(menu).getByRole("menuitem", { name: "二维码导入" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "香港 A 节点操作" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
