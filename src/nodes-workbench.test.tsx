import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import {
  ChainProxyDialog,
  ExternalSubscriptionsDialog,
  NodesWorkbench,
  RegionEmojiDialog,
  ResolveIPDialog,
  RoutedOutboundDialog,
  SpeedDialog,
  TempSubscriptionDialog,
  URIManagerDialog,
  type WorkbenchNode,
} from "./nodes-workbench";

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
      throw new Error(`unexpected GET ${path}`);
    });
    render(<NodesWorkbench isAdmin={false} notify={vi.fn()} />);

    expect(await screen.findByText("香港 A")).toBeInTheDocument();
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
